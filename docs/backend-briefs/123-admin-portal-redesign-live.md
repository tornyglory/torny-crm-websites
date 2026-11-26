# Brief 123 — Platform admin portal redesign

**STATUS — PHASE 1 SHIPPED 2026-11-26 (commit 562541b).**

Read-only slice of the new admin surface is live — accounts list + detail + two metrics dashboards. The FE can start building the new Admin shell against these endpoints today. Admin actions (§8 in the original brief) and system health (§10) + communications (§6) land in Phase 2 and 3.

**URL deviation from the brief spec:** endpoints live on `VENUE_BASE`, not the CRM base. Same reason as every recent admin-adjacent endpoint — TornyCrmStack is at the CloudFormation 500-resource cap.

**Role-gate deviation:** backend reuses the existing `users.is_platform_admin` column + the existing `isPlatformAdmin` JWT claim. The brief calls the role `platform_owner`; backend treats the terms as synonyms. Response payloads keep the brief's naming conventions so the FE contract is stable.

**Scope shipped (Phase 1):**

- `GET /admin/accounts` — list with filters, sort, search, cursor pagination
- `GET /admin/accounts/{account_id}` — detail + lightweight timeline
- `GET /admin/metrics/overview` — platform dashboard
- `GET /admin/metrics/billing` — billing dashboard

**Deferred to Phase 2:**

- Admin actions: impersonate, plan-override, suspend/unsuspend (§8)
- `/admin/audit` endpoint + writes to the already-provisioned `platform_admin_audit` table
- `/admin/users` reshape + platform-owner grant/revoke (§7)
- Timeline event kinds beyond the Phase 1 basics
- `past_due` / `churned_in_window` flags (need Stripe subscription webhook mirror)

**Deferred to Phase 3:**

- `/admin/accounts/:id/transactions` drilldown (§4.3)
- `/admin/accounts/:id/communications` + `/admin/metrics/communications` (§6)
- `/admin/system/health` — Sentry + GitHub deploys + SES + smoke gate (§10)
- `high_bounce_rate` flag (SES stats integration)
- Trend sparklines (returns empty arrays today; FE should treat empty as "no trend data")

---

## 1. Base URL + auth

```
https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Every endpoint requires a JWT (Bearer header) or HttpOnly session cookie (brief 119) from a user with `users.is_platform_admin = 1`. Non-admins get `403 not_platform_owner` with an intentionally spartan body (no shape hints).

---

## 2. `GET /admin/accounts` — list

```
GET /admin/accounts
    ?window=7d|30d|90d|ytd|all        default 30d
    ?filter[plan]=starter|pro|comped
    ?filter[status]=active|suspended  Phase 1 limited set; more in Phase 2
    ?filter[inactive_days]=N          clubs with no admin login in >N days
    ?filter[has_transactions]=true    clubs with bookings OR entries in window
    ?sort=mrr|revenue|members|signup|last_login|bookings|tournament_gmv
        prefix with `-` for desc. Default `-last_login`.
    ?q=<search>                       matches name, subdomain, owner_email
    ?limit=50                         max 200
    ?cursor=<opaque>                  continue
