# Admin portal redesign — self-serve signup + transactional revenue

**Feature:** redesign the Torny platform admin portal around a self-serve signup world. The current portal is built around the "claim queue" — someone requests a club, we approve or reject. That model is gone: anyone can sign up for Torny directly. What we actually need to admin now is a live SaaS business: who's signed up, who's active, who's paying, who's using the transactional features (venue bookings, tournament entries), what Torny is earning on each, and support tooling (impersonate, comp plan, suspend).

**Status:** specced here, nothing shipped. Written during product discussion on 2026-11-26. The FE will be rebuilt around this contract once the backend is firm. The old `/admin/claims` surface + endpoints should be deleted once this brief lands — do not maintain both.

**Why this shape, not something else:**
- Two revenue axes to track, not one. Subscription MRR (Starter/Pro) is predictable and boring; transactional revenue (platform take on bookings, entry fees, add-on commissions) scales with club usage and is the whole point of the Shopify-shape model we're moving toward (brief 122 + the paid-site build-out we're doing for Bowls Wellington). Admin surface must surface *both* independently and combined.
- Activity metrics (bookings, tournament entries, member joins, emails sent) matter as much as revenue — they're the leading indicators. A club with high bookings this month is a Pro upgrade target; a club with zero activity 30 days post-signup is a churn-prevention target.
- One-click impersonation is non-negotiable for support. Nothing else is a substitute when "I can't see my tournaments" comes in on email at 6pm.
- "Platform take" must be a trivial `SUM(platform_fee_cents)` on every transaction type, not a reconstructed derivation. See §10 — data model change up front saves endless downstream rebuilds.

**Related briefs:**
- brief 93 (plan on session hydrate) — `plan` already exists on `/me`; this brief extends it to a `platform_owner` role flag (§3.1).
- brief 122 (paid add-on blocks) — add-on revenue will flow into the same transactional-revenue totals once the first paid add-on ships. The schema shape in §10 already accommodates it.
- brief 86 (plan tiers landed) — subscription MRR source of truth. No changes to those endpoints; admin reads them.

---

## 1. Base URL

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Platform-owner JWT required on every endpoint in this brief unless stated. See §3.1 for the role gate.

---

## 2. What we're deleting

