// Bulk email — SES migration (backend brief follow-up to §45 email templates).
//
// POST /clubs/{club_id}/members/bulk-email
//
// Composed in the CRM as raw `body_html` + `subject`; the server wraps every
// message in the club's saved header/footer from the email-template resource
// and substitutes {{tokens}} per recipient.
//
// URL host: primary CDK API (the one MEDIA_BASE points at). Not the SAM /
// CRM APIs. Uses the same JWT.

import { MEDIA_BASE } from '../config'
import { authedFetch } from '../http'

// ── Recipient selection ───────────────────────────────────────────

/** Send to an explicit list of user IDs. */
export interface BulkEmailRecipientsIds {
  mode: 'ids'
  user_ids: number[]
}

/** Send to everyone matching a roster filter. Same shape as
 *  `ListRosterParams` on the members resource — server resolves the
 *  filter to a concrete recipient list at send time. */
export interface BulkEmailRecipientsFilter {
  mode: 'filter'
  filter: {
    status?: 'all' | 'active' | 'pending' | 'lapsed'
    role?: 'owner' | 'admin' | 'committee' | 'player'
    search?: string
  }
}

export type BulkEmailRecipients = BulkEmailRecipientsIds | BulkEmailRecipientsFilter

// ── Request / response ────────────────────────────────────────────

export interface BulkEmailInput {
  /** Subject line — `{{tokens}}` substituted per-recipient. */
  subject: string
  /** HTML body — `{{tokens}}` substituted per-recipient. Server wraps
   *  in the club's saved header + footer before sending. */
  body_html: string
  recipients: BulkEmailRecipients
}

export interface BulkEmailFailedRecipient {
  user_id: number
  email: string
  reason: string
}

export interface BulkEmailResult {
  batch_id: number
  /** How many members matched the recipient selection. */
  matched: number
  /** How many SES accepted for delivery. */
  sent_count: number
  /** How many SES rejected (unverified sender during setup, throttling, etc). */
  failed_count: number
  failed: BulkEmailFailedRecipient[]
}

export type BulkEmailErrorCode =
  | 'missing_subject'
  | 'missing_body'
  | 'no_recipients'

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Endpoint ──────────────────────────────────────────────────────

/**
 * POST /clubs/{clubId}/members/bulk-email
 *
 * Sends immediately — no draft, no schedule. Admin+ role required.
 */
export async function send(
  clubId: number,
  input: BulkEmailInput,
  opts: { signal?: AbortSignal } = {},
): Promise<BulkEmailResult> {
  const res = await authedFetch<Envelope<BulkEmailResult>>(
    `${MEDIA_BASE}/clubs/${clubId}/members/bulk-email`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}
