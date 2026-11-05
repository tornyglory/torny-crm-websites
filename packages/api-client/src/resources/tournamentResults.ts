// Tournament results — sport-flexibility brief Layer 3.
//
// Admin records final standings as a batch upsert over the whole
// entries table. Each row carries: position (1-indexed), freeform
// placement label, prize money, a `won` flag (tick the top 3), notes.
// Public leaderboard filters to `position IS NOT NULL OR won=1` and
// sorts by position ASC.
//
// Role gates: GET committee+; POST admin+.

import { VENUE_BASE } from '../config'
import { authedFetch, publicFetch } from '../http'

// ── Domain types ─────────────────────────────────────────────────

export interface TournamentResult {
  id: number
  position: number | null
  placement_label: string | null
  prize_money_cents: number
  won: boolean
  notes: string | null
  recorded_at: string
  recorded_by_user_id: number
  updated_at: string
}

/** Each row in the admin results table + public leaderboard payload.
 *  Joins the entry's identity fields to the result row so the FE can
 *  render one table without a second fetch. `result: null` on unplaced
 *  entries so the admin screen shows a "No result yet" row. */
export interface TournamentResultEntry {
  entry_id: number
  entry_number: number
  team_name: string | null
  captain_user_id: number | null
  captain_email: string | null
  captain_phone: string | null
  entry_status: 'pending' | 'confirmed' | 'waitlisted' | 'withdrawn' | 'refunded'
  result: TournamentResult | null
}

export interface TournamentResultsResponse {
  /** Nullable until the tournament has at least one result row written —
   *  the backend omits these top-level fields on a fresh GET before
   *  anything has been recorded. FE should guard on null. */
  tournament_id: number | null
  tournament_status: string | null
  entries: TournamentResultEntry[]
}

/** POST payload — one row per entry you want to upsert. Omit entries
 *  to leave their current result unchanged; send a row with all-null
 *  fields to clear a previously-set result. */
export interface TournamentResultInput {
  entry_id: number
  position?: number | null
  placement_label?: string | null
  prize_money_cents?: number
  won?: boolean
  notes?: string | null
}

export interface SubmitResultsInput {
  results: TournamentResultInput[]
  /** When true, flips `tournament.status` to `complete` atomically
   *  with the result upsert. The admin UI's "Mark tournament complete"
   *  checkbox at the bottom of the results editor sets this. */
  mark_complete?: boolean
}

export type TournamentResultErrorCode =
  | 'bad_results'
  | 'bad_entry_id'
  | 'dup_entry'
  | 'bad_position'
  | 'bad_label'
  | 'bad_prize'
  | 'bad_notes'
  | 'forbidden'
  | 'not_found'

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Admin endpoints ─────────────────────────────────────────────

/** `GET /clubs/:cid/tournaments/:tid/results` — full entries list with
 *  joined result rows (or null for unplaced). */
export async function get(
  clubId: number,
  tournamentId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<TournamentResultsResponse> {
  const res = await authedFetch<Envelope<TournamentResultsResponse>>(
    `${VENUE_BASE}/clubs/${clubId}/tournaments/${tournamentId}/results`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

/** `POST /clubs/:cid/tournaments/:tid/results` — batch upsert.
 *  Returns the fully-hydrated results list after the write so the
 *  admin UI can refresh in one round-trip. */
export async function submit(
  clubId: number,
  tournamentId: number,
  input: SubmitResultsInput,
  opts: { signal?: AbortSignal } = {},
): Promise<TournamentResultsResponse> {
  const res = await authedFetch<Envelope<TournamentResultsResponse>>(
    `${VENUE_BASE}/clubs/${clubId}/tournaments/${tournamentId}/results`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

// ── Public read ─────────────────────────────────────────────────

/** `GET /public/tournaments/:tid/results` — no auth. Server filters to
 *  rows with `position IS NOT NULL OR won=1` and sorts by `position`
 *  ascending, then `won` descending. */
export async function getPublic(
  tournamentId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<TournamentResultsResponse> {
  const res = await publicFetch<Envelope<TournamentResultsResponse>>(
    `${VENUE_BASE}/public/tournaments/${tournamentId}/results`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}
