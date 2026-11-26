# Brief 123 — Platform admin portal redesign

**STATUS — PHASE 1 + PHASE 2 SHIPPED 2026-11-26 (commits `562541b`, `c53bcdd`).**

Phase 1 (read endpoints) + Phase 2 (admin actions + audit + users + suspension gate) are live. Only Phase 3 (transactions drilldown + communications + system health + trend sparklines) remains.

The FE can now build the full admin shell end-to-end — all the support tools (impersonate, comp plan, suspend) are available.

**URL deviation from the brief spec:** endpoints live on `VENUE_BASE`, not the CRM base. Same reason as every recent admin-adjacent endpoint — TornyCrmStack is at the CloudFormation 500-resource cap.

**Role-gate deviation:** backend reuses the existing `users.is_platform_admin` column + the existing `isPlatformAdmin` JWT claim. The brief calls the role `platform_owner`; backend treats the terms as synonyms. Response payloads keep the brief's naming conventions so the FE contract is stable.

**Scope shipped (Phase 1 + Phase 2):**

Phase 1 (read endpoints):
- `GET /admin/accounts` — list with filters, sort, search, cursor pagination
- `GET /admin/accounts/{account_id}` — detail + lightweight timeline
- `GET /admin/metrics/overview` — platform dashboard
- `GET /admin/metrics/billing` — billing dashboard

Phase 2 (admin actions + audit + users):
- `POST /admin/accounts/{account_id}/impersonate` — 15-min JWT with `impersonated_by` claim
- `POST /admin/accounts/{account_id}/plan-override` — comp plan with time-boxed `until`
- `POST /admin/accounts/{account_id}/suspend` — soft-disable
- `POST /admin/accounts/{account_id}/unsuspend` — restore
- `GET /admin/audit` — paginated audit log reader with filters
- `GET /admin/users` — cross-tenant user list + club memberships
- `PATCH /admin/users/{user_id}` — grant / revoke `is_platform_owner`
- **Suspension enforcement** — every mutating CRM handler that passes through `requireClubRole()` returns `409 account_suspended` for suspended clubs. Blast radius covers the whole admin write surface.

**Deferred to Phase 3:**
- `/admin/accounts/:id/transactions` drilldown (§4.3 of original brief)
- `/admin/accounts/:id/communications` + `/admin/metrics/communications`
- `/admin/system/health` — Sentry + GitHub deploys + SES + smoke gate
- `high_bounce_rate` flag (SES stats integration)
- Trend sparklines (returns empty arrays today; FE should treat empty as "no trend data")
- Nightly job that reverts expired `plan_manual_until` (today manual overrides persist indefinitely past `until` until a human takes action — FE should treat `plan_manual_until < NOW()` as "override expired, pending revert")

---

## 1. Base URL + auth

```
https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Every endpoint requires a JWT (Bearer header) or HttpOnly session cookie (brief 119) from a user with `users.is_platform_admin = 1`. Non-admins get `403 not_platform_owner` with an intentionally spartan body (no shape hints).

---

## 2. `GET /admin/accounts` — list

Unchanged from Phase 1. See prior revision of this doc for the full shape — summary:
- `?window=7d|30d|90d|ytd|all` (default `30d`)
- `?filter[plan|status|inactive_days|has_transactions]`
- `?sort=mrr|revenue|members|signup|last_login|bookings|tournament_gmv` with `-` prefix for desc
- `?q=<search>`, `?limit`, `?cursor`
- Row shape renames `_30d` → `_7d`/`_90d`/`_ytd`/`_all` to match the window

---

## 3. `GET /admin/accounts/{account_id}` — detail

Same row shape + a `timeline` array. Phase 1 timeline kinds are `signup`, `suspended`, `plan_change` (manual-only). Phase 2 adds real-event timeline from the audit table — see §6.5.

FE should render unknown `kind` values gracefully (generic chip + raw `detail`).

---

## 4. `GET /admin/metrics/overview` — unchanged

## 5. `GET /admin/metrics/billing` — unchanged

(Shapes as per the Phase 1 doc — trend arrays still empty until Phase 3.)

---

## 6. Phase 2 — admin actions (all live)

### 6.1 `POST /admin/accounts/{account_id}/impersonate`

```jsonc
// Request — reason is required, max 500 chars
{ "reason": "support-ticket-4421" }

