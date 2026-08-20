# Backend brief — Team access

**Audience:** Torny backend engineers
**Frontend counterpart:** `apps/crm` (Vue 3 SPA), Settings → Team access
**Status:** Ready to build alongside brief 01
**Owner:** Neville Rodda (`nev@torny.co`)

---

## 1. What the frontend already does

Settings → **Team access** is fully mocked in `apps/crm/src/views/settings/SettingsView.vue`. The screen shows the three roles a club can have on the CRM and lets the club owner invite more people, change their role, and revoke access. Everything currently lives in a `ref([])` — no persistence, no API.

| Frontend area | Current mock | File / hook |
| --- | --- | --- |
| Team list (Owner / Admin / Committee) | seeded array | `SettingsView.vue` → `const team = ref([...])` |
| "+ Invite" modal | pushes into the array + toast | `openInvite()` → `sendInvite()` |
| Role picker on a row | toast placeholder | `manageTeamRow()` |
| "Last active" pill | static string | same array |
| Transfer / archive club (danger zone) | placeholder buttons | `active === 'danger'` block |

This brief covers the CRM-side team access API only. Auth, sessions and password reset are covered in brief [01-auth-and-club-claim.md](./01-auth-and-club-claim.md) — this one assumes those endpoints exist.

---

## 2. Goal of this milestone

Turn the mocked Team access screen into a working system so a club owner can:

1. **Invite** a teammate by email, pick their role (Admin or Committee), and see the invite pending until the invitee accepts.
2. **Manage** an existing member — change role, revoke access, resend invite.
3. **See who's actually using the CRM** — a real "last active" timestamp per member.
4. **Transfer ownership** to another current member (danger zone).

**Out of scope for this milestone:**
- Player-level access to a club's public site (that's a separate future model, not CRM roles)
- Custom / granular permissions — the four roles below are the whole grammar
- SSO / federated invite links
- Bulk invite / CSV import

---

## 3. Role model

Roles are per-club, stored on `club_members` (defined in brief 01 §8). Recap of the enum, with what each role can actually do in the CRM:

| Role | Team access | Members | Events | Website | Billing | Danger zone |
| --- | --- | --- | --- | --- | --- | --- |
| `owner` | Full — invite/remove anyone, transfer ownership | RW | RW | RW | RW | RW |
| `admin` | Invite Committee only, remove Committee only | RW | RW | RW | R | — |
| `committee` | R (see teammates) | RW | RW | R | — | — |
| `player` | — (no CRM access) | — | — | — | — | — |

Key rules:

- **`owner` is unique per club.** Exactly one row per club_id with role `owner`. Enforce with a partial unique index.
- **Only `owner` can create/remove `admin`s.** `admin`s can only invite/remove `committee`s.
- **Nobody can demote or remove the `owner`** — ownership only moves via transfer (§6). This includes the owner themselves; they must transfer first, then leave.
- **`player`** is a valid platform-level role for a user who has no CRM access to any club (see brief 01 §3.1). Not writable via team-access endpoints — a `club_members` row is only created for CRM-facing roles.
- **Platform admins** (`role: "platform"` in JWT) can do anything a club owner can, on any club, without a `club_members` row. Enforce via the auth middleware, not by inserting rows.

---

## 4. Endpoints

All routes require a bearer token. Authorisation is the caller's `club_members.role` on the `:clubId` in the path (or `is_platform_admin` on the user).

### 4.1 List team members

```
GET /clubs/:clubId/members?includeInvites=true

200
{
  "members": [
    {
      "id": "cmb_01H...",
      "userId": "usr_01H...",
      "firstName": "Marcus",
      "lastName": "Tuilagi",
      "email": "marcus@example.com",
      "role": "owner",
      "joinedAt": "2026-01-14T02:11:00Z",
      "lastActiveAt": "2026-08-20T14:07:00Z"
    },
    { "...admin..." },
    { "...committee..." }
  ],
  "invites": [
    {
      "id": "inv_01H...",
      "email": "new-teammate@club.co.nz",
      "role": "committee",
      "invitedBy": { "id": "usr_01H...", "firstName": "Marcus" },
      "invitedAt": "2026-08-19T21:04:00Z",
      "expiresAt": "2026-08-26T21:04:00Z",
      "status": "pending"
    }
  ]
}
```

