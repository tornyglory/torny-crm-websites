import type { TornyClient } from '../client'
import { CRM_BASE } from '../config'
import { authedFetch } from '../http'
import type { Club, ID } from '../types'

export const listMine = (c: TornyClient) =>
  c.get<Club[]>('/clubs/mine').then(r => r.data)

export const get = (c: TornyClient, id: ID) =>
  c.get<Club>(`/clubs/${id}`).then(r => r.data)

export const update = (c: TornyClient, id: ID, body: Partial<Club>) =>
  c.patch<Club>(`/clubs/${id}`, body).then(r => r.data)

export const resolveByHost = (c: TornyClient, host: string) =>
  c.get<Club>('/clubs/resolve', { params: { host } }).then(r => r.data)

// ── Brand assets ─────────────────────────────────────────────────
// See brief 24. Send only the field that changed; missing keys are
// no-ops, `null` clears a URL, string sets. `image_style` (brief 79)
// doesn't accept null — it's always one of the three enum values.

export type ImageStyle = 'soft' | 'studio' | 'archive'

export interface BrandAssetsPatch {
  logo_url?: string | null
  favicon_url?: string | null
  image_style?: ImageStyle
  /** 6-digit hex (`#RRGGBB`). Null clears the override — public site
   *  falls back to the colour-scheme preset's token. Brief 81. */
  brand_primary?: string | null
  /** 6-digit hex (`#RRGGBB`). Null clears the override. Brief 81. */
  brand_accent?: string | null
}

export interface BrandAssetsResponse {
  clubId: number
  logo_url: string | null
  favicon_url: string | null
  /** Default `'soft'` on the server; present once brief 79 ships. */
  image_style?: ImageStyle
  /** Hex overrides — present once brief 81 ships. Null = no override. */
  brand_primary?: string | null
  brand_accent?: string | null
}

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

export async function updateBrandAssets(
  clubId: number,
  patch: BrandAssetsPatch,
  opts: { signal?: AbortSignal } = {},
): Promise<BrandAssetsResponse> {
  const res = await authedFetch<Envelope<BrandAssetsResponse>>(
    `${CRM_BASE}/clubs/${clubId}/brand-assets`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
      signal: opts.signal,
    },
  )
  return res.data
}
