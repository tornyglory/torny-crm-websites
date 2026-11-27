// Platform admin portal — backend brief 123.
//
// Phase 1 (read) + Phase 2 (actions + audit + users) are live. Phase 3
// (transactions drilldown, communications, system health, trend
// sparklines) is still pending.
//
// Phase 1 endpoints:
//   GET    /admin/accounts                            — list with filters + sort + search + cursor pagination
//   GET    /admin/accounts/:id                        — detail + timeline
//   GET    /admin/metrics/overview                    — platform dashboard
//   GET    /admin/metrics/billing                     — billing dashboard
//
// Phase 2 endpoints:
//   POST   /admin/accounts/:id/impersonate            — mint 15-min JWT to act as the account's owner
//   POST   /admin/accounts/:id/plan-override          — comp plan with time-boxed `until`
//   POST   /admin/accounts/:id/suspend                — soft-disable (blocks CRM mutations)
//   POST   /admin/accounts/:id/unsuspend              — restore
//   GET    /admin/audit                               — paginated audit log reader
//   GET    /admin/users                               — cross-tenant user list
//   PATCH  /admin/users/:id                           — grant / revoke is_platform_owner
//
// URL note: admin endpoints live on VENUE_BASE (same as every recent
// admin-adjacent endpoint — TornyCrmStack is at the CloudFormation 500-
// resource cap).
//
// Role gate: every endpoint requires an authed session with
// `users.is_platform_admin = 1`. Non-admins get `403 not_platform_owner`
// with a spartan body (no shape hints).
//
// Suspension enforcement: when an account is suspended (§Phase 2), every
// mutating CRM handler for that club returns `409 account_suspended`.
// This affects the whole CRM, not just the admin shell — the global
// ApiError handler should surface a "Contact support" modal when the
// code appears.

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
    { method: 'GET', signal: params.signal, bypassImpersonation: true },
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
    { method: 'GET', signal: params.signal, bypassImpersonation: true },
  )
  return res.data
}

/** `GET /admin/metrics/overview` — platform dashboard numbers. */
export async function metricsOverview(
  params: { window?: AdminWindow; signal?: AbortSignal } = {},
): Promise<AdminMetricsOverview> {
  const res = await authedFetch<Envelope<AdminMetricsOverview>>(
    `${VENUE_BASE}/admin/metrics/overview${toQuery({ window: params.window })}`,
    { method: 'GET', signal: params.signal, bypassImpersonation: true },
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
    { method: 'GET', signal: params.signal, bypassImpersonation: true },
  )
  return res.data
}

// ════════════════════════════════════════════════════════════════
// Phase 2 — admin actions, audit log, platform users
// ════════════════════════════════════════════════════════════════

// ── Impersonation ────────────────────────────────────────────────

export interface AdminImpersonateInput {
  /** Required by backend. Max 500 chars. Audit-logged on the target
   *  account so every impersonation session is attributable. */
  reason: string
}

export interface AdminImpersonateResult {
  /** 15-minute JWT. Drop into `Authorization: Bearer <jwt>` as a
   *  temporary override of the admin's cookie session; don't persist
   *  to localStorage or a store. When the TTL expires or admin exits,
   *  just stop sending the Bearer header — the cookie's still there. */
  impersonation_jwt: string
  /** ISO 8601. 15 minutes from mint time. */
  expires_at: string
  impersonated_user_id: number
  impersonated_user_email: string
}

/** `POST /admin/accounts/:id/impersonate` — mint a short-lived JWT
 *  that logs the caller in as the target account's owner. Carries an
 *  `impersonated_by` claim for attribution, `isPlatformAdmin: false`
 *  so the target cannot elevate via the session.
 *
 *  Errors:
 *    - `409 cannot_impersonate_platform_owner` — target owner is also a platform owner
 *    - `409 no_owner` — account has no owner_user_id
 *    - `400 reason_required` — empty / missing reason */
export async function impersonate(
  accountId: number,
  input: AdminImpersonateInput,
  opts: { signal?: AbortSignal } = {},
): Promise<AdminImpersonateResult> {
  const res = await authedFetch<Envelope<AdminImpersonateResult>>(
    `${VENUE_BASE}/admin/accounts/${accountId}/impersonate`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal, bypassImpersonation: true },
  )
  return res.data
}

// ── Plan override (comp) ─────────────────────────────────────────

