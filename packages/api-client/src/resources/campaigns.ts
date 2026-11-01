// Email campaigns + engagement metrics — brief 69.
//
// Campaigns + metrics + admin resubscribe live on the CDK stack
// (same host as media uploads + the payment DELETE route) because the
// CRM stack is at the CloudFormation 500-resource cap. The per-member
// feed + batch detail URLs are unchanged on the CRM stack.
//
// Public unsubscribe pages (GET /u/{token} + POST /u/{token}/confirm)
// land on SAM_BASE — the FE never calls them.

import { CRM_BASE, MEDIA_BASE, SAM_BASE } from '../config'
import { authedFetch } from '../http'

// Alias for readability. Flip these one line each if the backend consolidates.
// Brief 69: campaigns list + metrics live on CDK (same host as media uploads).
// Brief 71: the extended per-batch detail endpoint reuses brief 67's existing
// `/communications/{batch_id}` route on CRM — the detail GET was expanded
// in-place rather than moved. The three mutating actions (resend-unopened,
// archive, unarchive) live on SAM because the CDK stack hit the CFN cap.
const CDK_BASE = MEDIA_BASE
const SAM = SAM_BASE

// ── Types ─────────────────────────────────────────────────────────

export type CampaignStatus = 'sent' | 'scheduled' | 'draft'
export type CampaignSort = 'newest' | 'oldest'
export type CampaignMetricsWindow = '7d' | '30d' | '90d'

export interface CampaignAuthor {
  user_id: number | null
  name: string | null
  initials: string
}

export interface CampaignMetrics {
  sent: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  complained: number
  unsubscribed: number
  /** `null` when `delivered === 0` so the UI can render `—`. */
  open_rate: number | null
  click_rate: number | null
}

export interface CampaignRow {
  campaign_id: number
  subject: string
  status: CampaignStatus
  flavor: string
  flavor_label: string
  audience_label: string | null
  audience_count: number
  author: CampaignAuthor
  sent_at: string | null
  scheduled_for: string | null
  created_at: string
  /** `null` for drafts; partial for scheduled; full for sent. */
  metrics: CampaignMetrics | null
}

export interface CampaignsCountsByStatus {
  sent: number
  scheduled: number
  drafts: number
  all: number
}

export interface CampaignsListResponse {
  campaigns: CampaignRow[]
  next_cursor: string | null
  counts_by_status: CampaignsCountsByStatus
}

export interface CampaignsMetricsAggregate {
  broadcasts: number
  sent: number
  delivered: number
  opened: number
  clicked: number
  unsubscribed: number
  open_rate: number | null
  click_rate: number | null
  unsubscribe_rate: number | null
}

export interface CampaignsMetricsDeltas {
  open_rate_pp: number | null
  click_rate_pp: number | null
  sent: number | null
  unsubscribe_count: number | null
}

export interface CampaignsMetricsResponse {
  window: CampaignMetricsWindow
  range: { from: string; to: string }
  current: CampaignsMetricsAggregate
  previous: CampaignsMetricsAggregate
  deltas: CampaignsMetricsDeltas
  industry_benchmark: { open_rate: number; click_rate: number } | null
}

// ── Campaign detail (brief 71) ────────────────────────────────────

export interface CampaignRecipient {
  recipient_id: number
  user_id: number
  name: string | null
  email: string
  status:
    | 'queued' | 'sent' | 'delivered' | 'opened' | 'clicked'
    | 'bounced' | 'complained' | 'failed' | 'suppressed' | 'unsubscribed'
  status_reason: string | null
  provider_message_id: string | null
  sent_at: string | null
  delivered_at: string | null
  opened_at: string | null
  open_count: number
  clicked_at: string | null
  click_count: number
  bounced_at: string | null
  complained_at: string | null
  unsubscribed_at: string | null
}

export interface CampaignAnalytics {
  /** First open across the whole batch, ISO8601. Null until first open. */
  first_open_at: string | null
  /** The UTC hour bucket (`YYYY-MM-DDTHH:00:00.000Z`) with the most opens. */
  peak_open_hour: string | null
  /** `delivered - opened`. */
  delivered_not_opened: number
  /** Opens-with-repeats across all recipients. Can exceed `metrics.opened`. */
  total_opens: number
}

export interface CampaignLink {
  url: string
  clicks: number
  unique_clickers: number
}

export interface CampaignDetail {
  /** Brief 71 field name. Brief 67 called the same thing `batch_id`. */
  campaign_id?: number
  batch_id?: number
  subject: string
  flavor: string
  flavor_label: string
  status?: CampaignStatus
  audience_label?: string | null
  audience_count?: number
  author?: CampaignAuthor
  sender?: { user_id: number | null; name: string | null; label: string | null }
  sent_at?: string | null
  created_at: string
  archived_at?: string | null
  body_html?: string | null
  preview_html?: string
  /** Brief 71. Brief 67 called the same thing `counts`. */
  metrics?: CampaignMetrics
  counts?: {
    matched: number; sent: number; failed: number; delivered: number;
    opened: number; clicked: number; bounced: number; complained: number;
    suppressed: number; unsubscribed: number
  }
  analytics?: CampaignAnalytics
  links?: CampaignLink[]
  recipients: CampaignRecipient[]
}

