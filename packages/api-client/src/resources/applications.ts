// Membership applications — backend brief 38 (shipped 2026-08-26).
//
// Public POST is called from the join-form block; the four admin endpoints
// (list / detail / approve / reject / add-note) power the CRM Applications
// inbox. Keep the shape in sync with brief 38 §9 (TS types) — the backend
// stores rich extras in payload_json so new fields can be added on the POST
// side without a backend change.

import { CRM_BASE } from '../config'
import { authedFetch, publicFetch } from '../http'

// ── Domain types ─────────────────────────────────────────────────

export type ApplicationStatus = 'pending' | 'approved' | 'rejected'
export type RejectReason = 'unable_to_verify' | 'duplicate' | 'spam' | 'other'
export type Resolution = 'auto' | 'link' | 'invite' | 'stub'
export type ResolvedResult =
  | 'linked' | 'relinked' | 'already_member' | 'stub_created' | 'invited'

export interface ApplicationRow {
  id: number
  status: ApplicationStatus
  full_name: string
  preferred_name: string | null
  email: string
  mobile: string
  tier_id: number | null
  tier_name: string | null
  experience: string | null
  position: string | null
  playing_days: string[] | null
  referrer: string | null
  received_at: string
  reviewed_at: string | null
  reviewer_user_id: number | null
  note_count: number
}

export interface ApplicationAddress {
  street?: string
  suburb?: string
  postcode?: string
  country?: string
  /** Present on legacy rows that only stored a flat text summary. */
  _raw?: string
}

export interface ApplicationBowls {
  experience?: string
  bowls_number?: string | null
  position?: string
  playing_days?: string[]
}

export interface ApplicationEmergencyContact {
  name?: string
  phone?: string
  relationship?: string
}

export interface ApplicationConsent {
  terms?: boolean
  newsletter?: boolean
  photo?: boolean
}

export interface ApplicationNote {
  id: number
  body: string
  author_user_id: number | null
  author_name: string | null
  created_at: string
}

export interface ApplicationDetail extends Omit<ApplicationRow, 'note_count'> {
  dob: string | null
  address: ApplicationAddress
  bowls: ApplicationBowls | null
  emergency_contact: ApplicationEmergencyContact | null
  note: string | null
  consent: ApplicationConsent | null
  linked_user_id: number | null
  notes: ApplicationNote[]
}

export interface ApplicationsListResponse {
  applications: ApplicationRow[]
  counts: { pending: number; approved: number; rejected: number }
  pagination: { limit: number; offset: number; total: number }
}

export interface ListApplicationsParams {
  status?: ApplicationStatus | 'all'
  search?: string
  limit?: number
  offset?: number
  sort?: 'newest' | 'oldest'
}

export interface ApproveInput {
  resolution?: Resolution
  user_id?: number | null
  assigned_number?: number | null
  send_welcome_email?: boolean
}

export interface ApproveResult {
  application_id: number
  status: 'approved'
  resolution: ResolvedResult
  linked_user_id: number | null
  membership_id: number | null
  invite: { accept_token: string; accept_url: string } | null
  email_status: { sent: true } | { sent: false; error?: string } | { skipped: true }
}

export interface RejectInput {
  reason: RejectReason
  message?: string
}

export interface RejectResult {
  application_id: number
  status: 'rejected'
  reason: RejectReason
  email_status: { sent: true } | { sent: false; error?: string } | { skipped: true }
}

/** Error codes brief 38 §1 — public POST + admin endpoints. */
export type ApplicationErrorCode =
  | 'missing_required'
  | 'bad_email'
  | 'bad_dob'
  | 'unknown_tier'
  | 'consent_required'
  | 'unknown_club'
  | 'rate_limited'
  | 'applications_closed'
  | 'bad_link'
  | 'already_approved'
  | 'already_rejected'
  | 'email_exists'
  | 'missing_body'
  | 'body_too_long'
  | 'not_found'

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Public — the join-form POST ──────────────────────────────────

/** Shape of the payload the join-form block sends. */
export interface CreateApplicationInput {
  tier_id: number | null
  full_name: string
  preferred_name?: string | null
  dob: string
  email: string
  mobile: string
  address: {
    street: string
    suburb: string
    postcode: string
    country?: string | null
  }
  bowls: ApplicationBowls
  emergency_contact: {
    name: string
    phone: string
    relationship?: string | null
  }
  note?: string | null
  referrer?: string | null
  consent: {
    terms: boolean
    newsletter?: boolean
    photo?: boolean
  }
}

export interface CreateApplicationResult {
  application_id: number
  status: 'pending'
  received_at: string
}

/** POST /public/clubs/:slug/applications — no auth, rate-limited by IP. */
export async function create(
  slug: string,
  input: CreateApplicationInput,
  opts: { signal?: AbortSignal } = {},
): Promise<CreateApplicationResult> {
  const res = await publicFetch<Envelope<CreateApplicationResult>>(
    `${CRM_BASE}/public/clubs/${encodeURIComponent(slug)}/applications`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

// ── CRM inbox ────────────────────────────────────────────────────

export async function list(
  clubId: number,
  params: ListApplicationsParams = {},
  opts: { signal?: AbortSignal } = {},
): Promise<ApplicationsListResponse> {
  const qs = new URLSearchParams()
  if (params.status && params.status !== 'pending') qs.set('status', params.status)
  if (params.search != null && params.search.length > 0) qs.set('search', params.search)
  if (params.limit != null) qs.set('limit', String(params.limit))
  if (params.offset != null) qs.set('offset', String(params.offset))
  if (params.sort && params.sort !== 'newest') qs.set('sort', params.sort)

  const url = qs.toString().length
    ? `${CRM_BASE}/clubs/${clubId}/applications?${qs.toString()}`
    : `${CRM_BASE}/clubs/${clubId}/applications`

  const res = await authedFetch<Envelope<ApplicationsListResponse>>(url, {
    method: 'GET',
    signal: opts.signal,
  })
  return res.data
}

export async function get(
  clubId: number,
  applicationId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<ApplicationDetail> {
  const res = await authedFetch<Envelope<ApplicationDetail>>(
    `${CRM_BASE}/clubs/${clubId}/applications/${applicationId}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

export async function approve(
  clubId: number,
  applicationId: number,
  input: ApproveInput = {},
  opts: { signal?: AbortSignal } = {},
): Promise<ApproveResult> {
  const res = await authedFetch<Envelope<ApproveResult>>(
    `${CRM_BASE}/clubs/${clubId}/applications/${applicationId}/approve`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

export async function reject(
  clubId: number,
  applicationId: number,
  input: RejectInput,
  opts: { signal?: AbortSignal } = {},
): Promise<RejectResult> {
  const res = await authedFetch<Envelope<RejectResult>>(
    `${CRM_BASE}/clubs/${clubId}/applications/${applicationId}/reject`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

export async function addNote(
  clubId: number,
  applicationId: number,
  body: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ApplicationNote> {
  const res = await authedFetch<Envelope<ApplicationNote>>(
    `${CRM_BASE}/clubs/${clubId}/applications/${applicationId}/notes`,
    { method: 'POST', body: JSON.stringify({ body }), signal: opts.signal },
  )
  return res.data
}
