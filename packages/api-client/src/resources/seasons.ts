// Club seasons — GET / POST / set-current under /clubs/:clubId/seasons.
// See docs/backend-briefs/frontend-club-members-list-brief.md §Companion
// endpoints for the full contract.
//
// Any authed club member can read the list. Create + set-current require
// owner or admin role — the server enforces; the client just hides the
// affordances for non-admins.

import { CRM_BASE } from '../config'
import { authedFetch } from '../http'

export interface Season {
  season_id: number
  season_name: string
  /** YYYY-MM-DD */
  start_date: string
  /** YYYY-MM-DD */
  end_date: string
  default_fee: number | null
  is_current_season: boolean
  is_active: boolean
  description: string | null
}

export interface CreateSeasonInput {
  season_name: string
  /** YYYY-MM-DD */
  start_date: string
  /** YYYY-MM-DD */
  end_date: string
  default_fee?: number
  description?: string
  /** Defaults to `true` on the server — the club's next-billing season. */
  set_current?: boolean
}

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

/** GET /clubs/:clubId/seasons — list of every season on the club. */
export async function list(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<Season[]> {
  const res = await authedFetch<Envelope<{ seasons: Season[] }>>(
    `${CRM_BASE}/clubs/${clubId}/seasons`,
    { signal: opts.signal },
  )
  return res.data.seasons
}

/** POST /clubs/:clubId/seasons — owner/admin only. */
export async function create(
  clubId: number,
  input: CreateSeasonInput,
  opts: { signal?: AbortSignal } = {},
): Promise<Season> {
  const res = await authedFetch<Envelope<Season>>(
    `${CRM_BASE}/clubs/${clubId}/seasons`,
    {
      method: 'POST',
      body: JSON.stringify(input),
      signal: opts.signal,
    },
  )
  return res.data
}

/** POST /clubs/:clubId/seasons/:seasonId/set-current — owner/admin only. */
export async function setCurrent(
  clubId: number,
  seasonId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<Season> {
  const res = await authedFetch<Envelope<Season>>(
    `${CRM_BASE}/clubs/${clubId}/seasons/${seasonId}/set-current`,
    {
      method: 'POST',
      body: '{}',
      signal: opts.signal,
    },
  )
  return res.data
}
