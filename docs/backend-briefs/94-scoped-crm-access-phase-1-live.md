# Scoped CRM access — phase 1 FE contract

Backend companion to brief 94 (per-member permission bundles). **Phase 1 only** — permissions now ride on `/me` + `/login` so the FE can gate the sidebar + block picker at first paint. **Write guards, PII filtering, invite flow, and the member-permissions PATCH land in phases 2–4.**

Read this with brief 94 in hand — this doc covers deviations from that brief and what you can actually wire today.

## Base URLs (unchanged)

```
VENUE = https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod
CRM   = https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
SAM   = https://ieg3lhlyy0.execute-api.ap-southeast-2.amazonaws.com/Prod
```

`/me` is on CRM. `/login` and `/register` are on SAM.

## Live now (phase 1)

- `GET /me` → every club in `data.clubs[*]` carries `permissions: string[]`.
- `POST /login` → same shape.
- `POST /register` → unchanged (see §9).
- DB role `committee` renamed to `member`. **If anywhere in the CRM FE compares `club.role === 'committee'`, update to `'member'`.**
- Pre-existing committee rows: none in prod (confirmed). Legacy data in staging/dev auto-flipped to `member` during the migration.

## Divergences from brief 94 as drafted

| Brief said | Reality in phase 1 |
|---|---|
| Owner returns `permissions: ["*"]` | ✓ As specified |
| Admin returns the explicit admin bundle | ✓ Explicit — 33 strings minus billing/danger/manage_team. FE can use `permissions.includes(...)` for both admin + member |
| Legacy committee rows return a Committee preset bundle | ✓ Member row with `permissions = NULL` (how legacy rows land) → 15-string read-only bundle |
| Player returns no permissions | Returns `['dashboard:view']` — safer than empty, matches "any signed-in user sees the dashboard" invariant |
| Write endpoints reject with `403 forbidden_permission` | **Not yet.** Phase 2. Writes still gate on role via `require-club-role`. Don't surface permission-based buttons until phase 2 is confirmed or the FE's own permission check IS the only gate |
| Invite flow with `permissions[]` on `POST /clubs/{id}/invites` | **Not yet.** Phase 3. Today's `POST /clubs/{id}/members` still works for roster adds but doesn't accept `permissions` |
| PII nulling on `GET /clubs/{id}/members` for non-`members:read_pii` callers | **Not yet.** Phase 4. Every PII column still comes down to any CRM-role caller |
| `team.permissions_changed` email on PATCH | **Not yet.** Phase 4 |
| Plan-tier cross-check (e.g. 422 `permission_requires_plan` on a Starter club) | **Not yet.** Phase 4 — FE should still hide Pro-only sections on Starter by reading `clubs[*].plan` (brief 93) |

## `/me` and `/login` — response shape

```jsonc
{
  "status": "success",
  "data": {
    "id": 4177,
    "email": "denise@example.com",
    "role": "owner",                      // top-level: strongest role across all clubs; 'platform' for platform admins
    "is_platform_admin": false,
    "clubs": [
      {
        "id": 5,
        "name": "Naenae Bowling Club",
        "role": "owner",
        "title": null,
        "plan": "starter",                // brief 93
        "permissions": ["*"]              // NEW — brief 94 phase 1
      },
      {
        "id": 42,
        "name": "Kelburn Bowling Club",
        "role": "admin",
        "title": null,
        "plan": "pro",
        "permissions": [
          "dashboard:view",
          "members:read", "members:read_pii", "members:write", "members:remove", "members:note",
          "payments:read", "payments:record",
          "applications:read", "applications:review",
          "enquiries:read", "enquiries:respond",
          "events:read", "events:write",
          "team_selections:read", "team_selections:edit",
          "tournaments:read", "tournaments:edit",
          "honour_board:read", "honour_board:edit",
          "venue_bookings:read", "venue_bookings:manage",
          "venue_packages:read", "venue_packages:edit",
          "website:view", "website:edit",
          "communications:read", "communications:send",
          "settings:brand", "settings:membership", "settings:hours",
          "settings:enquiries", "settings:integrations"
        ]
      },
      {
        "id": 66,
        "name": "Example Club",
        "role": "member",
        "plan": "pro",
        "permissions": [                  // legacy committee default — permissions column is NULL
          "dashboard:view",
          "members:read", "members:read_pii", "members:note",
          "payments:read",
          "applications:read", "enquiries:read", "events:read",
          "team_selections:read", "tournaments:read", "honour_board:read",
          "venue_bookings:read", "venue_packages:read",
          "website:view", "communications:read"
        ]
      }
    ]
  }
}
```

