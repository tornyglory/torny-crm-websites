// Bulk member import — POST /clubs/:clubId/members/import/{preview,commit}.
// See docs/backend-briefs/09-bulk-member-import-live.md for the contract.
//
// The endpoints live on CRM_BASE and require a JWT with owner/admin role
// on the target club.

import { CRM_BASE } from '../config'
import { authedFetch } from '../http'

// ── Types (mirrors brief 09 §9) ────────────────────────────────

export type ImportResolution =
  | 'linked'
  | 'relinked'
  | 'skipped'
  | 'invited'
  | 'stub_created'
  | 'error'

export type ImportErrorCode =
  | 'invalid_email'
  | 'invalid_phone'
  | 'duplicate_in_csv'
  | 'missing_required'
  | 'conflict'
  | 'invalid_dob'

export type NewUserStrategy = 'invite' | 'stub'

export interface ConflictCandidate {
  userId: number
  matchedVia: string
  name: string
  avatarUrl: string | null
}

export interface PreviewRowError {
  code: ImportErrorCode
  message: string
  candidates?: ConflictCandidate[]
}

export interface PreviewRowWarning {
  code: string
  message: string
}

export interface PreviewRow {
  rowNumber: number
  email: string | null
  phone: string | null
  displayName: string | null
  resolution: ImportResolution
  matchedUserId: number | null
  matchedVia: 'email' | 'phone' | 'none'
  existingName: string | null
  existingAvatar: string | null
  phoneMismatch: boolean
  emailMismatch: boolean
  warnings?: PreviewRowWarning[]
  error: PreviewRowError | null
}

export interface PreviewSummary {
  totalRows: number
  willSkip: number
  willLink: number
  willRelink: number
  willInvite: number
  willStub: number
  errors: number
}

export interface PreviewResult {
  importId: number
  expiresInMinutes: number
  newUserStrategy: NewUserStrategy
  summary: PreviewSummary
  rows: PreviewRow[]
}

export interface CommitRowResult {
  rowNumber: number
  resolution: ImportResolution
  stubUserId?: number
  failed?: boolean
  message?: string
}

export interface CommitResult {
  importId: number
  committed: boolean
  replayed: boolean
  actualCounts: {
    linked: number
    relinked: number
    invited: number
    stubCreated: number
    skipped: number
    failed: number
  }
  notificationsFired: {
    pushSent: number
    emailsSent: number
  }
  rows: CommitRowResult[]
}

// ── Request payloads ───────────────────────────────────────────

export interface PreviewRowInput {
  rowNumber: number
  email?: string
  phone?: string
  firstName?: string
  lastName?: string
  dob?: string
  membershipType?: string
}

export interface PreviewInput {
  rows: PreviewRowInput[]
  newUserStrategy?: NewUserStrategy
  originalFilename?: string
}

// ── Envelope ───────────────────────────────────────────────────

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Endpoints ──────────────────────────────────────────────────

/** POST /clubs/:clubId/members/import/preview — dry-run analysis. */
export async function preview(
  clubId: number,
  input: PreviewInput,
  opts: { signal?: AbortSignal } = {},
): Promise<PreviewResult> {
  const res = await authedFetch<Envelope<PreviewResult>>(
    `${CRM_BASE}/clubs/${clubId}/members/import/preview`,
    {
      method: 'POST',
      body: JSON.stringify(input),
      signal: opts.signal,
    },
  )
  return res.data
}

/** POST /clubs/:clubId/members/import/commit — apply the preview plan. */
export async function commit(
  clubId: number,
  importId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<CommitResult> {
  const res = await authedFetch<Envelope<CommitResult>>(
    `${CRM_BASE}/clubs/${clubId}/members/import/commit`,
    {
      method: 'POST',
      body: JSON.stringify({ importId }),
      signal: opts.signal,
    },
  )
  return res.data
}
