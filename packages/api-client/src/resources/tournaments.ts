// Tournaments — backend brief 47 (Phase 1 shipped 2026-08-28) + brief 48
// (cover + gallery, shipped 2026-08-29).
//
// Clubs create tournaments in the CRM, publish them, take entries + manage
// payments manually. Draws + results are brief 48 (draws-and-results, still
// on the roadmap — not implemented here).

import { CRM_BASE } from '../config'
import { authedFetch, publicFetch } from '../http'

// ── Domain types ─────────────────────────────────────────────────

export type TournamentFormat = 'singles' | 'pairs' | 'triples' | 'fours'
export type TournamentCategory =
  | 'open'
  | 'restricted'
  | 'championship'
  | 'junior'
  | 'veterans'
  | 'social'
export type TournamentGenderScope = 'mens' | 'womens' | 'mixed' | null
export type TournamentStatus =
  | 'draft'
  | 'published'
  | 'entries_closed'
  | 'in_progress'
  | 'complete'
  | 'cancelled'
export type TournamentPaymentMethod = 'online' | 'on_the_day' | 'club_transfer'
export type TournamentEntryUnit = 'team' | 'player'

export type EntryStatus =
  | 'pending'
  | 'confirmed'
  | 'waitlisted'
  | 'withdrawn'
  | 'refunded'

export interface TournamentStats {
  confirmed_count: number
  pending_count: number
  waitlist_count: number
  spots_remaining: number
  withdrawn_count?: number
  refunded_count?: number
  revenue_paid_cents?: number
  revenue_pending_cents?: number
}

export interface EntryCaptain {
  user_id: number | null
  name: string | null
  email: string
  phone: string | null
  handle: string | null
  club_id: number | null
  club_name: string | null
  avatar_url: string | null
}

export interface TournamentRosterMember {
  position: string
  user_id: number | null
  name: string | null
  bcnz_number: string | null
}

export interface TournamentEntry {
  id: number
  entry_number: number
  team_name: string | null
  captain: EntryCaptain
  paid_cents: number
  paid_at: string | null
  payment_reference: string | null
  refunded_cents: number
  refunded_at: string | null
  status: EntryStatus
  waitlist_position: number | null
  withdrew_at: string | null
  withdrew_reason: string | null
  roster: TournamentRosterMember[]
  roster_locked_at: string | null
  admin_notes: string | null
  created_at: string
  updated_at: string
}

export interface Tournament {
  id: number
  club_id: number
  slug: string
  title: string
  subtitle: string | null
  description: string | null
  format: TournamentFormat
  category: TournamentCategory
  gender_scope: TournamentGenderScope
  starts_at: string | null
  ends_at: string | null
  entries_open_at: string | null
  entries_close_at: string | null
  draw_published_at: string | null
  entry_unit: TournamentEntryUnit
  entry_cap: number
  waitlist_enabled: boolean
  waitlist_cap: number | null
  entry_fee_cents: number
  currency: string
  prize_pool_cents: number | null
  prize_notes: string | null
  payment_method: TournamentPaymentMethod
  open_to_visitors: boolean
  requires_bcnz: boolean
  min_age: number | null
  max_age: number | null
  status: TournamentStatus
  is_public: boolean
  featured_until: string | null
  cover_image_url: string | null
  gallery_urls: string[]
  sanctioned_by: string | null
  sanction_url: string | null
  created_at: string
  created_by: number | null
  updated_at: string
  stats: TournamentStats
  recent_entries?: TournamentEntry[]
}

export interface TournamentListItem {
  id: number
  slug: string
  title: string
  format: TournamentFormat
  category: TournamentCategory
  starts_at: string | null
  entries_close_at: string | null
  entry_cap: number
  entry_fee_cents: number
  status: TournamentStatus
  cover_image_url: string | null
  gallery_urls: string[]
  stats: TournamentStats
}

/** Per-status row count returned on the CRM list — powers status tabs. */
export interface TournamentStatusCounts {
  draft: number
  published: number
  entries_closed: number
  in_progress: number
  complete: number
  cancelled: number
}

