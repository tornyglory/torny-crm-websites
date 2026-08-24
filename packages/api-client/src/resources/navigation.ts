// Site navigation — persist header + footer link trees per club. See
// brief 25. Structural twin of resources/fontPairs.ts / stylePresets.ts.

import { CRM_BASE } from '../config'
import { authedFetch } from '../http'
import type { NavItem } from '../types'

export type { NavItem } from '../types'

export interface UpdateNavigationInput {
  header?: NavItem[] | null
  footer?: NavItem[] | null
}

export interface UpdateNavigationResponse {
  clubId: number
  header: NavItem[] | null
  footer: NavItem[] | null
}

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

/**
 * PATCH /clubs/:clubId/navigation — set or clear the club's nav trees.
 * Missing keys leave the stored value alone; `null` clears the field
 * (frontend falls back to platform defaults). Backend fires the Nuxt
 * revalidate webhook so the public site rerenders.
 */
export async function updateForClub(
  clubId: number,
  input: UpdateNavigationInput,
  opts: { signal?: AbortSignal } = {},
): Promise<UpdateNavigationResponse> {
  const res = await authedFetch<Envelope<UpdateNavigationResponse>>(
    `${CRM_BASE}/clubs/${clubId}/navigation`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
      signal: opts.signal,
    },
  )
  return res.data
}
