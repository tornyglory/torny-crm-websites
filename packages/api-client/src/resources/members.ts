// Club roster + member search — GET /clubs/:clubId/members.
// See docs/backend-briefs/member-search-brief.md for the full contract.
//
// Any authed member of the club can call this endpoint. Substring match
// runs on users.name / email / phone at the DB level. `include_invites`
// controls whether the response's `pending_invites[]` is populated —
// the `members[]` array is unaffected either way.

import { CRM_BASE } from '../config'
import { authedFetch, publicFetch } from '../http'

// ── Types ─────────────────────────────────────────────────────────

export type MemberStatus = 'active' | 'prospect' | 'visitor' | 'pending' | 'lapsed'

/** The stored type on `club_members.member_status` (brief 56). This is
 *  the field the admin sets when adding someone to the roster; the pill
 *  colour on the UI should read `computed_status` which already folds
 *  this + membership state into one value. Default on existing rows is
 *  `'member'` (backfilled by the migration). */
export type MemberType = 'member' | 'prospect' | 'visitor'

/** How this member was first attached to the club — set by the backend on
 *  insert so the roster + Member Detail page can show provenance (brief 56
 *  §4a). `'enquiry'` + `'application'` carry a `source_ref_id` pointing at
 *  the originating row; `'manual'` + `'import'` leave it null. */
export type MemberSource = 'enquiry' | 'application' | 'manual' | 'import'
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
  /** Human-readable slug — e.g. `student-member`. Regenerated when the tier
   *  is renamed. Use for URL params, filter chips, and admin deep links. */
  type_slug: string | null
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
  /** Stored roster type — the admin-chosen label. `'member'` for paying
   *  (or paying-eligible) members; `'prospect'` + `'visitor'` are
   *  non-paying rows with no `club_memberships` row attached. Optional
   *  until the backend backfill reaches every row — missing is treated as
   *  `'member'` by the UI. */
  member_status?: MemberType
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
  /** Public directory grouping — drives the meet-the-club block (brief 35). */
  position_group: PositionGroup
  /** When false, the member is hidden from the public directory + player profile. */
  public_visible: boolean
  /** Member-authored bio shown on the public player profile. */
  bio: string | null
  /** Preferred bowls position. May be null on legacy roster rows that
   *  haven't been touched since the field was added. */
  preferred_position: PreferredPosition | null
  /** Club-assigned playing grade. Null for members who haven't been
   *  graded or play social-only. */
  playing_level: PlayingLevel | null
  membership: RosterMembership | null
  /** Provenance — how this row was first attached to the club (brief 56
   *  §4a). Optional until the backend backfill ships; pre-brief rows are
   *  treated as `'manual'` by the UI. */
  source?: MemberSource
  /** Enquiry / application id this member was converted from, when
   *  `source` is `'enquiry'` or `'application'`. Null otherwise. */
  source_ref_id?: number | null
}

export interface RosterCounts {
  total: number
  active: number
  pending: number
  lapsed: number
  pending_invites: number
  /** Non-paying roster rows added as leads (brief 56). */
  prospect?: number
  /** Non-paying roster rows added as casual guest players (brief 56). */
  visitor?: number
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

/** Membership-type filter: a single id, a list, the sentinel `'none'` for
 *  members with no active membership, or a mix. Serialised as a comma-list. */
export type MembershipTypeFilter = number | 'none' | Array<number | 'none'>
export type MembershipSlugFilter = string | Array<string>

export interface ListRosterParams {
  search?: string
  /** Server clamps to 200. Use 10 for typeahead. */
  limit?: number
  page?: number
  status?: 'all' | MemberStatus
  role?: MemberRole
  include_invites?: boolean
  /** Filter by tier id(s). Pass `'none'` (or include it in a list) to
   *  match members with no active membership row. */
  membership_type_id?: MembershipTypeFilter
  /** Same as `membership_type_id` but by slug (e.g. `student-member`).
   *  Both filters union when combined. */
  membership_type_slug?: MembershipSlugFilter
}

function serialiseFilter(value: MembershipTypeFilter | MembershipSlugFilter): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(',')
  return String(value)
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
  if (params.membership_type_id != null) {
    const v = serialiseFilter(params.membership_type_id)
    if (v.length > 0) qs.set('membership_type_id', v)
  }
  if (params.membership_type_slug != null) {
    const v = serialiseFilter(params.membership_type_slug)
    if (v.length > 0) qs.set('membership_type_slug', v)
  }

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
    /** Prospect members — brief 56. Optional until the backend ships. */
    prospect?: number
  }
  top_tiers: SummaryTopTier[]
  period_start: string | null
  period_end: string | null
  season_id: number | null
  /** Human-readable season label — populated when the server can attach the row. */
  season_name?: string | null
  /** True when the selected season is the club's active current season. */
  is_current_season?: boolean
}

