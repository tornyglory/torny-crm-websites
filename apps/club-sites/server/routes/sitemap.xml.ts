/**
 * Per-tenant sitemap.xml. Enumerates the static top-level pages every
 * club has by default. Dynamic routes (individual events /
 * tournaments / custom pages) are a follow-up — they need the
 * backend to expose per-club lists that the sitemap server route can
 * iterate. For now this covers the discovery surface Google cares
 * about most: "does this club have a Join / Contact / Honour Board
 * page?"
 *
 * Caching: 1 hour. Short enough that a new static page shows up
 * same-day; long enough that a crawler hammering the endpoint won't
 * cost us round-trips. If that becomes tight once dynamic entries
 * land, lift to a per-club revalidate hook from the CRM editor.
 */
import { resolveClubForHost } from '../utils/tornyApi'

// Top-level routes every club has. If a club has opted out of a page
// (e.g. no venue hire, no honour board), the page still renders — it
// just shows an empty state. Rendering an empty page is fine for
// Google; wait on exposing a per-page "enabled" flag until we have
// that in the backend.
const STATIC_ROUTES: Array<{
  path: string
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'
  priority: number
}> = [
  { path: '/', changefreq: 'weekly', priority: 1.0 },
  { path: '/about', changefreq: 'monthly', priority: 0.8 },
  { path: '/membership', changefreq: 'monthly', priority: 0.8 },
  { path: '/contact', changefreq: 'yearly', priority: 0.6 },
  { path: '/events', changefreq: 'daily', priority: 0.9 },
  { path: '/honour-board', changefreq: 'monthly', priority: 0.5 },
  { path: '/venue-hire/book', changefreq: 'monthly', priority: 0.7 },
]

export default defineEventHandler(async (event) => {
  const host = getRequestHeader(event, 'host') ?? 'torny.pro'
  const scheme = getRequestHeader(event, 'x-forwarded-proto') ?? 'https'
  const origin = `${scheme}://${host}`

  // Resolve so an unknown host doesn't emit a sitemap at all.
  const club = await resolveClubForHost(host)
  if (!club) {
    setResponseStatus(event, 404)
    return 'Not found'
  }

  const today = new Date().toISOString().slice(0, 10)

  const urls = STATIC_ROUTES.map((r) => `  <url>
    <loc>${origin}${r.path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority.toFixed(1)}</priority>
  </url>`).join('\n')

  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
})
