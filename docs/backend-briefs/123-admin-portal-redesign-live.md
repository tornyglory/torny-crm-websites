# Brief 123 — Platform admin portal redesign

**STATUS — PHASES 1 + 2 + 3 SHIPPED 2026-11-26 (commits `562541b`, `c53bcdd`, `63af673`).**

Entire admin portal backend is live minus the Phase 3b subset:
- `/admin/system/health` (Sentry + GitHub + SES)
- `past_due` + `churn` flags (need Stripe subscription webhook mirror)
- Trend sparklines
- Per-recipient SES event tracking (needed for bounce rates)

See §11 for the Phase 3b deferral list.

The FE has everything it needs to build the complete admin shell — every read endpoint, every support action, every audit view, plus the nightly reverter keeping comp-plan state honest.

**URL deviation from the brief spec:** endpoints live on `VENUE_BASE`, not the CRM base. TornyCrmStack is at the CloudFormation 500-resource cap.

**Role-gate deviation:** backend reuses the existing `users.is_platform_admin` column + `isPlatformAdmin` JWT claim. Brief calls the role `platform_owner`; backend treats the terms as synonyms. Response payloads keep the brief's naming conventions.

---

## Scope shipped

### Phase 1 — read endpoints
- `GET /admin/accounts` — list with filters, sort, search, cursor pagination
- `GET /admin/accounts/{id}` — detail + lightweight timeline (Phase 3 enriches this)
- `GET /admin/metrics/overview` — platform dashboard
- `GET /admin/metrics/billing` — billing dashboard

### Phase 2 — admin actions + audit + users
- `POST /admin/accounts/{id}/impersonate` — 15-min JWT with `impersonated_by` claim
- `POST /admin/accounts/{id}/plan-override` — comp plan with time-boxed `until`
- `POST /admin/accounts/{id}/suspend` / `unsuspend`
- `GET /admin/audit` — paginated audit log reader
- `GET /admin/users` + `PATCH /admin/users/{id}` — cross-tenant user list + role flag writes
- **Suspension enforcement** — every mutating CRM handler returns `409 account_suspended` for suspended clubs

### Phase 3 — drilldowns + comms + timeline enrichment + reverter
- `GET /admin/accounts/{id}/transactions` — polymorphic stream (`venue_bookings` ∪ `tournament_entries`)
- `GET /admin/accounts/{id}/communications` — per-club email batches
- `GET /admin/metrics/communications` — platform-wide SES health
- `GET /admin/accounts/{id}` **timeline now enriched** from `platform_admin_audit` (full catalog of kinds)
- `AdminPlanReverter` — nightly EventBridge job at 04:00 UTC that flips expired `plan_manual_until` overrides back to `plan_source='derived'`

### Deferred to Phase 3b
- `/admin/system/health` — Sentry + GitHub deploys + SES + smoke gate
- `past_due` + `churn` flags (needs Stripe subscription webhook mirror)
- `high_bounce_rate` flag + SES rate fields (needs per-recipient SES event tracking)
- Trend sparklines (returns empty arrays today — FE should treat empty as "no trend data")
- Audit event for the nightly reverter (blocked on making `audit.actor_user_id` nullable so system actions can attribute)

---

## 1. Base URL + auth

```
https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod
```

JWT (Bearer) or HttpOnly session cookie (brief 119) from a user with `users.is_platform_admin = 1`. Non-admins get `403 not_platform_owner` with a spartan body.

---

## 2. `GET /admin/accounts` — list (Phase 1)

Shape unchanged from Phase 1. Summary:
- `?window=7d|30d|90d|ytd|all` (default `30d`)
- `?filter[plan|status|inactive_days|has_transactions]`
- `?sort=mrr|revenue|members|signup|last_login|bookings|tournament_gmv` (prefix `-` for desc)
- `?q=<search>`, `?limit`, `?cursor`
- Row shape renames windowed fields based on `?window`

See the Phase 1 revision of this doc for the full example.

---

## 3. `GET /admin/accounts/{id}` — detail (Phase 1 + Phase 3 enrichment)

Same account row shape + a `timeline` array. **Phase 3 enriches the timeline** with every Phase 2 action pulled from `platform_admin_audit`:

