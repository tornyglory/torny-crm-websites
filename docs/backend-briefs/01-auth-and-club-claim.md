# Backend brief — Auth + Club Claim

**Audience:** Torny backend engineers
**Frontend counterpart:** `apps/crm` (Vue 3 SPA)
**Status:** Ready to build
**Owner:** Neville Rodda (`nev@torny.co`)

---

## 1. What the frontend already does

The CRM currently mocks the entire auth + claim + review flow in `localStorage`. Nothing hits an API. Every seam that this brief describes has a matching Pinia store the backend just needs to replace the persistence for:

| Frontend area | Current mock | File |
| --- | --- | --- |
| Sign in | drops a fake JWT + user | `apps/crm/src/views/auth/SignInView.vue` |
| Club directory search | live (public SAM API) | `packages/api-client/src/resources/directory.ts` |
| Claim submission | fake 600ms delay | `apps/crm/src/views/auth/ClaimClubView.vue` |
| Platform admin queue | seeded in-memory | `apps/crm/src/stores/claims.ts` |
| Approve / reject | mutates local store | same |
| Users + moderation | seeded in-memory | `apps/crm/src/stores/platformUsers.ts` |

The directory service at `https://ieg3lhlyy0.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs` is already live and public — do not touch it. This brief is purely about the CRM API that sits alongside it.

---

## 2. Goal of this milestone

Turn the mock into a working system for two flows:

1. **A club admin claims their club** — signs up, picks their club from the directory, submits evidence, waits for review, then signs in to their CRM.
2. **Neville (platform admin) reviews claims** — sees the queue, approves or rejects with reason. Approvals provision the claimant as `owner` of the club in the CRM API. Rejections send them an email.

**Out of scope for this milestone** (separate briefs will follow):
- Real member management inside a club's CRM
- Public site hosting / subdomain provisioning
- Payments / plans
- Federated login (Google, Apple)
- Multi-sport (data model must allow it — see §5 — but sport-specific rules can wait)

---

## 3. Auth model

### 3.1 Session token

- **JWT, HS256**, 24 h expiry, refresh via `POST /auth/refresh` (opaque refresh token, 30 days).
- Frontend already stores the access token in `localStorage` under `torny.token` — keep this key.
- Access token payload:
  ```json
  {
    "sub": "usr_01H...",
    "email": "grace@naenaebowling.org.nz",
    "role": "platform" | "owner" | "admin" | "committee" | "player",
    "clubs": [{ "id": "clb_01H...", "role": "owner" }],
    "iat": 1735689600,
    "exp": 1735776000
  }
  ```
- `role` is the **platform-level** role. `clubs[]` carries per-club roles for anyone with club access. `platform` role has an empty `clubs[]` and full read/write across every club.

### 3.2 Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | none | Create account (unverified) |
| `POST` | `/auth/verify-email` | none | Confirm email via token |
| `POST` | `/auth/login` | none | Exchange credentials for JWT + refresh |
| `POST` | `/auth/refresh` | refresh | New access token |
| `POST` | `/auth/logout` | bearer | Invalidate refresh token |
| `POST` | `/auth/request-password-reset` | none | Email a reset link |
| `POST` | `/auth/reset-password` | none | Consume reset token + new password |
| `GET` | `/me` | bearer | Current user + `clubs[]` |

### 3.3 Register request / response

```
POST /auth/register
Content-Type: application/json

{
  "firstName": "Marcus",
  "lastName": "Tuilagi",
  "email": "marcus.t@kelburnbowls.co.nz",
  "password": "…"
}

201 Created
{
  "userId": "usr_01H...",
  "emailVerificationSent": true
}
```

- Password: min 10 chars, at least one letter + one number. Enforce server-side.
- Email verification token: single-use, 24 h TTL, delivered by email. The verification link should return the user to `https://crm.torny.co/verify-email?token=…` — the SPA POSTs the token to `/auth/verify-email`.
- Return a **generic 201** even on duplicate email. Do **not** leak whether an email is registered.

### 3.4 Login

```
POST /auth/login
{
  "email": "…",
  "password": "…"
}

200
{
  "accessToken": "eyJ…",
  "refreshToken": "opaque…",
  "user": {
    "id": "usr_01H...",
    "firstName": "Marcus",
    "lastName": "Tuilagi",
    "email": "marcus.t@kelburnbowls.co.nz",
    "role": "player",
    "clubs": []
  }
}
```

- **Rate limit:** 5 failed attempts per email per 15 min → 429 with retry-after.
- Reject unverified emails with `403 { code: "email_unverified" }` (frontend re-triggers verification email).
- **Do not** return a distinct 404 vs 401 for wrong email vs wrong password. Use `401 { code: "invalid_credentials" }` for both.

### 3.5 Platform admin

Platform admins are identified by a boolean flag on the users table (`is_platform_admin`). Do **not** rely on the email allowlist the frontend currently uses — that is only in the mock. On login, if the flag is true, set `role: "platform"` in the JWT and skip club provisioning.

