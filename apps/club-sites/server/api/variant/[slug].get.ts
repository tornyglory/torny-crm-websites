import { defineEventHandler, getRouterParam, setResponseHeader, createError } from 'h3'
import { fetchVariant } from '~/server/utils/tornyApi'

/**
 * Proxies `GET /public/clubs/:slug/variant` from the Torny API (brief 105).
 * Sits on the Nuxt origin for the same reasons as `/api/site/:slug` — SWR
 * cache windows, future Workers KV swap, per-tenant invalidation. The
 * variant config rarely changes (new verticals land only when backend
 * ships them) so we can cache aggressively.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'slug required' })

  const variant = await fetchVariant(slug)
  if (!variant) throw createError({ statusCode: 404, statusMessage: 'club not found' })

  // Longer cache than /site — terminology + module flags change on the
  // order of weeks (new vertical rollout), not minutes.
  setResponseHeader(event, 'Cache-Control', 'public, max-age=600, stale-while-revalidate=3600')
  return variant
})
