# Enquiries — Contact Form Backend

**Feature:** the public `Contact` block (`ContactFormBlock.vue`) posts a message to the club's Enquiries inbox. Structural twin of brief 38 (applications) but simpler — no tier, no approval flow, no membership fan-out. One POST, one row, one notification.

**Status:** frontend shipped 2026-08-26 (ContactFormBlock rewritten, api-client `enquiries` resource added, CRM sidebar Enquiries counter already exists with `2` hardcoded). Awaiting backend to make POST real + wire the inbox.

**Related briefs:**
- brief 38 (applications) — same POST → inbox pattern.
- brief 40 (notifications) — fires kind=`enquiry` with a stable dedupe key.
- brief 15/16 (site payload) — `contact` + `hours` fields already on `/site` power the rail card.

---

## Base URL — CRM API

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Public POST — **no auth**. Rate-limited by IP (5 per hour per (club, IP)) plus a lightweight honeypot field (`hp`) that discards bots.

CRM inbox endpoints — **admin+** on `club_members`.

---

## The endpoints

| Method | Path | Auth |
|---|---|---|
| `POST`   | `/public/clubs/{slug}/enquiries` | none (public) |
| `GET`    | `/clubs/{club_id}/enquiries` | admin+ |
| `GET`    | `/clubs/{club_id}/enquiries/{enquiry_id}` | admin+ |
| `POST`   | `/clubs/{club_id}/enquiries/{enquiry_id}/read` | admin+ |
| `POST`   | `/clubs/{club_id}/enquiries/{enquiry_id}/reply` | admin+ |
| `POST`   | `/clubs/{club_id}/enquiries/{enquiry_id}/archive` | admin+ |
| `POST`   | `/clubs/{club_id}/enquiries/{enquiry_id}/notes` | admin+ |
| `PATCH`  | `/clubs/{club_id}/enquiry-settings` | admin+ |

---

## 1. `POST /public/clubs/{slug}/enquiries`

The frontend sends this payload (matches `CreateEnquiryInput` in `packages/api-client/src/resources/enquiries.ts`):

```jsonc
{
  "full_name": "Frances Roydon-Miller",
  "email": "frances@example.co.nz",
  "phone": "021 483 610",              // nullable
  "topic": "membership",               // 'membership' | 'events' | 'facilities' | 'general' | 'media'
  "message": "Hello! We've just moved to Kelburn and I'd love to come along to a Friday twilight roll-up…",
  "consent_reply": true,               // MUST be true
  "hp": ""                             // honeypot — non-empty = silently drop as spam
}
```

**200 response:**
```jsonc
{
  "status": "success",
  "data": {
    "enquiry_id": 8412,
    "received_at": "2026-08-26T22:14:03.000Z"
  }
}
```

**Errors:**

| HTTP | code | Cause |
|---|---|---|
| 400 | `missing_required` | full_name / email / message empty |
| 400 | `bad_email` | Email doesn't parse |
| 400 | `bad_topic` | topic isn't one of the five known slugs |
| 400 | `bad_message` | Message under 5 chars or over 4000 |
| 400 | `consent_required` | consent_reply !== true |
| 404 | `unknown_club` | slug doesn't resolve |
| 429 | `rate_limited` | 6th submission in the current hour from this IP for this club |
| 503 | `enquiries_closed` | Owner toggled `enquiries_open = false` in settings |

Honeypot triggers return `200 { enquiry_id: 0, received_at: <now> }` — silent fake-success so bots think they worked but no row is stored and no notification fires.

