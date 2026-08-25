# Membership Applications

**Feature:** the public join form on `/join` (or wherever an owner drops the new `membershipJoinForm` block) POSTs an application to the club. The CRM's Enquiries screen gains an "Applications" tab so the membership committee can triage.

**Status:** frontend shipped 2026-08-26 (block + CRM palette entry + config panel). Awaiting backend to make the POST route real. Until then the block surfaces a friendly "applications aren't open yet — email the club" message on 404.

**Related briefs:**
- brief 36 (membership tiers) — the applicant picks a tier from `membership_types` by `id`.
- brief 35 (public members) — once approved, the applicant becomes a `club_member` row with `position_group='member'`.
- brief 29 (roster) — approval flow reuses the same "add member" path (link / invite / stub).

---

## Base URL — CRM API

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Public POST — no auth. Rate-limited by IP (target: 5 submissions per hour per IP per club to defeat spam).

The CRM inbox endpoints are owner/admin only.

---

## The endpoints

| Method | Path | Auth |
|---|---|---|
| `POST`   | `/public/clubs/{slug}/applications` | none (public) |
| `GET`    | `/clubs/{club_id}/applications` | owner+ / admin+ |
| `GET`    | `/clubs/{club_id}/applications/{application_id}` | owner+ / admin+ |
| `POST`   | `/clubs/{club_id}/applications/{application_id}/approve` | owner+ / admin+ |
| `POST`   | `/clubs/{club_id}/applications/{application_id}/reject` | owner+ / admin+ |
| `POST`   | `/clubs/{club_id}/applications/{application_id}/notes` | owner+ / admin+ |

---

## 1. `POST /public/clubs/{slug}/applications`

Body (what the frontend sends today — all fields present unless marked optional):

```jsonc
{
  "tier_id": 12,                       // OR null if the club has no tiers configured. Validate against membership_types.
  "full_name": "Frances Roydon-Miller",
  "preferred_name": "Fran",            // nullable
  "dob": "1962-07-14",                 // ISO date, YYYY-MM-DD
  "email": "frances.rm@example.co.nz",
  "mobile": "021 483 610",
  "address": {
    "street": "14A Salamanca Road",
    "suburb": "Kelburn, Wellington",
    "postcode": "6012",
    "country": "New Zealand"           // nullable
  },
  "bowls": {
    "experience": "social",            // never | social | club | pennant
    "bowls_number": null,              // nullable free-text
    "position": "second",              // lead | second | third | skip | no_preference
    "playing_days": ["tue", "thu", "fri", "sat"]   // subset of mon..sun
  },
  "emergency_contact": {
    "name": "Peter R-M",
    "phone": "021 000 000",
    "relationship": "Partner"          // nullable
  },
  "note": "Left knee — can’t play skips.",   // nullable
  "referrer": "A club member — Peter R-M",       // nullable
  "consent": {
    "terms": true,                     // MUST be true
    "newsletter": true,
    "photo": false
  }
}
```

**200 response:**
```jsonc
{
  "status": "success",
  "data": {
    "application_id": 4177,
    "status": "pending",
    "received_at": "2026-08-26T22:14:03Z"
  }
}
```

**Errors:**

| HTTP | code | Cause |
|---|---|---|
| 400 | `missing_required` | Any of tier_id / full_name / email / mobile / dob / address.street / address.suburb / address.postcode / emergency_contact.name / emergency_contact.phone missing |
| 400 | `bad_email` | Email doesn't parse |
| 400 | `bad_dob` | DOB isn't a valid ISO date, or is in the future |
| 400 | `unknown_tier` | tier_id doesn't exist on this club (or belongs to another club) |
| 400 | `consent_required` | consent.terms is false |
| 404 | `unknown_club` | slug doesn't resolve |
| 429 | `rate_limited` | Too many applications from this IP for this club |
| 503 | `applications_closed` | Owner has disabled applications via a settings flag (see §5) |

Store the raw JSON payload as a `payload_json` column on the applications row so we can evolve the shape without a schema change.

---

## 2. `GET /clubs/{club_id}/applications` — CRM inbox

Owner or admin. Returns a paginated list for the CRM Applications tab.

**Query params:**
- `status` (optional) — `pending | approved | rejected | all`. Default: `pending`.
- `search` (optional) — matches full_name / email / mobile.
- `limit` (default 20) / `offset` (default 0).
- `sort` (default `newest`) — `newest | oldest`.

