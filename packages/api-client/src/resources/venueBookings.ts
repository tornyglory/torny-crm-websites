// Venue bookings — backend brief 62 (v1 shipped 2026-11-04).
//
// Supersedes the enquiry-row workaround that lived at
// `enquiries.create({ topic: 'facilities', message: '…plaintext…' })`.
// New submits land in `venue_bookings` directly with structured fields;
// the CRM reads from this endpoint instead of filtering the Enquiries
// list on topic=facilities.
//
// Same stack as venue packages (brief 73) — `VENUE_BASE`. Admin routes
// under `/clubs/:cid/venue-bookings/*`, public submit under
// `/public/clubs/:slug/venue-bookings`.
//
// Platform-fee + Stripe fields are nullable in v1 — they populate when
// brief 72 (Stripe Connect) ships. Schema is ready; no migration
// needed at that point.

import { VENUE_BASE } from '../config'
import { authedFetch, publicFetch } from '../http'

// ── Domain types ─────────────────────────────────────────────────

export type BookingStatus = 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'completed'
export type VenuePaymentStatus = 'unpaid' | 'deposit_paid' | 'paid' | 'refunded' | 'partially_refunded'
export type BookingSource = 'public_submit' | 'admin_create' | 'migrated_enquiry'

/** One frozen add-on line on a booking. Snapshotted at submit time so
 *  renaming / repricing the package addon doesn't rewrite history. */
export interface AddonLine {
  addon_id: number
  name: string
  price_cents: number
  price_suffix: string | null
  quantity: number
  line_cents: number
}

/** The authoritative booking shape. Returned by every admin endpoint +
 *  the public submit. Nullable fields are the ones that only populate
 *  after an admin action (confirm/decline/cancel) or in a later brief
 *  (payment status, platform fee). */
export interface VenueBooking {
  id: number
  booking_ref: string

  venue_package_id: number | null
  venue_slot_id: number | null
  package_name_snapshot: string | null
  slot_label_snapshot: string | null
  addons_snapshot: AddonLine[]

  full_name: string
  email: string
  phone: string | null
  attendee_count: number | null
  message: string | null

  /** ISO YYYY-MM-DD */
  booking_date: string
  /** HH:MM:SS — copied from slot.default_start_time at submit. */
  start_time: string | null
  end_time: string | null

  // Pricing snapshot (frozen at submit)
  slot_price_cents: number
  addons_total_cents: number
  bond_cents: number
  subtotal_cents: number           // slot + addons
  total_cents: number              // subtotal + bond
  deposit_percent_snapshot: number
  deposit_cents: number
  balance_cents: number
  balance_due_date: string | null  // booking_date − club.balance_due_days_before

  /** Populated when the club was Stripe-connected at submit time
   *  (brief 72 PR #2). Null for offline-pay flows. */
  platform_fee_percent_snapshot: number | null
  /** Snapshot in cents. Null for offline-pay flows. */
  platform_fee_cents: number | null

  // Stripe plumbing — brief 72 PR #2. All null when the club is on the
  // offline-pay flow. Populated by confirm (checkout_session_id),
  // webhook (payment_intent_id), or admin refund (refund_id).
  stripe_payment_intent_id: string | null
  stripe_checkout_session_id: string | null
  stripe_refund_id: string | null
  /** ISO 8601 — set by the `checkout.session.completed` webhook. */
  deposit_paid_at: string | null
  /** ISO 8601 — set by the `charge.refunded` webhook. */
  refunded_at: string | null
  /** Transient — present ONLY on the confirm response when Stripe is
   *  triggered. Not persisted on the row (Stripe re-mints on fetch).
   *  Falsy on GET detail responses. */
  checkout_url?: string | null

  // Workflow state
  status: BookingStatus
  payment_status: VenuePaymentStatus
  admin_notes: string | null
  confirmed_at: string | null
  confirmed_by_user_id: number | null
  declined_at: string | null
  declined_by_user_id: number | null
  decline_reason: string | null
  cancelled_at: string | null
  cancelled_by_user_id: number | null

  source: BookingSource
  created_at: string
  updated_at: string
}

// ── Query params + list envelope ────────────────────────────────

export interface ListVenueBookingsParams {
  /** Multiple statuses OR together. Omit → return every status. */
  status?: BookingStatus[]
  search?: string
  sort?: 'newest' | 'oldest'
  limit?: number
  offset?: number
  include_deleted?: boolean
}

/** `counts` respects `search` + `include_deleted` but NOT `status` —
 *  tab badges on the CRM show how many are in each state within the
 *  current search, independent of the active status filter. */
