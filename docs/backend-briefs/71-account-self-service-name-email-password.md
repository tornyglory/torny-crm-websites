# Account self-service — change name, email, password

**Feature:** let a signed-in user edit their own account — name, email, password — without the backend having to run SQL by hand. Right now:
- Name is captured at `/register` and never editable again.
- Email is captured at `/register` and never editable again (today's workaround: `UPDATE users SET email = …` in a console session).
- Password is only resettable via the forgotten-password flow (unauthenticated `/request-password-reset` + emailed token), which is awkward when the user is signed in and just wants to rotate it.

**Scope cut:** this brief is for a user editing **their own** account (what Settings → Account will land as). It is NOT:
- Admins editing other users (that's `members.patchMember()`, already shipped).
- Admins editing an owner's email on behalf of them — if they need to, they do a password reset for the user who then does it themselves.

**Related briefs:**
- brief 03 — original auth flow (login / register / `/me`).
- brief 08 — token + envelope shape (`{ status, message, data }`).
- brief 54 — `wrapClubEmail()` helper (the confirmation emails below pass through this so the branding matches).

**Status:** backend not started. FE will land right after this ships — a one-page "Account" view in Settings reads `/me` for the current values and PATCHes individual fields through the endpoints below.

---

## TL;DR

1. **`PATCH /me`** — single endpoint, accepts any subset of `{ name, avatar_url }`. Changes land immediately. No confirmation step, since neither of these can lock the user out.
2. **`POST /me/email-change`** — kicks off a **double-opt-in** email change. Writes a `pending_email` + sends a signed-token link to the *new* address (not the old one). The user clicks the link to confirm; only then does the real email flip.
3. **`POST /me/email-change/confirm`** — confirms the pending change via the token in the email link. Public (no auth) so the user can confirm from any device/browser.
4. **`POST /me/password-change`** — authenticated password rotation. Requires `current_password` for safety; new password lands immediately. Does NOT invalidate the current session (the user who just changed their password shouldn't get bounced to sign-in).
5. **Enriched `/me` response** — add `pending_email` and `pending_email_expires_at` to the shape so the CRM can show *"Pending — check jane@newplace.co.nz"* with a resend / cancel button.

---

## Base URL — SAM API

```
https://ieg3lhlyy0.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Auth: `Authorization: Bearer <JWT>` on everything **except** `POST /me/email-change/confirm` (public — the user confirms by clicking an email link, no session guaranteed).

---

## 1. `PATCH /me` — change name + avatar

### Request

```http
PATCH /me
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "name":       "Nigel Upper",            // optional; omit to leave untouched
  "avatar_url": "https://media…/abc.jpg"  // optional; nullable (pass null to clear)
}
```

### Behaviour
- Each field is optional. Sending `{}` is a no-op 200.
- `name` is a single display string (the CRM splits into first/last at the FE). Trimmed, 1–120 chars.
- `avatar_url` must be a URL from one of the Torny media hosts (same whitelist as club brand uploads). Pass `null` to clear.
- Changes land immediately. No confirmation email.

### 200 response

```jsonc
{
  "status": "success",
  "data": {
    "user": { /* full AuthUser shape — same as GET /me */ }
  }
}
```

### Errors

| HTTP | code              | meaning                                   |
|------|-------------------|-------------------------------------------|
| 400  | `invalid_name`    | empty after trim, or over 120 chars       |
| 400  | `invalid_avatar`  | URL not on the Torny media whitelist      |
| 401  | `unauthorized`    | missing / expired token                   |

---

## 2. `POST /me/email-change` — kick off a change

Writes `users.pending_email` + sends a confirmation link to the **new** address. The actual `email` column doesn't change until §3 confirms.

### Request

```http
POST /me/email-change
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "new_email": "nigel@qubestudio.co.nz"
}
```

### Behaviour
1. Normalise `new_email` (lowercase, trim).
2. If `new_email` is already an active `users.email` on another row → return 409 `email_in_use`. Don't leak whether the existing account is active or just a stub.
3. If `new_email === current email` → return 400 `same_as_current`.
4. If the user already has a `pending_email` with an unexpired token → overwrite it (so a mistyped first attempt doesn't block a correction).
5. Generate a signed token (JWT, 7-day expiry):
   ```json
   { "user_id": 42, "pending_email": "nigel@qubestudio.co.nz", "token_version": 1 }
   ```
   `token_version` increments each time a new change is kicked off, so an older confirmation link stops working the moment a new one is issued.
6. Store on the user row:
   ```sql
   UPDATE users SET
     pending_email            = $1,
     pending_email_token      = $2,  -- opaque, hashed
     pending_email_expires_at = NOW() + INTERVAL '7 days',
     pending_email_requested_at = NOW()
   WHERE id = $user_id;
   ```
7. Send a transactional email to **the new address** with a confirmation link:
   ```
   https://app.torny.co/confirm-email/{token}
   ```
   Use `wrapClubEmail()` with the platform brand (not a club brand — this is a Torny-level change). Subject: `"Confirm your new email for Torny"`. Body includes the plain-text link in case the HTML is stripped.
8. Also send a **notification-only** email to the **current** address: *"Someone asked to change your Torny email to n***@q***.co.nz. If this wasn't you, [sign in and cancel it](https://app.torny.co/account)."* Keeps the current account holder in the loop in case someone with session access tries to hijack.
9. Rate limit: 5 requests per user per hour. Over the limit → 429 `rate_limited`.

### 202 response

```jsonc
{
  "status": "success",
  "data": {
    "pending_email":      "nigel@qubestudio.co.nz",
    "expires_at":         "2026-11-08T04:12:00.000Z",
    "notice_sent_to_old": true
  }
}
```

### Errors

| HTTP | code             | meaning                                                     |
|------|------------------|-------------------------------------------------------------|
| 400  | `invalid_email`  | not a parseable email address                               |
| 400  | `same_as_current`| the new email matches the current one                       |
| 409  | `email_in_use`   | another active user already has that address                |
| 429  | `rate_limited`   | too many change requests in the last hour                   |
| 401  | `unauthorized`   | missing / expired JWT                                       |

---

## 3. `POST /me/email-change/confirm` — public confirm

The confirmation link in §2 step 7 lands here. **Public** — no `Authorization` header required, so the user can confirm from a different browser / device than they signed in on.

### Request

```http
POST /me/email-change/confirm
Content-Type: application/json

{
  "token": "eyJhbGciOi…"
}
```

### Behaviour
1. Verify the token signature + expiry. If invalid → 400 `token_invalid`. If expired → 410 `token_expired`.
2. Look up `users.pending_email_token` and compare to the hashed token payload. If mismatch (user issued a newer link after this one) → 410 `token_superseded`.
3. Re-check `email_in_use` on `pending_email` in case someone else registered with it during the pending window. If so → 409 `email_in_use` and clear the pending state.
4. Flip the email in a transaction:
   ```sql
   UPDATE users SET
     email                       = pending_email,
     email_verified_at           = NOW(),
     pending_email               = NULL,
     pending_email_token         = NULL,
     pending_email_expires_at    = NULL,
     pending_email_requested_at  = NULL
   WHERE id = $user_id;
   ```
5. Invalidate every active session for this user **except** the one that issued the change (if we can identify it from the token's `session_id` claim; otherwise invalidate all). Forces anyone riding a stale JWT to re-login with the new email.
6. Send a confirmation email to the **new** address: *"Email change complete."*
7. Also notify the **old** address: *"Your Torny email was changed. If this wasn't you, [reset your password now](https://app.torny.co/forgot-password)."* The old address can still trigger password reset for 30 days post-change as a safety net; after that, the row is only reachable via the new address.

### 200 response

```jsonc
{
  "status": "success",
  "data": {
    "email":        "nigel@qubestudio.co.nz",
    "confirmed_at": "2026-11-02T04:14:22.000Z"
  }
}
```

### Errors

| HTTP | code                 | meaning                                             |
|------|----------------------|-----------------------------------------------------|
| 400  | `token_invalid`      | signature mismatch or malformed payload             |
| 410  | `token_expired`      | past the 7-day expiry                               |
| 410  | `token_superseded`   | a newer change was requested; this link is dead     |
| 409  | `email_in_use`       | someone else grabbed this address during the window |
| 404  | `user_not_found`     | token's user_id no longer exists                    |

---

## 4. `POST /me/email-change/cancel` — abort a pending change

The user realised they typo'd, or they got the "someone asked to change your email" notification and want to kill it.

### Request

```http
POST /me/email-change/cancel
Authorization: Bearer <JWT>
```

No body.

### Behaviour
1. Clear `pending_email` + token + expiry (idempotent — a cancel with no pending change is a no-op 200).
2. Send a short confirmation email to the pending address: *"Your email change was cancelled."* so whoever's inbox got the original link knows it's dead.

### 200 response

```jsonc
{
  "status": "success",
  "data": { "cancelled": true }
}
```

---

## 5. `POST /me/password-change` — rotate while signed in

Separate from `/reset-password` (which is the public forgot-password flow using an email token). This one is for an **authenticated** user who just wants to pick a new password.

### Request

```http
POST /me/password-change
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "current_password": "…",
  "new_password":     "…"
}
```

### Behaviour
1. Verify `current_password` against the stored hash. If mismatch → 400 `current_password_wrong`. (Not 401 — the JWT is fine; the password check failed.)
2. Validate `new_password` against the standard rules (min 10 chars, at least one letter + one number — same rules as `/register`). On fail → 400 `weak_password`.
3. Reject if `new_password === current_password` → 400 `same_as_current`.
4. Hash + store the new password.
5. **Keep** the current session alive — the caller who just rotated shouldn't get kicked. But **invalidate every other active session** for this user, since a password rotation is the universal signal of "something's up, log the others out."
6. Send a notification email to the user's current address: *"Your Torny password was changed. If this wasn't you, [reset it now](https://app.torny.co/forgot-password)."*

### 200 response

```jsonc
{
  "status": "success",
  "data": {
    "changed_at":         "2026-11-02T04:14:22.000Z",
    "other_sessions_revoked": 2
  }
}
```

### Errors

| HTTP | code                      | meaning                                       |
|------|---------------------------|-----------------------------------------------|
| 400  | `current_password_wrong`  | current_password didn't match                 |
| 400  | `weak_password`           | new_password fails the complexity rules       |
| 400  | `same_as_current`         | the new password is identical to the current  |
| 401  | `unauthorized`            | missing / expired JWT                         |
| 429  | `rate_limited`            | 5 failed attempts in 10 minutes → cooldown    |

---

## 6. Extended `/me` response

So the FE can show *"Pending — check jane@newplace.co.nz · [Resend] [Cancel]"* on the Account page, add the pending-email fields to the existing `/me` response (and the login response, which uses the same shape):

```jsonc
{
  "status": "success",
  "data": {
    "user": {
      "id":                 42,
      "email":              "nigel@torny.co",
      "name":               "Nigel Upper",
      "avatar_url":         "https://media…/abc.jpg",
      "role":               "owner",
      "clubs":              [ /* unchanged */ ],
      "is_platform_admin":  false,
      "profile_completed":  1,
      "created":            "2026-01-15T…",
      "updated":            "2026-10-30T…",

      // ── NEW ───────────────────────────────────────────────
      "pending_email":            "nigel@qubestudio.co.nz",     // null when no change pending
      "pending_email_expires_at": "2026-11-08T04:12:00.000Z",   // null when no change pending
      "email_verified_at":        "2026-01-15T22:00:00.000Z"    // null for legacy rows pre-this-brief
    }
  }
}
```

The FE's existing `AuthUser` type keeps all current fields; the three additions are nullable so the type stays backward-compatible.

---

## 7. Schema notes

```sql
ALTER TABLE users
  ADD COLUMN pending_email              VARCHAR(255) NULL,
  ADD COLUMN pending_email_token        VARCHAR(255) NULL,       -- hashed
  ADD COLUMN pending_email_expires_at   TIMESTAMP    NULL,
  ADD COLUMN pending_email_requested_at TIMESTAMP    NULL,
  ADD COLUMN email_verified_at          TIMESTAMP    NULL;

