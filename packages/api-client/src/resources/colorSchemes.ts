// Color schemes — curated site-wide background palettes. See brief 37.
// Structural twin of resources/stylePresets.ts.
//
// `GET /color-schemes` is unauthenticated + cacheable (backend advertises
// `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`).
// `PATCH /clubs/:id/color-scheme` is bearer-authed, owner or admin.

import { CRM_BASE } from '../config'
import { authedFetch, publicFetch } from '../http'
import type { ColorScheme, ColorSchemeTokens } from '../types'

// ── Types ─────────────────────────────────────────────────────────

export type { ColorScheme, ColorSchemeTokens, ClubColorScheme } from '../types'

export interface ColorSchemesResponse {
  default_slug: string
  schemes: ColorScheme[]
}

export interface UpdateColorSchemeResponse {
  clubId: number
  /** What's stored on the club — may be null when reset to default. */
  color_scheme: string | null
  /** What actually renders — always populated, falls back to `default_slug`. */
  effective_slug: string
  /** Fully-resolved token map — render immediately, no follow-up fetch. */
  tokens: ColorSchemeTokens
}

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Endpoints ─────────────────────────────────────────────────────

/** GET /color-schemes — public. Returns the curated list + default slug. */
export async function list(
  opts: { signal?: AbortSignal } = {},
): Promise<ColorSchemesResponse> {
  const res = await publicFetch<Envelope<ColorSchemesResponse>>(
    `${CRM_BASE}/color-schemes`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

/**
 * PATCH /clubs/:clubId/color-scheme — set or clear the club's palette.
 * Pass `null` to reset to the platform default. Backend fires the Nuxt
 * revalidate webhook so the public site rerenders within a few seconds.
 */
export async function updateForClub(
  clubId: number,
  colorScheme: string | null,
  opts: { signal?: AbortSignal } = {},
): Promise<UpdateColorSchemeResponse> {
  const res = await authedFetch<Envelope<UpdateColorSchemeResponse>>(
    `${CRM_BASE}/clubs/${clubId}/color-scheme`,
    {
      method: 'PATCH',
      body: JSON.stringify({ color_scheme: colorScheme }),
      signal: opts.signal,
    },
  )
  return res.data
}
