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
// no-ops, `null` clears, string sets. At least one of `logo_url` /
// `favicon_url` must be present in the body.

export interface BrandAssetsPatch {
  logo_url?: string | null
  favicon_url?: string | null
}

export interface BrandAssetsResponse {
  clubId: number
  logo_url: string | null
  favicon_url: string | null
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
