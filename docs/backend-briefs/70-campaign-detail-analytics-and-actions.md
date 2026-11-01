# Campaign detail — per-link click breakdown + hero analytics + actions

**Feature:** power the Campaign Detail page (`apps/crm/src/views/communications/CampaignDetailView.vue`, Paper artboard 78). Brief 69 wired the campaigns index + the recipient-level click rollup; brief 67 wired `GET /communications/{batch_id}` with the per-recipient timeline. This brief fills the three remaining gaps the detail page needs:

1. **Per-link click breakdown** — the "Click breakdown" card (*"46 clicks on 3 links"*) needs the actual URL + click counts, not a recipient-level rollup. Brief 69 §3e explicitly deferred this; it's now the gating ask for the detail page.
2. **Hero analytics on the batch** — the "At a glance" rail wants `first_open_at`, `peak_open_hour`, `avg_opens_per_opened`, plus a canonical `audience_label` (e.g. *"All active members"*) and `sent_at` as a distinct field from `created_at`. Nothing exotic — just rolled-up derivations of what's already in `email_recipients`.
3. **Follow-up actions** — "Resend to unopened" (one-click resend of the same body/subject to recipients whose `opened_at IS NULL`), "Archive" (hide from the campaigns index without losing the data).

**Related briefs:**
- brief 54 — `email_batches` + `email_recipients` tables.
- brief 67 — `GET /communications/{batch_id}` + delivery / open tracking.
- brief 69 — campaigns index + metrics + click tracking (recipient-level) + unsubscribe. §3e deferred per-link breakdown; this brief unwinds it.

**Status:** backend not started. FE will land in the same PR as this brief with `CampaignDetailView.vue` reading mock data shaped to §2's response — zero visual refactor needed once the endpoint flips on.

---

## TL;DR

