// Venue packages — backend brief 73 (v1 shipped 2026-11-03).
//
// Covers the full packages CRUD + settings + public read. Platform fee
// math (brief 73 §6), Stripe destination charges (brief 73 §7), and
// availability blocks (brief 73 §3) are deferred — they wait on brief
// 72 (Stripe Connect) and brief 62 (bookings) respectively.
//
// Lives on its own base URL (`VENUE_BASE`) — a dedicated `TornyVenueStack`
// so brief 62 + 72 can grow into the same stack later.

import { VENUE_BASE } from '../config'
import { authedFetch, publicFetch } from '../http'

// ── Domain types ─────────────────────────────────────────────────

/** List row — hydrated on `GET /clubs/:cid/venue-packages`. The nested
 *  slots + addons aren't included on the list to keep the payload small;
 *  fetch the detail when you need them. */
export interface VenuePackageListItem {
  id: number
  slug: string
  name: string
  sub: string | null
  description: string | null
  hero_image_url: string | null
  hero_image_alt: string | null
  bond_cents: number
  bond_label: string | null
  is_active: boolean
  display_order: number
  slot_count: number
  addon_count: number
  /** Null in v1 — always null until brief 62 (venue bookings) ships and
   *  the backend starts counting bookings against each package. */
  last_booked_at: string | null
  created_at: string
  updated_at: string
}

/** Slot — one bookable time window inside a package. The `id` is
 *  server-assigned; omit on INSERT, include on UPDATE. */
export interface VenueSlot {
  id?: number
  label: string
  sub?: string | null
  /** Required on create. 100..10_000_000 (one cent is $0.01). */
  price_cents: number
  duration_hours?: number | null
  /** `HH:MM` (24h). Admin can override per booking day when brief 62 ships. */
  default_start_time?: string | null
  is_disabled?: boolean
  display_order?: number
}

/** Add-on — an optional extra attached to a slot. */
export interface VenueAddon {
  id?: number
  name: string
  description?: string | null
  /** Required on create. 0..10_000_000. */
  price_cents: number
  /** Rendered after the price — e.g. "/ platter", "/ hour". */
  price_suffix?: string | null
  countable?: boolean
  /** Pre-fills the stepper when `countable` is true. */
  default_quantity?: number | null
  default_selected?: boolean
  display_order?: number
}

/** Full detail — `GET /clubs/:cid/venue-packages/:packageId` response.
 *  Extends the list row with the nested slot + addon arrays. */
export interface VenuePackage extends VenuePackageListItem {
  slots: VenueSlot[]
  addons: VenueAddon[]
}

/** Shape sent on `POST /clubs/:cid/venue-packages`. The server will
 *  auto-slugify from `name` if `slug` is omitted; max 20 slots + 20
 *  addons; see brief 73 §3 for the full validation table. */
export interface CreateVenuePackageInput {
  name: string
  slug?: string
  sub?: string | null
  description?: string | null
  hero_image_url?: string | null
  hero_image_alt?: string | null
  bond_cents?: number
  bond_label?: string | null
  display_order?: number
  is_active?: boolean
  slots: VenueSlot[]
  addons: VenueAddon[]
}

/** Shape sent on `PATCH /clubs/:cid/venue-packages/:packageId`.
 *
 *  Top-level fields are standard partial — omit to leave unchanged. The
 *  nested arrays are whole-shape replacements though — pass the entire
 *  `slots[]` + `addons[]` you want the package to end up with:
 *    - entry with `id` → UPDATE
 *    - entry without `id` → INSERT
 *    - stored row whose `id` isn't in the request → DELETE
 *  Physical delete in v1; soft-delete when brief 62 ships (so a historical
 *  booking's slot ref doesn't dangle). */
export type UpdateVenuePackageInput = Partial<Omit<CreateVenuePackageInput, 'slots' | 'addons'>> & {
  slots?: VenueSlot[]
  addons?: VenueAddon[]
}

/** Club-level venue settings. Platform fee + Stripe status are
 *  deliberately absent from v1 — they land with brief 72. */
export interface VenueSettings {
  deposit_percent: number
  balance_due_days_before: number
  is_active: boolean
  updated_at: string
}

export interface UpdateVenueSettingsInput {
  deposit_percent?: number
  balance_due_days_before?: number
  is_active?: boolean
}

export interface VenuePackagesListResponse {
  packages: VenuePackageListItem[]
  counts: { all: number; active: number; archived: number }
}

export interface ListVenuePackagesParams {
  status?: 'all' | 'active' | 'archived'
  search?: string
}

/** Error codes brief 73 §3 + §7. Lets the CRM switch on code and translate
 *  to a user-friendly toast rather than parsing the raw message. */
export type VenuePackageErrorCode =
  | 'bad_name'
  | 'bad_slug'
  | 'slug_conflict'
  | 'bad_bond'
  | 'too_many_slots'
  | 'too_many_addons'
  | 'bad_slot_price'
  | 'bad_addon_price'
  | 'bad_hero'
  | 'bad_body'
  | 'not_found'
  | 'forbidden'
  | 'bad_deposit_percent'
  | 'bad_due_days'
  | 'platform_fee_readonly'

// ── Public read ─────────────────────────────────────────────────

/** Public shape — same as `VenuePackage` minus the admin-only fields the
 *  public endpoint hides. Disabled slots are filtered server-side. */
export interface PublicVenueSlot {
  id: number
  label: string
  sub: string | null
  price_cents: number
  duration_hours: number | null
  default_start_time: string | null
  display_order: number
}

