// Permission + plan lookup for the active club — brief 94.
//
// Reads from the auth store's user.clubs[] (the hydrated /me shape), matched
// against the club store's current club id. Returns reactive helpers the
// sidebar, route guards, and per-view gating can share.
//
// Owner → permissions: ['*'] → every `can` returns true.
// Admin → explicit full bundle minus hard-coded (billing/danger/manage_team).
// Member → stored JSON bundle.
// Player → ['dashboard:view'].

import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useClubStore } from '@/stores/club'

export function usePermissions() {
  const auth = useAuthStore()
  const club = useClubStore()

  const activeClub = computed(() => {
    const cid = club.current?.id
    if (cid == null) return null
    return auth.user?.clubs.find((c) => c.id === cid) ?? null
  })

  const perms = computed<string[]>(() => activeClub.value?.permissions ?? [])
  const role = computed(() => activeClub.value?.role ?? null)
  const plan = computed(() => activeClub.value?.plan ?? 'starter')

  // Backwards-compat: a cached session whose /me pre-dates brief 94 won't
  // have `permissions` on its clubs[]. Fall back to role-based gating in
  // that case so owners / admins aren't locked out while their localStorage
  // ages out. Matches the equivalent branch in `router/guards.ts`.
  const hasBundle = computed(() => Array.isArray(activeClub.value?.permissions))

  function can(perm: string): boolean {
    const club = activeClub.value
    if (!club) return false
    if (!hasBundle.value) {
      return club.role === 'owner' || club.role === 'admin'
    }
    const p = perms.value
    return p.includes('*') || p.includes(perm)
  }

  function canAny(...ps: string[]): boolean {
    const club = activeClub.value
    if (!club) return false
    if (!hasBundle.value) {
      return club.role === 'owner' || club.role === 'admin'
    }
    const p = perms.value
    if (p.includes('*')) return true
    return ps.some((perm) => p.includes(perm))
  }

  const isOwner = computed(() => role.value === 'owner')
  // "manage_team" is hard-coded to owner+admin per brief 94 §2.1.
  const canManageTeam = computed(() => role.value === 'owner' || role.value === 'admin')
  const isPro = computed(() => plan.value === 'pro')

  return {
    activeClub,
    perms,
    role,
    plan,
    isPro,
    isOwner,
    canManageTeam,
    can,
    canAny,
  }
}
