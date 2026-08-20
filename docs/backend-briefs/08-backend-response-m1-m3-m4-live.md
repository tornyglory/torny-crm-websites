# Torny CRM — Frontend Implementation Brief

**Audience:** `apps/crm` (Vue 3 SPA) frontend engineers
**Backend counterpart:** `backend-crm-implementation-plan.md` (M1 + M3 + M4 shipped 2026-08-20)
**Status:** Every endpoint in this brief is live in prod. All UI seams the CRM already mocks can be wired against these today.

---

## TL;DR

- **Two base URLs.** Auth (`/login`, `/register`, password reset) lives on the SAM API. Everything else — `/me`, claims, admin queue — lives on a new CDK CRM API. JWTs are interchangeable across both.
- **Sign-in unlocks role-based routing.** The `user` response + JWT now carry `role`, `clubs[]`, and `is_platform_admin`. Platform admin routing works today; club-owner routing kicks in the moment a claim is approved.
- **Claim + admin queue are fully wired end-to-end.** A player submits → the platform admin sees the pending row → approve auto-provisions the club, assigns the claimant as `owner`, and auto-rejects sibling claims — all in one atomic transaction.
- **Seed data on prod** (6 pending + 1 approved + 1 rejected) — enough to click through the admin queue immediately.
- **`torny.token`** stays the localStorage key (unchanged from the mock).

---

## Base URLs

```ts
// packages/api-client/src/config.ts
export const SAM_BASE = 'https://ieg3lhlyy0.execute-api.ap-southeast-2.amazonaws.com/Prod';
export const CRM_BASE = 'https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod';
```

| Endpoint | Base | Notes |
|---|---|---|
| `POST /login` | SAM | Mobile shares this. Extended JWT payload; existing shape unchanged. |
| `POST /register` | SAM | |
| `POST /request-password-reset` / `POST /reset-password` | SAM | |
| `GET /me` | **CRM** | Refresh session's user + fresh `clubs[]`. |
| `POST /claims` | **CRM** | Submit a claim. |
| `GET /claims/mine` | **CRM** | The caller's claims. |
| `GET /admin/claims` | **CRM** | Platform-admin queue (paginated). |
| `POST /admin/claims/{claim_id}/approve` | **CRM** | Atomic. |
| `POST /admin/claims/{claim_id}/reject` | **CRM** | With required `reason`. |

CORS is open (`*`) on both. Same `Authorization: Bearer <torny.token>` header everywhere.

> **Why two URLs?** The primary CDK stack hit CloudFormation's 500-resource cap, so we stood up a separate CDK stack for CRM endpoints with a fresh cap. Same authorizer Lambda behind both — one token, two URLs.

---

## Auth

### `POST /login`  (SAM_BASE, public)

**Request:**
```json
{ "email": "nev@torny.co", "password": "..." }
```

