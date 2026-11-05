// Team announcements — sport-flexibility brief Layer 1.
//
// Admin posts the official lineup for an upcoming event (bowls team,
// dragon-boat crew, football squad, whatever). Each row is freeform —
// no bowls ENUMs — so any sport works without a schema change.
//
// Admin flow: create draft → add members (picker or guest) → publish.
// Published announcements are visible on the public club page.
//
// Member rows are nested: one PATCH diffs the whole `members[]` array
// server-side (id → update, no id → insert, missing id → delete).
// Mirrors the venue-package nested-PATCH pattern.
//
// Role gates: GET committee+; writes + publish admin+.

import { VENUE_BASE } from '../config'
import { authedFetch, publicFetch } from '../http'

// ── Domain types ─────────────────────────────────────────────────

export type TeamAnnouncementStatus = 'draft' | 'published' | 'cancelled'

export interface TeamAnnouncementMember {
  /** Server-assigned id. Omit on INSERT, include on UPDATE. */
  id?: number
  /** Null for guest rows (admin typed a name, no Torny user). */
  user_id?: number | null
  /** Freeform display name. Required even when user_id is set — admin
   *  can override the display label without re-picking the user. */
  name: string
  /** Freeform role — "Lead" / "Steerer" / "Goalkeeper" / anything the
   *  sport uses. No ENUM, no validation beyond length. */
  role?: string | null
  /** When true, renders in the reserves block on public. */
  is_reserve?: boolean
  /** Explicit ordering — admin drags to reorder. Omit on create to
   *  append to the end server-side. */
  sort_order?: number
}

export interface TeamAnnouncement {
  id: number
  club_id: number
  /** Nullable until multi-sport reference tables exist. */
  sport_id: number | null
  name: string
  division: string | null
  location: string | null
  /** ISO 8601 UTC — when the event starts. */
  event_at: string | null
  notes: string | null
  status: TeamAnnouncementStatus
  /** ISO 8601 UTC — set when publish fires. */
  published_at: string | null
  created_by_user_id: number
  created_at: string
  updated_at: string
  members: TeamAnnouncementMember[]
}

/** List row — same as detail minus members (saves payload bytes). */
export interface TeamAnnouncementListItem {
  id: number
  club_id: number
  sport_id: number | null
  name: string
  division: string | null
  location: string | null
  event_at: string | null
  notes: string | null
  status: TeamAnnouncementStatus
  published_at: string | null
  created_by_user_id: number
  created_at: string
  updated_at: string
  member_count: number
}

export interface TeamAnnouncementsListResponse {
  announcements: TeamAnnouncementListItem[]
  /** Null when the club has no announcements yet — backend omits the
   *  counts breakdown on empty lists. FE should coerce to
   *  `{ draft: 0, published: 0, cancelled: 0 }` on null. */
  counts: Record<TeamAnnouncementStatus, number> | null
}

export interface ListTeamAnnouncementsParams {
  status?: TeamAnnouncementStatus
}

export interface CreateTeamAnnouncementInput {
  name: string
  division?: string | null
  location?: string | null
  event_at?: string | null
  notes?: string | null
  members: TeamAnnouncementMember[]
}

/** Partial shape for the nested PATCH. Top-level fields are standard
 *  (omit = unchanged); `members` is a whole-shape replace per the
 *  nested-PATCH convention. */
export type UpdateTeamAnnouncementInput = Partial<Omit<CreateTeamAnnouncementInput, 'members'>> & {
  members?: TeamAnnouncementMember[]
}

export type TeamAnnouncementErrorCode =
  | 'bad_name'
  | 'bad_division'
  | 'bad_location'
  | 'bad_notes'
  | 'bad_event_at'
  | 'too_many_members'
  | 'bad_member_name'
  | 'bad_member_role'
  | 'bad_member_user'
  | 'forbidden'
  | 'not_found'

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Admin endpoints ─────────────────────────────────────────────

/** `GET /clubs/:cid/team-announcements` — list with per-status counts. */
export async function list(
  clubId: number,
  params: ListTeamAnnouncementsParams = {},
  opts: { signal?: AbortSignal } = {},
): Promise<TeamAnnouncementsListResponse> {
  const qs = new URLSearchParams()
  if (params.status) qs.set('status', params.status)
  const url = qs.toString().length > 0
    ? `${VENUE_BASE}/clubs/${clubId}/team-announcements?${qs.toString()}`
    : `${VENUE_BASE}/clubs/${clubId}/team-announcements`
  const res = await authedFetch<Envelope<TeamAnnouncementsListResponse>>(url, {
    method: 'GET',
    signal: opts.signal,
  })
  return res.data
}

/** `GET /clubs/:cid/team-announcements/:id` — full detail with members. */
export async function get(
  clubId: number,
  announcementId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<TeamAnnouncement> {
  const res = await authedFetch<Envelope<TeamAnnouncement>>(
    `${VENUE_BASE}/clubs/${clubId}/team-announcements/${announcementId}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

/** `POST /clubs/:cid/team-announcements` — create draft. */
export async function create(
  clubId: number,
  input: CreateTeamAnnouncementInput,
  opts: { signal?: AbortSignal } = {},
): Promise<TeamAnnouncement> {
  const res = await authedFetch<Envelope<TeamAnnouncement>>(
    `${VENUE_BASE}/clubs/${clubId}/team-announcements`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

/** `PATCH /clubs/:cid/team-announcements/:id` — nested whole-shape
 *  replace. Passing `members` sends the full array; backend diffs by id. */
export async function update(
  clubId: number,
  announcementId: number,
  input: UpdateTeamAnnouncementInput,
  opts: { signal?: AbortSignal } = {},
): Promise<TeamAnnouncement> {
  const res = await authedFetch<Envelope<TeamAnnouncement>>(
    `${VENUE_BASE}/clubs/${clubId}/team-announcements/${announcementId}`,
    { method: 'PATCH', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

/** `DELETE /clubs/:cid/team-announcements/:id` — soft-delete. */
export async function remove(
  clubId: number,
  announcementId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  await authedFetch<void>(
    `${VENUE_BASE}/clubs/${clubId}/team-announcements/${announcementId}`,
    { method: 'DELETE', signal: opts.signal },
  )
}

/** `POST /clubs/:cid/team-announcements/:id/publish` — flips status +
 *  stamps `published_at`. Idempotent (re-publishing returns 200 with
 *  the already-published row unchanged). */
export async function publish(
  clubId: number,
  announcementId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<TeamAnnouncement> {
  const res = await authedFetch<Envelope<TeamAnnouncement>>(
    `${VENUE_BASE}/clubs/${clubId}/team-announcements/${announcementId}/publish`,
    { method: 'POST', body: '{}', signal: opts.signal },
  )
  return res.data
}

// ── Public reads ────────────────────────────────────────────────

/** Public list — only published, sorted by `event_at` ascending.
 *  Strips user_ids from member rows for privacy. */
export async function listPublic(
  slug: string,
  opts: { signal?: AbortSignal } = {},
): Promise<{ announcements: TeamAnnouncement[] }> {
  const res = await publicFetch<Envelope<{ announcements: TeamAnnouncement[] }>>(
    `${VENUE_BASE}/public/clubs/${encodeURIComponent(slug)}/team-announcements`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

/** Public detail — same strip. 404 if draft / cancelled / deleted. */
export async function getPublic(
  slug: string,
  announcementId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<TeamAnnouncement> {
  const res = await publicFetch<Envelope<TeamAnnouncement>>(
    `${VENUE_BASE}/public/clubs/${encodeURIComponent(slug)}/team-announcements/${announcementId}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}