```jsonc
// GET /admin/accounts/5 → data.timeline (newest first)
[
  {
    "at": "2026-11-26T02:12:09.000Z",
    "kind": "plan_change",
    "detail": {
      "from": "pro",
      "to": "pro",
      "until": null,
      "reason": "BW-free-build-deal",
      "by_user_id": 53,
      "by_user_email": "nev@torny.co"
    }
  },
  {
    "at": "2026-11-20T10:30:00.000Z",
    "kind": "impersonated",
    "detail": { "reason": "support-ticket-4421", "by_user_id": 53, "by_user_email": "nev@torny.co" }
  },
  { "at": "2026-08-24T06:41:30.000Z", "kind": "signup", "detail": null }
]
```

**Kind map (audit action → timeline kind):**
- `impersonate` → `impersonated`
- `comp_plan` → `plan_change`
- `suspend` → `suspended`
- `unsuspend` → `unsuspended`

User-scoped actions (`grant_platform_owner`, `revoke_platform_owner`) deliberately **don't appear on the account timeline** — they belong to the user admin UX.

**Default window:** last 90 days. Override with `?timeline_since=<iso>` to pull further back.

**Forward-compat:** FE still renders unknown kinds gracefully — backend can add kinds without a release.

---

## 4. `GET /admin/metrics/overview` (Phase 1)

Shape unchanged. `trends.*` arrays are empty until Phase 3b sparklines ship — treat empty as "no trend data" in the UI.

---

## 5. `GET /admin/metrics/billing` (Phase 1)

Shape unchanged. `trend_cents`, `trend_platform_take_cents`, `failed_payments`, and `stripe_payouts` all zero / empty until Phase 3b.

---

## 6. Phase 2 — admin actions (all live)

### 6.1 `POST /admin/accounts/{id}/impersonate`
Request `{ "reason": "support-ticket-4421" }` → 15-min JWT. Carries `impersonated_by` claim. `isPlatformAdmin: false` so target can't elevate.

**Guards:** `409 cannot_impersonate_platform_owner`, `409 no_owner`, `400 reason_required`.

### 6.2 `POST /admin/accounts/{id}/plan-override`
Request `{ plan, until?, reason }` → flips `plan_source = 'manual'`. Accounts row's `plan` field shows as `'comped'`. **Phase 3 reverter now runs nightly at 04:00 UTC**, so expired overrides stop sticking around forever (§7.6).

### 6.3–6.4 `POST /admin/accounts/{id}/suspend` + `/unsuspend`
Suspend blocks all CRM writes with `409 account_suspended`. Unsuspend restores. Both require `reason`.

### 6.5 `GET /admin/audit`
Paginated audit log reader. Filters: `actor`, `target_club`, `target_user`, `action`.

### 6.6 `GET /admin/users` + 6.7 `PATCH /admin/users/{id}`
Cross-tenant user list + grant/revoke `is_platform_owner`. `PATCH` guards against `cannot_demote_self`.

---

## 7. Phase 3 — drilldowns + comms + timeline + reverter

### 7.1 `GET /admin/accounts/{id}/transactions`

Polymorphic stream for the Transactions tab of the account detail page. **Phase 3 ships `venue_booking` + `tournament_entry` rows.** Subscription-charge + add-on-charge rows land when their own tables arrive (Stripe sub webhook mirror + brief 122) — response envelope already accommodates them via `kind` + `count_by_kind`.

```
GET /admin/accounts/{id}/transactions
    ?window=7d|30d|90d|ytd|all                     default 30d
    ?filter[kind]=venue_booking,tournament_entry   comma-separated, repeatable
    ?filter[status]=succeeded|refunded|failed|pending
    ?sort=-at (default) | -amount_cents
    ?limit=50 (max 200) & ?cursor=<opaque>
```

