/**
 * Pure helpers extracted from tornyApi.ts so they can be unit-tested
 * without pulling Nuxt's `#imports` module graph. Both are
 * intentionally side-effect-free and have no external dependencies.
 *
 * - `normaliseHost` — canonicalises a hostname to the key the tenant
 *   lookup cache uses. A silent change here fragments the cache and
 *   lets the same club resolve twice from different cache rows.
 * - `unwrapFacets` — accepts the three backend envelope shapes the
 *   facets endpoint has used over its lifetime (bare array,
 *   `{ facets: [...] }`, `{ rows: [...] }` / `{ items: [...] }`).
 *   Returns [] on anything else rather than crashing. See the inline
 *   test file for the full shape pin.
 *
 * tornyApi.ts re-exports both for backward compatibility; the pure
 * file is the source of truth and the test target.
 */

import type { CustomFacet } from './tornyApiTypes'

export function normaliseHost(h: string): string {
  return h.toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '')
}

export function unwrapFacets(data: unknown): CustomFacet[] {
  if (Array.isArray(data)) return data as CustomFacet[]
  if (data && typeof data === 'object') {
    const candidate = (data as Record<string, unknown>).facets
      ?? (data as Record<string, unknown>).rows
      ?? (data as Record<string, unknown>).items
    if (Array.isArray(candidate)) return candidate as CustomFacet[]
  }
  return []
}