- `/admin/claims` and all nested routes. Pending / approved / rejected lists, approve/reject actions, waiting-time metrics. The "someone requests a club → we approve" workflow is gone — remove the queue, the state machine, and the DB tables (archive, don't drop, until FE rollover is complete).
- `/admin/members` at the platform level. Super-admin doesn't need to list every member across every tenant (privacy + no legitimate use case). Member *counts* and aggregate stats live on the Accounts row + detail; individual member drilldown is per-club via impersonation.
- Any admin UI tied to the claim workflow (notifications, email templates, etc.).

Keep these but reshape:
- `/admin/overview` → becomes the new **Dashboard** (§5.1).
- `/admin/clubs` → becomes **Accounts** (§4), enriched + renamed.
- `/admin/users` → stays, reshaped for platform-level visibility (§7).

---

## 3. Shared concerns

### 3.1 Auth gate — `platform_owner` role

Every endpoint in this brief requires the caller's JWT to carry `role === 'platform_owner'`. This is a new role distinct from per-club `admin` / `owner`:

- `platform_owner` can see across every tenant, impersonate any club, override plans, pull revenue.
- Per-club `owner` and `admin` have no access to any `/admin/*` endpoint and 403 on all of them.

A platform_owner call that would scope to a specific club (impersonation, comp plan) is logged — see §9 audit requirements.

Return `403 not_platform_owner` on failed gate checks. Do not reveal endpoint shape (no response body with field hints) on 403.

### 3.2 Time ranges

Default window for every "30d" metric is the trailing 30 calendar days, UTC. Every endpoint that returns a windowed metric also accepts `?window=7d|30d|90d|ytd|all` so the FE can toggle without refetching the whole payload. Server rejects unknown values with `400 bad_window`.

### 3.3 Pagination

List endpoints use cursor pagination:

```jsonc
{
  "items": [ ... ],
  "next_cursor": "opaque-string-or-null",
  "total_count": 247   // approximate, EXPLAIN-cheap OK; omit if expensive
}
```

Default page size 50, max 200. `?cursor=<opaque>` to continue. `total_count` is advisory — FE shows "showing 50 of ~247".

### 3.4 Money representation

Every monetary value is **cents, integer, NZD**. Field names end in `_cents`:

```jsonc
{ "mrr_cents": 15700, "platform_take_30d_cents": 2340 }
```

Currency conversion (AUD, GBP later) is a non-goal for this brief — brief 123 is NZD-only. Multi-currency admin is a follow-up.

---

## 4. Accounts

The core list + detail — replaces the old `/admin/clubs` surface.

### 4.1 `GET /admin/accounts` — paginated list

Response:

```jsonc
{
  "items": [
    {
      "id": 123,
      "name": "Naenae Bowling Club",
      "subdomain": "naenae-bowling-club",
      "owner_email": "manager@naenaebc.co.nz",
      "signup_at": "2026-04-12T03:22:11Z",
      "last_admin_login_at": "2026-11-25T19:40:00Z",

      "plan": "pro",                       // 'starter' | 'pro' | 'comped'
      "plan_source": "derived",            // 'derived' from Stripe | 'manual' (comp)
      "subscription_status": "active",     // mirrors Stripe subscription.status
      "mrr_cents": 7900,                   // monthly recurring; 0 for starter, 0 for canceled
      "lifetime_revenue_cents": 94800,     // subscription + transactional, lifetime
      "addons": ["tournaments-pro"],       // brief 122 — active entitlements

      // Activity + transactional — window defaults to 30d
      "member_count": 182,
      "member_joins_30d": 6,
      "bookings_30d": 14,
      "bookings_gmv_30d_cents": 342000,    // gross $ booked
      "tournament_entries_30d": 48,
      "tournament_gmv_30d_cents": 115200,
      "emails_sent_30d": 412,
      "platform_take_30d_cents": 8930,     // what Torny earned on their transactions
                                            // (subscription + application_fee_amount on
                                            // bookings + entries + add-ons)

      // Support flags — non-null when flagged
      "flags": {
        "past_due": true,                  // Stripe past_due state
        "high_bounce_rate": false,
        "suspended": false,
        "comped_until": "2027-04-12T00:00:00Z"   // null when not comped
      }
    }
  ],
  "next_cursor": null,
  "total_count": 247
}
```

Query params:

- `?window=7d|30d|90d|ytd|all` — applies to every `_30d` field; renamed in the response to match (`_7d`, `_90d`, etc.).
- `?filter[plan]=starter|pro|comped`
- `?filter[status]=active|trialing|past_due|canceled|suspended`
- `?filter[inactive_days]=30` — clubs with no admin login in >N days
- `?filter[has_transactions]=true` — only clubs with bookings OR entries in the window
- `?sort=mrr|revenue|members|signup|last_login|bookings|tournament_gmv` — append `-` prefix for desc (`?sort=-mrr`). Default `-last_login`.
- `?q=<search>` — matches name, subdomain, owner_email (case-insensitive substring).

### 4.2 `GET /admin/accounts/:id` — single account detail

Returns the row shape from §4.1 + a `timeline` array of events:

```jsonc
{
  "account": { ...row shape as above... },
  "timeline": [
    { "at": "2026-04-12T03:22:11Z", "kind": "signup", "detail": null },
    { "at": "2026-04-19T10:02:00Z", "kind": "plan_change", "detail": { "from": "starter", "to": "pro" } },
    { "at": "2026-07-04T22:15:00Z", "kind": "payment_failed", "detail": { "amount_cents": 7900, "reason": "card_declined" } },
    { "at": "2026-07-05T08:11:00Z", "kind": "payment_recovered", "detail": { "amount_cents": 7900 } },
    { "at": "2026-11-20T14:40:00Z", "kind": "support_flagged", "detail": { "note": "Email bounce rate climbing", "by": "owner@torny.pro" } }
  ]
}
```

Timeline event `kind` values — enumerate these; FE renders a specific icon per kind:
- `signup`, `plan_change`, `addon_added`, `addon_removed`, `payment_succeeded` (abbreviate if noisy), `payment_failed`, `payment_recovered`, `subscription_canceled`, `impersonated` (who, when — audit trail), `comped`, `suspended`, `unsuspended`, `support_flagged`.

Noise control: `?timeline_since=<iso>` to tail. Default: last 90 days.

### 4.3 `GET /admin/accounts/:id/transactions` — drilldown

Paginated list of transactional events for the Transactions tab of the account detail page. Polymorphic — venue bookings + tournament entries + add-on subscription charges in one chronological stream.

```jsonc
{
  "items": [
    {
      "id": "txn_abc123",
      "at": "2026-11-20T18:15:00Z",
      "kind": "venue_booking",            // 'venue_booking' | 'tournament_entry' | 'subscription_charge' | 'addon_charge'
      "amount_cents": 45000,              // gross — what the member/customer paid
      "platform_fee_cents": 1125,         // what Torny earned (2.5% of 45000)
      "club_net_cents": 43875,            // what the club got (minus Stripe fees)
      "stripe_charge_id": "ch_abc",
      "stripe_dashboard_url": "https://dashboard.stripe.com/payments/ch_abc",
      "ref": {                            // what this transaction was for
        "kind": "venue_booking",
        "id": 982,
        "label": "Clubhouse · Saturday afternoon"
      },
      "member": {                         // nullable — null for anonymous bookings
        "id": 5522,
        "name": "Grace Whittaker",
        "email": "g.whittaker@example.com"
      },
      "status": "succeeded"               // 'succeeded' | 'refunded' | 'failed' | 'pending'
    }
  ],
  "next_cursor": null,
  "total_count": 1420,
  "aggregates": {                         // window-scoped
    "gross_cents": 1420000,
    "platform_take_cents": 35500,
    "count_by_kind": {
      "venue_booking": 24,
      "tournament_entry": 142,
      "addon_charge": 1,
      "subscription_charge": 8
    }
  }
}
```

Query params:
- `?window=7d|30d|90d|ytd|all` — scoped to transactions in window
- `?filter[kind]=venue_booking|tournament_entry|subscription_charge|addon_charge` — can repeat
- `?filter[status]=succeeded|refunded|failed|pending`
- `?sort=-at` (default) or `-amount_cents`

---

## 5. Metrics — platform dashboards

Two dashboards: overview (growth + health) and billing (revenue split). Both are read-only aggregates.

### 5.1 `GET /admin/metrics/overview`

Returns the Dashboard numbers:

```jsonc
{
  "window": "30d",
  "accounts": {
    "total": 247,
    "signups_in_window": 14,
    "active_in_window": 203,              // had admin login in window
    "paying": 48,                         // plan === 'pro' with active subscription
    "comped": 3,                          // manual plan overrides
    "past_due": 2,
    "churned_in_window": 1                // canceled subs
  },
  "revenue_cents": {
    "mrr": 378400,                        // sum of active Pro subscriptions × plan price
    "transactional_in_window": 42350,     // platform fee on bookings + entries + add-ons
    "total_in_window": 420750             // mrr prorated for window + transactional
  },
  "activity": {
    "bookings_in_window": 184,
    "bookings_gmv_in_window_cents": 4820000,
    "tournament_entries_in_window": 622,
    "tournament_gmv_in_window_cents": 1493000,
    "emails_sent_in_window": 48230,
    "member_joins_in_window": 83
  },
  "trends": {                             // 12-point sparkline, oldest first, aligned to window grain
    "mrr_cents": [320000, 330000, ...],
    "transactional_cents": [...],
    "signups": [...],
    "churn": [...]
  }
}
```

### 5.2 `GET /admin/metrics/billing`

Billing-focused. Separate endpoint so the Billing page doesn't need the overview junk:

```jsonc
{
  "window": "30d",
  "subscription": {
    "mrr_cents": 378400,
    "annualised_cents": 4540800,          // mrr × 12
    "trend_cents": [...]                  // same grain as overview
  },
  "transactional": {
    "gmv_cents": 6313000,                 // total gross volume through Torny Connect
    "platform_take_cents": 42350,
    "effective_take_rate": 0.0067,        // 0.67% — informational
    "trend_platform_take_cents": [...],
    "by_kind": {
      "venue_booking_gmv_cents": 4820000,
      "venue_booking_take_cents": 24100,
      "tournament_entry_gmv_cents": 1493000,
      "tournament_entry_take_cents": 18250,
      "addon_gmv_cents": 0,
      "addon_take_cents": 0
    }
  },
  "failed_payments": {
    "past_due_count": 2,
    "past_due_value_cents": 15800,
    "retrying": 1
  },
  "stripe_payouts": {
    "pending_cents": 32400,
    "last_payout_at": "2026-11-24T00:00:00Z",
    "last_payout_cents": 184000
  }
}
```

### 5.3 `GET /admin/metrics/activity` *(optional for V1)*

Pure activity (no revenue) — if the dashboard needs a dedicated activity view separate from overview. Defer unless the FE design asks for it.

---

## 6. Communications

### 6.1 `GET /admin/accounts/:id/communications`

Email batch history for the Communications tab of the account detail page. Backed by SES send records joined to our bulk_email batch table:

```jsonc
{
  "items": [
    {
      "id": 7421,
      "sent_at": "2026-11-18T21:00:00Z",
      "subject": "November newsletter",
      "sent_by_user_id": 182,
      "sent_by_user_email": "neville@naenaebc.co.nz",
      "recipient_count": 182,
      "delivered_count": 179,
      "bounce_count": 3,
      "open_count": 94,
      "click_count": 12,
      "unsub_count": 1,
      "bounce_rate": 0.016,
      "ses_message_ids": ["ses-abc", "ses-def"]  // optional, for Sentry/SES drilldown
    }
  ],
  "next_cursor": null,
  "aggregates": {
    "sent_in_window": 412,
    "bounce_rate_in_window": 0.012,
    "unsub_rate_in_window": 0.004
  }
}
```

### 6.2 `GET /admin/metrics/communications`

Platform-wide SES health — surface high-bounce clubs before SES throttles us:

```jsonc
{
  "window": "30d",
  "sent": 48230,
  "delivered_rate": 0.986,
  "bounce_rate": 0.011,
  "complaint_rate": 0.0003,
  "ses_daily_quota": 50000,
  "ses_daily_sent": 2100,
  "ses_sandbox_mode": false,
  "high_bounce_accounts": [
    { "account_id": 44, "name": "Foo Club", "bounce_rate": 0.08, "sent": 240 }
  ]
}
```

---

## 7. Users — platform-level

### 7.1 `GET /admin/users` — reshape of existing endpoint

Paginated list of platform users with cross-tenant context:

```jsonc
{
  "items": [
    {
      "id": 182,
      "name": "Neville Rodda",
      "email": "neville@naenaebc.co.nz",
      "signup_at": "2026-04-12T03:22:11Z",
      "last_login_at": "2026-11-25T19:40:00Z",
      "is_platform_owner": false,
      "club_memberships": [
        { "club_id": 123, "club_name": "Naenae Bowling Club", "role": "owner" },
        { "club_id": 211, "club_name": "Avalon Bowling Club", "role": "admin" }
      ]
    }
  ],
  "next_cursor": null,
  "total_count": 1120
}
```

Filters: `?q=<email or name>`, `?filter[is_platform_owner]=true`, `?filter[multi_club]=true`.

### 7.2 `PATCH /admin/users/:id` — grant / revoke platform-owner flag

```jsonc
{ "is_platform_owner": true }
```

Audit-logged. Only existing platform_owners can grant.

---

## 8. Admin actions

### 8.1 `POST /admin/accounts/:id/impersonate`

Mints a short-lived JWT the FE can use to log in as the club's owner. Essential for support ("can't see my tournaments").

```jsonc
// Request
{ "reason": "support-ticket-4421" }        // required — audit-log

// Response
{
  "impersonation_jwt": "eyJhbGci...",
  "expires_at": "2026-11-26T14:30:00Z",     // 15 min from now
  "impersonated_user_id": 182,
  "impersonated_user_email": "neville@naenaebc.co.nz"
}
```

Constraints:
- Max 15-minute TTL.
- JWT carries an `impersonated_by: <platform_owner_user_id>` claim so every action during the session is attributable.
- Every impersonation emits a `timeline.kind: impersonated` event on the target account (§4.2) including the `reason`.
- Starter / canceled / suspended accounts can still be impersonated (support needs it most on these).

### 8.2 `POST /admin/accounts/:id/plan-override` — comp plan

Manual plan assignment, bypassing Stripe. For strategic deals like the Bowls Wellington free-build (user flagged this on 2026-11-26).

```jsonc
// Request
{
  "plan": "pro",                   // target plan
  "until": "2027-04-12T00:00:00Z", // ISO8601 — when the comp expires and reverts to Stripe truth; null = indefinite
  "reason": "BW-free-build-deal"   // required — audit-log + visible on account timeline
}

// Response
{ "ok": true, "effective_plan": "pro", "comped_until": "2027-04-12T00:00:00Z" }
```

Behaviour:
- Overrides `GET /clubs/:cid/plan.plan` and the admin accounts row's `plan` to the comped value.
- `plan_source` flips to `'manual'`; downstream feature gates (brief 93) treat `'manual' + 'pro'` identically to `'derived' + 'pro'`.
- When `until` passes, a nightly job reverts the override and restores Stripe-derived plan. Emits a `plan_change` timeline event.
- `plan: 'starter'` with a reason is also allowed — for abuse response short of suspension.

### 8.3 `POST /admin/accounts/:id/suspend`

Soft-disables the account. Reversible via the sibling endpoint.

```jsonc
// Request
{ "reason": "payment-dispute-2026-11-25", "notify_owner": true }

// Response
{ "ok": true, "suspended_at": "2026-11-26T14:12:00Z" }
```

Behaviour:
- Owner can still sign in but gets a modal: "account suspended, contact support". No CRM actions permitted.
- Public club site continues to render (don't take member-visible impact without a second step).
- `flags.suspended: true` in the accounts row.
- If `notify_owner: true`, server sends a templated email to the owner explaining + support contact.

### 8.4 `POST /admin/accounts/:id/unsuspend`

```jsonc
{ "reason": "resolved-2026-11-27" }
```

Reinstates all CRM access. Timeline event `kind: unsuspended`.

### 8.5 Deletion?

**Non-goal for V1.** True deletion (GDPR DSR flow) is a separate workstream — see audit item #4. Suspend is the hammer for now; hard delete is one of the items keeping Torny off a clean 9 for production-readiness.

---

## 9. Audit log

Every action in §8 writes an append-only row to a new `platform_admin_audit` table:

| Column | Type | Notes |
|---|---|---|
| id | bigint | pk |
| at | timestamptz | server now() |
| actor_user_id | bigint | the platform_owner who acted |
| target_account_id | bigint | nullable — null for user-scoped actions |
| target_user_id | bigint | nullable |
| action | text | `impersonate` / `comp_plan` / `suspend` / `unsuspend` / `grant_platform_owner` / `revoke_platform_owner` |
| payload | jsonb | full request body |
| reason | text | mirrored from request `reason` field for easy grep |
| ip | inet | caller's IP |
| user_agent | text | caller's user-agent |

Expose via `GET /admin/audit?filter[actor]=X&filter[target]=Y&filter[action]=Z` for the super-admin to review their own + teammates' history. Pagination same as §3.3.

---

## 10. System health

### 10.1 `GET /admin/system/health`

Surfaces the things that page someone at 2am:

```jsonc
{
  "sentry": {
    "top_issues": [
      { "id": "12421", "title": "TypeError: ...", "events_24h": 42, "level": "error", "url": "https://sentry.io/..." }
    ],
    "events_24h": 184
  },
  "deploys": {
    "crm":       { "sha": "c032288", "at": "2026-11-26T01:12:00Z", "status": "success" },
    "club_sites":{ "sha": "a10ced3", "at": "2026-11-25T03:00:00Z", "status": "success" },
    "torny_web": { "sha": "e0d0441", "at": "2026-11-24T22:40:00Z", "status": "success" }
  },
  "smoke": {                           // from the club-sites hourly smoke gate (commit 1327457)
    "last_run_at": "2026-11-26T13:17:00Z",
    "status": "pass",                  // 'pass' | 'fail' | 'running'
    "consecutive_failures": 0
  },
  "ses": {
    "daily_sent": 2100,
    "daily_quota": 50000,
    "bounce_rate_24h": 0.011,
    "complaint_rate_24h": 0.0003,
    "sandbox_mode": false
  }
}
```

Sentry integration: server-side, use the Sentry REST API (service account token in SSM). Cache top_issues for 5 min. If Sentry is down, return `sentry: null` + `sentry_error: "unavailable"` rather than 500-ing the whole endpoint.

Deploy data: can come from the GitHub REST API (`gh api repos/tornyglory/torny-crm-websites/deployments`), or from a `last_deploy` table we write to in our CI pipeline. Latter is more reliable; former is zero-wiring.

---

## 11. Data model changes

This is the one place where the schema shape is load-bearing — get it wrong and every downstream aggregate becomes a reconstruction.

### 11.1 `platform_fee_cents` on every transaction

Every money-moving table needs an explicit `platform_fee_cents` column:

- `venue_bookings.platform_fee_cents` (int, not null, default 0)
- `tournament_entries.platform_fee_cents` (int, not null, default 0)
- `club_addon_charges.platform_fee_cents` (int, not null, default 0) — new in brief 122
- `subscription_charges.platform_fee_cents` (int, not null) — equal to the subscription amount since the whole thing is our revenue

Source of truth: Stripe's `application_fee_amount` on the PaymentIntent (via the Connect integration already in place for Pro plan — see the "Stripe Connect for deposits + entries" feature tile on the Settings → Billing screenshot). Webhook writes it into our DB at charge time; we never recompute it client-side.

For historical data that predates this migration, backfill from Stripe's API. If Stripe doesn't have the fee breakdown (shouldn't happen since Connect records it), leave `platform_fee_cents = 0` and let the admin dashboard tag those rows as "pre-migration" — don't fabricate.

### 11.2 `platform_admin_audit` table

As per §9.

### 11.3 `plan_override` table (or extend `clubs_data`)

For §8.2 comp plan:

```sql
CREATE TABLE plan_override (
  club_id bigint PRIMARY KEY REFERENCES clubs_data(id),
  plan text NOT NULL CHECK (plan IN ('starter', 'pro')),
  until timestamptz,                   -- nullable = indefinite
  reason text NOT NULL,
  set_by_user_id bigint NOT NULL REFERENCES users(id),
  set_at timestamptz NOT NULL DEFAULT now()
);
```

Nightly job: `DELETE FROM plan_override WHERE until IS NOT NULL AND until < now()` — emits a `plan_change` timeline event for each.

Plan resolution order on `GET /clubs/:cid/plan`:
1. If `plan_override` row exists and not expired → use `plan_override.plan`, set `plan_source: 'manual'`.
2. Else → derive from Stripe subscription (current behaviour), set `plan_source: 'derived'`.

### 11.4 `suspension` state

Add to `clubs_data`:

```sql
ALTER TABLE clubs_data
  ADD COLUMN suspended_at timestamptz,
  ADD COLUMN suspended_reason text,
  ADD COLUMN suspended_by_user_id bigint REFERENCES users(id);
```

All writes via `/admin/accounts/:id/suspend`. Non-null `suspended_at` → every CRM mutation returns `409 account_suspended` with a message pointing the owner to support.

---

## 12. Error catalogue

New error codes shipping with this brief. FE consumes them, user-facing copy is FE's job:

- `403 not_platform_owner` — §3.1 gate failed
- `400 bad_window` — §3.2 unknown `?window` value
- `400 bad_sort` — §4.1 unknown sort key
- `404 account_not_found` — any endpoint keyed on `:id`
- `404 user_not_found` — §7
- `409 cannot_impersonate_platform_owner` — §8.1 defence; one platform_owner can't impersonate another
- `409 plan_override_in_progress` — §8.2 if a plan_override write collides with a running checkout
- `409 already_suspended` / `409 not_suspended` — §8.3 / §8.4 state guards
- `409 account_suspended` — any per-club mutation when §8.3 state is set
- `503 sentry_unavailable` / `503 ses_unavailable` — §10 upstream failures; FE renders a degraded panel

---

## 13. Verification checklist

Before marking shipped:

- [ ] `GET /admin/accounts` returns the full row shape for a known-pro club with real bookings + entry data
- [ ] `?window=7d` vs `?window=30d` vs `?window=all` produce consistent-shaped responses with the metric field names renamed accordingly
- [ ] `?filter[plan]=pro&sort=-mrr` filters + sorts correctly
- [ ] `?q=naenae` returns naenae-bowling-club in the first page
- [ ] `GET /admin/accounts/:id` timeline includes every event kind at least once in a seeded fixture
- [ ] `GET /admin/accounts/:id/transactions` returns both venue_booking and tournament_entry rows in one chronological stream, with correct `platform_fee_cents` on each
- [ ] `GET /admin/metrics/overview` MRR matches Stripe's reported MRR for active subscriptions (±$0.01 rounding)
- [ ] `GET /admin/metrics/billing.transactional.platform_take_cents` matches `SUM(platform_fee_cents)` across venue_bookings + tournament_entries + club_addon_charges in the window
- [ ] `POST /admin/accounts/:id/impersonate` mints a working JWT that logs the caller in as the owner; emits an `impersonated` timeline event
- [ ] Impersonation JWT expires after 15 min
- [ ] `POST /admin/accounts/:id/plan-override` with `until` set flips `plan_source` to `manual`, reverts to Stripe-derived after `until` passes (test by setting `until` to 2s in the future + waiting)
- [ ] `POST /admin/accounts/:id/suspend` blocks all CRM mutations with `409 account_suspended`
- [ ] Non-platform_owner JWTs get `403 not_platform_owner` on every endpoint — spot-check 5 of them
- [ ] `platform_admin_audit` table has one row per action taken during these checks, with the `reason` field populated
- [ ] Old `/admin/claims` endpoints return 410 Gone (don't 404 — tell the FE it's intentional)

---

## 14. Non-goals

- **Multi-currency.** NZD only in V1. Revenue in AUD/GBP for international clubs is a follow-up brief once we actually have international clubs paying.
- **Real-time updates.** No websocket / SSE for the dashboard. Pull model, FE refetches every N seconds if open. "Real-time admin" is a V2 nice-to-have, not shipping now.
- **Historical backfill beyond 90 days.** Timeline + transactions default to last 90 days; longer windows work but are slower. If we need deep historical analysis, it's a separate OLAP push, not an online endpoint.
- **GDPR / DSR flow.** Full deletion + data export is a separate workstream (audit item #4). V1 has suspend as the heaviest hammer.
- **Teammate / multiple platform-owners UX.** The audit log (§9) supports this but the FE in V1 is single-user. Granting via §7.2 is possible but UX for team collaboration (notifications, assignment) is a follow-up.
- **Billing-side writes.** V1 is read + override + support actions. Issuing refunds, writing new invoices, modifying subscriptions from the admin portal — all via the Stripe dashboard. Deep-link to it, don't rebuild it.
- **FE-triggered data exports (CSV).** Nice-to-have; punt to V2. If someone needs a CSV right now, we run a SQL query.
- **Fine-grained role model beyond `platform_owner`.** No "read-only admin" or "billing-only admin" in V1. One role, one JWT claim. Reshape to RBAC if we ever hire support staff.
