// Contact-form enquiries — backend brief 41 (shipped 2026-08-26).
//
// Public POST from the ContactFormBlock. Admin endpoints power the CRM
// Enquiries inbox. Fires brief 40 kind='enquiry' notification per POST.
// Types match brief 41 §11 exactly.

import { CRM_BASE } from '../config'
import { authedFetch, publicFetch } from '../http'

// ── Domain types ─────────────────────────────────────────────────

export type EnquiryStatus = 'new' | 'read' | 'replied' | 'archived'
export type EnquiryTopic =
  | 'membership'
  | 'events'
  | 'facilities'
  | 'general'
  | 'media'

export type EnquiryArchiveReason = 'spam' | 'resolved' | 'other'

export interface EnquiryRow {
  id: number
  status: EnquiryStatus
  full_name: string
  email: string
  phone: string | null
  topic: EnquiryTopic
  message_preview: string
  received_at: string
  responded_at: string | null
  responder_user_id: number | null
  note_count: number
}

export interface EnquiryReply {
  id: number
  body: string
  author_user_id: number | null
  author_name: string | null
  sent_at: string
  email_status: 'sent' | 'failed'
}

export interface EnquiryNote {
  id: number
  body: string
  author_user_id: number | null
  author_name: string | null
  created_at: string
}

export interface EnquiryDetail extends Omit<EnquiryRow, 'message_preview' | 'note_count'> {
  message: string
  consent_reply: boolean
  ip_hash: string | null
  user_agent: string | null
  replies: EnquiryReply[]
  notes: EnquiryNote[]
}

export interface EnquiriesListResponse {
  enquiries: EnquiryRow[]
  counts: { new: number; read: number; replied: number; archived: number }
  pagination: { limit: number; offset: number; total: number }
}

export interface ListEnquiriesParams {
  status?: EnquiryStatus | 'all'
  topic?: EnquiryTopic
  search?: string
  limit?: number
  offset?: number
  sort?: 'newest' | 'oldest'
}

// ── Public POST — the ContactFormBlock's create() ────────────────

export interface CreateEnquiryInput {
  full_name: string
  email: string
  phone?: string | null
  topic: EnquiryTopic
  message: string
  consent_reply: boolean
  /** Honeypot — always send an empty string. Bots fill it, server returns
   *  fake `enquiry_id: 0` silent-success. Frontend must not surface a
   *  0-id success visually. */
  hp?: string
}

export interface CreateEnquiryResult {
  /** 0 = honeypot silent-success. Real submits have positive ids. */
  enquiry_id: number
  received_at: string
}

// ── Reply / archive / note payloads ──────────────────────────────

export interface ReplyEnquiryInput {
  body: string
  subject?: string
}

export interface ReplyEnquiryResult {
  reply_id: number
  sent_at: string
  status: 'replied'
  email_status: { sent: true } | { sent: false; error?: string }
}

export interface ArchiveEnquiryInput {
  reason?: EnquiryArchiveReason
  unarchive?: boolean
}

export interface ArchiveEnquiryResult {
  /** `archived` on archive, `read` on unarchive. */
  status: 'archived' | 'read'
}

export interface MarkReadResult {
  status: EnquiryStatus
}

// ── Owner settings ───────────────────────────────────────────────

export interface EnquirySettings {
  enquiries_open: boolean
  enquiry_notification_email: string | null
  auto_reply_body: string | null
  /** Empty array = all five topics accepted. Non-empty = whitelist. */
  topics_enabled: EnquiryTopic[]
}

export type EnquirySettingsPatch = Partial<{
  enquiries_open: boolean
  enquiry_notification_email: string | null
  auto_reply_body: string | null
  topics_enabled: EnquiryTopic[]
}>

/** Error codes documented in brief 41. */
export type EnquiryErrorCode =
  | 'missing_required'
  | 'bad_email'
  | 'bad_topic'
  | 'bad_topics'
  | 'bad_message'
  | 'consent_required'
  | 'unknown_club'
  | 'rate_limited'
  | 'enquiries_closed'
  | 'missing_body'
  | 'body_too_long'
  | 'already_archived'
  | 'not_found'

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Public — the ContactFormBlock POST ──────────────────────────

