// Stripe Connect (OAuth plumbing) — brief 72 PR #1 (shipped 2026-11-04).
//
// Clubs authorise Torny as a Stripe platform via the standard
// authorization-code OAuth flow. This resource covers the three admin
// endpoints that drive the UX:
//
//   start()      — mint the Stripe authorize_url + inspect existing state
//   status()     — live-check Stripe for the latest account state
//   disconnect() — owner-only teardown (idempotent)
//
// Payments themselves (PaymentIntents, webhooks, refunds) land in
// brief 72 PR #2 — this file stays focused on the connect lifecycle.
//
// Lives on the same `VENUE_BASE` stack as venue packages + bookings.
// Role gates (enforced server-side; the client surfaces the affordances
// per the same gates):
//   admin+  → start, status (via inheritance)
//   owner   → disconnect
//   committee+ → status (read-only)

import { VENUE_BASE } from '../config'
import { authedFetch } from '../http'

// ── Domain types ─────────────────────────────────────────────────

/** `clubs_data.stripe_account_status` — the single source of truth for
 *  connection health. See brief §4 for UI mapping. */
export type StripeAccountStatus = 'none' | 'onboarding' | 'ready' | 'restricted'

export interface StripeConnectStartResponse {
  /** A full URL ready for `window.location.href = …`. Carries the state
   *  JWT + scope + redirect_uri; nothing for the FE to assemble. */
  authorize_url: string
  /** True if `clubs_data.stripe_account_id` is already set. The FE
   *  should confirm with the admin before replacing an active
   *  connection — re-auth overwrites without disconnecting first. */
  already_connected: boolean
  /** Current status *before* the admin starts the OAuth dance — lets
   *  the FE pick the right CTA copy ("Connect" / "Reconnect" / "Finish
   *  setup"). */
  current_status: StripeAccountStatus
}

export interface StripeStatus {
  connected: boolean
  /** Masked `acct_1NYZ…dX4Q` safe for display. Null when the club
   *  hasn't connected (status `none`). */
  stripe_account_id_masked: string | null
  status: StripeAccountStatus
  /** ISO 8601. Null when not connected. */
  connected_at: string | null
  /** Stripe-returned requirement ids that need completing before the
   *  account can accept payments. Empty when `status` is `ready`. */
  requirements_due: string[]
}

export interface StripeDisconnectResponse {
  disconnected: boolean
  /** Only present when `disconnected: false` because nothing was
   *  connected in the first place. */
  reason?: 'not_connected'
}

/** Error codes brief §3. Surfaced on `?code=…` by the OAuth callback. */
export type StripeConnectErrorCode =
  | 'access_denied'
  | 'bad_state'
  | 'missing_code_or_state'
  | 'forbidden'
  | 'stripe_exchange_failed'
  | 'no_account_id'
  | 'server_error'

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Endpoints ───────────────────────────────────────────────────

/** `POST /clubs/:cid/stripe/connect-start` — mint the authorize URL.
 *  The FE's entire job after this is `window.location.href = res.authorize_url`. */
export async function start(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<StripeConnectStartResponse> {
  const res = await authedFetch<Envelope<StripeConnectStartResponse>>(
    `${VENUE_BASE}/clubs/${clubId}/stripe/connect-start`,
    { method: 'POST', body: '{}', signal: opts.signal },
  )
  return res.data
}

/** `GET /clubs/:cid/stripe/status` — live-check Stripe for the current
 *  account state. Catches an `onboarding → ready` bump without waiting
 *  for the webhook; gracefully degrades to stored state when Stripe is
 *  unreachable. */
export async function status(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<StripeStatus> {
  const res = await authedFetch<Envelope<StripeStatus>>(
    `${VENUE_BASE}/clubs/${clubId}/stripe/status`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

/** `POST /clubs/:cid/stripe/disconnect` — owner-only teardown.
 *  Idempotent: calling on an already-disconnected club returns
 *  `{ disconnected: false, reason: 'not_connected' }`. Non-fatal if
 *  Stripe's deauthorize call fails (we still null the local state). */
export async function disconnect(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<StripeDisconnectResponse> {
  const res = await authedFetch<Envelope<StripeDisconnectResponse>>(
    `${VENUE_BASE}/clubs/${clubId}/stripe/disconnect`,
    { method: 'POST', body: '{}', signal: opts.signal },
  )
  return res.data
}