## Permission strings — the full allowlist

Any string outside this list is invalid and (phase 3) will be rejected by `POST /invites` / `PATCH /members` with 422.

```
dashboard:view

members:read              members:read_pii           members:write
members:remove            members:note
payments:read             payments:record

applications:read         applications:review
enquiries:read            enquiries:respond
events:read               events:write
communications:read       communications:send
website:view              website:edit

team_selections:read      team_selections:edit        ← Pro-only
tournaments:read          tournaments:edit            ← Pro-only
honour_board:read         honour_board:edit           ← Pro-only
venue_bookings:read       venue_bookings:manage       ← Pro-only
venue_packages:read       venue_packages:edit         ← Pro-only

settings:brand            settings:membership         settings:hours
settings:enquiries        settings:integrations
```

**Hard-coded (role-gated, NEVER returned in a member's bundle):**
- `settings:billing` → Owner only
- `settings:danger` → Owner only
- `settings:manage_team` → Owner + Admin

The FE should check role (`club.role === 'owner'` etc) for these, not `permissions.includes(…)`. They're not in the allowlist for a reason.

## `usePermissions()` composable (suggested shape)

```ts
function usePermissions(club: Club) {
  const perms = computed(() => club.permissions ?? [])
  const can = (perm: string) =>
    perms.value.includes('*') || perms.value.includes(perm)
  const canAny = (...ps: string[]) =>
    perms.value.includes('*') || ps.some(p => perms.value.includes(p))
  return { perms, can, canAny }
}
```

## Sidebar gating (section → `canAny` check)

Match the mapping in brief 94 §2.2. Each section visible if `canAny(...)` returns true.

| Section | Visibility check |
|---|---|
| Dashboard | always (every bundle includes `dashboard:view`) |
| Members | `canAny('members:read', 'members:read_pii', 'members:write')` |
| Applications | `can('applications:read')` |
| Enquiries | `can('enquiries:read')` |
| Events | `can('events:read')` |
| Team selections | `can('team_selections:read')` + `club.plan === 'pro'` |
| Tournaments | `can('tournaments:read')` + `club.plan === 'pro'` |
| Honour board | `can('honour_board:read')` + `club.plan === 'pro'` |
| Venue bookings | `can('venue_bookings:read')` + `club.plan === 'pro'` |
| Venue packages | `can('venue_packages:read')` + `club.plan === 'pro'` |
| Website | `can('website:view')` |
| Communications | `can('communications:read')` |
| Settings → Brand | `can('settings:brand')` |
| Settings → Membership types | `can('settings:membership')` |
| Settings → Opening hours | `can('settings:hours')` |
| Settings → Enquiries | `can('settings:enquiries')` |
| Settings → Integrations | `can('settings:integrations')` |
| Settings → Billing | `club.role === 'owner'` |
| Settings → Danger zone | `club.role === 'owner'` |
| Settings → Team access | `club.role === 'owner' \|\| club.role === 'admin'` |

**Plan gating comes first** on the five Pro-only sections. On a Starter-plan club, hide the section even if the permission is present — the grant is dead until the club upgrades. This matches the behaviour brief 94 §8 describes for the "downgraded but kept permissions" case.

## PII fields in roster lists (interim)

Brief 94 §5.2 says `GET /clubs/{id}/members` nulls PII fields when the caller lacks `members:read_pii`. **That's phase 4.** Today PII comes down to any CRM-role caller. If you want to render redacted-looking cells to Selectors / Coaches immediately, you can check the composable on the client side and show `—` instead of the raw value. Just know that the raw value is in the payload — don't log it or expose it in dev tools.

## What's NOT yet a backend guarantee

Flagging explicitly to avoid building against promises I haven't shipped:

- **Write guards.** `POST /clubs/{id}/members`, `PATCH /clubs/{id}/members/{user_id}`, `POST /clubs/{id}/members/{user_id}/payments`, `PATCH /clubs/{id}/pages/{slug}` and friends do NOT yet check `permissions[]`. They check role via `require-club-role`. The FE's permission check is currently the only gate — don't surface a button for a Selector to "add a member" expecting a server 403, because the server will happily let it through (any admin+ passes).
- **Invite endpoint.** No `POST /clubs/{id}/invites` yet. The current `POST /clubs/{id}/members` is a roster add (adds the person to the list but doesn't email them a login link). An invited-user-doesn't-exist-yet flow + email + token-accept lands in phase 3.
- **PATCH member permissions.** The new "edit permissions on an existing member" endpoint from brief §5.4 is phase 3.
- **`send_invite` flag on roster add.** Brief 29's `send_invite` is still a silent no-op (handler ignores the field). No email goes out. Either drop sending it, or wait for phase 3 to make it work.
- **Error codes.** `forbidden_permission`, `invalid_permission`, `permission_not_grantable`, `permission_requires_plan`, `stale_state` — none fire today. They land as phases ship.

## `/register` and `/public/signup` shape

Brief 94 §4 says `/register` should carry `permissions[]` on `clubs[]`. Clarification:

- `POST /register` (SAM, training app) — only creates a user, no club membership. Response has no `clubs[]`. Unchanged. Call `/me` after signup to get the full hydrate.
- `POST /public/signup` (brief 88 — self-serve admin signup, on Venue API) — returns `{ user, organisation, auth_token, checkout_url }`, no `clubs[]`. FE should call `/me` immediately after storing `auth_token` to get the clubs list with the owner's `['*']` bundle. (Same pattern as before.)

## Verification

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
CRM="https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod"
SAM="https://ieg3lhlyy0.execute-api.ap-southeast-2.amazonaws.com/Prod"
TOKEN="…"   # your JWT

# 1. Owner's /me carries ['*']
curl -s "$CRM/me" -H "Authorization: Bearer $TOKEN" \
  | jq '.data.clubs[] | {id, role, plan, permissions}'
# → owner row: permissions = ["*"]

# 2. Admin's /me carries the explicit bundle
# → admin row: 33-string array

# 3. Member with NULL column returns the committee default
# → member row (no explicit permissions stored): 15-string read-only bundle

# 4. Login carries the same per-club permissions array
curl -s -X POST "$SAM/login" -H "Content-Type: application/json" \
  -d '{"email":"…","password":"…"}' \
  | jq '.data.user.clubs[0] | {role, permissions}'

# 5. 'committee' is gone — any surviving refs in the FE codebase will break
# silently (comparisons always false). Grep your CRM for /committee/ before shipping.
```

Pass criteria for phase 1:

- ✓ Owner's `permissions` = `['*']`
- ✓ Admin's `permissions` = full allowlist minus the 3 hard-coded strings
- ✓ Member with NULL column = 15-string read-only bundle
- ✓ Member with explicit JSON = exactly that array, unknown strings filtered out
- ✓ Player = `['dashboard:view']`
- ✓ Sidebar hides Pro-only sections on Starter clubs (plan-first gate)
- ✓ Sidebar hides Members on a Selector who doesn't have `members:read` (when they land)

## What ships next (and what to expect)

| Phase | Scope | FE impact |
|---|---|---|
| 2 | Server-side write guards on Members + Payments, then Website + Communications, then everything else. 403 `forbidden_permission` with `required` field | Can trust server to 403 on unauthorised writes. Can stop treating the FE check as the only gate |
| 3 | `POST /clubs/{id}/invites` + `GET /invites` + `DELETE /invites/{id}` + `POST /invites/{token}/accept` + `PATCH /clubs/{id}/members/{memberId}` with `permissions[]` + `expected_updated_at` concurrency guard | Can wire the invite modal + Team access drawer against real endpoints |
| 4 | PII filtering on `GET /clubs/{id}/members`, `team.permissions_changed` email, plan cross-check (422 `permission_requires_plan`) | FE can drop client-side PII hiding; email starts arriving; Pro-only grants reject on Starter clubs |

Each phase is a separate deploy with its own smoke pass — I'll ship a short changelog when they land so you know when it's safe to start calling the new endpoints.

## Questions / changes / "this doesn't match what I expected"

Ping me (Nev) on Slack `#torny-eng`. The permission strings in §2.1 of brief 94 are now the live backend contract — if you want a new one added (e.g. splitting `payments:record` into `payments:record_cash` + `payments:record_card`), that's a 2-line change to `utils/permissions.js` + a redeploy.