export interface AdminPlanOverrideInput {
  /** The plan to assign. Writing the current plan is allowed (idempotent-ish). */
  plan: 'starter' | 'pro'
  /** ISO 8601 — when the override expires and reverts to Stripe truth.
   *  Must be in the future. Null / omitted = indefinite. Note Phase 2
   *  limitation: the nightly revert job lands in Phase 3; today manual
   *  overrides persist past `until` until a human takes action. The FE
   *  should treat `plan_manual_until < NOW()` as "override expired,
   *  pending revert" in the UI. */
  until?: string | null
  /** Required. Audit-logged + visible on the account timeline. */
  reason: string
}

export interface AdminPlanOverrideResult {
  ok: true
  effective_plan: 'starter' | 'pro'
  plan_source: 'manual'
  comped_until: string | null
}

/** `POST /admin/accounts/:id/plan-override` — strategic comps (e.g.
 *  free Pro for Bowls Wellington in exchange for the case study).
 *  Overrides Stripe-derived plan resolution; `plan_source` flips to
 *  `'manual'`. */
export async function planOverride(
  accountId: number,
  input: AdminPlanOverrideInput,
  opts: { signal?: AbortSignal } = {},
): Promise<AdminPlanOverrideResult> {
  const res = await authedFetch<Envelope<AdminPlanOverrideResult>>(
    `${VENUE_BASE}/admin/accounts/${accountId}/plan-override`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal, bypassImpersonation: true },
  )
  return res.data
}

// ── Suspend / unsuspend ──────────────────────────────────────────

export interface AdminSuspendInput {
  reason: string
  /** Optional — when true the server sends a templated email to the
   *  owner. Phase 2: field accepted but email not yet sent server-side. */
  notify_owner?: boolean
}

export interface AdminSuspendResult {
  ok: true
  suspended_at: string
}

/** `POST /admin/accounts/:id/suspend` — soft-disable. Blocks every
 *  mutating CRM handler for the club with `409 account_suspended`.
 *  Reads + public site keep working. Reversible via `unsuspend`.
 *
 *  Error: `409 already_suspended` if `suspended_at` is already set. */
export async function suspend(
  accountId: number,
  input: AdminSuspendInput,
  opts: { signal?: AbortSignal } = {},
): Promise<AdminSuspendResult> {
  const res = await authedFetch<Envelope<AdminSuspendResult>>(
    `${VENUE_BASE}/admin/accounts/${accountId}/suspend`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal, bypassImpersonation: true },
  )
  return res.data
}

export interface AdminUnsuspendInput {
  reason: string
}

/** `POST /admin/accounts/:id/unsuspend` — restore CRM mutations.
 *  Error: `409 not_suspended` if the account isn't currently suspended. */
export async function unsuspend(
  accountId: number,
  input: AdminUnsuspendInput,
  opts: { signal?: AbortSignal } = {},
): Promise<{ ok: true }> {
  const res = await authedFetch<Envelope<{ ok: true }>>(
    `${VENUE_BASE}/admin/accounts/${accountId}/unsuspend`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal, bypassImpersonation: true },
  )
  return res.data
}

// ── Audit log ────────────────────────────────────────────────────

export type AdminAuditAction =
  | 'impersonate'
  | 'comp_plan'
  | 'suspend'
  | 'unsuspend'
  | 'grant_platform_owner'
  | 'revoke_platform_owner'
  // Brief 124 Phase 1 — every mutating call during an impersonation
  // session writes one of these. payload shape in Phase 1 is strictly
  // { method, path, as_user_id } (authorizer-level, no request body
  // access). Richer `response_status` / per-endpoint `body_summary`
  // lands in Phase 2 via a handler wrapper.
  | 'impersonated_action'
  // Brief 126 — platform-level user ban + unban. Both carry target_user
  // populated with target_club: null.
  | 'ban_user'
  | 'unban_user'

export interface AdminAuditActor {
  user_id: number
  email: string
  name: string | null
}

export interface AdminAuditTargetClub {
  id: number
  name: string
  subdomain: string
}

export interface AdminAuditTargetUser {
  id: number
  email: string
}

