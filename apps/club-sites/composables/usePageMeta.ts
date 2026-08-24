// Per-page SEO meta tags. Reads from the /site payload (brief 26) and
// emits <title>, <meta description>, and open-graph + twitter equivalents.
//
// The backend already resolves the fallback chain (page meta → site
// default → derived), so this composable just consumes what it's given.
// Falls back to a page-label derived title on cold loads before the /site
// payload lands, so cold SSR never emits an empty <title>.

import type { PageSlug } from '~/server/utils/tornyApi'

const PAGE_LABEL: Record<PageSlug, string> = {
  home: '',
  about: 'About',
  membership: 'Membership',
  events: 'Events',
  'honour-board': 'Honour board',
  contact: 'Contact',
}

export function usePageMeta(slug: PageSlug) {
  const club = useClub()
  const { data: site } = useSite()

  useSeoMeta({
    title: () => {
      // Server-resolved page meta wins.
      const stored = site.value?.pages?.[slug]?.meta?.title
      if (stored) return stored
      // Fallback: derive from page label + club name.
      const clubName = site.value?.club?.name ?? club.value?.name ?? 'Torny'
      const label = PAGE_LABEL[slug]
      return label ? `${label} — ${clubName}` : clubName
    },
    description: () => {
      const stored = site.value?.pages?.[slug]?.meta?.description
      if (stored) return stored
      return site.value?.club?.short_description ?? undefined
    },
    ogTitle: () => {
      const stored = site.value?.pages?.[slug]?.meta?.title
      if (stored) return stored
      const clubName = site.value?.club?.name ?? club.value?.name ?? 'Torny'
      const label = PAGE_LABEL[slug]
      return label ? `${label} — ${clubName}` : clubName
    },
    ogDescription: () => {
      const stored = site.value?.pages?.[slug]?.meta?.description
      if (stored) return stored
      return site.value?.club?.short_description ?? undefined
    },
    ogImage: () => site.value?.club?.logo_url ?? undefined,
    twitterCard: 'summary_large_image',
    twitterTitle: () => {
      const stored = site.value?.pages?.[slug]?.meta?.title
      if (stored) return stored
      const clubName = site.value?.club?.name ?? club.value?.name ?? 'Torny'
      const label = PAGE_LABEL[slug]
      return label ? `${label} — ${clubName}` : clubName
    },
    twitterDescription: () => {
      const stored = site.value?.pages?.[slug]?.meta?.description
      if (stored) return stored
      return site.value?.club?.short_description ?? undefined
    },
  })
}
