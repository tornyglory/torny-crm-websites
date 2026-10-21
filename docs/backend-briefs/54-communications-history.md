# Communications history — persisted sends + per-member feed

**Feature:** persist every outbound club email so the CRM can show (a) a club-wide "Sent" list on `/crm/communications` that survives page reloads, and (b) a per-member Communications tab on `/crm/members/{id}` with every email that landed in that member's inbox. Includes delivery / bounce / complaint status from SES.

**Status:** frontend shipped — both views render today but have no persistence:

- Global view (`apps/crm/src/views/communications/CommunicationsView.vue`) keeps a session-only `recentSends` array that is wiped on reload. The empty state calls this out directly: *"Batch history from earlier sessions isn't wired yet — a delivery-log endpoint is on the roadmap."*
- Per-member tab (`apps/crm/src/views/members/MemberDetailView.vue:847`) renders a dedicated `CrmEmptyState` saying *"Emails, calls, and notes to this member will appear here once the Communications brief lands."*

Both views flip to live data the moment the endpoints below return 200.

**Related briefs:**
- brief 45 — email templates (header + footer wrap).
- brief 46 — email flavour overrides (per-flavour subject/body overrides).
- brief 38 — applications: `application_received`, `application_approved`, `application_rejected` emails must persist too.
- brief 41 — enquiries: `enquiry_received`, `enquiry_reply` emails must persist too.
- brief 29 — invite + welcome emails must persist too.
- brief 40 — email notifications fired per owner subscription must persist too.
- bulk-email resource — `POST /clubs/{club_id}/members/bulk-email` is the only outbound email that persists partial data today (via its 200 response); this brief turns that response into durable rows.

---

## TL;DR

1. New tables `email_batches` + `email_recipients`. Every outbound club email writes one row to each on send.
2. New endpoints:
   - `GET /clubs/{club_id}/communications` — paginated feed of batches for the club-wide view.
   - `GET /clubs/{club_id}/communications/{batch_id}` — batch detail + per-recipient delivery rows.
   - `GET /clubs/{club_id}/members/{user_id}/communications` — per-member feed (bulk + transactional).
3. **Modify the existing `POST /clubs/{club_id}/members/bulk-email` handler** to persist the batch + recipient rows during send. The current 200 response shape is unchanged.
4. New SES event webhook: `POST /internal/ses/events` consumes delivery / bounce / complaint notifications and updates `email_recipients.status`.
5. Transactional send paths (applications, enquiries, welcome, invite, notifications) ride through a new `recordTransactionalEmail()` helper that writes the same tables with `flavor` set to the brief-45 flavour slug.

Everything else — composing, previewing, header/footer wrapping — stays in briefs 45 and 46.

---

## Base URL — CRM API

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Owner / admin / committee JWT on `club_members` for the GET endpoints below. SES webhook is unauthed but validates the SNS signature (see §8).

Scope rule — a committee member can read the club-wide feed but each recipient row's `email` is masked unless the caller is owner/admin (`<local>@<domain>` → `s***@d***.co.nz`). Owners + admins see raw addresses. This matches brief 39 (scoped CRM roles).

---

## The endpoints

| Method | Path | Auth |
|---|---|---|
| `GET`   | `/clubs/{club_id}/communications` | committee+ |
| `GET`   | `/clubs/{club_id}/communications/{batch_id}` | committee+ |
| `GET`   | `/clubs/{club_id}/members/{user_id}/communications` | committee+ |
| `POST`  | `/internal/ses/events` | SNS signature |

Unchanged:
- `POST /clubs/{club_id}/members/bulk-email` — same request/response, now persists.

---

## 1. Storage

Two new tables. All timestamps in UTC.

### `email_batches`

