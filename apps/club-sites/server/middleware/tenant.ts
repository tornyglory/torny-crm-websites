import { defineEventHandler, getRequestHeader, getQuery, getCookie, setCookie, createError } from 'h3'
import { resolveClubForHost } from '../utils/tornyApi'

// Runs on every request. Resolves the club from the Host header and hangs it
// off event.context.club for downstream handlers / composables.
//
// Dev tenant override:
// - `?host=<slug>.torny.club` picks the tenant and gets stored in a cookie
//   (`torny.dev.host`), so internal links (`/membership`, `/events`, …) don't
//   need to carry the query param.
// - The cookie is dev-only (skipped when the real Host header matches a club),
//   session-scoped, and lax-site so it survives normal navigation.
export default defineEventHandler(async (event) => {
  const url = event.node.req.url ?? ''
  if (url.startsWith('/_nuxt') || url.startsWith('/__nuxt') || url.startsWith('/_ipx')) return

  const rawRequestHost = (getRequestHeader(event, 'host') ?? '').toLowerCase()
  const isLocalhost = rawRequestHost.startsWith('localhost') || rawRequestHost.startsWith('127.0.0.1')

  const query = getQuery(event)
  const overrideFromQuery = typeof query.host === 'string' ? query.host : null

  // Persist the dev override in a cookie so subsequent link clicks resolve
  // even without the ?host= param. Only honour the cookie on localhost —
  // in prod the real Host header always wins.
  if (isLocalhost && overrideFromQuery) {
    setCookie(event, 'torny.dev.host', overrideFromQuery, {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      // Session cookie (no maxAge) so it clears when the browser closes.
    })
  }
  const overrideFromCookie = isLocalhost ? (getCookie(event, 'torny.dev.host') ?? null) : null

  const host = (overrideFromQuery ?? overrideFromCookie ?? rawRequestHost).toLowerCase()
  if (!host) return

  const club = await resolveClubForHost(host).catch(() => null)
  if (!club) {
    // API routes decide their own 404s.
    if (url.startsWith('/api/')) return
    throw createError({ statusCode: 404, statusMessage: 'Club not found for host' })
  }

  event.context.club = club
})
