// Site navigation — persist header + footer link trees per club. See
// brief 25. Structural twin of resources/fontPairs.ts / stylePresets.ts.

import { CRM_BASE } from '../config'
import { authedFetch } from '../http'
import type { NavItem } from '../types'

export type { NavItem } from '../types'

/** How the club's identity renders in the public site header. Brief 80. */
export type HeaderDisplay = 'logo' | 'name' | 'both'

export interface UpdateNavigationInput {
  header?: NavItem[] | null
  footer?: NavItem[] | null
  headerSticky?: boolean | null
  /** @deprecated Superseded by `headerDisplay` (brief 80). Still accepted
   *  + echoed for one release so older FE builds keep working. */
  logoInHeader?: boolean | null
  /** Override the name shown in the header. `null` falls back to `clubs.name`.
   *  Max 80 chars; empty/whitespace is rejected (use `null` to clear). */
  headerName?: string | null
  /** 'logo' | 'name' | 'both'. Null is not valid — omit to leave unchanged. */
  headerDisplay?: HeaderDisplay
}

export interface UpdateNavigationResponse {
  clubId: number
  header: NavItem[] | null
  footer: NavItem[] | null
  headerSticky: boolean
  logoInHeader: boolean
  /** Present once brief 80 ships; absent on older backends. */
  headerName?: string | null
  /** Present once brief 80 ships. Falls back to `logoInHeader ? 'logo' : 'name'`. */
  headerDisplay?: HeaderDisplay
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
