<script setup lang="ts">
/**
 * Website settings panel — the non-page-editor half of the Website section.
 *
 * Hosts every setting that isn't per-page: navigation labels/order (drives
 * the shared SiteHeader + SiteFooter chrome), brand, SEO, domain, forms,
 * analytics. Rendered inline by WebsiteEditorView when the active tab is a
 * settings section rather than a page slug.
 *
 * All state is currently local — the real API wiring lives in a follow-up
 * ticket (site-settings persistence + read-through to the Nuxt layout).
 */
import { computed, reactive, ref, watch } from 'vue'
import CrmModal from '@/components/modals/CrmModal.vue'
import CrmSpinner from '@/components/CrmSpinner.vue'
import FontPicker from '@/components/FontPicker.vue'
import StylePicker from '@/components/StylePicker.vue'
import ColorSchemePicker from '@/components/ColorSchemePicker.vue'
import ImagePicker from '@/components/ImagePicker.vue'
import { ApiError, clubs, navigation as navigationApi, type NavItem } from '@torny/api-client'
import { useToast } from '@/composables/useToast'
import { useClubStore } from '@/stores/club'

export type WebsiteSettingsSection =
  | 'navigation'
  | 'brand'
  | 'seo'
  | 'domain'
  | 'forms'
  | 'analytics'

const props = defineProps<{
  section: WebsiteSettingsSection
}>()

const toast = useToast()
const clubStore = useClubStore()
// Reactive so refresh + hydrateFull both light up the correct card.
const fontSlug = computed<string | null>(() => clubStore.current?.fonts?.slug ?? null)
const styleSlug = computed<string | null>(() => clubStore.current?.style?.slug ?? null)
const colorSchemeSlug = computed<string | null>(() => clubStore.current?.colorScheme?.slug ?? null)

function onFontSlugChange(_slug: string | null) {
  void clubStore.hydrateFull()
}
function onStyleSlugChange(_slug: string | null) {
  void clubStore.hydrateFull()
}
function onColorSchemeSlugChange(_slug: string | null) {
  void clubStore.hydrateFull()
}

const domain = ref({
  custom: 'kelburnbowls.co.nz',
  status: 'live' as 'live' | 'pending' | 'unset',
  ssl: 'issued' as 'issued' | 'issuing' | 'error',
  fallback: 'kelburn.torny.co',
  redirectWww: true,
  dnsRecords: [
    { type: 'CNAME', host: 'kelburnbowls.co.nz', value: 'proxy.torny.pages.dev', status: 'ok' as 'ok' | 'missing' | 'wrong' },
    { type: 'TXT', host: '_torny-verify', value: 'torny=verify-abc123', status: 'ok' as 'ok' | 'missing' | 'wrong' },
    { type: 'CNAME', host: 'www.kelburnbowls.co.nz', value: 'proxy.torny.pages.dev', status: 'ok' as 'ok' | 'missing' | 'wrong' },
  ],
})

// Reactive view of the persisted brand assets. Two-way with the store so
// a successful PATCH round-trip lights up other CRM surfaces too.
const brandLogoUrl = computed<string>({
  get: () => clubStore.current?.logoUrl ?? '',
  set: (value) => {
    void persistBrandAsset('logo_url', value)
  },
})
const brandFaviconUrl = computed<string>({
  get: () => clubStore.current?.faviconUrl ?? '',
  set: (value) => {
    void persistBrandAsset('favicon_url', value)
  },
})

// ── Brand colour overrides (brief 81) ─────────────────────────────
// Admin-picked hex values that override the colour-scheme preset on
// the public site. `null` on either = "no override" (fall back to
// scheme defaults). Values persist to clubs_data via
// PATCH /brand-assets, same pattern as logo/favicon/image_style.
const PALETTE_DEFAULT_PRIMARY = '#2563EB'
const PALETTE_DEFAULT_ACCENT = '#16A34A'
const brandPrimary = ref<string>(clubStore.current?.brandPrimary ?? PALETTE_DEFAULT_PRIMARY)
const brandAccent = ref<string>(clubStore.current?.brandAccent ?? PALETTE_DEFAULT_ACCENT)
const brandPrimaryOverridden = ref<boolean>(clubStore.current?.brandPrimary != null)
const brandAccentOverridden = ref<boolean>(clubStore.current?.brandAccent != null)
const brandSaving = ref<'primary' | 'accent' | null>(null)
const HEX_RE = /^#[0-9A-Fa-f]{6}$/

async function persistBrandColour(field: 'brand_primary' | 'brand_accent', value: string | null) {
  const clubId = clubStore.current?.id
  if (typeof clubId !== 'number') {
    toast.error('No active club — refresh and try again.')
    return
  }
  if (value !== null && !HEX_RE.test(value)) {
    toast.error(`${field === 'brand_primary' ? 'Primary' : 'Accent'} colour must be a 6-digit hex (#RRGGBB).`)
    return
  }
  brandSaving.value = field === 'brand_primary' ? 'primary' : 'accent'
  try {
    // Brief 83 shipped the validator relaxation, so a colour-only PATCH
    // passes without echoing logo/favicon URLs. The response reliably
    // echoes both brand_primary + brand_accent, so we trust it directly.
    const res = await clubs.updateBrandAssets(clubId, { [field]: value })
    clubStore.setBrandAssets({
      logoUrl: res.logo_url,
      faviconUrl: res.favicon_url,
      imageStyle: res.image_style,
      brandPrimary: res.brand_primary ?? null,
      brandAccent: res.brand_accent ?? null,
    })
    if (field === 'brand_primary') {
      brandPrimary.value = res.brand_primary ?? PALETTE_DEFAULT_PRIMARY
      brandPrimaryOverridden.value = res.brand_primary != null
    } else {
      brandAccent.value = res.brand_accent ?? PALETTE_DEFAULT_ACCENT
      brandAccentOverridden.value = res.brand_accent != null
    }
    toast.success(value === null
      ? `${field === 'brand_primary' ? 'Primary' : 'Accent'} reset to the palette default.`
      : `${field === 'brand_primary' ? 'Primary' : 'Accent'} colour saved.`)
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Could not save colour.'
    toast.error(msg)
  } finally {
    brandSaving.value = null
  }
}

/** Fired from the `<input type="color">` change event. Browsers fire
 *  `change` on close of the colour picker, not every pixel drag — so
 *  one API call per selection, no debounce needed. */
function onBrandColourChange(field: 'brand_primary' | 'brand_accent', hex: string) {
  const normalised = hex.toUpperCase()
  void persistBrandColour(field, normalised)
}

function resetBrandColour(field: 'brand_primary' | 'brand_accent') {
  void persistBrandColour(field, null)
}

