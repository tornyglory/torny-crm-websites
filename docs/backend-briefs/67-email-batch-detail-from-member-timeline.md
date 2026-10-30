# Email batch detail + delivery + open tracking from the member timeline

**Feature:** two cuts of the same gap on the Member Detail → Communications tab:

1. **Click → read the email.** Stand up `GET /clubs/{club_id}/communications/{batch_id}` so clicking an email row opens the actual email the member received. Today the per-member feed returns `body: null` for every `channel='email'` row by design (the backend doesn't retain email bodies on the recipient row — only on the batch). The batch endpoint was spec'd in brief 54 §3 but has never been exercised by the FE because the per-member feed itself only came online this week.
2. **At-a-glance delivery + open state** on each row of the per-member feed. Today each row only carries a coarse `status: 'sent' | 'failed'`. Admins want to see — without a click — whether the email was *delivered* (SES accepted + the recipient's MX box took it) and whether it was *opened* (the recipient actually viewed it). Both need SES configuration (open-tracking pixel) + webhook ingestion + a shape bump on the per-member feed response.

**Related briefs:**
- brief 54 — communications history. §3 defines this exact endpoint; §4 (the per-member feed) is now live. §3 is the matching read path for row-level email detail.
- brief 45 — email templates (header + footer wrap). The `preview_html` returned here is a template-rendered sample for the specific recipient.
- brief 46 — email flavour overrides. Flavour slug on the batch (`broadcast`, `member_welcome`, etc.) drives which header/footer is wrapped.
- brief 66 — the owner-403 bug on the per-member feed. Please apply the same auth-gate fix here before go-live — the batch endpoint will have the same role-matrix.

**Status:** reported by Felicity on 2026-10-30 — the Communications tab now lists emails (subject / sender / status / sent_at) for every member, but each row is a dead click. Admins can see *that* a member received an email but can't open it to re-read what was sent.

---

## TL;DR

1. **Ship `GET /clubs/{club_id}/communications/{batch_id}`** per brief 54 §3. Returns the batch metadata + raw `body_html` + a server-rendered `preview_html` with this batch's tokens substituted.
2. **Accept an optional `user_id` query param** so the FE can request *"the preview rendered for Nev Rodda"* rather than the first-recipient default. Returns the same `preview_html` but with that recipient's tokens substituted + the recipient's row (status, delivered_at, opened_at, bounce reason) inline.
3. **Enable SES open-tracking + ingest the Open event** via the brief 54 §6 SNS webhook. Each `email_recipients` row gains `opened_at TIMESTAMP NULL` + `open_count INT NOT NULL DEFAULT 0`.
4. **Bump the per-member feed shape** so each `channel='email'` row carries `delivered_at`, `opened_at`, `bounced_at`, `complained_at`. Lets the Communications tab show *"✓ Delivered · 👁 Opened"* without a modal click.
5. **Role matrix:** owner / admin / committee → yes. Player → no (403 `forbidden`). Same as brief 66's fix on the per-member feed. Email addresses in the response are masked for committee callers (same rule as brief 54 §2).

---

## Base URL — CRM API

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Owner / admin / committee JWT on `club_members`. Fix the auth gate from brief 66 before shipping.

---

## 1. The problem

`MemberDetailView.vue` Communications tab (shipped 2026-10-30) renders rows like:

| Subject | Sender | Status | Sent at |
|---|---|---|---|
| "Test Email" | Nigel Upper | Sent | 30 Oct 2026 · 11:40 |
| "Test Bulk Email" | Nigel Upper | Sent | 22 Oct 2026 · 9:13 |

Each row has:
- `subject` ✓
- `batch_id` ✓
- `status`, `sent_at`, `sent_by_name` ✓
- `body` = `null` (by design — brief 54 §4a: "we don't retain email bodies" on the per-member row)
- `delivered_at` / `opened_at` / `bounced_at` — **missing**. The per-member feed only carries a coarse `status`. Even if SES successfully delivered the message, we can't tell. Admins want to know whether the member actually opened the follow-up, not just "SES accepted it a week ago."

Two problems to solve: a click target with no body to render, and a row with no delivery / open state.

---

## 2. `GET /clubs/{club_id}/communications/{batch_id}`

Brief 54 §3 defined the full shape. Repeating here with the one additive change the member-detail use case needs — a `user_id` query param so the preview is for *this specific recipient*, not the first one in the batch.

### Query params

| Name | Required | Notes |
|---|---|---|
| `user_id` | no | When set, `preview_html` is rendered with this recipient's tokens + the response includes `your_row` with their status + delivery timeline. Omit for the first-recipient default (brief 54's original behaviour). |
| `limit` | no | Pagination on the `recipients` list. Default 50, max 200. For member-detail usage, `limit=1&user_id={uid}` is the most efficient — we only need the one row. |
| `cursor` | no | Opaque. |
| `status` | no | Comma-list filter on recipients (`delivered,bounced,…`). Not used by the member-detail call. |

### 200 response

Same shape as brief 54 §3 — reproducing here with the two member-detail-specific fields called out:

```jsonc
{
  "status": "success",
  "data": {
    "batch_id":     1234,
    "flavor":       "broadcast",
    "flavor_label": "Broadcast",

    "subject":      "Test Email",
    "body_html":    "<p>Hi {{recipient_first_name}}, …</p>",
    "preview_html": "<!doctype html>…pre-wrapped-and-token-substituted-for-user_id-or-first…",

    "sender":       { "user_id": 7, "name": "Nigel Upper", "label": "Naenae Bowling Club" },
    "recipient_mode": "ids",
    "recipient_filter": null,

    "counts": { "matched": 1, "sent": 1, "failed": 0, "delivered": 1, "bounced": 0, "complained": 0, "suppressed": 0 },
    "created_at":   "2026-10-30T11:40:03.000Z",

    "your_row": {                           // NEW — only present when `user_id` is passed
      "recipient_id":        98771,
      "user_id":             8,
      "name":                "Nev Rodda",
      "email":               "nev@qubestudio.co.nz",     // masked for committee callers
      "status":              "opened",                   // see §2a — latest-meaningful state
      "status_reason":       null,
      "provider_message_id": "0100018f-…-000000",
      "sent_at":             "2026-10-30T11:40:04.812Z",
      "delivered_at":        "2026-10-30T11:40:12.004Z",
      "opened_at":           "2026-10-30T13:22:41.000Z", // NEW — first SES Open event
      "open_count":          3,                           // NEW — total SES Open events seen
      "bounced_at":          null,
      "complained_at":       null
    },

    "recipients": [ /* unchanged — brief 54 §3 shape */ ],
    "next_cursor": null
  }
}
```

- `body_html` is the raw admin-authored HTML — tokens unsubstituted, no header/footer wrap. For a *"here's what the admin typed"* panel.
- `preview_html` is the fully-rendered email — tokens substituted, header/footer wrapped (brief 45). This is what the recipient actually got.
- `your_row` is new on top of brief 54 §3. Null / omitted when `user_id` isn't passed. Lets the FE render the single recipient's delivery + open timeline without walking the full `recipients` list.
- `your_row.status` is the *latest meaningful* state. Transitions are additive — delivered → opened → complained (if applicable). `opened` wins over `delivered` once the first Open event lands; `bounced` / `complained` win over `opened` on the rare post-open rejection.

### Errors

| Status | code | When |
|---|---|---|
| `404` | `batch_not_found` | `batch_id` doesn't exist or belongs to another club |
| `404` | `user_not_in_batch` | `user_id` was passed but isn't in `email_recipients` for this batch |
| `403` | `forbidden` | Caller isn't owner / admin / committee on the club (same gate as brief 66) |
| `400` | `bad_cursor` | Pagination cursor malformed / stale |

---

## 2a. Storage + SES open-tracking config

### `email_recipients` — new columns

Brief 54 §1 defined `email_recipients` with `delivered_at` / `bounced_at` / `complained_at`. Add two more:

```sql
ALTER TABLE email_recipients
  ADD COLUMN opened_at   TIMESTAMP NULL,
  ADD COLUMN open_count  INTEGER   NOT NULL DEFAULT 0;

CREATE INDEX idx_email_recipients_opens
  ON email_recipients (club_id, opened_at DESC)
  WHERE opened_at IS NOT NULL;
```

Backfill: all existing rows get `opened_at = NULL`, `open_count = 0`. No retroactive attribution — opens before the pixel is live simply don't exist in the record.

### Expand the `status` enum

Brief 54 §1 defined `status VARCHAR` with `'queued' | 'sent' | 'delivered' | 'bounced' | 'complained' | 'failed' | 'suppressed'`. Add:

```
'opened'
```

Same latest-meaningful rule applies — `opened` promotes from `delivered` on first Open event, loses to `bounced` / `complained` on later rejection events.

### SES configuration

Enable **Open tracking** on the sending SES configuration set:

1. In SES console → Configuration sets → [the config set used by `bulk-email`] → Event destinations.
2. Add an SNS destination for the `Open` event type (alongside Delivery / Bounce / Complaint from brief 54 §6).
3. Point it at the same SNS topic the brief 54 webhook already subscribes to.

AWS injects the tracking pixel automatically when the config set has Open tracking enabled — no changes needed in the body templating pipeline.

### Webhook — extend `POST /internal/ses/events`

Brief 54 §6 already handles Delivery / Bounce / Complaint. Add one more switch arm:

```js
case 'Open':
  await updateRecipient(messageId, {
    opened_at: firstTimeOnly('opened_at'),       // only set if currently NULL
    open_count: 'open_count + 1',                 // SQL increment
    status: ifStatusIn(['sent','delivered'], 'opened'),  // don't overwrite bounced / complained
  });
  break;
```

Idempotency: `opened_at` is set only on the first Open event per recipient; `open_count` increments every time. Status upgrade is gated — if the row is already `bounced` or `complained`, don't downgrade it to `opened`.

### Why open-only (no clicks)

Click tracking is a separate SES event type (`Click`) and requires rewriting every link in the body to a redirect URL. More invasive, more fragile, and the admin-value is marginal for a club CRM. Open is enough to answer *"did they see it?"*. If click tracking becomes necessary, add it as a follow-up.

---

## 2b. Per-member feed shape bump

Brief 54 §4 defined `GET /clubs/{club_id}/members/{user_id}/communications`. Today each `channel='email'` row returns only a coarse `status`. Add the full delivery timeline so the Communications tab can render at-a-glance state without a click-through.

### Updated row shape — email channel

```jsonc
{
  "communication_id": 4820,
  "channel":         "email",
  "subject":         "Season kick-off — Saturday",
  "sender":          { "user_id": 7, "name": "Nigel Upper", "label": "Naenae Bowling Club" },
  "batch_id":        918,

  "status":          "opened",                               // was 'sent' | 'failed'; now the full enum from §2a
  "status_reason":   null,
  "sent_at":         "2026-10-20T21:58:11.000Z",
  "delivered_at":    "2026-10-20T21:58:19.112Z",             // NEW
  "opened_at":       "2026-10-20T23:04:42.000Z",             // NEW — null if never opened
  "open_count":      2,                                       // NEW — 0 if never opened
  "bounced_at":      null,                                    // NEW (promoted from §4 brief 54's existing schema; just surface it in the response)
  "complained_at":   null                                     // NEW
}
```

### Updated row shape — note channel

Unchanged. Notes don't have delivery events. The new `delivered_at` / `opened_at` / `bounced_at` / `complained_at` / `open_count` fields are always `null` / `0` on notes.

### `counts` block

Brief 54 §4 returned `counts: { total, delivered, bounced, complained, failed, queued }`. Add `opened`:

```jsonc
"counts": {
  "total":      14,
  "delivered":  12,
  "opened":     9,                                            // NEW
  "bounced":    1,
  "complained": 0,
  "failed":     0,
  "queued":     1
}
```

---

## 3. Frontend contract summary

Extend `packages/api-client/src/resources/communications.ts`:

```ts
export interface BatchDetailYourRow {
  recipient_id: number
  user_id: number
  name: string | null
  email: string          // masked for committee callers
  status: 'queued' | 'sent' | 'delivered' | 'opened' | 'bounced' | 'complained' | 'failed' | 'suppressed'
  status_reason: string | null
  provider_message_id: string | null
  sent_at: string | null
  delivered_at: string | null
  opened_at: string | null
  open_count: number
  bounced_at: string | null
  complained_at: string | null
}

export interface BatchDetail {
  batch_id: number
  flavor: string
  flavor_label: string
  subject: string
  body_html: string
  preview_html: string
  sender: { user_id: number | null; name: string | null; label: string }
  recipient_mode: 'ids' | 'filter' | 'transactional'
  recipient_filter: Record<string, string> | null
  counts: { matched: number; sent: number; failed: number; delivered: number; bounced: number; complained: number; suppressed: number }
  created_at: string
  your_row?: BatchDetailYourRow
  recipients: BatchDetailYourRow[]
  next_cursor: string | null
}

export const communications = {
  …,
  getBatch(clubId: number, batchId: number, params?: { user_id?: number; limit?: number; cursor?: string; status?: string[] }): Promise<BatchDetail>,
}
```

Also extend `MemberCommunication` on the per-member feed to carry the new delivery fields:

```ts
export interface MemberCommunication {
  …
  status: 'logged' | 'queued' | 'sent' | 'delivered' | 'opened' | 'bounced' | 'complained' | 'failed' | 'suppressed'
  delivered_at: string | null
  opened_at: string | null
  open_count: number
  bounced_at: string | null
  complained_at: string | null
}
```

View updates (one FE PR, lands immediately when this endpoint goes live):

- `MemberDetailView.vue` Communications tab — each email row gets a status cluster: *"✓ Delivered 09:13 · 👁 Opened 10:42 (2×)"* or *"✗ Bounced — mailbox full"*. Row stays clickable.
- On click, open a modal `EmailDetailModal` that calls `communications.getBatch(clubId, batchId, { user_id: memberId, limit: 1 })` and renders:
  - subject at the top
  - `preview_html` in an `<iframe sandbox>` for safe HTML display
  - `your_row` full timeline: `Sent → Delivered → Opened (N×)` or bounce / complaint reason
  - raw `body_html` behind a "View source" toggle (admin curiosity, not critical)
- Deferred: a dedicated `/crm/communications/:batch_id` route for the batch-wide view (every recipient's status). The mock `CampaignDetailView.vue` already stubs this — it'd swap its fixtures for the real endpoint. Not blocking the member-detail use case.

---

## 4. Verification (please attach outputs)

Using Nigel's JWT (owner of Naenae = `club_id=5`):

```bash
# 1. Pick a real batch_id — grab from any email row on /crm/members/8
curl -H "Authorization: Bearer $NIGEL_JWT" \
  "$API/clubs/5/members/8/communications?limit=5"
# → 200. Note the batch_id of row[0].

# 2. Fetch batch detail — default (first-recipient preview)
curl -H "Authorization: Bearer $NIGEL_JWT" \
  "$API/clubs/5/communications/$BATCH_ID"
# → 200, body_html + preview_html present, your_row absent.

# 3. Fetch batch detail with user_id — Nev's preview
curl -H "Authorization: Bearer $NIGEL_JWT" \
  "$API/clubs/5/communications/$BATCH_ID?user_id=8&limit=1"
# → 200, your_row populated for Nev, recipients[].length = 1.
# → your_row.opened_at + your_row.open_count reflect SES Open events (null / 0 if the recipient hasn't opened yet).

# 3a. Simulate an SES Open event via SNS test publish
#     → email_recipients.opened_at set, open_count = 1, status upgraded to 'opened'
# 3b. Re-fire the same Open event
#     → opened_at UNCHANGED, open_count = 2 (idempotency on timestamp, additive on count)

# 3c. Per-member feed carries the same delivery fields
curl -H "Authorization: Bearer $NIGEL_JWT" \
  "$API/clubs/5/members/8/communications?limit=5"
# → 200, items[].delivered_at + items[].opened_at + items[].open_count present on email rows,
#   null / 0 on note rows. counts.opened reflects the aggregate.

# 4. Negative — a user_id that wasn't in the batch
curl -i -H "Authorization: Bearer $NIGEL_JWT" \
  "$API/clubs/5/communications/$BATCH_ID?user_id=99999"
# → 404 { code: "user_not_in_batch" }

# 5. Negative — a player on the same club
curl -i -H "Authorization: Bearer $PLAYER_JWT" \
  "$API/clubs/5/communications/$BATCH_ID"
# → 403 { code: "forbidden" }

# 6. Cross-club safety
curl -i -H "Authorization: Bearer $NIGEL_JWT" \
  "$API/clubs/5/communications/$OTHER_CLUB_BATCH_ID"
# → 404 { code: "batch_not_found" }
```

Pass criteria:
- ✓ `preview_html` for a `user_id` shows that recipient's name / email substituted — different per recipient.
- ✓ `body_html` is identical across all `user_id` values (it's the pre-substitution source).
- ✓ `your_row.delivered_at` is populated on batches where SES delivered.
- ✓ `your_row.opened_at` is populated after the SES Open event lands via SNS; `open_count` increments on each subsequent Open.
- ✓ `your_row.status` upgrades `delivered → opened` on first Open but does NOT upgrade `bounced → opened` or `complained → opened`.
- ✓ Per-member feed email rows include `delivered_at` + `opened_at` + `open_count`. Note rows have them as `null` / `0`.
- ✓ Email address in `your_row.email` + `recipients[].email` is masked (`n***@q***.co.nz`) for committee callers, raw for owner / admin.
- ✓ Owner + admin + committee pass. Player fails with 403.

---

## 5. Non-goals (v1)

- **No click tracking.** Open tracking is in (§2a); click tracking (SES `Click` events) requires link-rewriting at send time and is a bigger change. If admins ask for *"did they click the Register link?"* we'll add it. For now, Open answers *"did they see it?"* which is enough.
- **No open-event heatmap or time-of-day analytics.** `open_count` is a scalar; we don't persist per-event timestamps. If per-open tracing becomes necessary, add a `email_opens` table in a follow-up.
- **No resend from the modal.** If the recipient needs a copy, admin composes a new one. Resend-UI is a follow-up.
- **No comment / annotation on an email send.** Notes live on `/notes`, not on the email row.
- **No PDF export of the rendered email.** Browser print is fine.
- **No bulk download of attachments.** We don't support attachments on send yet either.
- **No visibility into *which* image/link an open fired against.** SES Open fires on any pixel load — we treat it as a boolean "they viewed the email" and bump the count.

---

## 6. Contact

Ping Felicity in the frontend channel the moment this ships. The `EmailDetailModal` is one small FE PR — resource method + modal component + row-click handler on the Communications tab. Already drafted locally; waiting on the endpoint to go live.
