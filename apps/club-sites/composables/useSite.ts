import type { Site } from '~/server/utils/tornyApi'

/**
 * Fetches the club's public site payload — everything a page might need
 * in one request. Keyed by `club.subdomain ?? club.slug` so multiple
 * pages on the same tenant share the underlying cache within a navigation.
 *
 * Brief 110 — the SAM-side `/public/clubs/:slug/site` endpoint keys on
 * `clubs_data.subdomain`, not `clubs_data.slug`. Pre-brief-110, resolve
 * mislabelled subdomain as `slug` and the two shapes were identical, so
 * this code worked. Post-fix, the Naenae and Richmond Union drift clubs
 * had `club.slug` flip to the canonical slug and `/site` 404'd — every
 * page rendered the chrome-only fallback because `useSite()` returned
 * null. Preferring `subdomain` here restores the resolve path the
 * endpoint expects.
 *
 * SSR reads pass through Nuxt's data cache; the SWR route rules in
 * nuxt.config.ts (home 5min, events 1min, honour-board 1hr, etc.) sit on
 * top of this. Purges are driven by server/api/revalidate.post.ts.
 */
export function useSite() {
  const club = useClub()
  const nuxtApp = useNuxtApp()

  const siteKey = () => club.value?.subdomain ?? club.value?.slug ?? null

  return useAsyncData<Site | null>(
    () => `site:${siteKey() ?? 'unknown'}`,
    async () => {
      const key = siteKey()
      if (!key) return null
      return await $fetch<Site | null>(`/api/site/${encodeURIComponent(key)}`)
    },
    {
      // Refetch when the tenant changes (e.g. on dev when swapping via ?host=).
      watch: [() => club.value?.subdomain, () => club.value?.slug],
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