```
id                BIGSERIAL  PK
club_id           INTEGER    NOT NULL  REFERENCES clubs(id)
flavor            VARCHAR    NOT NULL              -- brief 45 flavour slug: 'broadcast', 'application_received', 'enquiry_reply', 'member_welcome', 'member_invite', …
subject           VARCHAR    NOT NULL              -- rendered (post-token-substitution) subject at send time
body_html         TEXT       NOT NULL              -- the body the composer POSTed, pre-wrap. For transactional sends: the code-authored body, pre-wrap.
sender_user_id    INTEGER    NULL  REFERENCES users(id)  -- the admin who clicked Send. Null for system-fired transactional (invite/welcome/notification).
sender_label      VARCHAR    NULL                  -- 'Naenae Bowling Club · via the club', derived from clubs_data.name at send time
recipient_mode    VARCHAR    NOT NULL              -- 'ids' | 'filter' | 'transactional'
recipient_filter  JSON       NULL                  -- the filter object when mode='filter', for the batch detail view
matched_count     INTEGER    NOT NULL  DEFAULT 0   -- how many user_clubs rows the recipient selection resolved to
sent_count        INTEGER    NOT NULL  DEFAULT 0   -- how many SES accepted
failed_count      INTEGER    NOT NULL  DEFAULT 0   -- how many SES rejected inline
created_at        TIMESTAMP  NOT NULL  DEFAULT NOW()

INDEX (club_id, created_at DESC)
INDEX (club_id, flavor, created_at DESC)
```

### `email_recipients`

```
id                   BIGSERIAL  PK
batch_id             BIGINT     NOT NULL  REFERENCES email_batches(id) ON DELETE CASCADE
club_id              INTEGER    NOT NULL                 -- denormalised for the per-member query path
user_id              INTEGER    NULL      REFERENCES users(id)  -- null when the recipient was an email with no linked user (future-proof — rare)
email                VARCHAR    NOT NULL                 -- the actual destination address at send time
name_snapshot        VARCHAR    NULL                     -- the member's display name at send time; snapshot so renames don't rewrite history
status               VARCHAR    NOT NULL  DEFAULT 'queued'  -- 'queued' | 'sent' | 'delivered' | 'bounced' | 'complained' | 'failed' | 'suppressed'
status_reason        VARCHAR    NULL                     -- SES bounce reason, "no email on file", etc. Short — not the full raw SES body.
provider_message_id  VARCHAR    NULL                     -- SES Message-ID. Null until the send call returns.
sent_at              TIMESTAMP  NULL                     -- SES accepted this one
delivered_at         TIMESTAMP  NULL                     -- SES Delivery event
bounced_at           TIMESTAMP  NULL                     -- SES Bounce event
complained_at        TIMESTAMP  NULL                     -- SES Complaint event

INDEX (batch_id)
INDEX (club_id, user_id, sent_at DESC)                   -- the per-member feed
INDEX (provider_message_id)                              -- SES event lookup
```

Status transitions are additive — once `delivered_at` is set, a later `complained_at` can also set the status to `complained` without touching `delivered_at`. The per-row `status` is the *latest meaningful* state.

### Insert flow (bulk-email handler)

1. Resolve the recipient selection (same code as today — `ids` mode fetches by user_id; `filter` mode applies the roster filter). Produce a list of `{ user_id, name, email }` triples.
2. `INSERT INTO email_batches` with `recipient_mode` set from the input + `matched_count` from the triples' length. `sent_count` and `failed_count` stay 0 until SES answers.
3. For each triple, `INSERT INTO email_recipients` with `status: 'queued'`. Members with no email get `status: 'suppressed'` and `status_reason: 'no email on file'` — they still get a row so the "N skipped" number is honest.
4. Call SES for each queued recipient. On SES success → `UPDATE … SET status='sent', sent_at=NOW(), provider_message_id=<id>`. On SES failure → `status='failed'`, `status_reason=<provider message>`.
5. Roll `sent_count` / `failed_count` back up to the batch row: `UPDATE email_batches SET sent_count=…, failed_count=… WHERE id=$1`.
6. Keep the current 200 response shape — the frontend's `recentSends` row shape matches the batch fields.

If step 2 fails (DB write error), surface it as 500 — do **not** fire the SES send. The current `POST /bulk-email` is already atomic from the admin's point of view; keep that.

---

## 2. `GET /clubs/{club_id}/communications`