// 200
{
  "status": "success",
  "data": {
    "impersonation_jwt": "eyJhbGciOi…",
    "expires_at": "2026-11-26T02:00:00.000Z",       // 15 min from now
    "impersonated_user_id": 1111,
    "impersonated_user_email": "nigel@torny.co"
  }
}
```

**JWT semantics:**
- 15-minute TTL (JWT `expiresIn`)
- Shape matches a normal login JWT so downstream handlers treat it identically
- Carries an `impersonated_by: <platform_admin_user_id>` claim for attribution
- `isPlatformAdmin: false` — the target cannot elevate via the session

**FE wiring:** drop the JWT into `Authorization: Bearer <jwt>` as a temporary override of the admin's own cookie. Don't persist it. When the 15 min expires or the admin clicks "exit impersonation", restore the cookie-based session (do nothing — the cookie's still there, you just stop sending Bearer).

**Guards:**
- `409 cannot_impersonate_platform_owner` if the target club's owner is also a platform owner
- `409 no_owner` if the account has no `owner_user_id`
- `400 reason_required` if reason is missing or empty

### 6.2 `POST /admin/accounts/{account_id}/plan-override`

```jsonc
// Request
{
  "plan": "pro",                          // 'starter' or 'pro'
  "until": "2027-04-12T00:00:00Z",        // optional; null = indefinite; must be future
  "reason": "BW-free-build-deal"          // required
}

// 200
{
  "status": "success",
  "data": {
    "ok": true,
    "effective_plan": "pro",
    "plan_source": "manual",
    "comped_until": "2027-04-12T00:00:00.000Z"
  }
}
```

**Effect:** writes `clubs_data.plan = plan, plan_source = 'manual', plan_manual_until = <until>`. The accounts row's `plan` field flips to `'comped'` on subsequent reads.

**When `until` passes:** a nightly job (to be added in Phase 3, not shipped yet) will revert and emit a `plan_change` audit event. For now, manual overrides persist indefinitely past `until` until someone takes action — the FE should treat `plan_manual_until < NOW()` as "override expired, pending revert" in the UI.

### 6.3 `POST /admin/accounts/{account_id}/suspend`

```jsonc
// Request
{
  "reason": "payment-dispute-2026-11-25",
  "notify_owner": true                    // optional — email not sent yet in Phase 2
}

// 200
{ "status": "success", "data": { "ok": true, "suspended_at": "2026-11-26T14:12:00.000Z" } }
```

**Effect:** writes `clubs_data.suspended_at = NOW(), suspended_reason, suspended_by_user_id`. Every subsequent mutating CRM endpoint for that club returns:

```jsonc
// Any PUT/POST/PATCH/DELETE on /clubs/{suspended_cid}/…
{
  "status": "error",
  "code": "account_suspended",
  "message": "This account is suspended. Contact Torny support for assistance."
}
```

with HTTP 409.

**What's NOT blocked by suspension:**
- Read endpoints (GET)
- Public site (`/public/clubs/{slug}/site` still renders)
- The owner can still sign in and see the Settings page — they just can't change anything

**FE pattern:** admin shell shows a red banner + modal when any CRM write returns `account_suspended`. "Contact support" CTA.

**Guards:** `409 already_suspended` if `suspended_at` is already non-null. `400 reason_required`.

### 6.4 `POST /admin/accounts/{account_id}/unsuspend`

```jsonc
// Request
{ "reason": "resolved-2026-11-27" }

// 200
{ "status": "success", "data": { "ok": true } }
```

Clears `suspended_at, suspended_reason, suspended_by_user_id`. Audit-logged.

**Guard:** `409 not_suspended` if the account isn't currently suspended.

### 6.5 `GET /admin/audit`

```
GET /admin/audit
    ?filter[actor]=<user_id>
    ?filter[target_club]=<club_id>
    ?filter[target_user]=<user_id>
    ?filter[action]=impersonate|comp_plan|suspend|unsuspend|grant_platform_owner|revoke_platform_owner
    ?limit=50                    max 200
    ?cursor=<opaque>
