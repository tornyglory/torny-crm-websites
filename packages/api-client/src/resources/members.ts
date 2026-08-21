// Club roster + member search — GET /clubs/:clubId/members.
// See docs/backend-briefs/member-search-brief.md for the full contract.
//
// Any authed member of the club can call this endpoint. Substring match
// runs on users.name / email / phone at the DB level. `include_invites`
// controls whether the response's `pending_invites[]` is populated —
// the `members[]` array is unaffected either way.

import { CRM_BASE } from '../config'
import { authedFetch } from '../http'

// ── Types ─────────────────────────────────────────────────────────

export type MemberStatus = 'active' | 'pending' | 'lapsed'
export type MemberRole = 'owner' | 'admin' | 'committee' | 'player'
export type MembershipCadence = 'annual' | 'monthly' | 'season'
export type MembershipTone = 'accent' | 'mint' | 'tangerine' | 'violet'
export type MembershipStatus =
  | 'active'
  | 'inactive'
  | 'suspended'
  | 'expired'
  | 'pending_payment'
export type PaymentStatus =
  | 'paid'
  | 'unpaid'
  | 'partial'
  | 'overdue'
  | 'waived'

export interface RosterMembership {
  membership_id: number | null
  type_id: number | null
  type_name: string | null
  cadence: MembershipCadence | null
  tone: MembershipTone | null
  fee: number | null
  /** Legacy alias for `fee` — prefer `fee` when present. */
  annual_fee: number | null
  status: MembershipStatus | null
  payment_status: PaymentStatus | null
  payment_due_date: string | null
  last_payment_date: string | null
  last_payment_amount: number | null
  /** Sum of all payments recorded during the current season / period. */
  total_paid_this_season: number | null
  /** Amount still owed for the current period — `fee - total_paid_this_season`. */
  balance_owed: number | null
}

export interface RosterMember {
  user_id: number
  name: string
  handle: string | null
  email: string | null
  phone: string | null
  avatar_url: string | null
  member_number: number | null
  club_role: MemberRole
  computed_status: MemberStatus
  /** ISO 8601 UTC — when the club_members row was created. Null for
   *  self-declared / pending rows that never got a club_members row. */
  joined_at: string | null
  /** ISO 8601 UTC — set on lapsed rows, null on active + pending. */
  revoked_at: string | null
  /** Date of birth `YYYY-MM-DD`, from users.dob. */
  dob: string | null
  /** Postal address, from users.address. */
  address: string | null
  /** ISO 8601 UTC — last authenticated request, coalesced to once/min. */
  last_active_at: string | null
  /** Club-specific title (e.g. "Secretary", "Life Member"). */
  title: string | null
  /** Admin-only free-text notes on this member. */
  notes: string | null
  membership: RosterMembership | null
}

export interface RosterCounts {
  total: number
  active: number
  pending: number
  lapsed: number
  pending_invites: number
}

export interface RosterPagination {
  page: number
  limit: number
  total_items: number
  total_pages: number
  has_next_page: boolean
  has_previous_page: boolean
}

export interface RosterFilters {
  status: 'all' | MemberStatus
  role: MemberRole | null
  search: string | null
}

export interface PendingInvite {
  invite_id: number
  email: string | null
  phone: string | null
  invited_name: string | null
  invited_at: string | null
  status: string
}

export interface RosterResponse {
  members: RosterMember[]
  pending_invites: PendingInvite[]
  counts: RosterCounts
  pagination: RosterPagination
  filters: RosterFilters
}

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Query params ──────────────────────────────────────────────────

export interface ListRosterParams {
  search?: string
  /** Server clamps to 200. Use 10 for typeahead. */
  limit?: number
  page?: number
  status?: 'all' | MemberStatus
  role?: MemberRole
  include_invites?: boolean
}

// ── Endpoints ─────────────────────────────────────────────────────

/**
 * GET /clubs/:clubId/members
 *
 * The workhorse for both the Members page and every "pick a member"
 * surface (typeahead, team selector, communications recipients).
 * Substring search on name / email / phone; combines cleanly with
 * `status` and `role` filters.
 */
export async function listRoster(
  clubId: number,
  params: ListRosterParams = {},
  opts: { signal?: AbortSignal } = {},
): Promise<RosterResponse> {
  const qs = new URLSearchParams()
  if (params.search != null && params.search.length > 0) qs.set('search', params.search)
  if (params.limit != null) qs.set('limit', String(params.limit))
  if (params.page != null) qs.set('page', String(params.page))
  if (params.status && params.status !== 'all') qs.set('status', params.status)
  if (params.role) qs.set('role', params.role)
  if (params.include_invites === false) qs.set('include_invites', 'false')

  const url = qs.toString().length > 0
    ? `${CRM_BASE}/clubs/${clubId}/members?${qs.toString()}`
    : `${CRM_BASE}/clubs/${clubId}/members`

  const res = await authedFetch<Envelope<RosterResponse>>(url, {
    method: 'GET',
    signal: opts.signal,
  })
  return res.data
}

// ── Summary + tiers (brief 13 backend response) ───────────────────

export interface SummaryTopTier {
  type_id: number
  type_name: string
  count: number
}

export interface MembersSummary {
  expected_fees: number
  collected: number
  outstanding: number
  collection_rate: number
  counts: {
    total: number
    active: number
    pending: number
    lapsed: number
    pending_invites?: number
  }
  top_tiers: SummaryTopTier[]
  period_start: string | null
  period_end: string | null
  season_id: number | null
}