/** POST /public/clubs/:slug/enquiries — no auth, rate-limited by IP. */
export async function create(
  slug: string,
  input: CreateEnquiryInput,
  opts: { signal?: AbortSignal } = {},
): Promise<CreateEnquiryResult> {
  // Always send the honeypot key so a missing-hp bot is caught server-side.
  const payload = { hp: '', ...input }
  const res = await publicFetch<Envelope<CreateEnquiryResult>>(
    `${CRM_BASE}/public/clubs/${encodeURIComponent(slug)}/enquiries`,
    { method: 'POST', body: JSON.stringify(payload), signal: opts.signal },
  )
  return res.data
}

// ── CRM inbox — admin+ ─────────────────────────────────────────

export async function list(
  clubId: number,
  params: ListEnquiriesParams = {},
  opts: { signal?: AbortSignal } = {},
): Promise<EnquiriesListResponse> {
  const qs = new URLSearchParams()
  if (params.status && params.status !== 'new') qs.set('status', params.status)
  if (params.topic) qs.set('topic', params.topic)
  if (params.search != null && params.search.length > 0) qs.set('search', params.search)
  if (params.limit != null) qs.set('limit', String(params.limit))
  if (params.offset != null) qs.set('offset', String(params.offset))
  if (params.sort && params.sort !== 'newest') qs.set('sort', params.sort)

  const url = qs.toString().length
    ? `${CRM_BASE}/clubs/${clubId}/enquiries?${qs.toString()}`
    : `${CRM_BASE}/clubs/${clubId}/enquiries`

  const res = await authedFetch<Envelope<EnquiriesListResponse>>(url, {
    method: 'GET',
    signal: opts.signal,
  })
  return res.data
}

export async function get(
  clubId: number,
  enquiryId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<EnquiryDetail> {
  const res = await authedFetch<Envelope<EnquiryDetail>>(
    `${CRM_BASE}/clubs/${clubId}/enquiries/${enquiryId}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

export async function markRead(
  clubId: number,
  enquiryId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<MarkReadResult> {
  const res = await authedFetch<Envelope<MarkReadResult>>(
    `${CRM_BASE}/clubs/${clubId}/enquiries/${enquiryId}/read`,
    { method: 'POST', signal: opts.signal },
  )
  return res.data
}

export async function reply(
  clubId: number,
  enquiryId: number,
  input: ReplyEnquiryInput,
  opts: { signal?: AbortSignal } = {},
): Promise<ReplyEnquiryResult> {
  const res = await authedFetch<Envelope<ReplyEnquiryResult>>(
    `${CRM_BASE}/clubs/${clubId}/enquiries/${enquiryId}/reply`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

export async function archive(
  clubId: number,
  enquiryId: number,
  input: ArchiveEnquiryInput = {},
  opts: { signal?: AbortSignal } = {},
): Promise<ArchiveEnquiryResult> {
  const res = await authedFetch<Envelope<ArchiveEnquiryResult>>(
    `${CRM_BASE}/clubs/${clubId}/enquiries/${enquiryId}/archive`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

export async function addNote(
  clubId: number,
  enquiryId: number,
  body: string,
  opts: { signal?: AbortSignal } = {},
): Promise<EnquiryNote> {
  const res = await authedFetch<Envelope<EnquiryNote>>(
    `${CRM_BASE}/clubs/${clubId}/enquiries/${enquiryId}/notes`,
    { method: 'POST', body: JSON.stringify({ body }), signal: opts.signal },
  )
  return res.data
}

// ── Owner settings ──────────────────────────────────────────────

export async function updateSettings(
  clubId: number,
  patch: EnquirySettingsPatch,
  opts: { signal?: AbortSignal } = {},
): Promise<EnquirySettings> {
  const res = await authedFetch<Envelope<EnquirySettings>>(
    `${CRM_BASE}/clubs/${clubId}/enquiry-settings`,
    { method: 'PATCH', body: JSON.stringify(patch), signal: opts.signal },
  )
  return res.data
}