// Keep local refs in sync with the store so a hydrateFull round-trip
// doesn't clobber mid-edit state.
watch(
  () => [clubStore.current?.brandPrimary, clubStore.current?.brandAccent] as const,
  ([p, a]) => {
    if (brandSaving.value === 'primary') return
    if (brandSaving.value === 'accent') return
    brandPrimary.value = p ?? PALETTE_DEFAULT_PRIMARY
    brandAccent.value = a ?? PALETTE_DEFAULT_ACCENT
    brandPrimaryOverridden.value = p != null
    brandAccentOverridden.value = a != null
  },
)

// Toggle persists immediately via the shared navigation PATCH — simpler
// than batching into the main Save Navigation flow, matches the
// instant-save pattern of brandLogoUrl / brandFaviconUrl.
async function toggleLogoInHeader() {
  const clubId = clubStore.current?.id
  if (typeof clubId !== 'number') {
    toast.error('No active club — refresh and try again.')
    return
  }
  if (logoInHeaderSaving.value) return
  const next = !logoInHeader.value
  logoInHeader.value = next
  logoInHeaderSaving.value = true
  try {
    const res = await navigationApi.updateForClub(clubId, { logoInHeader: next })
    clubStore.setNavigation({
      header: res.header ?? DEFAULT_HEADER,
      footer: res.footer ?? DEFAULT_FOOTER,
      headerSticky: res.headerSticky,
      logoInHeader: res.logoInHeader,
    })
    toast.success(next ? 'Using logo in the header.' : 'Showing the club name in the header.')
  } catch (err) {
    // Revert optimistic flip on failure.
    logoInHeader.value = !next
    const msg = err instanceof ApiError ? err.message : 'Could not update header.'
    toast.error(msg)
  } finally {
    logoInHeaderSaving.value = false
  }
}

async function persistBrandAsset(field: 'logo_url' | 'favicon_url', value: string) {
  const clubId = clubStore.current?.id
  if (typeof clubId !== 'number') {
    toast.error('No active club — refresh and try again.')
    return
  }
  const payload = { [field]: value || null } as Record<'logo_url' | 'favicon_url', string | null>
  try {
    const res = await clubs.updateBrandAssets(clubId, payload)
    clubStore.setBrandAssets({
      logoUrl: res.logo_url,
      faviconUrl: res.favicon_url,
      imageStyle: res.image_style,
      brandPrimary: res.brand_primary ?? null,
      brandAccent: res.brand_accent ?? null,
    })
    toast.success(value ? `${field === 'logo_url' ? 'Logo' : 'Favicon'} saved.` : `${field === 'logo_url' ? 'Logo' : 'Favicon'} removed.`)
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : `Could not save ${field.replace('_', ' ')}`
    toast.error(msg || 'Could not save')
  }
}

// ── Image style (brief 79) ────────────────────────────────────────
// One treatment per club, applied site-wide via <body data-image-style>.
// Defaults to 'soft' until the backend echoes a stored value.
type ImageStyleOption = 'soft' | 'studio' | 'archive'
const imageStyleOptions: Array<{ value: ImageStyleOption; label: string; sub: string }> = [
  { value: 'soft',    label: 'Soft',    sub: 'Warm and rounded — forgiving on phone photos.' },
  { value: 'studio',  label: 'Studio',  sub: 'Crisp, punchy, editorial — glossy brochure look.' },
  { value: 'archive', label: 'Archive', sub: 'Monochrome with a brand tint — unifies mixed sources.' },
]
const imageStyle = computed<ImageStyleOption>(() => clubStore.current?.imageStyle ?? 'soft')
const imageStyleSaving = ref(false)

async function onImageStyle(next: ImageStyleOption) {
  if (next === imageStyle.value || imageStyleSaving.value) return
  const clubId = clubStore.current?.id
  if (typeof clubId !== 'number') {
    toast.error('No active club — refresh and try again.')
    return
  }
  const prev = imageStyle.value
  // Optimistic — surface flips immediately.
  clubStore.setBrandAssets({ imageStyle: next })
  imageStyleSaving.value = true
  try {
    const res = await clubs.updateBrandAssets(clubId, { image_style: next })
    clubStore.setBrandAssets({
      logoUrl: res.logo_url,
      faviconUrl: res.favicon_url,
      imageStyle: res.image_style ?? next,
      brandPrimary: res.brand_primary ?? null,
      brandAccent: res.brand_accent ?? null,
    })
    toast.success(`Image style set to ${next.charAt(0).toUpperCase()}${next.slice(1)}.`)
  } catch (err) {
    clubStore.setBrandAssets({ imageStyle: prev })
    const msg = err instanceof ApiError ? err.message : 'Could not save image style'
    toast.error(msg || 'Could not save')
  } finally {
    imageStyleSaving.value = false
  }
}

// ── Brief 80 persistence handlers ─────────────────────────────────
async function onHeaderDisplay(next: HeaderDisplayOption) {
  if (next === headerDisplay.value || headerDisplaySaving.value) return
  const clubId = clubStore.current?.id
  if (typeof clubId !== 'number') {
    toast.error('No active club — refresh and try again.')
    return
  }
  const prev = headerDisplay.value
  headerDisplay.value = next
  headerDisplaySaving.value = true
  try {
    const res = await navigationApi.updateForClub(clubId, { headerDisplay: next })
    clubStore.setNavigation({
      header: res.header ?? DEFAULT_HEADER,
      footer: res.footer ?? DEFAULT_FOOTER,
      headerSticky: res.headerSticky,
      logoInHeader: res.logoInHeader,
      headerName: res.headerName ?? null,
      headerDisplay: res.headerDisplay ?? next,
    })
    logoInHeader.value = res.logoInHeader
    toast.success('Header display updated.')
  } catch (err) {
    headerDisplay.value = prev
    const msg = err instanceof ApiError ? err.message : 'Could not update header display.'
    toast.error(msg)
  } finally {
    headerDisplaySaving.value = false
  }
}

async function saveHeaderName() {
  if (!headerNameDirty.value || headerNameSaving.value) return
  const clubId = clubStore.current?.id
  if (typeof clubId !== 'number') {
    toast.error('No active club — refresh and try again.')
    return
  }
  const trimmed = headerName.value.trim()
  const desired: string | null = trimmed.length === 0 ? null : trimmed
  headerNameSaving.value = true
  try {
    const res = await navigationApi.updateForClub(clubId, { headerName: desired })
    const persistedName: string | null = res.headerName ?? null
    clubStore.setNavigation({
      header: res.header ?? DEFAULT_HEADER,
      footer: res.footer ?? DEFAULT_FOOTER,
      headerSticky: res.headerSticky,
      logoInHeader: res.logoInHeader,
      headerName: persistedName,
      headerDisplay: res.headerDisplay ?? headerDisplay.value,
    })
    headerName.value = persistedName ?? ''
    headerNameInitial.value = persistedName ?? ''
    toast.success(desired ? 'Header name saved.' : 'Using the club name.')
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Could not save header name.'
    toast.error(msg)
  } finally {
    headerNameSaving.value = false
  }
}

