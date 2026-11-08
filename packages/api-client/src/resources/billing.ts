// Settings → Billing — backend brief 88 §3.
//
// Three endpoints on VENUE_BASE for existing clubs (not the signup
// wizard — that flow lives in resources/auth.ts::signup).
//
//   GET  /clubs/:cid/plan              — current plan + subscription state
//   POST /clubs/:cid/billing/checkout  — mint a Stripe Checkout URL (upgrade / downgrade)
//   POST /clubs/:cid/billing/portal    — mint a Stripe Billing Portal URL (manage card, cancel)

import { VENUE_BASE } from '../config'
import { authedFetch } from '../http'

export type PlanKey = 'starter' | 'pro'

/** Mirrors Stripe's subscription.status exactly, plus a 'none' state for
 *  orgs that have never run through Checkout yet. */
export type SubscriptionStatus =
  | 'none'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused'
  | 'incomplete'
  | 'incomplete_expired'

export type PlanSource = 'derived' | 'manual'

export interface PlanState {
  plan: PlanKey
  display_name: string
  monthly_price_cents: number
  features: string[]
  is_pro: boolean
  upgradeable_to: PlanKey[]
  plan_source: PlanSource
  subscription_status: SubscriptionStatus
  /** RFC3339 — set while a trial is running. */
  trial_ends_at: string | null
  /** RFC3339 — end of the current billing period. */
  current_period_end: string | null
  /** True once the org has at least gone through Checkout once. Drives
   *  whether the FE offers Checkout or the Billing Portal. */
  has_stripe_customer: boolean
}

export interface CheckoutInput {
  plan: PlanKey
  success_url: string
  cancel_url: string
}

export interface CheckoutResult {
  checkout_url: string
  session_id: string
}

export interface PortalInput {
  return_url: string
}

export interface PortalResult {
  portal_url: string
}

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

/** `GET /clubs/:cid/plan` — admin+. Drives Settings → Billing. */
export async function get(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<PlanState> {
  const res = await authedFetch<Envelope<PlanState>>(
    `${VENUE_BASE}/clubs/${clubId}/plan`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

/** `POST /clubs/:cid/billing/checkout` — admin+. Returns a Stripe
 *  Checkout URL the FE should window.location.href to. Webhook flips
 *  `subscription_status` + `plan` once the admin pays. */
export async function checkout(
  clubId: number,
  input: CheckoutInput,
  opts: { signal?: AbortSignal } = {},
): Promise<CheckoutResult> {
  const res = await authedFetch<Envelope<CheckoutResult>>(
    `${VENUE_BASE}/clubs/${clubId}/billing/checkout`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

/** `POST /clubs/:cid/billing/portal` — admin+. 409 `no_stripe_customer`
 *  when the org has never subscribed — route to `checkout()` instead. */
export async function portal(
  clubId: number,
  input: PortalInput,
  opts: { signal?: AbortSignal } = {},
): Promise<PortalResult> {
  const res = await authedFetch<Envelope<PortalResult>>(
    `${VENUE_BASE}/clubs/${clubId}/billing/portal`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}
