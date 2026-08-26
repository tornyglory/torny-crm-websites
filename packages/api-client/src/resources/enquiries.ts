// Contact-form enquiries — backend brief 41.
//
// The join form's smaller sibling: a public POST that fires a notification
// to the club's Enquiries inbox (brief 40 kind='enquiry'). Rate-limited by
// IP. See brief 41 §1 for the payload shape.

import { CRM_BASE } from '../config'
import { publicFetch } from '../http'

export type EnquiryTopic =
  | 'membership'
  | 'events'
  | 'facilities'
  | 'general'
  | 'media'

export interface CreateEnquiryInput {
  full_name: string
  email: string
  phone?: string | null
  topic: EnquiryTopic
  message: string
  consent_reply: boolean
}

export interface CreateEnquiryResult {
  enquiry_id: number
  received_at: string
}

export type EnquiryErrorCode =
  | 'missing_required'
  | 'bad_email'
  | 'bad_topic'
  | 'bad_message'
  | 'consent_required'
  | 'unknown_club'
  | 'rate_limited'
  | 'enquiries_closed'

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

/** POST /public/clubs/:slug/enquiries — no auth, rate-limited by IP. */
export async function create(
  slug: string,
  input: CreateEnquiryInput,
  opts: { signal?: AbortSignal } = {},
): Promise<CreateEnquiryResult> {
  const res = await publicFetch<Envelope<CreateEnquiryResult>>(
    `${CRM_BASE}/public/clubs/${encodeURIComponent(slug)}/enquiries`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}
