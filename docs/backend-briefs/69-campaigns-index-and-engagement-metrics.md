# Campaigns index + engagement metrics (open / click / unsubscribe)

**Feature:** turn the mock Communications index page into real data. Four cuts of the same underlying gap — *"after I send a broadcast I can't see how it actually went"*:

1. **Campaigns list** — paginated, searchable, status-filterable list of batches with per-row rolled-up metrics (sent / open rate / click rate). Replaces `apps/crm/src/views/communications/mockCampaigns.ts`.
2. **Hero metrics window** — rolling 30d (and 7d / 90d) aggregate: open rate, total sent, click rate, unsubscribes. Includes delta vs the previous window so the FE can render the "+4.2 pp" / "-1" trend chips you see on the hero cards.
3. **Click tracking** — brief 67 §5 explicitly deferred this as a non-goal; now it's the gating ask. Needs SES Click events + link rewriting + `click_count` + `clicked_at` on `email_recipients`.
4. **Unsubscribe tracking** — the `{{unsubscribe_url}}` token is already wired in the composer (brief 54 §4) but the public unsubscribe page + the suppression list don't exist. Needs an `email_unsubscribes` table, public GET + POST endpoints for the unsubscribe page, and a guard that stops future sends landing on suppressed addresses.

**Related briefs:**
- brief 54 — the `email_batches` + `email_recipients` tables + the SES Delivery / Bounce / Complaint ingestion that this brief extends with Open (already shipped per brief 67) + Click + Unsubscribe.
- brief 67 — email batch detail + delivery / open tracking (shipped 2026-10-30). §5 "No click tracking" and "No per-open timestamps" are the deferrals this brief unwinds.
- brief 45 — email templates (header + footer wrap). The unsubscribe link lives in the footer; this brief tightens how it's generated per-recipient.
- brief 46 — email flavour overrides. Campaigns are grouped by flavour on the index tabs (Broadcast / Transactional).

**Status:** backend not started. FE wiring sits behind `apps/crm/src/views/communications/CommunicationsView.vue` reading mock fixtures today — the shape below is the smallest change that lets us flip the view to live data without any UI refactor.

---

## TL;DR

1. **`GET /clubs/{club_id}/campaigns`** — paginated list of `email_batches` with per-row rolled-up metrics (sent / delivered / opened / clicked / bounced / unsubscribed), status filter (`sent | scheduled | draft`), search by subject, sort (`newest | oldest`), cursor pagination.
2. **`GET /clubs/{club_id}/campaigns/metrics?window=30d`** — aggregate hero stats for the 4 cards + delta vs previous window.
3. **Click tracking end-to-end** — enable SES Click events on the Configuration Set, rewrite links in `wrapClubEmail()` (brief 45) to the tracked redirect URL, ingest `Click` events in the SNS Lambda (brief 54 §6 + brief 67 §2a extended), add `click_count` / `clicked_at` on `email_recipients`, bump `counts` on the batch + the per-member feed.
4. **Unsubscribe end-to-end** — new `email_unsubscribes` table scoped by `club_id + email`, public `GET /u/{token}` → one-click confirm page, `POST /u/{token}/confirm` → write the row + mark the recipient unsubscribed, add a sender-side guard that suppresses unsubscribed addresses from any future bulk send + records the skip on `email_recipients`.

---

## Base URL — CRM API

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Owner / admin / committee JWT on `club_members` for the campaigns list + metrics. Unsubscribe pages are **public** (no auth) — they live on the public-site base (`torny.co.nz`) or on their own route under this API; either works, flag the choice.

---

## 1. `GET /clubs/{club_id}/campaigns`

### Query params

| Name | Required | Notes |
|---|---|---|
| `status` | no | Comma-list: `sent,scheduled,draft`. Default = all. The FE's `All / Sent / Scheduled / Drafts` tabs map to `undefined / 'sent' / 'scheduled' / 'draft'`. |
| `search` | no | Case-insensitive substring on `subject`. |
| `flavor` | no | Comma-list of brief 45 flavours. Default = `broadcast` (the composer only writes broadcasts; transactional lives on the member timeline). |
| `sort` | no | `newest` (default) or `oldest`. |
| `limit` | no | Default 25, max 100. |
| `cursor` | no | Opaque, `created_at + id` encoded. |

