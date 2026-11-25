import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  auth as authApi,
  claims as claimsApi,
  ApiError,
  type AuthUser as ApiUser,
  type Role,
  type UserClub,
} from '@torny/api-client'
import { captureException } from '@/utils/sentry'

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
  /** Brief 71 §6 — set while a double-opt-in email change is in flight. */
  pendingEmail: string | null
  /** RFC3339, 7 days from the request. Null when no change pending. */
  pendingEmailExpiresAt: string | null
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
    pendingEmail: u.pending_email ?? null,
    pendingEmailExpiresAt: u.pending_email_expires_at ?? null,
  }
}

/** Brief 119 Phase B: sessions live in an HttpOnly cookie, not localStorage.
 *  Only the user shape is cached locally so the sidebar / nav can render
 *  on first paint without waiting for /me. The persisted user is the only
 *  thing we read on bootstrap; the session itself is proved by whatever
 *  cookie the browser has (or doesn't). */
const USER_STORAGE_KEY = 'torny.user'

const SAM_BASE = import.meta.env.VITE_SAM_BASE_URL

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(
    (() => {
      const raw = localStorage.getItem(USER_STORAGE_KEY)
      if (!raw) return null
      try {
        return JSON.parse(raw) as AuthUser
      } catch {
        return null
      }
    })(),
  )

  const isAuthenticated = computed(() => user.value !== null)
  const role = computed(() => user.value?.role ?? null)
  const isPlatformAdmin = computed(() => user.value?.isPlatformAdmin === true)
  // Post-M3, canManageClub will also require a matching club_members role.
  // Until then, the top-level role is the highest-tier role a user has anywhere.
  const canManageClub = computed(() => role.value === 'owner' || role.value === 'admin')
  const hasClubAccess = computed(() => (user.value?.clubs ?? []).length > 0)

  /** Called on sign-in / register success. The session cookie is already
   *  set by the time this runs — we only need to stash the user shape. */
  function setSession(nextUser: AuthUser) {
    user.value = nextUser
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUser))
  }

  /** Local-only clear. Used when the server tells us the session's gone
   *  (401 on /me) so there's nothing to log out of. */
  function clearSession() {
    user.value = null
    localStorage.removeItem(USER_STORAGE_KEY)
  }

  /** Full sign-out: POST /logout so the server deletes the session row +
   *  tells the browser to drop the cookie, then clears local state. If
   *  the server call fails (network, 5xx) we still clear locally so the
   *  user isn't trapped — the cookie will expire naturally in at most
   *  30 days even if we couldn't tell the server now. */
  async function logout(): Promise<void> {
    try {
      await authApi.logout({ baseURL: SAM_BASE })
    } catch (err) {
      captureException(err, { tags: { route: 'auth', step: 'logout' } })
    }
    clearSession()
  }

  /**
   * Refresh the local user from GET /me. Call after actions that may have
   * mutated the caller's role/clubs server-side (e.g. their claim was
   * approved). Silent on 401 — router will handle re-authing. Callers who
   * need the current-club sidebar to stay in sync should also invoke
   * `useClubStore().syncFromUserClubs(user.value?.clubs)` after this
   * resolves — kept as a caller responsibility to avoid a store→store
   * circular import.
   */
  async function refresh(): Promise<void> {
    if (!user.value) return
    try {
      const apiUser = await claimsApi.me()
      user.value = fromApiUser(apiUser)
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user.value))
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearSession()
      }
      // Non-401 errors: leave stored user in place, keep going.
    }
  }

  /** Replace the stored user with a fresh server shape. Used by PATCH /me
   *  callers (name, avatar, email) so the whole app reactively picks up
   *  the new values without a round-trip to GET /me. */
  function updateFromApi(apiUser: ApiUser): void {
    user.value = fromApiUser(apiUser)
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user.value))
  }

  return {
    user,
    isAuthenticated,
    role,
    isPlatformAdmin,
    canManageClub,
    hasClubAccess,
    setSession,
    clearSession,
    logout,
    refresh,
    updateFromApi,
  }
})