CREATE INDEX idx_users_pending_email
  ON users (LOWER(pending_email))
  WHERE pending_email IS NOT NULL;
```

Historical rows get `email_verified_at = NULL` — treat as "verified at some ancient point we didn't track." The FE won't surface this field in v1; it's there for a future "unverified email" warning.

---

## 8. Frontend contract summary

New functions on `packages/api-client/src/resources/auth.ts`:

```ts
export interface UpdateMeInput {
  name?: string
  avatar_url?: string | null
}
export async function patchMe(input: UpdateMeInput, opts): Promise<AuthUser>

export async function requestEmailChange(newEmail: string, opts): Promise<{
  pending_email: string
  expires_at: string
  notice_sent_to_old: boolean
}>

/** Public — no auth. */
export async function confirmEmailChange(token: string, opts): Promise<{
  email: string
  confirmed_at: string
}>

export async function cancelEmailChange(opts): Promise<void>

export async function changePassword(input: {
  current_password: string
  new_password: string
}, opts): Promise<{
  changed_at: string
  other_sessions_revoked: number
}>
```

Extend `AuthUser` with `pending_email: string | null`, `pending_email_expires_at: string | null`, `email_verified_at: string | null`.

**New FE surface** (one-pager):
- New route `/crm/account` → `AccountView.vue`:
  - Name field with inline save.
  - Avatar picker (reuse the existing `ImagePicker`).
  - Email field with a two-state UI:
    - Idle: shows current email + "Change" button → modal with new-email input → `requestEmailChange()`.
    - Pending: shows "Pending — check jane@newplace.co.nz · [Resend] [Cancel]" with the resend hitting `requestEmailChange()` again and cancel hitting `cancelEmailChange()`.
  - Password section with "Change password" button → modal with current + new fields → `changePassword()`.
- New route `/confirm-email/:token` → `ConfirmEmailView.vue` (public, no auth guard): calls `confirmEmailChange()`, shows success / expired / superseded / in-use error states.
- The user menu's "My profile" link currently routes to `/crm/settings` — repoint it at `/crm/account`.

---

## 9. Verification

Using Nigel's JWT:

```bash
# 1. Patch name
curl -X PATCH -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  "$SAM/me" -d '{"name":"Nigel Upper"}'
# → 200, user.name updated.

