// Events — CRUD + public range list + iCal.
// See brief 29 (CRUD) + brief 33 (public read).
//
// Two base URLs are in play:
//   MEDIA_BASE — primary CDK stack, hosts the CRUD endpoints. Same stack
//                as media uploads + honour-board CRUD. Auth: Bearer JWT.
//   CRM_BASE   — public list + iCal + /site — no auth.

import { CRM_BASE, MEDIA_BASE } from '../config'
import { authedFetch, publicFetch } from '../http'
import type {
  Event,
  EventType,
  BowlsFormat,
  PublicEvent,
} from '../types'

// ── Types ─────────────────────────────────────────────────────────

export interface EventCreateInput {
  title: string
  event_type: EventType
  start_datetime: string
  /** Optional — backend auto-derives `${slugify(title)}-${startDate.slice(0,10)}` when omitted. */
  slug?: string
  excerpt?: string | null
  format?: BowlsFormat | null
  description_html?: string | null
  end_datetime?: string | null
  all_day?: boolean | 0 | 1
  location?: string | null
  cover_image_url?: string | null
  link_url?: string | null
  capacity?: number | null
  /** Must be a current member of the club (400 host_not_in_club otherwise). */
  host_user_id?: number | null
  host_name?: string | null
  is_ticketed?: boolean | 0 | 1
  rsvp_open?: boolean | 0 | 1
  is_published?: boolean | 0 | 1
}

export type EventUpdateInput = Partial<EventCreateInput>

export interface ListEventsParams {
  /** ISO date. Include events where `start_datetime >= from`. */
  from?: string
  /** ISO date. Include events where `start_datetime <= to`. */
  to?: string
  /** Single event_type value (backend list endpoint doesn't accept comma-separated). */
  type?: EventType
}

export interface PublicListEventsParams {
  since?: string
  until?: string
  type?: EventType | EventType[]
  format?: BowlsFormat | BowlsFormat[]
  limit?: number
}

export interface PublicEventsResponse {
  events: PublicEvent[]
  total: number
}

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

function csv(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined
  return Array.isArray(v) ? v.join(',') : v
}

// ── Authed CRUD (MEDIA_BASE) ──────────────────────────────────────

/**
 * GET /clubs/:clubId/events — CRM listing. Owner or admin.
 *
 * Uses `?from=&to=` per brief 33 §9 note (pre-existing CRM convention;
 * public endpoint uses `?since=&until=`).
 */
export async function list(
  clubId: number,
  params: ListEventsParams = {},
  opts: { signal?: AbortSignal } = {},
): Promise<Event[]> {
  const qs = new URLSearchParams()
  if (params.from) qs.set('from', params.from)
  if (params.to) qs.set('to', params.to)
  if (params.type) qs.set('type', params.type)

  const url = qs.toString().length
    ? `${MEDIA_BASE}/clubs/${clubId}/events?${qs.toString()}`
    : `${MEDIA_BASE}/clubs/${clubId}/events`

  const res = await authedFetch<Envelope<Event[]>>(url, {
    method: 'GET',
    signal: opts.signal,
  })
  return res.data
}

export async function get(
  clubId: number,
  eventId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<Event> {
  const res = await authedFetch<Envelope<Event>>(
    `${MEDIA_BASE}/clubs/${clubId}/events/${eventId}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

export async function create(
  clubId: number,
  input: EventCreateInput,
  opts: { signal?: AbortSignal } = {},
): Promise<Event> {
  const res = await authedFetch<Envelope<Event>>(
    `${MEDIA_BASE}/clubs/${clubId}/events`,
    {
      method: 'POST',
      body: JSON.stringify(input),
      signal: opts.signal,
    },
  )
  return res.data
}

export async function update(
  clubId: number,
  eventId: number,
  patch: EventUpdateInput,
  opts: { signal?: AbortSignal } = {},
): Promise<Event> {
  const res = await authedFetch<Envelope<Event>>(
    `${MEDIA_BASE}/clubs/${clubId}/events/${eventId}`,
    {
      method: 'PUT',
      body: JSON.stringify(patch),
      signal: opts.signal,
    },
  )
  return res.data
}

export async function remove(
  clubId: number,
  eventId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  await authedFetch(
    `${MEDIA_BASE}/clubs/${clubId}/events/${eventId}`,
    { method: 'DELETE', signal: opts.signal },
  )
}

// ── Public (CRM_BASE) — brief 33 ──────────────────────────────────

/**
 * GET /public/clubs/:slug/events — range-scoped public list. No auth.
 * Uses `?since=&until=` per brief 33 (different from the CRUD list's
 * `?from=&to=`).
 */
export async function publicList(
  slug: string,
  params: PublicListEventsParams = {},
  opts: { signal?: AbortSignal } = {},
): Promise<PublicEventsResponse> {
  const qs = new URLSearchParams()
  if (params.since) qs.set('since', params.since)
  if (params.until) qs.set('until', params.until)
  const type = csv(params.type)
  if (type) qs.set('type', type)
  const format = csv(params.format)
  if (format) qs.set('format', format)
  if (params.limit != null) qs.set('limit', String(params.limit))

  const url = qs.toString().length
    ? `${CRM_BASE}/public/clubs/${encodeURIComponent(slug)}/events?${qs.toString()}`
    : `${CRM_BASE}/public/clubs/${encodeURIComponent(slug)}/events`

  const res = await publicFetch<Envelope<PublicEventsResponse>>(url, {
    method: 'GET',
    signal: opts.signal,
  })
  return res.data
}

/**
 * Returns the public iCal feed URL for a club. No fetch — just build
 * the URL so consumers can link to it (`<a href="…">Add to my calendar</a>`).
 * `webcal:` variant available via `.replace(/^https?:/, 'webcal:')`.
 */
export function publicIcalUrl(slug: string): string {
  return `${CRM_BASE}/public/clubs/${encodeURIComponent(slug)}/events.ics`
}