const seo = ref({
  metaTitle: 'Kelburn Bowling Club — Wellington',
  metaDescription: 'A friendly lawn bowls club in the heart of Wellington. Est. 1908. Join us for roll-ups, pennant, and socials.',
  ogImage: 'og-hero.jpg',
  robotsAllowed: true,
})

// Platform defaults used when the club hasn't stored anything yet. Mirrors
// the shape brief 25 will return once the backend endpoint ships.
const DEFAULT_HEADER: NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'About', href: '/about' },
  { label: 'Events', href: '/events' },
  { label: 'Honour board', href: '/honour-board' },
  { label: 'Membership', href: '/membership' },
  { label: 'Contact', href: '/contact' },
]
const DEFAULT_FOOTER: NavItem[] = [
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
  { label: 'Cookies', href: '/cookies' },
]

// Working copies. Populated from the store on mount + whenever it changes.
const navHeader = ref<NavItem[]>(cloneNav(clubStore.current?.navigation?.header ?? DEFAULT_HEADER))
const navFooter = ref<NavItem[]>(cloneNav(clubStore.current?.navigation?.footer ?? DEFAULT_FOOTER))
const headerSticky = ref<boolean>(Boolean(clubStore.current?.navigation?.headerSticky))
/** Logo-in-header toggle — persists through the same navigation PATCH
 *  as headerSticky (brief 62). Saved immediately on toggle, no "Save"
 *  button required, so admins get instant feedback. */
const logoInHeader = ref<boolean>(Boolean(clubStore.current?.navigation?.logoInHeader))
const logoInHeaderSaving = ref(false)

// ── Brief 80 — header display mode + custom name ────────────────
// Three-state display (logo / name / both) supersedes the old boolean.
// `headerName` is a nullable override of `club.name` in the header.
type HeaderDisplayOption = 'logo' | 'name' | 'both'
function initialHeaderDisplay(): HeaderDisplayOption {
  const nav = clubStore.current?.navigation
  if (nav?.headerDisplay === 'logo' || nav?.headerDisplay === 'name' || nav?.headerDisplay === 'both') {
    return nav.headerDisplay
  }
  return nav?.logoInHeader ? 'logo' : 'name'
}
const headerDisplay = ref<HeaderDisplayOption>(initialHeaderDisplay())
const headerDisplayOptions: Array<{ value: HeaderDisplayOption; label: string; sub: string }> = [
  { value: 'name', label: 'Name only',    sub: 'The club name in text. Works even without a logo uploaded.' },
  { value: 'logo', label: 'Logo only',    sub: 'Just the uploaded logo image. Needs a logo on file.' },
  { value: 'both', label: 'Logo + name',  sub: 'Logo mark next to the name — a classic header lockup.' },
]
const headerDisplaySaving = ref(false)
const headerName = ref<string>(clubStore.current?.navigation?.headerName ?? '')
const headerNameInitial = ref<string>(clubStore.current?.navigation?.headerName ?? '')
const headerNameSaving = ref(false)
const headerNameDirty = computed(() => headerName.value.trim() !== headerNameInitial.value.trim())

const navDirty = ref(false)
const navSaving = ref(false)

function cloneNav(items: NavItem[]): NavItem[] {
  return items.map((it) => ({
    label: it.label,
    ...(it.href !== undefined ? { href: it.href } : {}),
    ...(it.external !== undefined ? { external: it.external } : {}),
    ...(it.children ? { children: it.children.map((c) => ({ ...c })) } : {}),
  }))
}

watch(
  () => clubStore.current?.navigation,
  (nav) => {
    if (navDirty.value) return  // don't clobber a mid-edit user
    navHeader.value = cloneNav(nav?.header ?? DEFAULT_HEADER)
    navFooter.value = cloneNav(nav?.footer ?? DEFAULT_FOOTER)
    headerSticky.value = Boolean(nav?.headerSticky)
    logoInHeader.value = Boolean(nav?.logoInHeader)
    // Re-sync brief 80 fields when the server echoes new values.
    headerDisplay.value = initialHeaderDisplay()
    headerName.value = nav?.headerName ?? ''
    headerNameInitial.value = nav?.headerName ?? ''
  },
  { deep: true },
)

function markDirty() {
  navDirty.value = true
}

function moveItem(list: NavItem[], idx: number, dir: -1 | 1) {
  const target = idx + dir
  if (target < 0 || target >= list.length) return
  const [item] = list.splice(idx, 1) as [NavItem]
  list.splice(target, 0, item)
  markDirty()
}
function removeItem(list: NavItem[], idx: number) {
  list.splice(idx, 1)
  markDirty()
}
function addTopLevel(list: NavItem[]) {
  list.push({ label: 'New link', href: '/' })
  markDirty()
}
function addChild(item: NavItem) {
  if (!item.children) item.children = []
  item.children.push({ label: 'New sub-link', href: '/' })
  markDirty()
}
function removeChild(item: NavItem, idx: number) {
  if (!item.children) return
  item.children.splice(idx, 1)
  if (item.children.length === 0) delete item.children
  markDirty()
}
function moveChild(item: NavItem, idx: number, dir: -1 | 1) {
  if (!item.children) return
  moveItem(item.children, idx, dir)
}

async function saveNavigation() {
  const clubId = clubStore.current?.id
  if (typeof clubId !== 'number') {
    toast.error('No active club — refresh and try again.')
    return
  }
  navSaving.value = true
  const payload = {
    header: cloneNav(navHeader.value),
    footer: cloneNav(navFooter.value),
    headerSticky: headerSticky.value,
    logoInHeader: logoInHeader.value,
  }
  try {
    const res = await navigationApi.updateForClub(clubId, payload)
    clubStore.setNavigation({
      header: res.header ?? DEFAULT_HEADER,
      footer: res.footer ?? DEFAULT_FOOTER,
      headerSticky: res.headerSticky,
      logoInHeader: res.logoInHeader,
    })
    navDirty.value = false
    toast.success('Navigation saved.')
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Could not save navigation'
    toast.error(msg || 'Could not save navigation')
  } finally {
    navSaving.value = false
  }
}
function resetNavigation() {
  navHeader.value = cloneNav(clubStore.current?.navigation?.header ?? DEFAULT_HEADER)
  navFooter.value = cloneNav(clubStore.current?.navigation?.footer ?? DEFAULT_FOOTER)
  headerSticky.value = Boolean(clubStore.current?.navigation?.headerSticky)
  navDirty.value = false
}

function toggleHeaderSticky() {
  headerSticky.value = !headerSticky.value
  markDirty()
}

const forms = ref([
  { id: 'form-contact', label: 'Contact form', recipients: 'admin@kelburnbowls.co.nz', autoReply: true, spamFilter: 'strict' },
  { id: 'form-membership', label: 'Membership application', recipients: 'admin@kelburnbowls.co.nz', autoReply: true, spamFilter: 'moderate' },
  { id: 'form-rsvp', label: 'Event RSVPs', recipients: 'events@kelburnbowls.co.nz', autoReply: false, spamFilter: 'moderate' },
])