export interface AdminAuditEntry {
  id: number
  at: string
  action: AdminAuditAction
  actor: AdminAuditActor
  /** Null for user-scoped actions (grant / revoke platform owner).
   *  Brief 124 Phase 1: `impersonated_action` rows may arrive with
   *  nullified fields (`{ id: null, name: null, subdomain: null }`)
   *  instead of a flat null — treat anything without `target_club?.id`
   *  as "no club context on this row". */
  target_club: AdminAuditTargetClub | null
  /** Null for club-scoped actions (comp, suspend). */
  target_user: AdminAuditTargetUser | null
  /** Null on `impersonated_action` rows — the reason belongs to the
   *  session-start `impersonate` row, found via `session_id`. */
  reason: string | null
  /** Brief 124 Phase 1 — links `impersonated_action` rows back to their
   *  parent `impersonate` row. Null on session-start rows and on all
   *  non-impersonation actions. */
  session_id: number | null
  /** Request body of the action. Sanitised server-side — no credentials
   *  or JWT contents. Shape depends on action; render raw JSON in the
   *  UI for forensic use.
   *
   *  `impersonated_action` Phase 1 shape: `{ method, path, as_user_id }`. */
  payload: unknown
  ip: string
  user_agent: string
}

export interface AdminAuditList {
  items: AdminAuditEntry[]
  next_cursor: string | null
  total_count: number
}

export interface ListAuditParams {
  filter?: {
    actor?: number
    target_club?: number
    target_user?: number
    action?: AdminAuditAction
    /** Brief 124 Phase 1 — group every row from one impersonation
     *  session, including the parent `impersonate` row + every
     *  `impersonated_action` row that points at it. */
    session_id?: number
  }
  limit?: number
  cursor?: string
  signal?: AbortSignal
}

/** `GET /admin/audit` — paginated audit log. Sorted `at DESC, id DESC`. */
export async function listAudit(
  params: ListAuditParams = {},
): Promise<AdminAuditList> {
  const query: Record<string, string | number | boolean | undefined> = {
    limit: params.limit,
    cursor: params.cursor,
  }
  if (params.filter) {
    for (const [k, v] of Object.entries(params.filter)) {
      if (v === undefined) continue
      query[`filter[${k}]`] = v as string | number | boolean
    }
  }
  const res = await authedFetch<Envelope<AdminAuditList>>(
    `${VENUE_BASE}/admin/audit${toQuery(query)}`,
    { method: 'GET', signal: params.signal, bypassImpersonation: true },
  )
  return res.data
}

// ── Platform users ───────────────────────────────────────────────

export interface AdminUserClubMembership {
  club_id: number
  club_name: string
  role: 'owner' | 'admin' | 'staff' | (string & {})
}

export interface AdminUser {
  id: number
  name: string | null
  email: string
  signup_at: string | null
  last_login_at: string | null
  is_platform_owner: boolean
  club_memberships: AdminUserClubMembership[]
  /** Brief 126 — ISO timestamp when the platform ban was applied. Null
   *  on active users. Absent on backend responses that predate brief
   *  126 (treat absent as null — user is active). */
  banned_at?: string | null
  /** Brief 126 — reason captured at ban time. Only non-null when
   *  `banned_at` is set. */
  banned_reason?: string | null
  /** Brief 126 — admin who applied the ban. Only non-null when
   *  `banned_at` is set. */
  banned_by_user_id?: number | null
}

export interface AdminUsersList {
  items: AdminUser[]
  next_cursor: string | null
  total_count: number
}

export interface ListUsersParams {
  q?: string
  filter?: {
    is_platform_owner?: true
    /** Users with ≥2 active club memberships. Useful for support
     *  triage ("which humans touch multiple clubs"). */
    multi_club?: true
    /** Brief 126 — scope to banned (true) or active (false) users. */
    banned?: boolean
  }
  limit?: number
  cursor?: string
  signal?: AbortSignal
}

/** `GET /admin/users` — cross-tenant user list. */
export async function listUsers(
  params: ListUsersParams = {},
): Promise<AdminUsersList> {
  const query: Record<string, string | number | boolean | undefined> = {
    q: params.q,
    limit: params.limit,
    cursor: params.cursor,
  }
  if (params.filter) {
    for (const [k, v] of Object.entries(params.filter)) {
      if (v === undefined) continue
      query[`filter[${k}]`] = v as string | number | boolean
    }
  }
  const res = await authedFetch<Envelope<AdminUsersList>>(
    `${VENUE_BASE}/admin/users${toQuery(query)}`,
    { method: 'GET', signal: params.signal, bypassImpersonation: true },
  )
  return res.data
}