/** Backend pagination — offset/limit style, matches Phase 1 spec. */
export interface OffsetPagination {
  limit: number
  offset: number
  total: number
}

export interface TournamentsListResponse {
  tournaments: TournamentListItem[]
  counts: TournamentStatusCounts
  pagination: OffsetPagination
}

export interface EntriesListResponse {
  entries: TournamentEntry[]
  pagination: OffsetPagination
}

// ── Public discovery types ─────────────────────────────────────

export interface PublicTournamentClub {
  id: number
  name: string
  slug: string
  region: string | null
  suburb: string | null
}

export interface PublicTournamentCard {
  id: number
  slug: string
  title: string
  subtitle: string | null
  format: TournamentFormat
  category: TournamentCategory
  gender_scope: TournamentGenderScope
  starts_at: string | null
  ends_at: string | null
  entries_close_at: string | null
  entry_cap: number
  entry_fee_cents: number
  currency: string
  prize_pool_cents: number | null
  cover_image_url: string | null
  gallery_urls: string[]
  featured_until: string | null
  sanctioned_by: string | null
  club: PublicTournamentClub
  stats: TournamentStats
}

export interface PublicTournamentDetail extends PublicTournamentCard {
  description: string | null
  prize_notes: string | null
  waitlist_enabled: boolean
  waitlist_cap: number | null
  open_to_visitors: boolean
  requires_bcnz: boolean
  min_age: number | null
  max_age: number | null
  payment_method: TournamentPaymentMethod
  sanction_url: string | null
  entry_unit: TournamentEntryUnit
  entries_open_at: string | null
}

export interface PublicTournamentsListResponse {
  tournaments: PublicTournamentCard[]
  pagination: {
    page: number
    limit: number
    total_items: number
    total_pages: number
  }
}

// ── Inputs ─────────────────────────────────────────────────────

export type CreateTournamentInput = Pick<
  Tournament,
  'title' | 'format' | 'entry_cap'
> &
  Partial<
    Pick<
      Tournament,
      | 'subtitle'
      | 'description'
      | 'category'
      | 'gender_scope'
      | 'starts_at'
      | 'ends_at'
      | 'entries_open_at'
      | 'entries_close_at'
      | 'entry_unit'
      | 'entry_fee_cents'
      | 'currency'
      | 'prize_pool_cents'
      | 'prize_notes'
      | 'payment_method'
      | 'waitlist_enabled'
      | 'waitlist_cap'
      | 'open_to_visitors'
      | 'requires_bcnz'
      | 'min_age'
      | 'max_age'
      | 'is_public'
      | 'featured_until'
      | 'cover_image_url'
      | 'gallery_urls'
      | 'sanctioned_by'
      | 'sanction_url'
    >
  >

export type UpdateTournamentInput = Partial<CreateTournamentInput>

/**
 * Whitelist for `PATCH /entries/{eid}` — must match backend brief 47 §9.
 * `status` is intentionally narrowed: promote/withdraw/refund transitions
 * go through their dedicated endpoints.
 */
export interface UpdateEntryInput {
  paid_cents?: number
  paid_at?: string | null
  payment_reference?: string | null
  refunded_cents?: number
  admin_notes?: string
  team_name?: string | null
  status?: 'pending' | 'confirmed' | 'withdrawn'
  roster?: TournamentRosterMember[]
}

export interface EnterTournamentInput {
  team_name?: string | null
  roster: Array<{
    position: string
    user_id?: number | null
    name?: string | null
    bcnz_number?: string | null
  }>
  captain_contact?: {
    email: string
    phone?: string | null
  }
}

export interface EnterTournamentResult {
  entry: TournamentEntry
  next_step: 'pay' | 'wait_confirmation' | 'done'
  waitlist_position: number | null
}

export interface WithdrawEntryInput {
  reason?: string
}

