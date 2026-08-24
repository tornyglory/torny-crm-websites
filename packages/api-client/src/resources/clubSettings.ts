// Club settings — the one endpoint that hydrates the CRM's Settings page.
// See the frontend "club-settings" brief shipped 2026-08-24.
//
// Returns every editable club field — identity, location, hours, membership,
// brand, navigation, SEO, publishing, pages — in one call. Writes stay split
// across dedicated PATCH endpoints (brand-assets, font-pair, style-preset,
// navigation, seo, onboarding, pages, …) so each save has a targeted
// revalidate reason.

import { CRM_BASE } from '../config'
import { authedFetch } from '../http'
import type { ClubFonts, ClubStyle, NavItem } from '../types'

// ── Types ─────────────────────────────────────────────────────────

export interface SettingsIdentity {
  name: string | null
  year_founded: number | null
  club_type: string | null
  short_description: string | null
  tagline: string | null
}

export interface SettingsLocation {
  address_line: string | null
  suburb: string | null
  region: string | null
  country: string | null
}

export interface SettingsFacility {
  greens: number | null
  rinks: number | null
  green_surface: string | null
}

export interface SettingsContact {
  email: string | null
  phone: string | null
}

export interface SettingsHour {
  day: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
  is_open: boolean
  open: string | null
  close: string | null
}

export interface SettingsMembershipTier {
  id: number
  type_name: string
  description: string | null
  cadence: 'annual' | 'monthly' | 'season' | null
  price: number | null
  tone: string | null
  slug: string | null
  is_default: boolean
  display_order: number
}

export interface SettingsMembership {
  cadence: 'annual' | 'monthly' | 'season' | null
  first_year_discount: boolean
  tiers: SettingsMembershipTier[]
}

export interface SettingsBrand {
  logo_url: string | null
  favicon_url: string | null
  accent_colour: string | null
  /** null = using platform default; resolved value always populated below. */
  font_pair: string | null
  font_pair_resolved: ClubFonts
  style_preset: string | null
  style_preset_resolved: ClubStyle
}

export interface SettingsNavigation {
  /** Club's saved nav, or null when using platform defaults. */
  header_stored: NavItem[] | null
  footer_stored: NavItem[] | null
  /** Always populated — resolved with the platform-default fallback. */
  header: NavItem[]
  footer: NavItem[]
}

export interface SettingsSEO {
  default_meta_title: string | null
  default_meta_description: string | null
}

export interface SettingsPublishing {
  subdomain: string | null
  primary_host: string | null
  public_url: string | null
  custom_hosts: unknown[]
}

export interface SettingsPage {
  id: number
  slug: string
  title: string
  is_system: boolean
  is_published: boolean
  position: number
  draft_updated_at: string | null
  published_at: string | null
}

export interface ClubSettings {
  clubId: number
  owner_user_id: number | null
  onboarded_at: string | null
  onboarding_step: string
  identity: SettingsIdentity
  location: SettingsLocation
  facility: SettingsFacility
  contact: SettingsContact
  hours: SettingsHour[]
  membership: SettingsMembership
  brand: SettingsBrand
  navigation: SettingsNavigation
  seo: SettingsSEO
  publishing: SettingsPublishing
  pages: SettingsPage[]
}

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Endpoints ─────────────────────────────────────────────────────

/**
 * GET /clubs/:clubId/settings — one-shot hydrator for the Settings page.
 *
 * Owner or admin. Prefer this over stitching together the individual
 * onboarding / clubs / navigation / pages endpoints — it batches every
 * subsection in one round-trip and returns resolved fallbacks for
 * font-pair / style-preset / navigation.
 */
export async function get(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<ClubSettings> {
  const res = await authedFetch<Envelope<ClubSettings>>(
    `${CRM_BASE}/clubs/${clubId}/settings`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}
