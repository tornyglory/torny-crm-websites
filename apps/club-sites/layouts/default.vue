<script setup lang="ts">
import { computed, ref } from 'vue'
import { SiteHeader, SiteMobileDrawer, SiteFooter } from '@torny/content-blocks'
import type {
  SiteChromeClub,
  NavLink,
  FooterNavColumn,
  SocialLink,
  FooterContact,
} from '@torny/content-blocks'

const club = useClub()
await useTheme()
const { data: site } = await useSite()
const route = useRoute()

const drawerOpen = ref(false)

// Fallback used while the backend endpoint (brief 25) is being built and
// during the SSR-before-payload window. Once the /site payload includes
// `navigation`, that always wins.
const FALLBACK_HEADER: NavLink[] = [
  { label: 'Home', href: '/' },
  { label: 'About', href: '/about' },
  { label: 'Events', href: '/events' },
  { label: 'Honour board', href: '/honour-board' },
  { label: 'Membership', href: '/membership' },
  { label: 'Contact', href: '/contact' },
]

const navLinks = computed<NavLink[]>(() => {
  const header = site.value?.club?.navigation?.header
  return header && header.length > 0 ? (header as NavLink[]) : FALLBACK_HEADER
})

const headerSticky = computed<boolean>(() => Boolean(site.value?.club?.navigation?.headerSticky))
/** @deprecated Legacy prop — pass `headerDisplay` instead. Kept here
 *  as the fallback input to SiteHeader until every published site
 *  rolls over. */
const headerLogoOnly = computed<boolean>(() => Boolean(site.value?.club?.navigation?.logoInHeader))
/** Brief 80 — honour the enum when the backend provides it, otherwise
 *  the header component falls back to the legacy boolean via `logoOnly`. */
const headerDisplay = computed<'logo' | 'name' | 'both' | undefined>(() => {
  const nav = site.value?.club?.navigation as Record<string, unknown> | undefined
  const raw = nav?.header_display ?? nav?.headerDisplay
  if (raw === 'logo' || raw === 'name' || raw === 'both') return raw
  return undefined
})
const headerName = computed<string | null>(() => {
  const nav = site.value?.club?.navigation as Record<string, unknown> | undefined
  const raw = nav?.header_name ?? nav?.headerName
  if (typeof raw === 'string' && raw.trim().length > 0) return raw
  return null
})

// Image treatment preset — brief 79. Drives the design-tokens image
// vars (radius, filter, scrim, duotone overlay) via a single body
// attribute. Defaults to 'soft' when the backend hasn't shipped the
// field yet (step 3 of brief 79).
const imageStyle = computed<'soft' | 'studio' | 'archive'>(
  () => site.value?.club?.image_style ?? 'soft',
)
useHead(() => ({
  bodyAttrs: { 'data-image-style': imageStyle.value },
}))

const chromeClub = computed<SiteChromeClub>(() => ({
  name: club.value?.name ?? 'Torny',
  logoUrl: club.value?.logo_url ?? null,
}))

const primaryCta = { label: 'Join the club', href: '/membership' }

// Footer content. Same structure per tenant — the CMS will surface a
// "site settings" panel later for clubs to override the contact block
// and social links.
const footerColumns: FooterNavColumn[] = [
  {
    heading: 'Explore',
    links: [
      { label: 'Home', href: '/' },
      { label: 'About the club', href: '/about' },
      { label: 'Events', href: '/events' },
      { label: 'Honour board', href: '/honour-board' },
      { label: 'Gallery', href: '/gallery' },
    ],
  },
  {
    heading: 'Play',
    links: [
      { label: 'Membership', href: '/membership' },
      { label: 'Coaching', href: '/coaching' },
      { label: 'Function hire', href: '/venue-hire' },
      { label: 'Sponsors', href: '/sponsors' },
    ],
  },
]

const footerContact: FooterContact = {
  email: 'hello@example.com',
  phone: '(00) 000 0000',
}

const socials: SocialLink[] = [
  { label: 'Instagram', icon: 'instagram', href: '#' },
  { label: 'Facebook', icon: 'facebook', href: '#' },
  { label: 'Email', icon: 'email', href: 'mailto:hello@example.com' },
]

const legalLinks: NavLink[] = [
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
  { label: 'Cookies', href: '/cookies' },
]
</script>

<template>
  <div class="site">
    <SiteHeader
      :club="chromeClub"
      :nav-links="navLinks"
      :current-path="route.path"
      :primary-cta="primaryCta"
      :drawer-open="drawerOpen"
      :sticky="headerSticky"
      :logo-only="headerLogoOnly"
      :header-display="headerDisplay"
      :header-name="headerName"
      @toggle-drawer="drawerOpen = !drawerOpen"
    />

    <SiteMobileDrawer
      :open="drawerOpen"
      :club="chromeClub"
      :nav-links="navLinks"
      :current-path="route.path"
      :primary-cta="primaryCta"
      @close="drawerOpen = false"
    />

    <main class="site__main">
      <slot />
    </main>

    <SiteFooter
      :club="chromeClub"
      description="A community bowling club. Everyone welcome — bring a friend, we'll bring the bowls."
      :socials="socials"
      :columns="footerColumns"
      :contact="footerContact"
      :legal-links="legalLinks"
    />
  </div>
</template>

<style scoped>
.site {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  /* Theme-aware page background — picks up the colour-scheme's ground
     token so any space between blocks (including the layout's own
     margins) matches the chosen theme instead of browser default white. */
  background: var(--color-ground);
}

.site__main {
  flex: 1;
  width: 100%;
  background: var(--color-ground);
}
</style>
