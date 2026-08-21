import { defineEventHandler, getRequestHeader, getQuery, createError } from 'h3'
import { resolveClubForHost } from '../utils/tornyApi'

// Runs on every request. Resolves the club from the Host header and hangs it
// off event.context.club for downstream handlers / composables.
export default defineEventHandler(async (event) => {
  const url = event.node.req.url ?? ''
  if (url.startsWith('/_nuxt') || url.startsWith('/__nuxt') || url.startsWith('/_ipx')) return

  // Dev-only Host override so we can preview different tenants locally
  // (e.g. localhost:3000?host=melbourne-bowling-club.torny.club).
  const query = getQuery(event)
  const overrideHost = typeof query.host === 'string' ? query.host : null
  const rawHost = overrideHost ?? (getRequestHeader(event, 'host') ?? '')
  const host = rawHost.toLowerCase()
  if (!host) return

  const club = await resolveClubForHost(host).catch(() => null)
  if (!club) {
    // API routes decide their own 404s.
    if (url.startsWith('/api/')) return
    throw createError({ statusCode: 404, statusMessage: 'Club not found for host' })
  }

  event.context.club = club
})
