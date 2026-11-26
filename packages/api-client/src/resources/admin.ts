// Platform admin portal — backend brief 123 §7.1 (live doc).
//
// Phase 1 is read-only: accounts list + detail + two metrics dashboards.
// Phase 2 (impersonate, plan-override, suspend/unsuspend, audit, users
// reshape) and Phase 3 (transactions drilldown, communications, system
// health) will extend this file — keep the exports additive.
//
// Endpoints:
//   GET /admin/accounts                 — list with filters + sort + search + cursor pagination
//   GET /admin/accounts/:id             — detail + timeline
//   GET /admin/metrics/overview         — platform dashboard
//   GET /admin/metrics/billing          — billing dashboard
//
// URL note: admin endpoints live on VENUE_BASE (same as every recent
// admin-adjacent endpoint — TornyCrmStack is at the CloudFormation 500-
// resource cap).
//
// Role gate: every endpoint requires an authed session with
// `users.is_platform_admin = 1`. Non-admins get `403 not_platform_owner`
// with a spartan body (no shape hints).

import { VENUE_BASE } from '../config'
import { authedFetch } from '../http'
import type { PlanKey } from './billing'

interface Envelope<T> {
  status: 'success'
  data: T
}

// ── Shared enums ────────────────────────────────────────────────

/** Trailing-window selector shared across list + both metrics endpoints.
 *  The server renames windowed fields (`bookings_30d` → `bookings_7d`
 *  etc.) based on this — see AdminAccountRow's index signatures. */
export type AdminWindow = '7d' | '30d' | '90d' | 'ytd' | 'all'

/** Phase 1 `plan` as surfaced on the row — `'comped'` is a derived value
 *  the backend emits when `plan_source === 'manual'`. Use `plan_actual`
 *  when you need the raw DB value. */
export type AdminAccountPlan = 'starter' | 'pro' | 'comped'

/** Phase 1 subscription status — narrower than the full Stripe set
 *  until the webhook mirror lands (Phase 2). */
export type AdminAccountSubscriptionStatus = 'active' | 'inactive' | 'suspended'

/** Sortable columns — `-` prefix for desc. Default `-last_login`. */
export type AdminAccountSort =
  | 'mrr' | '-mrr'
  | 'revenue' | '-revenue'
  | 'members' | '-members'
  | 'signup' | '-signup'
  | 'last_login' | '-last_login'
  | 'bookings' | '-bookings'
  | 'tournament_gmv' | '-tournament_gmv'

/** Timeline event kinds known in Phase 1. The server will emit more
 *  (`addon_added`, `payment_failed`, `impersonated`, …) in Phase 2+ —
 *  callers MUST render unknown `kind` values gracefully so new kinds
 *  landing server-side don't require a FE release. */
export type AdminTimelineKind =
  | 'signup'
  | 'suspended'
  | 'plan_change'
  | (string & {}) // forward-compat — allows any string but preserves autocomplete on the known values

// ── Row + detail ────────────────────────────────────────────────

/** Account row — index signatures carry the windowed fields so TS stays
 *  strict even though the server renames them (`_30d → _7d` etc.).
 *  Access them as `row[`bookings_${currentWindow}`]`. */
export interface AdminAccountRow {
  id: number
  name: string
  subdomain: string
  owner_email: string | null
  signup_at: string | null
  last_admin_login_at: string | null

  plan: AdminAccountPlan
  /** The raw DB plan — useful when `plan === 'comped'` (then this is
   *  the real underlying plan, ignoring the override). */
  plan_actual: PlanKey
  plan_source: 'derived' | 'manual'
  subscription_status: AdminAccountSubscriptionStatus
  mrr_cents: number
  /** Platform-fee lifetime, bookings + tournament entries + add-ons. */
  lifetime_revenue_cents: number
  /** Brief 122 — active entitlement ids. Empty until the first paid
   *  add-on ships. */
  addons: string[]

  member_count: number

  /** Windowed metrics — field suffix mirrors the `?window` param. */
  [key: `member_joins_${string}`]: number
  [key: `bookings_${string}`]: number
  [key: `bookings_gmv_${string}_cents`]: number
  [key: `tournament_entries_${string}`]: number
  [key: `tournament_gmv_${string}_cents`]: number
  [key: `emails_sent_${string}`]: number
  [key: `platform_take_${string}_cents`]: number

  flags: {
    /** Phase 2 — Stripe webhook mirror. Always `false` in Phase 1. */
    past_due: boolean
    /** Phase 3 — SES stats. Always `false` in Phase 1. */
    high_bounce_rate: boolean
    suspended: boolean
    /** ISO when `plan_source === 'manual'`; null otherwise. */
    comped_until: string | null
  }
}

export interface AdminTimelineEvent {
  at: string
  kind: AdminTimelineKind
  /** Shape varies by kind — treat as unknown and narrow at the render
   *  site. Backend may add new kinds without a FE deploy, so the
   *  renderer should fall back to a generic chip for unknown kinds. */
  detail: unknown
}

export interface AdminAccountDetail {
  account: AdminAccountRow
  timeline: AdminTimelineEvent[]
}

export interface AdminAccountsList {
  items: AdminAccountRow[]
  next_cursor: string | null
  /** Approximate — EXPLAIN-cheap on the server, FE should render as
   *  "showing N of ~X". */
  total_count: number
}

// ── Metrics ─────────────────────────────────────────────────────

