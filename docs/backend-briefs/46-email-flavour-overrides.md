# Email Templates — Per-flavour Subject + Body Overrides

**Feature:** owners can edit the subject line and body HTML of each transactional email flavour (`application_received`, `application_approved`, `application_rejected`, `enquiry_received`, `enquiry_reply`, `member_welcome`, `broadcast`). Same shared header/footer as brief 45; only the middle "body" section becomes editable per flavour. Falls back to platform defaults when no override is set.

**Status:** CRM Settings → Email template tab already renders header/footer editing (brief 45). Frontend for per-flavour body editing is queued behind this brief. Owners currently see the flavour picker in the preview but can't edit the body; the copy is baked into `preview-club-email-template/index.js` and `test-send-club-email-template/index.js`.

**Related briefs:**
- brief 45 (email templates) — parent brief. This one extends the same resource with per-flavour subject + body overrides.
- brief 38 (applications), brief 41 (enquiries), brief 40 (notifications), brief 29 (invites) — every existing sender is already routed through `sendClubEmail` per brief 45 §7. Once this brief ships, the send-path reads overrides from the new store before falling back to code defaults.

---

## Base URL — CRM API

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Owner or admin JWT on `club_members` (brief 39 permission: `settings:brand`).

---

## The endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET`   | `/clubs/{club_id}/email-template/flavors` | admin+ | list all flavours with default + override for each |
| `PATCH` | `/clubs/{club_id}/email-template/flavors/{flavor}` | admin+ | edit subject and/or body for one flavour |
| `DELETE` | `/clubs/{club_id}/email-template/flavors/{flavor}` | admin+ | clear all overrides for one flavour (return to defaults) |

The existing `GET /email-template/preview?flavor={flavor}` and `POST /email-template/test-send` from brief 45 stay as-is — they just start reading overrides at render time (see §5).

---

## 1. Storage

New table:

```
club_email_flavour_overrides
├── id                    INT       PK
├── club_id               INT       FK → clubs_data.id
├── flavor                VARCHAR   -- 'application_received' | 'application_approved' | …
├── subject_override      VARCHAR   NULL   -- null = use platform default
├── body_html_override    TEXT      NULL   -- null = use platform default
├── updated_at            TIMESTAMP
├── updated_by            INT       FK → users.id
└── UNIQUE (club_id, flavor)
```

One row per (club, flavor) pair. Rows only get created on first PATCH — missing row = using platform defaults for both fields.

Alternative shape (open to it if simpler): a JSON column on `clubs_data.email_flavour_overrides` keyed by flavour slug. The frontend doesn't care as long as GET returns the shape below.

---

## 2. `GET /clubs/{club_id}/email-template/flavors`

Returns every flavour, whether or not it has an override. Frontend sorts them for the picker.

**200 response:**
```jsonc
{
  "status": "success",
  "data": {
    "flavors": [
      {
        "flavor": "application_received",
        "label": "Application received",
        "hint": "Applicant's acknowledgement email after they submit the join form",
        "subject_default":     "Thanks for your application to {{club_name}}",
        "subject_override":    null,
        "body_html_default":   "<p>Hi {{recipient_first_name}},</p><p>Thanks for your membership application…</p>",
        "body_html_override":  null,
        "supported_tokens":    ["club_name", "recipient_first_name", "application_tier", "sign_in_url", …],
        "updated_at":          null,
        "updated_by":          null
      },
      // …one row per flavour (7 total per §4 of brief 45)
    ]
  }
}
```

Notes:
- `subject_default` / `body_html_default` are the current server-side hardcoded copy — the same strings `preview-club-email-template/index.js` uses today. The frontend renders these in the editor as the "reset to" placeholder so owners can see what they're replacing.
- `subject_override` / `body_html_override` are `null` until the owner saves an override.
- `supported_tokens` is the subset of the brief 45 whitelist that's flavour-appropriate — same filtering rule the CRM palette already uses. Frontend uses this to show only relevant tokens in the "insert token" list.
- `label` and `hint` are UI copy the CRM uses in the flavour picker — owned by the backend so the wording stays consistent across CRM + docs.

---

## 3. `PATCH /clubs/{club_id}/email-template/flavors/{flavor}`

**Body (partial — send only the fields you want to change):**
```jsonc
{
  "subject_override":   "Welcome to {{club_name}} — see you Saturday",
  "body_html_override": "<p>Hi {{recipient_first_name}},</p><p>Your application has been approved…</p>"
}
```

**Explicit `null` clears the override for that field:**
```jsonc
{
  "subject_override": null
}
```