const analytics = ref({
  provider: 'plausible' as 'none' | 'ga4' | 'plausible',
  gaId: '',
  plausibleDomain: 'kelburnbowls.co.nz',
  cookieBanner: false,
})

function copyToClipboard(value: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    void navigator.clipboard.writeText(value).catch(() => { /* noop */ })
  }
  toast.success('Copied to clipboard.')
}
function replaceUpload(what: string) {
  toast.info(`File picker for ${what} opens next session.`)
}

// ── Edit custom domain modal ──────────────────────────────────
const editDomainOpen = ref(false)
const domainForm = reactive({ custom: '' })
function openEditDomain() {
  domainForm.custom = domain.value.custom
  editDomainOpen.value = true
}
function saveDomain() {
  domain.value.custom = domainForm.custom.trim() || domain.value.custom
  editDomainOpen.value = false
  toast.success('Domain updated — DNS check re-runs in the background.')
}

const statusTone = (s: string) => (s === 'ok' || s === 'live' || s === 'issued' ? 'ok' : s === 'unset' || s === 'missing' ? 'warn' : s === 'error' || s === 'wrong' ? 'danger' : 'info')
</script>

<template>
  <div class="ws-panel">
    <!-- Domain -->
    <template v-if="props.section === 'domain'">
      <div class="ws-card">
        <div class="ws-card__head">
          <div>
            <div class="ws-card__eyebrow">Custom domain</div>
            <h2 class="ws-card__title">{{ domain.custom }}</h2>
            <div class="ws-meta">
              <span class="ws-badge" :class="`ws-badge--${statusTone(domain.status)}`">{{ domain.status }}</span>
              <span class="ws-badge" :class="`ws-badge--${statusTone(domain.ssl)}`">SSL {{ domain.ssl }}</span>
            </div>
          </div>
          <button class="ws-btn ws-btn--outline" @click="openEditDomain">Edit</button>
        </div>

        <div class="ws-row-switch">
          <div>
            <h3>Redirect www → apex</h3>
            <p>Send www visitors to the bare domain.</p>
          </div>
          <button class="ws-switch" :class="{ 'is-on': domain.redirectWww }" @click="domain.redirectWww = !domain.redirectWww">
            <span class="ws-switch__knob" />
          </button>
        </div>
      </div>

      <div class="ws-card">
        <div class="ws-card__eyebrow">Fallback</div>
        <p class="ws-card__body">Every club also gets a Torny-hosted address that always works while DNS is settling.</p>
        <div class="ws-mono-row">
          <span class="ws-mono">{{ domain.fallback }}</span>
          <button class="ws-link" @click="copyToClipboard(domain.fallback)">Copy</button>
        </div>
      </div>

      <div class="ws-card">
        <div class="ws-card__eyebrow">DNS records</div>
        <ul class="ws-dns">
          <li v-for="r in domain.dnsRecords" :key="r.host + r.value" class="ws-dns__row">
            <span class="ws-dns__type">{{ r.type }}</span>
            <div class="ws-dns__body">
              <div class="ws-mono">{{ r.host }}</div>
              <div class="ws-mono ws-muted">{{ r.value }}</div>
            </div>
            <span class="ws-badge" :class="`ws-badge--${statusTone(r.status)}`">{{ r.status }}</span>
          </li>
        </ul>
      </div>
    </template>

    <!-- Brand -->
    <template v-else-if="props.section === 'brand'">
      <div class="ws-card">
        <div class="ws-card__eyebrow">Logo &amp; favicon</div>
        <div class="ws-brand-assets">
          <div class="ws-brand-asset">
            <ImagePicker
              v-model="brandLogoUrl"
              content-type="avatar"
              aspect="1 / 1"
              label="Logo"
              hint="Square, PNG or SVG. Shows in the header, footer, and open-graph share card."
            />
          </div>
          <div class="ws-brand-asset">
            <ImagePicker
              v-model="brandFaviconUrl"
              content-type="avatar"
              aspect="1 / 1"
              label="Favicon"
              hint="32×32 PNG. Shows in the browser tab."
              :max-size-mb="1"
            />
          </div>
        </div>
      </div>
      <!-- Header display + custom header name — brief 80. Lives next to the
           logo/favicon because it's a brand-identity choice. -->
      <div class="ws-card">
        <div class="ws-card__eyebrow">Header display</div>
        <p class="ws-image-style__lede">
          What shows in the public site header — just the logo, just the club name, or both side-by-side.
          Logo-only modes need a logo uploaded above.
        </p>
        <div class="ws-image-style__grid">
          <button
            v-for="option in headerDisplayOptions"
            :key="option.value"
            type="button"
            class="ws-image-style__card ws-header-display__card"
            :class="{ 'is-active': headerDisplay === option.value }"
            :disabled="headerDisplaySaving || (option.value !== 'name' && !brandLogoUrl)"
            :title="option.value !== 'name' && !brandLogoUrl ? 'Upload a logo above to use this' : undefined"
            @click="onHeaderDisplay(option.value)"
          >
            <div class="ws-header-display__preview" :data-display="option.value">
              <div v-if="option.value !== 'name'" class="ws-header-display__logo">
                <img v-if="brandLogoUrl" :src="brandLogoUrl" :alt="`${clubStore.current?.name ?? 'Club'} logo`" />
                <span v-else>●</span>
              </div>
              <div v-if="option.value !== 'logo'" class="ws-header-display__name">
                {{ headerName.trim() || clubStore.current?.name || 'Club name' }}
              </div>
            </div>
            <div class="ws-image-style__meta">
              <div class="ws-image-style__name">
                {{ option.label }}
                <span v-if="headerDisplay === option.value" class="ws-image-style__pill">Selected</span>
              </div>
              <div class="ws-image-style__sub">{{ option.sub }}</div>
            </div>
          </button>
        </div>
        <!-- Custom name override. Hidden in logo-only mode since the text wouldn't render anyway. -->
        <div v-if="headerDisplay !== 'logo'" class="ws-header-name">
          <label class="ws-header-name__label" for="ws-header-name">Display name</label>
          <div class="ws-header-name__row">
            <input
              id="ws-header-name"
              v-model="headerName"
              type="text"
              maxlength="80"
              :placeholder="clubStore.current?.name ?? 'Club name'"
              @keyup.enter="saveHeaderName"
            />
            <button
              type="button"
              class="ws-header-name__save"
              :disabled="!headerNameDirty || headerNameSaving"
              @click="saveHeaderName"
            >
              <CrmSpinner v-if="headerNameSaving" size="sm" label="Saving" />
              <span>{{ headerNameSaving ? 'Saving…' : 'Save' }}</span>
            </button>
          </div>
          <div class="ws-header-name__hint">
            Leave blank to use the official club name ({{ clubStore.current?.name ?? '—' }}). Max 80 characters.
          </div>
        </div>
      </div>
      <div class="ws-card">
        <div class="ws-card__eyebrow">Colours</div>
        <p class="ws-image-style__lede">
          Override the colour-scheme preset below with the exact hex values from your club's branding.
          Reset to use whatever the chosen palette provides.
        </p>
        <div class="ws-colours">
          <div class="ws-colour">
            <input
              type="color"
              :value="brandPrimary"
              :disabled="brandSaving === 'primary'"
              @change="onBrandColourChange('brand_primary', ($event.target as HTMLInputElement).value)"
            />
            <div class="ws-colour__body">
              <div class="ws-colour__row">
                <span>Primary</span>
                <button
                  v-if="brandPrimaryOverridden"
                  type="button"
                  class="ws-colour__reset"
                  :disabled="brandSaving === 'primary'"
                  @click="resetBrandColour('brand_primary')"
                >Reset</button>
                <span v-else class="ws-colour__badge">palette default</span>
              </div>
              <span class="ws-mono">{{ brandPrimary }}</span>
            </div>
          </div>
          <div class="ws-colour">
            <input
              type="color"
              :value="brandAccent"
              :disabled="brandSaving === 'accent'"
              @change="onBrandColourChange('brand_accent', ($event.target as HTMLInputElement).value)"
            />
            <div class="ws-colour__body">
              <div class="ws-colour__row">
                <span>Accent</span>
                <button
                  v-if="brandAccentOverridden"
                  type="button"
                  class="ws-colour__reset"
                  :disabled="brandSaving === 'accent'"
                  @click="resetBrandColour('brand_accent')"
                >Reset</button>
                <span v-else class="ws-colour__badge">palette default</span>
              </div>
              <span class="ws-mono">{{ brandAccent }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="ws-card">
        <div class="ws-card__eyebrow">Typography</div>
        <FontPicker
          :club-id="clubStore.current?.id ?? null"
          :club-name="clubStore.current?.name"
          :current-slug="fontSlug"
          @update:slug="onFontSlugChange"
        />
      </div>
      <div class="ws-card">
        <div class="ws-card__eyebrow">Site style</div>
        <StylePicker
          :club-id="clubStore.current?.id ?? null"
          :current-slug="styleSlug"
          @update:slug="onStyleSlugChange"
        />
      </div>
      <div class="ws-card">
        <div class="ws-card__eyebrow">Colour palette</div>
        <ColorSchemePicker
          :club-id="clubStore.current?.id ?? null"
          :current-slug="colorSchemeSlug"
          @update:slug="onColorSchemeSlugChange"
        />
      </div>
      <!-- Image style — applies one treatment to every image on the public
           site (heroes, event covers, member avatars, etc). Brief 79. -->
      <div class="ws-card">
        <div class="ws-card__eyebrow">Image style</div>
        <p class="ws-image-style__lede">
          How photos look across your public site — tone, saturation, and overlay treatment for every image at once. Corner radius comes from Site Style above.
        </p>
        <div class="ws-image-style__grid">
          <button
            v-for="option in imageStyleOptions"
            :key="option.value"
            type="button"
            class="ws-image-style__card"
            :class="{ 'is-active': imageStyle === option.value }"
            :disabled="imageStyleSaving"
            @click="onImageStyle(option.value)"
          >
            <div class="ws-image-style__preview" :data-style="option.value">
              <div class="ws-image-style__preview-photo" />
            </div>
            <div class="ws-image-style__meta">
              <div class="ws-image-style__name">
                {{ option.label }}
                <span v-if="imageStyle === option.value" class="ws-image-style__pill">Selected</span>
              </div>
              <div class="ws-image-style__sub">{{ option.sub }}</div>
            </div>
          </button>
        </div>
      </div>
    </template>

    <!-- SEO -->
    <template v-else-if="props.section === 'seo'">
      <div class="ws-card">
        <div class="ws-card__eyebrow">Site metadata</div>
        <div class="ws-field">
          <label>Meta title</label>
          <input v-model="seo.metaTitle" />
        </div>
        <div class="ws-field">
          <label>Meta description</label>
          <textarea rows="3" v-model="seo.metaDescription" />
        </div>
      </div>
      <div class="ws-card">
        <div class="ws-card__eyebrow">Share card (OG image)</div>
        <div class="ws-upload__chip">
          <span class="ws-mono">{{ seo.ogImage }}</span>
          <button class="ws-link" @click="replaceUpload('OG image')">Replace</button>
        </div>
      </div>
      <div class="ws-card">
        <div class="ws-card__eyebrow">Search visibility</div>
        <div class="ws-row-switch">
          <div>
            <h3>Allow search engines to index</h3>
            <p>Disable while the site is under construction.</p>
          </div>
          <button class="ws-switch" :class="{ 'is-on': seo.robotsAllowed }" @click="seo.robotsAllowed = !seo.robotsAllowed">
            <span class="ws-switch__knob" />
          </button>
        </div>
      </div>
    </template>

    <!-- Navigation -->
    <template v-else-if="props.section === 'navigation'">
      <div class="ws-nav-toolbar">
        <div class="ws-nav-toolbar__hint">
          Header links show in the top nav on every page. Give a parent link one or more sub-links to turn it into a dropdown. Footer links show at the bottom of every page.
        </div>
        <div class="ws-nav-toolbar__actions">
          <button
            type="button"
            class="ws-btn ws-btn--outline"
            :disabled="!navDirty || navSaving"
            @click="resetNavigation"
          >Discard</button>
          <button
            type="button"
            class="ws-btn"
            :disabled="!navDirty || navSaving"
            @click="saveNavigation"
          >
            <CrmSpinner v-if="navSaving" size="sm" label="Saving" />
            <span>{{ navSaving ? 'Saving…' : 'Save navigation' }}</span>
          </button>
        </div>
      </div>

      <div class="ws-card">
        <div class="ws-card__eyebrow">Header navigation</div>

        <div class="ws-row-switch ws-row-switch--inline">
          <div>
            <h3>Sticky header</h3>
            <p>Keep the header pinned to the top of the viewport as visitors scroll.</p>
          </div>
          <button class="ws-switch" :class="{ 'is-on': headerSticky }" @click="toggleHeaderSticky">
            <span class="ws-switch__knob" />
          </button>
        </div>

        <ul class="ws-nav-list">
          <li v-for="(item, i) in navHeader" :key="i" class="ws-nav-item">
            <div class="ws-nav-row">
              <div class="ws-nav-order">
                <button type="button" class="ws-nav-arrow" :disabled="i === 0" @click="moveItem(navHeader, i, -1)" aria-label="Move up">▲</button>
                <button type="button" class="ws-nav-arrow" :disabled="i === navHeader.length - 1" @click="moveItem(navHeader, i, 1)" aria-label="Move down">▼</button>
              </div>
              <div class="ws-nav-fields">
                <input v-model="item.label" placeholder="Label" class="ws-nav-input" @input="markDirty" />
                <input v-model="item.href" placeholder="/path or https://…" class="ws-nav-input ws-mono" @input="markDirty" />
              </div>
              <button type="button" class="ws-nav-remove" @click="removeItem(navHeader, i)" aria-label="Remove">×</button>
            </div>

            <div v-if="item.children && item.children.length" class="ws-nav-children">
              <div
                v-for="(child, ci) in item.children"
                :key="ci"
                class="ws-nav-row ws-nav-row--child"
              >
                <div class="ws-nav-order">
                  <button type="button" class="ws-nav-arrow" :disabled="ci === 0" @click="moveChild(item, ci, -1)" aria-label="Move up">▲</button>
                  <button type="button" class="ws-nav-arrow" :disabled="ci === item.children.length - 1" @click="moveChild(item, ci, 1)" aria-label="Move down">▼</button>
                </div>
                <div class="ws-nav-fields">
                  <input v-model="child.label" placeholder="Label" class="ws-nav-input" @input="markDirty" />
                  <input v-model="child.href" placeholder="/path or https://…" class="ws-nav-input ws-mono" @input="markDirty" />
                </div>
                <button type="button" class="ws-nav-remove" @click="removeChild(item, ci)" aria-label="Remove">×</button>
              </div>
            </div>

            <button type="button" class="ws-nav-add-child" @click="addChild(item)">+ Add sub-link</button>
          </li>
        </ul>
        <button type="button" class="ws-btn ws-btn--ghost" @click="addTopLevel(navHeader)">+ Add link</button>
      </div>

      <div class="ws-card">
        <div class="ws-card__eyebrow">Footer navigation</div>
        <ul class="ws-nav-list">
          <li v-for="(item, i) in navFooter" :key="i" class="ws-nav-item">
            <div class="ws-nav-row">
              <div class="ws-nav-order">
                <button type="button" class="ws-nav-arrow" :disabled="i === 0" @click="moveItem(navFooter, i, -1)" aria-label="Move up">▲</button>
                <button type="button" class="ws-nav-arrow" :disabled="i === navFooter.length - 1" @click="moveItem(navFooter, i, 1)" aria-label="Move down">▼</button>
              </div>
              <div class="ws-nav-fields">
                <input v-model="item.label" placeholder="Label" class="ws-nav-input" @input="markDirty" />
                <input v-model="item.href" placeholder="/path or https://…" class="ws-nav-input ws-mono" @input="markDirty" />
              </div>
              <button type="button" class="ws-nav-remove" @click="removeItem(navFooter, i)" aria-label="Remove">×</button>
            </div>
          </li>
        </ul>
        <button type="button" class="ws-btn ws-btn--ghost" @click="addTopLevel(navFooter)">+ Add link</button>
      </div>
    </template>

    <!-- Forms -->
    <template v-else-if="props.section === 'forms'">
      <div v-for="f in forms" :key="f.id" class="ws-card">
        <div class="ws-card__head">
          <div>
            <div class="ws-card__eyebrow">Form</div>
            <h2 class="ws-card__title">{{ f.label }}</h2>
          </div>
          <span class="ws-mono">{{ f.id }}</span>
        </div>
        <div class="ws-field">
          <label>Recipients</label>
          <input v-model="f.recipients" />
        </div>
        <div class="ws-row-switch">
          <div>
            <h3>Auto-reply</h3>
            <p>Confirm receipt with a thank-you message to the sender.</p>
          </div>
          <button class="ws-switch" :class="{ 'is-on': f.autoReply }" @click="f.autoReply = !f.autoReply">
            <span class="ws-switch__knob" />
          </button>
        </div>
        <div class="ws-field">
          <label>Spam filter</label>
          <select v-model="f.spamFilter">
            <option value="off">Off</option>
            <option value="moderate">Moderate</option>
            <option value="strict">Strict</option>
          </select>
        </div>
      </div>
    </template>

    <!-- Analytics -->
    <template v-else-if="props.section === 'analytics'">
      <div class="ws-card">
        <div class="ws-card__eyebrow">Analytics provider</div>
        <div class="ws-provider-grid">
          <button class="ws-provider" :class="{ 'is-active': analytics.provider === 'none' }" @click="analytics.provider = 'none'">
            <div class="ws-provider__label">None</div>
            <div class="ws-provider__hint">Skip analytics.</div>
          </button>
          <button class="ws-provider" :class="{ 'is-active': analytics.provider === 'plausible' }" @click="analytics.provider = 'plausible'">
            <div class="ws-provider__label">Plausible</div>
            <div class="ws-provider__hint">Cookie-free, GDPR-safe by default.</div>
          </button>
          <button class="ws-provider" :class="{ 'is-active': analytics.provider === 'ga4' }" @click="analytics.provider = 'ga4'">
            <div class="ws-provider__label">Google Analytics 4</div>
            <div class="ws-provider__hint">More power, requires cookie banner.</div>
          </button>
        </div>
        <div v-if="analytics.provider === 'plausible'" class="ws-field">
          <label>Plausible domain</label>
          <input v-model="analytics.plausibleDomain" />
        </div>
        <div v-if="analytics.provider === 'ga4'" class="ws-field">
          <label>GA4 Measurement ID</label>
          <input v-model="analytics.gaId" placeholder="G-XXXXXXXXXX" />
        </div>
        <div v-if="analytics.provider === 'ga4'" class="ws-row-switch">
          <div>
            <h3>Show cookie banner</h3>
            <p>Torny will inject a compliant consent banner before GA4 fires.</p>
          </div>
          <button class="ws-switch" :class="{ 'is-on': analytics.cookieBanner }" @click="analytics.cookieBanner = !analytics.cookieBanner">
            <span class="ws-switch__knob" />
          </button>
        </div>
      </div>
    </template>

    <CrmModal
      :open="editDomainOpen"
      eyebrow="Custom domain"
      title="Edit custom domain"
      width="sm"
      @close="editDomainOpen = false"
    >
      <p class="ws-hint">Enter the domain you want visitors to see. DNS check runs automatically after saving.</p>
      <label class="ws-form-field">
        <span class="ws-form-field__label">Domain</span>
        <input v-model="domainForm.custom" type="text" placeholder="mybowlsclub.co.nz" autofocus />
      </label>
      <template #footer>
        <button type="button" class="ws-modal-btn ws-modal-btn--outline" @click="editDomainOpen = false">Cancel</button>
        <button type="button" class="ws-modal-btn ws-modal-btn--primary" @click="saveDomain">Save</button>
      </template>
    </CrmModal>

  </div>
</template>

<style scoped>
.ws-panel { display: flex; flex-direction: column; gap: 12px; max-width: 780px; }

.ws-card { padding: 24px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; }
.ws-card__head { display: flex; justify-content: space-between; align-items: end; gap: 16px; margin-bottom: 16px; }
.ws-card__eyebrow { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.ws-card__title { font-family: var(--font-display); font-size: 22px; font-weight: 700; letter-spacing: -0.01em; margin: 4px 0 6px; color: var(--color-ink); }
.ws-card__body { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); margin: 0 0 12px; }

.ws-meta { display: flex; gap: 6px; margin-top: 8px; }

.ws-mono { font-family: var(--font-mono); font-size: 12px; }
.ws-mono-row { display: flex; gap: 12px; align-items: center; padding: 10px 12px; background: var(--color-surface); border-radius: 8px; }
.ws-muted { color: var(--color-mute); }

.ws-badge { display: inline-flex; padding: 3px 10px; border-radius: 999px; font-family: var(--font-body); font-size: 11px; font-weight: 600; text-transform: capitalize; }
.ws-badge--ok { background: #DCFCE7; color: #166534; }
.ws-badge--warn { background: #FEF3C7; color: #92400E; }
.ws-badge--danger { background: #FEE2E2; color: #991B1B; }
.ws-badge--info { background: var(--color-accent-soft); color: var(--color-accent-strong); }

.ws-btn { padding: 9px 14px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: none; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; background: var(--color-ink); color: #fff; }
.ws-btn:hover:not(:disabled) { background: var(--color-graphite); }
.ws-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.ws-btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.ws-btn--outline:hover:not(:disabled) { background: var(--color-surface); border-color: var(--color-ink); }
.ws-btn--ghost { background: transparent; color: var(--color-accent); border: 1px dashed var(--color-accent-soft); margin-top: 12px; }
.ws-btn--ghost:hover:not(:disabled) { background: var(--color-accent-soft); }
.ws-link { background: transparent; border: 0; color: var(--color-accent); font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; }
.ws-link:hover { text-decoration: underline; }

.ws-row-switch { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 0; }
.ws-row-switch--inline { padding: 0 0 16px; margin-bottom: 12px; border-bottom: 1px solid var(--color-hairline); }
.ws-row-switch h3 { font-family: var(--font-body); font-size: 14px; font-weight: 600; margin: 0 0 2px; color: var(--color-ink); }
.ws-row-switch p { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin: 0; }
.ws-switch { width: 40px; height: 24px; padding: 3px; border-radius: 999px; background: var(--color-hairline); border: 0; display: flex; cursor: pointer; flex-shrink: 0; }
.ws-switch.is-on { background: var(--color-ink); }
.ws-switch--sm { width: 34px; height: 20px; padding: 2px; }
.ws-switch__knob { width: 18px; height: 18px; border-radius: 999px; background: #fff; transition: transform 0.15s ease; }
.ws-switch--sm .ws-switch__knob { width: 16px; height: 16px; }
.ws-switch.is-on .ws-switch__knob { transform: translateX(16px); }
.ws-switch--sm.is-on .ws-switch__knob { transform: translateX(14px); }

.ws-dns { list-style: none; padding: 0; margin: 0; }
.ws-dns__row { display: grid; grid-template-columns: 60px 1fr auto; gap: 12px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--color-hairline); }
.ws-dns__row:last-child { border-bottom: 0; }
.ws-dns__type { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); }

.ws-colours { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ws-colour { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid var(--color-hairline); border-radius: 10px; }
.ws-colour input[type="color"] { width: 40px; height: 40px; border: 0; padding: 0; border-radius: 8px; cursor: pointer; }
.ws-colour input[type="color"]:disabled { cursor: progress; opacity: 0.6; }
.ws-colour__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.ws-colour__body div { font-family: var(--font-body); font-size: 12px; color: var(--color-ink); font-weight: 600; }
.ws-colour__row { display: flex; align-items: center; gap: 8px; }
.ws-colour__reset { padding: 2px 10px; background: transparent; border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; color: var(--color-fog); cursor: pointer; }
.ws-colour__reset:hover:not(:disabled) { border-color: var(--color-ink); color: var(--color-ink); }
.ws-colour__reset:disabled { opacity: 0.5; cursor: not-allowed; }
.ws-colour__badge { padding: 2px 8px; background: var(--color-surface); border-radius: 999px; font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }

.ws-upload-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ws-upload__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); margin-bottom: 8px; }
.ws-upload__chip { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: var(--color-surface); border-radius: 8px; }

.ws-brand-assets { display: grid; grid-template-columns: 140px 96px; gap: 20px; align-items: start; }
.ws-brand-asset { display: flex; flex-direction: column; }
@media (max-width: 767px) { .ws-brand-assets { grid-template-columns: 140px 96px; } }

.ws-brand-nav-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--color-hairline);
}
.ws-brand-nav-toggle__copy { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ws-brand-nav-toggle__title { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.ws-brand-nav-toggle__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); line-height: 1.4; }

/* Header display picker — three option cards with a live preview of what
   the public header will look like. Shares the ws-image-style__card shell
   so both pickers feel consistent on the Brand tab. Brief 80. */
.ws-header-display__preview {
  aspect-ratio: auto;
  height: 72px;
  display: flex; align-items: center; gap: 10px;
  padding: 0 16px;
  background: #fff;
  border-radius: 10px;
  margin: 10px 10px 0;
  box-shadow: inset 0 0 0 1px var(--color-hairline);
}
.ws-header-display__preview[data-display="logo"] { justify-content: center; }
.ws-header-display__logo {
  width: 32px; height: 32px; border-radius: 8px; overflow: hidden;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--color-surface);
  color: var(--color-mute);
  flex-shrink: 0;
}
.ws-header-display__logo img { width: 100%; height: 100%; object-fit: cover; }
.ws-header-display__name {
  font-family: var(--font-display, var(--font-body));
  font-size: 15px; font-weight: 700; color: var(--color-ink); letter-spacing: -0.01em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* Custom display-name input. */
.ws-header-name { margin-top: 18px; display: flex; flex-direction: column; gap: 8px; }
.ws-header-name__label {
  font-family: var(--font-body); font-size: 11px; font-weight: 700;
  letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog);
}
.ws-header-name__row { display: flex; gap: 8px; align-items: stretch; }
.ws-header-name__row input {
  flex: 1; min-width: 0;
  padding: 10px 14px; border: 1px solid var(--color-hairline); border-radius: 10px;
  font-family: var(--font-body); font-size: 14px; color: var(--color-ink); background: #fff; outline: none;
}
.ws-header-name__row input:focus { border-color: var(--color-ink); }
.ws-header-name__save {
  padding: 10px 16px; background: var(--color-ink); color: #fff;
  border: 0; border-radius: 999px; font-family: var(--font-body);
  font-size: 13px; font-weight: 600; cursor: pointer;
}
.ws-header-name__save:disabled { opacity: 0.4; cursor: not-allowed; }
.ws-header-name__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); line-height: 1.5; }

