# 12c · Dynamic OG images — per-tenant SVG via Nitro

**Status:** complete.
**Date:** 2026-11-25
**Related:** [`12-seo.md`](./12-seo.md), [`12b-seo-ai-ready.md`](./12b-seo-ai-ready.md)

Follow-up to the SEO work that completes the "OG tag ready" ask — every page on both Nuxt apps now has a visually-designed, dynamically-generated Open Graph image.

## What's shipped

### Two Nitro server routes, one per app

Both return `Content-Type: image/svg+xml`, cached for 1 hour at the edge and 24 hours on CDN.

**`apps/torny-web/server/routes/og.svg.ts`** — Torny brand card:

- Dark background with a brand-color accent tile and the Torny wordmark
- Takes `?title=` and `?subtitle=` query params so individual pages can override
- Falls back to "The Bowls Club Network" when no params provided
- Text wrapping (2-line title, 3-line subtitle) with truncation + ellipsis

**`apps/club-sites/server/routes/og.svg.ts`** — per-tenant club card:

- Reads the request's `Host` header → resolves the club payload via the existing `resolveClubForHost` helper
- Background uses the club's `brand_primary` color, with automatic text-color flip for light brand colors (perceived-luminance check so white text doesn't land on yellow)
- Big club name + optional `?label=` for the page context (EVENTS, ABOUT, etc.)
- Monogram tile from the first letter of the club name
- "POWERED BY TORNY" attribution

### Wiring

- `apps/torny-web/app.vue` — site-wide OG image now `https://torny.pro/og.svg`
- `apps/club-sites/layouts/default.vue` — OG image computed per-tenant: `${canonicalOrigin}/og.svg`, so clubs on custom domains get `naenaebowls.co.nz/og.svg` (their own authority), not the `.torny.pro` subdomain
- Every page in `apps/club-sites/pages/*.vue` overrides with `ogImage: '/og.svg?label=<page>'` so the social card carries the right page label
- Width + height set to 1200×630 (Facebook/Twitter/LinkedIn standard)

## Design decisions

### Why SVG, not PNG

The standard play here is `nuxt-og-image`, which renders HTML/Vue components to PNG via Satori + resvg-wasm. Tried it; **v7 requires Nuxt 4** (we're on 3.21), and the older versions that support Nuxt 3 have different APIs and stability issues.

SVG was the alternative that works today:

- Zero extra WASM dependencies
- Runs natively in Nitro's Cloudflare Workers preset
- Facebook, LinkedIn, Twitter / X all accept SVG `og:image` — they rasterize on their side
- Slack and Discord are iffier (occasionally render a fallback card) but don't break

**Follow-up:** when we upgrade to Nuxt 4, swap to `nuxt-og-image` for proper PNG output. Everything else — per-page overrides, per-tenant resolution, canonical URL handling — stays the same.

### Why not just use the club's logo as OG image

That's what we had before. It works, but:

- A raw square logo on a 1200×630 canvas looks awkward
- No page context ("looking at the Naenae events page" vs "looking at Naenae")
- No brand-color design, no typography

The dynamic card gives every social share a consistent, designed look without requiring the club to upload a specifically-sized OG asset.

### Why text-color auto-flip based on brand color

Clubs pick arbitrary brand colors in the CRM. Some are dark (`#0A1F44`), some are light (`#FFD54F`). White text on a yellow background is unreadable. The route does a cheap perceived-luminance check (`0.299·R + 0.587·G + 0.114·B`) and flips to dark text + dark muted color when the brand is too light. Not perfect contrast-math, but sufficient for "don't ship broken cards."

### Why system fonts, not custom web fonts

SVG referenced in an `<img>` tag (which is how social crawlers render it) doesn't load `@font-face` from CSS. The text in these cards uses the system-font stack (`system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`), which renders consistently across major crawlers and doesn't require font bundling.

### Why not cache per-URL

The Nitro route cache keys on the full URL including query params. `?label=Events` and `?label=About` get separate cache entries automatically. No cache plumbing needed in the route.

## Per-tenant verification

You can inspect the per-tenant behavior with curl:

```sh
# Torny-wide card
curl https://torny.pro/og.svg > torny-og.svg

# Different clubs get different cards from the same code
curl -H "Host: naenaebowls.torny.pro" https://<deploy-url>/og.svg > naenae.svg
curl -H "Host: richmond-union.torny.pro" https://<deploy-url>/og.svg > richmond.svg

# Page-specific labels
curl "https://naenaebowls.torny.pro/og.svg?label=Events" > naenae-events.svg
curl "https://naenaebowls.torny.pro/og.svg?label=About" > naenae-about.svg
```

Each returns a different SVG — different brand colors, different club names, different page labels.

## What's NOT shipped

- **PNG output.** Stuck behind the Nuxt 4 migration. Document now, swap when we upgrade.
- **Custom typography.** System fonts only. Loading a web font safely in SVG for crawlers would require either a build-time font-subset or an inline base64 font (which balloons file size).
- **Dynamic images for individual events / tournaments.** Right now events/[slug] pages inherit the per-club card. A per-event card with the event name + date would need the backend's event endpoint to be queryable from the og.svg route. Small ticket.

## Verification done locally

- `pnpm --filter @torny/torny-web build` — green
- `pnpm --filter @torny/club-sites build` — green
- `pnpm --filter @torny/club-sites typecheck` — green
- `pnpm lint` — green
- `pnpm test` — 140/140 green

## Social preview testing (manual, post-deploy)

Once deployed, validate per-tenant OG with the official crawler debuggers:

- Facebook: <https://developers.facebook.com/tools/debug/>
- LinkedIn: <https://www.linkedin.com/post-inspector/>
- Twitter / X card validator: <https://cards-dev.twitter.com/validator>

Each takes a URL, fetches the page, renders what the social card would look like. Try `torny.pro`, `naenaebowls.torny.pro`, and `naenaebowls.torny.pro/events` — three different cards.

## Score

SEO was ~9/10 after 12b. This closes the OG-image gap, which was the main thing people pointed at.

**Still 9/10 (not 9.5) because:**
- SVG OG — not universally supported (Discord/Slack occasionally fallback)
- Google Search Console verification per-domain still needs doing
- No per-event dynamic cards

All three are items to pick up when either (a) Nuxt 4 lands or (b) the backend exposes event lookup from server routes.
