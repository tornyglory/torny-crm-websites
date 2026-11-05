// Team selections — brief 74.
//
// Pick teams for pennant / champ-of-champs / one-off fixtures. A
// selection carries fixture metadata (competition / round / opponent /
// venue / when) + one or more rinks, each with slots by position
// (Lead/Second/Third/Skip/Singles). Lifecycle:
// draft → confirmed → sent → played (or cancelled).
//
// Writes mirror brief 73's nested-PATCH pattern: fixture-only PATCHes
// send any subset of the top-level fields; roster PATCHes send the
// whole `rinks[]` array and the backend diffs rinks + slots by id
// (include id → UPDATE; omit id → INSERT; missing from the array →
// DELETE).
//
// Publish is atomic + idempotent — fans out `team_selection`
// notifications (picked / dropped) only for slots whose
// `notified_member_id` has drifted from the current `member_id`. A
// second call with no roster changes returns all zeros in
// `notify_summary` and keeps status `sent`.
//
// Role gates: GET admin+ (committee read is deferred); writes +
// lifecycle transitions owner/admin.

import { CRM_BASE } from '../config'
import { authedFetch, publicFetch } from '../http'

// ── Domain types ─────────────────────────────────────────────────

export type TeamSelectionStatus = 'draft' | 'confirmed' | 'sent' | 'played' | 'cancelled'
export type TeamSelectionVenue = 'home' | 'away'
/** Free-text position label — any sport, any role. Known bowls values
 *  (Lead/Second/Third/Skip/Singles) are documented for autocomplete /
 *  default-seeding but any string ≤ 40 chars is valid once brief 75
 *  (free-text positions) ships. */
export type TeamSelectionPosition = string
export const BOWLS_POSITIONS = ['Lead', 'Second', 'Third', 'Skip', 'Singles'] as const

/** Per-slot member snapshot. Backend joins the roster here so the
 *  editor never has to re-fetch members to render a selection. */
export interface TeamSelectionMemberSnapshot {
  user_id: number
  name: string
  preferred_position: TeamSelectionPosition | null
  playing_level: 'A' | 'B' | 'C' | null
  /** ISO 8601 UTC of the most recent `sent` or `played` selection this
   *  member appeared in. Null = never picked. */
  last_played_at: string | null
  /** Optional — only present once avatars ship. */
  avatar_url?: string | null
}

export interface TeamSelectionSlot {
  id: number
  position: TeamSelectionPosition
  slot_order: number
  /** Null = unfilled. */
  member: TeamSelectionMemberSnapshot | null
  /** Set once the slot has been published at least once. Drives the
   *  "swap" / "dropped" notification logic on the next publish. */
  notified_member_id: number | null
  notified_at: string | null
}

export interface TeamSelectionRink {
  id: number
  /** 0-based ordering within the selection (Rink 1, Rink 2, …). */
  position: number
  label: string
  slots: TeamSelectionSlot[]
}

export interface TeamSelection {
  id: number
  club_id: number
  competition: string
  round_label: string
  opponent: string
  venue: TeamSelectionVenue
  starts_at: string
  format_label: string
  /** Optional FK to an `events` row. Null if the fixture isn't also an
   *  event on the calendar. */
  event_id: number | null
  manager_note: string | null
  green_closure_note: string | null
  status: TeamSelectionStatus
  sent_at: string | null
  played_at: string | null
  cancelled_at: string | null
  cancelled_reason: string | null
  confirmed_count: number
  total_slots: number
  rinks: TeamSelectionRink[]
  created_at: string
  updated_at: string | null
}

/** List row — excludes rinks/slots (saves bytes). */
export interface TeamSelectionListItem {
  id: number
  competition: string
  round_label: string
  opponent: string
  venue: TeamSelectionVenue
  starts_at: string
  format_label: string
  event_id: number | null
  manager_note: string | null
  status: TeamSelectionStatus
  sent_at: string | null
  played_at: string | null
  confirmed_count: number
  total_slots: number
  created_at: string
  updated_at: string | null
}

export interface TeamSelectionsListResponse {
  selections: TeamSelectionListItem[]
  count: number
  total: number
}

export interface FormatShape {
  /** 1..4 items from the position enum. Frontend passes `['Singles']`
   *  for singles, `['Skip','Lead']` for pairs, etc. */
  positions: TeamSelectionPosition[]
  /** 1..8 rinks. Backend seeds one slot per position per rink. */
  rink_count: number
}