/* Image-style picker — three option cards with a visual preview on top. */
.ws-image-style__lede { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); line-height: 1.5; margin: 0 0 14px; }
.ws-image-style__grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.ws-image-style__card {
  display: flex; flex-direction: column; gap: 0;
  padding: 0; background: #fff;
  border: 1px solid var(--color-hairline); border-radius: 14px;
  cursor: pointer; text-align: left; overflow: hidden;
  transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
}
.ws-image-style__card:hover:not(:disabled) { border-color: color-mix(in oklab, var(--color-ink) 40%, var(--color-hairline)); }
.ws-image-style__card:disabled { cursor: progress; opacity: 0.7; }
.ws-image-style__card.is-active {
  border-color: var(--color-ink);
  box-shadow: 0 0 0 1px var(--color-ink), 0 10px 24px -14px rgba(15, 23, 42, 0.3);
}
.ws-image-style__preview {
  position: relative; aspect-ratio: 4 / 3;
  background: linear-gradient(135deg, #CED8E6 0%, #B4C5DC 100%);
  overflow: hidden;
}
.ws-image-style__preview-photo {
  position: absolute; inset: 0;
  background:
    radial-gradient(circle at 30% 70%, rgba(22,163,74,0.45) 0%, transparent 42%),
    radial-gradient(circle at 70% 30%, rgba(234,88,12,0.35) 0%, transparent 38%),
    linear-gradient(140deg, #4F6B8A 0%, #2F3F55 55%, #1C2635 100%);
  background-blend-mode: screen, screen, normal;
}
.ws-image-style__preview[data-style="soft"] { border-radius: 16px; margin: 10px; aspect-ratio: auto; height: calc(100% - 20px); box-shadow: inset 0 0 0 1px rgba(0,0,0,0.04); }
.ws-image-style__preview[data-style="soft"] .ws-image-style__preview-photo { filter: saturate(0.98) contrast(1.02) brightness(1.01); border-radius: 15px; }
.ws-image-style__preview[data-style="studio"] { border-radius: 4px; margin: 10px; aspect-ratio: auto; height: calc(100% - 20px); }
.ws-image-style__preview[data-style="studio"] .ws-image-style__preview-photo { filter: saturate(1.06) contrast(1.06) brightness(1.02); border-radius: 3px; }
.ws-image-style__preview[data-style="archive"] { border-radius: 12px; margin: 10px; aspect-ratio: auto; height: calc(100% - 20px); box-shadow: inset 0 0 0 1px rgba(0,0,0,0.08); }
.ws-image-style__preview[data-style="archive"] .ws-image-style__preview-photo { filter: grayscale(0.88) contrast(1.08); border-radius: 11px; }
.ws-image-style__preview[data-style="archive"]::after {
  content: ''; position: absolute; inset: 10px;
  background: var(--color-ink);
  mix-blend-mode: color; opacity: 0.35; pointer-events: none; border-radius: 11px;
}
.ws-image-style__meta { padding: 10px 14px 14px; display: flex; flex-direction: column; gap: 4px; }
.ws-image-style__name { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); display: inline-flex; align-items: center; gap: 8px; }
.ws-image-style__pill { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: #16A34A; background: rgba(22,163,74,0.14); padding: 2px 8px; border-radius: 999px; font-weight: 700; }
.ws-image-style__sub { font-family: var(--font-body); font-size: 11.5px; color: var(--color-fog); line-height: 1.5; }
@media (max-width: 720px) {
  .ws-image-style__grid { grid-template-columns: 1fr; }
}

.ws-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.ws-field label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.ws-field input, .ws-field select, .ws-field textarea { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; resize: vertical; }
.ws-field input:focus, .ws-field select:focus, .ws-field textarea:focus { outline: none; border-color: var(--color-ink); }

/* Navigation editor */
.ws-nav-toolbar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  box-shadow: 0 4px 12px -6px rgba(15, 23, 42, 0.08);
}
.ws-nav-toolbar__hint {
  font-family: var(--font-body);
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-graphite);
  max-width: 520px;
}
.ws-nav-toolbar__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.ws-nav-list { list-style: none; padding: 0; margin: 0 0 12px; display: flex; flex-direction: column; gap: 10px; }
.ws-nav-item { display: flex; flex-direction: column; gap: 6px; }
.ws-nav-row {
  display: grid;
  grid-template-columns: 28px 1fr 28px;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 10px;
}
.ws-nav-row--child {
  background: var(--color-surface);
  margin-left: 24px;
}
.ws-nav-order { display: flex; flex-direction: column; gap: 2px; }
.ws-nav-arrow {
  height: 14px;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--color-mute);
  font-size: 9px;
  line-height: 1;
  cursor: pointer;
}
.ws-nav-arrow:hover:not(:disabled) { background: var(--color-hairline); color: var(--color-ink); }
.ws-nav-arrow:disabled { opacity: 0.3; cursor: not-allowed; }

