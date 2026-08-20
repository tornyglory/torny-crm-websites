import { defineStore, acceptHMRUpdate } from 'pinia'
import { computed } from 'vue'
import { useClaimsStore } from './claims'

export interface PlatformSnapshot {
  totalClubs: number
  activeClubs: number
  totalMembers: number
  newMembersThisWeek: number
  applicationsThisWeek: number
  enquiriesThisWeek: number
  mrrNzd: number
  mrrDeltaPct: number
  activityFeed: ActivityItem[]
  weeklySignups: number[]
}

export interface ActivityItem {
  id: string
  ts: string
  actor: string
  club: string
  region: string
  action: 'club_published' | 'club_claimed' | 'plan_upgraded' | 'plan_downgraded' | 'member_bulk_import'
  detail?: string
}

const snapshot: Omit<PlatformSnapshot, 'totalClubs'> = {
  activeClubs: 138,
  totalMembers: 18204,
  newMembersThisWeek: 87,
  applicationsThisWeek: 34,
  enquiriesThisWeek: 12,
  mrrNzd: 4260,
  mrrDeltaPct: 8.4,
  weeklySignups: [4, 6, 3, 8, 7, 12, 9, 11, 14, 10, 13, 18],
  activityFeed: [
    { id: 'a1', ts: '2026-08-20T09:12:00Z', actor: 'Grace Whittaker', club: 'Naenae Bowling', region: 'Wellington', action: 'club_published' },
    { id: 'a2', ts: '2026-08-20T08:41:00Z', actor: 'Marcus Tuilagi', club: 'Kelburn Bowling Club', region: 'Wellington', action: 'club_claimed', detail: 'awaiting review' },
    { id: 'a3', ts: '2026-08-19T22:20:00Z', actor: 'David Chen', club: 'Ashburton MSA Bowls', region: 'Canterbury', action: 'club_claimed', detail: 'awaiting review' },
    { id: 'a4', ts: '2026-08-19T17:58:00Z', actor: 'Sarah Kim', club: 'Titirangi RSA', region: 'Auckland', action: 'plan_upgraded', detail: 'Free → Standard' },
    { id: 'a5', ts: '2026-08-19T14:12:00Z', actor: 'Rob Alexander', club: 'Cambridge Bowls', region: 'Waikato', action: 'member_bulk_import', detail: '142 members via CSV' },
    { id: 'a6', ts: '2026-08-19T11:03:00Z', actor: 'Aroha Wetere', club: 'Petone Central', region: 'Wellington', action: 'club_claimed', detail: 'awaiting review' },
  ],
}

export const usePlatformStatsStore = defineStore('platformStats', () => {
  const claims = useClaimsStore()

  const stats = computed<PlatformSnapshot>(() => ({
    totalClubs: snapshot.activeClubs + claims.pendingCount,
    ...snapshot,
  }))

  return { stats }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(usePlatformStatsStore, import.meta.hot))
}
