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
 *  render under the matching `key` — default `additional`. */
export interface JoinFormSection {
  key: string
  label: string
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

export const CLUB_DEFAULT_JOIN_FORM_SECTIONS: JoinFormSection[] = [
  { key: 'tier',              label: 'Choose your tier' },
  { key: 'about_you',         label: 'About you' },
  { key: 'address',           label: 'Home address' },
  { key: 'your_bowls',        label: 'Your bowls' },
  { key: 'emergency_contact', label: 'Emergency contact' },
  { key: 'additional',        label: 'Additional questions' },
  { key: 'review',            label: 'Review & agree' },
]
