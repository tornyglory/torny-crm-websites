import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AuthUser as ApiUser, Role, UserClub } from '@torny/api-client'

export type { Role }

// Local shape stored in memory + localStorage. We keep only what the CRM needs
// so the persisted blob stays small and stable across API additions.
export interface AuthUser {
  id: number
  email: string
  name: string
  firstName: string
  lastName: string
  role: Role
  clubs: UserClub[]
  isPlatformAdmin: boolean
  avatarUrl: string | null
}

// The API returns a single `name`. The rest of the CRM keys off firstName /
// lastName (for initials, greetings, avatar labels), so split it here once.
function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/)
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') }
}

export function fromApiUser(u: ApiUser): AuthUser {
  const displayName = (u.name ?? u.email).trim()
  const { firstName, lastName } = splitName(displayName)
  return {
    id: u.id,
    email: u.email,
    name: displayName,
    firstName,
    lastName,
    role: u.role,
    clubs: u.clubs ?? [],
    isPlatformAdmin: u.is_platform_admin === true,
    avatarUrl: u.avatar_url,
  }
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem('torny.token'))
  const user = ref<AuthUser | null>(
    (() => {
      const raw = localStorage.getItem('torny.user')
      if (!raw) return null
      try {
        return JSON.parse(raw) as AuthUser
      } catch {
        return null
      }
    })(),
  )

  const isAuthenticated = computed(() => !!token.value)
  const role = computed(() => user.value?.role ?? null)
  const isPlatformAdmin = computed(() => user.value?.isPlatformAdmin === true)
  // Post-M3, canManageClub will also require a matching club_members role.
  // Until then, the top-level role is the highest-tier role a user has anywhere.
  const canManageClub = computed(() => role.value === 'owner' || role.value === 'admin')
  const hasClubAccess = computed(() => (user.value?.clubs ?? []).length > 0)

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

  return {
    token,
    user,
    isAuthenticated,
    role,
    isPlatformAdmin,
    canManageClub,
    hasClubAccess,
    setSession,
    clearSession,
  }
})