### 200 response

```jsonc
{
  "status": "success",
  "data": {
    "campaigns": [
      {
        "campaign_id":   1234,                       // same as email_batches.id
        "subject":       "Season kick-off — Saturday",
        "status":        "sent",                      // 'sent' | 'scheduled' | 'draft'
        "flavor":        "broadcast",
        "flavor_label":  "Broadcast",

        "audience_label": "All members",              // the preset the admin picked
        "audience_count": 142,                        // email_batches.matched_count snapshot
        "author": {
          "user_id":  12,
          "name":     "Grace Whittaker",
          "initials": "GW"
        },

        "sent_at":            "2026-10-18T22:14:03.000Z",   // null for scheduled / draft
        "scheduled_for":      null,                          // RFC3339 for 'scheduled', null otherwise
        "created_at":         "2026-10-18T22:14:00.000Z",

        "metrics": {                                  // null for drafts; partial for scheduled; full for sent
          "sent":          142,
          "delivered":     140,
          "opened":        111,
          "clicked":        46,
          "bounced":         1,
          "complained":      0,
          "unsubscribed":    0,
          "open_rate":    0.78,                       // 0..1, delivered-base. Null when sent === 0.
          "click_rate":   0.32                        // 0..1, delivered-base.
        }
      }
    ],
    "next_cursor": null,
    "counts_by_status": {                             // feeds the tab badges — total within the current filter EXCLUDING `status`
      "sent":      5,
      "scheduled": 1,
      "drafts":    3,
      "all":       9
    }
  }
}
```

### Field notes

- `metrics.sent` mirrors brief 54's `email_batches.sent_count`.
- `metrics.delivered` / `opened` / `clicked` / `bounced` / `complained` / `unsubscribed` are `SUM()`s on `email_recipients` grouped by `batch_id`. Open comes from brief 67's `opened_at IS NOT NULL`. Click comes from §3 below (`click_count > 0`). Unsubscribe comes from §4 below (`unsubscribed_at IS NOT NULL`).
- `open_rate` = `opened / NULLIF(delivered, 0)`. Same denominator for `click_rate`. Returns `null` when the batch has zero delivered rows.
- `counts_by_status` on the top-level — handy for the tab badges — ignores the current `status` filter but **respects** `search` + `flavor`. That way the tab counts update as the admin types in the search box.
- Drafts: when `status='draft'`, `metrics` is `null`, `sent_at` + `audience_count` can be `null`, only `subject` + `created_at` are guaranteed.

### Errors

| Status | code | When |
|---|---|---|
| `400` | `bad_cursor` | malformed cursor |
| `400` | `bad_status` | unknown value in `status` |
| `400` | `bad_sort` | unknown value in `sort` |
| `403` | `forbidden` | caller below committee (brief 66 gate — same role matrix) |

---

## 2. `GET /clubs/{club_id}/campaigns/metrics`

Hero stats for the four cards at the top of the index. Returns rates for the current window + the prior window of the same length so the FE can show a delta chip (*"+4.2 pp"*).

### Query params

| Name | Required | Notes |
|---|---|---|
| `window` | no | `7d` / `30d` (default) / `90d`. |

### 200 response