export interface VenueBookingCounts {
  pending: number
  confirmed: number
  declined: number
  cancelled: number
  completed: number
  total: number
}

export interface VenueBookingsListResponse {
  bookings: VenueBooking[]
  counts: VenueBookingCounts
  pagination: { limit: number; offset: number; total: number }
}

// ── Public submit input ─────────────────────────────────────────

export interface SubmitVenueBookingInput {
  full_name: string
  email: string
  phone?: string
  attendee_count?: number
  message?: string
  /** YYYY-MM-DD, must not be in the past. */
  booking_date: string
  package_id: number
  slot_id: number
  /** Each item is `{ addon_id, quantity? }`. Quantity is ignored for
   *  non-countable addons (forced to 1 server-side). */
  addons?: Array<{ addon_id: number; quantity?: number }>
}

export interface VenueBookingDeleteResult {
  deleted: true
  booking_id?: number
  already_deleted?: boolean
}

/** Error codes brief 62 §1-§5. Lets the CRM switch on code and map to
 *  user-friendly toasts rather than parse raw error messages. */
export type VenueBookingErrorCode =
  | 'bad_full_name'
  | 'bad_email'
  | 'bad_booking_date'
  | 'bad_package_id'
  | 'bad_slot_id'
  | 'bad_addon'
  | 'bad_addon_quantity'
  | 'bad_attendee_count'
  | 'package_inactive'
  | 'slot_disabled'
  | 'venue_hire_paused'
  | 'bad_status_transition'
  | 'forbidden'
  | 'not_found'

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Admin endpoints ─────────────────────────────────────────────

/** `GET /clubs/:cid/venue-bookings` — paginated inbox. */
export async function list(
  clubId: number,
  params: ListVenueBookingsParams = {},
  opts: { signal?: AbortSignal } = {},
): Promise<VenueBookingsListResponse> {
  const qs = new URLSearchParams()
  if (params.status && params.status.length > 0) qs.set('status', params.status.join(','))
  if (params.search != null && params.search.length > 0) qs.set('search', params.search)
  if (params.sort && params.sort !== 'newest') qs.set('sort', params.sort)
  if (params.limit != null) qs.set('limit', String(params.limit))
  if (params.offset != null) qs.set('offset', String(params.offset))
  if (params.include_deleted) qs.set('include_deleted', '1')

  const url = qs.toString().length > 0
    ? `${VENUE_BASE}/clubs/${clubId}/venue-bookings?${qs.toString()}`
    : `${VENUE_BASE}/clubs/${clubId}/venue-bookings`

  const res = await authedFetch<Envelope<VenueBookingsListResponse>>(url, {
    method: 'GET',
    signal: opts.signal,
  })
  return res.data
}

