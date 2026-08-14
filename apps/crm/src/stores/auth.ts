import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type Role = 'owner' | 'admin' | 'committee' | 'player'

interface AuthUser {
  id: string
  firstName: string
  lastName: string
  email: string
  role: Role
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem('torny.token'))
  const user = ref<AuthUser | null>(
    (() => {
      const raw = localStorage.getItem('torny.user')
      return raw ? (JSON.parse(raw) as AuthUser) : null
    })(),
  )

  const isAuthenticated = computed(() => !!token.value)
  const role = computed(() => user.value?.role ?? null)
  const canManageClub = computed(() => role.value === 'owner' || role.value === 'admin')

  function setSession(nextToken: string, nextUser: AuthUser) {
    token.value = nextToken
    user.value = nextUser
    localStorage.setItem('torny.token', nextToken)
    localStorage.setItem('torny.user', JSON.stringify(nextUser))
  }

  function clearSession() {
    token.value = null
    user.value = null
    localStorage.removeItem('torny.token')
    localStorage.removeItem('torny.user')
  }

  return { token, user, isAuthenticated, role, canManageClub, setSession, clearSession }
})