export interface PublicVenueAddon {
  id: number
  name: string
  description: string | null
  price_cents: number
  price_suffix: string | null
  countable: boolean
  default_quantity: number | null
  default_selected: boolean
  display_order: number
}

export interface PublicVenuePackage {
  id: number
  slug: string
  name: string
  sub: string | null
  description: string | null
  hero_image_url: string | null
  hero_image_alt: string | null
  bond_cents: number
  bond_label: string | null
  display_order: number
  slots: PublicVenueSlot[]
  addons: PublicVenueAddon[]
}

export interface PublicVenueSettings {
  deposit_percent: number
  balance_due_days_before: number
  is_active: boolean
}

export interface PublicVenuePackagesResponse {
  packages: PublicVenuePackage[]
  settings: PublicVenueSettings
}

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── CRM endpoints ───────────────────────────────────────────────

/** `GET /clubs/:cid/venue-packages` — list including archived rows. */
export async function list(
  clubId: number,
  params: ListVenuePackagesParams = {},
  opts: { signal?: AbortSignal } = {},
): Promise<VenuePackagesListResponse> {
  const qs = new URLSearchParams()
  if (params.status && params.status !== 'all') qs.set('status', params.status)
  if (params.search != null && params.search.length > 0) qs.set('search', params.search)

  const url = qs.toString().length > 0
    ? `${VENUE_BASE}/clubs/${clubId}/venue-packages?${qs.toString()}`
    : `${VENUE_BASE}/clubs/${clubId}/venue-packages`

  const res = await authedFetch<Envelope<VenuePackagesListResponse>>(url, {
    method: 'GET',
    signal: opts.signal,
  })
  return res.data
}

/** `GET /clubs/:cid/venue-packages/:packageId` — full detail. */
export async function get(
  clubId: number,
  packageId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<VenuePackage> {
  const res = await authedFetch<Envelope<VenuePackage>>(
    `${VENUE_BASE}/clubs/${clubId}/venue-packages/${packageId}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

/** `POST /clubs/:cid/venue-packages` — create with nested slots + addons. */
export async function create(
  clubId: number,
  input: CreateVenuePackageInput,
  opts: { signal?: AbortSignal } = {},
): Promise<VenuePackage> {
  const res = await authedFetch<Envelope<VenuePackage>>(
    `${VENUE_BASE}/clubs/${clubId}/venue-packages`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

/** `PATCH /clubs/:cid/venue-packages/:packageId` — nested whole-shape
 *  replace. See `UpdateVenuePackageInput` for the diff semantics. */
export async function update(
  clubId: number,
  packageId: number,
  input: UpdateVenuePackageInput,
  opts: { signal?: AbortSignal } = {},
): Promise<VenuePackage> {
  const res = await authedFetch<Envelope<VenuePackage>>(
    `${VENUE_BASE}/clubs/${clubId}/venue-packages/${packageId}`,
    { method: 'PATCH', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

/** `POST /clubs/:cid/venue-packages/:packageId/archive` — soft-archive.
 *  Idempotent. Returns the updated detail. */
export async function archive(
  clubId: number,
  packageId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<VenuePackage> {
  const res = await authedFetch<Envelope<VenuePackage>>(
    `${VENUE_BASE}/clubs/${clubId}/venue-packages/${packageId}/archive`,
    { method: 'POST', body: '{}', signal: opts.signal },
  )
  return res.data
}

/** `POST /clubs/:cid/venue-packages/:packageId/unarchive`. */
export async function unarchive(
  clubId: number,
  packageId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<VenuePackage> {
  const res = await authedFetch<Envelope<VenuePackage>>(
    `${VENUE_BASE}/clubs/${clubId}/venue-packages/${packageId}/unarchive`,
    { method: 'POST', body: '{}', signal: opts.signal },
  )
  return res.data
}

/** `POST /clubs/:cid/venue-packages/reorder` — drag-reorder. Only the
 *  packages in `order` are updated; the rest stay put. */
export async function reorder(
  clubId: number,
  order: Array<{ id: number; display_order: number }>,
  opts: { signal?: AbortSignal } = {},
): Promise<{ reordered: number }> {
  const res = await authedFetch<Envelope<{ reordered: number }>>(
    `${VENUE_BASE}/clubs/${clubId}/venue-packages/reorder`,
    { method: 'POST', body: JSON.stringify({ order }), signal: opts.signal },
  )
  return res.data
}

// ── Settings ─────────────────────────────────────────────────────

/** `GET /clubs/:cid/venue-settings` — lazy-upserts if the row doesn't
 *  exist yet, returning the defaults (deposit 15%, due 14 days, active). */
export async function getSettings(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<VenueSettings> {
  const res = await authedFetch<Envelope<VenueSettings>>(
    `${VENUE_BASE}/clubs/${clubId}/venue-settings`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

/** `PATCH /clubs/:cid/venue-settings`. */
export async function updateSettings(
  clubId: number,
  input: UpdateVenueSettingsInput,
  opts: { signal?: AbortSignal } = {},
): Promise<VenueSettings> {
  const res = await authedFetch<Envelope<VenueSettings>>(
    `${VENUE_BASE}/clubs/${clubId}/venue-settings`,
    { method: 'PATCH', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

// ── Public read ─────────────────────────────────────────────────

/** `GET /public/clubs/:slug/venue-packages` — no auth. Only active
 *  packages, disabled slots filtered server-side. */
export async function listPublic(
  slug: string,
  opts: { signal?: AbortSignal } = {},
): Promise<PublicVenuePackagesResponse> {
  const res = await publicFetch<Envelope<PublicVenuePackagesResponse>>(
    `${VENUE_BASE}/public/clubs/${encodeURIComponent(slug)}/venue-packages`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}