/** `GET /clubs/:cid/venue-bookings/:bookingId` — full detail. */
export async function get(
  clubId: number,
  bookingId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<VenueBooking> {
  const res = await authedFetch<Envelope<VenueBooking>>(
    `${VENUE_BASE}/clubs/${clubId}/venue-bookings/${bookingId}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

/** `POST /clubs/:cid/venue-bookings/:bookingId/confirm` — pending → confirmed.
 *  409 if the booking isn't `pending`. */
export async function confirm(
  clubId: number,
  bookingId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<VenueBooking> {
  const res = await authedFetch<Envelope<VenueBooking>>(
    `${VENUE_BASE}/clubs/${clubId}/venue-bookings/${bookingId}/confirm`,
    { method: 'POST', body: '{}', signal: opts.signal },
  )
  return res.data
}

/** `POST /clubs/:cid/venue-bookings/:bookingId/decline` — pending →
 *  declined. Optional reason stored on the row + included in the
 *  customer email. */
export async function decline(
  clubId: number,
  bookingId: number,
  reason?: string,
  opts: { signal?: AbortSignal } = {},
): Promise<VenueBooking> {
  const body: Record<string, string> = {}
  if (reason != null && reason.trim().length > 0) body.reason = reason
  const res = await authedFetch<Envelope<VenueBooking>>(
    `${VENUE_BASE}/clubs/${clubId}/venue-bookings/${bookingId}/decline`,
    { method: 'POST', body: JSON.stringify(body), signal: opts.signal },
  )
  return res.data
}

/** `POST /clubs/:cid/venue-bookings/:bookingId/cancel` — confirmed →
 *  cancelled. 409 from any other state. */
export async function cancel(
  clubId: number,
  bookingId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<VenueBooking> {
  const res = await authedFetch<Envelope<VenueBooking>>(
    `${VENUE_BASE}/clubs/${clubId}/venue-bookings/${bookingId}/cancel`,
    { method: 'POST', body: '{}', signal: opts.signal },
  )
  return res.data
}

/** `POST /clubs/:cid/venue-bookings/:bookingId/refund` — admin+ (brief
 *  72 PR #2). Triggers a Stripe refund on the connected account with
 *  `refund_application_fee: true` so Torny proportionally returns its
 *  cut. The response carries `stripe_refund_id` immediately, but
 *  `payment_status` + `refunded_at` populate when the
 *  `charge.refunded` webhook fires (~2s). FE should re-fetch after a
 *  short delay or on the next admin visit. */
export async function refund(
  clubId: number,
  bookingId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<VenueBooking> {
  const res = await authedFetch<Envelope<VenueBooking>>(
    `${VENUE_BASE}/clubs/${clubId}/venue-bookings/${bookingId}/refund`,
    { method: 'POST', body: '{}', signal: opts.signal },
  )
  return res.data
}

/** `DELETE /clubs/:cid/venue-bookings/:bookingId` — soft-delete.
 *  Idempotent — a second delete returns `already_deleted: true`. */
export async function remove(
  clubId: number,
  bookingId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<VenueBookingDeleteResult> {
  const res = await authedFetch<Envelope<VenueBookingDeleteResult>>(
    `${VENUE_BASE}/clubs/${clubId}/venue-bookings/${bookingId}`,
    { method: 'DELETE', signal: opts.signal },
  )
  return res.data
}

// ── Public submit ───────────────────────────────────────────────

/** `POST /public/clubs/:slug/venue-bookings` — no auth. Rate-limited
 *  by IP per the brief. Returns the full booking shape including the
 *  generated booking_ref so the confirmation page can quote it. */
export async function submit(
  slug: string,
  input: SubmitVenueBookingInput,
  opts: { signal?: AbortSignal } = {},
): Promise<VenueBooking> {
  const res = await publicFetch<Envelope<VenueBooking>>(
    `${VENUE_BASE}/public/clubs/${encodeURIComponent(slug)}/venue-bookings`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

// ── Public Stripe Checkout (brief 77) ───────────────────────────

/** Response from the public checkout endpoint. The FE immediately
 *  does `window.location.href = checkout_url` to send the renter to
 *  Stripe-hosted Checkout. All *_cents fields match the booking row. */
export interface VenueBookingCheckoutResult {
  venue_booking_id: number
  booking_ref: string
  total_cents: number
  deposit_cents: number
  platform_fee_cents: number
  club_receives_cents: number
  currency: string
  checkout_url: string
  checkout_session_id: string
}

/** 409 `club_not_payment_ready` response body. Surface the club_contact
 *  so the renter can call / email them directly as a fallback. */
export interface ClubNotPaymentReadyData {
  club_contact: {
    name: string
    email: string | null
    phone: string | null
  }
}

/** `POST /public/clubs/:slug/venue-bookings/checkout` — public, no auth.
 *  Creates the booking row + a Stripe Checkout Session on the club's
 *  connected account in one call. Returns the Stripe-hosted URL. */
export async function checkout(
  slug: string,
  input: SubmitVenueBookingInput,
  opts: { signal?: AbortSignal } = {},
): Promise<VenueBookingCheckoutResult> {
  const res = await publicFetch<Envelope<VenueBookingCheckoutResult>>(
    `${VENUE_BASE}/public/clubs/${encodeURIComponent(slug)}/venue-bookings/checkout`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

// ── Public availability lookup (brief 84) ───────────────────────

/** One already-taken slot inside the queried window. */
export interface TakenSlot {
  /** ISO date `YYYY-MM-DD`. */
  date: string
  slot_id: number
  package_id: number
}

export interface VenueAvailabilityResult {
  taken: TakenSlot[]
}

/** `GET /public/clubs/:slug/venue-availability?from=…&to=…[&package_id=…]`
 *  — returns every taken slot in the window (confirmed + pending + fresh
 *  <24h pending_payment). FE derives "fully booked" per-date by intersecting
 *  with the selected package's slot list. Public, 60s cacheable. */
export async function publicAvailability(
  slug: string,
  from: string,
  to: string,
  opts: { packageId?: number; signal?: AbortSignal } = {},
): Promise<VenueAvailabilityResult> {
  const qs = new URLSearchParams({ from, to })
  if (opts.packageId != null) qs.set('package_id', String(opts.packageId))
  const res = await publicFetch<Envelope<VenueAvailabilityResult>>(
    `${VENUE_BASE}/public/clubs/${encodeURIComponent(slug)}/venue-availability?${qs.toString()}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}