```jsonc
{
  "status": "success",
  "data": {
    "window": "30d",
    "range": { "from": "2026-09-30T00:00:00.000Z", "to": "2026-10-30T00:00:00.000Z" },
    "current": {
      "broadcasts":    3,
      "sent":        254,          // raw count across email_recipients where sent_at falls in range
      "delivered":   251,
      "opened":      199,
      "clicked":      83,
      "unsubscribed":  1,
      "open_rate":   0.79,
      "click_rate":  0.33,
      "unsubscribe_rate": 0.0039    // unsubscribed / sent (not delivered — admins want "spam risk" denominator)
    },
    "previous": {                   // same shape, same length window immediately before `range`
      "broadcasts":    2,
      "sent":        187,
      "delivered":   184,
      "opened":      136,
      "clicked":      59,
      "unsubscribed":  2,
      "open_rate":   0.74,
      "click_rate":  0.32,
      "unsubscribe_rate": 0.0107
    },
    "deltas": {
      "open_rate_pp":        4.2,   // percentage-point delta, signed
      "click_rate_pp":       1.3,
      "sent":               67,     // absolute delta
      "unsubscribe_count":  -1
    },
    "industry_benchmark": {         // optional — flag whether this is viable to compute; else drop these fields and we'll hardcode a label
      "open_rate":  0.38,
      "click_rate": 0.025
    }
  }
}
```

The industry benchmark is UI copy — if you'd rather not compute it, return `industry_benchmark: null` and the FE will render the hardcoded 38% / 2.5% that come from the Mailchimp "amateur sports" bucket. Not a blocker.

### Errors

| Status | code | When |
|---|---|---|
| `400` | `bad_window` | window outside the whitelist |
| `403` | `forbidden` | caller below committee |

---

## 3. Click tracking — unwind brief 67 §5

Brief 67 §5 shipped Open tracking only. The composer already renders `{{unsubscribe_url}}` and arbitrary `<a>` tags in the body; admins can see opens roll up but have no idea whether members actually tapped the Register / RSVP / Pay link. This section wires click tracking end-to-end.

### 3a. SES Configuration Set change

Add `Click` to the event types routed to the `torny-ses-events` SNS topic (brief 67 §2a). SES rewrites every `<a href>` to a tracked redirect URL automatically when Click tracking is enabled — no change needed in `wrapClubEmail()` on our side.

### 3b. Storage

Extend `email_recipients` (brief 54 + brief 67):

```sql
ALTER TABLE email_recipients
  ADD COLUMN clicked_at   TIMESTAMP NULL,
  ADD COLUMN click_count  INTEGER   NOT NULL DEFAULT 0;

CREATE INDEX idx_email_recipients_clicks
  ON email_recipients (club_id, clicked_at DESC)
  WHERE clicked_at IS NOT NULL;
```

Expand the status enum:

```
'queued' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | 'failed' | 'suppressed'
```

### 3c. Webhook handler

Extend `/internal/ses/events` (brief 54 §6, brief 67 §2a) with a Click case:

```js
case 'Click':
  await updateRecipient(messageId, {
    clicked_at: firstTimeOnly('clicked_at'),  // only set if currently NULL
    click_count: 'click_count + 1',           // SQL increment
    status: ifStatusIn(['sent','delivered','opened'], 'clicked'),
  });
  break;
```

Same idempotency rules as Open (brief 67 §2a). `click_count` increments on every SES Click event; `clicked_at` captures the first click only. Status transition order: `sent → delivered → opened → clicked`. `bounced` / `complained` block upgrades.

### 3d. Shape bumps

**Per-member feed** (brief 54 §4 / brief 67 §2b):

```jsonc
{
  "communication_id": 7,
  "channel":          "email",
  …,
  "clicked_at":  "2026-10-18T22:17:08.000Z",   // NEW
  "click_count": 3                              // NEW
}
```

**Batch detail `your_row`** (brief 67 §2):

```jsonc
"your_row": {
  …,
  "clicked_at":  "2026-10-18T22:17:08.000Z",
  "click_count": 3
}
```

**`counts` block** on both the per-member feed and the batch detail (brief 67 §2b):

```jsonc
"counts": {
  …,
  "clicked": 46       // NEW
}
```

### 3e. Non-goal

Per-link breakdowns (which specific URL got the click) — `mockCampaigns.ts` has a `CampaignLink[]` shape for a per-URL table on the batch detail page. SES click events do include the clicked URL in the payload, so this is feasible in a follow-up. V1 of this brief rolls up to the recipient level only — enough to populate the `click_rate` card on the hero + the `32%` on each campaign row.

---