```

**Response:**

```jsonc
{
    "status": "success",
    "data": {
        "items": [
            {
                "id": 5,
                "name": "Naenae Bowling Club",
                "subdomain": "naenae-bowling-club",
                "owner_email": "neville@naenaebc.co.nz",
                "signup_at": "2026-08-24T09:43:22.000Z",
                "last_admin_login_at": "2026-11-26T00:35:00.000Z",

                "plan": "pro",                      // 'starter' | 'pro' | 'comped'
                "plan_actual": "pro",               // the DB value — useful when plan === 'comped'
                "plan_source": "derived",           // 'derived' from Stripe | 'manual' (comp)
                "subscription_status": "active",    // Phase 1: 'active' | 'inactive' | 'suspended'
                "mrr_cents": 7900,
                "lifetime_revenue_cents": 12015,    // platform fee lifetime, booking + tournament
                "addons": [],                       // Brief 122 — empty until first paid addon ships

                "member_count": 9,
                "member_joins_30d": 4,              // field renames to _7d / _90d / _ytd / _all per window
                "bookings_30d": 9,
                "bookings_gmv_30d_cents": 1824500,
                "tournament_entries_30d": 1,
                "tournament_gmv_30d_cents": 2500,
                "emails_sent_30d": 6,               // currently counts batches, not recipients — Phase 3 switches to recipient count
                "platform_take_30d_cents": 12015,

                "flags": {
                    "past_due": false,              // Phase 2 — Stripe webhook mirror
                    "high_bounce_rate": false,      // Phase 3 — SES stats
                    "suspended": false,
                    "comped_until": null            // non-null ISO when plan_source === 'manual'
                }
            }
        ],
        "next_cursor": null,
        "total_count": 4
    }
}
```

### 2.1 Window field renaming

The `_30d` suffix tracks the `?window` param. `?window=7d` renames `bookings_30d → bookings_7d`, etc. Same for `_90d`, `_ytd`, `_all`. The FE should read the field keys dynamically rather than hardcoding `_30d`.

---

## 3. `GET /admin/accounts/{account_id}` — detail

Same row shape as §2 plus a `timeline` array.

```jsonc
{
    "status": "success",
    "data": {
        "account": { /* row shape from §2 */ },
        "timeline": [
            { "at": "2026-08-24T09:43:22.000Z", "kind": "signup", "detail": null }
            // More kinds land in Phase 2 — see below for the Phase 1 catalog.
        ]
    }
}
```

**Phase 1 timeline event kinds** — only those that can be derived from existing DB state:

| kind | When |
|---|---|
| `signup` | `clubs_data.provisioned_at` — always present |
| `suspended` | When `clubs_data.suspended_at` is non-null. `detail: { reason, by_user_id }` |
| `plan_change` | When `plan_source === 'manual'`. `detail: { to, source: 'manual', until }`. Phase 2 moves this to real event rows from the audit table. |

**Timeline kinds coming in Phase 2 / 3:** `plan_change` (real events), `addon_added`, `addon_removed`, `payment_succeeded`, `payment_failed`, `payment_recovered`, `subscription_canceled`, `impersonated`, `comped`, `unsuspended`, `support_flagged`. The FE should render unknown `kind` values gracefully (generic chip + raw `detail`) so new kinds landing server-side don't require a FE release.

Query param `?timeline_since=<iso>` is accepted today but currently ignored by the Phase 1 lightweight timeline; it becomes meaningful in Phase 2.

---

## 4. `GET /admin/metrics/overview`

```jsonc
{
    "status": "success",
    "data": {
        "window": "30d",
        "accounts": {
            "total": 4,
            "signups_in_window": 0,
            "active_in_window": 4,            // had admin login in window
            "paying": 1,
            "comped": 0,
            "suspended": 0,
            "past_due": 0,                    // Phase 2
            "churned_in_window": 0            // Phase 2
        },
        "revenue_cents": {
            "mrr": 7900,
            "transactional_in_window": 12015,
            "total_in_window": 19915
        },
        "activity": {
            "bookings_in_window": 9,
            "bookings_gmv_in_window_cents": 1824500,
            "tournament_entries_in_window": 1,
            "tournament_gmv_in_window_cents": 2500,
            "emails_sent_in_window": 6,
            "member_joins_in_window": 3
        },
        "trends": {
            "mrr_cents": [],                  // empty in Phase 1 — Phase 2 fills 12-point sparkline
            "transactional_cents": [],
            "signups": [],
            "churn": []
        }
    }
}
```

---

## 5. `GET /admin/metrics/billing`

```jsonc
{
    "status": "success",
    "data": {
        "window": "30d",
        "subscription": {
            "mrr_cents": 7900,
            "annualised_cents": 94800,       // mrr × 12
            "trend_cents": []                // Phase 2
        },
        "transactional": {
            "gmv_cents": 1827000,
            "platform_take_cents": 12015,
            "effective_take_rate": 0.00658,  // 0.658%
            "trend_platform_take_cents": [],
            "by_kind": {
                "venue_booking_gmv_cents": 1824500,
                "venue_booking_take_cents": 11915,
                "tournament_entry_gmv_cents": 2500,
                "tournament_entry_take_cents": 100,
                "addon_gmv_cents": 0,         // Brief 122 — zero until paid addons ship
                "addon_take_cents": 0
            }
        },
        "failed_payments": {                 // Phase 2 — all zero in Phase 1
            "past_due_count": 0,
            "past_due_value_cents": 0,
            "retrying": 0
        },
        "stripe_payouts": {                  // Phase 3 — all zero/null in Phase 1
            "pending_cents": 0,
            "last_payout_at": null,
            "last_payout_cents": 0
        }
    }
}
```

---

## 6. Error codes

| HTTP | code | When |
|---|---|---|
| 400 | `bad_window` | `?window` not in `7d\|30d\|90d\|ytd\|all` |
| 400 | `bad_sort` | `?sort` key not in the allow-list (§2) |
| 400 | `bad_filter` | invalid filter value |
| 400 | `bad_params` | path param missing (e.g. `/admin/accounts/` with no id) |
| 401 | — | no valid JWT / cookie session |
| 403 | `not_platform_owner` | authed user lacks `is_platform_admin = 1` |
| 404 | (no code) | account id doesn't exist |
| 405 | `method_not_allowed` | something other than GET |
| 500 | `internal` | unexpected error |

---

## 7. FE wiring

### 7.1 `packages/api-client/src/resources/admin.ts` (new)

See the backend team's sample code at the end of this file for a starter resource module. Key points:

- Endpoints live on `VENUE_BASE`, not CRM base
- Use `authedFetch<Envelope<T>>` and return `res.data`
- Window-variant field keys use template literal types so TS stays strict

### 7.2 Window toggle

Build one top-level `<WindowToggle>` component with the 5 values. It controls both metrics endpoints + the accounts list. The field-name rename (§2.1) means you can't just template the suffix — read `Object.keys(row)` and detect the window-scoped keys at render time, OR store the current window in the store and template as `row[`bookings_${window}`]`. Latter is cleaner.

### 7.3 Role check on client

`isPlatformOwner` check for showing the Admin shell: inspect `authStore.user.is_platform_admin` (or whatever the `/me` response names it today). The brief uses `is_platform_owner` on API responses; just accept both when wiring.

---

## 8. Verification (live, 2026-11-26)

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
TOKEN=<platform admin JWT or cookie session>

# 1. List — default window=30d, default sort=-last_login
curl -s "$VENUE/admin/accounts?limit=5&sort=-revenue" -H "Cookie: torny_sid=$TOKEN" | jq '.data.items[0] | {id, name, plan, mrr_cents, lifetime_revenue_cents, bookings_30d, platform_take_30d_cents}'
# → Naenae with real production numbers

# 2. Detail + timeline
curl -s "$VENUE/admin/accounts/5" -H "Cookie: torny_sid=$TOKEN" | jq '{plan: .data.account.plan, timeline: [.data.timeline[].kind]}'

# 3. Overview metrics
curl -s "$VENUE/admin/metrics/overview" -H "Cookie: torny_sid=$TOKEN" | jq '.data'

# 4. Billing metrics
curl -s "$VENUE/admin/metrics/billing" -H "Cookie: torny_sid=$TOKEN" | jq '.data.transactional.by_kind'

# 5. 403 non-admin
curl -s -o /dev/null -w "%{http_code}\n" "$VENUE/admin/accounts" -H "Cookie: torny_sid=<non-admin session>"
# → 403
```

