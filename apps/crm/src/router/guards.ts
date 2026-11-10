import type { NavigationGuard } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useClubStore } from '@/stores/club'
import { useOnboardingStore } from '@/stores/onboarding'

export const requireAuth: NavigationGuard = (to) => {
  const auth = useAuthStore()
  if (!auth.isAuthenticated) {
    return { name: 'sign-in', query: { redirect: to.fullPath } }
  }
  return true
}

// Same as requireAuth, but bounces to /register instead of /sign-in. Used on
// the claim wizard — someone arriving there without an account probably wants
// to make one, not sign in.
export const requireAuthOrRegister: NavigationGuard = (to) => {
  const auth = useAuthStore()
  if (!auth.isAuthenticated) {
    return { name: 'register', query: { redirect: to.fullPath } }
  }
  return true
}

export const requireOwner: NavigationGuard = (to) => {
  const auth = useAuthStore()
  if (!auth.isAuthenticated) {
    return { name: 'sign-in', query: { redirect: to.fullPath } }
  }
  if (!auth.canManageClub) {
    return { name: 'forbidden' }
  }
  return true
}

export const requireOwnerAndOnboarded: NavigationGuard = async (to) => {
  const auth = useAuthStore()
  if (!auth.isAuthenticated) {
    return { name: 'sign-in', query: { redirect: to.fullPath } }
  }
  if (auth.isPlatformAdmin) {
    return { name: 'admin-dashboard' }
  }
  if (!auth.canManageClub) {
    return { name: 'forbidden' }
  }
  const onboarding = useOnboardingStore()
  // The store's default `completed` is false. Hydrate from the real
  // GET /clubs/:id/onboarding before deciding — otherwise a returning owner
  // whose onboarding completed remotely gets bounced back to the wizard.
  if (!onboarding.completed) {
    await onboarding.hydrate()
  }
  if (!onboarding.completed) {
    return { name: 'onboarding-welcome' }
  }
  return true
}

export const requirePlatformAdmin: NavigationGuard = (to) => {
  const auth = useAuthStore()
  if (!auth.isAuthenticated) {
    return { name: 'sign-in', query: { redirect: to.fullPath } }
  }
  if (!auth.isPlatformAdmin) {
    return { name: 'forbidden' }
  }
  return true
}

/**
 * Permission-based route guard — brief 94. Reads `meta.permission` and
 * `meta.requiresPro` off the destination route and gates entry against the
 * active club's `permissions[]` + `plan`.
 *
 * - No meta flags → no-op (returns true), so non-CRM routes pass through.
 * - Not authenticated → no-op; let the chain's other guards bounce to sign-in.
 * - Platform admin → always passes (parity with other guards).
 * - Owner → always passes.
 * - Backwards compat: when `membership.permissions` is undefined (stale
 *   cached sessions from before brief 94 landed, or test fixtures that
 *   haven't added the field), fall back to the old role-only gate:
 *   owner/admin pass, everyone else bounces. Same applies to `plan` —
 *   missing plan means we don't know, so we don't gate.
 * - Plan gating runs BEFORE permission gating (brief 94 §8). A Starter-plan
 *   club with a leftover Pro-only permission in its bundle still can't enter.
 *
 * On a gate miss the user is bounced to the dashboard rather than `/forbidden`
 * — the sidebar already hides the item; this is the direct-URL safety net.
 */
export const permissionGate: NavigationGuard = (to) => {
  const perm = (to.meta.permission as string | undefined) ?? undefined
  const requiresPro = to.meta.requiresPro === true
  if (!perm && !requiresPro) return true

  const auth = useAuthStore()
  if (!auth.isAuthenticated || auth.isPlatformAdmin) return true

  const clubId = useClubStore().current?.id
  const membership = auth.user?.clubs.find((c) => c.id === clubId)
  if (!membership) return true
  const role = membership.role
  if (role === 'owner') return true

  // Plan gate — only enforced when the server sent a plan. A missing plan on
  // a cached session predates brief 93 and shouldn't lock the user out.
  if (requiresPro && membership.plan && membership.plan !== 'pro') {
    return { name: 'dashboard' }
  }

  // Permission gate — only enforced when the server sent a permissions array.
  // A missing array means we're on a stale session; fall back to role-only
  // (admin passes, anyone else bounces).
  if (perm) {
    if (membership.permissions === undefined) {
      return role === 'admin' ? true : { name: 'dashboard' }
    }
    const perms = membership.permissions
    if (!perms.includes('*') && !perms.includes(perm)) {
      return { name: 'dashboard' }
    }
  }

  return true
}
