# 10 · Brief 119 Phase B — CRM migrated to HttpOnly session cookies

**Status:** FE code complete on branch `brief-119-phase-b-httponly-cookies`. **Not merged** — blocked on backend CORS allow-list.
**Date:** 2026-11-25
**Related:** [`audit-2026-11-11.md`](./audit-2026-11-11.md) → Security §1, [`docs/backend-briefs/119-httponly-session-cookies.md`](../backend-briefs/119-httponly-session-cookies.md)

## What this closes

The original audit flagged the browser-stored Bearer token as the last structural security gap: an XSS bug could `fetch('/')` the token out of `localStorage` and the attacker gets a 30-day valid session. Every other defence we shipped (sanitisers, CSP, rate limit) reduces XSS *probability*; this one reduces the XSS *consequence* from "account takeover from anywhere" to "whatever the attacker can do on the page right now."

## What's on the branch

- `packages/api-client/src/http.ts` — `authedFetch` now sends `credentials: 'include'` and no longer reads a token from `localStorage`. Explicit `token` override is still honoured for the two legacy flows (accept-invite, signup) pending Phase B.1.
- `packages/api-client/src/resources/auth.ts` — `login` / `register` / `requestPasswordReset` / `resetPassword` all send `credentials: 'include'`. New `auth.logout()` helper that POSTs `/logout`.
- `packages/api-client/src/__tests__/http.test.ts` — 16 tests covering the new cookie behaviour, Bearer override path, envelope + ApiError handling. All pass.
- `apps/crm/src/stores/auth.ts` — `setSession(user)` (no token param), `clearSession()` local-only, `logout()` calls `authApi.logout()` + Sentry on failure. `rotateToken()` removed (backend rotates the cookie via Set-Cookie on `/me/password-change`).
- `apps/crm/src/views/auth/SignInView.vue` + `RegisterView.vue` — drop token destructure from `authApi.login()` response.
- `apps/crm/src/views/auth/AcceptInviteView.vue` — drops the dead `localStorage.setItem('torny.token', ...)` write and the 2-arg `setSession` call. Behaviour trade-off documented in-source: until brief 121 ships, a user accepting an invite gets bounced to sign-in once.
- `apps/crm/src/views/account/AccountView.vue` — drops the `rotateToken(res.token)` call after `/me/password-change`; backend sets the new cookie via `Set-Cookie`.
- 4 CRM unit tests + 12 E2E specs updated — no longer assert `Authorization: Bearer test-token`; now assert `credentials: 'include'` + stripped dead `torny.token` seeding.

## Trade-offs shipped with Phase B

Two auth paths still issue tokens and don't set a cookie yet. Pending Phase B.1:

- **Accept invite** (`/accept-invite`) — brief 121 filed.
- **Public signup on torny-web** (`/signup`) — brief 122 filed.

Users hitting either path in the window between Phase B shipping and Phase B.1 landing get bounced to sign-in once, right after creating their account. Mild UX wart; documented in both the AcceptInviteView source comment and the briefs.

## Blocker: CORS

Per brief 119 §4: shipping Phase B requires backend to tweak CORS on the auth endpoints:

- `Access-Control-Allow-Origin: *` → `Access-Control-Allow-Origin: https://app.torny.pro` (specific — `*` is incompatible with credentials)
- Add `Access-Control-Allow-Credentials: true`
- For dev: also allow `http://localhost:5174`

The brief explicitly asks us to ping when hitting this. The branch is ready; the merge is waiting on the one-line backend CORS change.

## Verification done locally

- `pnpm --filter @torny/api-client test` — 16 / 16 green (new cookie tests included)
- `pnpm --filter @torny/crm typecheck` — green
- `pnpm --filter @torny/crm lint` — green
- `pnpm --filter @torny/crm test` — 74 / 74 green (4 Bearer-asserting tests updated to credentials)
- `pnpm --filter @torny/crm build` — green

E2E not re-run yet — they'll stay green locally (route mocks don't care about auth shape) but will need the real backend + CORS fix to prove the full path.

## Merge checklist

- [ ] Backend ships the CORS allow-list tweak on the auth endpoints
- [ ] Verify sign-in on staging / dev CRM: DevTools → Application → Cookies shows `torny_sid` as HttpOnly after sign-in
- [ ] Verify sign-out: `POST /logout` returns 204, cookie disappears, next `/me` 401s cleanly
- [ ] Merge this branch
- [ ] Schedule briefs 121 + 122 for the accept-invite + signup cookie-setting
- [ ] Update the audit scoring: Security 8.5 → 9

## Why I'm not merging today

Merging now would ship a CRM that 401s every request until the CORS fix lands — a brief but real outage. The branch is the right artefact: everything's reviewable, commits are clean, the only thing missing is the backend coordination round-trip.