**Live sample numbers (Naenae, 2026-11-26):**
- `plan: pro`, `plan_source: derived`
- MRR: $79, lifetime platform take: $120.15
- 9 bookings in 30d worth $18,245 GMV
- 1 tournament entry worth $25 GMV
- 9 members, 4 joined in 30d

---

## 9. Pass criteria

### Phase 1 (what you can test today)

- ✓ `GET /admin/accounts` returns the row shape in §2 with real numbers from a pro club
- ✓ `?window=7d|30d|90d|ytd|all` honored; metric fields rename accordingly
- ✓ `?filter[plan]=pro&sort=-mrr` filters + sorts correctly
- ✓ `?q=naenae` returns Naenae on the first page
- ✓ `GET /admin/accounts/5` timeline includes `signup` at minimum
- ✓ `GET /admin/metrics/overview.revenue_cents.mrr` matches sum of pro-plan subscriptions × $79
- ✓ `GET /admin/metrics/billing.transactional.platform_take_cents` matches lifetime bookings + entries platform fee
- ✓ Non-admin JWT / cookie → `403 not_platform_owner` on every endpoint
- ✓ CORS allows the current CRM dev origin

### Phase 2 / 3 criteria (not yet shipped)

The remaining pass-criteria from the original brief §13 — impersonation, plan override, suspension, timeline full catalog, `past_due` flag, audit table GET, non-platform_owner grant/revoke — land with the matching ships.

---

## 10. Non-goals (per original brief §14)

Unchanged — multi-currency, real-time push, deep historical OLAP, GDPR / DSR flow, team collaboration UX, billing writes from admin portal, FE-triggered CSV exports, fine-grained admin roles beyond `platform_owner`. All deferred for V1.

---

## 11. Related briefs

- Brief 86 — plan tiers (MRR source of truth). Phase 1 reads the `plan` + `plan_source` columns.
- Brief 93 — plan on session hydrate. Same gate reuses `isPlatformAdmin` claim.
- Brief 100 — per-club inbox. Email metrics in Phase 3 will join to batches by `club_id`.
- Brief 119 — HttpOnly cookies. Cookie path authorizer picks up `is_platform_admin` as part of this ship's bugfix.
- Brief 122 — paid addon blocks. `addons` + `addon_gmv_cents` + `addon_take_cents` surfaces are already shaped; they'll start carrying data when the first paid addon ships.

---

## 12. Contact

Nev on #torny-eng. Phase 2 work starts after Phase 1 is wired into the FE and we've seen a few live admin sessions.
