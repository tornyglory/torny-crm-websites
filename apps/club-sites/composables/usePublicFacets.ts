import type { CustomFacet } from '~/server/utils/tornyApi'

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
    () => `facets:${club.value?.slug ?? 'unknown'}`,
    async () => {
      if (!club.value?.slug) return []
      return await $fetch<CustomFacet[]>(`/api/custom-facets/${encodeURIComponent(club.value.slug)}`)
    },
    {
      watch: [() => club.value?.slug],
      default: () => [],
      getCachedData: (key) => {
        const cached = nuxtApp.payload?.data?.[key] ?? nuxtApp.static?.data?.[key]
        return cached ?? undefined
      },
    },
  )

  return { facets }
}