```

```jsonc
// 200
{
  "status": "success",
  "data": {
    "items": [
      {
        "id": 1821,
        "at": "2026-11-26T01:44:25.000Z",
        "action": "impersonate",
        "actor": { "user_id": 53, "email": "nev@torny.co", "name": "Neville Rodda" },
        "target_club": { "id": 5, "name": "Naenae Bowling Club", "subdomain": "naenae-bowling-club" },
        "target_user": { "id": 1111, "email": "nigel@torny.co" },
        "reason": "support-ticket-4421",
        "payload": { "reason": "support-ticket-4421" },
        "ip": "202.37.71.10",
        "user_agent": "Mozilla/5.0 …"
      }
    ],
    "next_cursor": null,
    "total_count": 142
  }
}
```

Sorted by `at DESC`, then `id DESC`.

### 6.6 `GET /admin/users`

```
GET /admin/users
    ?q=<search>                              // email or name substring
    ?filter[is_platform_owner]=true
    ?filter[multi_club]=true                 // users with ≥2 active club memberships
    ?limit=50                                max 200
    ?cursor=<opaque>
```

```jsonc
// 200
{
  "status": "success",
  "data": {
    "items": [
      {
        "id": 1111,
        "name": "Neville Rodda",
        "email": "nigel@torny.co",
        "signup_at": "2026-08-20T09:00:14.000Z",
        "last_login_at": "2026-11-26T00:54:09.000Z",
        "is_platform_owner": false,
        "club_memberships": [
          { "club_id": 5, "club_name": "Naenae Bowling Club", "role": "owner" },
          { "club_id": 3, "club_name": "Melbourne Bowling Club", "role": "owner" }
        ]
      }
    ],
    "next_cursor": "NTA=",
    "total_count": 1113
  }
}
```

### 6.7 `PATCH /admin/users/{user_id}`

```jsonc
// Request
{ "is_platform_owner": true }   // or false

