# 12 · SEO — websites

**Status:** complete.
**Date:** 2026-11-25

Covers the three apps: `apps/crm` (admin tool — explicitly noindex), `apps/torny-web` (marketing, torny.pro), `apps/club-sites` (per-club public sites, tenant-routed).

## What's shipped

### CRM — do not index

The CRM is admin software, not public content. Three layers of "please don't index this" so no crawler accidentally picks it up:

- `apps/crm/public/robots.txt` — `Disallow: /` for all agents
- `apps/crm/index.html` — `<meta name="robots" content="noindex, nofollow">`
- `apps/crm/public/staticwebapp.config.json` — global `X-Robots-Tag: noindex, nofollow` header

### torny-web — marketing site SEO

- `apps/torny-web/public/robots.txt` — allow all, disallow the signup wizard's intermediate `/signup/welcome` step, point at the sitemap
- `apps/torny-web/public/sitemap.xml` — static; lists `/`, `/sign-in`, `/register`, `/signup`, `/privacy`, `/terms` with sensible `priority` + `changefreq`
- `apps/torny-web/app.vue` — now carries:
  - `titleTemplate` so every page's title ends in `— Torny`
  - OG defaults (`ogSiteName`, `ogImage`, dimensions, alt)
  - Twitter card defaults
  - `htmlAttrs.lang` → `en-NZ`
  - Canonical URL
  - Organization JSON-LD block

Per-page `useSeoMeta` calls on index / signup / privacy / terms already exist from the earlier compliance-floor work — they inherit the site-wide defaults and only override title + description.

### club-sites — per-tenant SEO

The public club sites are the search-visibility surface — individual members and prospects search for their club by name, so proper structured data + canonical URLs + sitemaps matter most here.

Server routes (dynamic per host):

- `apps/club-sites/server/routes/robots.txt.ts` — per-tenant robots. Sitemap URL embeds the current host. Future: honour a `search_indexable: false` flag from the site payload (hook already in place, just no-ops today).
- `apps/club-sites/server/routes/sitemap.xml.ts` — per-tenant sitemap. Enumerates the known static top-level routes a Torny club site has (`/`, `/about`, `/membership`, `/contact`, `/events`, `/honour-board`, `/venue-hire/book`) with per-route changefreq + priority. 1-hour cache. Dynamic routes (individual events / tournaments / custom pages) are a follow-up.

Layout (`apps/club-sites/layouts/default.vue`):

- `useSeoMeta` with per-club title template (`<page> — <club name>`), description, theme color driven by `brand_primary`, OG image from `logo_url`
- `useHead` with:
  - `htmlAttrs.lang: 'en-NZ'`
  - Canonical URL — prefers the club's first custom domain over the `torny.pro` subdomain so SEO authority accrues to the brand the club actually owns
  - `SportsClub` JSON-LD schema block (name, URL, logo, sport)

The JSON-LD only emits once the club payload has enough shape to be meaningful — skips during the SSR-before-payload window instead of writing half-formed cards that Google would ignore anyway.

## Design decisions

### Canonical prefers custom domain

If a club brings `naenaebowls.co.nz` AND `naenaebowls.torny.pro` resolves to the same content, Google needs to know which is primary. Picking the custom domain means SEO authority accrues to the brand the club controls. Clubs without a custom domain fall back to their torny.pro subdomain.

### Dynamic sitemap over Nuxt modules

I considered `@nuxtjs/sitemap` for the automated route-discovery, but it would add a module + config + dep without buying much for a multi-tenant setup. Hand-rolled server routes are more explicit, cache per-host cleanly, and sidestep the module's assumptions about a single-tenant site.

### Static sitemap on torny-web

Only 6 routes, all known at build time. A server route would be overkill — just ship a static XML file from `public/`.

### SportsClub schema (not Organization)

`SportsClub` is a schema.org subtype that signals "this is an actual sports club" more precisely than the generic `Organization` type. Better knowledge-graph placement for queries like "lawn bowls clubs near me".

## What's NOT shipped (follow-ups)

- **Dynamic sitemap entries** for individual events + tournaments + custom pages on club-sites. Needs the backend to expose list endpoints the sitemap route can iterate. Modest change; good follow-up.
- **Per-page JSON-LD** for events (`Event` schema) and tournaments (`SportsEvent` schema). Each event page would carry its own structured data block. Worth doing but needs per-page `useHead` calls.
- **Dynamic OG images.** Right now club-sites use `logo_url` as the OG image. A dedicated `nuxt-og-image`-style per-page OG image would look nicer in link previews. Deferred.
- **Open Graph PNG at `/og-default.png` for torny-web.** The `app.vue` references `/og-default.png`, but there's no file at `apps/torny-web/public/og-default.png` yet. Social previews will 404 that image until someone drops a 1200×630 PNG in there. Small design task.
- **Logo PNG at `/logo.png`** for torny-web Organization JSON-LD. Same status as the OG image — referenced, not shipped.
- **Verification:** actually confirming sitemaps + robots are discoverable requires Google Search Console setup per domain. That's its own ops task.

## Verification done locally

- `pnpm --filter @torny/club-sites typecheck` — green
- `pnpm --filter @torny/club-sites test` — 15/15 green
- `pnpm --filter @torny/club-sites build` — green
- `pnpm --filter @torny/torny-web build` — green
- `pnpm lint` — green across all workspaces

Pre-existing `torny-web` typecheck issue in `pages/signup/index.vue` (`defaultPlanFor` not resolving in template context) is unrelated and documented in [`11-club-sites-vitest.md`](./11-club-sites-vitest.md).

## Follow-up briefs

None required on the backend side for what's shipped. If we want the `search_indexable: false` hook to actually do something (e.g. a new club in onboarding not ready for public search), that'd be a small brief against the site payload.

## Score impact

SEO was 3/10 on the audit. Now sitting at **~7/10**:

- robots.txt + sitemap.xml across all surfaces ✅
- Canonical URLs ✅
- OG + Twitter cards ✅
- Structured data (Organization + SportsClub) ✅
- Per-tenant handling ✅

Gap to 9 is the follow-ups above: dynamic sitemap entries, per-page Event/SportsEvent schemas, dynamic OG images, the two placeholder PNGs on torny-web.