export interface MembershipTierListItem {
  id: number
  type_name: string
  type_code: string | null
  slug: string | null
  description: string | null
  cadence: MembershipCadence | null
  fee: number | null
  tone: string | null
  sort_order: number
  is_default: boolean
}

/** Club-level membership settings — cadence default + first-year discount toggle
 *  + applications intake controls (brief 38). */
export interface MembershipSettings {
  cadence: MembershipCadence | null
  first_year_discount: boolean
  /** When false the public join-form POST returns 503 `applications_closed`. */
  applications_open?: boolean
  /** Address that gets the "new application" notification email. Null = fall back to owner. */
  application_notification_email?: string | null
}

/** Envelope for GET /membership-tiers — brief 36 extended shape. */
export interface MembershipTiersResponse {
  tiers: MembershipTierListItem[]
  settings: MembershipSettings
}

export interface CreateTierInput {
  type_name: string
  type_code?: string
  description?: string | null
  cadence?: MembershipCadence
  fee?: number | null
  tone?: string | null
  sort_order?: number
  is_default?: boolean
}
export type UpdateTierInput = Partial<CreateTierInput>

export type MembershipTierErrorCode =
  | 'bad_type_name'
  | 'bad_cadence'
  | 'bad_fee'
  | 'bad_description'
  | 'bad_sort_order'
  | 'slug_conflict'
  | 'default_required'
  | 'default_tier'
  | 'last_tier'
  | 'tier_in_use'
  | 'not_found'

/**
 * GET /clubs/:clubId/members/summary — server-side finance stats.
 *
 * When `season_id` is omitted the server returns the club's current season.
 * Pass an explicit id (e.g. from `seasons.list`) to view a past season's
 * numbers without changing which season is "current".
 */
export async function summary(
  clubId: number,
  opts: { season_id?: number; signal?: AbortSignal } = {},
): Promise<MembersSummary> {
  const qs = opts.season_id != null ? `?season_id=${opts.season_id}` : ''
  const res = await authedFetch<Envelope<MembersSummary>>(
    `${CRM_BASE}/clubs/${clubId}/members/summary${qs}`,
    { signal: opts.signal },
  )
  return res.data
}

/**
 * GET /clubs/:clubId/membership-tiers — tiers + club-level settings.
 * Envelope shape extended in brief 36 (adds `settings` block + per-tier
 * `sort_order` / `description` / `tone`).
 */