export interface ListTournamentsParams {
  status?: TournamentStatus
  /** Case-insensitive substring match on `title`. */
  q?: string
  /** ISO date — `starts_at >= starts_after`. Unparseable values ignored. */
  starts_after?: string
  /** ISO date — `starts_at <= starts_before`. Unparseable values ignored. */
  starts_before?: string
  limit?: number
  offset?: number
}

export interface ListEntriesParams {
  status?: EntryStatus
  search?: string
  limit?: number
  offset?: number
}

export type PublicSort =
  | 'entries_close_asc'
  | 'starts_asc'
  | 'prize_desc'
  | 'featured_first'

export interface PublicListTournamentsParams {
  format?: TournamentFormat
  category?: TournamentCategory
  gender?: 'mens' | 'womens' | 'mixed'
  region?: string
  starts_after?: string
  starts_before?: string
  entry_fee_max?: number
  open_only?: boolean
  q?: string
  sort?: PublicSort
  page?: number
  limit?: number
}

export type TournamentErrorCode =
  | 'missing_field'
  | 'bad_format'
  | 'bad_dates'
  | 'bad_capacity'
  | 'bad_fee'
  | 'bad_gallery'
  | 'bad_image_url'
  | 'bad_transition'
  | 'entries_closed'
  | 'bad_roster_size'
  | 'bad_position'
  | 'bcnz_required'
  | 'visitor_not_allowed'
  | 'duplicate_entry'
  | 'waitlist_full'
  | 'bad_email'
  | 'payment_required'
  | 'not_found'

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

function buildQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue
    if (typeof value === 'boolean') qs.set(key, value ? 'true' : 'false')
    else qs.set(key, String(value))
  }
  const s = qs.toString()
  return s.length > 0 ? `?${s}` : ''
}

// ── CRM endpoints ───────────────────────────────────────────────