## 4. Unsubscribe tracking — wire the token end-to-end

Composer previews render `{{unsubscribe_url}}` and the template footer includes it, but the public unsubscribe page doesn't exist. A member clicking the link today lands on a 404. This section is the full flow.

### 4a. Storage

```sql
CREATE TABLE email_unsubscribes (
  id            BIGSERIAL PRIMARY KEY,
  club_id       INTEGER   NOT NULL REFERENCES clubs(id),
  email         VARCHAR   NOT NULL,            -- normalised lower-case
  user_id       INTEGER   NULL REFERENCES users(id),  -- when the recipient was a known member
  reason        VARCHAR   NULL,                -- optional free-text from the public form
  unsubscribed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  source        VARCHAR   NOT NULL DEFAULT 'link',    -- 'link' | 'reply' | 'admin'
  resubscribed_at TIMESTAMP NULL                      -- admin can reverse via Settings; null = active unsub
);

CREATE UNIQUE INDEX uq_unsub_club_email
  ON email_unsubscribes (club_id, LOWER(email))
  WHERE resubscribed_at IS NULL;

ALTER TABLE email_recipients
  ADD COLUMN unsubscribed_at TIMESTAMP NULL;
```

Expand the status enum with `'unsubscribed'`:

```
… | 'unsubscribed' | …
```

### 4b. The link + the token

Replace the current `{{unsubscribe_url}}` substitution with a per-recipient signed token so the unsubscribe handler can resolve the exact `(club_id, recipient_id)` without the recipient exposing anything PII in the URL:

```
https://torny.co.nz/u/{token}
```

Token payload (JWT signed with the CRM stack secret; 90-day expiry so links in old emails still work):

```json
{ "club_id": 5, "recipient_id": 98771, "email_hash": "sha256:…" }
```

`email_hash` is a sanity check — the handler verifies the hash matches the stored email before confirming, so a leaked token can't be weaponised against a different address.

### 4c. Public unsubscribe page — `GET /u/{token}`

**Not** on the CRM base; lives on the public-site base (same host as the club microsites) so admins can't accidentally gate it behind auth. Returns an HTML page confirming the unsubscribe action:

- Verifies the token signature + expiry → otherwise show *"link expired — email the club directly."*
- Loads the `email_recipients` row + the batch's `club_id` + the club's name from `clubs_data`.
- Renders *"We'll stop emailing you from Naenae Bowling Club. [Confirm] [Cancel]"*
- Confirm POSTs to §4d.

Pure HTML, no auth, no SPA — must work in webmail link previews that pre-fetch URLs.

### 4d. Confirm — `POST /u/{token}/confirm`

Body:

```jsonc
{
  "reason": "Too many emails"          // optional free-text
}
```

Server behaviour:

1. Verify the token + email hash.
2. UPSERT `email_unsubscribes` by `(club_id, LOWER(email))`.
3. UPDATE the matching `email_recipients` row (and any other rows for the same `(club_id, user_id)` across the member's history) → `unsubscribed_at = NOW()`, bump status to `'unsubscribed'`.
4. UPDATE the sending `email_batches` row's rolled-up `unsubscribed_count`.
5. Return 200 with `{ status: "success", data: { confirmed_at: "…" } }`.

Idempotent — a second confirm on the same token is a no-op 200.

### 4e. Send-side guard

Extend `POST /clubs/{club_id}/members/bulk-email` (brief 54 §1 insert flow): after resolving the recipient triples (step 1), filter out any whose email appears in `email_unsubscribes` with `resubscribed_at IS NULL`. Insert a `status='suppressed'` + `status_reason='unsubscribed'` row for each so the batch's `counts.suppressed` reflects the honesty, and admins see them on the batch detail page.

Transactional sends (welcome, invite, enquiry reply) are **not** gated — admins doing operational work on a member still need to hit them. Only `flavor='broadcast'` + `flavor='owner_notification'` sends respect the suppression list in v1. Flag it in the response's `data.failed[]` with `reason: "unsubscribed"` so the composer can show *"1 skipped — Alison opted out."*.

### 4f. Admin-side override

Owners / admins can un-suppress via `POST /clubs/{club_id}/unsubscribes/{email}/resubscribe` — the row's `resubscribed_at` gets set and future sends to that address go through again. Required for the committee-vote flow where a member reaches out saying *"actually I did want those emails"*. v1 UI for this ships in a follow-up — just make sure the endpoint is live.

### 4g. Error table (unsubscribes)

| Status | code | When |
|---|---|---|
| `410` | `token_expired` | token older than 90 days |
| `400` | `token_invalid` | signature / hash mismatch |
| `404` | `recipient_not_found` | token's recipient_id doesn't exist / is from another club |

---

## 5. Frontend contract summary

New resource `packages/api-client/src/resources/campaigns.ts`:

```ts
export type CampaignStatus = 'sent' | 'scheduled' | 'draft'

export interface CampaignAuthor { user_id: number; name: string; initials: string }
export interface CampaignMetrics {
  sent: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  complained: number
  unsubscribed: number
  open_rate: number | null
  click_rate: number | null
}
export interface CampaignRow {
  campaign_id: number
  subject: string
  status: CampaignStatus
  flavor: string
  flavor_label: string
  audience_label: string | null
  audience_count: number | null
  author: CampaignAuthor
  sent_at: string | null
  scheduled_for: string | null
  created_at: string
  metrics: CampaignMetrics | null
}
export interface CampaignsListResponse {
  campaigns: CampaignRow[]
  next_cursor: string | null
  counts_by_status: { sent: number; scheduled: number; drafts: number; all: number }
}
export interface CampaignsMetricsResponse {
  window: '7d' | '30d' | '90d'
  range: { from: string; to: string }
  current: {…aggregates…}
  previous: {…aggregates…}
  deltas: { open_rate_pp: number; click_rate_pp: number; sent: number; unsubscribe_count: number }
  industry_benchmark: { open_rate: number; click_rate: number } | null
}

export const campaigns = {
  list(clubId: number, params?: { status?: CampaignStatus[]; search?: string; flavor?: string[]; sort?: 'newest'|'oldest'; limit?: number; cursor?: string }): Promise<CampaignsListResponse>,
  metrics(clubId: number, params?: { window?: '7d'|'30d'|'90d' }): Promise<CampaignsMetricsResponse>,
}
```

Extend the existing `MemberCommunication` + `BatchRecipient` + `BatchDetail` types with the new `clicked_at` / `click_count` / `unsubscribed_at` fields (brief 67 §3a types).

Views that light up when this ships:

- **`CommunicationsView.vue`** — drops `mockCampaigns` entirely. On mount: `campaigns.list(cid)` + `campaigns.metrics(cid, { window: '30d' })`. Tab filter + search + sort re-fire the list. The 4 hero cards read `current.*` + `deltas.*` for the trend chips.
- **`CampaignDetailView.vue`** — currently reads mock. Swap for `communications.getBatch(cid, batchId)` (brief 67 §2) which now carries the new click + unsubscribe fields.
- **Member Detail → Communications tab** — automatically gets click + unsubscribe timeline chips once the row shape bumps, via the existing `emailTimeline()` helper.

---

## 6. Verification

Using Nigel's JWT (owner of Naenae = `club_id = 5`):

```bash
# 1. Campaigns list — default (sent, newest first)
curl -H "Authorization: Bearer $NIGEL_JWT" "$API/clubs/5/campaigns?limit=5"
# → 200, campaigns[].metrics.open_rate within 0..1 or null, counts_by_status populated.

# 2. Tab filter
curl -H "Authorization: Bearer $NIGEL_JWT" "$API/clubs/5/campaigns?status=draft"
# → 200, every row has status='draft' and metrics=null.

# 3. Search
curl -H "Authorization: Bearer $NIGEL_JWT" "$API/clubs/5/campaigns?search=kick-off"
# → 200, only subjects containing "kick-off".

# 4. Hero metrics
curl -H "Authorization: Bearer $NIGEL_JWT" "$API/clubs/5/campaigns/metrics?window=30d"
# → 200, current + previous + deltas all populated. open_rate ≤ 1.

# 5. Click tracking
#    Send a test broadcast with a link, open it, click the link.
#    After ~10s:
curl -H "Authorization: Bearer $NIGEL_JWT" "$API/clubs/5/communications/$BATCH_ID?user_id=$MY_UID"
# → 200, your_row.clicked_at populated, click_count = 1, status = 'clicked'.
# Click again:
# → your_row.click_count = 2, clicked_at unchanged (first-click wins).

# 6. Unsubscribe flow
#    Visit the token URL from a sent email:
curl -i "https://torny.co.nz/u/$TOKEN"
# → 200 HTML page.
curl -i -X POST "https://torny.co.nz/u/$TOKEN/confirm" -H "Content-Type: application/json" -d '{"reason":"too many"}'
# → 200 { data.confirmed_at: "…" }
# Confirm the recipient now blocks future bulk sends:
curl -X POST -H "Authorization: Bearer $NIGEL_JWT" "$API/clubs/5/members/bulk-email" \
  -d '{"subject":"test","body_html":"<p>hi</p>","recipients":{"mode":"ids","user_ids":[$UNSUBBED_UID]}}'
# → 200, data.failed[0].reason = "unsubscribed".

# 7. Expired token
curl -i "https://torny.co.nz/u/$EXPIRED_TOKEN"
# → 410 { code: "token_expired" }

# 8. Admin resubscribe
curl -X POST -H "Authorization: Bearer $NIGEL_JWT" \
  "$API/clubs/5/unsubscribes/alison@example.co.nz/resubscribe"
# → 200. Subsequent bulk send to alison@ goes through.
```

Pass criteria:
- ✓ Campaign list metrics match a hand-rolled aggregate on `email_recipients`.
- ✓ Hero metrics `window=30d` match a hand-rolled aggregate scoped to `sent_at BETWEEN NOW() - 30d AND NOW()`.
- ✓ `deltas.open_rate_pp` is signed (negative when the current window is worse).
- ✓ Click event upgrades status `delivered → clicked`; `click_count` increments; `clicked_at` stays frozen on repeat clicks.
- ✓ Clicked after bounced doesn't downgrade to `clicked` (impossible state anyway, but should be guarded).
- ✓ Unsubscribe GET renders without auth; POST confirm is idempotent.
- ✓ Future bulk sends respect the suppression list; transactional sends ignore it.
- ✓ Resubscribe restores future sends.

---

## 7. Non-goals (v1)

- **No scheduled sends.** The composer's immediate-send-only behaviour stays. The `scheduled` status + the Scheduled tab render empty from the backend side; the FE will show the tab but it'll always count 0 until a follow-up brief adds `POST /campaigns/schedule`.
- **No drafts.** Same deal — the composer doesn't save partials to the backend. The Drafts tab stays as a 0-count placeholder.
- **No per-link click breakdown.** Rolls up to the recipient level only — brief includes `click_count` and the batch's `counts.clicked`, but not *which URL*. If admins need per-URL analytics, follow-up brief adds an `email_clicks` child table that records every Click event with the URL in it.
- **No resubscribe UI.** The endpoint ships but the Settings → Suppressions screen is a follow-up.
- **No unsubscribe-reason analytics.** The `reason` column is captured but not surfaced on any read endpoint yet.
- **No `email_opens` child table** (per-event history). Brief 67 non-goal still stands; `open_count` is a scalar.
- **No campaign editing after send.** `/campaigns/{id}` is read-only — admins recompose if they need to resend.
- **No search beyond subject.** No full-text search on body / audience / author. If admins ask, follow-up.

---

## 8. Contact

Ping Felicity when §1 + §2 ship — the Communications index flips off mocks in a one-PR FE change (resource file + mount), zero visual refactor needed. §3 (click) + §4 (unsubscribe) can land in follow-up PRs if timing is tight; the index renders cleanly without them (just reads `clicked`/`unsubscribed` as 0 until the data starts flowing).
