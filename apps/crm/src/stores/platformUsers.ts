import { defineStore, acceptHMRUpdate } from 'pinia'
import { computed, ref } from 'vue'
import type { SportCode } from './sports'

export type UserStatus = 'active' | 'suspended' | 'banned' | 'pending'
export type UserPlatformRole = 'platform' | 'owner' | 'admin' | 'committee' | 'player'

export interface ClubMembership {
  clubName: string
  role: string
  sport: SportCode
}

export interface ModerationEvent {
  ts: string
  by: string
  action: 'suspend' | 'restore' | 'ban' | 'unban' | 'warn'
  reason?: string
  until?: string
}

export interface PlatformUser {
  id: string
  firstName: string
  lastName: string
  email: string
  role: UserPlatformRole
  status: UserStatus
  joinedAt: string
  lastActiveAt: string
  memberships: ClubMembership[]
  reportsCount: number
  moderation: ModerationEvent[]
  suspendedUntil?: string
}

const seed: PlatformUser[] = [
  {
    id: 'u_001',
    firstName: 'Grace',
    lastName: 'Whittaker',
    email: 'grace@naenaebowling.org.nz',
    role: 'owner',
    status: 'active',
    joinedAt: '2026-01-12T00:00:00Z',
    lastActiveAt: '2026-08-20T08:12:00Z',
    memberships: [{ clubName: 'Naenae Bowling', role: 'Owner', sport: 'bowls' }],
    reportsCount: 0,
    moderation: [],
  },
  {
    id: 'u_002',
    firstName: 'Marcus',
    lastName: 'Tuilagi',
    email: 'marcus.t@kelburnbowls.co.nz',
    role: 'admin',
    status: 'active',
    joinedAt: '2026-06-04T00:00:00Z',
    lastActiveAt: '2026-08-19T18:44:00Z',
    memberships: [{ clubName: 'Kelburn Bowling Club', role: 'Secretary', sport: 'bowls' }],
    reportsCount: 0,
    moderation: [],
  },
  {
    id: 'u_003',
    firstName: 'Aroha',
    lastName: 'Wetere',
    email: 'aroha@petonecentral.nz',
    role: 'admin',
    status: 'active',
    joinedAt: '2026-07-11T00:00:00Z',
    lastActiveAt: '2026-08-20T07:30:00Z',
    memberships: [{ clubName: 'Petone Central', role: 'President', sport: 'bowls' }],
    reportsCount: 0,
    moderation: [],
  },
  {
    id: 'u_004',
    firstName: 'David',
    lastName: 'Chen',
    email: 'd.chen@ashburtonmsa.co.nz',
    role: 'admin',
    status: 'pending',
    joinedAt: '2026-08-18T00:00:00Z',
    lastActiveAt: '2026-08-18T20:11:00Z',
    memberships: [{ clubName: 'Ashburton MSA Bowls', role: 'CRM Lead', sport: 'bowls' }],
    reportsCount: 0,
    moderation: [],
  },
  {
    id: 'u_005',
    firstName: 'Trevor',
    lastName: 'Baker',
    email: 'tbaker@gmail.com',
    role: 'player',
    status: 'suspended',
    joinedAt: '2026-03-22T00:00:00Z',
    lastActiveAt: '2026-08-16T12:11:00Z',
    memberships: [{ clubName: 'Waihi Beach Bowls', role: 'Social member', sport: 'bowls' }],
    reportsCount: 4,
    suspendedUntil: '2026-08-27T00:00:00Z',
    moderation: [
      { ts: '2026-08-16T14:22:00Z', by: 'Neville Rodda', action: 'suspend', reason: 'Repeated abusive comments on match reports.', until: '2026-08-27T00:00:00Z' },
      { ts: '2026-08-10T09:12:00Z', by: 'Neville Rodda', action: 'warn', reason: 'Language on moment threads.' },
    ],
  },
  {
    id: 'u_006',
    firstName: 'Sarah',
    lastName: 'Kim',
    email: 'sarah@titirangirsa.co.nz',
    role: 'admin',
    status: 'active',
    joinedAt: '2026-02-22T00:00:00Z',
    lastActiveAt: '2026-08-20T09:04:00Z',
    memberships: [{ clubName: 'Titirangi RSA', role: 'Committee', sport: 'bowls' }],
    reportsCount: 0,
    moderation: [],
  },
  {
    id: 'u_007',
    firstName: 'Rob',
    lastName: 'Alexander',
    email: 'rob.a@cambridgebowls.nz',
    role: 'owner',
    status: 'active',
    joinedAt: '2026-03-04T00:00:00Z',
    lastActiveAt: '2026-08-19T15:44:00Z',
    memberships: [{ clubName: 'Cambridge Bowls', role: 'Owner', sport: 'bowls' }],
    reportsCount: 0,
    moderation: [],
  },
  {
    id: 'u_008',
    firstName: 'Priya',
    lastName: 'Nair',
    email: 'priya.n@gmail.com',
    role: 'player',
    status: 'active',
    joinedAt: '2026-05-14T00:00:00Z',
    lastActiveAt: '2026-08-20T06:22:00Z',
    memberships: [
      { clubName: 'Titirangi RSA', role: 'Playing member', sport: 'bowls' },
      { clubName: 'Waitakere Tennis', role: 'Club member', sport: 'tennis' },
    ],
    reportsCount: 0,
    moderation: [],
  },
  {
    id: 'u_009',
    firstName: 'Jamie',
    lastName: 'Ratu',
    email: 'jamie.r@fakerealestate.co.nz',
    role: 'player',
    status: 'banned',
    joinedAt: '2026-04-30T00:00:00Z',
    lastActiveAt: '2026-07-02T18:33:00Z',
    memberships: [],
    reportsCount: 12,
    moderation: [
      { ts: '2026-07-02T20:00:00Z', by: 'Neville Rodda', action: 'ban', reason: 'Coordinated spam across multiple clubs. Account also linked to fraudulent contact details.' },
    ],
  },
  {
    id: 'u_010',
    firstName: 'Tania',
    lastName: 'Field',
    email: 'tania@whangareibowls.org.nz',
    role: 'committee',
    status: 'active',
    joinedAt: '2026-06-01T00:00:00Z',
    lastActiveAt: '2026-08-19T22:11:00Z',
    memberships: [{ clubName: 'Whangarei Bowling Club', role: 'Committee', sport: 'bowls' }],
    reportsCount: 0,
    moderation: [],
  },
  {
    id: 'u_011',
    firstName: 'Neville',
    lastName: 'Rodda',
    email: 'nev@torny.co',
    role: 'platform',
    status: 'active',
    joinedAt: '2026-01-01T00:00:00Z',
    lastActiveAt: '2026-08-20T09:22:00Z',
    memberships: [],
    reportsCount: 0,
    moderation: [],
  },
]