```jsonc
// 200
{
  "status": "success",
  "data": {
    "items": [
      {
        "id": "vb_812",                                     // prefix: vb_ / te_ (future: sc_, ac_)
        "at": "2026-11-20T18:15:00.000Z",
        "kind": "venue_booking",
        "amount_cents": 45000,
        "platform_fee_cents": 1125,
        "club_net_cents": 43875,
        "stripe_charge_id": "pi_3P…",
        "stripe_dashboard_url": "https://dashboard.stripe.com/payments/pi_3P…",
        "ref": {
          "kind": "venue_booking",
          "id": 812,
          "label": "The clubhouse · Full Day · 9am – 11pm"
        },
        "member": { "id": 5522, "name": "Grace Whittaker", "email": "g.whittaker@example.com" },
        "status": "succeeded"                               // succeeded | refunded | failed | pending
      }
    ],
    "next_cursor": null,
    "total_count": 12,
    "aggregates": {
      "gross_cents": 2244500,
      "platform_take_cents": 13863,
      "count_by_kind": {
        "venue_booking": 10,
        "tournament_entry": 2
      }
    }
  }
}
```

**Status mapping (per-kind DB enums → public enum):** booking `confirmed|completed` → `succeeded`; `pending|pending_payment` → `pending`; `cancelled|declined` → `failed`; `refunded` → `refunded`. Tournament entries use the same mapping with `withdrew` → `failed`.

### 7.2 `GET /admin/accounts/{id}/communications`

Per-club email batch history. Delivery / bounce metrics not shipped — Phase 3b (§7.4).

```
GET /admin/accounts/{id}/communications
    ?window=7d|30d|90d|ytd|all                     default 30d
    ?limit=50 (max 200) & ?cursor=<opaque>
```

```jsonc
// 200
{
  "status": "success",
  "data": {
    "items": [
      {
        "id": 7421,
        "sent_at": "2026-11-18T21:00:00.000Z",
        "subject": "November newsletter",
        "flavor": "club_newsletter",
        "audience_label": "All active members",
        "sent_by_user_id": 1111,
        "sent_by_user_name": "Neville Rodda",
        "sent_by_user_email": "nigel@torny.co",
        "click_count": 12
        // No unsub_count on individual batches — email_unsubscribes
        // is keyed on (club_id, email) with no batch_id. See the
        // aggregate below for the club-level unsub total.
      }
    ],
    "next_cursor": null,
    "total_count": 6,
    "aggregates": {
      "sent_in_window": 6,
      "clicks_in_window": 1,
      "unsubs_in_window": 0,
      "bounce_rate_in_window": null,             // Phase 3b
      "unsub_rate_in_window": null               // Phase 3b (needs delivered count)
    },
    "ses_events_available": false                // Phase 3b flips this on
  }
}
```

### 7.3 `GET /admin/metrics/communications`

Platform-wide SES health. Phase 3 ships what's derivable from `email_batches` + `email_clicks` + `email_unsubscribes`. Rate fields are honest `null` with `ses_events_available: false` so the FE shows "no bounce data yet" rather than "0% bounce rate".

```jsonc
// 200
{
  "status": "success",
  "data": {
    "window": "30d",
    "sent_batches": 412,
    "clicks": 58,
    "unsubscribes": 2,
    "delivered_rate": null,                 // Phase 3b
    "bounce_rate": null,                    // Phase 3b
    "complaint_rate": null,                 // Phase 3b
    "high_bounce_accounts": [],             // Phase 3b
    "ses_events_available": false,
    "ses_daily_quota": null,                // Phase 3b (SES API)
    "ses_daily_sent": null,                 // Phase 3b
    "ses_sandbox_mode": null                // Phase 3b
  }
}
```

### 7.4 Phase 3b — when SES rates light up

Per-recipient SES event tracking (bounces, deliveries, complaints) requires an `email_sends` / `ses_events` table that doesn't exist yet. Phase 3b will:
- Add the table + an SES notification handler that mirrors events in
- Backfill `click_count`, `delivered_rate`, `bounce_rate`, `complaint_rate` into the Phase 3 responses
- Compute `high_bounce_accounts` from the mirrored data
- Integrate the SES API for `daily_quota` / `daily_sent` / `sandbox_mode`

**No FE contract change.** The existing fields flip from `null` → numbers; `ses_events_available` flips to `true`. FE should already handle the null case gracefully.

### 7.5 Timeline enrichment on `GET /admin/accounts/{id}`