export interface MembershipTierListItem {
  id: number
  type_name: string
  type_code?: string | null
  slug?: string | null
  cadence: MembershipCadence | null
  fee: number | null
  is_default: boolean
  tone?: MembershipTone | null
}

/** GET /clubs/:clubId/members/summary — server-side finance stats. */
export async function summary(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<MembersSummary> {
  const res = await authedFetch<Envelope<MembersSummary>>(
    `${CRM_BASE}/clubs/${clubId}/members/summary`,
    { signal: opts.signal },
  )
  return res.data
}

/** GET /clubs/:clubId/membership-tiers — the club's active tiers. */
export async function listTiers(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<MembershipTierListItem[]> {
  const res = await authedFetch<Envelope<{ tiers: MembershipTierListItem[] }>>(
    `${CRM_BASE}/clubs/${clubId}/membership-tiers`,
    { signal: opts.signal },
  )
  return res.data.tiers
}

// ── Add / edit / remove (brief 12) ────────────────────────────────

export type AddMemberResolution = 'linked' | 'relinked' | 'invited' | 'stub_created'

export interface AddMemberInput {
  email: string
  first_name?: string
  last_name?: string
  phone?: string
  dob?: string
  role?: 'committee' | 'player'
  title?: string
  membership_type_id?: number
  membership_type?: string
  send_invite?: boolean
}

export interface AddMemberResult {
  resolution: AddMemberResolution
  user_id?: number
  invite_id?: number
  club_id: number
  role: MemberRole
  member_number?: number
  membership_type_id?: number
  accept_url?: string
  expires_in_days?: number
}

export interface UpdateMemberInput {
  role?: 'admin' | 'committee' | 'player'
  title?: string | null
  /** Admin-only free-text notes visible on the roster. Send `null` to clear. */
  notes?: string | null
  type_id?: number | null
}

export interface UpdateMemberResult {
  club_id: number
  user_id: number
  role: MemberRole
  title: string | null
  updated_at: string
  membership: {
    type_id: number | null
    type_name: string | null
    cadence: MembershipCadence | null
    fee: number | null
  } | null
}

export interface RemoveMemberResult {
  club_id: number
  user_id: number
  revoked_at: string
}

export type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'cheque' | 'other' | 'waived'

export interface RecordPaymentInput {
  amount: number
  payment_date?: string
  payment_method?: PaymentMethod
  payment_reference?: string
  notes?: string
}

export interface RecordPaymentResult {
  payment_id: number
  membership_id: number
  club_id: number
  user_id: number
  amount: number
  payment_date: string
  payment_method: PaymentMethod
  payment_reference: string | null
  payment_status: PaymentStatus
}

/** POST /clubs/:clubId/members — add one. Handles link / invite / stub paths. */
export async function add(
  clubId: number,
  input: AddMemberInput,
  opts: { signal?: AbortSignal } = {},
): Promise<AddMemberResult> {
  const res = await authedFetch<Envelope<AddMemberResult>>(`${CRM_BASE}/clubs/${clubId}/members`, {
    method: 'POST',
    body: JSON.stringify(input),
    signal: opts.signal,
  })
  return res.data
}

/** PATCH /clubs/:clubId/members/:userId — change role / title / tier. */
export async function update(
  clubId: number,
  userId: number,
  patch: UpdateMemberInput,
  opts: { signal?: AbortSignal } = {},
): Promise<UpdateMemberResult> {
  const res = await authedFetch<Envelope<UpdateMemberResult>>(
    `${CRM_BASE}/clubs/${clubId}/members/${userId}`,
    { method: 'PATCH', body: JSON.stringify(patch), signal: opts.signal },
  )
  return res.data
}

/** DELETE /clubs/:clubId/members/:userId — soft-remove. */
export async function remove(
  clubId: number,
  userId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<RemoveMemberResult> {
  const res = await authedFetch<Envelope<RemoveMemberResult>>(
    `${CRM_BASE}/clubs/${clubId}/members/${userId}`,
    { method: 'DELETE', signal: opts.signal },
  )
  return res.data
}

/** POST /clubs/:clubId/members/:userId/payments — record a manual payment or waive fees. */
export async function recordPayment(
  clubId: number,
  userId: number,
  input: RecordPaymentInput,
  opts: { signal?: AbortSignal } = {},
): Promise<RecordPaymentResult> {
  const res = await authedFetch<Envelope<RecordPaymentResult>>(
    `${CRM_BASE}/clubs/${clubId}/members/${userId}/payments`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

// ── Rendering helpers ─────────────────────────────────────────────

const CADENCE_SUFFIX: Record<MembershipCadence, string> = {
  annual: '/ year',
  monthly: '/ month',
  season: '/ season',
}

/**
 * Render the fee as a display string. Legacy memberships (imported
 * before the onboarding wizard) have no cadence — show the raw dollar
 * amount without a suffix rather than guess.
 */
export function formatMembershipFee(m: RosterMembership | null | undefined): string {
  if (!m || m.fee == null) return ''
  const suffix = m.cadence ? CADENCE_SUFFIX[m.cadence] : ''
  return suffix ? `$${m.fee} ${suffix}` : `$${m.fee}`
}