**Server-side actions on success:**
1. Insert `club_enquiries` row (`status='new'`).
2. Fan-out brief 40 notifications with `kind='enquiry'`, `dedupe_key='enquiry:{id}:created'`, `target.destination_href='/crm/enquiries?highlight={id}'`, `primary_action` set to `{ label: 'Reply', action: 'reply_enquiry', href: '/crm/enquiries?highlight={id}&action=reply' }`.
3. Send acknowledgement email to the enquirer using the club's brand.
4. Send new-enquiry alert email to `enquiry_notification_email` (or the club's `contact_email` fallback) — same pattern as brief 38 applications.

---

## 2. Row shape

Frontend TS type for the CRM inbox:

```ts
type EnquiryStatus = 'new' | 'read' | 'replied' | 'archived'
type EnquiryTopic  = 'membership' | 'events' | 'facilities' | 'general' | 'media'

interface EnquiryRow {
  id: number
  status: EnquiryStatus
  full_name: string
  email: string
  phone: string | null
  topic: EnquiryTopic
  message_preview: string        // first ~120 chars, plain text
  received_at: string            // ISO 8601 UTC
  responded_at: string | null    // ISO 8601 UTC — when a reply was sent from the CRM
  responder_user_id: number | null
  note_count: number
}

interface EnquiryDetail extends Omit<EnquiryRow, 'message_preview' | 'note_count'> {
  message: string                // full message body
  consent_reply: boolean
  ip_hash: string                // hashed source IP for spam correlation
  user_agent: string | null
  replies: EnquiryReply[]        // outbound replies sent from the CRM
  notes: EnquiryNote[]           // internal notes, never emailed
}

interface EnquiryReply {
  id: number
  body: string
  author_user_id: number
  author_name: string
  sent_at: string
  email_status: 'sent' | 'failed'
}

interface EnquiryNote {
  id: number
  body: string
  author_user_id: number
  author_name: string
  created_at: string
}
```

---

## 3. `GET /clubs/{club_id}/enquiries`

**Query params:**
- `status` — `all | new | read | replied | archived`. Default `new`.
- `topic` — filter to one topic slug. Optional.
- `search` — substring match against `full_name`, `email`, `phone`, `message`.
- `limit` (default 20, max 100).
- `offset` (default 0).
- `sort` — `newest` (default) or `oldest`.

**200 response:**
```jsonc
{
  "status": "success",
  "data": {
    "enquiries": [ /* EnquiryRow[] */ ],
    "counts": { "new": 3, "read": 5, "replied": 41, "archived": 12 },
    "pagination": { "limit": 20, "offset": 0, "total": 61 }
  }
}
```

`counts` is computed across the club's full history, ignoring status/search — same behaviour as brief 38 §2.

---

## 4. `GET /clubs/{club_id}/enquiries/{enquiry_id}` — detail

Returns `EnquiryDetail`. Errors: `404 not_found` when id doesn't belong to this club.

**Side effect:** if the row is `new` and the caller has `enquiries:respond` (or is admin+), the status auto-flips to `read` on this GET so the counts stay honest — the same pattern as reading email in Gmail. Frontend doesn't need to do anything.

---

## 5. `POST /clubs/{club_id}/enquiries/{enquiry_id}/read`

Explicit mark-read (for when the reviewer skimmed the preview and wants to clear it from the "New" tab without opening the detail).

**200 response:**
```json
{ "status": "success", "data": { "status": "read" } }
```

---

## 6. `POST /clubs/{club_id}/enquiries/{enquiry_id}/reply`

Sends an outbound email to the enquirer, from the club's `contact_email` address (using SendGrid's reply-to header so the enquirer's reply lands in the club's own inbox rather than the CRM).

**Body:**
```jsonc
{
  "body": "Hi Frances,\n\nGreat to hear from you...",
  "subject": "Re: Membership enquiry"   // optional — server default: "Re: your enquiry to {club_name}"
}
```

**200 response:**
```jsonc
{
  "status": "success",
  "data": {
    "reply_id": 501,
    "sent_at": "2026-08-26T23:01:00.000Z",
    "status": "replied",
    "email_status": { "sent": true }
  }
}
```

**Errors:**
- `400 missing_body` — body is empty or whitespace-only.
- `400 body_too_long` — body > 10_000 chars.
- `409 already_archived` — can't reply to an archived enquiry (unarchive first).
- `404 not_found`.

Sends the email + flips row status to `replied` + populates `responded_at` + `responder_user_id`.

---

## 7. `POST /clubs/{club_id}/enquiries/{enquiry_id}/archive`

Archive without replying. Body optional `{ "reason": "spam" | "resolved" | "other" }`. Row status becomes `archived`.

**200 response:**
```json
{ "status": "success", "data": { "status": "archived" } }
```

Marking a row `archived` never sends an email. Reversible: `POST` this same route again with `{ "unarchive": true }` to move back to `read`. Errors: `404 not_found`.

---

## 8. `POST /clubs/{club_id}/enquiries/{enquiry_id}/notes`

Internal note. Never emailed. Body: `{ "body": "…" }`. Same shape as brief 38 §6.

