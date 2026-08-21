import { defineStore } from 'pinia'
import { ref } from 'vue'
import { authedFetch, CRM_BASE, type Club, type UserClub } from '@torny/api-client'

interface Envelope<T> { status: string; data: T }

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
    // Fire-and-forget slug backfill. The stub above renders instantly; the
    // full record (slug, brand, logo) fills in a moment later.
    void hydrateFull()
  }

  /**
   * Backfill fields not carried by the `UserClub` stub from `/me` — most
   * importantly `slug`, which the Website editor's Preview button (and any
   * other public-site link) needs. Safe to call repeatedly; noops if the
   * current club already has a slug or if the fetch fails.
   */
  async function hydrateFull(): Promise<void> {
    const c = current.value
    if (!c || c.slug) return
    try {
      const res = await authedFetch<Envelope<Club>>(`${CRM_BASE}/clubs/${c.id}`)
      const full = res.data
      if (!full) return
      setCurrent({
        id: full.id,
        name: full.name ?? c.name,
        slug: full.slug ?? null,
        domain: full.domain ?? null,
        brandPrimary: full.brandPrimary ?? c.brandPrimary ?? null,
        logoUrl: full.logoUrl ?? c.logoUrl ?? null,
      })
    } catch {
      /* transport failure — leave slug null, caller falls back */
    }
  }

  return { current, memberships, setCurrent, clear, syncFromUserClubs, hydrateFull }
})