const STORAGE_KEY = 'torny.platform.users'

function load(): PlatformUser[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return seed
    return JSON.parse(raw) as PlatformUser[]
  } catch {
    return seed
  }
}

export const usePlatformUsersStore = defineStore('platformUsers', () => {
  const users = ref<PlatformUser[]>(load())

  const active = computed(() => users.value.filter(u => u.status === 'active').length)
  const suspended = computed(() => users.value.filter(u => u.status === 'suspended').length)
  const banned = computed(() => users.value.filter(u => u.status === 'banned').length)
  const flagged = computed(() => users.value.filter(u => u.reportsCount > 0 && u.status === 'active'))

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(users.value))
  }

  function suspend(id: string, by: string, reason: string, days: number) {
    const u = users.value.find(x => x.id === id)
    if (!u) return
    const until = new Date(Date.now() + days * 86400_000).toISOString()
    u.status = 'suspended'
    u.suspendedUntil = until
    u.moderation.unshift({ ts: new Date().toISOString(), by, action: 'suspend', reason, until })
    persist()
  }

  function ban(id: string, by: string, reason: string) {
    const u = users.value.find(x => x.id === id)
    if (!u) return
    u.status = 'banned'
    u.suspendedUntil = undefined
    u.moderation.unshift({ ts: new Date().toISOString(), by, action: 'ban', reason })
    persist()
  }

  function restore(id: string, by: string) {
    const u = users.value.find(x => x.id === id)
    if (!u) return
    const prev = u.status
    u.status = 'active'
    u.suspendedUntil = undefined
    u.reportsCount = 0
    u.moderation.unshift({ ts: new Date().toISOString(), by, action: prev === 'banned' ? 'unban' : 'restore' })
    persist()
  }

  function warn(id: string, by: string, reason: string) {
    const u = users.value.find(x => x.id === id)
    if (!u) return
    u.moderation.unshift({ ts: new Date().toISOString(), by, action: 'warn', reason })
    persist()
  }

  function reset() {
    users.value = JSON.parse(JSON.stringify(seed))
    persist()
  }

  return { users, active, suspended, banned, flagged, suspend, ban, restore, warn, reset }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(usePlatformUsersStore, import.meta.hot))
}