.ws-nav-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
  gap: 8px;
  min-width: 0;
}
.ws-nav-input {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--color-hairline);
  border-radius: 8px;
  font-family: var(--font-body);
  font-size: 13px;
  background: transparent;
  color: var(--color-ink);
}
.ws-nav-input:focus { outline: none; border-color: var(--color-ink); background: #fff; }

.ws-nav-remove {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: var(--color-mute);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
.ws-nav-remove:hover { background: var(--color-hairline); color: var(--color-danger); }

.ws-nav-children { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }
.ws-nav-add-child {
  align-self: flex-start;
  margin-left: 28px;
  padding: 4px 10px;
  border: 1px dashed var(--color-hairline);
  border-radius: 8px;
  background: transparent;
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--color-fog);
  cursor: pointer;
}
.ws-nav-add-child:hover { color: var(--color-ink); border-color: var(--color-ink); background: var(--color-surface); }

.ws-provider-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; margin-bottom: 16px; }
.ws-provider { padding: 14px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; cursor: pointer; text-align: left; }
.ws-provider.is-active { border-color: var(--color-ink); background: var(--color-accent-soft); }
.ws-provider__label { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.ws-provider__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 2px; }

.ws-hint { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); line-height: 1.5; margin: 0 0 14px; }
.ws-form { display: flex; flex-direction: column; gap: 14px; }
.ws-form-field { display: flex; flex-direction: column; gap: 6px; }
.ws-form-field__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.ws-form-field input { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; }
.ws-form-field input:focus { outline: none; border-color: var(--color-ink); }
.ws-check { display: flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); }
.ws-modal-btn { padding: 9px 16px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: 0; }
.ws-modal-btn--primary { background: var(--color-ink); color: #fff; }
.ws-modal-btn--primary:hover:not(:disabled) { background: var(--color-graphite); }
.ws-modal-btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
.ws-modal-btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }

@media (max-width: 900px) {
  .ws-colours, .ws-upload-grid { grid-template-columns: 1fr; }
}
</style>