export interface ListTeamSelectionsParams {
  /** `upcoming` (default): draft/confirmed/sent with starts_at >= now
   *  OR past fixtures still in draft/confirmed. `past`: played /
   *  cancelled OR anything with starts_at < now. Mutually exclusive
   *  with `status`. */
  scope?: 'upcoming' | 'past'
  /** Comma-separated statuses — overrides `scope`. */
  status?: string
  since?: string
  until?: string
  /** Default `true` — managers usually want their own drafts. Set
   *  `false` for the public-facing surface. */
  include_drafts?: boolean
  limit?: number
  offset?: number
}

export interface CreateTeamSelectionInput {
  competition: string
  round_label: string
  opponent: string
  venue: TeamSelectionVenue
  starts_at: string
  format_label: string
  format_shape: FormatShape
  event_id?: number | null
  manager_note?: string | null
  green_closure_note?: string | null
}

/** Fixture-metadata PATCH. Any subset of the create fields minus
 *  `format_shape` (rinks/slots are addressed by the roster PATCH). */
export type UpdateFixtureInput = Partial<Omit<CreateTeamSelectionInput, 'format_shape'>>

export interface UpdateRosterSlotInput {
  /** Server-assigned slot id. Required for updates — omit to insert. */
  id?: number
  /** Omit to leave the slot's position unchanged on insert. */
  position?: TeamSelectionPosition
  slot_order?: number
  /** `null` clears the slot. */
  member_id: number | null
}

export interface UpdateRosterRinkInput {
  /** Omit for a brand-new rink; backend inserts. */
  id?: number
  label?: string
  position?: number
  slots: UpdateRosterSlotInput[]
}

export interface UpdateRosterInput {
  rinks: UpdateRosterRinkInput[]
}

export interface PublishInput {
  /** Optional manager note override. Falls back to
   *  `selection.manager_note` when omitted. */
  message?: string
}

export interface CancelInput {
  reason: string
}

export interface NotifySummary {
  picked: number
  dropped: number
  already_notified: number
}

export interface PublishResult {
  selection: TeamSelection
  notify_summary: NotifySummary
}

/** Full error-code enumeration from brief 74 §3. */
export type TeamSelectionErrorCode =
  | 'bad_json'
  | 'missing_competition'
  | 'missing_round_label'
  | 'missing_opponent'
  | 'missing_venue'
  | 'missing_starts_at'
  | 'missing_format_label'
  | 'missing_format_shape'
  | 'bad_venue'
  | 'bad_starts_at'
  | 'starts_in_past'
  | 'bad_positions'
  | 'bad_rink_count'
  | 'cross_club_event'
  | 'cross_club_member'
  | 'duplicate_member'
  | 'selection_sent'
  | 'bad_status'
  | 'empty_rink'
  | 'forbidden'
  | 'not_found'

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    qs.set(k, String(v))
  }
  const s = qs.toString()
  return s.length > 0 ? `?${s}` : ''
}

// ── Admin endpoints ─────────────────────────────────────────────