1. **Extend `GET /clubs/{club_id}/communications/{batch_id}`** (brief 67) with:
   - `audience_label` (string) — human-readable preset the admin picked at send time.
   - `sent_at` (string) — the actual SES `send_time`, distinct from the `created_at` row-insert timestamp.
   - `analytics` block — `first_open_at`, `peak_open_hour`, `avg_opens_per_opened`, `delivered_not_opened` (so the FE doesn't have to subtract on the client).
   - `links` array — `{ url, clicks, unique_clickers, ctr }[]`, sorted by `clicks DESC`. Requires an `email_clicks` child table (§2 below) to key clicks to URLs.
2. **New `email_clicks` table** — records every SES Click event with the clicked URL. Keyed on `(recipient_id, url, clicked_at)` so a recipient clicking the same link twice records two rows but still counts as one unique clicker. The existing `email_recipients.click_count` + `clicked_at` stay as the fast-path denormalisation.
3. **`POST /clubs/{club_id}/communications/{batch_id}/resend-unopened`** — synthesises a new batch targeted at the subset of `email_recipients` where `opened_at IS NULL` + `status NOT IN ('bounced','complained','unsubscribed','suppressed')`. Reuses the original `subject` + `body_html`. Returns the new `batch_id`.
4. **`POST /clubs/{club_id}/communications/{batch_id}/archive`** + **`DELETE`** on the same path to restore. Adds `archived_at` on `email_batches`. The campaigns index (brief 69 §1) filters archived rows out unless `?archived=1`.

---

## Base URL — CRM API

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Owner / admin / committee JWT on `club_members` for all four endpoints (brief 66 gate — same role matrix).

---

## 1. Extend `GET /clubs/{club_id}/communications/{batch_id}` (brief 67)

Already live. Three additions, no breaking changes.

### 1a. New top-level fields

```jsonc
{
  "status": "success",
  "data": {
    "batch_id":        1234,
    "flavor":          "broadcast",
    "flavor_label":    "Broadcast",
    "subject":         "Season kick-off — Saturday",
    "body_html":       "…",
    "preview_html":    "…",
    "sender":          {…},                              // brief 67
    "recipient_mode":  "filter",
    "recipient_filter": {…},

    // ── NEW ───────────────────────────────────────────────────────
    "audience_label":  "All active members",             // human-readable preset
    "sent_at":         "2026-10-30T19:02:14.000Z",       // SES send_time, distinct from created_at
    "archived_at":     null,                             // §4 — null = active, timestamp = hidden from index

    "counts":          {…},                              // unchanged — brief 67 shape + clicked (brief 69)
    "created_at":      "2026-10-30T19:02:00.000Z",       // unchanged — row insert
    "your_row":        {…},                              // unchanged
    "recipients":      [{…}],                            // unchanged
    "pagination":      {…},                              // unchanged

    // ── NEW ───────────────────────────────────────────────────────
    "analytics": {
      "first_open_at":          "2026-10-30T19:08:03.000Z",  // MIN(opened_at)
      "peak_open_hour":         { "hour": "2026-10-30T19:00:00.000Z", "opens": 72 },
      "avg_opens_per_opened":   2.1,                          // SUM(open_count) / COUNT(opened_at NOT NULL)
      "delivered_not_opened":   20                            // delivered - opened
    },

    "links": [
      {
        "url":             "https://naenaebowls.nz/signin",
        "clicks":          31,
        "unique_clickers": 24,
        "ctr":             0.221                             // unique_clickers / delivered
      },
      {
        "url":             "https://naenaebowls.nz/events/twilight-triples",
        "clicks":          12,
        "unique_clickers": 11,
        "ctr":             0.079
      },
      {
        "url":             "https://goo.gl/maps/clubroom",
        "clicks":          3,
        "unique_clickers": 3,
        "ctr":             0.021
      }
    ]
  }
}
```

### 1b. Field notes

- `audience_label`: snapshot taken at send time. For admin-picked presets (`"All members"`, `"Unpaid filter · 18 members"`) store the label the composer sent. For raw `recipient_mode: "ids"` sends, synthesise one on read: `"{n} recipients"`.
- `sent_at`: the SES `send_time`. For historical rows pre-this-brief, fall back to `created_at`.
- `analytics.peak_open_hour.hour`: the 1-hour UTC bucket (hour-truncated timestamp) with the most `opened_at` rows. Ties broken by earliest. `null` when zero opens.
- `analytics.avg_opens_per_opened`: `SUM(open_count) / NULLIF(COUNT(opened_at NOT NULL), 0)`. Reported to 1 decimal place. `null` when no opens.
- `links[]`: sorted by `clicks DESC`. Empty array when the body has no `<a href>` tags or no clicks have been recorded. CTR denominator is `delivered` (not `sent`) to match the hero `click_rate` in brief 69.
- `links[].url`: the destination URL, NOT the SES-rewritten tracked redirect. Normalise trailing-slash + strip query-string tracking params (`utm_*`, `fbclid`, `gclid`) so links to the same canonical page roll up.

### 1c. Errors

Unchanged from brief 67.

---

## 2. New `email_clicks` child table

Brief 69 §3e records click rollups on `email_recipients` (`click_count`, `clicked_at`) but not *which URL*. For the per-link breakdown we need an event-level child table.

```sql
CREATE TABLE email_clicks (
  id            BIGSERIAL PRIMARY KEY,
  batch_id      INTEGER   NOT NULL REFERENCES email_batches(id) ON DELETE CASCADE,
  recipient_id  INTEGER   NOT NULL REFERENCES email_recipients(id) ON DELETE CASCADE,
  url           TEXT      NOT NULL,                 -- normalised: trailing-slash + utm_ stripped
  clicked_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_clicks_batch_url
  ON email_clicks (batch_id, url);

CREATE INDEX idx_email_clicks_recipient
  ON email_clicks (recipient_id, clicked_at DESC);
```

### 2a. Webhook change

Extend the SNS `Click` handler (brief 69 §3c) to also INSERT a row here:

```js
case 'Click':
  // Existing: bump email_recipients.click_count + clicked_at
  await updateRecipient(messageId, { … });
  // NEW: record the URL + timestamp for the per-link breakdown
  await insertClick({
    batch_id:     recipient.batch_id,
    recipient_id: recipient.id,
    url:          normaliseUrl(evt.click.link),       // see 2b
    clicked_at:   new Date(evt.click.timestamp),
  });
  break;
```

### 2b. URL normalisation

```ts
function normaliseUrl(raw: string): string {
  const u = new URL(raw)
  // Strip tracking params so same-destination clicks roll up.
  for (const key of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|mc_cid|mc_eid)/.test(key)) u.searchParams.delete(key)
  }
  // Trim trailing slash on bare paths (keep '/' for root).
  if (u.pathname !== '/' && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1)
  return u.toString()
}
```

### 2c. Non-goal

- No per-click geo / IP / UA (SES Click events include these but we don't need them for this card).
- No historical backfill of click events pre-this-brief — rows show up starting from the deploy window.

---

## 3. `POST /clubs/{club_id}/communications/{batch_id}/resend-unopened`

### Body

No body required. Admin can optionally pass `exclude_user_ids: number[]` to skip specific recipients.

### 200 response

```jsonc
{
  "status": "success",
  "data": {
    "new_batch_id":    1256,
    "resend_count":    20,                              // recipients targeted
    "skipped_count":    3,                              // bounced/complained/unsubscribed/suppressed
    "skipped_reasons": {
      "bounced":       2,
      "unsubscribed":  1
    }
  }
}
```

### Behaviour

1. Load the original batch's `subject`, `body_html`, `sender_user_id`, `flavor`.
2. Resolve the recipient set: `email_recipients WHERE batch_id = {original} AND opened_at IS NULL AND status NOT IN ('bounced','complained','unsubscribed','suppressed')`.
3. If `exclude_user_ids` present, remove those.
4. If the resolved set is empty, return `409 nothing_to_resend`.
5. Reuse the standard bulk send path (brief 54 §1) — this means the suppression list (brief 69 §4e) is re-applied, which is why the response's `skipped_count` may be bigger than you'd expect from the filter alone.
6. The new batch's `audience_label` is auto-synthesised as `"Unopened from batch #{original_id}"`.
7. The new batch gets its own `batch_id`; the original isn't mutated.

### Errors

| Status | code | When |
|---|---|---|
| `404` | `batch_not_found` | id doesn't exist / wrong club |
| `409` | `nothing_to_resend` | zero recipients after filter |
| `409` | `archived` | original batch is archived (unarchive first) |
| `403` | `forbidden` | caller below committee |

---

## 4. `POST /clubs/{club_id}/communications/{batch_id}/archive` + `DELETE` to restore

### Behaviour

- `POST` sets `email_batches.archived_at = NOW()`. Idempotent — a second POST on an already-archived batch is a no-op 200.
- `DELETE` sets `archived_at = NULL`. Idempotent — a DELETE on a non-archived batch is a no-op 200.
- Archive does not touch recipients, analytics, or the per-member feed — the batch simply disappears from the campaigns index (brief 69 §1) unless `?archived=1` is passed.
- Analytics endpoints (`GET /communications/{batch_id}`, the per-member feed) continue to return archived batches as normal — the archive is just an index-filter, not a soft-delete.

### 200 response (both endpoints)

```jsonc
{
  "status": "success",
  "data": { "batch_id": 1234, "archived_at": "2026-10-30T22:00:00.000Z" }  // null on DELETE
}
```

### Campaigns index change (brief 69 §1)

Add a query param:

| Name | Required | Notes |
|---|---|---|
| `archived` | no | `0` (default) hides archived. `1` returns only archived. `any` returns both. |

`counts_by_status` always ignores the `archived` filter (so the tab badges still show live totals).

### Errors

| Status | code | When |
|---|---|---|
| `404` | `batch_not_found` | id doesn't exist / wrong club |
| `403` | `forbidden` | caller below committee |

---

## 5. Frontend contract summary

Extend `BatchDetail` in `packages/api-client/src/resources/communications.ts`:

```ts
export interface BatchAnalytics {
  first_open_at: string | null
  peak_open_hour: { hour: string; opens: number } | null
  avg_opens_per_opened: number | null
  delivered_not_opened: number
}

export interface BatchLink {
  url: string
  clicks: number
  unique_clickers: number
  ctr: number        // 0..1, delivered-base
}

export interface BatchDetail {
  // ...existing fields from brief 67...
  audience_label: string
  sent_at: string
  archived_at: string | null
  analytics: BatchAnalytics
  links: BatchLink[]
}
```

New functions:

```ts
export async function resendUnopened(
  clubId: number,
  batchId: number,
  input?: { exclude_user_ids?: number[] },
): Promise<{ new_batch_id: number; resend_count: number; skipped_count: number; skipped_reasons: Record<string, number> }>

export async function archiveBatch(clubId: number, batchId: number): Promise<{ batch_id: number; archived_at: string }>
export async function unarchiveBatch(clubId: number, batchId: number): Promise<{ batch_id: number; archived_at: null }>
```

Views that light up when this ships:

- **`CampaignDetailView.vue`** — currently reads `mockCampaigns.ts`. One-PR swap to `communications.getBatch(cid, batchId)` with the new fields consumed inline (no refactor — the mock mirror shape matches the spec here).
- **`CommunicationsView.vue`** — gets an `archived=1` toggle in a follow-up Settings → Archive view. Zero change in v1 of this brief.

---

## 6. Verification

Using Nigel's JWT (owner of Naenae = `club_id = 5`), against a real sent broadcast:

```bash
# 1. Batch detail with new fields
curl -H "Authorization: Bearer $NIGEL_JWT" "$API/clubs/5/communications/$BATCH_ID?user_id=$MY_UID"
# → 200. Required new fields present:
#   data.audience_label         (string)
#   data.sent_at                (RFC3339)
#   data.archived_at            (null)
#   data.analytics.first_open_at
#   data.analytics.peak_open_hour.{hour,opens}
#   data.analytics.avg_opens_per_opened
#   data.analytics.delivered_not_opened
#   data.links                  (array, sorted by clicks DESC)

# 2. Per-link breakdown sanity
#    links[].clicks sum should equal counts.clicked (within rounding — multiple clicks per recipient roll up on counts).
#    links[].unique_clickers sum ≤ counts.clicked.
#    links[].ctr = unique_clickers / counts.delivered.

# 3. Resend to unopened
curl -X POST -H "Authorization: Bearer $NIGEL_JWT" \
  "$API/clubs/5/communications/$BATCH_ID/resend-unopened"
# → 200 { new_batch_id, resend_count, skipped_count, skipped_reasons }
# Then GET the new batch:
curl -H "Authorization: Bearer $NIGEL_JWT" "$API/clubs/5/communications/$NEW_BATCH_ID"
# → audience_label = "Unopened from batch #$BATCH_ID", counts.sent = resend_count.

# 4. Resend when nothing to resend
curl -X POST -H "Authorization: Bearer $NIGEL_JWT" \
  "$API/clubs/5/communications/$FULLY_OPENED_BATCH/resend-unopened"
# → 409 { code: "nothing_to_resend" }

# 5. Archive + unarchive
curl -X POST -H "Authorization: Bearer $NIGEL_JWT" \
  "$API/clubs/5/communications/$BATCH_ID/archive"
# → 200 { archived_at: "…" }
curl -H "Authorization: Bearer $NIGEL_JWT" "$API/clubs/5/campaigns?limit=50"
# → 200, $BATCH_ID NOT in campaigns[].
curl -H "Authorization: Bearer $NIGEL_JWT" "$API/clubs/5/campaigns?archived=1&limit=50"
# → 200, $BATCH_ID IS in campaigns[].
curl -X DELETE -H "Authorization: Bearer $NIGEL_JWT" \
  "$API/clubs/5/communications/$BATCH_ID/archive"
# → 200 { archived_at: null }

# 6. Archive on a never-sent draft isn't valid in v1 (drafts aren't persisted — brief 69 §7)
# so just confirm the endpoint returns 404 cleanly on a non-existent batch_id.

# 7. Permissions
curl -H "Authorization: Bearer $PLAYER_JWT" "$API/clubs/5/communications/$BATCH_ID"
# → 403 { code: "forbidden" }
```

Pass criteria:
- ✓ `links[].clicks` summed matches `COUNT(*)` on `email_clicks WHERE batch_id = $BATCH_ID`.
- ✓ `links[].unique_clickers` matches `COUNT(DISTINCT recipient_id)` on same.
- ✓ `analytics.peak_open_hour.opens` matches a hand-rolled `GROUP BY date_trunc('hour', opened_at)`.
- ✓ `analytics.avg_opens_per_opened` is `null` (not `NaN`) on a batch with zero opens.
- ✓ Resend-unopened honours suppression list (brief 69 §4e) and reports skipped counts correctly.
- ✓ Archive is reversible via DELETE and the index filter behaves per `?archived=` values.
- ✓ Archived batches are still readable via `GET /communications/{batch_id}` — the archive is index-only.

---

## 7. Non-goals (v1)

- **No per-link geo / device breakdown.** The `mockCampaigns.ts` fixture had a `device_split` field; we're dropping that from the detail view in favour of per-link clicks. If admins ask, follow-up brief adds `email_clicks.user_agent` + aggregation.
- **No per-recipient click-URL list.** You can see *that* a recipient clicked (brief 69) and *which URLs got clicks* (this brief), but not *which recipient clicked which URL*. The data's in `email_clicks` so a follow-up endpoint is cheap; just not needed for the detail page.
- **No "duplicate as draft".** The detail page's follow-up actions include this but drafts aren't backed (brief 69 §7). FE will handle it by pre-filling the composer with the subject + body on the client — no backend needed.
- **No archive bulk action.** v1 archives one batch at a time. If admins start accumulating hundreds of broadcasts a bulk archive endpoint is a small follow-up.
- **No campaign editing after send.** `/communications/{batch_id}` stays read-only (brief 69 §7).
- **No reply-tracking.** Members replying to a broadcast land in the sender's inbox, not in Torny. Not in scope.

---

## 8. Contact

Ping Felicity when §1 ships — the detail view flips off mocks in a one-PR FE change. §2 (`email_clicks` table) is the gating ask for the "Click breakdown" card; without it that card renders empty. §3 + §4 can land as follow-ups — the detail page shows the buttons but surfaces a *"Not available yet"* tooltip until they're live.
