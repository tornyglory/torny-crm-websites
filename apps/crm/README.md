# @torny/crm

Club owner CRM. Vue 3 + Vite SPA.

## Dev

```bash
pnpm --filter @torny/crm dev
# → http://localhost:5174
```

Copy `.env.example` to `.env` (or `.env.local` for personal overrides). Both URLs default to prod so a fresh clone just works.

## Structure

```
src/
├── layouts/       CrmShell (sidebar+topbar), AdminShell, AuthShell, OnboardingShell
├── router/        Vue Router config + auth/role guards
├── stores/        Pinia — auth, claims, club (current club context), onboarding, ...
├── composables/   useApi (typed api client), useToast
├── views/         One folder per section (dashboard, members, events, ...)
└── styles/        Base CSS, imports tokens.css from @torny/design-tokens
```

## API integration status

Every backend contract lives in [`docs/backend-briefs/`](../../docs/backend-briefs). The CRM points at two base URLs — see §Environment below.

### ✅ Wired end-to-end

Real endpoints, live in prod, exercised through the UI:

| Feature | Endpoint | Frontend seam |
| --- | --- | --- |
| Sign-in | `POST /login` (SAM) | `views/auth/SignInView.vue` → `authApi.login()` |
| Register | `POST /register` (SAM) | `views/auth/RegisterView.vue` → auto-login after |
| Password reset request | `POST /request-password-reset` (SAM) | `views/auth/ForgotPasswordView.vue` |
| Password reset commit | `POST /reset-password` (SAM) | `views/auth/ResetPasswordView.vue` |
| Session refresh | `GET /me` (CRM) | `useAuthStore().refresh()` — called on claim-approval detection |
| Submit a claim | `POST /claims` (CRM) | `views/auth/ClaimClubView.vue` step 2 |
| My claims | `GET /claims/mine` (CRM) | ClaimClubView on mount — detects pending → step 3, approved → refresh + redirect |
| Platform admin queue | `GET /admin/claims` (CRM) | `views/admin/AdminClaimsView.vue` + `stores/claims.ts` |
| Approve claim | `POST /admin/claims/:id/approve` (CRM) | Atomic — refetches all three tabs after (auto-reject siblings) |
| Reject claim | `POST /admin/claims/:id/reject` (CRM) | Refetches pending + rejected |
| Bulk member import — preview | `POST /clubs/:id/members/import/preview` (CRM) | `views/members/MembersImportView.vue` |
| Bulk member import — commit | `POST /clubs/:id/members/import/commit` (CRM) | Idempotent by `importId` |

Auth model: JWT in `localStorage` under `torny.token`. `useAuthStore()` exposes `role`, `isPlatformAdmin`, `canManageClub`, `hasClubAccess`, `refresh()`.

Every API call from the auth-gated views goes through `authedFetch` (in `@torny/api-client/http`) which attaches the token and unwraps `{ status, data }` envelopes. Non-2xx / `status: "error"` responses throw `ApiError` with a machine-readable `code` for switching UI copy.

### 🚧 Mocked — awaiting backend

Fully-built UI, mocked data. Each has a clean seam ready to swap when the endpoint lands.

| Area | View / store | Waiting on |
| --- | --- | --- |
| Members list | `views/members/MembersView.vue` (seeded `ref([])`) | `GET /clubs/:id/members` |
| Member detail | `views/members/MembersView.vue` modal | Same as above |
| Team access (Settings) | `views/settings/SettingsView.vue` | Brief 02 endpoints (M5) — invite/manage CRM roles |
| Applications | `views/applications/ApplicationsView.vue` | New endpoint — brief not written yet |
| Events | `views/events/EventsView.vue` | New endpoint — brief not written yet |
| Teams / team selection | `views/teams/*` | New endpoint — brief not written yet |
| Communications | `views/communications/CommunicationsView.vue` | New endpoint — brief not written yet |
| Enquiries | `views/enquiries/EnquiriesView.vue` | New endpoint — brief not written yet |
| Honour board | `views/honour-board/HonourBoardView.vue` | New endpoint — brief not written yet |
| Achievements | `views/achievements/AchievementsView.vue` | New endpoint — brief not written yet |
| Website editor | `views/website/WebsiteEditorView.vue` | New endpoint — brief not written yet |
| Onboarding wizard | `views/onboarding/*` + `stores/onboarding.ts` | Per-step or single-save endpoint — spec first |
| Platform admin dashboard stats | `stores/platformStats.ts` | Aggregation endpoint — brief not written yet |
| Platform admin users list | `stores/platformUsers.ts` | Backend user-management endpoints |
| Invite acceptance | `/invites/:token/accept` link in emails | Backend "Milestone B" — invites fire from bulk import but the accept URL 404s until this lands |