Paginated feed of batches. Default sort: `created_at DESC`.

**Query params:**
- `limit` — int, default 25, max 100.
- `cursor` — opaque. When unset, start at the newest. Returned as `next_cursor` in the response. Simple `created_at+id` encoding is fine.
- `flavor` — comma-separated whitelist. e.g. `?flavor=broadcast,enquiry_reply`. Omit for all flavours.
- `user_id` — int. When set, only batches that *targeted this user* (join to `email_recipients`). Lets the per-member tab reuse the same list endpoint if the frontend prefers one query.

**200 response:**

```jsonc
{
  "status": "success",
  "data": {
    "batches": [
      {
        "batch_id":       1234,
        "flavor":         "broadcast",
        "flavor_label":   "Broadcast",          // human label mirrored from brief 45
        "subject":        "Twilight Triples — Round 3 confirmed",
        "sender": {
          "user_id":  12,                       // null for system sends
          "name":     "Nev Rodda",              // null for system sends
          "label":    "Naenae Bowling Club"     // the "from the club" label the modal shows
        },
        "recipient_mode": "filter",
        "recipient_filter": { "status": "active", "role": "player" },  // null when mode='ids' or 'transactional'
        "counts": {
          "matched":   47,
          "sent":      44,
          "failed":    1,
          "delivered": 42,
          "bounced":   1,
          "complained": 0,
          "suppressed": 2                       // 'suppressed' are the no-email-on-file skip rows
        },
        "created_at":     "2026-10-20T22:14:03.000Z"
      }
    ],
    "next_cursor": "eyJjIjoiMjAyNi0xMC0yMFQyMjoxNDowMy4wMDBaIiwiaSI6MTIzNH0=",   // null when exhausted
    "counts_window": {                           // for the heading sub-line "N sent · M failed this week"
      "last_7d":  { "batches": 3, "sent": 180, "failed": 2 },
      "last_30d": { "batches": 11, "sent": 920, "failed": 7 }
    }
  }
}
```

The `counts` block pulls from a single aggregate query on `email_recipients` grouped by `batch_id` — don't trust the stored `sent_count` / `failed_count` for the delivery-state buckets, since those are updated asynchronously by the SES webhook. The `counts.sent` / `counts.failed` fields *do* mirror the stored batch counts (what the handler saw at send time).

---

## 3. `GET /clubs/{club_id}/communications/{batch_id}`

Batch detail — subject, body, per-recipient status rows.

**Query params:**
- `limit` — int, default 50, max 200. Pagination for the recipients list.
- `cursor` — opaque.
- `status` — comma-separated filter: `delivered,bounced,complained,failed,suppressed`.

**200 response:**

```jsonc
{
  "status": "success",
  "data": {
    "batch_id":     1234,
    "flavor":       "broadcast",
    "flavor_label": "Broadcast",
    "subject":      "Twilight Triples — Round 3 confirmed",
    "body_html":    "<p>Hi {{recipient_first_name}}…</p>",   // pre-wrap, pre-substitution — what the admin typed
    "preview_html": "<!doctype html>…</p>",                 // server-rendered sample body with the first recipient's tokens, same substitution as brief 45 §5. Lets the CRM show "what the first member actually got" without re-fetching the template.
    "sender":       { "user_id": 12, "name": "Nev Rodda", "label": "Naenae Bowling Club" },
    "recipient_mode": "filter",
    "recipient_filter": { "status": "active", "role": "player" },
    "counts":       { /* same shape as §2 */ },
    "created_at":   "2026-10-20T22:14:03.000Z",
    "recipients": [
      {
        "recipient_id":        98771,
        "user_id":             88,
        "name":                "Jayden Burns",
        "email":               "jayden@example.co.nz",
        "status":              "delivered",
        "status_reason":       null,
        "provider_message_id": "0100018f-…-000000",
        "sent_at":             "2026-10-20T22:14:04.812Z",
        "delivered_at":        "2026-10-20T22:14:12.004Z",
        "bounced_at":          null,
        "complained_at":       null
      },
      {
        "recipient_id":        98772,
        "user_id":             142,
        "name":                "Frances Roydon-Miller",
        "email":               "frances@example.co.nz",
        "status":              "bounced",
        "status_reason":       "Mailbox full",
        "provider_message_id": "0100018f-…-000001",
        "sent_at":             "2026-10-20T22:14:04.901Z",
        "delivered_at":        null,
        "bounced_at":          "2026-10-20T22:14:19.221Z",
        "complained_at":       null
      }
    ],
    "next_cursor": null
  }
}
```

