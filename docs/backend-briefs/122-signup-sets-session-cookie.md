# Brief 122 — `/signup` sets the session cookie (Phase B.1 of 119)

**Status — proposed. Follow-up to brief 119 Phase A/B.**

> Mirror of brief 121 but for the public signup flow on torny-web (marketing site). Fixes the same post-Phase-B wart: new owners sign up, pay via Stripe Checkout, redirect back to the CRM, and immediately have to sign in again because the signup flow stashed a token the FE no longer reads.

---

## 1. Why

Brief 119 Phase A shipped the HttpOnly cookie on `/login`. Phase B (FE) migrated the CRM off `Authorization: Bearer`. The signup flow on `apps/torny-web/pages/signup/index.vue` uses `POST /signup` (brief 88) which returns an `auth_token` the FE stashes in `localStorage.torny.token`. Post-Phase-B this is dead code — the CRM FE no longer reads it.

Current post-Phase-B flow:
1. User signs up on `torny.pro/signup` — creates account + org + Stripe customer.
2. Backend returns `{ auth_token, stripe_checkout_url, ... }`.
3. FE stashes token in `localStorage.torny.token` (dead write).
4. FE redirects to Stripe Checkout; user pays.
5. Stripe redirects back to `app.torny.pro/settings/billing?result=updated`.
6. CRM loads, has no cookie, no Bearer → 401 → bounced to `/sign-in`.
7. User signs in with the creds they *just created*.

The signup page already warns "You'll be signed in automatically" (per brief 88 UX). That promise breaks with Phase B.

## 2. What to change on the backend

Same pattern as brief 121 and parent brief 119 §2:

```
Set-Cookie: torny_sid=<opaque>;
            Path=/;
            HttpOnly;
            Secure;
            SameSite=None;
            Max-Age=2592000
```

Include it on the `POST /signup` response.

- Create a row in `user_sessions` for the new user.
- Set the cookie on the response using the same helper `/login` uses.
- Keep returning `auth_token` in the body — it's documented in brief 88 and any client that depends on it stays unaffected.

**One extra gotcha for signup specifically:** signup lives on the **Venue** base (`tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com`), not SAM. The cookie attributes and the session-store row must match `/login`'s shape exactly so the two issue interchangeable sessions. Confirm the Venue stack's cookie helper is the same code path (or reuses the same lambda layer) as SAM.

## 3. FE ride-along

Zero code change needed in `apps/torny-web/pages/signup/index.vue` to get the benefit. The existing `localStorage.setItem('torny.token', result.auth_token)` write becomes harmless (the CRM never reads it after Phase B), but we should clean it up when touching that view for anything else.

Suggest wrapping the cleanup into the next torny-web signup change rather than a standalone PR — one-liner that'd be noise to review on its own.

## 4. Verification

- [ ] `POST /signup` with a valid payload → 200 with `Set-Cookie: torny_sid=…; HttpOnly; Secure; SameSite=None; Max-Age=2592000`
- [ ] Follow-up `GET /me` from the same browser works — returns the new user
- [ ] Stripe Checkout redirect to `app.torny.pro/settings/billing?result=updated` lands with the user authenticated (cookie survives the cross-origin round-trip because it's attached to the API domain, not the FE domain)
- [ ] Native signup flow unchanged — token in body still works

## 5. Related

- Brief 119 — the parent.
- Brief 121 — same treatment for `/accept-invite`.
- Brief 88 — the signup endpoint being extended here.