export async function list(
  clubId: number,
  params: ListTournamentsParams = {},
  opts: { signal?: AbortSignal } = {},
): Promise<TournamentsListResponse> {
  const suffix = buildQuery({
    status: params.status,
    q: params.q,
    starts_after: params.starts_after,
    starts_before: params.starts_before,
    limit: params.limit,
    offset: params.offset,
  })
  const res = await authedFetch<Envelope<TournamentsListResponse>>(
    `${CRM_BASE}/clubs/${clubId}/tournaments${suffix}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

export async function get(
  clubId: number,
  tournamentId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<Tournament> {
  const res = await authedFetch<Envelope<Tournament>>(
    `${CRM_BASE}/clubs/${clubId}/tournaments/${tournamentId}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

export async function create(
  clubId: number,
  input: CreateTournamentInput,
  opts: { signal?: AbortSignal } = {},
): Promise<Tournament> {
  const res = await authedFetch<Envelope<Tournament>>(
    `${CRM_BASE}/clubs/${clubId}/tournaments`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

export async function update(
  clubId: number,
  tournamentId: number,
  patch: UpdateTournamentInput,
  opts: { signal?: AbortSignal } = {},
): Promise<Tournament> {
  const res = await authedFetch<Envelope<Tournament>>(
    `${CRM_BASE}/clubs/${clubId}/tournaments/${tournamentId}`,
    { method: 'PATCH', body: JSON.stringify(patch), signal: opts.signal },
  )
  return res.data
}

export async function publish(
  clubId: number,
  tournamentId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<Tournament> {
  const res = await authedFetch<Envelope<Tournament>>(
    `${CRM_BASE}/clubs/${clubId}/tournaments/${tournamentId}/publish`,
    { method: 'POST', signal: opts.signal },
  )
  return res.data
}

/** Manually stop entries early — published → entries_closed. */
export async function closeEntries(
  clubId: number,
  tournamentId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<Tournament> {
  const res = await authedFetch<Envelope<Tournament>>(
    `${CRM_BASE}/clubs/${clubId}/tournaments/${tournamentId}/close-entries`,
    { method: 'POST', signal: opts.signal },
  )
  return res.data
}

export async function cancel(
  clubId: number,
  tournamentId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<Tournament> {
  const res = await authedFetch<Envelope<Tournament>>(
    `${CRM_BASE}/clubs/${clubId}/tournaments/${tournamentId}/cancel`,
    { method: 'POST', signal: opts.signal },
  )
  return res.data
}

/** Draft-only. 204 on success. Backend rejects live tournaments. */
export async function remove(
  clubId: number,
  tournamentId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  await authedFetch<void>(
    `${CRM_BASE}/clubs/${clubId}/tournaments/${tournamentId}`,
    { method: 'DELETE', signal: opts.signal },
  )
}

export async function listEntries(
  clubId: number,
  tournamentId: number,
  params: ListEntriesParams = {},
  opts: { signal?: AbortSignal } = {},
): Promise<EntriesListResponse> {
  const suffix = buildQuery({
    status: params.status,
    search: params.search,
    limit: params.limit,
    offset: params.offset,
  })
  const res = await authedFetch<Envelope<EntriesListResponse>>(
    `${CRM_BASE}/clubs/${clubId}/tournaments/${tournamentId}/entries${suffix}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

export async function updateEntry(
  clubId: number,
  tournamentId: number,
  entryId: number,
  patch: UpdateEntryInput,
  opts: { signal?: AbortSignal } = {},
): Promise<TournamentEntry> {
  const res = await authedFetch<Envelope<TournamentEntry>>(
    `${CRM_BASE}/clubs/${clubId}/tournaments/${tournamentId}/entries/${entryId}`,
    { method: 'PATCH', body: JSON.stringify(patch), signal: opts.signal },
  )
  return res.data
}

export async function promoteEntry(
  clubId: number,
  tournamentId: number,
  entryId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<TournamentEntry> {
  const res = await authedFetch<Envelope<TournamentEntry>>(
    `${CRM_BASE}/clubs/${clubId}/tournaments/${tournamentId}/entries/${entryId}/promote`,
    { method: 'POST', signal: opts.signal },
  )
  return res.data
}

export async function withdrawEntry(
  clubId: number,
  tournamentId: number,
  entryId: number,
  input: WithdrawEntryInput = {},
  opts: { signal?: AbortSignal } = {},
): Promise<TournamentEntry> {
  const res = await authedFetch<Envelope<TournamentEntry>>(
    `${CRM_BASE}/clubs/${clubId}/tournaments/${tournamentId}/entries/${entryId}/withdraw`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

// ── Entrant + public endpoints ──────────────────────────────────

/**
 * Submit an entry. Auth optional — guests can enter open-to-visitors
 * tournaments by passing `captain_contact.email`.
 */
export async function enter(
  tournamentId: number,
  input: EnterTournamentInput,
  opts: { signal?: AbortSignal } = {},
): Promise<EnterTournamentResult> {
  const res = await authedFetch<Envelope<EnterTournamentResult>>(
    `${CRM_BASE}/tournaments/${tournamentId}/enter`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

export async function publicList(
  params: PublicListTournamentsParams = {},
  opts: { signal?: AbortSignal } = {},
): Promise<PublicTournamentsListResponse> {
  const suffix = buildQuery({
    format: params.format,
    category: params.category,
    gender: params.gender,
    region: params.region,
    starts_after: params.starts_after,
    starts_before: params.starts_before,
    entry_fee_max: params.entry_fee_max,
    open_only: params.open_only,
    q: params.q,
    sort: params.sort,
    page: params.page,
    limit: params.limit,
  })
  const res = await publicFetch<Envelope<PublicTournamentsListResponse>>(
    `${CRM_BASE}/public/tournaments${suffix}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

export async function publicGet(
  clubSlug: string,
  tournamentSlug: string,
  opts: { signal?: AbortSignal } = {},
): Promise<PublicTournamentDetail> {
  const res = await publicFetch<Envelope<PublicTournamentDetail>>(
    `${CRM_BASE}/public/tournaments/${encodeURIComponent(clubSlug)}/${encodeURIComponent(tournamentSlug)}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}
