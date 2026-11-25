/**
 * Per-tenant robots.txt. The Sitemap URL embeds the current host so
 * each club's crawler discovery stays scoped to their own domain —
 * naenaebowls.torny.pro/robots.txt points at naenaebowls.torny.pro
 * /sitemap.xml, not the torny.pro marketing one.
 *
 * Allowed by default. Backend brief can opt a specific club out
 * (e.g. new club in onboarding not ready for public search) by
 * flipping a `search_indexable` field on the site payload — we read
 * it here. Defaults to true if the field doesn't exist yet.
 */
import { resolveClubForHost } from '../utils/tornyApi'

export default defineEventHandler(async (event) => {
  const host = getRequestHeader(event, 'host') ?? 'torny.pro'
  const scheme = getRequestHeader(event, 'x-forwarded-proto') ?? 'https'
  const sitemapUrl = `${scheme}://${host}/sitemap.xml`

  // Check if this tenant's search indexable. Unknown tenant → allow
  // (robots.txt isn't the place to leak existence).
  let indexable = true
  try {
    const club = await resolveClubForHost(host)
    // `search_indexable` lands via a future brief; absent = indexable.
    const siteConfig = club as unknown as { search_indexable?: boolean } | null
    if (siteConfig && siteConfig.search_indexable === false) indexable = false
  } catch {
    // Defensive: if the tenant resolver trips, still return a valid
    // robots.txt — just the permissive default.
  }

  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600')

  if (!indexable) {
    return [
      `# Tenant marked non-indexable.`,
      `User-agent: *`,
      `Disallow: /`,
      ``,
    ].join('\n')
  }

  const llmsUrl = `${scheme}://${host}/llms.txt`

  return [
    `User-agent: *`,
    `Allow: /`,
    ``,
    `# Internal / auth-ish paths — not relevant to search`,
    `Disallow: /book/`,
    `Disallow: /tournaments/*/enter`,
    `Disallow: /tournaments/*/entry-complete`,
    ``,
    `# ── AI crawlers ────────────────────────────────────────────`,
    `# Allow user-driven AI search (ChatGPT / SearchGPT, Perplexity,`,
    `# Claude, Google AI). Structured summary at llms.txt.`,
    `User-agent: ChatGPT-User`,
    `Allow: /`,
    ``,
    `User-agent: OAI-SearchBot`,
    `Allow: /`,
    ``,
    `User-agent: PerplexityBot`,
    `Allow: /`,
    ``,
    `User-agent: ClaudeBot`,
    `Allow: /`,
    ``,
    `User-agent: Claude-SearchBot`,
    `Allow: /`,
    ``,
    `User-agent: Claude-User`,
    `Allow: /`,
    ``,
    `User-agent: Google-Extended`,
    `Allow: /`,
    ``,
    `User-agent: GoogleOther`,
    `Allow: /`,
    ``,
    `# Opt out of training-only crawlers.`,
    `User-agent: GPTBot`,
    `Disallow: /`,
    ``,
    `User-agent: CCBot`,
    `Disallow: /`,
    ``,
    `User-agent: Omgilibot`,
    `Disallow: /`,
    ``,
    `Sitemap: ${sitemapUrl}`,
    `# llms.txt at the site root carries the structured summary AI`,
    `# crawlers prefer.`,
    `# ${llmsUrl}`,
    ``,
  ].join('\n')
})
