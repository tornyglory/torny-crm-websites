# Email Templates — Header + Footer

**Feature:** owners can edit a shared HTML header + footer that wraps every outgoing club email — application acknowledgements, enquiry replies, welcome emails, and future broadcasts. Variables use `{{curly-brace}}` tokens substituted at send time from a per-flavour whitelist.

**Status:** frontend shipped 2026-08-27 (Settings → Email template tab with header/footer editors, variable palette, preview across four flavours, buffered save, test-send button). Currently 404s until this brief ships — the CRM falls back to an in-memory stub so the editor + preview still work locally.

**Related briefs:**
- brief 15 (public site payload) — sample data for `{{club_name}}`, `{{club_email}}`, `{{club_address}}` comes from `clubs_data` fields already stored.
- brief 38 (applications) — the acknowledgement, approve, and reject emails already fire from the server; they need to be re-routed through the template pipeline once this ships.
- brief 41 (enquiries) — same; `enquiry_received` and `enquiry_reply` flavours join the pipeline.
- brief 40 (notifications) — outbound notifications (owners subscribed to `email: true`) get wrapped in the same header/footer.

---

## Base URL — CRM API

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Owner or admin JWT on `club_members` (brief 39 permission: `settings:brand`).

---

## The endpoints

| Method | Path | Auth |
|---|---|---|
| `GET`   | `/clubs/{club_id}/email-template` | admin+ |
| `PATCH` | `/clubs/{club_id}/email-template` | admin+ |
| `GET`   | `/clubs/{club_id}/email-template/preview?flavor={flavor}` | admin+ |
| `POST`  | `/clubs/{club_id}/email-template/test-send` | admin+ |

Public — no unauthed endpoints; the template only ever ships as part of an outgoing email.

---

## 1. Storage

