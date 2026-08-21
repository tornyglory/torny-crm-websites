import type { NavigationGuard } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
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
