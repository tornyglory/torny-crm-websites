// CRM notifications — backend brief 40 (shipped 2026-08-26).
//
// Feeds the bell-icon dropdown in the top bar. `application` is the only
// kind wired end-to-end so far; the other six become live as their source
// features ship. Types match brief 40 §12 exactly.

import { CRM_BASE } from '../config'
import { authedFetch } from '../http'

// ── Domain types ─────────────────────────────────────────────────

export type NotificationKind =
  | 'application' | 'enquiry' | 'rsvp' | 'team'
  | 'publish' | 'payment' | 'member_milestone'

export type EmailDigest = 'off' | 'daily' | 'weekly'

export interface NotificationTarget {
  resource: 'application' | 'enquiry' | 'event' | 'team_round' | 'page' | 'payment_batch' | 'member'
  resource_id: number
  destination_href: string
}

export interface NotificationAction {
  label: string
  action: 'approve_application' | 'reply_enquiry' | 'confirm_round' | 'view' | 'add_to_honour_board'
  href: string
}

export interface NotificationActor {
  user_id: number | null
  display_name: string
  avatar_url: string | null
}

export interface Notification {
  id: number
  club_id: number
  kind: NotificationKind
  title: string
  body: string | null
  created_at: string
  unread: boolean
  target: NotificationTarget | null
  primary_action: NotificationAction | null
  required_permission: string | null
  actor: NotificationActor | null
  dedupe_key: string
}

export interface ListNotificationsParams {
  tab?: 'all' | 'unread'
  limit?: number
  before?: string
  kinds?: NotificationKind[]
}

export interface ListNotificationsResponse {
  notifications: Notification[]
  unread_count: number
  has_more: boolean
}

export interface NotificationKindPreferences {
  in_app: boolean
  email: boolean
}

export interface NotificationSettings {
  per_kind: Record<NotificationKind, NotificationKindPreferences>
  email_digest: EmailDigest
}

export interface NotificationSettingsPatch {
  per_kind?: Partial<Record<NotificationKind, Partial<NotificationKindPreferences>>>
  email_digest?: EmailDigest
}

/** Error codes documented in brief 40 §12 + settings PATCH. */
export type NotificationErrorCode =
  | 'bad_kinds'
  | 'bad_limit'
  | 'bad_before'
  | 'bad_kind'
  | 'bad_digest'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── List + counts ────────────────────────────────────────────────

function buildListQuery(params: ListNotificationsParams): string {
  const qs = new URLSearchParams()
  if (params.tab && params.tab !== 'all') qs.set('tab', params.tab)
  if (params.limit != null) qs.set('limit', String(params.limit))
  if (params.before) qs.set('before', params.before)
  if (params.kinds && params.kinds.length > 0) qs.set('kinds', params.kinds.join(','))
  return qs.toString()
}

export async function list(
  clubId: number,
  params: ListNotificationsParams = {},
  opts: { signal?: AbortSignal } = {},
): Promise<ListNotificationsResponse> {
  const qs = buildListQuery(params)
  const url = qs.length
    ? `${CRM_BASE}/clubs/${clubId}/notifications?${qs}`
    : `${CRM_BASE}/clubs/${clubId}/notifications`
  const res = await authedFetch<Envelope<ListNotificationsResponse>>(url, {
    method: 'GET',
    signal: opts.signal,
  })
  return res.data
}

export async function unreadCount(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<{ unread_count: number }> {
  const res = await authedFetch<Envelope<{ unread_count: number }>>(
    `${CRM_BASE}/clubs/${clubId}/notifications/unread-count`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

// ── Mark read ────────────────────────────────────────────────────

export async function markRead(
  clubId: number,
  notificationId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<{ unread_count: number }> {
  const res = await authedFetch<Envelope<{ unread_count: number }>>(
    `${CRM_BASE}/clubs/${clubId}/notifications/${notificationId}/read`,
    { method: 'POST', signal: opts.signal },
  )
  return res.data
}

export async function markAllRead(
  clubId: number,
  input: { kinds?: NotificationKind[] } = {},
  opts: { signal?: AbortSignal } = {},
): Promise<{ marked: number; unread_count: number }> {
  const body = input.kinds && input.kinds.length > 0 ? JSON.stringify({ kinds: input.kinds }) : '{}'
  const res = await authedFetch<Envelope<{ marked: number; unread_count: number }>>(
    `${CRM_BASE}/clubs/${clubId}/notifications/read-all`,
    { method: 'POST', body, signal: opts.signal },
  )
  return res.data
}

// ── Per-user settings ────────────────────────────────────────────

export async function getSettings(
  opts: { signal?: AbortSignal } = {},
): Promise<NotificationSettings> {
  const res = await authedFetch<Envelope<NotificationSettings>>(
    `${CRM_BASE}/me/notification-settings`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

export async function updateSettings(
  patch: NotificationSettingsPatch,
  opts: { signal?: AbortSignal } = {},
): Promise<NotificationSettings> {
  const res = await authedFetch<Envelope<NotificationSettings>>(
    `${CRM_BASE}/me/notification-settings`,
    { method: 'PATCH', body: JSON.stringify(patch), signal: opts.signal },
  )
  return res.data
}
