import { defineEventHandler, getRouterParam, setResponseHeader, createError } from 'h3'
import { fetchSite } from '~/server/utils/tornyApi'

/**
 * Proxies `GET /public/clubs/:slug/site` from the CRM API. Sits on the Nuxt
 * origin so we can:
 *   - apply the SWR route rules in nuxt.config.ts (5-min home, 1-min events)
 *   - drop in Workers KV later without touching page code
 *   - swap in per-tenant caching keys tied to the revalidate webhook
 *
 * The slug is expected to match `event.context.club.slug` — pages compute it
 * that way — but we don't hard-enforce here so previews / staging URLs can
 * request any slug directly if needed.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'slug required' })

  const site = await fetchSite(slug)
  if (!site) throw createError({ statusCode: 404, statusMessage: 'club not found' })

  // Short public cache — Nuxt's own SWR windows layer on top of this.
  setResponseHeader(event, 'Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  return site
})
