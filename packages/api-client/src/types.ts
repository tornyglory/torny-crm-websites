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
  /** Present on `/site` payloads and any full club load; absent on stubs. */
  fonts?: ClubFonts
  /** Present on `/site` payloads and any full club load; absent on stubs. */
  style?: ClubStyle
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

export type EventType =
  | 'tournament'
  | 'social'
  | 'meeting'
  | 'coaching'
  | 'working-bee'
  | 'presentation'
  | 'fundraiser'
  | 'function'
  | 'other'

export type BowlsFormat = 'singles' | 'pairs' | 'triples' | 'fours' | 'other'

export interface Event {
  id: ID
  clubId: ID
  slug: string
  title: string
  description: string | null
  startsAt: string
  endsAt: string
  /** The kind of event — tournament, social, meeting, etc. */
  eventType: EventType
  /** Only present for tournaments; null for other event types. */
  format: BowlsFormat | null
  location: string | null
  rsvpOpen: boolean
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

export interface HonourBoardCategory {
  id: ID
  clubId: ID
  name: string
  slug: string
  order: number
  isDraft: boolean
}

export interface HonourBoardEntry {
  id: ID
  categoryId: ID
  year: number
  memberId: ID | null
  memberName: string
  photoUrl: string | null
  score: string | null
  notes: string | null
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