New columns on `clubs_data` (or a `club_email_templates` row per club — either works; the frontend doesn't care):

```
clubs_data.email_header_html      TEXT     NULL
clubs_data.email_footer_html      TEXT     NULL
clubs_data.email_accent_colour    VARCHAR  NULL   -- override for accent tokens if the club wants a different email accent than site
clubs_data.email_font_family      VARCHAR  NULL   -- 'Inter' default, owner can override
clubs_data.email_show_logo        BOOLEAN  DEFAULT TRUE
clubs_data.email_sample_overrides JSON     NULL   -- owner-provided values that override the platform sample-data defaults in the preview
clubs_data.email_updated_at       TIMESTAMP NULL
```

**Size limits**
- `email_header_html`: 20,000 chars.
- `email_footer_html`: 20,000 chars.
- `email_sample_overrides`: 4,000 chars serialised.

Larger → 400 `header_too_long` / `footer_too_long`.

---

## 2. `GET /clubs/{club_id}/email-template`

**200 response** (matches `EmailTemplate` in `packages/api-client/src/resources/emailTemplate.ts`):

```jsonc
{
  "status": "success",
  "data": {
    "header_html": "<div style=\"padding:24px 32px;…\">…{{club_name}}…</div>",
    "footer_html": "<div style=\"padding:32px;…\">…{{unsubscribe_url}}…</div>",
    "accent_colour": null,
    "font_family": null,
    "show_logo": true,
    "sample_overrides": {},
    "variables": [ /* §4 — the server-owned enum of {{tokens}} */ ],
    "updated_at": "2026-08-26T22:14:03Z"
  }
}
```

When the row doesn't exist yet, seed on read with platform defaults (see §6) and return that. Don't require an explicit provisioning step.

---

## 3. `PATCH /clubs/{club_id}/email-template`

Any subset of the writeable fields:

```jsonc
{
  "header_html": "…",
  "footer_html": "…",
  "accent_colour": "#0F5132",
  "font_family": "Space Grotesk",
  "show_logo": true,
  "sample_overrides": { "recipient_first_name": "Sam" }
}
```

**Validation:**

- Size caps per §1.
- HTML parsed with a permissive sanitizer:
  - Allowed tags: `div`, `span`, `p`, `a`, `img`, `strong`, `em`, `br`, `table`, `tr`, `td`, `th`, `tbody`, `thead`, `h1`, `h2`, `h3`, `h4`.
  - Allowed attributes: `href`, `src`, `alt`, `title`, `style`, `width`, `height`, `align`, `valign`, `border`, `cellpadding`, `cellspacing`.
  - `style` attribute passed through (owners paste inline CSS from designers) but with a URL scheme check on `background-image` etc. — reject anything not `https:`.
  - Any `<script>` / `<iframe>` / `<link>` / event handlers (`onclick=` etc.) → 400 `bad_html`.
- Extract every `{{token}}` from both fields and validate against the whitelist (§4). Unknown token → 400 `unknown_variable` with `{"missing":["{{foo}}"]}` in the response body.

**200 response:** the full updated `EmailTemplate` (same shape as GET).

**Errors:**

| HTTP | code | Cause |
|---|---|---|
| 400 | `header_too_long` / `footer_too_long` | Size cap exceeded |
| 400 | `bad_html` | Sanitizer rejected content |
| 400 | `unknown_variable` | One or more `{{tokens}}` not in the whitelist for at least one flavour |
| 400 | `bad_accent` | `accent_colour` not a valid CSS colour |
| 401 / 403 | | Auth |

---

## 4. Variables — server-owned whitelist

Ship as a JS constant in `src/handlers/utils/email-variables.js` (same pattern as brief 22 font-pairs). The GET response includes the same list under `variables[]` so the CRM palette stays in sync without a separate call.

| key | token | category | sample | flavors |
|---|---|---|---|---|
| club_name | `{{club_name}}` | club | Naenae Bowling Club | (all) |
| club_email | `{{club_email}}` | club | hello@naenaebowls.nz | (all) |
| club_phone | `{{club_phone}}` | club | 04 567 5823 | (all) |
| club_address | `{{club_address}}` | club | 25 Vogel Street, Naenae, Lower Hutt | (all) |
| club_logo_url | `{{club_logo_url}}` | club | (empty when no logo) | (all) |
| club_url | `{{club_url}}` | club | https://naenaebowls.torny.co | (all) |
| recipient_name | `{{recipient_name}}` | recipient | Frances Roydon-Miller | (all) |
| recipient_first_name | `{{recipient_first_name}}` | recipient | Frances | (all) |
| recipient_email | `{{recipient_email}}` | recipient | frances@example.co.nz | (all) |
| application_tier | `{{application_tier}}` | context | Playing member | application_received, application_approved, application_rejected |
| event_name | `{{event_name}}` | context | Twilight Triples · Round 3 | broadcast |
| event_date | `{{event_date}}` | context | Friday 10 October 5:30pm | broadcast |
| reply_body | `{{reply_body}}` | context | (admin-authored) | enquiry_reply |
| sign_in_url | `{{sign_in_url}}` | auto | https://naenaebowls.torny.co/sign-in | (all) |
| unsubscribe_url | `{{unsubscribe_url}}` | auto | (opaque token URL) | (all) |
| year | `{{year}}` | auto | 2026 | (all) |

**Flavour scoping** — a token with `flavors: [...]` set is only valid inside header/footer HTML **when at least one supported flavour needs it**. In practice this is permissive: `{{application_tier}}` in the footer is fine because it'll just render empty on non-application flavours (see §7).

---

## 5. `GET /clubs/{club_id}/email-template/preview?flavor={flavor}`

Server-side render for "trust but verify". Returns the fully-substituted HTML + plain-text + subject.

```jsonc
{
  "status": "success",
  "data": {
    "html": "<html>…</html>",
    "text": "Hi Frances,\n\nThanks for your membership application…",
    "subject": "Thanks for applying to Naenae Bowling Club"
  }
}
```

Substitution uses the sample values from §4, overridden by `sample_overrides` from the row. Missing tokens render as empty string, not the literal `{{token}}`.

Flavours accepted:

```
application_received | application_approved | application_rejected
enquiry_received    | enquiry_reply
member_welcome
broadcast
```

Unknown flavour → 400 `bad_flavor`.

---

## 6. Platform defaults (seeded on first GET)

Ship as `PLATFORM_DEFAULT_HEADER` and `PLATFORM_DEFAULT_FOOTER` constants. See the stub in `apps/crm/src/views/settings/SettingsView.vue` (`stubEmailTemplate()`) for the shape — clean typography, club name eyebrow, unsubscribe link in footer.

Seed values:
- `email_show_logo: true`
- `email_sample_overrides: {}`
- `email_accent_colour: null` (inherits `clubs_data.accent_colour`)
- `email_font_family: null` (inherits Inter)

---

## 7. Integration into the send path

Every outgoing club-scoped email routes through a new helper:

```js
async function sendClubEmail({ clubId, flavor, to, body_html, subject, context }) {
  const template = await loadTemplate(clubId);
  const vars = await resolveVariables(clubId, flavor, { to, context });
  const html = wrap(template.header_html, body_html, template.footer_html, vars);
  const text = htmlToText(html);
  return sendgrid.send({ to, subject: substitute(subject, vars), html, text, ... });
}
```

Called from every existing send site:
- brief 38 — `/applications` POST ack, approve email, reject email, notification email to admin.
- brief 41 — `/enquiries` POST ack, `/reply` email.
- brief 29 — invite email, welcome email.
- brief 40 — per-user email notifications.

**Body content stays in code** — this brief doesn't let owners edit the transactional bodies. Only the wrapping frame + variables. Broadcast (brief 46 later) will let owners write bodies with `{{tokens}}`.

**Missing variables** render as empty string, not `[UNDEFINED]` or the literal token. That way a `{{application_tier}}` reference in the footer doesn't break the welcome-email render.

---

## 8. `POST /clubs/{club_id}/email-template/test-send`

Send a real email to the caller's own email (or a specified `to` when the caller has `settings:brand`) using the current draft OR the saved template. Includes a `[TEST]` prefix on the subject.

**Body:**
```jsonc
{
  "flavor": "application_received",
  "to": "owner@example.co.nz"      // optional — defaults to the caller's user.email
}
```

**200 response:**
```jsonc
{
  "status": "success",
  "data": {
    "sent": true,
    "to": "owner@example.co.nz",
    "provider_message_id": "sg-01H…"
  }
}
```

**Rate limit:** 3 test sends per hour per club (across all owners). 4th → 429 `rate_limited` with `retry_after_ms` in body.

**Errors:**
- `400 bad_flavor` — unknown flavour slug.
- `400 bad_email` — malformed `to`.
- `429 rate_limited` — 3 already sent this hour.
- `500 send_failed` — SendGrid rejected; response includes provider error message in `data.provider_error`.

---

## 9. Frontend contract summary

- `packages/api-client/src/resources/emailTemplate.ts` — already shipped. Four functions (`get`, `update`, `preview`, `testSend`).
- Settings → Email template tab renders headers + footers + variable palette + live preview using the same substitution algorithm as the server (`sample` per variable, `sample_overrides` on top). Once this brief ships, the CRM will refresh its `variables[]` from the GET response instead of the client-side stub — no additional wiring needed.
- Send-path integration is invisible to the CRM — owner just sees their design apply to every real email from that point on.

---

## 10. Verification (please attach outputs)

- ✓ First GET seeds defaults + returns 200 with populated `variables[]`.
- ✓ PATCH with a `<script>` tag in `header_html` → 400 `bad_html`.
- ✓ PATCH with `{{foo}}` (not in whitelist) → 400 `unknown_variable`, missing: `["{{foo}}"]`.
- ✓ PATCH with a 25kb `header_html` → 400 `header_too_long`.
- ✓ PATCH with `accent_colour: "not-a-colour"` → 400 `bad_accent`.
- ✓ PATCH with valid update → 200, GET reflects change.
- ✓ Preview with `flavor: application_received` → substituted subject + html + text.
- ✓ Preview with `flavor: cornflower` → 400 `bad_flavor`.
- ✓ Preview when `{{application_tier}}` appears in footer + flavour is `member_welcome` → renders as empty string, no error.
- ✓ Test-send happy path → 200, email arrives with `[TEST]` prefix on subject.
- ✓ 4 test sends in an hour → 4th is 429 `rate_limited`.
- ✓ Real POST `/applications` after PATCH → outgoing ack email uses the new header/footer, `[TEST]` prefix absent, all `{{tokens}}` substituted.
- ✓ Auth: non-admin → 403 on every endpoint.

---

## 11. Non-goals (v1)

- **No per-flavour body override.** Owner controls the frame; the body stays in code. Broadcast composer (brief 46) will handle owner-written bodies.
- **No conditional blocks / logic.** No `{{#if …}} … {{/if}}` for now. If we need it, add later — the frontend + server substitution is a single-pass simple replace today.
- **No inline attachment support.** Attachments stay a per-flavour concern in code.
- **No multi-language templates.** English only for v1.
- **No visual (WYSIWYG) editor.** Raw HTML editor with a Restore-defaults button covers v1. Rich editing is a later brief.

---

## 12. Contact

Same as prior briefs. If a new outgoing email lands (e.g. `enquiry_forwarded_to_committee`), add a new `EmailFlavor` slug and add its subject + body to the send-path helper, plus any variables it needs to `email-variables.js`. Coordinate the frontend `EMAIL_FLAVORS` constant so the preview picker shows it too.