/** `GET /clubs/:cid/team-selections` — list with fill counts. */
export async function list(
  clubId: number,
  params: ListTeamSelectionsParams = {},
  opts: { signal?: AbortSignal } = {},
): Promise<TeamSelectionsListResponse> {
  const q = buildQuery({
    scope: params.scope,
    status: params.status,
    since: params.since,
    until: params.until,
    include_drafts: params.include_drafts,
    limit: params.limit,
    offset: params.offset,
  })
  const res = await authedFetch<Envelope<TeamSelectionsListResponse>>(
    `${CRM_BASE}/clubs/${clubId}/team-selections${q}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

/** `GET /clubs/:cid/team-selections/:id` — full detail with rinks +
 *  slots + member snapshots. Server envelope wraps on `{ selection }`. */
export async function get(
  clubId: number,
  selectionId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<TeamSelection> {
  const res = await authedFetch<Envelope<{ selection: TeamSelection }>>(
    `${CRM_BASE}/clubs/${clubId}/team-selections/${selectionId}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data.selection
}

/** `POST /clubs/:cid/team-selections` — create. Backend seeds rinks +
 *  slots server-side from `format_shape`, so the editor lands with the
 *  right skeleton ready to fill. */
export async function create(
  clubId: number,
  input: CreateTeamSelectionInput,
  opts: { signal?: AbortSignal; force?: boolean } = {},
): Promise<TeamSelection> {
  const q = opts.force ? '?force=1' : ''
  const res = await authedFetch<Envelope<{ selection: TeamSelection }>>(
    `${CRM_BASE}/clubs/${clubId}/team-selections${q}`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data.selection
}

/** `PATCH /clubs/:cid/team-selections/:id` — update fixture metadata
 *  OR the roster. Backend discriminates on presence of `rinks` in the
 *  body; pass one of the two input shapes. */
export async function update(
  clubId: number,
  selectionId: number,
  input: UpdateFixtureInput | UpdateRosterInput,
  opts: { signal?: AbortSignal; allowDuplicate?: boolean } = {},
): Promise<TeamSelection> {
  const q = opts.allowDuplicate ? '?allow_duplicate=1' : ''
  const res = await authedFetch<Envelope<{ selection: TeamSelection }>>(
    `${CRM_BASE}/clubs/${clubId}/team-selections/${selectionId}${q}`,
    { method: 'PATCH', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data.selection
}

/** `DELETE /clubs/:cid/team-selections/:id` — soft-delete. If the
 *  selection is `sent`, backend fires cancellation notifications. */
export async function remove(
  clubId: number,
  selectionId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  await authedFetch<void>(
    `${CRM_BASE}/clubs/${clubId}/team-selections/${selectionId}`,
    { method: 'DELETE', signal: opts.signal },
  )
}

/** `POST /clubs/:cid/team-selections/:id/publish` — atomic status flip
 *  to `sent` + notification fan-out. Idempotent. */
export async function publish(
  clubId: number,
  selectionId: number,
  input: PublishInput = {},
  opts: { signal?: AbortSignal } = {},
): Promise<PublishResult> {
  const res = await authedFetch<Envelope<PublishResult>>(
    `${CRM_BASE}/clubs/${clubId}/team-selections/${selectionId}/publish`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

/** `POST /clubs/:cid/team-selections/:id/reopen` — `sent` → `confirmed`.
 *  Does not un-notify picked players; the next publish diffs against
 *  `notified_member_id` and fires picked / dropped as appropriate. */
export async function reopen(
  clubId: number,
  selectionId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<TeamSelection> {
  const res = await authedFetch<Envelope<{ selection: TeamSelection }>>(
    `${CRM_BASE}/clubs/${clubId}/team-selections/${selectionId}/reopen`,
    { method: 'POST', body: '{}', signal: opts.signal },
  )
  return res.data.selection
}

/** `POST /clubs/:cid/team-selections/:id/cancel` — flip to `cancelled`
 *  + fan-out cancellation notifications. `reason` required. */
export async function cancel(
  clubId: number,
  selectionId: number,
  input: CancelInput,
  opts: { signal?: AbortSignal } = {},
): Promise<PublishResult> {
  const res = await authedFetch<Envelope<PublishResult>>(
    `${CRM_BASE}/clubs/${clubId}/team-selections/${selectionId}/cancel`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

/** `POST /clubs/:cid/team-selections/:id/mark-played` — manual
 *  transition to `played`. Only needed when the cron in brief 74 §7
 *  isn't live. */
export async function markPlayed(
  clubId: number,
  selectionId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<TeamSelection> {
  const res = await authedFetch<Envelope<{ selection: TeamSelection }>>(
    `${CRM_BASE}/clubs/${clubId}/team-selections/${selectionId}/mark-played`,
    { method: 'POST', body: '{}', signal: opts.signal },
  )
  return res.data.selection
}

// ── Public reads ────────────────────────────────────────────────

/** Public list — only `sent`/`played`. No auth. */
export async function listPublic(
  slug: string,
  opts: { signal?: AbortSignal } = {},
): Promise<{ selections: TeamSelectionListItem[] }> {
  const res = await publicFetch<Envelope<{ selections: TeamSelectionListItem[] }>>(
    `${CRM_BASE}/public/clubs/${encodeURIComponent(slug)}/team-selections`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

/** Public detail — 404 on draft / cancelled / deleted. No auth. */
export async function getPublic(
  slug: string,
  selectionId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<TeamSelection> {
  const res = await publicFetch<Envelope<{ selection: TeamSelection }>>(
    `${CRM_BASE}/public/clubs/${encodeURIComponent(slug)}/team-selections/${selectionId}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data.selection
}

/** `GET /public/team-selections/withdraw?token=…` — HMAC-signed one-
 *  click email link. The backend decodes the token, clears the
 *  signed-in slot, enqueues a manager notification, and renders a
 *  confirmation page. Exposed here as a URL builder so the email
 *  template can mint `{{withdraw_url}}` without going through fetch. */
export function withdrawUrl(token: string): string {
  return `${CRM_BASE}/public/team-selections/withdraw?token=${encodeURIComponent(token)}`
}