export interface UpdateUserInput {
  is_platform_owner: boolean
}

export interface UpdatedUser {
  id: number
  email: string
  is_platform_owner: boolean
}

/** `PATCH /admin/users/:id` — grant / revoke the platform-owner flag.
 *  Audit-logged. Guard: `409 cannot_demote_self` if you try to revoke
 *  your own flag (defence against locking everyone out). */
export async function updateUser(
  userId: number,
  input: UpdateUserInput,
  opts: { signal?: AbortSignal } = {},
): Promise<UpdatedUser> {
  const res = await authedFetch<Envelope<UpdatedUser>>(
    `${VENUE_BASE}/admin/users/${userId}`,
    { method: 'PATCH', body: JSON.stringify(input), signal: opts.signal, bypassImpersonation: true },
  )
  return res.data
}

// ════════════════════════════════════════════════════════════════
// Phase 3 — transactions drilldown, communications, timeline
// enrichment on getAccount (shape unchanged from Phase 2),
// nightly plan-reverter (operational — no FE surface)
// ════════════════════════════════════════════════════════════════

// ── Transactions drilldown ───────────────────────────────────────

/** Polymorphic transaction kinds. Phase 3 ships `venue_booking` +
 *  `tournament_entry`; `subscription_charge` + `addon_charge` land
 *  when their own tables arrive (Stripe sub webhook mirror + brief
 *  122). Forward-compat via `| (string & {})`. */
export type AdminTransactionKind =
  | 'venue_booking'
  | 'tournament_entry'
  | 'subscription_charge'
  | 'addon_charge'
  | (string & {})

/** Public status enum. Server maps per-kind DB enums into this set —
 *  confirmed|completed → succeeded, pending|pending_payment → pending,
 *  cancelled|declined|withdrew → failed, refunded → refunded. */
export type AdminTransactionStatus = 'succeeded' | 'refunded' | 'failed' | 'pending'

export interface AdminTransactionRef {
  kind: AdminTransactionKind
  id: number
  /** Human-readable label — rendered as the row's primary descriptor
   *  in the Transactions tab. */
  label: string
}

export interface AdminTransactionMember {
  id: number
  name: string
  email: string
}

export interface AdminTransactionRow {
  /** Prefixed string id — `vb_<n>` for venue bookings, `te_<n>` for
   *  tournament entries. Reserved prefixes: `sc_` (subscription_charge),
   *  `ac_` (addon_charge). */
  id: string
  at: string
  kind: AdminTransactionKind
  amount_cents: number
  platform_fee_cents: number
  club_net_cents: number
  stripe_charge_id: string | null
  stripe_dashboard_url: string | null
  ref: AdminTransactionRef
  /** Null when the transaction was anonymous (guest booking w/out
   *  member linkage). */
  member: AdminTransactionMember | null
  status: AdminTransactionStatus
}

export interface AdminTransactionsList {
  items: AdminTransactionRow[]
  next_cursor: string | null
  total_count: number
  aggregates: {
    gross_cents: number
    platform_take_cents: number
    /** Partial `Record<AdminTransactionKind, number>` — only the kinds
     *  with non-zero counts in the window appear. */
    count_by_kind: Partial<Record<AdminTransactionKind, number>>
  }
}

export interface ListTransactionsParams {
  window?: AdminWindow
  filter?: {
    /** Comma-separated string accepted by the server; the FE helper
     *  joins arrays into that shape. */
    kind?: AdminTransactionKind | AdminTransactionKind[]
    status?: AdminTransactionStatus
  }
  /** Default `-at` (newest first). `-amount_cents` supported. */
  sort?: '-at' | '-amount_cents'
  limit?: number
  cursor?: string
  signal?: AbortSignal
}

// ── Platform-wide transactions (brief 125) ──────────────────────

/** Row shape for the platform-wide ledger — same as AdminTransactionRow
 *  plus a `club` identifier so the FE can render which account each
 *  row belongs to without a secondary lookup. */
export interface AdminPlatformTransactionRow extends AdminTransactionRow {
  club: {
    id: number
    name: string
    subdomain: string
  }
}

/** Top-clubs-by-GMV summary surfaced in `aggregates.top_clubs_by_gmv`.
 *  Capped at 5 rows server-side; render only what fits. NOT a general
 *  facet — do not use for filter UI. */