Covered in §3 above. Full catalog of event kinds now pulled from the audit table.

### 7.6 Nightly plan-override reverter (operational, no FE surface)

EventBridge fires `torny-admin-plan-reverter` at 04:00 UTC daily:

```sql
SELECT club_id FROM clubs_data
 WHERE plan_source = 'manual'
   AND plan_manual_until IS NOT NULL
   AND plan_manual_until < NOW();
```

For every hit: `UPDATE clubs_data SET plan_source='derived', plan_manual_until=NULL`. The next Stripe webhook (or admin action) corrects the actual plan value from live subscription state. CloudWatch log is the audit trail; a proper `plan_change` audit event lands in Phase 3b when `audit.actor_user_id` goes nullable.

**What the FE sees:** nothing in real time, but a comp-plan admin who checks the account on the morning after expiry sees `plan_source: 'derived'` instead of `'manual'` and `comped_until` cleared.

---

## 8. Error codes

Unchanged from Phase 2. Full table in the Phase 2 revision of this doc.

New behaviour worth noting:
- Transactions endpoint uses the same `bad_window` / `bad_sort` / `bad_filter` validators as `/admin/accounts`.
- Communications endpoints return the same errors; no new codes.

---

## 9. FE wiring

Admin resource lives at `packages/api-client/src/resources/admin.ts`.

**Phase 3 additions:**
- `listTransactions(accountId, { window, filter, sort, limit, cursor })`
- `listCommunications(accountId, { window, limit, cursor })`
- `metricsCommunications({ window })`

**`409 account_suspended` CRM-wide concern** (Phase 2) — global `ApiError` handler shows a blocking "Contact support" modal.

---

## 10. Verification (live, 2026-11-26)

Phase 1 + 2 verification commands unchanged. Phase 3 additions:

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
TOKEN=<platform admin JWT or cookie session>

# Transactions drilldown
curl -s "$VENUE/admin/accounts/5/transactions?window=30d&limit=5" -H "Cookie: torny_sid=$TOKEN" \
  | jq '.data | {items: [.items[] | {id, kind, amount_cents, platform_fee_cents, status}], aggregates}'

# Per-club communications
curl -s "$VENUE/admin/accounts/5/communications?window=30d" -H "Cookie: torny_sid=$TOKEN" \
  | jq '.data | {items: [.items[] | {subject, sent_at, click_count}], aggregates, ses_events_available}'

# Platform-wide SES
curl -s "$VENUE/admin/metrics/communications?window=30d" -H "Cookie: torny_sid=$TOKEN" \
  | jq '.data'

# Timeline enrichment (should include impersonated / plan_change / suspended)
curl -s "$VENUE/admin/accounts/5" -H "Cookie: torny_sid=$TOKEN" \
  | jq '.data.timeline | map({at, kind})'
```

---

## 11. Phase 3b — still not shipped

- `/admin/system/health` — Sentry top-N, deploy heads, smoke gate status, SES quota
- `past_due` flag + `failed_payments` surface + `churned_in_window` (Stripe subscription webhook mirror)
- `high_bounce_rate` flag + `bounce_rate` / `complaint_rate` / `delivered_rate` fields (SES per-recipient events)
- Trend sparklines (`trends.*_cents`, `trend_cents`, `trend_platform_take_cents`)
- `ses_daily_quota` / `ses_daily_sent` / `ses_sandbox_mode` (SES API integration)
- Nightly reverter audit event (needs `audit.actor_user_id` nullable for system-attributed actions)

---

## 12. Non-goals

Unchanged — multi-currency, real-time push, deep historical OLAP, GDPR / DSR flow, team collaboration UX, billing writes from admin portal, FE-triggered CSV exports, fine-grained admin roles beyond `platform_owner`.

---

## 13. Related briefs

- Brief 86 — plan tiers (MRR source of truth)
- Brief 93 — plan on session hydrate
- Brief 100 — per-club inbox. Phase 3 comms endpoint joins to batches by `club_id`.
- Brief 119 — HttpOnly cookies
- Brief 122 — paid addon blocks. `addons` + add-on revenue surfaces ready.

---

## 14. Contact

Nev on #torny-eng. Phase 3b timing TBD.
