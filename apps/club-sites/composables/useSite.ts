import type { Site } from '~/server/utils/tornyApi'

/**
 * Fetches the club's public site payload — everything a page might need
 * in one request. Keyed by `club.slug` so multiple pages on the same
 * tenant share the underlying cache within a navigation.
 *
 * SSR reads pass through Nuxt's data cache; the SWR route rules in
 * nuxt.config.ts (home 5min, events 1min, honour-board 1hr, etc.) sit on
 * top of this. Purges are driven by server/api/revalidate.post.ts.
 */
export function useSite() {
  const club = useClub()
  const nuxtApp = useNuxtApp()

  return useAsyncData<Site | null>(
    () => `site:${club.value?.slug ?? 'unknown'}`,
    async () => {
      if (!club.value?.slug) return null
      return await $fetch<Site | null>(`/api/site/${encodeURIComponent(club.value.slug)}`)
    },
    {
      // Refetch when the tenant changes (e.g. on dev when swapping via ?host=).
      watch: [() => club.value?.slug],
      // Reuse the payload cache across client-side navigations. Without this,
      // Nuxt re-runs the handler on every route change even though the key
      // is stable — which meant every /about → /events hop was a fresh
      // fetch to /api/site/:slug, blocking render on the round-trip.
      getCachedData: (key) => {
        const cached = nuxtApp.payload?.data?.[key] ?? nuxtApp.static?.data?.[key]
        return cached ?? undefined
      },
    },
  )
}
