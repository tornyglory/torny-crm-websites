# Approve-into-season + Customisable welcome email

**Feature:** when an admin approves a membership application the CRM now lets them (1) pick which **season** the resulting membership attaches to — the current one by default, but a future one when the club is already taking "next-season" applications — and (2) **customise the welcome email** that goes out to the new member. The customisation is per-approval: a short subject override and a personal message from the committee that renders above the sign-in CTA. The default (unchanged subject + body in code) stays polished.

**Status:** frontend shipped in this change. The modal reads the club's seasons via `GET /clubs/:cid/seasons` (brief 55 / members list brief) and sends two new optional fields on the approve POST. Until this brief ships, the server should accept the fields and ignore them so no FE change is needed when backend lands — but the behaviour (attach-to-season and personalise) only works once this brief is live.

**Related briefs:**
- brief 38 (membership applications) — owning brief. §4 approve body is extended here with two new keys.
- brief 45 (email templates) — adds a per-club `application_approved` flavour wrapper around the body. This brief adds two new tokens (`{{personal_message}}`, `{{season_name}}`) and the per-approval overrides.
- brief 55 (payment season attribution) — mirror shape. `season_id` on approve resolves exactly the same way: omitted → current season; explicit → validated against `club_seasons`.
- brief 29 (roster) — approval still runs through the same link / invite / stub resolution. Season just picks which `club_memberships` row (or season-scoped billing attachment) the new membership points at.

---

## Base URL — CRM API

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Owner or admin JWT (same auth as brief 38).

---

## 1. `POST /clubs/{club_id}/applications/{application_id}/approve` — extended body

Two new optional keys bolted onto the existing shape (brief 38 §4):

```jsonc
{
  "resolution": "auto",         // unchanged — auto | link | invite | stub
  "user_id": null,              // unchanged
  "assigned_number": null,      // unchanged
  "send_welcome_email": true,   // unchanged

  // NEW — season this membership attaches to.
  // Omit or null → attach to the club's current season (same default as brief 55 recordPayment).
  // Explicit id → validate against club_seasons.season_id for this club.
  "season_id": 42,

  // NEW — per-approval overrides for the welcome email body + subject.
  // Null / absent → use the platform default (same body in code as today).
  // Both fields are optional on their own; either may be set without the other.
  "welcome_email": {
    "subject": "Welcome to Naenae Bowling Club, Frances!",   // nullable, max 140 chars
    "message": "Looking forward to seeing you at the opening-day roll-up on Saturday. — Peter"   // nullable, max 800 chars
  }
}
```

**Fields:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `season_id` | `integer \| null` | no | Attaches the resulting membership to the given season. Must belong to this club. Null / absent → club's current season. |
| `welcome_email.subject` | `string \| null` | no | Overrides the default subject (`Welcome to {{club_name}}, {{recipient_first_name}}!`). Tokens from the brief 45 whitelist resolve as normal. Max 140 chars after trim. |
| `welcome_email.message` | `string \| null` | no | Admin-authored personal note. Rendered as a short paragraph above the sign-in CTA. Max 800 chars after trim. Preserves single line-breaks as `<br>`; double line-breaks become `<p>` boundaries. Tokens from the whitelist resolve. |

**Behaviour:**

- When `send_welcome_email` is `false`, `welcome_email` is silently ignored (no body validation runs). We don't need to error — the admin opted out of sending.
- When `send_welcome_email` is `true` and `welcome_email` is `null` / absent, the server sends the default `application_approved` flavour as it does today.
- When `welcome_email.subject` is set but empty after trim → treat as if absent (fall back to default). Same for `.message`.
- `season_id` is persisted on the created `club_memberships` row (or whatever the brief-55 season-attribution schema calls it — same column used by `recordPayment`). The approval **does not** backdate / forward-fire billing — it just records which season the membership belongs to. Billing already handles "future season memberships" via the season's `start_date` (brief 55 §3).

**Response** — unchanged shape (brief 38 §4), with one echo added:

```jsonc
{
  "status": "success",
  "data": {
    "application_id": 4177,
    "status": "approved",
    "resolution": "linked",
    "linked_user_id": 912,
    "membership_id": 7731,
    "season_id": 42,                       // NEW — echo so the CRM can confirm which season it landed in
    "season_name": "2026/27 Summer",       // NEW — same (saves a round-trip)
    "invite": null,
    "email_status": { "sent": true }
  }
}
```

**New errors:**

| HTTP | code | Cause |
|---|---|---|
| 400 | `unknown_season` | `season_id` doesn't exist for this club. |
| 400 | `welcome_subject_too_long` | Subject >140 chars after trim. |
| 400 | `welcome_message_too_long` | Message >800 chars after trim. |

All existing error codes (`already_approved`, `already_rejected`, `email_exists`, `bad_link`, …) stay unchanged.

---

## 2. Welcome email — body + flavour

The `application_approved` flavour from brief 45 §5 already exists as a template *wrapper* (header + footer HTML, per-club). This brief defines the **body** that goes between them. Body stays in code (brief 45 §7 "Body content stays in code") so clubs can't accidentally break the sign-in CTA.