export async function listTiers(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<MembershipTiersResponse> {
  const res = await authedFetch<Envelope<MembershipTiersResponse>>(
    `${CRM_BASE}/clubs/${clubId}/membership-tiers`,
    { signal: opts.signal },
  )
  return res.data
}

/** POST /clubs/:clubId/membership-tiers — create a tier. */
export async function createTier(
  clubId: number,
  input: CreateTierInput,
  opts: { signal?: AbortSignal } = {},
): Promise<MembershipTierListItem> {
  const res = await authedFetch<Envelope<MembershipTierListItem>>(
    `${CRM_BASE}/clubs/${clubId}/membership-tiers`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

/** PATCH /clubs/:clubId/membership-tiers/:tierId — partial update. */
export async function updateTier(
  clubId: number,
  tierId: number,
  patch: UpdateTierInput,
  opts: { signal?: AbortSignal } = {},
): Promise<MembershipTierListItem> {
  const res = await authedFetch<Envelope<MembershipTierListItem>>(
    `${CRM_BASE}/clubs/${clubId}/membership-tiers/${tierId}`,
    { method: 'PATCH', body: JSON.stringify(patch), signal: opts.signal },
  )
  return res.data
}

/** DELETE /clubs/:clubId/membership-tiers/:tierId — hard delete (guarded). */
export async function deleteTier(
  clubId: number,
  tierId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  await authedFetch(
    `${CRM_BASE}/clubs/${clubId}/membership-tiers/${tierId}`,
    { method: 'DELETE', signal: opts.signal },
  )
}

/** POST /clubs/:clubId/membership-tiers/:tierId/set-default — atomic flip. */
export async function setDefaultTier(
  clubId: number,
  tierId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<MembershipTierListItem> {
  const res = await authedFetch<Envelope<MembershipTierListItem>>(
    `${CRM_BASE}/clubs/${clubId}/membership-tiers/${tierId}/set-default`,
    { method: 'POST', body: '{}', signal: opts.signal },
  )
  return res.data
}

/** PATCH /clubs/:clubId/membership-settings — club-level cadence + discount. */
export async function updateMembershipSettings(
  clubId: number,
  patch: Partial<MembershipSettings>,
  opts: { signal?: AbortSignal } = {},
): Promise<MembershipSettings> {
  const res = await authedFetch<Envelope<MembershipSettings>>(
    `${CRM_BASE}/clubs/${clubId}/membership-settings`,
    { method: 'PATCH', body: JSON.stringify(patch), signal: opts.signal },
  )
  return res.data
}

// ── Add / edit / remove (brief 12) ────────────────────────────────

export type AddMemberResolution = 'linked' | 'relinked' | 'invited' | 'stub_created'

export interface AddMemberInput {
  email: string
  first_name?: string
  last_name?: string
  phone?: string
  /** `YYYY-MM-DD` only. Malformed values → 400 `invalid_dob`. Omitted leaves it null. */
  dob?: string
  role?: 'committee' | 'player'
  title?: string
  membership_type_id?: number
  membership_type?: string
  send_invite?: boolean
  /** Roster type (brief 56). Omit or pass `'member'` to run the normal
   *  tier + invite path. `'prospect'` / `'visitor'` tell the server to
   *  skip tier resolution + skip the invite email — any tier fields are
   *  silently ignored, `send_invite` is forced to false. */
  member_status?: MemberType
}

/** Error codes POST /clubs/:clubId/members can return. */
export type AddMemberErrorCode =
  | 'invalid_email'
  | 'invalid_dob'
  | 'invalid_role'
  | 'invalid_title'
  | 'unknown_type'
  | 'email_in_use'
  | 'invalid_member_status'

export interface AddMemberResult {
  resolution: AddMemberResolution
  user_id?: number
  invite_id?: number
  club_id: number
  role: MemberRole
  /** Not allocated for `prospect`/`visitor` on first add — the backend
   *  waits until the row flips to `'member'` with a tier (brief 56 §9). */
  member_number?: number
  membership_type_id?: number
  /** Echoed from input so the CRM doesn't have to re-GET to render the
   *  pill. Null-safe: missing on legacy rows. */
  member_status?: MemberType
  accept_url?: string
  expires_in_days?: number
}

// `UpdateMemberInput` + `UpdateMemberResult` were the pre-brief-35 shapes
// (role / title / notes / type_id only). They've been superseded by the
// `UpdateMemberPatch` / `UpdateMemberResponse` pair further down, which
// covers the full 12-field Member Detail form (identity + roster + billing).
// Nothing in the app calls them any more.

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
  /** Which season the payment attaches to. Omit → server attributes to the
   *  club's current season (brief 55). Pass an explicit id to back-date into
   *  a past season or pre-pay into a future one. */
  season_id?: number
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
  /** Season the server actually attached this payment to — echoed so the
   *  CRM can refresh the right summary panel. Null during the brief 55
   *  transition if the server hasn't shipped season attribution yet. */
  season_id?: number | null
  season_name?: string | null
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

// `update()` → see `patchMember()` further down. Removed to force callers
// onto the full-shape endpoint.

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

// ── Public — meet-the-club directory + player profile (brief 35) ──

/** Position group for the public directory — separate from `MemberRole`. */
export type PositionGroup = 'board' | 'staff' | 'committee' | 'member'

export interface PublicMember {
  user_id: number
  full_name: string
  avatar_url: string | null
  position_group: PositionGroup
  title: string | null
  joined_year: number | null
  trophies_count: number
  initials: string
}

export interface PublicMembersResponse {
  members: PublicMember[]
  total: number
}

export interface PublicListMembersParams {
  /** Filter to one group. `committee` includes Board (subset). Omit for all. */
  position?: PositionGroup
  search?: string
  limit?: number
  offset?: number
  /** `default` = Board → Staff → Committee → Member, alpha within each. */
  sort?: 'default' | 'alpha'
}

export interface PublicPlayerProfile {
  user_id: number
  full_name: string
  avatar_url: string | null
  initials: string
  position_group: PositionGroup
  title: string | null
  joined_year: number | null
  bio: string | null
  club: {
    id: number
    slug: string
    name: string
    logo_url: string | null
  }
  trophies: {
    total: number
    recent: Array<{
      entry_id: number
      year: number | null
      category_slug: string
      category_name: string
      note: string | null
    }>
  }
}

/**
 * GET /public/clubs/:slug/members — the meet-the-club directory.
 * No auth. Cached 5min shared + 30min SWR by backend.
 */
export async function publicList(
  slug: string,
  params: PublicListMembersParams = {},
  opts: { signal?: AbortSignal } = {},
): Promise<PublicMembersResponse> {
  const qs = new URLSearchParams()
  if (params.position) qs.set('position', params.position)
  if (params.search != null && params.search.length > 0) qs.set('search', params.search)
  if (params.limit != null) qs.set('limit', String(params.limit))
  if (params.offset != null) qs.set('offset', String(params.offset))
  if (params.sort && params.sort !== 'default') qs.set('sort', params.sort)

  const url = qs.toString().length
    ? `${CRM_BASE}/public/clubs/${encodeURIComponent(slug)}/members?${qs.toString()}`
    : `${CRM_BASE}/public/clubs/${encodeURIComponent(slug)}/members`

  const res = await publicFetch<Envelope<PublicMembersResponse>>(url, {
    method: 'GET',
    signal: opts.signal,
  })
  return res.data
}

/** GET /public/clubs/:slug/players/:userId — single-player profile. No auth. */
export async function publicPlayer(
  slug: string,
  userId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<PublicPlayerProfile> {
  const res = await publicFetch<Envelope<PublicPlayerProfile>>(
    `${CRM_BASE}/public/clubs/${encodeURIComponent(slug)}/players/${userId}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

// ── PATCH extensions (brief 35 §3) ─────────────────────────────────

/** Preferred bowls position on the public player profile. */
export type PreferredPosition = 'Lead' | 'Second' | 'Third' | 'Skip' | 'Singles'
/** Club-assigned playing grade. */
export type PlayingLevel = 'A' | 'B' | 'C'

/**
 * Full PATCH body for the Member Detail form. All fields optional; send
 * only what changed. Writes atomically across the three underlying tables
 * (identity → `users`, roster → `club_members`, billing → `club_memberships`).
 *
 * Billing fields (`status`, `joined_date`, `payment_due_date`) require either
 * an existing `club_memberships` row OR a `membership_type_id` in the same
 * PATCH — see error code `no_membership_row`.
 */
export interface UpdateMemberPatch {
  // ── Identity (→ users) ────────────────────────────────────────────
  name?: string
  email?: string
  /** Null clears. */
  phone?: string | null
  /** Null clears. */
  address?: string | null
  /** `YYYY-MM-DD`, or null to clear. */
  dob?: string | null
  /** CDN URL (https://, ≤ 2048 chars) or null to clear.
   *  Backend auto-deletes the previously-stored image when this changes. */
  avatar_url?: string | null

  // ── Roster (→ club_members) ───────────────────────────────────────
  role?: MemberRole
  title?: string | null
  notes?: string | null
  position_group?: PositionGroup
  public_visible?: boolean
  bio?: string | null
  preferred_position?: PreferredPosition | null
  playing_level?: PlayingLevel | null

  // ── Billing (→ club_memberships) ─────────────────────────────────
  membership_type_id?: number | null
  status?: MembershipStatus
  /** `YYYY-MM-DD` — start of the current period; null clears. */
  joined_date?: string | null
  /** `YYYY-MM-DD` — end of the current period; null clears. */
  payment_due_date?: string | null
}

export interface UpdateMemberResponse {
  club_id: number
  user_id: number
  // Identity echoed back
  name: string
  email: string | null
  phone: string | null
  address: string | null
  dob: string | null
  // Roster
  role: MemberRole
  title: string | null
  position_group: PositionGroup
  public_visible: boolean
  bio: string | null
  preferred_position: PreferredPosition | null
  playing_level: PlayingLevel | null
  updated_at: string
  // Full billing block
  membership: RosterMembership | null
}

/**
 * Error codes the PATCH endpoint can return. Includes both the pre-brief-35
 * roster codes and the brief 36 / member-management extensions.
 */
export type UpdateMemberErrorCode =
  // Identity validation (brief 36)
  | 'invalid_name'
  | 'invalid_email'
  | 'invalid_phone'
  | 'invalid_address'
  | 'invalid_dob'
  // Billing validation (brief 36)
  | 'invalid_status'
  | 'invalid_joined_date'
  | 'invalid_payment_due_date'
  | 'no_membership_row'
  // Pre-existing roster codes
  | 'invalid_role'
  | 'invalid_title'
  | 'invalid_type_id'
  | 'unknown_type'
  | 'member_revoked'
  | 'owner_immutable'
  | 'owner_via_transfer'
  // Conflict
  | 'email_in_use'

/** PATCH /clubs/:clubId/members/:userId — partial update. */
export async function patchMember(
  clubId: number,
  userId: number,
  patch: UpdateMemberPatch,
  opts: { signal?: AbortSignal } = {},
): Promise<UpdateMemberResponse> {
  const res = await authedFetch<Envelope<UpdateMemberResponse>>(
    `${CRM_BASE}/clubs/${clubId}/members/${userId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
      signal: opts.signal,
    },
  )
  return res.data
}
