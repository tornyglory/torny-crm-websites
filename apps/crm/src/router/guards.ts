import type { NavigationGuard } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

export const requireAuth: NavigationGuard = (to) => {
  const auth = useAuthStore()
  if (!auth.isAuthenticated) {
    return { name: 'sign-in', query: { redirect: to.fullPath } }
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