# 2. Email change kickoff
curl -X POST -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  "$SAM/me/email-change" -d '{"new_email":"nigel@qubestudio.co.nz"}'
# → 202, pending_email + expires_at in response.
#   Check both inboxes: new address gets confirmation link; old address gets notice.

# 3. /me now shows pending
curl -H "Authorization: Bearer $JWT" "$SAM/me"
# → 200, data.user.pending_email set, pending_email_expires_at ~7d out.

# 4. Confirm with the token from the new-address email
curl -X POST -H "Content-Type: application/json" \
  "$SAM/me/email-change/confirm" -d '{"token":"<token>"}'
# → 200, email flipped, pending_email cleared.
#   Login with the new address + current password works.
#   Login with the old address returns 401 invalid_credentials.

# 5. Email in use
curl -X POST -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  "$SAM/me/email-change" -d '{"new_email":"someone-else@torny.co"}'
# → 409 { code: "email_in_use" }.

# 6. Expired token
# (manually age the pending_email_expires_at past NOW())
curl -X POST -H "Content-Type: application/json" \
  "$SAM/me/email-change/confirm" -d '{"token":"<old-token>"}'
# → 410 { code: "token_expired" }.

# 7. Superseded
# Request a second change while one is pending; the first token should die.
curl -X POST -H "Content-Type: application/json" \
  "$SAM/me/email-change/confirm" -d '{"token":"<first-token>"}'
