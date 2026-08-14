export type ID = string

export interface Club {
  id: ID
  slug: string
  name: string
  domain: string | null
  brandPrimary: string | null
  logoUrl: string | null
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

export interface Event {
  id: ID
  clubId: ID
  slug: string
  title: string
  description: string | null
  startsAt: string
  endsAt: string
  format: 'singles' | 'pairs' | 'triples' | 'fours' | 'other'
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