Seed one platform admin at deploy time: `nev@torny.co` — password set out-of-band.

---

## 4. Club claim flow

### 4.1 State machine

```
[registered user, no clubs]
        │
        ▼  POST /claims
   ┌─────────────┐   POST /admin/claims/:id/approve   ┌─────────────┐
   │  pending    │ ──────────────────────────────────► │  approved   │
   └─────────────┘                                     └─────────────┘
        │                                                    │
        │ POST /admin/claims/:id/reject                      │
        ▼                                                    ▼
   ┌─────────────┐                                     [user granted
   │  rejected   │                                      owner role]
   └─────────────┘
```

**One pending claim per (user, directory_club) pair** — enforce with a unique constraint. If a user re-submits after rejection, that's a new claim row (the old one stays in history).

**A directory club can only ever have one approved claim.** Enforce this too. If a claim is approved, any other pending claims for the same directory club are auto-rejected with reason "Club already claimed by another admin."

### 4.2 Submit a claim

```
POST /claims
Authorization: Bearer <token>

{
  "directoryClubId": 47,
  "role": "President",           // free-text: what role at the club
  "evidence": "President of Petone Central for the last two seasons…"
}

201
{
  "id": "clm_01H...",
  "directoryClubId": 47,
  "status": "pending",
  "submittedAt": "2026-08-19T09:47:00Z"
}
```

Server-side:
- `directoryClubId` must exist on the SAM directory API. Cache the club record (name, region, sport) on the claim row at submit time so the review UI keeps working even if the directory record changes.
- `evidence`: 20–2000 chars, required.
- Fire a `claim.submitted` notification: email to every platform admin.

### 4.3 List my claims (for the claimant)

```
GET /claims/mine
Authorization: Bearer <token>

200
{
  "claims": [
    {
      "id": "clm_01H...",
      "directoryClubId": 47,
      "clubName": "Petone Central",
      "region": "Wellington",
      "sport": "bowls",
      "status": "pending",
      "submittedAt": "2026-08-19T09:47:00Z"
    }
  ]
}
```

Used by the "your submitted claim" screen after step 3 of the claim wizard.

---

## 5. Multi-sport data model

The platform will hold clubs across sports (bowls first, then tennis, golf, cricket, pétanque, croquet — see `apps/crm/src/stores/sports.ts` for the enum the frontend uses today).

**Every club row must carry a sport code.** The directory API already exposes `sport` as an integer per club. Map that to the string codes above in the CRM API so the client doesn't need to know the numeric mapping. Suggested mapping:

| Directory `sport` int | CRM `sport` string |
| --- | --- |
| 1 | `bowls` |
| 2 | `tennis` |
| 3 | `golf` |
| 4 | `cricket` |
| 5 | `petanque` |
| 6 | `croquet` |

Confirm the directory team owns the source-of-truth mapping — this brief assumes they do.

Once wired, the CRM API returns `sport: "bowls"` etc. on every club and claim payload. Frontend already renders a sport column on `/admin/clubs` and `/admin/users`; no client changes needed once the field lands.

---

## 6. Platform admin — claim review

All routes here require `role: "platform"` in the JWT. Return **403** otherwise, not 404.

### 6.1 List claims

```
GET /admin/claims?status=pending&limit=50&cursor=…
Authorization: Bearer <platform-token>

200
{
  "claims": [
    {
      "id": "clm_01H...",
      "status": "pending",
      "clubId": 12,
      "clubName": "Kelburn Bowling Club",
      "region": "Wellington",
      "sport": "bowls",
      "claimant": {
        "id": "usr_01H...",
        "firstName": "Marcus",
        "lastName": "Tuilagi",
        "email": "marcus.t@kelburnbowls.co.nz",
        "role": "Secretary"
      },
      "evidence": "…",
      "submittedAt": "2026-08-19T14:22:00Z"
    }
  ],
  "nextCursor": null
}
```

- `status` accepts `pending`, `approved`, `rejected`, or omitted for all.
- Sort: `submittedAt DESC` for pending; `decidedAt DESC` for approved/rejected.
- Cursor pagination (opaque string). No offset pagination.

### 6.2 Approve

```
POST /admin/claims/:id/approve
Authorization: Bearer <platform-token>

{}   // empty body

200
{
  "id": "clm_01H...",
  "status": "approved",
  "decidedAt": "2026-08-20T09:10:00Z",
  "decidedBy": "Neville Rodda",
  "clubId": "clb_01H..."   // new CRM club record
}
```

Approving must, atomically:
1. Update the claim row to `approved`.
2. Create a `clubs` row in the CRM database, hydrated from the directory record (name, sport, region, address, timezone).
3. Insert a `club_members` row assigning the claimant as `owner`.
4. Auto-reject every other pending claim on the same `directoryClubId` with reason "Club already claimed by another admin."
5. Fire `claim.approved` notification (email to claimant).
6. Fire `club.provisioned` webhook (internal) so downstream systems can create the club's public site subdomain.

