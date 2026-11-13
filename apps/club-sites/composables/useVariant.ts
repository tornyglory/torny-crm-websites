import type { VariantConfig, VariantTerminology, VariantModules, JoinFormSection } from '~/server/utils/tornyApi'

/**
 * Brief 105 — per-tenant variant config. Fetches once per slug and
 * caches via Nuxt's data layer. Consumers read `terminology.join_cta` /
 * `terminology.join_page_title` etc. for labels that should swap when
 * the backend later registers a new vertical (nursing org, rentals, ...).
 *
 * Mirrors the SSR + client-hydration pattern from `useSite`: the Nuxt
 * API route (`/api/variant/:slug`) proxies the public Torny endpoint so
 * SWR cache rules + Workers KV sit on top later without touching page
 * code.
 *
 * Fallback: returns the `club` vertical's defaults when the fetch fails
 * or hasn't landed yet, so pages always have a terminology object to
 * read from and never render an empty CTA.
 */

const CLUB_FALLBACK_TERMINOLOGY: VariantTerminology = {
  member_singular:      'Member',
  member_plural:        'Members',
  application_singular: 'Application',
  application_plural:   'Applications',
  join_cta:             'Join the club',
  join_page_title:      'Join the club.',
}

const CLUB_FALLBACK_MODULES: VariantModules = {
  members: true,
  applications: true,
  enquiries: true,
  events: true,
  teams: true,
  team_selections: true,
  tournaments: true,
  honour_board: true,
  venue_bookings: true,
  venue_packages: true,
  communications: true,
}

// Brief 106 follow-up — `your_bowls` dropped as a hardcoded section
// (owners re-add via custom facets if they want it).
const CLUB_FALLBACK_JOIN_FORM_SECTIONS: JoinFormSection[] = [
  { key: 'tier',              label: 'Choose your tier' },
  { key: 'about_you',         label: 'About you' },
  { key: 'address',           label: 'Home address' },
  { key: 'emergency_contact', label: 'Emergency contact' },
  { key: 'additional',        label: 'Additional questions' },
  { key: 'review',            label: 'Review & agree' },
]

export function useVariant() {
  const club = useClub()
  const nuxtApp = useNuxtApp()

  const { data: variant } = useAsyncData<VariantConfig | null>(
    () => `variant:${club.value?.slug ?? 'unknown'}`,
    async () => {
      if (!club.value?.slug) return null
      return await $fetch<VariantConfig | null>(`/api/variant/${encodeURIComponent(club.value.slug)}`)
    },
    {
      watch: [() => club.value?.slug],
      getCachedData: (key) => {
        const cached = nuxtApp.payload?.data?.[key] ?? nuxtApp.static?.data?.[key]
        return cached ?? undefined
      },
    },
  )

  // Fallback computeds — pages read these directly and never need to
  // null-check the raw variant. When the fetch lands the refs update
  // reactively and labels swap in place.
  const terminology = computed<VariantTerminology>(
    () => variant.value?.terminology ?? CLUB_FALLBACK_TERMINOLOGY,
  )
  const modules = computed<VariantModules>(
    () => variant.value?.modules ?? CLUB_FALLBACK_MODULES,
  )
  const joinFormSections = computed<JoinFormSection[]>(
    () => variant.value?.join_form_sections ?? CLUB_FALLBACK_JOIN_FORM_SECTIONS,
  )

  return { variant, terminology, modules, joinFormSections }
}
