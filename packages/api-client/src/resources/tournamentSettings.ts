// Tournament settings — per-club platform-fee + global kill switch.
// Mirrors the venue-settings resource.
//
// Shipped as a sibling to brief 72 (Stripe Connect). `platform_fee_cents`
// is the flat fee Torny collects per entry — read-only here; admin can
// toggle `is_active` to globally pause entry submits on the club's
// tournaments. Separate endpoint from the tournament resource itself
// because the data lives on `club_tournament_settings`, not per-row.

import { VENUE_BASE } from '../config'
import { authedFetch } from '../http'

export interface TournamentSettings {
  /** Torny's cut per entry, in cents. Default 100 ($1). Platform-
   *  controlled — PATCH with this field returns 400 `platform_fee_readonly`. */
  platform_fee_cents: number
  /** Global kill switch for tournament entry submits on this club.
   *  When false, public tournament pages render but Enter is disabled. */
  is_active: boolean
  updated_at: string
}

export interface UpdateTournamentSettingsInput {
  is_active?: boolean
}

export type TournamentSettingsErrorCode =
  | 'platform_fee_readonly'
  | 'bad_body'
  | 'unauthorized'
  | 'forbidden'

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

/** `GET /clubs/:cid/tournament-settings` — lazy-upserts on first read.
 *  Returns the defaults (100¢ fee + is_active=true) for clubs that
 *  haven't customised anything yet. */
export async function get(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<TournamentSettings> {
  const res = await authedFetch<Envelope<TournamentSettings>>(
    `${VENUE_BASE}/clubs/${clubId}/tournament-settings`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

/** `PATCH /clubs/:cid/tournament-settings` — admin+. Only `is_active`
 *  is writable; sending `platform_fee_cents` returns 400. */
export async function update(
  clubId: number,
  input: UpdateTournamentSettingsInput,
  opts: { signal?: AbortSignal } = {},
): Promise<TournamentSettings> {
  const res = await authedFetch<Envelope<TournamentSettings>>(
    `${VENUE_BASE}/clubs/${clubId}/tournament-settings`,
    { method: 'PATCH', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}
