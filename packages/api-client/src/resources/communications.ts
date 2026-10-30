// Per-member communications timeline — notes + email history on one feed.
//
// Backend shipped 2026-10-20, extended 2026-10-30 with:
//   - PATCH + DELETE on individual rows + `notes_moved` 400 guardrail on PATCH /members
//   - Delivery / open tracking on email rows via SES Configuration Set + SNS
//   - GET /communications/{batch_id} for row-click → EmailDetailModal
// Full contract: docs/backend-briefs/backend-email-batch-detail-response.md
//
// All endpoints live under the CRM base; JWT required on every call.

import { CRM_BASE } from '../config'
import { authedFetch } from '../http'

// ── Types ─────────────────────────────────────────────────────────

export type CommunicationChannel = 'note' | 'email' | 'call'

export type NoteType = 'call' | 'meeting' | 'visit' | 'text_whatsapp' | 'general'

/** Note rows carry `status='logged'`. Email rows walk the SES timeline:
 *  sent → delivered → opened. bounced / complained block upgrade to opened. */
export type EmailStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'suppressed'

/** Union of email status + the `'logged'` sentinel used on note rows. */
export type CommunicationStatus = EmailStatus | 'logged'

export interface MemberCommunication {
  communication_id: number
  club_id: number
  user_id: number
  sent_by: number | null
  sent_by_name: string | null
  channel: CommunicationChannel
  /** Only set when `channel === 'note'`. */
  note_type: NoteType | null
  /** Set for emails. Null on notes. */
  subject: string | null
  /** Markdown body for notes. Null on emails (we don't retain email bodies on
   *  the per-member row — click into the batch endpoint for the full body). */
  body: string | null
  template_id: number | null
  /** Shared across a batch send. Null on notes. Post-mig-128 (30 Oct 2026)
   *  resolves to a real `email_batches` row; earlier historical sends return
   *  404 from GET /communications/{batch_id}. */
  batch_id: number | null
  status: CommunicationStatus
  failure_reason: string | null
  /** Server timestamp when the row was written. */
  sent_at: string
  /** Admin-chosen date for the note (back-datable). Null on emails. */
  occurred_at: string | null
  // ── SES delivery timeline (email rows only — null / 0 on notes) ──
  delivered_at: string | null
  opened_at: string | null
  open_count: number
  bounced_at: string | null
  complained_at: string | null
  provider_message_id: string | null
}

export interface Pagination {
  page: number
  limit: number
  total: number
  total_pages: number
}

/** Aggregate email counts for the member — null on backends that haven't
 *  shipped the counts block yet. Notes are excluded from these totals. */
export interface MemberCommunicationsCounts {
  total: number
  delivered: number
  opened: number
  bounced: number
  complained: number
  failed: number
  queued: number
}

export interface MemberCommunicationsResponse {
  communications: MemberCommunication[]
  pagination: Pagination
  counts?: MemberCommunicationsCounts
}

// ── Batch detail types ────────────────────────────────────────────

export interface BatchSender {
  user_id: number | null
  name: string | null
  label: string | null
}

export interface BatchRecipient {
  recipient_id: number
  user_id: number
  name: string | null
  /** Masked (`n***@q***.co.nz`) for committee callers; raw for owner / admin. */
  email: string
  status: EmailStatus
  status_reason: string | null
  provider_message_id: string | null
  sent_at: string | null
  delivered_at: string | null
  opened_at: string | null
  open_count: number
  bounced_at: string | null
  complained_at: string | null
}

export interface BatchCounts {
  matched: number
  sent: number
  failed: number
  delivered: number
  opened: number
  bounced: number
  complained: number
  suppressed: number
}

export interface BatchDetail {
  batch_id: number
  flavor: string
  flavor_label: string
  subject: string
  /** The raw admin-authored HTML, pre-substitution. */
  body_html: string
  /** Fully rendered — tokens substituted, header/footer wrapped. Render in
   *  a sandboxed iframe. */
  preview_html: string
  sender: BatchSender
  recipient_mode: 'ids' | 'filter' | 'transactional'
  recipient_filter: Record<string, unknown> | null
  counts: BatchCounts
  created_at: string
  /** Present only when the request passed `user_id`. */
  your_row: BatchRecipient | null
  recipients: BatchRecipient[]
  pagination: { limit: number; offset: number; returned: number }
}

