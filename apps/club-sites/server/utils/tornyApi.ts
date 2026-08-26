import { useRuntimeConfig } from '#imports'

// ── Shapes returned by the public CRM endpoints ────────────────
// See docs/backend-briefs/15-public-site-endpoints-live.md.

export interface Club {
  id: number
  slug: string
  name: string
  primary_host: string
  custom_hosts: string[]
  brand_primary: string | null
  logo_url: string | null
  onboarded_at: string | null
}

export interface SiteFont {
  family: string
  weights: number[]
}

export interface SiteFonts {
  slug: string
  heading: SiteFont
  body: SiteFont
  mono: SiteFont
}

export interface SiteStyleRadius {
  xs: number
  sm: number
  md: number
  lg: number
  pill: number
}

export interface SiteStyleCards {
  background: 'surface' | 'ground'
  border: 'hairline' | 'none'
  shadow: 'none' | 'soft'
}

export interface SiteStyleButtons {
  radius: number
}

export interface SiteStyle {
  slug: string
  radius: SiteStyleRadius
  cards: SiteStyleCards
  buttons: SiteStyleButtons
}

export interface SiteColorSchemeTokens {
  ground: string
  surface: string
  hairline: string
  ink: string
  graphite: string
  fog: string
  mute: string
}

export interface SiteColorScheme {
  slug: string
  tokens: SiteColorSchemeTokens
}

export interface SiteNavItem {
  label: string
  href?: string
  external?: boolean
  children?: SiteNavItem[]
}

export interface SiteNavigation {
  header: SiteNavItem[]
  footer: SiteNavItem[]
}

export interface SiteClub {
  id: number
  slug: string
  name: string
  short_description: string | null
  tagline: string | null
  founded_year: number | null
  sport: string
  sport_id: number
  region: string | null
  country: string | null
  brand_primary: string | null
  logo_url: string | null
  favicon_url: string | null
  onboarded_at: string | null
  fonts?: SiteFonts
  style?: SiteStyle
  color_scheme?: SiteColorScheme
  navigation?: SiteNavigation
}

export interface SiteContact {
  email: string | null
  phone: string | null
  address: string | null
  google_maps_url: string | null
}

export interface SiteHour {
  day: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
  is_open: boolean
  open: string | null
  close: string | null
}

export interface SiteMembershipTier {
  id: number
  type_name: string
  description: string | null
  cadence: 'annual' | 'monthly' | 'season' | null
  fee: number | null
  is_default: boolean
  /** Palette slot chosen in CRM Settings (accent / mint / tangerine / violet).
   *  Blocks fall back to a position-based rotation when omitted. */
  tone?: string | null
  sort_order?: number
}

export interface SiteEvent {
  id: number
  slug: string
  title: string
  starts_at: string
  ends_at: string | null
  location: string | null
  cover_url: string | null
  event_type: 'tournament' | 'pennant' | 'social' | 'training' | 'other' | null
  format: string | null
  capacity: number | null
  rsvp_open: boolean | null
  excerpt: string | null
}

export interface SiteHonourEntry {
  category_slug: string
  category_name: string
  year: number
  /** First player's display name — kept for backwards-compat with single-name displays. */
  member_name: string
  /** First player's user_id, if a Torny user. Null for guest / historic wins. */
  member_user_id: number | null
  notes: string | null
  /** Optional pre-computed initials for the avatar chip. */
  initials?: string
  /** Optional final score string, e.g. "21–14". */
  score?: string | null
  /** Optional ISO date the trophy was awarded. */
  awarded_at?: string | null
  /** Full player list, in team order. `players[0]` mirrors `member_name`. */
  players?: Array<{
    user_id: number | null
    display_name: string
    position: string | null
  }>
}

export interface SitePagesEnabled {
  home: boolean
  about: boolean
  membership: boolean
  events: boolean
  honour_board: boolean
  shop: boolean
}

/** The six well-known system pages from brief 16 §3. */
export type SystemPageSlug = 'home' | 'about' | 'membership' | 'events' | 'honour-board' | 'contact'
/** Any published page slug — the six system pages plus any custom slug
 *  minted by an owner via the CRM (brief 27). Kept as `string` so custom
 *  pages type-check everywhere the six-slug union used to. */
export type PageSlug = SystemPageSlug | (string & { readonly brand?: 'PageSlug' })

export interface Site {
  club: SiteClub
  contact: SiteContact
  hours: SiteHour[]
  membership_tiers: SiteMembershipTier[]
  cadence: 'annual' | 'monthly' | 'season' | null
  first_year_discount: boolean
  events_upcoming: SiteEvent[]
  honour_board_recent: SiteHonourEntry[]
  pages_enabled: SitePagesEnabled
  /**
   * Published block layouts per page slug — set by the CRM page-builder
   * (brief 16). Absent slugs fall back to the hardcoded page templates
   * in `apps/club-sites/pages/*`. `meta` (brief 26) is always populated
   * server-side — falls back to site defaults then club-derived values.
   */
  pages?: Record<string, {
    blocks: unknown[]
    meta?: SitePageMeta
  } | undefined>
}

/** Fully-resolved per-page SEO metadata. Server picks page → site default → derived. */
export interface SitePageMeta {
  title: string
  description: string | null
}

interface Envelope<T> {
  status: 'success'
  data: T
}

// ── Tenant resolution ─────────────────────────────────────────
// Naive in-memory cache. On Cloudflare Pages this lives in the Worker's
// isolate — fine for MVP. Move to Workers KV when we want cross-isolate
// tenant lookups < 5ms warm.
const resolveMemo = new Map<string, { club: Club | null; expires: number }>()
const RESOLVE_TTL_MS = 60_000

function normaliseHost(h: string): string {
  return h.toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '')
}

export async function resolveClubForHost(host: string): Promise<Club | null> {
  const key = normaliseHost(host)
  const cached = resolveMemo.get(key)
  if (cached && cached.expires > Date.now()) return cached.club

  const config = useRuntimeConfig()
  try {
    const res = await $fetch<Envelope<Club>>('/clubs/resolve', {
      baseURL: config.tornyApiBaseUrl,
      params: { host: key },
    })
    const club = res.data ?? null
    resolveMemo.set(key, { club, expires: Date.now() + RESOLVE_TTL_MS })
    return club
  } catch {
    // 404 (unknown_host) or transport error — cache null briefly so a fresh
    // onboarding becomes reachable within a minute of the revalidate purge.
    resolveMemo.set(key, { club: null, expires: Date.now() + 10_000 })
    return null
  }
}

// Called from server/api/revalidate.post.ts to drop stale tenant lookups.
export function invalidateHost(host: string): void {
  resolveMemo.delete(normaliseHost(host))
}

// ── Public site payload ───────────────────────────────────────

export async function fetchSite(slug: string): Promise<Site | null> {
  const config = useRuntimeConfig()
  try {
    const res = await $fetch<Envelope<Site>>(`/public/clubs/${encodeURIComponent(slug)}/site`, {
      baseURL: config.tornyApiBaseUrl,
    })
    return res.data ?? null
  } catch {
    return null
  }
}

// Generic passthrough for anything else on the public surface.
export function tornyFetch<T>(path: string, opts?: Parameters<typeof $fetch>[1]): Promise<T> {
  const config = useRuntimeConfig()
  return $fetch<T>(path, { baseURL: config.tornyApiBaseUrl, ...opts })
}