**200 Success:**
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
    "updated": "2026-08-20T08:33:16.000Z"
  }
}
```

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

**Field semantics:**
- **`role`** — highest-tier role the user holds anywhere: `platform | owner | admin | committee | player`.
  - `platform` fires when `is_platform_admin = true` (overrides everything else).
  - `owner`/`admin`/`committee` reflect the strongest role in `clubs[]`.
  - `player` is the fallback when the user has no club memberships.
- **`clubs[]`** — one entry per non-revoked `club_members` row. In the JWT it's compact `{ id, role }`; in the `user` response it's enriched `{ id, name, role, title }`. Use the response shape for rendering, the JWT for authorization.
- **`is_platform_admin`** — boolean gate for platform-admin-only screens (`/admin/*`).
- **`exp`** — 30 days. Refresh-token rotation lands in M2.

**401 Wrong credentials:**
```json
{ "status": "error", "message": "Invalid credentials" }
```
Same 401 for "email not found" and "wrong password" — do not distinguish in the UI.

### `POST /register`  (SAM_BASE, public)

Accepts either `name` (single field) or `firstName + lastName` — server combines. `account_type` defaults to `"player"` when omitted.

```json
{ "firstName": "Ana", "lastName": "Kereopa", "email": "…", "password": "…" }
```

- **`password`**: min 10 chars, at least one letter + one number.
- Password reset endpoints (`/request-password-reset`, `/reset-password`) are unchanged from mobile.

**201 Success:**
```json
{ "status": "success", "message": "User registered successfully" }
```

Register does **not** issue a token — call `POST /login` after. That gap closes in M2 when verify-email lands.

**409 Email already registered** — enumeration-safe wording ships in M2.

---

## `GET /me`  (CRM_BASE, 🔒 auth)

Refresh the session — user + fresh `clubs[]`. Call on router `beforeEach` so a claim approval (which mutates the caller's `role`) shows up immediately without a full logout / login cycle.

**200:**
```json
{
  "status": "success",
  "data": {
    "id": 23,
    "email": "noah@qubestudio.co.nz",
    "name": "Noah Rodda",
    "user_type": "player",
    "avatar_url": "...",
    "phone": "+61...",
    "address": null,
    "description": null,
    "profile_completed": 0,
    "created_at": "2025-01-18T08:28:23.000Z",
    "updated_at": "2026-08-20T08:33:16.000Z",
    "email_verified_at": "2025-01-18T08:28:23.000Z",
    "last_active_at": "2026-08-20T08:33:15.000Z",
    "role": "owner",
    "clubs": [
      { "id": 4, "name": "Fitzroy Victoria Bowling and Sports Club", "role": "owner", "title": null }
    ],
    "is_platform_admin": false
  }
}
```

**Errors:** `401` (no auth), `500`.

---

## Claim flow (claimant side)

### `POST /claims`  (CRM_BASE, 🔒 auth)

**Request:**
```json
{
  "directoryClubId": 4,
  "role": "Secretary",
  "evidence": "I have been the club secretary for the past three seasons."
}
```

| Field | Type | Rules |
|---|---|---|
| `directoryClubId` | integer | Required. Must exist in `clubs_data` (public `/clubs` directory). |
| `role` | string | Required. Free-text (max 120 chars) — what the claimant does at the club. |
| `evidence` | string | Required. 20–2000 chars. Plain text; renders verbatim in the admin queue. |

**201 Success:**
```json
{
  "status": "success",
  "data": {
    "id": 15,
    "directoryClubId": 4,
    "status": "pending",
    "submittedAt": "2026-08-20T08:33:15.000Z"
  }
}
```

**Errors — with machine-readable `code`:**

| Status | `code` | When |
|---|---|---|
| `400` | `missing_role` | role missing/empty |
| `400` | `role_too_long` | role > 120 chars |
| `400` | `evidence_too_short` | evidence < 20 chars |
| `400` | `evidence_too_long` | evidence > 2000 chars |
| `400` | `invalid_club_id` | directoryClubId missing / not a number |
| `400` | `bad_json` | body isn't valid JSON |
| `401` | `unauthorized` | no bearer token |
| `409` | `claim_pending_exists` | caller already has a pending claim for this club — show "view your existing claim" not "submit again" |
| `409` | `club_already_claimed` | someone else already owns this club |
| `422` | `unknown_club` | directoryClubId doesn't exist |
| `429` | `rate_limited` | > 5 claims submitted in the past hour (`retryAfterSeconds` in body) |
| `500` | `internal` | server error |

### `GET /claims/mine`  (CRM_BASE, 🔒 auth)

The caller's claims across all statuses, newest first.

**200:**
```json
{
  "status": "success",
  "data": {
    "claims": [
      {
        "id": 15,
        "directoryClubId": 4,
        "clubName": "Fitzroy Victoria Bowling and Sports Club",
        "region": "Fitzroy",
        "sport": "bowls",
        "role": "Secretary",
        "status": "pending",
        "submittedAt": "2026-08-20T08:33:15.000Z",
        "decidedAt": null,
        "rejectionReason": null,
        "rejectionCode": null
      }
    ]
  }
}
```

Rejected rows carry `rejectionReason` (verbatim from the reviewing admin, safe to render as plain text) + `rejectionCode`:
- `user_reject` — a platform admin rejected it via `/reject`.
- `sibling_approved` — auto-rejected because another admin got there first on the same club. The `rejectionReason` in this case is the fixed string "Club already claimed by another admin." — feel free to substitute custom copy off the code.

---

## Admin queue (platform-admin only)

All three endpoints require `is_platform_admin: true` on the caller. Anyone else gets `403 { code: "forbidden" }` — redirect to `/forbidden` or similar.

### `GET /admin/claims`  (CRM_BASE, 🔒 platform-admin)

**Query params:**

| Param | Default | Notes |
|---|---|---|
| `status` | `pending` | `pending | approved | rejected | all` |
| `limit` | `50` | Server clamps to 50 |
| `cursor` | *(omit for page 1)* | Opaque base64 cursor from a prior response's `nextCursor`. Do not decode. |

**Sort:** `pending`/`all` by `submittedAt DESC`; `approved`/`rejected` by `decidedAt DESC`.

**200:**
```json
{
  "status": "success",
  "data": {
    "claims": [
      {
        "id": 15,
        "status": "pending",
        "clubId": 4,
        "clubName": "Fitzroy Victoria Bowling and Sports Club",
        "region": "Fitzroy",
        "sport": "bowls",
        "claimant": {
          "id": 23,
          "firstName": "Noah",
          "lastName": "Rodda",
          "email": "noah@qubestudio.co.nz",
          "avatarUrl": "https://imagedelivery.net/.../avatar",
          "role": "Secretary"
        },
        "evidence": "I have been the club secretary for the past three seasons.",
        "submittedAt": "2026-08-20T08:33:15.000Z",
        "decidedAt": null,
        "decidedBy": null,
        "rejectionReason": null,
        "rejectionCode": null
      }
    ],
    "nextCursor": null
  }
}
```

Notes:
- `sport` is a **string code** (`bowls | tennis | golf | cricket | petanque | croquet`).
- `clubName`, `region`, `sport` are **snapshotted on the claim row** at submit time — the admin queue keeps rendering even if the directory record later changes.
- `firstName`/`lastName` are split best-effort from the users' single `name` field (first token → firstName, remainder → lastName).
- `decidedBy` is the reviewing admin's full name (e.g. "Nev Rodda") — render verbatim.
- Pagination: request page 1 without a cursor. If `nextCursor` is non-null, page 2 = same URL + `cursor=<nextCursor>`. No total count.

### `POST /admin/claims/{claim_id}/approve`  (CRM_BASE, 🔒 platform-admin)

Empty body. Atomic transaction — see [What approve actually does](#what-approve-actually-does).

**200:**
```json
{
  "status": "success",
  "data": {
    "id": 15,
    "status": "approved",
    "decidedAt": "2026-08-20T08:33:16.000Z",
    "decidedBy": "Nev Rodda",
    "clubId": 4
  }
}
```

`clubId` is the CRM club id — same as the directory `club_id`. Frontend can use it to route to `/clubs/{clubId}/dashboard`.

**Errors:**

| Status | `code` |
|---|---|
| `403` | `forbidden` |
| `404` | `not_found` — claim doesn't exist |
| `409` | `already_decided` — already approved or rejected |
| `409` | `club_already_claimed` — race with another admin |
| `500` | `internal` |

### `POST /admin/claims/{claim_id}/reject`  (CRM_BASE, 🔒 platform-admin)

**Request:**
```json
{ "reason": "We couldn't verify your role — please attach recent committee minutes and re-submit." }
```

`reason`: 10–500 chars, required. Renders verbatim to the claimant.

**200:**
```json
{
  "status": "success",
  "data": {
    "id": 15,
    "status": "rejected",
    "decidedAt": "2026-08-20T08:33:16.000Z",
    "decidedBy": "Nev Rodda",
    "rejectionReason": "..."
  }
}
```

**Errors:** `400 reason_too_short` / `400 reason_too_long` / `400 bad_json` / `403 forbidden` / `404 not_found` / `409 already_decided` / `500 internal`.

---

## <a id="what-approve-actually-does"></a>What approve actually does

One MySQL transaction — all-or-nothing:

1. Marks the claim `approved` with `decided_at` + `decided_by_user_id`.
2. Sets `clubs_data.provisioned_at = NOW()`, `owner_user_id = <claimant>`, `slug = <slugified club name>`.
3. Inserts `club_members(role='owner')` for the claimant. If they already have a lower-tier row, it's upgraded to owner.
4. Auto-rejects every other pending claim on the same club with `rejection_code='sibling_approved'`, `rejectionReason="Club already claimed by another admin."`

If any step fails, the whole transaction rolls back — the claim stays pending. A 200 response guarantees all four effects committed.

**Not yet — M5:** `claim.approved` / `claim.rejected` emails, `audit_log` row per decision. Backend will add these transparently; no frontend change.

---

## Wire-up

### `packages/api-client/src/resources/claims.ts`

```ts
import { CRM_BASE } from '../config'
import { authedFetch } from '../http'

export const claims = {
  submit(payload: { directoryClubId: number; role: string; evidence: string }) {
    return authedFetch(`${CRM_BASE}/claims`, { method: 'POST', body: JSON.stringify(payload) })
  },
  mine() {
    return authedFetch(`${CRM_BASE}/claims/mine`)
  },
  adminList(status: 'pending'|'approved'|'rejected'|'all' = 'pending', cursor?: string, limit = 50) {
    const qs = new URLSearchParams({ status, limit: String(limit) })
    if (cursor) qs.set('cursor', cursor)
    return authedFetch(`${CRM_BASE}/admin/claims?${qs}`)
  },
  approve(claimId: number) {
    return authedFetch(`${CRM_BASE}/admin/claims/${claimId}/approve`, { method: 'POST', body: '{}' })
  },
  reject(claimId: number, reason: string) {
    return authedFetch(`${CRM_BASE}/admin/claims/${claimId}/reject`, { method: 'POST', body: JSON.stringify({ reason }) })
  },
}

export const me = () => authedFetch(`${CRM_BASE}/me`)
```

### Session store — refresh on route change

```ts
// stores/session.ts
export const useSession = defineStore('session', {
  state: () => ({ user: null as User | null }),
  getters: {
    isSignedIn:      (s) => s.user !== null,
    isPlatformAdmin: (s) => s.user?.is_platform_admin === true,
    hasClubAccess:   (s) => (s.user?.clubs ?? []).length > 0,
    ownedClubs:      (s) => (s.user?.clubs ?? []).filter(c => c.role === 'owner'),
  },
  actions: {
    async login(email: string, password: string) {
      const json = await fetch(`${SAM_BASE}/login`, {...}).then(r => r.json())
      if (json.status !== 'success') throw new Error(json.message)
      localStorage.setItem('torny.token', json.token)
      this.user = json.user
    },
    async refresh() {
      const json = await me()
      this.user = json.data
    },
    signOut() {
      localStorage.removeItem('torny.token')
      this.user = null
    },
  },
})

// router.beforeEach — refresh on any authed route
router.beforeEach(async (to) => {
  const session = useSession()
  if (!to.meta.requiresAuth) return
  if (localStorage.getItem('torny.token') && !session.user) {
    try { await session.refresh() } catch { session.signOut(); return '/sign-in' }
  }
  if (to.meta.requiresPlatformAdmin && !session.isPlatformAdmin) return '/'
})
```

### Role → landing route

```ts
switch (user.role) {
  case 'platform':   return '/admin/claims'
  case 'owner':
  case 'admin':
  case 'committee':  return `/clubs/${user.clubs[0].id}/dashboard`
  case 'player':
  default:           return '/claim'    // "you're a Torny user but haven't claimed a club"
}
```

### Admin queue — optimistic approve/reject pattern

Matches the existing store logic:
1. On approve click: locally set `status='approved'`, fire `claims.approve(id)`, roll back on error.
2. On reject click: open the reason modal → on confirm locally set `status='rejected'` + `rejectionReason`, fire `claims.reject(id, reason)`, roll back on error.
3. After success, refetch the current tab — auto-reject may have flipped sibling pendings into the Rejected tab.

---

## Test accounts + seed data

**Platform admin:**
- `nev@torny.co` / `Abundance1!` — `role: 'platform'`, `is_platform_admin: true`.

**Regular player:**
- `noah@qubestudio.co.nz` / `Abundance1!` — `role: 'player'`.

**Seed data (loaded on prod 2026-08-20):**
- 8 users, emails `crm-seed-1@example.com` through `crm-seed-8@example.com`, all password `Seed1!`.
- 6 pending claims across ages 0–5 days (three are >2 days old for the urgency indicator).
- 1 approved claim (Approved tab).
- 1 rejected claim (`rejection_code: 'user_reject'`, real reason).

Log in as any seed user to see their claimant-side view.

---

## Timezones + IDs

- All timestamps are UTC ISO 8601 strings. Client formats for display.
- All IDs are integers (not ULIDs). The brief-01 `usr_...` / `clm_...` shape is not what's returned — we kept the existing integer PKs so everything joins with the mobile app's graph cleanly.

---

## Error shape (universal)

```json
{ "status": "error", "code": "some_code", "message": "Human-readable message" }
```

- **`code`** is present on every non-500 error and is stable across API changes — use it for switching UI copy (matches brief 05 §3.4).
- **`message`** may vary — do not string-match it.

---

## What's still coming

Non-blocking for the CRM as designed, but flag if any turn into a hard blocker:

| Feature | Ships in |
|---|---|
| `POST /auth/verify-email` (email verification flow) | M2 |
| `POST /auth/refresh` + refresh tokens (rotation, reuse detection) | M2 |
| `POST /auth/logout` (server-side session kill) | M2 |
| `/auth/*` alias URLs | M2 (nice-to-have) |
| Login rate limiting (5 failed / 15 min) | M2 |
| `claim.approved` / `claim.rejected` emails | M5 |
| `audit_log` writes | M5 |
| Team access — invites, members list, ownership transfer | M5 (brief 02) |

---

## Contact

Same as previous briefs — `#torny-eng` on Slack or an issue against `tornyglory/torny-crm-websites`. Happy to pair through anything above.