export interface AdminMetricsOverview {
  window: AdminWindow
  accounts: {
    total: number
    signups_in_window: number
    active_in_window: number
    paying: number
    comped: number
    suspended: number
    /** Phase 2 — Stripe subscription webhook mirror. */
    past_due: number
    /** Phase 2 — needs cancellation event stream. */
    churned_in_window: number
  }
  revenue_cents: {
    mrr: number
    transactional_in_window: number
    total_in_window: number
  }
  activity: {
    bookings_in_window: number
    bookings_gmv_in_window_cents: number
    tournament_entries_in_window: number
    tournament_gmv_in_window_cents: number
    emails_sent_in_window: number
    member_joins_in_window: number
  }
  /** Phase 1 ships empty arrays — Phase 2 fills the 12-point sparkline.
   *  FE should treat an empty array as "no trend data" and render a
   *  placeholder rather than an empty chart. */
  trends: {
    mrr_cents: number[]
    transactional_cents: number[]
    signups: number[]
    churn: number[]
  }
}

export interface AdminMetricsBilling {
  window: AdminWindow
  subscription: {
    mrr_cents: number
    annualised_cents: number
    trend_cents: number[]
  }
  transactional: {
    gmv_cents: number
    platform_take_cents: number
    /** Platform take / GMV. Informational — don't use for anything load-bearing. */
    effective_take_rate: number
    trend_platform_take_cents: number[]
    by_kind: {
      venue_booking_gmv_cents: number
      venue_booking_take_cents: number
      tournament_entry_gmv_cents: number
      tournament_entry_take_cents: number
      /** Brief 122 — zero until paid add-ons ship. */
      addon_gmv_cents: number
      addon_take_cents: number
    }
  }
  /** Phase 2 — Stripe subscription webhook mirror. All zero in Phase 1. */
  failed_payments: {
    past_due_count: number
    past_due_value_cents: number
    retrying: number
  }
  /** Phase 3 — Stripe payouts integration. All zero/null in Phase 1. */
  stripe_payouts: {
    pending_cents: number
    last_payout_at: string | null
    last_payout_cents: number
  }
}

// ── Params ──────────────────────────────────────────────────────

export interface ListAccountsParams {
  window?: AdminWindow
  filter?: {
    plan?: AdminAccountPlan
    /** Phase 1: `'active' | 'suspended'`. More values ship in Phase 2. */
    status?: 'active' | 'suspended'
    inactive_days?: number
    has_transactions?: true
  }
  sort?: AdminAccountSort
  q?: string
  /** Default 50, max 200. */
  limit?: number
  cursor?: string
  signal?: AbortSignal
}

// ── Internal: encode query params ────────────────────────────────

function toQuery(params: Record<string, string | number | boolean | undefined>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue
    qs.set(k, String(v))
  }
  const s = qs.toString()
  return s ? `?${s}` : ''
}

// ── Endpoints ───────────────────────────────────────────────────

/** `GET /admin/accounts` — platform admin only. Paginated list with
 *  filters / sort / search. Field names on the row mutate with the
 *  `window` param — see `AdminAccountRow`. */
export async function listAccounts(
  params: ListAccountsParams = {},
): Promise<AdminAccountsList> {
  const query: Record<string, string | number | boolean | undefined> = {
    window: params.window,
    sort: params.sort,
    q: params.q,
    limit: params.limit,
    cursor: params.cursor,
  }
  // Filters flatten to `filter[key]=value` per the brief's query grammar.
  if (params.filter) {
    for (const [k, v] of Object.entries(params.filter)) {
      if (v === undefined) continue
      query[`filter[${k}]`] = v as string | number | boolean
    }
  }
  const res = await authedFetch<Envelope<AdminAccountsList>>(
    `${VENUE_BASE}/admin/accounts${toQuery(query)}`,
    { method: 'GET', signal: params.signal },
  )
  return res.data
}

/** `GET /admin/accounts/:id` — platform admin only. Row shape as §2 +
 *  a Phase 1 lightweight timeline. */
export async function getAccount(
  id: number,
  params: { window?: AdminWindow; signal?: AbortSignal } = {},
): Promise<AdminAccountDetail> {
  const res = await authedFetch<Envelope<AdminAccountDetail>>(
    `${VENUE_BASE}/admin/accounts/${id}${toQuery({ window: params.window })}`,
    { method: 'GET', signal: params.signal },
  )
  return res.data
}

/** `GET /admin/metrics/overview` — platform dashboard numbers. */
export async function metricsOverview(
  params: { window?: AdminWindow; signal?: AbortSignal } = {},
): Promise<AdminMetricsOverview> {
  const res = await authedFetch<Envelope<AdminMetricsOverview>>(
    `${VENUE_BASE}/admin/metrics/overview${toQuery({ window: params.window })}`,
    { method: 'GET', signal: params.signal },
  )
  return res.data
}

/** `GET /admin/metrics/billing` — subscription MRR + transactional
 *  platform take split by kind. */
export async function metricsBilling(
  params: { window?: AdminWindow; signal?: AbortSignal } = {},
): Promise<AdminMetricsBilling> {
  const res = await authedFetch<Envelope<AdminMetricsBilling>>(
    `${VENUE_BASE}/admin/metrics/billing${toQuery({ window: params.window })}`,
    { method: 'GET', signal: params.signal },
  )
  return res.data
}