**200 response:**
```jsonc
{
  "status": "success",
  "data": {
    "id": 88,
    "body": "Verified — Frances is Peter's neighbour",
    "author_user_id": 42,
    "author_name": "Nev Rodda",
    "created_at": "2026-08-26T23:05:00.000Z"
  }
}
```

Errors: `400 missing_body`, `400 body_too_long` (>4000 chars), `404 not_found`.

---

## 9. Owner settings — `PATCH /clubs/{club_id}/enquiry-settings`

```jsonc
{
  "enquiries_open": true,                        // false → public POST returns 503
  "enquiry_notification_email": "inbox@club.co", // override the default recipient
  "auto_reply_body": "Thanks for your note …",   // optional custom acknowledgement copy (plain text or basic markdown)
  "topics_enabled": ["membership","events","facilities","general","media"]
}
```

Response echoes the merged settings. `GET /clubs/{club_id}/settings` will surface these under a new `enquiries` block.

`topics_enabled` gates which topic slugs the public POST will accept — a club that doesn't hire out facilities can drop `facilities` and any inbound `topic=facilities` returns `400 bad_topic`. Empty array = accept all five.

---

## 10. Frontend integration plan

- **`ContactFormBlock`** — already calls `enquiries.create()`. Zero backend-facing changes needed once the endpoint lives.
- **New `applications`-style CRM view** — `apps/crm/src/views/enquiries/EnquiriesView.vue` currently ships as a stub. Rewire like `ApplicationsView`:
  - Status tabs `new / read / replied / archived / all` reading `counts.status`.
  - 250ms debounced search bar.
  - Row click → `/crm/enquiries/:id` (new `EnquiryDetailView.vue` — like `ApplicationDetailView.vue`, with a right rail showing the reply form + notes thread).
  - Reply modal / inline form (subject + body + Send).
  - Archive dropdown next to Reply on pending rows.
- **Sidebar counter** — extend `CrmShell.vue` with `useEnquiriesCount()` polling `counts.new` on club change + broadcast `torny:enquiries-count` after list refetches (same pattern as brief 38).
- **Settings → Notifications** already covers the per-user `enquiry` kind opt-in from brief 40.
- **Settings → Enquiries** (new section) — Accept enquiries toggle, Notify email input, Auto-reply body textarea, Topics-enabled multi-check.

---

## 11. Error shapes

Mirrors brief 38 §7 with these additions:

| HTTP | code | Notes |
|---|---|---|
| 400 | `bad_topic` | Unknown or disabled topic |
| 400 | `body_too_long` | Reply body over 10k chars, or note over 4k |
| 400 | `missing_body` | Reply/note body empty |
| 409 | `already_archived` | Can't reply to archived — unarchive first |
| 503 | `enquiries_closed` | Owner toggled `enquiries_open = false` |

---

## 12. Verification (please attach outputs)

- ✓ POST valid payload → 200 with `enquiry_id`
- ✓ Public POST with `hp: 'anything'` → 200 with fake `enquiry_id: 0`, no row inserted, no notification
- ✓ POST invalid email → 400 `bad_email`
- ✓ POST `topic: 'membership'` when `topics_enabled=['general']` → 400 `bad_topic`
- ✓ POST `consent_reply: false` → 400 `consent_required`
- ✓ POST 6× in an hour from same IP → 429 `rate_limited`
- ✓ POST with `enquiries_open=false` → 503 `enquiries_closed`
- ✓ Notification kind=`enquiry` appears in the bell dropdown for every subscribed admin
- ✓ GET detail on `new` row → status auto-flips to `read`, `counts.new` decrements
- ✓ Reply with body → 200, row status `replied`, `responded_at` populated, email sent
- ✓ Reply on archived row → 409 `already_archived`
- ✓ Archive → status `archived`, no email
- ✓ Unarchive → status back to `read`

---

## 13. Non-goals

- No public "check my enquiry status" endpoint — reply lands in their inbox.
- No file uploads.
- No SMS notifications.
- No public-facing enquirer identity beyond the email they provided.
- No thread-based multi-turn conversations in v1 — one enquiry, one reply, done. Follow-ups happen out-of-band in the club's email inbox.

---

## 14. Contact

Same as prior briefs. If a new topic slug is added, coordinate the frontend `EnquiryTopic` union in `packages/api-client/src/resources/enquiries.ts` before shipping.
