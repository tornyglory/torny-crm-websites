import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Club, UserClub } from '@torny/api-client'

const STORAGE_KEY = 'torny.currentClub'

function loadCurrent(): Club | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as Club
  } catch {
    return null
  }
}

export const useClubStore = defineStore('club', () => {
  const current = ref<Club | null>(loadCurrent())
  const memberships = ref<Club[]>([])

  function setCurrent(club: Club) {
    current.value = club
    localStorage.setItem(STORAGE_KEY, JSON.stringify(club))
  }

  function clear() {
    current.value = null
    memberships.value = []
    localStorage.removeItem(STORAGE_KEY)
  }

  /**
   * Hydrate `current` from a user's `clubs[]`. Picks the first
   * owner/admin/committee membership if `current` is unset or points at a
   * club the user no longer has access to. Safe to call on every session
   * change — no-op if `current` is still valid.
   */
  function syncFromUserClubs(clubs: UserClub[] | undefined) {
    if (!clubs || clubs.length === 0) {
      // User has no clubs — clear stale current if any.
      if (current.value) clear()
      return
    }
    const stillValid = current.value && clubs.some((c) => c.id === current.value?.id)
    if (stillValid) return
    // Prefer the highest-tier membership first (owner > admin > committee).
    const order = { owner: 0, admin: 1, committee: 2 } as const
    const sorted = [...clubs].sort((a, b) => (order[a.role] ?? 99) - (order[b.role] ?? 99))
    const pick = sorted[0]!
    setCurrent({
      id: pick.id,
      name: pick.name ?? `Club #${pick.id}`,
      slug: null,
      domain: null,
      brandPrimary: null,
      logoUrl: null,
    })
  }

  return { current, memberships, setCurrent, clear, syncFromUserClubs }
})
