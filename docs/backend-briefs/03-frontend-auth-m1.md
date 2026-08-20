# CRM Auth — Frontend Implementation Brief (Milestone 1)

**Audience:** `apps/crm` (Vue 3 SPA) frontend engineers
**Backend counterpart:** `backend-crm-implementation-plan.md` — this brief maps to M1 (foundation) only. M2–M6 will land later.
**Status:** Ready to build against. All endpoints below are live in prod.

---

## TL;DR

- **Login works.** `POST /login` returns a JWT + a `user` object that now includes `role`, `clubs`, and `is_platform_admin`.
- **Auth token is stored under `torny.token`** (unchanged from the mock).
- **Role-based routing works today** — you can already tell if someone is a platform admin, a regular player, or (once M3 lands) a club owner/admin/committee member.
- **What's *not* live yet:** email verification, `/auth/refresh`, `/auth/logout`, `/me`, `/auth/*` alias URLs, the `clubs[]` array (always empty until M3), and rate limiting. All coming — don't stub.
- **Password reset works today** via the existing endpoints (unchanged).

---

## What changed in M1

The mobile app's `POST /login`, `POST /register`, `POST /request-password-reset`, `POST /reset-password` URLs are unchanged. The CRM shares these endpoints — no separate `/auth/*` prefix yet.

The **response** and **JWT payload** are now extended additively:

- New JWT claims: `role`, `clubs`, `isPlatformAdmin`.
- New `user` response fields: `role`, `clubs`, `is_platform_admin`.
- All legacy fields (`userId`, `email`, `userType`, `permissions`, `id`, `name`, `avatar_url`, etc.) still present — mobile app is unaffected.

---

## Base URL

```
https://ieg3lhlyy0.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Same base as the public directory API. No separate CRM base yet.

---

## Endpoints available today

### 1. Log in

```
POST /login
Content-Type: application/json