Any step failing → rollback all of them.

### 6.3 Reject

```
POST /admin/claims/:id/reject
Authorization: Bearer <platform-token>

{
  "reason": "We couldn't verify your role — please attach recent committee minutes and re-submit."
}

200
{
  "id": "clm_01H...",
  "status": "rejected",
  "decidedAt": "2026-08-20T09:12:00Z",
  "decidedBy": "Neville Rodda",
  "rejectionReason": "…"
}
```

- `reason` required, 10–500 chars. Shown to the claimant verbatim.
- Fire `claim.rejected` notification (email to claimant, includes reason).

### 6.4 Errors

| Case | Response |
| --- | --- |
| Claim not found | `404` |
| Claim already decided | `409 { code: "already_decided" }` |
| Approve when club already has approved claim | `409 { code: "club_already_claimed" }` |
| Non-platform admin calls admin route | `403 { code: "forbidden" }` |

---

## 7. Notifications (email)

Transactional email. Use whatever provider fits (Resend, SES, Postmark). Templates the backend needs:

| Template | Trigger | To |
| --- | --- | --- |
| `email.verify` | Register | new user |
| `password.reset` | Reset requested | user |
| `claim.submitted` | Claim POSTed | all platform admins |
| `claim.approved` | Claim approved | claimant |
| `claim.rejected` | Claim rejected | claimant (includes reason) |
| `club.provisioned` | (Internal, later) | ops channel |

All templates ship with a plaintext fallback. Subjects should start with `[Torny]`.

---

## 8. Data model sketch

Not prescriptive — implement in whatever store the team is standardising on. This is the shape the endpoints imply.

```
users
  id, first_name, last_name, email UNIQUE, password_hash,
  is_platform_admin BOOL DEFAULT false,
  email_verified_at NULLABLE,
  created_at, updated_at

refresh_tokens
  id, user_id FK, token_hash, expires_at, revoked_at NULLABLE

clubs
  id, directory_club_id INT UNIQUE, slug UNIQUE, name,
  sport ENUM('bowls','tennis','golf','cricket','petanque','croquet'),
  region, country, address,
  provisioned_at, created_at

club_members
  id, club_id FK, user_id FK,
  role ENUM('owner','admin','committee','player'),
  joined_at, revoked_at NULLABLE,
  UNIQUE(club_id, user_id)

claims
  id, user_id FK, directory_club_id INT,
  club_name, region, sport,     -- snapshot at submit time
  role_at_club TEXT,
  evidence TEXT,
  status ENUM('pending','approved','rejected'),
  submitted_at, decided_at NULLABLE,
  decided_by_user_id FK NULLABLE,
  rejection_reason TEXT NULLABLE,
  UNIQUE(user_id, directory_club_id) WHERE status = 'pending'
```

`ID` format: ULID-based prefixed strings (`usr_`, `clb_`, `clm_`) so IDs sort chronologically and are self-describing in logs.

---

## 9. Security notes

- **Bcrypt or Argon2** for passwords, cost tuned to ~250 ms.
- **Refresh token rotation** — every `/auth/refresh` invalidates the old refresh and issues a new one. Reuse of a revoked refresh token → invalidate the whole family and force re-login (compromise signal).
- **CORS** — accept only `https://crm.torny.co` and `http://localhost:5174` in dev.
- **Audit log** on every claim decision: `who, what, when, reason` — retained ≥ 3 years. This backs the moderation log the frontend already displays.
- Rate-limit `/claims` at 5 submissions per user per hour.
- Sanitise `evidence` and `rejection_reason` — strip HTML, but preserve line breaks. These render as plain text in the CRM and inside emails.

---

## 10. Suggested build order

1. Users + `/auth/register`, `/auth/verify-email`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/me`.
2. Password reset (`/auth/request-password-reset`, `/auth/reset-password`).
3. Claims table + `POST /claims`, `GET /claims/mine`.
4. Platform admin routes: `GET /admin/claims`, approve, reject.
5. Approval side effects: club provisioning, auto-reject siblings, notification emails.
6. Hand off — frontend swaps mock stores for real API calls one screen at a time.

---

## 11. Open questions

- **Sport enum authority.** Confirmed above the directory team owns the int→string mapping. Backend to verify before implementing §5.
- **Notification provider.** Resend is the default recommendation unless ops already have SES set up.
- **Session invalidation on ban.** When a platform admin bans a user (frontend already builds this UI), the backend needs to revoke every refresh token for that user immediately and drop them out on next access-token expiry (~24 h). Explicit endpoint or side-effect of `/admin/users/:id/ban` — pick one, document it.
- **Directory 404 on submit.** What if the SAM directory returns 404 for the `directoryClubId` at submit time? Reject with `422 { code: "unknown_club" }`.

---

## 12. Frontend contact

Ping Nev on Slack (`#torny-eng`) or open an issue against `tornyglory/torny-crm-websites`. The frontend can be swapped from mock → live one endpoint at a time; there's no big-bang cutover needed.
