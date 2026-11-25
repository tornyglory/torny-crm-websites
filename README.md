# Torny

**A vertical-flexible CMS platform for membership-based businesses.** Clubs today — bowling, sports, community venues. Holiday stays, real estate agencies, hospitality venues on the roadmap. Same underlying renderer, different vertical-flavoured starting points.

Monorepo for the public club websites, the admin CRM, the marketing site, and the shared component + API packages that bind them together.

---

## Table of contents

- [How the system works](#how-the-system-works)
- [Monorepo layout](#monorepo-layout)
- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [The block system](#the-block-system)
- [Tenant resolution + routing](#tenant-resolution--routing)
- [Backend-first briefs workflow](#backend-first-briefs-workflow)
- [Testing + quality](#testing--quality)
- [Security + production readiness](#security--production-readiness)
- [Deployment](#deployment)
- [Documentation map](#documentation-map)
- [Contributing](#contributing)

---

## How the system works

```
        ┌──────────────────────────┐
        │   Tenant browser         │
        │   club.torny.pro         │
        │   custom-domain.co.nz    │
        └────────────┬─────────────┘
                     │
                     ▼
        ┌──────────────────────────┐     reads x-torny-tenant-host
        │   Cloudflare tenant      │─────────────────────────────▶
        │   router (Workers)       │
        └────────────┬─────────────┘
                     │
                     ▼
        ┌──────────────────────────────────────────────────────┐
        │   apps/club-sites — Nuxt 3 on Cloudflare Pages       │
        │                                                      │
        │   layouts/default.vue                                │
        │     ├─ SiteHeader   ← @torny/content-blocks          │
        │     ├─ <slot>       ← per-page block layout          │
        │     │     ├─ PageRenderer                            │
        │     │     └─ BlockRenderer × N (hero, events, …)     │
        │     └─ SiteFooter                                    │
        │                                                      │
        │   useTheme() injects per-tenant tokens + fonts       │
        └────────────┬─────────────────────────────────────────┘
                     │
                     │ GET /site + /clubs/resolve + …
                     ▼
        ┌──────────────────────────────────────────────────────┐
        │   Backend API (SAM + Venue AWS stacks)               │
        │                                                      │
        │   /clubs/resolve           tenant lookup by host     │
        │   /public/clubs/:sub/site  resolved site payload     │
        │   /public/clubs/:sub/events, honour-board, …         │
        │                                                      │
        │   admin endpoints:                                   │
        │   /clubs/:cid/pages/:slug         page editor        │
        │   /clubs/:cid/block-pdfs          PDF uploads        │
        │   /clubs/:cid/footer-config       footer editor      │
        │   /clubs/:cid/settings            everything else    │
        └──────────────────────────────────────────────────────┘
                     ▲
                     │  signed-in CRM admin JWT
                     │
        ┌──────────────────────────────────────────────────────┐
        │   apps/crm — Vue 3 + Vite SPA on Cloudflare Pages    │
        │                                                      │
        │   Settings → Website → Pages                         │
        │     WebsiteEditorView                                │
        │       ├─ BlockPaletteDialog                          │
        │       ├─ Inspector  (fields per block)               │
        │       └─ Live preview (shipping next — see 06)       │
        │                                                      │
        │   Members · Events · Comms · Bookings · Billing · … │
        └──────────────────────────────────────────────────────┘
```

**The core idea:** admins never write HTML. They edit **fields** on **blocks**. The same `@torny/content-blocks` package drives both the CRM editor's inspector forms and the public sites' renderer. One schema, two surfaces, no drift.

---

## Monorepo layout

```
torny/
├── apps/
│   ├── crm/            Vue 3 + Vite SPA. Club-admin CRM.
│   ├── club-sites/     Nuxt 3. Public tenant sites on Cloudflare Pages.
│   └── torny-web/      Nuxt 3. Marketing site (torny.pro) + /privacy /terms.
├── packages/
│   ├── api-client/     Typed resource layer wrapping every backend endpoint.
│   ├── content-blocks/ Vue block components. Shared by CRM editor + public site renderer.
│   └── design-tokens/  CSS custom properties — colour, type, spacing, radius.
└── docs/
    ├── backend-briefs/      Numbered backend briefs, one per contract change.
    ├── design-briefs/       Paper design file references for each surface.
    ├── production-readiness/ Audit + numbered remediation tracks.
    ├── runbook/             Rollback + ops runbooks.
    └── changelog/           Daily rollup of landed changes.
```

Capacitor player apps live in the separate `torny-apps` repo; the native-native apps live in `torny_swift` + `torny_kotlin`.

---

## Prerequisites

- Node.js `>=22` (bumped from 20 in CI on 2026-11-25)
- pnpm `9.15.0` — `npm i -g pnpm@9.15.0`

---

## Getting started

```bash
pnpm install              # install everything — single root lockfile, all workspaces
pnpm dev                  # run every app in parallel via turbo
pnpm dev:crm              # just the CRM (port 5174)
pnpm dev:sites            # just the public club sites (port 3001)
pnpm --filter @torny/torny-web dev   # just the marketing site

pnpm build                # build every app + package
pnpm typecheck            # type-check across every workspace
pnpm test                 # vitest suites in every package that has them
pnpm --filter @torny/crm test:e2e    # Playwright smoke suite (includes axe-core WCAG baseline)
pnpm format               # prettier
pnpm lint                 # turbo lint
```

Local tenant routing for dev:

```
# After pnpm dev:sites, the Nuxt tenant middleware reads ?host=… to pick a club:
http://localhost:3001/?host=naenae-bowling-club.torny.pro
```

The chosen host is sticky for the session via the `torny.dev.host` cookie.

---

## The block system

**Blocks** are Vue components in `packages/content-blocks/src/blocks/`. Every block:

1. Declares a **props shape** in `packages/content-blocks/src/types.ts`. These become the admin-editable fields.
2. Is added to the `BlockType` union + the `Block` discriminated union.
3. Is registered in `BlockRenderer.vue`'s `v-else-if` switch.
4. Is exported from `packages/content-blocks/src/index.ts` for individual imports.
5. Lands in the CRM's `WebsiteEditorView.vue`:
   - Palette tile (so admins can drop it onto a page)
   - Default props seed (so first-time inserts look right)
   - Inspector form (one `<template v-else-if="selectedBlock.type === 'xyz'">` per block)
   - `BLOCK_LABEL` entry (sidebar label)
   - `BlockPaletteDialog` SVG preview + tag mapping (so it's searchable)
6. Needs a one-line **backend brief** to be added to the server-side block-type allowlist (see `docs/backend-briefs/116` et al for the pattern).

**Interactive blocks** can carry local state (FAQ open index, Gallery lightbox, EventsCalendar view mode) — Vue reactivity handles it. **Data-hydrated blocks** (EventList, HonourBoard, Members, Tournaments, etc.) read from a `BlockContext` provided by `PageRenderer` so they stay context-free when composed on different pages.

**Chrome** — `SiteHeader`, `SiteMobileDrawer`, `SiteFooter` — lives in `packages/content-blocks/src/chrome/` and is used by the Nuxt layout, not the block renderer. Chrome is configured in `Settings → Website → Navigation`, not the page editor.

### Current block catalog (33 blocks)

- **Heroes:** Hero, FullBleedImage, FullBleedMedia, VenueHireHero, UpcomingTournamentHero
- **Content:** RichText, SectionTitle, PullQuote, MediaSplit, TwoColumn, FeatureGrid, FaqAccordion
- **Data lists:** EventList, EventsCalendar, HonourBoard, HonourBoardSearch, TournamentSearch, UpcomingTournamentsList, MembersSearch
- **Venue:** VenueSpaces, VenuePackages, VenueBooking
- **Membership + CTAs:** MembershipJoinForm, MembershipCta, CtaBanner
- **Hospitality:** BistroMenu (downloadable menu PDFs with hours + booking CTA)
- **Social proof:** Sponsors (logo wall with tier pills), PeopleGrid, Gallery (with click-to-zoom lightbox)
- **Editorial glue:** Timeline, Divider
- **Escape hatch:** CustomAiBlock (admin-authored HTML + CSS + optional JS, sanitised server-side)

---

## Tenant resolution + routing

Public sites multi-tenant on a single Cloudflare Pages deployment.

1. Cloudflare's tenant-router Worker intercepts every incoming request, matches the host against the known tenant list, and sets the `x-torny-tenant-host` header before proxying to the Pages worker.
2. `apps/club-sites/server/middleware/tenant.ts` reads that header (falling back to `Host` in dev, then to a `?host=` query override for local), normalises it, and calls `/clubs/resolve` to fetch the tenant record.
3. The resolved `Club` becomes `useClub()` for the rest of the request.
4. `useTheme()` runs twice: first synchronously injecting the admin's `brand_primary` so buttons don't flash blue on hard refresh (the FOUC fix shipped 2026-11-23), then after `useSite()` resolves to inject the full token system — colour scheme, font pair, style preset.
5. Pages are rendered by `PageRenderer.vue`, which reads `site.pages[slug].blocks` from the resolved payload and hands each block to `BlockRenderer`.

**Brief 110** fixed a long-standing slug-vs-subdomain drift: `/clubs/resolve` now returns both `slug` (canonical, used by Venue-stack endpoints) and `subdomain` (tenant-routing key, used by SAM-stack endpoints). Three of the ~six public endpoints key on subdomain; the rest key on slug. See `docs/backend-briefs/110-slug-mismatch-sam-vs-venue.md` for the full matrix.

---

## Backend-first briefs workflow

Every FE change that depends on a new field, endpoint, or behaviour starts as a numbered brief under `docs/backend-briefs/`.

Flow:

1. FE needs something new → draft a brief (§1 ask, §2+ behaviour, verification checklist, non-goals). Mirror the shape of brief 65.
2. FE ships behind the brief — graceful fallback until backend lands.
3. Backend ships the contract. If the URL deviated from scope, FE saves a parallel `…-live.md` doc capturing the shipped shape before patching the api-client resource.
4. Error codes never get invented in the FE. If a new case needs one, it goes into the brief and the matching api-client type.

Recent flows worth reading as pattern references:

- `115-footer-config-owned-by-club.md` + `115-footer-config-owned-by-club-live.md` — scope vs. shipped
- `118-block-pdf-uploads.md` + `118-block-pdf-uploads-live.md` — same, with the CRM-stack → Venue-stack URL rewrite
- `119-httponly-session-cookies.md` — proposed, blocked on backend scoping
- `120-backend-auth-rate-limit.md` — proposed, blocked on backend scoping

---

## Testing + quality

- **Typecheck everywhere.** `pnpm typecheck` runs `vue-tsc --noEmit` across apps + packages. CI gate.
- **Vitest.** `apps/crm` (62 tests), `packages/api-client` + `packages/content-blocks` (contract tests), `apps/club-sites` (15 tests on pure helpers).
- **Playwright smoke suite** — `apps/crm/e2e/smoke.spec.ts`. Three tests today: sign-in renders without console errors, protected route redirects cleanly, **axe-core WCAG 2.1 A + AA baseline** that fails on any serious/critical a11y violation.
- **Public-sites smoke gate** — post-deploy Playwright check so a Nuxt SSR regression can't ship silently.
- **Dependabot** — weekly PR groups for prod + dev minor/patch bumps. Majors on load-bearing deps (Vue, Nuxt, Vite, TypeScript, Vitest) are hand-bumped. See `docs/production-readiness/02-dependabot.md`.
- **CI** — GitHub Actions on every PR. Verify = typecheck + lint + test. Node 22 since 2026-11-25.

---

## Security + production readiness

Hardening history is numbered under `docs/production-readiness/`:

| Track | Status | What |
|---|---|---|
| 01 — XSS sanitize-html (CRM) | ✅ | DOMPurify on every CRM `v-html`. |
| 01b — XSS sanitize (content-blocks) | ✅ | Isomorphic sanitiser (sanitize-html — Nuxt-compatible) wraps RichText + CustomAi. |
| 02 — Dependabot | ✅ | Weekly groups + majors blocked on load-bearing deps. |
| 03 — Sentry | ✅ | `@sentry/vue` + sourcemap upload wired into CRM build. Live errors flowing. |
| 04 — Dead axios code removed | ✅ | Closed ~7 high-severity Dependabot alerts in one PR. |
| 05 — Preload error recovery | ✅ | One-shot reload on `vite:preloadError` so stale tabs recover from deploys. |
| 06 — Build-quality editor UX | 🚧 | Ship 1 (PDF uploads) + ship 2 (a11y sweep) live. Ship 3 (live preview) scoped. |
| 06 — CSP headers (CRM) | ✅ | Started Report-Only, flipped to enforcing after clean reports. |
| 07 — Club-sites typecheck debt | ✅ | Nuxt-app typecheck + test setup gaps closed; back to monorepo-wide CI. |
| 08 — Compliance floor | 🚧 | `/privacy` + `/terms` scaffolded. DSR flow pending. |
| 09 — Sign-in rate limit | ✅ | FE lockout + composable + tests. Extended to Register / Forgot / Reset. |
| 10 — Rollback automation | ✅ | `bin/rollback-crm.sh` + runbook + CLAUDE.md pointers. |
| 11 — PR template | ✅ | `.github/pull_request_template.md`. |
| 12 — SEO + AI readiness | ✅ | robots + sitemaps + canonical + JSON-LD + llms.txt + AI bot directives + per-tenant OG images. |

Audit baseline: `docs/production-readiness/audit-2026-11-11.md`.

---

## Deployment

- **CRM** (`apps/crm`) — Vite static SPA → Cloudflare Pages. Sourcemaps uploaded to Sentry on build. Rollback via `bin/rollback-crm.sh` (see `docs/runbook/crm-rollback.md`).
- **Club sites** (`apps/club-sites`) — Nuxt 3 → Cloudflare Pages Workers, `nodejs_compat` flag required. Custom hostnames via Cloudflare for SaaS. Tenant routing + revalidation flow documented at `apps/club-sites/README.md`.
- **Marketing site** (`apps/torny-web`) — Nuxt 3 → Cloudflare Pages. Hosts `torny.pro`, `/privacy`, `/terms`.

---

## Documentation map

- **`docs/backend-briefs/`** — every backend contract change. Numbered, brief-then-live-shipped-version pattern.
- **`docs/design-briefs/`** — Paper file references for each surface. New block designs live in the "Torny v2 Design" Paper file.
- **`docs/production-readiness/`** — audit + numbered remediation track. See table above.
- **`docs/runbook/`** — rollback + ops runbooks.
- **`docs/changelog/`** — daily rollups of landed changes. Started 2026-11-25.
- **`CLAUDE.md`** at repo root — project instructions loaded by every Claude Code session. Conventions, feedback loop, gotchas.
- **`apps/*/README.md`** — per-app specifics (tenant routing, revalidation, build).

---

## Contributing

- Branch off `main`, PR against `main`. The `.github/pull_request_template.md` prompt is required.
- CI must be green before merge (verify = typecheck + lint + test).
- New blocks need a one-line backend brief for the server-side allowlist (see brief 116 / 117 / 118 for the pattern).
- Styling conventions, the feedback loop, and the common gotchas live in `CLAUDE.md` — read it first if you're new.
- Rough rule: **don't invent error codes in the FE.** They go in the brief and the matching api-client type.