# → 410 { code: "token_superseded" }.

# 8. Cancel
curl -X POST -H "Authorization: Bearer $JWT" "$SAM/me/email-change/cancel"
# → 200, cancelled: true.

# 9. Password change
curl -X POST -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  "$SAM/me/password-change" -d '{"current_password":"old","new_password":"new-strong-123"}'
# → 200, other_sessions_revoked counted.
#   Current session JWT still valid; other sessions get 401 on next request.

# 10. Wrong current password
curl -X POST -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  "$SAM/me/password-change" -d '{"current_password":"nope","new_password":"new-strong-123"}'
# → 400 { code: "current_password_wrong" }.
```

Pass criteria:
- ✓ `PATCH /me` persists name + avatar_url and returns the updated user.
- ✓ Email change kickoff writes `pending_email`, sends 2 emails (new + old), expires in 7 days.
- ✓ Confirm swaps email, verifies on new, 401s old sign-in attempts.
- ✓ Both tokens (`invalid`, `expired`, `superseded`) distinguish cleanly.
- ✓ Password change requires correct current, invalidates other sessions, keeps the caller's session.
- ✓ `/me` carries `pending_email` + `pending_email_expires_at` + `email_verified_at`.

---

## 10. Non-goals (v1)

- **No MFA / recovery codes rotation.** 2FA is still an onboarding-only flag today; a separate brief covers the full MFA lifecycle.
- **No account deletion.** Owner cancels club via Settings → Danger zone; a user wanting to nuke their account entirely is deferred.
- **No email change for `platform` role.** The one platform user is the backend team — if they need to rotate, they do it in the console. The endpoint returns 403 `platform_change_forbidden` for them.
- **No admin override.** Admins can't change another user's email; the user has to do it themselves via the email flow. If they can't access the current address, they do forgot-password → login with the reset → change email.
- **No notification preferences on these confirmation emails.** They're transactional / security-critical; they bypass the user's notification settings (brief 54).

---

## 11. Contact

Ping Felicity when §1 + §5 (password change) ship — those are the two we can light up on the Account page without needing confirmation flows. §2 + §3 (email change) can land in a follow-up PR; the FE will show *"Email changes — coming soon"* until they land, then flip to the full modal.
