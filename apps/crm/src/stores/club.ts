import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  authedFetch,
  CRM_BASE,
  variant as variantApi,
  CLUB_DEFAULT_TERMINOLOGY,
  CLUB_DEFAULT_MODULES,
  CLUB_DEFAULT_JOIN_FORM_SECTIONS,
  filterLegacyJoinFormSections,
  type Club,
  type ClubColorScheme,
  type ClubFonts,
  type ClubStyle,
  type ClubNavigation,
  type UserClub,
  type VariantConfig,
  type VariantTerminology,
  type VariantModules,
  type JoinFormSection,
} from '@torny/api-client'

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

  // Brief 105 — variant config: terminology, module visibility, and the
  // ordered join-form sections. Hydrated after the current club is set;
  // falls back to the `club` vertical defaults if the fetch fails so
  // the CRM renders sensibly offline / pre-hydration.
  const variant = ref<VariantConfig | null>(null)

  const terminology = computed<VariantTerminology>(
    () => variant.value?.terminology ?? CLUB_DEFAULT_TERMINOLOGY,
  )
  const modules = computed<VariantModules>(
    () => variant.value?.modules ?? CLUB_DEFAULT_MODULES,
  )
  const joinFormSections = computed<JoinFormSection[]>(
    () => filterLegacyJoinFormSections(variant.value?.join_form_sections ?? CLUB_DEFAULT_JOIN_FORM_SECTIONS),
  )

  function setCurrent(club: Club) {
    const changed = current.value?.id !== club.id
    current.value = club
    localStorage.setItem(STORAGE_KEY, JSON.stringify(club))
    // Club context changed — refresh variant so terminology + modules
    // line up with whichever club the admin just switched to.
    if (changed) {
      variant.value = null
      void hydrateVariant()
    }
  }

  function clear() {
    current.value = null
    memberships.value = []
    variant.value = null
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
    // Prefer the highest-tier membership first (owner > admin > member).
    const order = { owner: 0, admin: 1, member: 2 } as const
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
    // Variant config is also safe to fire-and-forget — terminology
    // getters fall back to CLUB defaults while the fetch is in flight.
    void hydrateVariant()
  }

  /**
   * Backfill fields not carried by the `UserClub` stub from `/me` — most
   * importantly `slug`, which the Website editor's Preview button (and any
   * other public-site link) needs. Safe to call repeatedly; noops if the
   * current club already has a slug or if the fetch fails.
   */
  async function hydrateFull(opts: { force?: boolean } = {}): Promise<void> {
    const c = current.value
    if (!c) return
    // Normal callers (slug backfill after login, font-picker refresh) only
    // care about filling in a missing slug — short-circuit keeps them cheap.
    // `force` is for callers that need to pick up live mutations from
    // elsewhere (brief 98 subdomain change in another tab, or stale
    // localStorage after a rename). The Preview button uses it.
    if (!opts.force && c.slug) return
    try {
      const res = await authedFetch<Envelope<Club>>(`${CRM_BASE}/clubs/${c.id}`)
      const full = res.data
      if (!full) return
      setCurrent({
        id: full.id,
        name: full.name ?? c.name,
        slug: full.slug ?? null,
        domain: full.domain ?? null,
        emailHandle: full.emailHandle ?? c.emailHandle ?? null,
        brandPrimary: full.brandPrimary ?? c.brandPrimary ?? null,
        brandAccent: full.brandAccent ?? c.brandAccent ?? null,
        logoUrl: full.logoUrl ?? c.logoUrl ?? null,
        faviconUrl: full.faviconUrl ?? c.faviconUrl ?? null,
        imageStyle: full.imageStyle ?? c.imageStyle,
        fonts: full.fonts ?? c.fonts,
        style: full.style ?? c.style,
        colorScheme: full.colorScheme ?? c.colorScheme,
        navigation: full.navigation ?? c.navigation,
      })
    } catch {
      /* transport failure — leave slug null, caller falls back */
    }
  }

  /**
   * Brief 105 — fetch variant config for the current club and cache for
   * the session. Falls back silently on transport failure; the computed
   * `terminology` / `modules` / `joinFormSections` will serve the `club`
   * defaults so the CRM renders sensibly either way.
   *
   * Fire-and-forget: callers don't await. The reactive refs update when
   * the fetch lands, so Vue re-renders sidebar labels + module gates
   * automatically.
   */
  async function hydrateVariant(): Promise<void> {
    const c = current.value
    if (!c) return
    // Don't refetch if we already have the right club's variant.
    if (variant.value && variant.value.club_id === c.id) return
    try {
      const config = await variantApi.getVariant(c.id)
      // Guard against a stale response arriving after the user switched
      // clubs — only commit when the fetch still matches the live club.
      if (current.value?.id === config.club_id) {
        variant.value = config
      }
    } catch {
      /* transport failure — computed getters fall back to CLUB defaults */
    }
  }

  /**
   * Merge in an updated fonts object without disturbing the rest of the
   * club record. Used by the font picker after a successful PATCH so a
   * page refresh sees the new selection immediately.
   */
  function setFonts(fonts: ClubFonts | undefined) {
    const c = current.value
    if (!c) return
    setCurrent({ ...c, fonts })
  }

  /**
   * Same as `setFonts` but for the style preset. Merged in isolation so
   * neither picker overwrites the other's state.
   */
  function setStyle(style: ClubStyle | undefined) {
    const c = current.value
    if (!c) return
    setCurrent({ ...c, style })
  }

  /**
   * Merge in an updated colour scheme. Persisted alongside fonts + style;
   * the CRM Website preview reads `current.colorScheme` to render the
   * chosen palette.
   */
  function setColorScheme(colorScheme: ClubColorScheme | undefined) {
    const c = current.value
    if (!c) return
    setCurrent({ ...c, colorScheme })
  }

  /**
   * Merge in updated logo/favicon URLs after a successful brand-assets
   * PATCH. Either field can be omitted, `null` clears, string sets.
   */
  function setBrandAssets(patch: {
    logoUrl?: string | null
    faviconUrl?: string | null
    imageStyle?: 'soft' | 'studio' | 'archive'
    brandPrimary?: string | null
    brandAccent?: string | null
  }) {
    const c = current.value
    if (!c) return
    setCurrent({
      ...c,
      ...(patch.logoUrl !== undefined ? { logoUrl: patch.logoUrl } : {}),
      ...(patch.faviconUrl !== undefined ? { faviconUrl: patch.faviconUrl } : {}),
      ...(patch.imageStyle !== undefined ? { imageStyle: patch.imageStyle } : {}),
      ...(patch.brandPrimary !== undefined ? { brandPrimary: patch.brandPrimary } : {}),
      ...(patch.brandAccent !== undefined ? { brandAccent: patch.brandAccent } : {}),
    })
  }

  /**
   * Merge in updated navigation trees after a successful PATCH. Missing
   * fields leave stored value alone; the store always keeps whatever the
   * server confirmed.
   */
  function setNavigation(navigation: ClubNavigation | undefined) {
    const c = current.value
    if (!c) return
    setCurrent({ ...c, navigation })
  }

  return {
    current,
    memberships,
    variant,
    terminology,
    modules,
    joinFormSections,
    setCurrent,
    setFonts,
    setStyle,
    setColorScheme,
    setBrandAssets,
    setNavigation,
    clear,
    syncFromUserClubs,
    hydrateFull,
    hydrateVariant,
  }
})
