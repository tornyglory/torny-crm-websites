import { defineEventHandler, getRequestHeader, createError } from 'h3'
import { resolveClubForHost } from '../utils/tornyApi'

// Runs on every request. Resolves the club from the Host header and hangs it
// off event.context.club for downstream handlers / composables.
export default defineEventHandler(async (event) => {
  const url = event.node.req.url ?? ''
  if (url.startsWith('/_nuxt') || url.startsWith('/__nuxt') || url.startsWith('/_ipx')) return

  const host = (getRequestHeader(event, 'host') ?? '').toLowerCase()
  if (!host) return

  const club = await resolveClubForHost(host).catch(() => null)
  if (!club) {
    if (url.startsWith('/api/')) return
    throw createError({ statusCode: 404, statusMessage: 'Club not found for host' })
  }

  event.context.club = club
})
