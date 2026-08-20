import { defineStore, acceptHMRUpdate } from 'pinia'
import { computed, ref } from 'vue'

export type ClaimStatus = 'pending' | 'approved' | 'rejected'
export type Sport = 'bowls' | 'tennis' | 'golf' | 'cricket' | 'petanque' | 'croquet'

export interface Claim {
  id: string
  clubId: number
  clubName: string
  region: string
  sport: Sport
  claimant: {
    firstName: string
    lastName: string
    email: string
    role: string
  }
  evidence: string
  submittedAt: string
  status: ClaimStatus
  decidedAt?: string
  decidedBy?: string
  rejectionReason?: string
}

const seed: Claim[] = [
  {
    id: 'clm_001',
    clubId: 12,
    clubName: 'Kelburn Bowling Club',
    region: 'Wellington',
    sport: 'bowls',
    claimant: {
      firstName: 'Marcus',
      lastName: 'Tuilagi',
      email: 'marcus.t@kelburnbowls.co.nz',
      role: 'Secretary',
    },
    evidence: 'I have been secretary at Kelburn since 2022. Committee minutes from March AGM confirming my role are on the club Google Drive — happy to share.',
    submittedAt: '2026-08-19T14:22:00Z',
    status: 'pending',
  },
  {
    id: 'clm_002',
    clubId: 47,
    clubName: 'Petone Central',
    region: 'Wellington',
    sport: 'bowls',
    claimant: {
      firstName: 'Aroha',
      lastName: 'Wetere',
      email: 'aroha@petonecentral.nz',
      role: 'President',
    },
    evidence: 'President of Petone Central for the last two seasons. Verified email address matches the one on our club website.',
    submittedAt: '2026-08-19T09:47:00Z',
    status: 'pending',
  },
  {
    id: 'clm_003',
    clubId: 88,
    clubName: 'Ashburton MSA Bowls',
    region: 'Canterbury',
    sport: 'bowls',
    claimant: {
      firstName: 'David',
      lastName: 'Chen',
      email: 'd.chen@ashburtonmsa.co.nz',
      role: 'Greenkeeper / Admin',
    },
    evidence: 'Running day-to-day admin including bookings. Committee has appointed me as CRM lead.',
    submittedAt: '2026-08-18T20:11:00Z',
    status: 'pending',
  },
  {
    id: 'clm_004',
    clubId: 133,
    clubName: 'Whangarei Bowling Club',
    region: 'Northland',
    sport: 'tennis',
    claimant: {
      firstName: 'Sarah',
      lastName: 'Mitchell',
      email: 'sarah.m@whangareibowls.org.nz',
      role: 'Committee Member',
    },
    evidence: 'Elected to committee last month. Happy to have another admin verify.',
    submittedAt: '2026-08-18T11:03:00Z',
    status: 'pending',
  },
  {
    id: 'clm_005',
    clubId: 22,
    clubName: 'Naenae Bowling',
    region: 'Wellington',
    sport: 'bowls',
    claimant: {
      firstName: 'Grace',
      lastName: 'Whittaker',
      email: 'grace@naenaebowling.org.nz',
      role: 'Club Owner',
    },
    evidence: 'Long-time owner, verified by Bowls NZ records. Migrating from old system.',
    submittedAt: '2026-08-15T13:30:00Z',
    status: 'approved',
    decidedAt: '2026-08-15T18:12:00Z',
    decidedBy: 'Neville Rodda',
  },
  {
    id: 'clm_006',
    clubId: 55,
    clubName: 'Waihi Beach Bowls',
    region: 'Bay of Plenty',
    sport: 'bowls',
    claimant: {
      firstName: 'Trevor',
      lastName: 'Baker',
      email: 'tbaker@gmail.com',
      role: 'Member',
    },
    evidence: 'I play there sometimes.',
    submittedAt: '2026-08-14T16:44:00Z',
    status: 'rejected',
    decidedAt: '2026-08-14T20:00:00Z',
    decidedBy: 'Neville Rodda',
    rejectionReason: 'Insufficient evidence of administrative role. Casual members cannot claim the club.',
  },
]

const STORAGE_KEY = 'torny.platform.claims'

function load(): Claim[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return seed
    return JSON.parse(raw) as Claim[]
  } catch {
    return seed
  }
}

export const useClaimsStore = defineStore('claims', () => {
  const claims = ref<Claim[]>(load())

  const pending = computed(() => claims.value.filter(c => c.status === 'pending'))
  const approved = computed(() => claims.value.filter(c => c.status === 'approved'))
  const rejected = computed(() => claims.value.filter(c => c.status === 'rejected'))

  const pendingCount = computed(() => pending.value.length)

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(claims.value))
  }

  function approve(id: string, decidedBy: string) {
    const claim = claims.value.find(c => c.id === id)
    if (!claim || claim.status !== 'pending') return
    claim.status = 'approved'
    claim.decidedAt = new Date().toISOString()
    claim.decidedBy = decidedBy
    persist()
  }

  function reject(id: string, decidedBy: string, reason: string) {
    const claim = claims.value.find(c => c.id === id)
    if (!claim || claim.status !== 'pending') return
    claim.status = 'rejected'
    claim.decidedAt = new Date().toISOString()
    claim.decidedBy = decidedBy
    claim.rejectionReason = reason
    persist()
  }

  function reset() {
    claims.value = [...seed]
    persist()
  }

  return { claims, pending, approved, rejected, pendingCount, approve, reject, reset }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useClaimsStore, import.meta.hot))
}
