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
// Brief 105: terminology drives the "Join the club" CTA label so the
// header + drawer swap when the backend ships a new vertical.
const { terminology } = useVariant()
const route = useRoute()

const drawerOpen = ref(false)

// Fallback used while the backend endpoint (brief 25) is being built and
// during the SSR-before-payload window. Once the /site payload includes
// `navigation`, that always wins. Venue hire sits between Membership and
// Contact so clubs on the fallback still surface their venue-hire CTA
// after a Stripe redirect (brief 110 regression: /site 404s on drift
// clubs push the chrome into this fallback).
const FALLBACK_HEADER: NavLink[] = [
  { label: 'Home', href: '/' },
  { label: 'About', href: '/about' },
  { label: 'Events', href: '/events' },
  { label: 'Honour board', href: '/honour-board' },
  { label: 'Membership', href: '/membership' },
  { label: 'Venue hire', href: '/venue-hire' },
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

/** Club's plan tier for the footer badge next to the "Powered by Torny"
 *  wordmark. Reads from the public site payload — the backend started
 *  carrying it on `/me` in brief 93 and can hydrate it on `/site` too.
 *  When absent the SiteFooter falls back to the generic "OS" tag. */
const clubPlan = computed<'starter' | 'pro' | undefined>(() => {
  const raw = (site.value?.club as Record<string, unknown> | undefined)?.plan
    ?? (club.value as Record<string, unknown> | undefined)?.plan
  if (raw === 'starter' || raw === 'pro') return raw
  return undefined
})

const primaryCta = computed(() => ({ label: terminology.value.join_cta, href: '/membership' }))

// Hardcoded footer defaults (brief 115 §1: `footer: null` on the public
// /site payload means the admin has never configured one, so we fall
// through to these so-every-club-still-has-a-footer values). Once the
// admin saves anything in Settings → Website → Footer, `site.footer`
// becomes authoritative and these are ignored.
const FALLBACK_FOOTER_COLUMNS: FooterNavColumn[] = [
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

const FALLBACK_FOOTER_CONTACT: FooterContact = {
  email: 'hello@example.com',
  phone: '(00) 000 0000',
}

const FALLBACK_FOOTER_SOCIALS: SocialLink[] = [
  { label: 'Instagram', icon: 'instagram', href: '#' },
  { label: 'Facebook', icon: 'facebook', href: '#' },
  { label: 'Email', icon: 'email', href: 'mailto:hello@example.com' },
]

const FALLBACK_FOOTER_LEGAL_LINKS: NavLink[] = [
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
  { label: 'Cookies', href: '/cookies' },
]

const FALLBACK_FOOTER_DESCRIPTION =
  "A community bowling club. Everyone welcome — bring a friend, we'll bring the bowls."

const footerConfig = computed(() => site.value?.footer ?? null)

const footerDescription = computed<string>(
  () => footerConfig.value?.description ?? FALLBACK_FOOTER_DESCRIPTION,
)

const footerColumns = computed<FooterNavColumn[]>(() => {
  const saved = footerConfig.value?.columns
  if (!saved) return FALLBACK_FOOTER_COLUMNS
  return saved.map((col) => ({
    heading: col.heading,
    links: col.links.map((link) => ({ label: link.label, href: link.href })),
  }))
})

const socials = computed<SocialLink[]>(() => {
  const saved = footerConfig.value?.socials
  if (!saved) return FALLBACK_FOOTER_SOCIALS
  return saved.map((s) => ({
    label: s.label,
    href: s.href,
    icon: s.icon,
  }))
})

const legalLinks = computed<NavLink[]>(() => {
  const saved = footerConfig.value?.legal_links
  if (!saved) return FALLBACK_FOOTER_LEGAL_LINKS
  return saved.map((l) => ({ label: l.label, href: l.href }))
})

// The server owns the canonical contact block (site.contact). When the
// admin sets a footer-only override, we use that; otherwise we project
// the canonical contact into the FooterContact shape so the footer stays
// useful for every club.
const footerContact = computed<FooterContact>(() => {
  const override = footerConfig.value?.contact_override
  if (override) {
    const contact: FooterContact = {}
    if (override.email) contact.email = override.email
    if (override.phone) contact.phone = override.phone
    if (override.address_lines?.length) contact.addressLines = override.address_lines
    if (override.status) contact.status = override.status
    return contact
  }

  const canonical = site.value?.contact
  if (!canonical) return FALLBACK_FOOTER_CONTACT
  const contact: FooterContact = {}
  if (canonical.email) contact.email = canonical.email
  if (canonical.phone) contact.phone = canonical.phone
  if (canonical.address) contact.addressLines = [canonical.address]
  return contact
})
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
      :description="footerDescription"
      :socials="socials"
      :columns="footerColumns"
      :contact="footerContact"
      :legal-links="legalLinks"
      :header-name="headerName"
      :plan="clubPlan"
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
