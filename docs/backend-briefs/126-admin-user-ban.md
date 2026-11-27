# Brief 126 — Platform user ban / unban

**Status:** proposed. Not yet scoped on the backend roadmap.

**Feature:** platform admins can ban a user from the whole Torny platform. A banned user can't sign in; their existing sessions stop authenticating on next request. Reversible via `unban`. Audit-logged alongside every other admin action (brief 123 Phase 2).

Mirrors the account-suspend shape from brief 123 §6.3, but scoped to the user record rather than the club. Where club-suspend blocks CRM writes for one tenant, user-ban blocks the human from signing into any club they belong to.

**Prereq:** brief 123 Phase 2 shipped — admin portal + audit table + platform_owner role gate all live.

**Related briefs:**
- Brief 123 §6.3 — account suspend. Same pattern, different target. Reuse the `409 account_suspended` modal flow for `403 account_banned` (adjusted copy).
- Brief 115 — HttpOnly cookies. No conflict; ban check runs on every request regardless of auth transport.
- Brief 124 — per-action audit log. A banned user who attempts to sign in writes a normal auth-failure log, NOT a `banned_user_attempted_access` row — keeping the audit surface single-purpose.

---

## 1. Base URL + auth

```
https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Platform-owner JWT / cookie required on both action endpoints. Non-admins → `403 not_platform_owner`.

---

## 2. Data model

### 2.1 `users` table — three new columns

```sql
ALTER TABLE users
  ADD COLUMN banned_at timestamptz,
  ADD COLUMN banned_reason text,
  ADD COLUMN banned_by_user_id bigint REFERENCES users(id);
```

A non-null `banned_at` means the user is currently banned. Null means active (or never-banned). No "unbanned_at" — unbanning sets `banned_at = NULL` and writes an audit row. History lives in the audit table.

### 2.2 Audit kinds — two new

Extend `platform_admin_audit.action` enum (brief 123 §9 + brief 124):

- `ban_user`
- `unban_user`

Both carry `target_user` populated + `target_club: null`. Payload is `{ reason }` — same discipline as other admin actions.

---

## 3. Endpoints

### 3.1 `POST /admin/users/{user_id}/ban`

```jsonc
// Request — reason required, max 500 chars
{ "reason": "spam-accounts-2026-11-27" }

// 200
{
  "status": "success",
  "data": {
    "ok": true,
    "banned_at": "2026-11-27T04:12:00.000Z"
  }
}
```

**Effect:**
- `UPDATE users SET banned_at = NOW(), banned_reason = ?, banned_by_user_id = ? WHERE id = ?`
- Writes `ban_user` audit row
- **Does NOT invalidate existing JWTs** — ban check runs on every request (§4). Simpler than active token revocation and sufficient for the threat model (the point is to prevent further use; a 10-minute residual window on an existing JWT is acceptable).

**Guards:**
- `409 already_banned` if `banned_at IS NOT NULL`
- `409 cannot_ban_platform_owner` — a platform owner can't be banned without first having their platform_owner flag revoked. Keeps the "lock out of admin" footgun behind two intentional steps.
- `409 cannot_ban_self` — defence against admin accidentally banning themselves.
- `400 reason_required`

### 3.2 `POST /admin/users/{user_id}/unban`

```jsonc
// Request — reason required, max 500 chars
{ "reason": "appeals-cleared-2026-11-29" }

