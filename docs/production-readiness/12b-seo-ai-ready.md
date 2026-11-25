# 12b · SEO — AI readiness + full OG coverage

**Status:** complete.
**Date:** 2026-11-25
**Related:** [`12-seo.md`](./12-seo.md) is the base layer this builds on.

Follow-up to [12](./12-seo.md) specifically targeting AI crawler readiness (ChatGPT, Perplexity, Claude, Google AI) and per-page Open Graph completeness.

## What's shipped

### `llms.txt` — the AI-crawler equivalent of `robots.txt`

Emerging standard (<https://llmstxt.org>) adopted by ChatGPT, Perplexity, Claude, and others for site context. Markdown by convention so LLMs can parse without tokenisation friction.

- `apps/torny-web/public/llms.txt` — static. Describes Torny as a brand + marketing site, with links to policy pages.
- `apps/club-sites/server/routes/llms.txt.ts` — per-tenant. Enumerates the club's public surfaces with a short "entity" block (name, sport, country, platform) so an AI assistant asked "what's naenaebowls.torny.pro?" has a clean, structured answer to ground on.

Both are cached 1 hour.

### AI crawler directives in `robots.txt`

Explicit rules for the current bot landscape, rather than relying on the generic `User-agent: *`. Lives in `torny-web/public/robots.txt` (static) and `club-sites/server/routes/robots.txt.ts` (per-tenant).

**Allowed** — user-driven search crawlers that cite sources:

- `ChatGPT-User` + `OAI-SearchBot` (OpenAI)
- `PerplexityBot` (Perplexity)
- `ClaudeBot` + `Claude-SearchBot` + `Claude-User` (Anthropic)
- `Google-Extended` + `GoogleOther` (Google AI surfaces)

**Disallowed** — training-only crawlers that don't link back:

- `GPTBot` (OpenAI training)
- `CCBot` (Common Crawl, feeds many model-training datasets)
- `Omgilibot` (Webz.io, bulk training data)

This balance is deliberate: we *want* AI search to surface Torny / club sites, and we don't mind that showing up in citations. We're cautious about contributing to generic training corpora that don't attribute.

The list ages fast — new bots launch monthly. Review quarterly.

### Per-page `useSeoMeta` on every club-sites page

Audit before: only `events/[slug]` and `tournaments/[slug]/enter` had `useSeoMeta`. Every other page inherited the layout default — fine for a site-wide fallback, bad for individual page sharing.

After: every page carries its own `useSeoMeta`. Title overrides (e.g. "Events — Naenae Bowling Club"), description tailored to the page's role, `ogTitle` / `ogDescription` / Twitter title overrides.

Home is deliberately title-less so the layout's titleTemplate renders just the club name (not "Home — Naenae Bowling Club" which reads oddly).

`venue-hire/book` is explicitly `robots: 'noindex, follow'` — the page carries `?package=` + `?space=` query combos that'd bloat the index without adding content value. Still crawlable for internal link discovery.

### Enriched JSON-LD on club-sites

The layout's `useHead` now emits two schema blocks instead of one:

**SportsClub** — same as before, but with contact details + opening hours when the backend provides them. Fields degrade gracefully (if `site.contact.phone` is missing, the `telephone` field isn't emitted — Google would rather see absence than an empty string).

**BreadcrumbList** — new. Reflects the URL hierarchy (`Home → Events → <event slug>`). AI assistants rely on this to understand where a given URL sits in the site tree — it's cheap to emit and disproportionately useful.

### WebSite schema on torny-web

`WebSite` JSON-LD tells Google the site is a distinct entity, which can earn a sitelinks search box in SERPs. Second schema block on `app.vue` next to the existing Organization one.

## Why these specific choices

### AI-search allowlist + training-crawler disallow

An article's worth of reasoning compressed to one line: we want citation, not bulk harvesting. Let the AI search bots see the content, because they link back to the source; keep the training-only bots away, because they don't.

### llms.txt format + content

The llms.txt spec is intentionally minimal. The ones that work best:

- Lead with a `>` blockquote one-sentence description
- Use `## Pages` with clear anchor labels
- Include an `## Entity` section so the crawler can confirm what it's indexing
- Close with an `## Attribution` nudge

Both files follow this shape.

### BreadcrumbList over manual `<nav>` crumbs

You could do breadcrumbs as visible HTML and an AI crawler would piece it together from the text. JSON-LD gives it unambiguously — no parsing, no "which `<nav>` is the breadcrumbs". Pays off double for AI assistants that read structured data first.

### Enriched SportsClub with graceful degradation

The backend's site payload sometimes carries `contact.email`, `contact.phone`, `contact.address`, and a `hours` array. When they're present, they land in the schema. When they're not, the fields are absent — Google prefers absence to empty. The OpeningHoursSpecification mapping from `mon` → `Monday` happens inline.

## What's NOT shipped (follow-ups)

- **Dynamic OG images** — would need `nuxt-og-image` module + a per-page design. Both apps still reference a static `/og-default.png` on torny-web (ship a 1200×630 design) and `logo_url` for clubs. Big UX win for social sharing; bigger scope than this session.
- **FAQPage schema on About pages** — needs actual FAQ content. The current About page is heavily content-driven from the CRM editor. When clubs start adding Q&A blocks there, wire the content into a FAQPage schema block.
- **Event schema on `events/[slug]`** — already has useSeoMeta, but no JSON-LD Event block. Would let Google render event-rich results. Needs the backend event payload shape to stay stable first.
- **sameAs links** on Organization + SportsClub — social profiles / Wikidata entries would reinforce entity identity. Deferred until there are real social accounts.
- **Verification** — needs Google Search Console setup per domain + manual submission of sitemaps. Ops task.

## Verification done locally

- `pnpm --filter @torny/club-sites typecheck` — green
- `pnpm --filter @torny/club-sites test` — 15/15 green
- `pnpm --filter @torny/club-sites build` — green
- `pnpm --filter @torny/torny-web build` — green
- `pnpm lint` — green

## Score impact

SEO was 7/10 after [12](./12-seo.md). This brings it to **~9/10**:

- Every page has per-page SEO ✅
- Canonical URLs ✅
- OG + Twitter cards ✅
- Structured data (Organization + WebSite + SportsClub + BreadcrumbList) ✅
- Per-tenant handling ✅
- **AI crawler directives + llms.txt** ✅
- **Enriched entity schemas** ✅

Remaining gap to a true 9.5+: dynamic OG images + per-event Event schema + actual Search Console verification. All three are design / content / ops tasks rather than code.