export interface AdminTopClubByGmv {
  club_id: number
  name: string
  gross_cents: number
  platform_take_cents: number
}

export interface AdminPlatformTransactionsList {
  items: AdminPlatformTransactionRow[]
  next_cursor: string | null
  total_count: number
  aggregates: {
    gross_cents: number
    platform_take_cents: number
    /** Platform take / gross. Informational only. */
    effective_take_rate: number
    count_by_kind: Partial<Record<AdminTransactionKind, number>>
    top_clubs_by_gmv: AdminTopClubByGmv[]
  }
}

export interface ListAllTransactionsParams {
  window?: AdminWindow
  filter?: {
    kind?: AdminTransactionKind | AdminTransactionKind[]
    status?: AdminTransactionStatus
    /** Scope to one club — equivalent to the per-account endpoint but
     *  keeps the FE on the platform list view. */
    club_id?: number
  }
  /** Default `-at`. Platform-wide ledger also supports `-platform_fee_cents`
   *  so admins can find the highest-fee rows across every club. */
  sort?: '-at' | '-amount_cents' | '-platform_fee_cents'
  q?: string
  limit?: number
  cursor?: string
  signal?: AbortSignal
}

/** `GET /admin/transactions` — brief 125. Platform-wide ledger with
 *  per-row club identity + aggregates (incl. top-clubs-by-GMV).
 *
 *  Reconciliation guarantee: `aggregates.gross_cents` here with no
 *  filters at `window=30d` MUST equal
 *  `admin.metricsBilling({ window: '30d' }).transactional.gmv_cents` —
 *  same for `platform_take_cents`. If these ever drift, it's a bug. */
export async function listAllTransactions(
  params: ListAllTransactionsParams = {},
): Promise<AdminPlatformTransactionsList> {
  const query: Record<string, string | number | boolean | undefined> = {
    window: params.window,
    sort: params.sort,
    q: params.q,
    limit: params.limit,
    cursor: params.cursor,
  }
  if (params.filter) {
    for (const [k, v] of Object.entries(params.filter)) {
      if (v === undefined) continue
      query[`filter[${k}]`] = Array.isArray(v) ? v.join(',') : (v as string | number | boolean)
    }
  }
  const res = await authedFetch<Envelope<AdminPlatformTransactionsList>>(
    `${VENUE_BASE}/admin/transactions${toQuery(query)}`,
    { method: 'GET', signal: params.signal, bypassImpersonation: true },
  )
  return res.data
}

/** `GET /admin/accounts/:id/transactions` — polymorphic stream of
 *  bookings + entries + (future) charges for the Transactions tab. */
export async function listTransactions(
  accountId: number,
  params: ListTransactionsParams = {},
): Promise<AdminTransactionsList> {
  const query: Record<string, string | number | boolean | undefined> = {
    window: params.window,
    sort: params.sort,
    limit: params.limit,
    cursor: params.cursor,
  }
  if (params.filter) {
    for (const [k, v] of Object.entries(params.filter)) {
      if (v === undefined) continue
      // Join arrays into comma-separated server shape.
      query[`filter[${k}]`] = Array.isArray(v) ? v.join(',') : (v as string | number | boolean)
    }
  }
  const res = await authedFetch<Envelope<AdminTransactionsList>>(
    `${VENUE_BASE}/admin/accounts/${accountId}/transactions${toQuery(query)}`,
    { method: 'GET', signal: params.signal, bypassImpersonation: true },
  )
  return res.data
}

// ── Per-club communications ──────────────────────────────────────

export interface AdminCommunicationBatch {
  id: number
  sent_at: string
  subject: string
  /** e.g. `'club_newsletter'`, `'event_reminder'`. Forward-compat. */
  flavor: string
  /** Human-readable audience descriptor — "All active members", "Pro
   *  members only", etc. */
  audience_label: string
  sent_by_user_id: number | null
  sent_by_user_name: string | null
  sent_by_user_email: string | null
  /** Per-batch click count — available in Phase 3. No per-batch
   *  unsub count (email_unsubscribes is keyed by `(club_id, email)`);
   *  use aggregates.unsubs_in_window for the club-level total. */
  click_count: number
}