**200 response:** the full updated flavour row (same shape as one element of §2's `flavors[]`).

**Path validation:**
- `flavor` must be one of the 7 known slugs; unknown → 400 `bad_flavor`.

**Body validation:**

| HTTP | code | Cause |
|---|---|---|
| 400 | `subject_too_long` | `subject_override` > 200 chars |
| 400 | `body_too_long` | `body_html_override` > 20,000 chars (same limit as header/footer) |
| 400 | `bad_html` | Sanitizer rejected body — same rules as brief 45 §3 (returns `ctx.tag/attr/value`) |
| 400 | `unknown_variable` | Body or subject references a token not in this flavour's `supported_tokens`. Body carries `missing: ["{{foo}}", …]` |
| 400 | `empty_subject` | `subject_override === ""` (send `null` to clear instead) |
| 400 | `empty_body` | `body_html_override === ""` (send `null` to clear instead) |
| 403 | | Caller lacks `settings:brand` |
| 404 | `not_found` | Club doesn't exist |

**Sanitizer** — same allowlist as brief 45 §3. Reuse `email-render.js`.

**Variable whitelist** — same 16 tokens as brief 45 §4. Flavour scoping is enforced strictly here (unlike header/footer which is advisory): a body using `{{application_tier}}` in `member_welcome` returns 400 `unknown_variable` with `missing: ["{{application_tier}}"]`. This is stricter than header/footer because a per-flavour body has no reason to reach for cross-flavour context.

---

## 4. `DELETE /clubs/{club_id}/email-template/flavors/{flavor}`

Clears both subject and body overrides in one call. Row can either be deleted or left with both columns nulled — frontend can't tell the difference.

**204 response** (no body).

**Errors:** same as PATCH (bad flavor, not found, forbidden).

Convenience over sending two separate `null` PATCHes.

---

## 5. Send-path integration

Every existing sender per brief 45 §7 already routes through `sendClubEmail`. Extend that helper to:

1. Load the (club, flavor) row from `club_email_flavour_overrides`.
2. Use `subject_override` if non-null, else the platform default from `preview-club-email-template/index.js`.
3. Use `body_html_override` if non-null, else the platform default.
4. Everything downstream (header/footer wrap, variable substitution, sanitization, SES send) stays identical.

**Preview endpoint** (`GET /email-template/preview?flavor=…`) reads overrides the same way.

**Test-send endpoint** (`POST /email-template/test-send`) reads overrides the same way. That way "Send test to me" from the CRM previews the actual override the recipient will see.

**Behaviour when a partial override exists** (e.g. subject overridden but body isn't): the overridden field wins, the other field falls back to the default. Common case: owner tweaks the subject but keeps the copy.

---

## 6. Sample defaults

The 7 default subject + body strings currently live in `preview-club-email-template/index.js`. Move them into a single exported constant (`PLATFORM_DEFAULT_FLAVORS`) so:
1. Both `preview-club-email-template/index.js` and `sendClubEmail` read from the same source.
2. The GET `/flavors` endpoint exposes them as `subject_default` / `body_html_default`.
3. When platform copy changes (typo, tone tweak), it changes in one place.

Frontend never patches these defaults — they're read-only. Owners edit *overrides*.

---

## 7. TypeScript types the frontend expects

```ts
export type EmailFlavor =
  | 'application_received'
  | 'application_approved'
  | 'application_rejected'
  | 'enquiry_received'
  | 'enquiry_reply'
  | 'member_welcome'
  | 'broadcast'

export interface EmailFlavorRow {
  flavor: EmailFlavor
  label: string
  hint: string
  subject_default: string
  subject_override: string | null
  body_html_default: string
  body_html_override: string | null
  supported_tokens: string[]  // token keys (not full {{tokens}} form)
  updated_at: string | null
  updated_by: number | null
}

export interface EmailFlavorPatch {
  subject_override?: string | null
  body_html_override?: string | null
}

export interface EmailFlavorsResponse {
  flavors: EmailFlavorRow[]
}

export type EmailFlavorErrorCode =
  | 'bad_flavor'
  | 'subject_too_long'
  | 'body_too_long'
  | 'empty_subject'
  | 'empty_body'
  | 'bad_html'
  | 'unknown_variable'
```

Sanitizer error shape reuses brief 45 §3 (`ctx: { tag, attr, value }`).

Unknown-variable error shape reuses brief 45 §2 (`missing: ["{{foo}}", …]`).

---

## 8. Frontend contract summary

```
GET   /clubs/{club_id}/email-template/flavors                        → EmailFlavorsResponse
PATCH /clubs/{club_id}/email-template/flavors/{flavor}   ← patch    → EmailFlavorRow
DELETE /clubs/{club_id}/email-template/flavors/{flavor}              → 204
```

Frontend behaviour:
- On mount + club change: GET the collection.
- CRM Settings → Email template tab grows a "Body copy" section with a flavour picker on the left and a subject + body_html editor on the right.
- Each flavour has its own buffered draft (same Discard/Save pattern as header/footer). Save PATCHes just that flavour.
- A "Reset to platform default" button per flavour DELETEs the overrides for that flavour and re-fetches.
- Preview iframe (existing) reflects overrides on next render because the server preview endpoint already reads them (§5).
- Test-send button (existing) uses overrides too.

---

## 9. Verification (please attach outputs)

- ✓ GET returns 7 flavours, each with defaults populated and overrides nullable.
- ✓ PATCH with new subject + body — both round-trip on subsequent GET.
- ✓ PATCH with `subject_override: null` — clears just the subject, body override stays.
- ✓ PATCH with body containing `<script>` → 400 `bad_html` with `ctx.tag: "script"`.
- ✓ PATCH member_welcome body with `{{application_tier}}` → 400 `unknown_variable` with `missing: ["{{application_tier}}"]`.
- ✓ PATCH with `body_html_override: ""` → 400 `empty_body`.
- ✓ PATCH body > 20,000 chars → 400 `body_too_long`.
- ✓ DELETE clears both overrides; subsequent GET shows both `null`.
- ✓ `/preview?flavor=X` renders override body when present, default when not.
- ✓ Test-send emails the overridden body when present.
- ✓ Bad flavor slug → 400 `bad_flavor`.
- ✓ Non-admin caller → 403.

---

## 10. Non-goals (v1)

- No per-locale overrides. English only.
- No per-flavour attachment support.
- No conditional blocks (`{{#if …}}`), no loops. Same as brief 45.
- No "schedule this override to go live at X" — overrides apply immediately on save.
- No version history / undo. If you want a revert path, DELETE-to-defaults is the escape hatch.
- No preview delivery to specific real recipients (test-send always goes to the caller — same as brief 45 §6).

---

## 11. Contact

Same as prior briefs. If a new flavour lands (e.g. `enquiry_forwarded_to_committee`), add its slug + default subject + default body to `PLATFORM_DEFAULT_FLAVORS`. GET will surface it automatically, PATCH accepts it once it's in the enum.
