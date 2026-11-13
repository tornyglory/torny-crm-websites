// Brief 105 — per-club variant config. Drives CRM terminology, module
// visibility, and public join-form section ordering. The backend owns
// the registry; FE reads what it ships.
//
//   GET /clubs/{id}/variant                 (authed)
//   GET /public/clubs/{slug}/variant        (public)
//
// Today `vertical` is always `'club'` for the 1461 existing clubs
// (brief 105 §Backend status). The slug union is open-ended so when
// `rentals`, `nursing`, or any future vertical lands the FE picks it
// up — anything the types don't know becomes a plain string, which
// the terminology swap handles because lookups go through
// `terminology.*`, not the slug itself.

import { VENUE_BASE } from '../config'
import { authedFetch, publicFetch } from '../http'

// ── Types ─────────────────────────────────────────────────────────

/** Known verticals — new ones can land without a FE change because the
 *  CRM reads `terminology` / `modules` / `join_form_sections`, never the
 *  slug itself. Fallback type kept open so unknown slugs don't break. */
export type VerticalSlug = 'club' | (string & {})

/** Labels the CRM substitutes into visible chrome (sidebar, headers, CTAs).
 *  Keep every lookup going through this object — never hardcode "Members"
 *  or "Join the club" in a view. New verticals get new labels on the
 *  backend registry and the FE swaps automatically. */
export interface VariantTerminology {
  member_singular: string
  member_plural: string
  application_singular: string
  application_plural: string
  join_cta: string
  join_page_title: string
}

/** Sidebar + feature-gate map. `false` means hide the module from the
 *  CRM's navigation + skip its feature wiring. All true for `club`. */
export interface VariantModules {
  members: boolean
  applications: boolean
  enquiries: boolean
  events: boolean
  teams: boolean
  team_selections: boolean
  tournaments: boolean
  honour_board: boolean
  venue_bookings: boolean
  venue_packages: boolean
  communications: boolean
}

/** Ordered sections of the public join form. Facets (brief 105 §3.3)
 *  render under the matching `key` — default `additional`.
 *
 *  Brief 106 adds the optional `visible` flag — once the backend ships
 *  the join-form-config endpoint, the variant merges per-club overrides
 *  into this list so sections can be hidden without being reordered or
 *  renamed. Public join form filters out `visible: false`. */
export interface JoinFormSection {
  key: string
  label: string
  visible?: boolean
}

/** The whole config payload for one club. Fetch once per session and
 *  cache in `useClubStore` — stable across the authed surface. */
export interface VariantConfig {
  club_id: number
  name: string
  subdomain: string
  vertical: VerticalSlug
  /** Display name for the vertical itself (e.g. "Club", "Nursing org"). */
  label: string
  terminology: VariantTerminology
  modules: VariantModules
  join_form_sections: JoinFormSection[]
}

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Endpoints ─────────────────────────────────────────────────────

/** GET /clubs/{id}/variant — owner/member authed read. Used by the
 *  CRM on sign-in to populate `useClubStore.variant`. */
export async function getVariant(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<VariantConfig> {
  const res = await authedFetch<Envelope<VariantConfig>>(
    `${VENUE_BASE}/clubs/${clubId}/variant`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

/** GET /public/clubs/{slug}/variant — no-auth read used by the public
 *  club-site renderer (membership page title, join CTA label, etc.). */
export async function getPublicVariant(
  slug: string,
  opts: { signal?: AbortSignal } = {},
): Promise<VariantConfig> {
  const res = await publicFetch<Envelope<VariantConfig>>(
    `${VENUE_BASE}/public/clubs/${encodeURIComponent(slug)}/variant`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

// ── FE fallbacks ──────────────────────────────────────────────────

/** Shape-complete default so the CRM still renders when the `/variant`
 *  endpoint is unreachable (offline, first-paint before the fetch, etc.).
 *  Keep in sync with the `club` vertical's backend defaults. */
export const CLUB_DEFAULT_TERMINOLOGY: VariantTerminology = {
  member_singular:      'Member',
  member_plural:        'Members',
  application_singular: 'Application',
  application_plural:   'Applications',
  join_cta:             'Join the club',
  join_page_title:      'Join the club.',
}

export const CLUB_DEFAULT_MODULES: VariantModules = {
  members: true,
  applications: true,
  enquiries: true,
  events: true,
  teams: true,
  team_selections: true,
  tournaments: true,
  honour_board: true,
  venue_bookings: true,
  venue_packages: true,
  communications: true,
}

/** Section keys the FE has retired but the backend may still echo back
 *  on `/variant`. Consumers filter them out at ingestion so they never
 *  render in the CRM modal or on the public form. Shrinks to empty once
 *  the backend variant registry drops them. */
export const LEGACY_JOIN_FORM_SECTION_KEYS: readonly string[] = ['your_bowls']

/** Drop section keys that the FE no longer renders (currently just
 *  `your_bowls` — Option A of the brief-106 follow-up). Safe to call on
 *  any variant response; returns a fresh array. */
export function filterLegacyJoinFormSections(sections: readonly JoinFormSection[]): JoinFormSection[] {
  return sections.filter((s) => !LEGACY_JOIN_FORM_SECTION_KEYS.includes(s.key))
}

// Brief 106 follow-up — `your_bowls` dropped as a hardcoded section. It
// was bowls-specific (not actually "built-in" like name + address),
// which made no sense for non-bowls verticals. Admins who want
// experience / position / playing-days capture now add them as custom
// facets under Additional questions.
export const CLUB_DEFAULT_JOIN_FORM_SECTIONS: JoinFormSection[] = [
  { key: 'tier',              label: 'Choose your tier',     visible: true },
  { key: 'about_you',         label: 'About you',            visible: true },
  { key: 'address',           label: 'Home address',         visible: true },
  { key: 'emergency_contact', label: 'Emergency contact',    visible: true },
  { key: 'additional',        label: 'Additional questions', visible: true },
  { key: 'review',            label: 'Review & agree',       visible: true },
]

// ── Join form config (brief 106 §3) ───────────────────────────────

/** One row in the per-club section overrides payload. `order` is the
 *  effective index after overrides apply; `visible` toggles the section
 *  on/off; `label_override` optionally renames it (FE skips this control
 *  in v1 per brief 106 §7). */
export interface JoinFormSectionOverride {
  key: string
  order: number
  visible: boolean
  label_override?: string | null
}

export interface JoinFormConfigPayload {
  sections: JoinFormSectionOverride[]
}

export type JoinFormConfigErrorCode =
  | 'unknown_section'
  | 'bad_order'
  | 'sections_required'
  | 'forbidden'
  | 'not_found'

/** PATCH /clubs/{club_id}/join-form-config — owner-only write of the
 *  section visibility + order overrides. Updated variant response is
 *  returned so callers don't need a follow-up GET.
 *
 *  Backend ships this with brief 106 (see §3.2). While the endpoint is
 *  pre-live, calls return 404; callers can either show a friendly
 *  "saving sections is coming soon" toast or retry when the endpoint
 *  lands — the FE doesn't need to know. */
export async function updateJoinFormConfig(
  clubId: number,
  payload: JoinFormConfigPayload,
  opts: { signal?: AbortSignal } = {},
): Promise<VariantConfig> {
  const res = await authedFetch<Envelope<VariantConfig>>(
    `${VENUE_BASE}/clubs/${clubId}/join-form-config`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
      signal: opts.signal,
    },
  )
  return res.data
}