### 2a. Default subject

```
Welcome to {{club_name}}, {{recipient_first_name}}!
```

When the admin passes `welcome_email.subject`, that string replaces this default (still runs through the whitelist substitution).

### 2b. Default body skeleton

Design intent: feels like one person wrote it, not a transactional template. Opens with a greeting, confirms what they're in for (tier + season), carries the personal note if present, then one clear CTA. Readable on mobile.

```html
<p style="font-family: {{font_body}}; font-size: 15px; line-height: 1.6; color: #1C1C19; margin: 0 0 16px;">
  Hi {{recipient_first_name}},
</p>

<p style="font-family: {{font_body}}; font-size: 15px; line-height: 1.6; color: #1C1C19; margin: 0 0 16px;">
  Your application to <strong>{{club_name}}</strong> has been approved — welcome aboard.
  You're joining as a <strong>{{application_tier}}</strong> member for the <strong>{{season_name}}</strong> season.
</p>

<!-- {{#if personal_message}} — single-pass render, so emit the block only when the token resolves non-empty -->
<div style="padding: 16px 18px; margin: 0 0 20px; background: #F5F5F2; border-left: 3px solid {{accent_colour}}; border-radius: 6px;">
  <div style="font-family: {{font_mono, 'JetBrains Mono', monospace}}; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #A3A39B; margin-bottom: 6px;">
    A note from the committee
  </div>
  <div style="font-family: {{font_body}}; font-size: 14px; line-height: 1.55; color: #1C1C19; white-space: pre-line;">
    {{personal_message}}
  </div>
</div>
<!-- {{/if}} -->

<p style="font-family: {{font_body}}; font-size: 15px; line-height: 1.6; color: #1C1C19; margin: 0 0 24px;">
  <!-- Variant switches on resolution — see §2c. -->
  {{approved_cta_lead}}
</p>

<p style="margin: 0 0 32px;">
  <a href="{{sign_in_url}}"
     style="display: inline-block; padding: 12px 22px; background: #1C1C19; color: #FFFFFF; border-radius: 999px; font-family: {{font_body}}; font-size: 14px; font-weight: 600; text-decoration: none;">
    {{approved_cta_label}}
  </a>
</p>

<p style="font-family: {{font_body}}; font-size: 13px; line-height: 1.6; color: #6A6A5F; margin: 0;">
  See you on the green soon.<br />
  The {{club_name}} team
</p>
```

The outer wrapper (header + footer) is still owned by brief 45 — this brief doesn't touch it.

### 2c. Resolution-dependent lines

Two tokens change based on how the approval resolves. Compute server-side and inject before substitution:

| Resolution | `{{approved_cta_lead}}` | `{{approved_cta_label}}` |
|---|---|---|
| `linked` / `relinked` / `already_member` | "You're all set — sign in to see your membership, pay dues, and manage your details." | "Sign in" |
| `invited` | "Click the button below to accept the invite and finish setting up your account. The link expires in 7 days." | "Accept invite" |
| `stub_created` | "We've set up a profile for you — the committee will email you your sign-in details separately." | "Visit the club" (link → `{{club_url}}`) |

Where `stub_created` lands, swap `{{sign_in_url}}` on the button href for `{{club_url}}` in the substitution pass. All other flavours keep `{{sign_in_url}}`.

### 2d. New tokens — add to the brief 45 §4 whitelist

| key | token | category | sample | flavors |
|---|---|---|---|---|
| season_name | `{{season_name}}` | context | 2026/27 Summer | application_approved, member_welcome |
| personal_message | `{{personal_message}}` | context | (admin-authored, nullable) | application_approved |
| approved_cta_lead | `{{approved_cta_lead}}` | auto | "You're all set — sign in to see…" | application_approved |
| approved_cta_label | `{{approved_cta_label}}` | auto | "Sign in" | application_approved |

Server resolves `{{personal_message}}` from `welcome_email.message` on the request, HTML-escaped and with line-break normalisation (`\n` → `<br>`, `\n\n+` → `</p><p>` boundaries). Empty → the whole `<div class="committee-note">` block is omitted (single-pass render; brief 45 §7 "Missing variables render as empty string" means an untreated `{{personal_message}}` would just leave an empty callout box, which is why the server strips the wrapper when the value is empty).

### 2e. Preview flavour

The `GET /clubs/:cid/email-template/preview?flavor=application_approved` endpoint from brief 45 §5 already supports this flavour. It should fill `{{personal_message}}` from `email_sample_overrides.personal_message` (defaulting to "Looking forward to seeing you at the opening-day roll-up on Saturday. — Peter") and `{{season_name}}` from the club's current season name, so owners can see the full rendered email in Settings → Email template.

---

## 3. The approve request flow — step by step