**200 response:**
```jsonc
{
  "status": "success",
  "data": {
    "applications": [
      {
        "id": 4177,
        "status": "pending",
        "full_name": "Frances Roydon-Miller",
        "preferred_name": "Fran",
        "email": "frances.rm@example.co.nz",
        "mobile": "021 483 610",
        "tier_id": 12,
        "tier_name": "Playing member",
        "experience": "social",
        "position": "second",
        "playing_days": ["tue","thu","fri","sat"],
        "referrer": "A club member — Peter R-M",
        "received_at": "2026-08-26T22:14:03Z",
        "reviewed_at": null,
        "reviewer_user_id": null,
        "note_count": 0
      }
    ],
    "counts": { "pending": 3, "approved": 41, "rejected": 2 },
    "pagination": { "limit": 20, "offset": 0, "total": 46 }
  }
}
```

---

## 3. `GET /clubs/{club_id}/applications/{application_id}` — detail view

Same shape as the list row, plus:
- `dob` (ISO)
- `address` object (street / suburb / postcode / country)
- `bowls` object (experience / bowls_number / position / playing_days)
- `emergency_contact` object
- `note` (from the applicant)
- `consent` object
- `notes[]` — internal notes added by admins, each `{ id, body, author_user_id, author_name, created_at }`.

---

## 4. Approve / reject / note

**`POST /clubs/{club_id}/applications/{application_id}/approve`** — creates a `club_members` row via the same path as `POST /clubs/{club_id}/members` (link / invite / stub). Body:
```jsonc
{
  "resolution": "auto",     // auto | link | invite | stub  — same values brief 29 accepts
  "user_id": null,          // required when resolution=link
  "assigned_number": null,  // optional membership number
  "send_welcome_email": true
}
```
Returns the same shape as brief 29's add-member success (so the CRM can slot the row straight into the roster). Application row flips to `status=approved`, `reviewed_at`, `reviewer_user_id`.

**`POST /clubs/{club_id}/applications/{application_id}/reject`** — body `{ "reason": "unable_to_verify" | "duplicate" | "spam" | "other", "message": "…optional note back to applicant…" }`. Sends an email only if `message` is set. Row flips to `status=rejected`.

**`POST /clubs/{club_id}/applications/{application_id}/notes`** — body `{ "body": "..." }`, returns the newly-created note. Notes stay internal — never emailed.

---

## 5. Owner settings

Two new fields on `/clubs/{club_id}/settings` → `membership`:
```jsonc
{
  "membership": {
    "…": "existing (cadence, first_year_discount, tiers)",
    "applications_open": true,               // NEW — when false, POST returns 503 applications_closed
    "application_notification_email": null   // NEW — override the default (owner email) recipient for new-application emails
  }
}
```
Corresponding PATCH goes on the existing membership settings endpoint (brief 36 §2 — same shape, just two more optional keys).

---

## 6. Emails

- **On submit** — the applicant gets a friendly acknowledgement referencing their tier + expected turnaround. Also an email to `application_notification_email` (or the owner) with a link into the CRM Applications tab.
- **On approve** — welcome email (existing invite template if `resolution=invite`, otherwise a simpler "you're in" note).
- **On reject** — only if `message` is set. Plain text.

---

## 7. Verification

- ✓ Public POST with a valid payload returns 200 + `application_id`
- ✓ Row visible in `GET /clubs/{id}/applications?status=pending`
- ✓ Approve → new roster row + application `status=approved` + `reviewed_at`
- ✓ Reject with no message → 200, no email sent
- ✓ Reject with `message="Sorry, ..."` → 200, email sent
- ✓ Missing required field → 400 `missing_required`
- ✓ `consent.terms=false` → 400 `consent_required`
- ✓ Unknown tier / unknown club → 400 / 404
- ✓ Rate limit — 6th submission in an hour from same IP → 429
- ✓ `applications_open=false` → 503 `applications_closed`
- ✓ Non-admin GET → 403
- ✓ Payload persisted intact — a later schema change can add fields without migrating history

---

## 8. Non-goals

- No payment collection at application time — the tier fee is collected on approval via the existing invoicing flow.
- No public "check my application status" endpoint — applicants find out via email.
- No file uploads (proof of address / photo ID) — clubs can request those out-of-band.
- No self-serve public GDPR delete — applicants email the club, admin deletes via CRM.

---

## 9. Frontend contract

The block that submits this payload is `MembershipJoinFormBlock` in `packages/content-blocks/src/blocks/`. If the endpoint shape drifts from §1, update `onSubmit()` in that file. Any 4xx code the block doesn't recognise falls through to a generic "please try again" toast — feel free to add new codes without breaking the frontend.