**404** when the batch belongs to a different club. **404** when `batch_id` doesn't exist. No special code — the frontend treats both as "batch missing".

---

## 4. `GET /clubs/{club_id}/members/{user_id}/communications`

The feed the MemberDetail Communications tab consumes. Returns every `email_recipients` row for `user_id`, newest first, with enough batch context to render a readable row without a second call.

**Query params:**
- `limit` — int, default 25, max 100.
- `cursor` — opaque.
- `flavor` — comma-separated filter.
- `status` — comma-separated filter.

**200 response:**

```jsonc
{
  "status": "success",
  "data": {
    "items": [
      {
        "recipient_id":   98771,
        "batch_id":       1234,
        "flavor":         "broadcast",
        "flavor_label":   "Broadcast",
        "subject":        "Twilight Triples — Round 3 confirmed",
        "preview":        "Hi Jayden, round 3 confirmed for Friday 7pm. See you there…",   // first 160 chars of the plaintext body, with {{tokens}} substituted for this recipient
        "sender":         { "user_id": 12, "name": "Nev Rodda", "label": "Naenae Bowling Club" },
        "status":         "delivered",
        "status_reason":  null,
        "sent_at":        "2026-10-20T22:14:04.812Z",
        "delivered_at":   "2026-10-20T22:14:12.004Z",
        "bounced_at":     null,
        "complained_at":  null
      },
      {
        "recipient_id":   98103,
        "batch_id":       1198,
        "flavor":         "member_welcome",
        "flavor_label":   "Welcome email",
        "subject":        "Welcome to Naenae Bowling Club",
        "preview":        "Hi Jayden, welcome to the club…",
        "sender":         { "user_id": null, "name": null, "label": "Naenae Bowling Club" },
        "status":         "delivered",
        "sent_at":        "2026-10-14T04:00:11.000Z",
        "delivered_at":   "2026-10-14T04:00:19.112Z",
        "bounced_at":     null,
        "complained_at":  null
      }
    ],
    "next_cursor": null,
    "counts": {
      "total":      14,
      "delivered":  12,
      "bounced":    1,
      "complained": 0,
      "failed":     0,
      "queued":     1
    }
  }
}
```

**404** if `user_id` isn't linked to this club. **403** if the caller isn't on the club.

The `preview` field is the one piece of real work this endpoint does on top of a simple SELECT — strip the body HTML to plaintext, substitute the recipient's tokens, truncate at 160 chars, pad an ellipsis. Cheap but valuable: without it the FE either has to render HTML inline (unsafe) or fetch the batch detail per row (chatty).

---

## 5. Transactional emails — new helper

Every non-broadcast send currently calls SES directly from its own handler. Introduce one helper that wraps `sendClubEmail()` (brief 45 §7) and persists:

```js
async function recordTransactionalEmail({ clubId, flavor, to, user_id, subject, body_html, sender }) {
  const batch = await insertEmailBatch({
    clubId,
    flavor,
    subject,
    body_html,
    sender_user_id: sender?.user_id ?? null,
    sender_label:   sender?.label ?? clubName(clubId),
    recipient_mode: 'transactional',
    recipient_filter: null,
    matched_count: 1
  });
  const recipient = await insertEmailRecipient({
    batch_id: batch.id,
    club_id:  clubId,
    user_id,
    email: to,
    name_snapshot: await lookupName(user_id),
    status: 'queued'
  });
  try {
    const res = await sendClubEmail({ clubId, flavor, to, body_html, subject });
    await updateRecipientSent(recipient.id, res.provider_message_id);
    await updateBatchCounts(batch.id, { sent: 1, failed: 0 });
    return res;
  } catch (err) {
    await updateRecipientFailed(recipient.id, err.message);
    await updateBatchCounts(batch.id, { sent: 0, failed: 1 });
    throw err;
  }
}
```