1. Admin opens the Approve modal on `/crm/applications/:id`.
2. Modal fetches `GET /clubs/:cid/seasons` once per session (cached) and shows "Current — {name}" as the default, with every other season (past + future) listed.
3. Admin optionally picks a different season.
4. Admin optionally clicks "Customise" on the welcome-email block to override subject + add a personal note. The in-modal preview updates to show what the recipient will see.
5. Submit → `POST /clubs/:cid/applications/:id/approve` with the extended body (§1).
6. Server:
   - Validates `season_id` against `club_seasons` for this club (if present).
   - Validates `welcome_email.subject` / `.message` length (if `send_welcome_email` is true and the fields are set).
   - Runs the existing link / invite / stub resolution (brief 29).
   - Creates the `club_memberships` row with the resolved `season_id` (defaulting to the club's current).
   - If `send_welcome_email`, renders the `application_approved` body with `{{personal_message}}` + `{{season_name}}` + resolution-dependent CTA tokens, wraps in the club's template (brief 45), sends via SendGrid, records `email_status`.
   - Flips the application row to `status=approved`, sets `reviewed_at` + `reviewer_user_id`.
7. Response echoes `season_id` + `season_name` + `email_status` so the CRM can confirm the right outcome before routing back to the list.

---

## 4. Edge cases + Non-goals

**Edge cases to confirm:**

- **Future-season approval + current invoicing.** A membership attached to a season that hasn't started yet should still produce the right invoice timing. If brief 55 billing uses `season.start_date` to defer the first invoice, no change needed here. Please verify with a season starting in 60 days — the invoice should not fire today.
- **Approving into a past season.** Allowed (same as back-dating a payment in brief 55) but the server should **not** auto-send a welcome email that references a past season. Suggest: still send the email when the toggle is on, but swap `{{season_name}}` for the current season in the subject + body so the greeting still reads right. Or: silently flip `send_welcome_email` off and return `email_status: { skipped: true, reason: "past_season" }`. Preference: the second — fewer surprises.
- **`personal_message` with user-supplied HTML.** Treat as plain text — HTML-escape before substitution. Line breaks are the only formatting we honour. No links, no bold. Keeps the committee from accidentally embedding broken markup.
- **`welcome_email.subject` with newlines.** Strip them server-side (replace with spaces) and trim before length validation. Mail clients hate newlines in subject lines.
- **Rate limits.** Approval is not high-frequency and is admin-authed, so no new per-approval limit. The brief 45 §8 test-send rate limit still applies to the Settings preview flow; nothing to add here.

**Non-goals (v1):**

- No per-tier welcome email variants. One body, resolution-dependent CTA only. If clubs want "different email per tier" we add it as a tier-level override later.
- No scheduled-send on approval. The welcome fires immediately on approve.
- No committee-signature field. The admin can type the sign-off into `personal_message` instead.
- No "Save this message as the default" button. Per-approval only in v1. Once we have usage patterns we'll know whether a per-club "standard welcome note" field earns its keep.
- No HTML composer in the modal. Textarea only — the goal is a short committee note, not a rich-text newsletter.

---

## 5. Frontend contract

- `packages/api-client/src/resources/applications.ts` — `ApproveInput` extended with `season_id?: number | null` and `welcome_email?: { subject?: string | null; message?: string | null } | null`. Also added error codes `unknown_season`, `welcome_subject_too_long`, `welcome_message_too_long`.
- `apps/crm/src/views/applications/ApplicationDetailView.vue` — Approve modal now:
  - Fetches `seasons.list(clubId)` on first open.
  - Shows a Season dropdown defaulting to "Current — {name}", with a hint when a future season is picked.
  - Shows a Welcome email block when "Send welcome email" is on: default view = subject + preview line; Customise view = subject override input + personal message textarea with hint "Appears above the sign-in button in the welcome email".
  - Submits both fields; omits `welcome_email` entirely when the toggle is off or the customise form is empty.

---

## 6. Verification (please attach outputs)

- ✓ Approve with `season_id` omitted → attaches to current season; response echoes current `season_id` + `season_name`.
- ✓ Approve with explicit `season_id` for a future season → row attaches to it; CRM membership list filtered to that season shows the new row.
- ✓ Approve with `season_id` from a different club → 400 `unknown_season`.
- ✓ Approve with `welcome_email.subject` of 141 chars → 400 `welcome_subject_too_long`.
- ✓ Approve with `welcome_email.message` of 801 chars → 400 `welcome_message_too_long`.
- ✓ Approve with `send_welcome_email: false` + a `welcome_email` body → body ignored, no email sent, 200.
- ✓ Approve with `send_welcome_email: true` + `welcome_email.message: "Great to have you!"` → delivered email contains a styled "A note from the committee" block with that text, placed above the sign-in CTA.
- ✓ Approve with `send_welcome_email: true` + `welcome_email` absent → delivered email omits the committee-note block entirely (no empty callout).
- ✓ Approve with `resolution: "invite"` → CTA button reads "Accept invite" + lead copy mentions "7 days".
- ✓ Approve with `resolution: "stub"` → CTA button reads "Visit the club", href is `club_url`.
- ✓ Preview endpoint with `flavor: application_approved` + `sample_overrides.personal_message` set → rendered HTML includes the committee-note block.
- ✓ Non-admin approve → 403 (unchanged from brief 38).

---

## 7. Contact

Frontend: this working directory. Ping if the response shape needs tweaking before deploy — the Approve modal already handles the new fields with graceful fallbacks.