// 200
{ "status": "success", "data": { "ok": true } }
```

**Effect:**
- `UPDATE users SET banned_at = NULL, banned_reason = NULL, banned_by_user_id = NULL WHERE id = ?`
- Writes `unban_user` audit row

**Guards:**
- `409 not_banned` if `banned_at IS NULL`
- `400 reason_required`

### 3.3 `GET /admin/users` — row shape extended

Every user row gains three fields alongside the existing shape (brief 123 §6.6):

```jsonc
{
  "id": 1111,
  "name": "Neville Rodda",
  "email": "nigel@torny.co",
  "signup_at": "2026-08-20T09:00:14.000Z",
  "last_login_at": "2026-11-26T00:54:09.000Z",
  "is_platform_owner": false,
  "club_memberships": [ ... ],

  // NEW — ban state
  "banned_at": null,                              // ISO when banned; null when active
  "banned_reason": null,                          // non-null only when banned_at is set
  "banned_by_user_id": null                       // non-null only when banned_at is set
}
```

Two new filters:
- `?filter[banned]=true` — only banned users
- `?filter[banned]=false` — only active users (default behaviour today; now explicit)

Existing filters (`is_platform_owner`, `multi_club`, `q`) unchanged.

---

## 4. Auth-gate enforcement — every authenticated request

The ban must take effect **everywhere**, not just on sign-in. A user banned mid-session should hit the wall on their next API call, not the next time they sign in.

Add to the authorizer (same hook point as brief 124's per-action audit):

```ts
// Inside the JWT authorizer, AFTER signature + expiry validation:
const user = await getUserById(jwt.userId)   // light query — or cache if hot
if (user?.banned_at) {
  return deny403({
    code: 'account_banned',
    message: 'Your Torny account has been suspended. Contact support if you believe this is an error.'
  })
}
```

**Edge case:** an impersonation JWT whose target user got banned mid-session should also fail here. The authorizer reads `jwt.userId` (the impersonated user), not `impersonated_by`, so this works naturally.

**Performance note:** this adds one DB read per authenticated request. If that's not already in a per-request cache, consider a 60-second TTL Redis entry keyed on user id. Ban-state staleness up to 60s is acceptable.

---

## 5. Error codes — additions

| HTTP | code | When |
|---|---|---|
| 400 | `reason_required` | Ban / unban body missing `reason` |
| 400 | `reason_too_long` | > 500 chars |
| 403 | `account_banned` | **Any authenticated request** from a banned user's JWT (see §4) |
| 404 | `user_not_found` | Path param id doesn't exist |
| 409 | `already_banned` | `POST /ban` on an already-banned user |
| 409 | `not_banned` | `POST /unban` on an active user |
| 409 | `cannot_ban_platform_owner` | Target has `is_platform_admin = 1` |
| 409 | `cannot_ban_self` | Target `user_id` matches the actor |

Existing `403 not_platform_owner` continues to apply when the caller isn't a platform admin.

---

## 6. FE surfaces

### 6.1 `GET /admin/users` filter + display

`AdminUsersView` renders a "Banned" filter chip + a banned status badge on each row. The new `banned_at` field surfaces as a chip tone (danger) + the `banned_reason` shown on expand.

### 6.2 Ban / unban modals

Mirror the existing `AdminSuspendModal` (brief 123 §6.3) pattern — reason input, submit, close. Same component split for `ban` and `unban` modes since they're symmetric.

### 6.3 Global `403 account_banned` handler

Reuse the pattern from brief 123 §6.3's `account_suspended` modal. The CRM's existing `registerApiErrorObserver` observer gains a second clause that catches `code === 'account_banned'` and shows a dedicated modal — "Your account has been suspended. Contact support." + support mailto. No "sign out" button (they're already blocked).

Separate copy from `account_suspended` so admins debugging don't confuse club-level suspension (one tenant blocked) with user-level ban (whole platform blocked).

---

## 7. Verification checklist

Before marking shipped:

- [ ] `POST /admin/users/5/ban` with reason sets `banned_at`, writes audit row
- [ ] The banned user's next API call anywhere returns `403 account_banned`
- [ ] Banned user can't sign in — same `403 account_banned` on `/auth/login`
- [ ] `POST /admin/users/5/unban` clears the fields + writes audit row
- [ ] Banned user's subsequent `/auth/login` succeeds post-unban
- [ ] `POST /admin/users/<my_user_id>/ban` → `409 cannot_ban_self`
- [ ] Ban a platform_owner → `409 cannot_ban_platform_owner`
- [ ] Revoke platform_owner first, then ban → succeeds
- [ ] `GET /admin/users?filter[banned]=true` returns only banned users
- [ ] Row shape carries `banned_at`, `banned_reason`, `banned_by_user_id`
- [ ] `GET /admin/audit?filter[target_user]=5&filter[action]=ban_user` returns the ban event
- [ ] Impersonating a club whose owner just got banned → impersonation JWT 403s on next call

---

## 8. Non-goals

- **Temporary / time-bound bans.** Phase 1 ships permanent (reversible) only. "Ban for 7 days" would need a scheduled unban job + a `banned_until` column; defer unless real demand.
- **Shadow ban.** We're transparent. No "banned but it looks fine to the user" flow.
- **Automatic ban from report thresholds.** Platform owner decides; no auto-ban from reports volume.
- **Banned-user content moderation.** Their past content stays as-is (public pages they authored still render). This brief is about preventing further authenticated action.
- **Appeal flow / notification to the banned user.** Email the user yourself from your own address; no in-app notification. Can add as a separate ship if we need the template.
- **Public-side detection.** A banned user visiting a public club site sees the same thing an anonymous visitor sees — no "you're banned" messaging on marketing pages.

---

## 9. Related product decisions (not in this brief's scope)

- **User-level moderation log / reports system.** The existing `AdminUsersView.vue` mock had a per-user moderation log + reports count. Those were static fixtures; building them for real is a bigger scope (new tables, UI flow for submitting + reviewing reports). Separate brief if we want it — and probably needs an actual incident to motivate the work.
- **Notify the real club owner when their member gets banned.** Trust signal — "we detected spam on your member list and removed them." Templated email through brief 40.

---

## 10. Contact

Nev on #torny-eng.
