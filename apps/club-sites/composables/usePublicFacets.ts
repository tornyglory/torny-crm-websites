import type { CustomFacet } from '~/server/utils/tornyApiTypes'

/**
 * Brief 105 — fetches the public custom facets for the active tenant.
 * Mirrors useSite + useVariant's SSR + hydration pattern. Returns an
 * empty array when the fetch fails or the club has no facets — the
 * join form renders nothing extra in that case.
 */
export function usePublicFacets() {
  const club = useClub()
  const nuxtApp = useNuxtApp()

  const { data: facets } = useAsyncData<CustomFacet[]>(
    // Brief 110 — custom-facets endpoint still keys on subdomain
    // (not clubs_data.slug). Prefer `subdomain`; fall back to `slug`.
    () => `facets:${club.value?.subdomain ?? club.value?.slug ?? 'unknown'}`,
    async () => {
      const key = club.value?.subdomain ?? club.value?.slug
      if (!key) return []
      return await $fetch<CustomFacet[]>(`/api/custom-facets/${encodeURIComponent(key)}`)
    },
    {
      watch: [() => club.value?.subdomain, () => club.value?.slug],
      default: () => [],
      getCachedData: (key) => {
        const cached = nuxtApp.payload?.data?.[key] ?? nuxtApp.static?.data?.[key]
        return cached ?? undefined
      },
    },
  )

  return { facets }
}
