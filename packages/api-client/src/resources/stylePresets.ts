// Style presets — curated site-wide radius + card + button treatments.
// See brief 23. Structural twin of resources/fontPairs.ts.

import { CRM_BASE } from '../config'
import { authedFetch, publicFetch } from '../http'
import type { StylePreset } from '../types'

// ── Types ─────────────────────────────────────────────────────────

export type { StylePreset, ClubStyle } from '../types'

export interface StylePresetsResponse {
  default_slug: string
  presets: StylePreset[]
}

export interface UpdateStylePresetResponse {
  clubId: number
  /** What's stored on the club — may be null when reset to default. */
  style_preset: string | null
  /** What actually renders — always populated, falls back to `default_slug`. */
  effective_slug: string
}

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Endpoints ─────────────────────────────────────────────────────

/** GET /style-presets — public. Returns the curated list + default slug. */
export async function list(
  opts: { signal?: AbortSignal } = {},
): Promise<StylePresetsResponse> {
  const res = await publicFetch<Envelope<StylePresetsResponse>>(
    `${CRM_BASE}/style-presets`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

/**
 * PATCH /clubs/:clubId/style-preset — set or clear the club's style preset.
 * Pass `null` to reset to the platform default. Backend fires the Nuxt
 * revalidate webhook so the public site rerenders within a few seconds.
 */
export async function updateForClub(
  clubId: number,
  stylePreset: string | null,
  opts: { signal?: AbortSignal } = {},
): Promise<UpdateStylePresetResponse> {
  const res = await authedFetch<Envelope<UpdateStylePresetResponse>>(
    `${CRM_BASE}/clubs/${clubId}/style-preset`,
    {
      method: 'PATCH',
      body: JSON.stringify({ style_preset: stylePreset }),
      signal: opts.signal,
    },
  )
  return res.data
}