export interface ResendUnopenedResult {
  new_batch_id: number
  resend_count: number
  skipped_count: number
  skipped_reasons: Record<string, number>
}

export interface ArchiveResult {
  batch_id: number
  archived_at: string | null
}

// ── Inputs ────────────────────────────────────────────────────────

export interface ListCampaignsParams {
  status?: CampaignStatus[]
  search?: string
  flavor?: string[]
  sort?: CampaignSort
  limit?: number
  offset?: number
  /** '0' (default, live only) | '1' (archived only) | 'any' */
  archived?: '0' | '1' | 'any'
}

export interface ResendUnopenedInput {
  exclude_user_ids?: number[]
}

export interface MetricsParams {
  window?: CampaignMetricsWindow
}

interface Envelope<T> {
  /** Backend returns either `'success'` or `'ok'` depending on the stack
   *  — authedFetch only treats `'error'` as a failure, so this stays lax. */
  status: 'success' | 'ok'
  message?: string
  data: T
}

// ── Endpoints ─────────────────────────────────────────────────────

/** GET /clubs/{clubId}/campaigns — paginated sent/scheduled/draft list. */
export async function list(
  clubId: number,
  params: ListCampaignsParams = {},
  opts: { signal?: AbortSignal } = {},
): Promise<CampaignsListResponse> {
  const q = new URLSearchParams()
  if (params.status?.length) q.set('status', params.status.join(','))
  if (params.search) q.set('search', params.search)
  if (params.flavor?.length) q.set('flavor', params.flavor.join(','))
  if (params.sort) q.set('sort', params.sort)
  if (params.limit != null) q.set('limit', String(params.limit))
  if (params.offset != null) q.set('offset', String(params.offset))
  if (params.archived) q.set('archived', params.archived)
  const query = q.toString()
  const res = await authedFetch<Envelope<CampaignsListResponse>>(
    `${CDK_BASE}/clubs/${clubId}/campaigns${query ? `?${query}` : ''}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

/** GET /clubs/{clubId}/communications/{batchId} — expanded detail (brief 71
 *  extended brief 67's existing CRM route in-place rather than moving it). */
export async function get(
  clubId: number,
  batchId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<CampaignDetail> {
  const res = await authedFetch<Envelope<CampaignDetail>>(
    `${CRM_BASE}/clubs/${clubId}/communications/${batchId}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

/** POST /clubs/{clubId}/communications/{batchId}/resend-unopened — SAM stack. */
export async function resendUnopened(
  clubId: number,
  batchId: number,
  input: ResendUnopenedInput = {},
  opts: { signal?: AbortSignal } = {},
): Promise<ResendUnopenedResult> {
  const res = await authedFetch<Envelope<ResendUnopenedResult>>(
    `${SAM}/clubs/${clubId}/communications/${batchId}/resend-unopened`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

/** POST /clubs/{clubId}/communications/{batchId}/archive — SAM stack. */
export async function archive(
  clubId: number,
  batchId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<ArchiveResult> {
  const res = await authedFetch<Envelope<ArchiveResult>>(
    `${SAM}/clubs/${clubId}/communications/${batchId}/archive`,
    { method: 'POST', signal: opts.signal },
  )
  return res.data
}

/** DELETE /clubs/{clubId}/communications/{batchId}/archive — restore. */
export async function unarchive(
  clubId: number,
  batchId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<ArchiveResult> {
  const res = await authedFetch<Envelope<ArchiveResult>>(
    `${SAM}/clubs/${clubId}/communications/${batchId}/archive`,
    { method: 'DELETE', signal: opts.signal },
  )
  return res.data
}

/** GET /clubs/{clubId}/campaigns/metrics?window=30d — hero stats. */
export async function metrics(
  clubId: number,
  params: MetricsParams = {},
  opts: { signal?: AbortSignal } = {},
): Promise<CampaignsMetricsResponse> {
  const q = new URLSearchParams()
  if (params.window) q.set('window', params.window)
  const query = q.toString()
  const res = await authedFetch<Envelope<CampaignsMetricsResponse>>(
    `${CDK_BASE}/clubs/${clubId}/campaigns/metrics${query ? `?${query}` : ''}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

/** POST /clubs/{clubId}/unsubscribes/{email}/resubscribe — admin override. */
export async function resubscribe(
  clubId: number,
  email: string,
  opts: { signal?: AbortSignal } = {},
): Promise<{ resubscribed_at: string }> {
  const res = await authedFetch<Envelope<{ resubscribed_at: string }>>(
    `${CDK_BASE}/clubs/${clubId}/unsubscribes/${encodeURIComponent(email)}/resubscribe`,
    { method: 'POST', signal: opts.signal },
  )
  return res.data
}
