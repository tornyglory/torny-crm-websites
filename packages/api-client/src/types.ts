export type ID = string

/**
 * A single font entry within a curated pair — a Google Fonts family plus
 * the weights the CRM asks for. Backend guarantees these are always Google
 * Fonts families, always latin-subset compatible.
 */
export interface ClubFont {
  family: string
  weights: number[]
}

/**
 * Resolved fonts for a club, always populated. `slug` falls back to the
 * global default when the club hasn't picked one. See brief 22.
 */
export interface ClubFonts {
  slug: string
  heading: ClubFont
  body: ClubFont
  mono: ClubFont
}

export type StyleCardBackground = 'surface' | 'ground'
export type StyleCardBorder = 'hairline' | 'none'
export type StyleCardShadow = 'none' | 'soft'

export interface StyleRadiusScale {
  xs: number
  sm: number
  md: number
  lg: number
  pill: number
}

export interface StyleCardTreatment {
  background: StyleCardBackground
  border: StyleCardBorder
  shadow: StyleCardShadow
}

export interface StyleButtonTreatment {
  radius: number
}

/**
 * A single style preset returned from `GET /style-presets`. See brief 23.
 */
export interface StylePreset {
  slug: string
  name: string
  description: string
  radius: StyleRadiusScale
  cards: StyleCardTreatment
  buttons: StyleButtonTreatment
  is_default?: boolean
}

/**
 * Resolved style for a club, always populated. `slug` falls back to the
 * platform default (`editorial`) when the club hasn't picked one.
 */
export interface ClubStyle {
  slug: string
  radius: StyleRadiusScale
  cards: StyleCardTreatment
  buttons: StyleButtonTreatment
}

/**
 * A single navigation entry. Leaves must have `href`; parents may omit
 * `href` if they exist only to group `children`. One level of nesting.
 */
export interface NavItem {
  label: string
  href?: string
  external?: boolean
  children?: NavItem[]
}

/**
 * Resolved header + footer navigation for a club — always populated on
 * `/site` payloads. Falls back to the platform defaults when the club
 * hasn't customised.
 */
export interface ClubNavigation {
  header: NavItem[]
  footer: NavItem[]
}

/**
 * Full club record. `id` is a number (matches backend integer PKs; see brief
 * 08 §Timezones + IDs). Other fields are optional so we can hydrate a stub
 * from a `UserClub` in the auth response before a full /clubs/:id load.
 */
export interface Club {
  id: number
  name: string
  slug?: string | null
  domain?: string | null
  brandPrimary?: string | null
  logoUrl?: string | null
  faviconUrl?: string | null
  /** Present on `/site` payloads and any full club load; absent on stubs. */
  fonts?: ClubFonts
  /** Present on `/site` payloads and any full club load; absent on stubs. */
  style?: ClubStyle
  /** Present on `/site` payloads; header + footer link trees. */
  navigation?: ClubNavigation
}

export interface Member {
  id: ID
  clubId: ID
  firstName: string
  lastName: string
  email: string
  phone: string | null
  status: 'active' | 'pending' | 'lapsed' | 'life'
  role: 'player' | 'committee' | 'admin' | 'owner'
  membershipTypeId: ID | null
  joinedAt: string
}

/** Backend event-type whitelist per brief 33. */
export type EventType = 'tournament' | 'pennant' | 'social' | 'training' | 'other'

export type BowlsFormat = 'singles' | 'pairs' | 'triples' | 'fours' | 'other'

/** Short RSVP preview entry attached to public event responses. */
export interface EventRsvpPreview {
  initials: string
  avatar_url: string | null
}

/**
 * Public event shape — returned by GET /public/clubs/:slug/events and
 * present on /site.events_upcoming[]. Matches brief 33 §1 exactly.
 */
export interface PublicEvent {
  id: number
  slug: string
  title: string
  excerpt: string | null
  event_type: EventType
  format: BowlsFormat | null
  starts_at: string
  ends_at: string | null
  location: string | null
  cover_url: string | null
  host_name: string | null
  host_avatar_url: string | null
  capacity: number | null
  is_ticketed: boolean
  rsvp_open: boolean
  rsvp_going_count: number
  rsvp_maybe_count: number
  rsvp_going_preview: EventRsvpPreview[]
}

/**
 * Authed / CRM-facing event shape. Superset of PublicEvent — includes
 * fields owners edit (description, host_user_id, is_published).
 */
export interface Event {
  id: ID
  club_id: ID
  slug: string
  title: string
  excerpt: string | null
  description: string | null
  event_type: EventType
  format: BowlsFormat | null
  starts_at: string
  ends_at: string | null
  location: string | null
  cover_url: string | null
  host_user_id: ID | null
  host_name: string | null
  host_avatar_url: string | null
  capacity: number | null
  is_ticketed: boolean
  is_published: boolean
  rsvp_open: boolean
  rsvp_going_count: number
  rsvp_maybe_count: number
  rsvp_going_preview: EventRsvpPreview[]
  created_at?: string
  updated_at?: string | null
}

export interface TeamSelection {
  id: ID
  eventId: ID
  clubId: ID
  publishedAt: string | null
  notes: string | null
  teams: Team[]
}

export interface Team {
  id: ID
  name: string
  positions: TeamPosition[]
}

export interface TeamPosition {
  role: 'lead' | 'second' | 'third' | 'skip' | 'reserve'
  memberId: ID | null
  status: 'confirmed' | 'guest' | 'pending'
}

export interface Device {
  id: ID
  userId: ID
  platform: 'ios' | 'android' | 'web'
  token: string
  appVersion: string | null
  lastSeenAt: string
}

export type CommunicationChannel = 'push' | 'email' | 'in_app' | 'sms'

export interface CommunicationDraft {
  audienceFilter: Record<string, unknown>
  channels: CommunicationChannel[]
  subject: string
  body: string
  scheduleAt: string | null
}