### 🟡 Deferred by backend

Non-blocking. Design the UI as if these don't exist; wire when M2+ ships.

- `POST /auth/refresh` + refresh-token rotation — access token TTL is 30 days
- `POST /auth/logout` — `clearSession()` removes localStorage keys, no server call
- `POST /auth/verify-email` — email verification gate on new registrations
- `claim.approved` / `claim.rejected` transactional emails (M5)
- Team-access endpoints (invites, members list, ownership transfer) — brief 02, M5
- Cross-club JWT staleness on ban / removal

## Environment

Two base URLs live in [`packages/api-client/src/config.ts`](../../packages/api-client/src/config.ts):

```
VITE_SAM_BASE_URL   # auth + mobile-shared endpoints (login, register, password reset)
VITE_CRM_BASE_URL   # /me, claims, admin queue, bulk import, and future CRM-only routes
```

Same JWT works on both. See brief 08 §Base URLs for why there's two.

## Route guards

`src/router/guards.ts`:

- `requireAuth` — any signed-in user; unauthed → `/sign-in?redirect=…`
- `requireAuthOrRegister` — same but bounces unauthed to `/register` (used on `/claim`)
- `requireOwner` — auth + `role in [owner, admin]`
- `requireOwnerAndOnboarded` — auth + onboarding complete; platform admins bypass to `/admin`
- `requirePlatformAdmin` — `isPlatformAdmin === true`, gates `/admin/*`

## Making authenticated API calls

Two patterns:

1. **For anything under CRM_BASE (new endpoints):** import the resource from `@torny/api-client` — `claims`, `memberImports`, or add a new module in `packages/api-client/src/resources/`. All go through `authedFetch` which reads the token from localStorage and throws `ApiError` with a `code`.

2. **For the legacy shared axios client** (existing member/event/team/etc. resources): `useApi()` returns an axios instance pre-wired with `Authorization` header and `X-Torny-Club` header. Points at CRM_BASE by default.

Auth endpoints themselves use plain `fetch` because they run before the token exists.

## Error conventions

- `ApiError` from `@torny/api-client` — status + `code` + parsed body.
- **401** → clear session, redirect to sign-in.
- **403** → redirect to `/forbidden`. Do not clear session.
- **409** with `code` → surface a targeted message per the code table in the relevant brief (see brief 05 §3.4 for the shared error shape).
- **429** → disable the action, respect `retryAfterSeconds`.
- **410** → prompt to re-do the flow (used by bulk-import when the preview expires).

## Test accounts

From brief 08 §Test accounts:

- **Platform admin:** `nev@torny.co` / `Abundance1!` — `role: 'platform'`, lands on `/admin`.
- **Player (no clubs):** `crm-seed-1@example.com` … `crm-seed-8@example.com` / `Seed1!` — each has a seeded pending or decided claim. Sign in as one to see the claimant-side view.
- **Owner:** `noah@qubestudio.co.nz` / `Abundance1!` — approved owner of Fitzroy Victoria (club 4). Use this account for bulk-import testing.

## Related docs

- [`docs/backend-briefs/`](../../docs/backend-briefs) — every backend contract, in order:
  - 01 — original auth + claim spec
  - 02 — team access (M5)
  - 03 — frontend auth M1 (backend → us)
  - 04 — claim flow M4 punchlist
  - 05 — frontend blockers
  - 06 — admin claim queue
  - 07 — bulk member import (spec)
  - 08 — M1 + M3 + M4 live (backend → us)
  - 09 — bulk import live (backend → us)
