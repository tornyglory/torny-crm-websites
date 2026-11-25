# Brief 121 — `/accept-invite` sets the session cookie (Phase B.1 of 119)

**Status — proposed. Follow-up to brief 119 Phase A/B.**

> Short tweak: have the accept-invite endpoint set the same `torny_sid` session cookie that `/login` sets, so a user accepting an email invite lands in the CRM authenticated instead of getting bounced to sign-in.

---

## 1. Why

Brief 119 Phase A shipped the HttpOnly cookie on `/login`. Phase B (FE) migrated the CRM off `Authorization: Bearer` to cookie-only, which means any endpoint that previously returned an `auth_token` for the FE to stash in `localStorage` no longer gives the user a working session on the CRM — the FE can't read the token into the cookie.

`/accept-invite` is one of those endpoints. Current flow:

1. User clicks an email invite link, lands on `/accept-invite/<token>`.
2. FE calls `POST /accept-invite` with their new password + name.
3. Backend creates / resolves the user, returns `{ auth_token, user, club }`.
4. FE used to stash `auth_token` in `localStorage.torny.token`. Post-Phase-B this is dead code.
5. FE navigates to `/claim` or `/crm/dashboard`.
6. Next authed API call → no cookie, no Bearer → 401 → router bounces to `/sign-in`.
7. User signs in with the password they *just set in step 2*.

Mild UX wart. Easy fix.

## 2. What to change on the backend

Same cookie, same attributes as `/login` (see brief 119 §2):

```
Set-Cookie: torny_sid=<opaque>;
            Path=/;
            HttpOnly;
            Secure;
            SameSite=None;
            Max-Age=2592000
```

Include it on the `POST /accept-invite` response. Server-side, this means:
- Create a row in `user_sessions` for the new/resolved user.
- Set the cookie on the response via the same helper `/login` uses.
- Keep returning `auth_token` in the body — native app and tests still rely on it.

Response body stays the same (don't want to break native). Only new thing is the `Set-Cookie` header.

## 3. FE ride-along

The CRM FE already treats `/accept-invite` as "landed authenticated." Once the cookie lands:

- `AcceptInviteView.vue` already calls `auth.setSession(fromApiUser(user))` after the accept. With the cookie in place, the next GET /me / /claims / etc. carries the cookie and authenticates.
- The `localStorage.setItem('torny.token', ...)` that used to live here was removed in Phase B. No further FE change required to get the fix benefit.

In short: ship the cookie, no FE PR needed.

## 4. Verification

- [ ] `POST /accept-invite` with a valid pending invite → 200 with `Set-Cookie: torny_sid=…; HttpOnly; Secure; SameSite=None; Max-Age=2592000`
- [ ] Follow-up `GET /me` from the same browser works — returns the invited user
- [ ] Follow-up `GET /me` from a different browser (no cookie) → 401 (confirms the cookie, not the token, is what's authing)
- [ ] `auth_token` still present in the response body (native app unaffected)
- [ ] Native accept-invite flow still works — stashes the token, hits protected endpoints, authorizer falls through to Bearer, 200

## 5. Related

- Brief 119 — the parent. HttpOnly cookies on `/login`.
- Brief 122 — same treatment for `/signup` on torny-web.
- Brief 71 §5 — password change already rotates the cookie via `Set-Cookie`; no FE PR needed there either.
