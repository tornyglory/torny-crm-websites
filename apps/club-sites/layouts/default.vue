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
const route = useRoute()

const drawerOpen = ref(false)

// Same nav on every club site — clubs vary block content, not chrome.
// If a page doesn't exist yet for a given club, the link still renders;
// the target page (or a 404) is handled by the router.
const navLinks: NavLink[] = [
  { label: 'Home', href: '/' },
  { label: 'About', href: '/about' },
  { label: 'Events', href: '/events' },
  { label: 'Honour board', href: '/honour-board' },
  { label: 'Membership', href: '/membership' },
  { label: 'Contact', href: '/contact' },
]

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
      { label: 'Members sign in', href: '/sign-in' },
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
      sign-in-href="/sign-in"
      :drawer-open="drawerOpen"
      @toggle-drawer="drawerOpen = !drawerOpen"
    />

    <SiteMobileDrawer
      :open="drawerOpen"
      :club="chromeClub"
      :nav-links="navLinks"
      :current-path="route.path"
      :primary-cta="primaryCta"
      sign-in-href="/sign-in"
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
}

.site__main {
  flex: 1;
  width: 100%;
}
</style>
