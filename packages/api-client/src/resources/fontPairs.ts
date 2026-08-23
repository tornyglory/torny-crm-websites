// Font pairs — curated triples the CRM can pick from. See brief 22.
//
// `GET /font-pairs` is unauthenticated + cacheable (backend advertises
// `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`).
// `PATCH /clubs/:id/font-pair` is bearer-authed, owner or admin.

import { CRM_BASE } from '../config'
import { authedFetch, publicFetch } from '../http'
import type { ClubFont } from '../types'

// ── Types ─────────────────────────────────────────────────────────

export interface FontPair {
  slug: string
  name: string
  description: string
  heading: ClubFont
  body: ClubFont
  mono: ClubFont
  is_default?: boolean
}

export interface FontPairsResponse {
  default_slug: string
  pairs: FontPair[]
}

export interface UpdateFontPairResponse {
  clubId: number
  /** What's stored on the club — may be null when reset to default. */
  font_pair: string | null
  /** What actually renders — always populated, falls back to `default_slug`. */
  effective_slug: string
}

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Endpoints ─────────────────────────────────────────────────────

/** GET /font-pairs — public. Returns the curated list + default slug. */
export async function list(
  opts: { signal?: AbortSignal } = {},
): Promise<FontPairsResponse> {
  const res = await publicFetch<Envelope<FontPairsResponse>>(
    `${CRM_BASE}/font-pairs`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

/**
 * PATCH /clubs/:clubId/font-pair — set or clear the club's font pair.
 * Pass `null` to reset to the platform default. Backend fires the Nuxt
 * revalidate webhook so the public site rerenders within a few seconds.
 */
export async function updateForClub(
  clubId: number,
  fontPair: string | null,
  opts: { signal?: AbortSignal } = {},
): Promise<UpdateFontPairResponse> {
  const res = await authedFetch<Envelope<UpdateFontPairResponse>>(
    `${CRM_BASE}/clubs/${clubId}/font-pair`,
    {
      method: 'PATCH',
      body: JSON.stringify({ font_pair: fontPair }),
      signal: opts.signal,
    },
  )
  return res.data
}