export interface AdminCommunicationsList {
  items: AdminCommunicationBatch[]
  next_cursor: string | null
  total_count: number
  aggregates: {
    sent_in_window: number
    clicks_in_window: number
    unsubs_in_window: number
    /** Null until Phase 3b lights up SES per-recipient events. Treat
     *  as "no bounce data yet" in the UI, not "0% bounce rate". */
    bounce_rate_in_window: number | null
    /** Null until Phase 3b — needs delivered count. */
    unsub_rate_in_window: number | null
  }
  /** Phase 3b flips this on when SES event tracking ships. */
  ses_events_available: boolean
}

export interface ListCommunicationsParams {
  window?: AdminWindow
  limit?: number
  cursor?: string
  signal?: AbortSignal
}

/** `GET /admin/accounts/:id/communications` — per-club email batch
 *  history for the Communications tab. */
export async function listCommunications(
  accountId: number,
  params: ListCommunicationsParams = {},
): Promise<AdminCommunicationsList> {
  const query: Record<string, string | number | boolean | undefined> = {
    window: params.window,
    limit: params.limit,
    cursor: params.cursor,
  }
  const res = await authedFetch<Envelope<AdminCommunicationsList>>(
    `${VENUE_BASE}/admin/accounts/${accountId}/communications${toQuery(query)}`,
    { method: 'GET', signal: params.signal, bypassImpersonation: true },
  )
  return res.data
}

// ── Platform-wide communications metrics ─────────────────────────

export interface AdminHighBounceAccount {
  account_id: number
  name: string
  bounce_rate: number
  sent: number
}

export interface AdminMetricsCommunications {
  window: AdminWindow
  sent_batches: number
  clicks: number
  unsubscribes: number
  /** Null until Phase 3b — needs SES per-recipient event tracking. */
  delivered_rate: number | null
  bounce_rate: number | null
  complaint_rate: number | null
  high_bounce_accounts: AdminHighBounceAccount[]
  ses_events_available: boolean
  /** Null until Phase 3b — needs SES API integration. */
  ses_daily_quota: number | null
  ses_daily_sent: number | null
  ses_sandbox_mode: boolean | null
}

/** `GET /admin/metrics/communications` — platform-wide SES health.
 *  Rate fields ship as honest null in Phase 3; Phase 3b fills them. */
export async function metricsCommunications(
  params: { window?: AdminWindow; signal?: AbortSignal } = {},
): Promise<AdminMetricsCommunications> {
  const res = await authedFetch<Envelope<AdminMetricsCommunications>>(
    `${VENUE_BASE}/admin/metrics/communications${toQuery({ window: params.window })}`,
    { method: 'GET', signal: params.signal, bypassImpersonation: true },
  )
  return res.data
}

// ════════════════════════════════════════════════════════════════
// Brief 126 — platform user ban / unban
// ════════════════════════════════════════════════════════════════

export interface AdminBanUserInput {
  reason: string
}

export interface AdminBanUserResult {
  ok: true
  banned_at: string
}

/** `POST /admin/users/:id/ban` — brief 126. Platform-wide ban. User
 *  can't sign in; existing JWTs 403 on next authorizer pass.
 *
 *  Guards (returned as ApiError with `.code`):
 *    - `409 already_banned` — user is already banned
 *    - `409 cannot_ban_platform_owner` — revoke their platform_owner flag first
 *    - `409 cannot_ban_self` — admin can't ban themselves
 *    - `400 reason_required` / `reason_too_long` */
export async function banUser(
  userId: number,
  input: AdminBanUserInput,
  opts: { signal?: AbortSignal } = {},
): Promise<AdminBanUserResult> {
  const res = await authedFetch<Envelope<AdminBanUserResult>>(
    `${VENUE_BASE}/admin/users/${userId}/ban`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal, bypassImpersonation: true },
  )
  return res.data
}

export interface AdminUnbanUserInput {
  reason: string
}

/** `POST /admin/users/:id/unban` — brief 126. Lifts the platform ban.
 *  Guard: `409 not_banned` if the user isn't currently banned. */
export async function unbanUser(
  userId: number,
  input: AdminUnbanUserInput,
  opts: { signal?: AbortSignal } = {},
): Promise<{ ok: true }> {
  const res = await authedFetch<Envelope<{ ok: true }>>(
    `${VENUE_BASE}/admin/users/${userId}/unban`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal, bypassImpersonation: true },
  )
  return res.data
}
