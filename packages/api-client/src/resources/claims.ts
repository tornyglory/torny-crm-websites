// Claim + platform-admin queue endpoints. See docs/backend-briefs/08.
//
// All routes here live on the CRM_BASE and require the JWT (Authorization
// header attached by authedFetch from localStorage `torny.token`).

import { CRM_BASE } from '../config'
import { authedFetch } from '../http'
import type { AuthUser } from './auth'

// ── Types ──────────────────────────────────────────────────────

export type ClaimStatus = 'pending' | 'approved' | 'rejected'
export type Sport = 'bowls' | 'tennis' | 'golf' | 'cricket' | 'petanque' | 'croquet'
export type RejectionCode = 'user_reject' | 'sibling_approved'

/** Response shape for GET /claims/mine (claimant-side row). */
export interface MyClaim {
  id: number
  directoryClubId: number
  clubName: string
  region: string
  sport: Sport
  role: string
  status: ClaimStatus
  submittedAt: string
  decidedAt: string | null
  rejectionReason: string | null
  rejectionCode: RejectionCode | null
}

/** Response shape for GET /admin/claims (platform-admin queue). */
export interface AdminClaim {
  id: number
  status: ClaimStatus
  clubId: number
  clubName: string
  region: string
  sport: Sport
  claimant: {
    id: number
    firstName: string
    lastName: string
    email: string
    avatarUrl: string | null
    role: string
  }
  evidence: string
  submittedAt: string
  decidedAt: string | null
  decidedBy: string | null
  rejectionReason: string | null
  rejectionCode: RejectionCode | null
}

// ── Request payloads ───────────────────────────────────────────

export interface SubmitClaimInput {
  directoryClubId: number
  role: string
  evidence: string
}

export interface SubmitClaimResponse {
  id: number
  directoryClubId: number
  status: 'pending'
  submittedAt: string
}

export interface ApproveClaimResponse {
  id: number
  status: 'approved'
  decidedAt: string
  decidedBy: string
  clubId: number
}

export interface RejectClaimResponse {
  id: number
  status: 'rejected'
  decidedAt: string
  decidedBy: string
  rejectionReason: string
}

// ── Envelope helper ────────────────────────────────────────────

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Endpoints ──────────────────────────────────────────────────

/** POST /claims — submit a claim. */
export async function submit(input: SubmitClaimInput, opts: { signal?: AbortSignal } = {}) {
  const res = await authedFetch<Envelope<SubmitClaimResponse>>(`${CRM_BASE}/claims`, {
    method: 'POST',
    body: JSON.stringify(input),
    signal: opts.signal,
  })
  return res.data
}

/** GET /claims/mine — the caller's claims, newest first. */
export async function mine(opts: { signal?: AbortSignal } = {}): Promise<MyClaim[]> {
  const res = await authedFetch<Envelope<{ claims: MyClaim[] }>>(`${CRM_BASE}/claims/mine`, {
    signal: opts.signal,
  })
  return res.data.claims
}

/** GET /admin/claims — platform-admin queue. Paginated with an opaque cursor. */
export async function adminList(
  params: { status?: ClaimStatus | 'all'; cursor?: string; limit?: number } = {},
  opts: { signal?: AbortSignal } = {},
): Promise<{ claims: AdminClaim[]; nextCursor: string | null }> {
  const qs = new URLSearchParams({
    status: params.status ?? 'pending',
    limit: String(params.limit ?? 50),
  })
  if (params.cursor) qs.set('cursor', params.cursor)
  const res = await authedFetch<Envelope<{ claims: AdminClaim[]; nextCursor: string | null }>>(
    `${CRM_BASE}/admin/claims?${qs}`,
    { signal: opts.signal },
  )
  return res.data
}

/** POST /admin/claims/:id/approve — atomic. */
export async function approve(claimId: number, opts: { signal?: AbortSignal } = {}) {
  const res = await authedFetch<Envelope<ApproveClaimResponse>>(
    `${CRM_BASE}/admin/claims/${claimId}/approve`,
    { method: 'POST', body: '{}', signal: opts.signal },
  )
  return res.data
}

/** POST /admin/claims/:id/reject — reason required, 10–500 chars. */
export async function reject(claimId: number, reason: string, opts: { signal?: AbortSignal } = {}) {
  const res = await authedFetch<Envelope<RejectClaimResponse>>(
    `${CRM_BASE}/admin/claims/${claimId}/reject`,
    { method: 'POST', body: JSON.stringify({ reason }), signal: opts.signal },
  )
  return res.data
}

/** GET /me — fresh user + clubs[]. */
export async function me(opts: { signal?: AbortSignal } = {}): Promise<AuthUser> {
  const res = await authedFetch<Envelope<AuthUser>>(`${CRM_BASE}/me`, {
    signal: opts.signal,
  })
  return res.data
}