- Any club member can call this (owner, admin, committee).
- `lastActiveAt` = last successful request with this user's bearer token. Update at most once per minute per user to avoid write amplification — see §7.
- Sort: `owner` first, then `admin`, then `committee`, each block by `joinedAt ASC`. Invites sorted by `invitedAt DESC`.

### 4.2 Invite a teammate

```
POST /clubs/:clubId/invites
Authorization: Bearer <owner-or-admin>

{
  "email": "new-teammate@club.co.nz",
  "role": "admin" | "committee",
  "message": "Kia ora — you'll now have CRM access…"   // optional, ≤ 500 chars
}

201
{
  "id": "inv_01H...",
  "email": "new-teammate@club.co.nz",
  "role": "committee",
  "expiresAt": "2026-08-26T21:04:00Z",
  "status": "pending"
}
```

Rules:

- Only `owner` may invite `admin`. `admin` may only invite `committee`. Enforce server-side; return `403 { code: "role_not_permitted" }`.
- `role` in the request cannot be `owner` or `player`. → `422 { code: "invalid_role" }`.
- Reject if there's already a pending invite for `(clubId, email)`. → `409 { code: "invite_exists" }`. Frontend will offer a "resend" action instead.
- Reject if the email already resolves to an active `club_members` row on this club. → `409 { code: "already_member" }`.
- If the email doesn't match any existing user, the invite still stands — accepting it triggers a register-then-join flow (see §5).
- Fire `team.invited` email to the invitee. Include the optional `message` verbatim (plain-text sanitised).
- Invite tokens are single-use, 7 day TTL, high-entropy random (not JWT). Store hashed, compare in constant time.

### 4.3 Resend invite

```
POST /clubs/:clubId/invites/:inviteId/resend
Authorization: Bearer <owner-or-admin>

204
```

- Only the original inviter, an owner, or a platform admin may resend.
- Rate-limit: max 3 resends per invite; each resend refreshes `expiresAt` by 7 days from now.

### 4.4 Revoke invite

```
DELETE /clubs/:clubId/invites/:inviteId
Authorization: Bearer <owner-or-admin>

204
```

- Sets invite `status = revoked`. Does not delete the row (audit).
- Any subsequent attempt to redeem the token → `410 { code: "invite_revoked" }`.

### 4.5 Accept invite

```
POST /invites/accept

{
  "token": "…",
  "firstName": "Ana",     // required if no existing user for this email
  "lastName": "Kereopa",  //   "
  "password": "…"         //   " — same rules as brief 01 §3.3
}

200
{
  "accessToken": "eyJ…",
  "refreshToken": "…",
  "user": { "...brief 01 §3.4 shape..." }
}
```

- If a verified user with this email exists, `firstName/lastName/password` are ignored — the invite just adds the `club_members` row and returns a fresh token. The invitee is signed in immediately.
- If no user exists, this atomically creates the user (email auto-verified — the invite email proves ownership), assigns the club membership, and returns tokens.
- Invalid / expired / revoked / already-consumed token → `410 { code: "invite_unusable" }`.
- Fire `team.joined` notification to the club owner + all admins.

### 4.6 Change a member's role

```
PATCH /clubs/:clubId/members/:memberId
Authorization: Bearer <owner>

{
  "role": "admin" | "committee"
}

200
{ "id": "cmb_01H...", "role": "admin", "updatedAt": "…" }
```