{
  "email": "noah@qubestudio.co.nz",
  "password": "Abundance1!"
}
```

**200 Success**
```json
{
  "status": "success",
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 23,
    "email": "noah@qubestudio.co.nz",
    "name": "Noah Rodda",
    "user_type": "player",
    "role": "player",
    "clubs": [],
    "is_platform_admin": false,
    "avatar_url": "https://...",
    "profile_completed": 0,
    "created": "2025-01-18T08:28:23.000Z",
    "updated": "2026-08-19T16:52:42.000Z"
  }
}
```

**401 Wrong credentials**
```json
{ "status": "error", "message": "Invalid credentials" }
```
Server returns the same 401 for both "email not found" and "wrong password" — do not leak the difference in your UI.

**Decoded JWT payload:**
```json
{
  "userId": 23,
  "email": "noah@qubestudio.co.nz",
  "userType": "player",
  "role": "player",
  "clubs": [],
  "isPlatformAdmin": false,
  "iat": 1787201519,
  "exp": 1789793519
}
```

- **`role`** — one of `platform | owner | admin | committee | player`. This is the highest-tier role the user has anywhere on Torny. Regular users are `player`. Platform admins are `platform`. Once M3 lands, the highest-tier value from the `clubs[]` array (see below) is used.
- **`clubs`** — array of `{ id, role }` per-club. **Always `[]` until M3.** After M3, this is how you know which clubs a user can access and at what level. Do not build against a non-empty `clubs[]` today.
- **`isPlatformAdmin`** — boolean. `true` for the platform-admin seed account (`nev@torny.co`). Use this to gate access to platform-admin-only screens (`/admin/*`).
- **`exp`** — 30 days (unchanged from mobile). M2 will introduce shorter access tokens + refresh rotation.

### 2. Register

Unchanged from mobile. Landing verify-email flow in M2 will add a `403 { code: "email_unverified" }` gate on login. Until then:

```
POST /register
Content-Type: application/json

{
  "firstName": "…",
  "lastName": "…",
  "email": "…",
  "password": "…",
  "account_type": "player"      // required by legacy handler; keep as "player"
}
```

The `account_type` field is a legacy of the mobile app. Pass `"player"` for now — the CRM's per-club roles come from `club_members` (M3), not `account_type`. It's a temporary quirk; will be cleaned up when we roll out `/auth/register`.

### 3. Password reset

Unchanged from mobile — already works.

```
POST /request-password-reset
{ "email": "…" }

POST /reset-password
{ "token": "…", "newPassword": "…" }
```

### 4. Authorized requests

Send the token in the `Authorization: Bearer <token>` header. The authorizer validates the JWT, forwards `role` / `clubs` / `isPlatformAdmin` into the downstream Lambda's context, and bumps `last_active_at` on the user row (coalesced to once per 60 seconds).

Any existing SAM/CDK endpoint that reads `event.requestContext.authorizer.userId` continues to work.

---

## How to consume from the CRM

### Sign-in flow (replaces the mock in `SignInView.vue`)

```ts
// packages/api-client/src/resources/auth.ts

export async function login(email: string, password: string) {
  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const json = await res.json()
  if (json.status !== 'success') throw new Error(json.message ?? 'Login failed')

  localStorage.setItem('torny.token', json.token)
  return json.user  // { id, email, name, role, clubs, is_platform_admin, ... }
}
```

### Route guards (Pinia + Vue Router)

```ts
// stores/session.ts
export const useSession = defineStore('session', {
  state: () => ({ user: null as User | null }),
  getters: {
    isPlatformAdmin: (s) => s.user?.is_platform_admin === true,
    isSignedIn:      (s) => s.user !== null,
    // Placeholder for M3 — currently every user's clubs array is empty.
    hasClubAccess:   (s) => (s.user?.clubs ?? []).length > 0,
  },
})

// router guards
router.beforeEach((to) => {
  const session = useSession()
  if (to.meta.requiresPlatformAdmin && !session.isPlatformAdmin) {
    return '/'
  }
})
```

### Reading `role`

The `role` field is the single string that tells you a user's highest-tier access. Suggested branching:

```ts
switch (user.role) {
  case 'platform':  return '/admin'          // platform admin dashboard
  case 'owner':
  case 'admin':
  case 'committee': return `/clubs/${user.clubs[0].id}`  // club CRM (M3+)
  case 'player':
  default:          return '/onboarding'     // no CRM access yet — invite them to claim
}
```

Until M3 ships, only `platform` and `player` will appear. Design the `player` fallback screen assuming that's the majority case (users signed up on mobile who don't yet have a CRM club).

### Test accounts

- **Regular player:** `noah@qubestudio.co.nz` / `Abundance1!` — `role: 'player'`, `clubs: []`, `is_platform_admin: false`.
- **Platform admin:** `nev@torny.co` — `role: 'platform'`, `is_platform_admin: true`. Password not set here for security; grab it out-of-band.

---

## What is *not* live yet — do not build against

These are all in the M2–M6 pipeline. Do not stub them client-side — you'll paint yourself into a corner.

| Feature | Ships in | Notes |
|---|---|---|
| `POST /auth/verify-email` | M2 | Email-verification flow. Existing users are pre-verified via a backfill; the gate only affects future registrations. |
| `POST /auth/refresh` + refresh tokens | M2 | Today's access token is 30 days. Refresh tokens land in M2 with 24h access + 30d refresh + reuse-detection. Store `torny.token` for now; migrate when M2 arrives. |
| `POST /auth/logout` | M2 | Server-side session kill. Today, clearing `localStorage` is enough. |
| `GET /me` | M2 | Current-user + fresh `clubs[]`. Today, use whatever the login response returned. |
| `/auth/*` alias URLs | M2 | Adds `/auth/login`, `/auth/register`, etc. as aliases of the current URLs. Today, use the unprefixed paths. |
| Non-empty `clubs[]` | M3 | Depends on the new `club_members` table. Today it is always `[]`. |
| `role` beyond `platform`/`player` | M3 | `owner`, `admin`, `committee` require `club_members`. Today those values won't appear in JWTs. |
| Claim flow (`POST /claims`, `/admin/claims`) | M4 | Backend claim rework. Today the old `/create-claim` etc. exist but should not be used from the CRM. |
| Team access (`/clubs/:id/members`, invites) | M5 | Full team management surface — brief 02. |
| Rate limiting (5 failed logins / 15 min) | M2 | Today, no throttling — but design your UX to display a `Retry-After` when it lands. |

---

## Timezone + timestamps

All timestamps on the server are UTC. `created_at`, `updated_at`, `last_active_at`, `email_verified_at`, and the JWT `iat`/`exp` are all UTC. Format on the client for display.

---

## Errors + status codes

Consistent shape across the auth endpoints:

```json
{ "status": "error", "message": "…", "code": "…" }
```

- `400` — malformed body / missing required field.
- `401` — invalid credentials, invalid/expired token. Frontend should clear the stored token and route to sign-in.
- `403` — token valid but the caller lacks the required role. Do not clear the token — surface a "you don't have access" screen instead.
- `409` — write conflict (e.g. email already registered — currently 409, will change to a generic 201 in M2 to prevent enumeration).
- `500` — internal error. Show a retry.

---

## What we need from the CRM in return

1. **Consume `role` and `is_platform_admin`** — even before M3, this unblocks the platform-admin dashboard.
2. **Store the JWT under `torny.token`** — the memory-mock convention holds; no need to change it.
3. **Do not read `permissions`** — it's the mobile app's legacy field. Use `role` and `clubs[]` (once M3 lands) instead.
4. **Ping when M2 lands** and we'll coordinate the refresh-token migration.

---

## Contact

Same as brief 01 — `#torny-eng` on Slack or an issue against `tornyglory/torny-crm-websites`.
