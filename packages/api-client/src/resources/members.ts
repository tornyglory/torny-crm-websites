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