- Only `owner` (or platform admin) may change roles.
- Cannot set `role` to `owner` via this endpoint — use §6.
- Cannot change the current owner's row here — → `409 { code: "owner_immutable" }`.
- Fire `team.role_changed` email to the affected member.

### 4.7 Remove a member

```
DELETE /clubs/:clubId/members/:memberId
Authorization: Bearer <owner-or-admin>

204
```

- Owner can remove admin or committee.
- Admin can only remove committee. Attempting to remove an admin → `403 { code: "role_not_permitted" }`.
- Removing the owner → `409 { code: "owner_immutable" }`. Owner must transfer first.
- Sets `revoked_at` on `club_members` (soft-delete). All the user's active sessions on that club get their JWT re-issued on next `/auth/refresh` without that club in `clubs[]` — but existing access tokens will still work up to their 24 h expiry. Accept this trade-off; no server-side session kill is required at this milestone.
- If the removed user has no remaining `club_members` rows, they revert to platform role `player`.
- Fire `team.removed` email to the removed member.

---

## 5. Invite acceptance for new users

When the invitee has no existing user account:

1. They receive `team.invited` email with a link to `https://crm.torny.co/accept-invite?token=…`.
2. The SPA renders a compact registration form (first name, last name, password) pre-filled with the invited email (read-only).
3. Submit hits `POST /invites/accept` with the token + registration fields.
4. Backend atomically:
   - Creates `users` row with `email_verified_at = now()` (invite email is proof).
   - Creates `club_members` row with the invited role.
   - Marks the invite `status = accepted`.
   - Issues access + refresh tokens.
5. Frontend stores the token and lands the user on `/crm/dashboard` for the invited club.

If any step fails, roll back all of them and return `500 { code: "accept_failed" }`. The invite must remain in `pending` so the user can retry.

---

## 6. Ownership transfer

Ownership is transferred, never granted twice. Trigger from Settings → Danger zone → "Transfer ownership".

```
POST /clubs/:clubId/transfer-ownership
Authorization: Bearer <owner>

{
  "toMemberId": "cmb_01H...",
  "password": "…"    // current owner re-authenticates
}

200
{
  "clubId": "clb_01H...",
  "previousOwner": { "memberId": "cmb_01H...", "newRole": "admin" },
  "newOwner":      { "memberId": "cmb_01H..." }
}
```

Rules:

- Caller must be current `owner`. Platform admins may not use this endpoint — they'd use an admin-only override (out of scope here).
- `toMemberId` must be an active member of this club with role `admin` or `committee`. Not a pending invite. → `422 { code: "invalid_transfer_target" }`.
- `password` must match the current owner's stored hash. → `401 { code: "invalid_password" }`.
- The transfer is atomic: previous owner is demoted to `admin`, target is promoted to `owner`. Both `club_members.updated_at` bumped, both users' next `/me` returns fresh roles.
- Fire `team.ownership_transferred` email to both parties + all admins.
- Write an entry to the club's audit log (`who, from, to, when`). Retained ≥ 3 years, same policy as brief 01 §9.

---

## 7. `lastActiveAt` tracking

The frontend renders "Last active 2h ago" per member. Backend needs a cheap-to-write, cheap-to-read `last_active_at` per user.

- Update on any authenticated request. Coalesce: only write if the stored value is older than 60 s.
- Store on `users.last_active_at TIMESTAMPTZ NULL`. Not on `club_members` — a user active in one club is active for the platform.
- Expose to team-list responses only. Never expose to non-members (privacy).

Client renders relative time itself. Return ISO 8601.

---

## 8. Data model additions

Extends brief 01 §8. Only new/changed columns shown.

