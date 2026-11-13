import { defineEventHandler, getRouterParam, setResponseHeader, createError } from 'h3'
import { fetchCustomFacets } from '~/server/utils/tornyApi'

/**
 * Proxies `GET /public/clubs/:slug/custom-facets` (brief 105 §2.3).
 * Returns only `is_active = true` facets in display order. Used by the
 * public join form to build the Additional-questions section (or any
 * section the owner has placed a facet in).
 *
 * Cache window is deliberately short — admins editing a facet in the
 * Website builder expect the new field to appear on the public form
 * promptly without triggering a KV purge.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'slug required' })

  const facets = await fetchCustomFacets(slug)

  setResponseHeader(event, 'Cache-Control', 'public, max-age=30, stale-while-revalidate=300')
  return facets
})
