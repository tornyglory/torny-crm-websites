// Brief 105 — owner-configurable join-form fields ("facets"). CRUD
// endpoints below plus a no-auth public read used by the join form on
// `<slug>.torny.pro/membership`. Facet answers are posted back on the
// membership application under a top-level `facet_values` object keyed
// on slug (see §2.5 of the brief).
//
//   GET    /clubs/{id}/custom-facets                        list    (member+)
//   POST   /clubs/{id}/custom-facets                        create  (owner)
//   PATCH  /clubs/{id}/custom-facets/{facet_id}             edit    (owner)
//   DELETE /clubs/{id}/custom-facets/{facet_id}             soft    (owner)
//   POST   /clubs/{id}/custom-facets/reorder                reorder (owner)
//   GET    /public/clubs/{slug}/custom-facets               public read

import { VENUE_BASE } from '../config'
import { authedFetch, publicFetch } from '../http'

// ── Types ─────────────────────────────────────────────────────────

/** All input controls the join form can render. Backend validates.
 *  `select`/`multi_select`/`radio`/`checkboxes` require `options`. */
export type FacetInputType =
  | 'select'
  | 'multi_select'
  | 'radio'
  | 'checkboxes'
  | 'text'
  | 'long_text'
  | 'number'
  | 'date'
  | 'boolean'

/** One option on an options-typed facet. `value` is what gets stored +
 *  queried; `label` is what the admin picked for display. */
export interface FacetOption {
  value: string
  label: string
}

export interface CustomFacet {
  facet_id: number
  slug: string
  label: string
  helper_text: string | null
  input_type: FacetInputType
  options: FacetOption[]
  required: boolean
  /** When true, admins see this facet as a filter chip on the Members
   *  list. When false it's still captured at join but not surfaced as a
   *  searchable dimension. */
  searchable: boolean
  /** Which `join_form_sections` key the facet renders under. Defaults
   *  to `additional` on create if omitted. */
  section_key: string
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

/** Payload shape for the join-application submit. Values are typed by
 *  the facet's input: array for multi-pick, string for single, number
 *  for number, YYYY-MM-DD for date, boolean for toggle. Keys are facet
 *  slugs. Unknown slugs server-side are dropped silently. */
export type FacetValueInput = string | number | boolean | string[] | null
export type FacetValuesPayload = Record<string, FacetValueInput>

/** Rows the Members list returns in `facets_available` so filter chips
 *  render without a second roundtrip (brief 105 §2.4). */
export interface FacetAvailability {
  slug: string
  label: string
  input_type: FacetInputType
  options: FacetOption[]
}

export interface CreateFacetInput {
  /** Optional on create — backend derives from `label` if omitted. */
  slug?: string
  label: string
  helper_text?: string | null
  input_type: FacetInputType
  /** Required when `input_type` is options-based; rejected otherwise. */
  options?: FacetOption[]
  required?: boolean
  searchable?: boolean
  section_key?: string
  display_order?: number
  is_active?: boolean
}

/** PATCH accepts partials — every field is optional. Options can be
 *  swapped wholesale (backend diff + migrate stored answers). */
export type UpdateFacetInput = Partial<CreateFacetInput>

export type FacetErrorCode =
  | 'label_required'
  | 'label_too_long'
  | 'bad_input_type'
  | 'bad_slug'
  | 'options_required'
  | 'options_not_allowed'
  | 'bad_option'
  | 'too_many_options'
  | 'duplicate_option'
  | 'slug_taken'
  | 'forbidden'
  | 'not_found'

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Endpoints ─────────────────────────────────────────────────────

/** GET /clubs/{id}/custom-facets — member+ read. Returns active and
 *  inactive facets in display order; the Website builder uses this.
 *
 *  Backend returns null / an empty object for clubs with no facets yet;
 *  coerce to `[]` so callers can `.filter` / `.map` without a defensive
 *  array check every time. */
export async function listFacets(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<CustomFacet[]> {
  const res = await authedFetch<Envelope<CustomFacet[]>>(
    `${VENUE_BASE}/clubs/${clubId}/custom-facets`,
    { method: 'GET', signal: opts.signal },
  )
  return Array.isArray(res.data) ? res.data : []
}

/** POST /clubs/{id}/custom-facets — owner-only create. */
export async function createFacet(
  clubId: number,
  input: CreateFacetInput,
  opts: { signal?: AbortSignal } = {},
): Promise<CustomFacet> {
  const res = await authedFetch<Envelope<CustomFacet>>(
    `${VENUE_BASE}/clubs/${clubId}/custom-facets`,
    {
      method: 'POST',
      body: JSON.stringify(input),
      signal: opts.signal,
    },
  )
  return res.data
}

/** PATCH /clubs/{id}/custom-facets/{facet_id} — owner-only edit. */
export async function updateFacet(
  clubId: number,
  facetId: number,
  input: UpdateFacetInput,
  opts: { signal?: AbortSignal } = {},
): Promise<CustomFacet> {
  const res = await authedFetch<Envelope<CustomFacet>>(
    `${VENUE_BASE}/clubs/${clubId}/custom-facets/${facetId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
      signal: opts.signal,
    },
  )
  return res.data
}

/** DELETE /clubs/{id}/custom-facets/{facet_id} — soft delete. Existing
 *  member answers remain in `member_facet_values`; the facet just stops
 *  rendering on the join form + filters. */
export async function deleteFacet(
  clubId: number,
  facetId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  await authedFetch<Envelope<null>>(
    `${VENUE_BASE}/clubs/${clubId}/custom-facets/${facetId}`,
    { method: 'DELETE', signal: opts.signal },
  )
}

export interface ReorderFacetsInput {
  /** New display order — full list of facet ids. Server rejects if
   *  any id is missing or doesn't belong to the club. */
  order: number[]
}

/** POST /clubs/{id}/custom-facets/reorder — returns the full updated
 *  list so callers don't need a separate GET. */
export async function reorderFacets(
  clubId: number,
  input: ReorderFacetsInput,
  opts: { signal?: AbortSignal } = {},
): Promise<CustomFacet[]> {
  const res = await authedFetch<Envelope<CustomFacet[]>>(
    `${VENUE_BASE}/clubs/${clubId}/custom-facets/reorder`,
    {
      method: 'POST',
      body: JSON.stringify(input),
      signal: opts.signal,
    },
  )
  return Array.isArray(res.data) ? res.data : []
}

/** GET /public/clubs/{slug}/custom-facets — no-auth read for the
 *  public join form. Returns `is_active = true` rows only, in display
 *  order. */
export async function listPublicFacets(
  slug: string,
  opts: { signal?: AbortSignal } = {},
): Promise<CustomFacet[]> {
  const res = await publicFetch<Envelope<CustomFacet[]>>(
    `${VENUE_BASE}/public/clubs/${encodeURIComponent(slug)}/custom-facets`,
    { method: 'GET', signal: opts.signal },
  )
  return Array.isArray(res.data) ? res.data : []
}