Call sites to swap:
- brief 38 `/applications` POST → `application_received`.
- brief 38 approve → `application_approved`.
- brief 38 reject → `application_rejected`.
- brief 41 `/enquiries` POST → `enquiry_received`.
- brief 41 `/reply` → `enquiry_reply`.
- brief 29 invite email → `member_invite`.
- brief 29 welcome email → `member_welcome`.
- brief 40 per-user notifications → `owner_notification`.

For `owner_notification`, the recipient `user_id` is the owner being notified, not the actor who triggered the event. One owner = one row.

---

## 6. SES event webhook — `POST /internal/ses/events`

AWS SNS → Lambda. One topic subscribed to `Delivery`, `Bounce`, `Complaint`. Payload shape documented at https://docs.aws.amazon.com/ses/latest/dg/notification-contents.html.

Handler:
1. Verify SNS signature. Reject on fail (401).
2. Pull `mail.messageId` from the payload → `provider_message_id`.
3. Look up `email_recipients` by `provider_message_id`. No row → log + drop (SES is noisy during setup, don't bounce).
4. Switch on event type:
   - `Delivery` → `SET status='delivered', delivered_at=<timestamp>`.
   - `Bounce`   → `SET status='bounced', bounced_at=<timestamp>, status_reason=<diagnosticCode or reason>`.
   - `Complaint` → `SET status='complained', complained_at=<timestamp>, status_reason=<complaintFeedbackType>`.
5. Return 200 to SNS.

**Idempotency** — a `Delivery` event may arrive twice. Make the status writes idempotent (`WHERE delivered_at IS NULL`, etc). Don't blindly overwrite timestamps.

**Bounced members** — once `status='bounced'`, that address should land on a soft suppression list so admins get a warning when they try to email the same member again. Suppression list is out of scope for v1 — this brief only needs to record the bounce.

---

## 7. Error table

New or updated:

| Status | code | When |
|---|---|---|
| `404` | `batch_not_found` | `/communications/{batch_id}` where the batch is from a different club or doesn't exist |
| `404` | `user_not_on_club` | `/members/{user_id}/communications` when the user isn't linked |
| `400` | `bad_cursor` | Pagination cursor is malformed or stale |
| `400` | `bad_flavor` | Unknown flavour slug in the `flavor` filter |
| `400` | `bad_status` | Unknown status value in the `status` filter |
| `401` | (webhook) | SNS signature failed |

Existing `POST /bulk-email` codes (`missing_subject`, `missing_body`, `no_recipients`) are unchanged.

---

## 8. Frontend contract summary

New resource `packages/api-client/src/resources/communications.ts` with:

```ts
export interface CommunicationsBatch {
  batch_id: number
  flavor: string
  flavor_label: string
  subject: string
  sender: { user_id: number | null; name: string | null; label: string }
  recipient_mode: 'ids' | 'filter' | 'transactional'
  recipient_filter: Record<string, string> | null
  counts: {
    matched: number
    sent: number
    failed: number
    delivered: number
    bounced: number
    complained: number
    suppressed: number
  }
  created_at: string
}

export interface MemberCommunication {
  recipient_id: number
  batch_id: number
  flavor: string
  flavor_label: string
  subject: string
  preview: string
  sender: { user_id: number | null; name: string | null; label: string }
  status: 'queued' | 'sent' | 'delivered' | 'bounced' | 'complained' | 'failed' | 'suppressed'
  status_reason: string | null
  sent_at: string | null
  delivered_at: string | null
  bounced_at: string | null
  complained_at: string | null
}

export const communications = {
  list(clubId: number, params?: { limit?: number; cursor?: string; flavor?: string[]; status?: string[]; userId?: number }): Promise<{ batches: CommunicationsBatch[]; next_cursor: string | null; counts_window: … }>,
  get(clubId: number, batchId: number, params?: { limit?: number; cursor?: string; status?: string[] }): Promise<BatchDetail>,
  listForMember(clubId: number, userId: number, params?: { limit?: number; cursor?: string; flavor?: string[]; status?: string[] }): Promise<{ items: MemberCommunication[]; next_cursor: string | null; counts: … }>,
}
```

Three view updates follow once the endpoints are live:

1. `CommunicationsView.vue` — replace `recentSends` with `communications.list(clubId)`. Keep the composer's optimistic unshift as a stop-gap during the SES round-trip; the next poll reconciles.
2. `MemberDetailView.vue:847` — replace the empty state with a feed rendered from `communications.listForMember(clubId, userId)`.
3. New `BatchDetailView` under `/crm/communications/{batch_id}` — recipient list with status pills. Deferred to a follow-up if the detail endpoint lands later than the list endpoint.

---

## 9. Verification (please attach outputs)

```bash
# 1. Compose + send a broadcast
curl -X POST "$API/clubs/$CID/members/bulk-email" \
  -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" \
  -d '{"subject":"Test","body_html":"<p>Hello</p>","recipients":{"mode":"filter","filter":{"status":"active","role":"player"}}}'

# → 200. New row in email_batches, N rows in email_recipients with status 'queued' or 'sent'.

# 2. List batches
curl -H "Authorization: Bearer $T" "$API/clubs/$CID/communications?limit=10"

# → 200 with the batch above as items[0], counts.matched = N.

# 3. Batch detail
curl -H "Authorization: Bearer $T" "$API/clubs/$CID/communications/$BATCH_ID"

# → 200 with the per-recipient rows.

# 4. Per-member feed (pick a recipient user_id)
curl -H "Authorization: Bearer $T" "$API/clubs/$CID/members/$UID/communications"

# → 200 with the broadcast as items[0] and any prior transactional emails below.

# 5. SES Delivery event (simulated via SNS test publish)
#    → email_recipients row for that provider_message_id has status='delivered', delivered_at set.

# 6. SES Bounce event
#    → status='bounced', bounced_at set, status_reason populated.

# 7. Re-post the same Delivery event (idempotency)
#    → no change to delivered_at.
```

Pass criteria:
- ✓ Batch write happens before SES call — a DB failure must not send.
- ✓ `recipients[].email` is masked for a committee caller, raw for an admin caller.
- ✓ Members with no email in `email_recipients` land as `status='suppressed'` with the batch's `counts.suppressed` picking them up.
- ✓ `counts_window` numbers in GET /communications match a hand-rolled SELECT on `email_recipients.sent_at` ranges.
- ✓ Per-member feed includes transactional sends (welcome / invite / enquiry reply) after `recordTransactionalEmail()` migration lands.
- ✓ GET /communications/{batch_id} on a batch from another club returns 404 `batch_not_found`.

---

## 10. Non-goals (v1)

- **No open / click tracking.** SES open + click events are a separate configuration (CloudWatch pixel) — add once the delivery / bounce / complaint baseline is stable.
- **No resend / forward from history.** v1 is read-only. Composing a new broadcast is still the only write path.
- **No notes / calls / SMS merged in.** The MemberDetail tab's empty state hints at a future unified timeline. This brief only populates the email half; notes stay on `members.notes` for now (follow-up brief).
- **No bulk-delete or archive on batches.** Batches persist indefinitely. Add a soft-delete column if GDPR / NZ Privacy Act require it later.
- **No admin suppression-list UI.** Bounced recipients are flagged in the row but there's no "do not email" toggle yet. A follow-up brief adds the suppression list + a "contact preferences" tab.
- **No per-recipient resend.** If 2 of 44 bounced, the admin recomposes. No one-click retry.

---

## 11. Contact

Ping Felicity in the frontend channel when the three GET endpoints are live — the two views flip to the real data in one small PR (resource file + two mounts). SES webhook + transactional persistence can land as a follow-up PR without blocking the UI switchover; the feed renders empty history gracefully.
