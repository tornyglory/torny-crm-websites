# @torny/crm

Club owner CRM. Vue 3 + Vite SPA.

## Dev

```bash
pnpm --filter @torny/crm dev
# → http://localhost:5174
```

Copy `.env.example` to `.env` (or `.env.local` for personal overrides) to point at the API. The default in `.env.example` is the shared SAM prod endpoint.

## Structure

```
src/
├── layouts/       CrmShell (sidebar+topbar), AdminShell, AuthShell, OnboardingShell
├── router/        Vue Router config + auth/role guards
├── stores/        Pinia — auth, club (current club context), onboarding, ...
├── composables/   useApi (typed api client), useCurrentClub, useToast
├── views/         One folder per section (dashboard, members, events, ...)
└── styles/        Base CSS, imports tokens.css from @torny/design-tokens
```

## Auth

Live against the shared SAM API. See [docs/backend-briefs/03-frontend-auth-m1.md](../../docs/backend-briefs/03-frontend-auth-m1.md) for the endpoint contract.

**What's wired (M1):**
- `POST /login`, `POST /register`, `POST /request-password-reset`, `POST /reset-password` via `packages/api-client/src/resources/auth.ts`
- JWT stored in `localStorage` under `torny.token`; user under `torny.user`
- `useAuthStore` exposes `role`, `isPlatformAdmin`, `canManageClub`, `hasClubAccess`
- Sign-in routes by role: `platform` → `/admin`, `owner`/`admin`/`committee` → `/crm/dashboard`, `player` → `/claim`

**What's NOT wired yet (M2+):**
- No `/auth/refresh` — access token TTL is 30 days, no rotation. Do not build refresh logic yet.
- No `/auth/logout` — `clearSession()` just removes the localStorage keys.
- No `/me` — the login response is the only source of truth. Do not refetch.
- `clubs[]` on the user is always `[]` until M3. Design any per-club UI assuming that's the case.

**Route guards** (`src/router/guards.ts`):
- `requireAuth` — any signed-in user
- `requireOwner` — `role in [owner, admin]` (post-M3 will also check `clubs[]`)
- `requireOwnerAndOnboarded` — as above, plus onboarding complete
- `requirePlatformAdmin` — `isPlatformAdmin === true`, gates `/admin/*`

**Making authenticated API calls:**
- `useApi()` returns an axios instance pre-wired with `Authorization: Bearer <token>` (from the auth store) and `X-Torny-Club` (from the club store). Use it for anything under the shared SAM API — do not reach for `fetch` directly.
- Auth endpoints themselves (`login`, `register`, etc.) use `fetch` because they run before the token exists. Import from `@torny/api-client` as `auth.login(...)` etc.

**Errors:**
- `AuthError` (from `@torny/api-client`) carries `status` and `code`. `SignInView.vue` maps 401 to a generic "email or password is incorrect" message so the UI does not leak enumeration.
- For authorized routes: 401 → clear session + redirect to sign-in; 403 → route to `/forbidden` (do not clear session).

## Test accounts

Grab from [docs/backend-briefs/03-frontend-auth-m1.md](../../docs/backend-briefs/03-frontend-auth-m1.md):
- **Player:** `noah@qubestudio.co.nz` / `Abundance1!` — role `player`, will land on `/claim`.
- **Platform admin:** `nev@torny.co` — password out-of-band. Lands on `/admin`.