export interface GetBatchParams {
  user_id?: number
  limit?: number
  offset?: number
  status?: EmailStatus[]
}

// ── Inputs ────────────────────────────────────────────────────────

export interface LogNoteInput {
  channel: 'note'
  note_type: NoteType
  /** Markdown. ≤ 4000 chars. */
  body: string
  /** YYYY-MM-DD. Omit for "no date set". */
  occurred_at?: string | null
}

export interface PatchCommunicationInput {
  body?: string
  note_type?: NoteType
  occurred_at?: string | null
}

export interface ListParams {
  page?: number
  limit?: number
  /** Server-side filter if supported; otherwise filter client-side. */
  channel?: CommunicationChannel
}

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Endpoints ─────────────────────────────────────────────────────

/** GET /clubs/{clubId}/members/{userId}/communications — paginated, newest first. */
export async function listForMember(
  clubId: number,
  userId: number,
  params: ListParams = {},
  opts: { signal?: AbortSignal } = {},
): Promise<MemberCommunicationsResponse> {
  const q = new URLSearchParams()
  if (params.page != null) q.set('page', String(params.page))
  if (params.limit != null) q.set('limit', String(params.limit))
  if (params.channel) q.set('channel', params.channel)
  const query = q.toString()
  const res = await authedFetch<Envelope<MemberCommunicationsResponse>>(
    `${CRM_BASE}/clubs/${clubId}/members/${userId}/communications${query ? `?${query}` : ''}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

/** POST /clubs/{clubId}/members/{userId}/communications — log a note. */
export async function logNote(
  clubId: number,
  userId: number,
  input: LogNoteInput,
  opts: { signal?: AbortSignal } = {},
): Promise<MemberCommunication> {
  const res = await authedFetch<Envelope<MemberCommunication>>(
    `${CRM_BASE}/clubs/${clubId}/members/${userId}/communications`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

/** PATCH /clubs/{clubId}/members/{userId}/communications/{id} — edit a note. */
export async function patchCommunication(
  clubId: number,
  userId: number,
  communicationId: number,
  patch: PatchCommunicationInput,
  opts: { signal?: AbortSignal } = {},
): Promise<MemberCommunication> {
  const res = await authedFetch<Envelope<MemberCommunication>>(
    `${CRM_BASE}/clubs/${clubId}/members/${userId}/communications/${communicationId}`,
    { method: 'PATCH', body: JSON.stringify(patch), signal: opts.signal },
  )
  return res.data
}

/** DELETE /clubs/{clubId}/members/{userId}/communications/{id} — soft delete. */
export async function removeCommunication(
  clubId: number,
  userId: number,
  communicationId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  await authedFetch<null>(
    `${CRM_BASE}/clubs/${clubId}/members/${userId}/communications/${communicationId}`,
    { method: 'DELETE', signal: opts.signal },
  )
}

/** GET /clubs/{clubId}/communications/{batchId} — batch detail + rendered
 *  preview for a specific recipient (when `user_id` is passed). Returns 404
 *  `batch_not_found` for pre-mig-128 historical batches (ids ≤ 4). */
export async function getBatch(
  clubId: number,
  batchId: number,
  params: GetBatchParams = {},
  opts: { signal?: AbortSignal } = {},
): Promise<BatchDetail> {
  const q = new URLSearchParams()
  if (params.user_id != null) q.set('user_id', String(params.user_id))
  if (params.limit != null) q.set('limit', String(params.limit))
  if (params.offset != null) q.set('offset', String(params.offset))
  if (params.status?.length) q.set('status', params.status.join(','))
  const query = q.toString()
  const res = await authedFetch<Envelope<BatchDetail>>(
    `${CRM_BASE}/clubs/${clubId}/communications/${batchId}${query ? `?${query}` : ''}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}