// 200
{
  "status": "success",
  "data": {
    "id": 182,
    "email": "neville@naenaebc.co.nz",
    "is_platform_owner": true
  }
}
```

Writes `users.is_platform_admin`. Audit-logged with `action: 'grant_platform_owner'` or `'revoke_platform_owner'`.

**Guard:** `409 cannot_demote_self` if you try to revoke your own flag (defence against locking everyone out of the admin portal).

---

## 7. Error codes

| HTTP | code | When |
|---|---|---|
| 400 | `bad_window` | `?window` not in `7d\|30d\|90d\|ytd\|all` |
| 400 | `bad_sort` | `?sort` key not in the allow-list (§2) |
| 400 | `bad_filter` | invalid filter value |
| 400 | `bad_params` | path param missing |
| 400 | `bad_json` | body isn't valid JSON |
| 400 | `bad_plan` | plan not `'starter'` or `'pro'` (§6.2) |
| 400 | `bad_until` | `until` not ISO 8601 or not in the future (§6.2) |
| 400 | `reason_required` | reason field missing (all action endpoints) |
| 400 | `reason_too_long` | reason > 500 chars |
| 401 | — | no valid JWT / cookie session |
| 403 | `not_platform_owner` | authed user lacks `is_platform_admin = 1` |
| 404 | `account_not_found` | account id doesn't exist |
| 404 | `user_not_found` | user id doesn't exist |
| 405 | `method_not_allowed` | wrong HTTP method |
| 409 | `account_suspended` | any CRM mutation on a suspended club (§6.3) |
| 409 | `already_suspended` / `not_suspended` | suspend/unsuspend state guards (§6.3, §6.4) |
| 409 | `cannot_impersonate_platform_owner` | §6.1 |
| 409 | `cannot_demote_self` | §6.7 |
| 409 | `no_owner` | §6.1 — account has no `owner_user_id` |
| 500 | `internal` | unexpected error |

---

## 8. FE wiring

Admin resource lives at `packages/api-client/src/resources/admin.ts`. Phase 2 adds `impersonate`, `planOverride`, `suspend`, `unsuspend`, `listAudit`, `listUsers`, `updateUser`.

**`409 account_suspended` is a CRM-wide concern**, not just admin: every mutating handler for a suspended club returns this code. Wire a global `ApiError` handler that shows a blocking modal with "Contact support" CTA when the code surfaces anywhere in the CRM — not just the admin surface. This is the suspension enforcement UX.

### 8.1 Window toggle

Build one top-level `<AdminWindowToggle>` component with the 5 values. URL-driven state via `useAdminWindow` composable.

### 8.2 Role check on client

`isPlatformOwner` check for showing the Admin shell: inspect `authStore.user.is_platform_admin` (or whatever the `/me` response names it today). The brief uses `is_platform_owner` on API responses; just accept both when wiring.

---

## 9. Verification (live, 2026-11-26)

Phase 1 verification commands unchanged. Phase 2 additions:

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
TOKEN=<platform admin JWT or cookie session>

# Impersonate
curl -s "$VENUE/admin/accounts/5/impersonate" -XPOST -H "Cookie: torny_sid=$TOKEN" -H "Content-Type: application/json" \
  -d '{"reason":"support-check"}' | jq '.data | {expires_at, impersonated_user_email}'

# Comp plan
curl -s "$VENUE/admin/accounts/5/plan-override" -XPOST -H "Cookie: torny_sid=$TOKEN" -H "Content-Type: application/json" \
  -d '{"plan":"pro","until":"2027-04-12T00:00:00Z","reason":"BW-deal"}'

# Suspend + unsuspend (round trip)
curl -s "$VENUE/admin/accounts/5/suspend" -XPOST -H "Cookie: torny_sid=$TOKEN" -H "Content-Type: application/json" \
  -d '{"reason":"test","notify_owner":false}'
curl -s "$VENUE/admin/accounts/5/unsuspend" -XPOST -H "Cookie: torny_sid=$TOKEN" -H "Content-Type: application/json" \
  -d '{"reason":"test resolved"}'

# Audit log tail
curl -s "$VENUE/admin/audit?limit=5" -H "Cookie: torny_sid=$TOKEN" | jq '.data.items[] | {at, action, reason}'

# Users
curl -s "$VENUE/admin/users?q=neville" -H "Cookie: torny_sid=$TOKEN" | jq '.data.items[0] | {id, email, is_platform_owner, club_memberships}'

# Grant platform owner
curl -s "$VENUE/admin/users/182" -XPATCH -H "Cookie: torny_sid=$TOKEN" -H "Content-Type: application/json" \
  -d '{"is_platform_owner":true}'
```

---

## 10. Pass criteria

### Phase 1 (unchanged — all previously verified)

### Phase 2 (verify after FE wires actions)

- [ ] Impersonate mints a 15-min JWT that logs in as the target owner. Session shows an exit banner.
- [ ] Impersonation emits a timeline event on the target account (via audit log tail).
- [ ] Comp plan flips `plan` to `'comped'` on the next account read, with `comped_until` populated.
- [ ] Suspend → any CRM mutation on that club returns `409 account_suspended`. Public site still renders. Settings page still loads read-only.
- [ ] Unsuspend restores mutations.
- [ ] Audit log includes one row per action with the correct `reason`.
- [ ] Grant/revoke platform owner flips `is_platform_admin`.
- [ ] `cannot_demote_self` prevents self-revoke.
- [ ] Nothing in the audit `payload` field leaks credentials or JWT contents.

### Phase 3 criteria (not yet shipped)

Transactions drilldown, communications, system health — land with the matching ship.

---

## 11. Non-goals

Unchanged — multi-currency, real-time push, deep historical OLAP, GDPR / DSR flow, team collaboration UX, billing writes from admin portal, FE-triggered CSV exports, fine-grained admin roles beyond `platform_owner`. All deferred for V1.

---

## 12. Related briefs

- Brief 86 — plan tiers (MRR source of truth)
- Brief 93 — plan on session hydrate. Same gate reuses `isPlatformAdmin` claim.
- Brief 100 — per-club inbox. Email metrics in Phase 3 will join to batches by `club_id`.
- Brief 119 — HttpOnly cookies. Cookie path authorizer picks up `is_platform_admin`.
- Brief 122 — paid addon blocks. `addons` + `addon_gmv_cents` + `addon_take_cents` shapes ready.

---

## 13. Contact

Nev on #torny-eng. Phase 3 timing TBD.