```
users
  ...brief 01...
  last_active_at TIMESTAMPTZ NULL

club_members
  ...brief 01...
  invited_by_user_id FK NULLABLE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

  -- partial unique: exactly one owner per club
  UNIQUE (club_id) WHERE role = 'owner' AND revoked_at IS NULL

club_invites
  id, club_id FK, email, role ENUM('admin','committee'),
  token_hash, expires_at,
  invited_by_user_id FK,
  message TEXT NULL,
  status ENUM('pending','accepted','revoked','expired') DEFAULT 'pending',
  invited_at, accepted_at NULLABLE, revoked_at NULLABLE,
  UNIQUE (club_id, email) WHERE status = 'pending'

audit_log
  id, club_id FK, actor_user_id FK,
  action TEXT,       -- 'invite.sent', 'member.role_changed', 'ownership.transferred', ...
  target_user_id FK NULLABLE,
  before JSONB NULL, after JSONB NULL,
  created_at
```

`club_invites.id` prefix: `inv_`. All IDs remain ULID-based per brief 01.

---

## 9. Notifications (email)

Extends brief 01 §7. New templates:

| Template | Trigger | To |
| --- | --- | --- |
| `team.invited` | `POST /clubs/:clubId/invites` | invitee |
| `team.joined` | Invite accepted | club owner + all admins |
| `team.role_changed` | Member role changed | affected member |
| `team.removed` | Member removed | affected member |
| `team.ownership_transferred` | Ownership transferred | previous + new owner + all admins |

All subjects prefix `[Torny]`. `team.invited` includes the inviter's name, the club name, the assigned role, the optional message, and a single call-to-action link.

---

## 10. Security notes

- **Invite tokens:** 32 bytes CSPRNG, base64url. Stored hashed (SHA-256 is fine — these are single-use with a TTL, not passwords). Redeem in constant time.
- **Rate limits:**
  - `POST /clubs/:clubId/invites` — max 20 per club per hour.
  - `POST /invites/accept` — max 10 attempts per token, then invalidate the invite (`status = revoked`) as a compromise signal.
- **Enumeration:** invite endpoints should not reveal whether an email is an existing Torny user. `POST /clubs/:clubId/invites` always returns 201 on happy path regardless.
- **Audit every mutation** through the audit_log table: invite sent/revoked/resent/accepted, role changed, member removed, ownership transferred. Same 3-year retention as brief 01 §9.
- **Authorisation:** every route above must check both (a) caller's role on the target club and (b) that the target member/invite belongs to that club. Cross-club leaks are the highest-severity bug class here.

---

## 11. Suggested build order

1. `club_invites` table + `POST /clubs/:clubId/invites`, `GET /clubs/:clubId/members?includeInvites=true`.
2. `POST /invites/accept` (both branches: existing user + new user).
3. Resend + revoke invite.
4. `PATCH /clubs/:clubId/members/:memberId` (role change) + `DELETE .../:memberId` (remove).
5. `last_active_at` tracking + surface on list response.
6. Ownership transfer + audit log entries.
7. Frontend swaps `SettingsView.vue` `team` ref for real API calls one action at a time.

Brief 01 must land first — every route here depends on the JWT contract, `club_members` table and `/me` from that brief.

---

## 12. Open questions

- **Owner leaving.** Product decision: can an owner archive the club themselves without transferring? Current assumption is **no** — they must transfer or contact platform admin. Confirm with Nev before implementing danger-zone archive.
- **Committee members inviting.** Locked to owner + admin in this brief. If product later wants "committee can nominate", we'd add an "invite requires approval" state — flag it early.
- **Reactivation of removed members.** If a removed user is re-invited later, do we resurrect the old `club_members` row (preserving `joined_at`) or create a new one? This brief assumes **new row**; the revoked row stays for audit.
- **Cross-club JWT staleness.** Removed members retain CRM access until their 24 h access token expires. If product needs instant kick-out (e.g. a security incident), we'll need a per-user token version bump on `/me` — out of scope here, worth noting.

---

## 13. Frontend contact

Same as brief 01 — ping Nev on Slack (`#torny-eng`). The Team access screen can be swapped mock → live one endpoint at a time; the invite modal and the row-level "Manage" action are the two biggest wins to land first.
