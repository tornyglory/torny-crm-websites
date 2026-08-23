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
import { computed, reactive, ref } from 'vue'
import CrmModal from '@/components/modals/CrmModal.vue'
import FontPicker from '@/components/FontPicker.vue'
import StylePicker from '@/components/StylePicker.vue'
import ImagePicker from '@/components/ImagePicker.vue'
import { ApiError, clubs } from '@torny/api-client'
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

function onFontSlugChange(_slug: string | null) {
  void clubStore.hydrateFull()
}
function onStyleSlugChange(_slug: string | null) {
  void clubStore.hydrateFull()
}

const domain = ref({
  custom: 'kelburnbowls.co.nz',
  status: 'live' as 'live' | 'pending' | 'unset',
  ssl: 'issued' as 'issued' | 'issuing' | 'error',
  fallback: 'kelburn.sites.torny.club',
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

const brand = ref({
  primary: clubStore.current?.brandPrimary ?? '#2563EB',
  accent: '#16A34A',
  font: 'Inter',
})

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
    })
    toast.success(value ? `${field === 'logo_url' ? 'Logo' : 'Favicon'} saved.` : `${field === 'logo_url' ? 'Logo' : 'Favicon'} removed.`)
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : `Could not save ${field.replace('_', ' ')}`
    toast.error(msg || 'Could not save')
  }
}

const seo = ref({
  metaTitle: 'Kelburn Bowling Club — Wellington',
  metaDescription: 'A friendly lawn bowls club in the heart of Wellington. Est. 1908. Join us for roll-ups, pennant, and socials.',
  ogImage: 'og-hero.jpg',
  robotsAllowed: true,
})

const navHeader = ref([
  { id: 'n1', label: 'Home', target: '/', external: false, enabled: true },
  { id: 'n2', label: 'About', target: '/about', external: false, enabled: true },
  { id: 'n3', label: 'Events', target: '/events', external: false, enabled: true },
  { id: 'n4', label: 'Honour board', target: '/honour-board', external: false, enabled: true },
  { id: 'n5', label: 'Membership', target: '/membership', external: false, enabled: true },
  { id: 'n6', label: 'Contact', target: '/contact', external: false, enabled: true },
])

const navFooter = ref([
  { id: 'f1', label: 'Bowls NZ', target: 'https://bowlsnewzealand.co.nz', external: true, enabled: true },
  { id: 'f2', label: 'Privacy', target: '/privacy', external: false, enabled: true },
])

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

// ── Add nav link modal (reused for header + footer) ────────────
const addLinkOpen = ref(false)
const addLinkTarget = ref<'header' | 'footer'>('header')
const linkForm = reactive({ label: '', target: '', external: false })
function openAddLink(target: 'header' | 'footer') {
  linkForm.label = ''
  linkForm.target = ''
  linkForm.external = false
  addLinkTarget.value = target
  addLinkOpen.value = true
}
const canAddLink = computed(() => linkForm.label.trim().length > 0 && linkForm.target.trim().length > 0)
function saveLink() {
  if (!canAddLink.value) return
  const row = {
    id: `link-${Date.now()}`,
    label: linkForm.label.trim(),
    target: linkForm.target.trim(),
    external: linkForm.external,
    enabled: true,
  }
  if (addLinkTarget.value === 'header') navHeader.value.push(row)
  else navFooter.value.push(row)
  addLinkOpen.value = false
  toast.success(`Added "${row.label}" to the ${addLinkTarget.value}.`)
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
      <div class="ws-card">
        <div class="ws-card__eyebrow">Colours</div>
        <div class="ws-colours">
          <div class="ws-colour">
            <input type="color" v-model="brand.primary" />
            <div class="ws-colour__body">
              <div>Primary</div>
              <span class="ws-mono">{{ brand.primary }}</span>
            </div>
          </div>
          <div class="ws-colour">
            <input type="color" v-model="brand.accent" />
            <div class="ws-colour__body">
              <div>Accent</div>
              <span class="ws-mono">{{ brand.accent }}</span>
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
      <div class="ws-card">
        <div class="ws-card__eyebrow">Header navigation</div>
        <p class="ws-card__body">These links appear in the top nav on every page and in the mobile drawer. Order matches the display order.</p>
        <ul class="ws-nav-list">
          <li v-for="n in navHeader" :key="n.id" class="ws-nav-row">
            <span class="ws-handle" aria-hidden="true">≡</span>
            <div>
              <div class="ws-nav-label">{{ n.label }}</div>
              <div class="ws-mono ws-muted">{{ n.target }}</div>
            </div>
            <button class="ws-switch ws-switch--sm" :class="{ 'is-on': n.enabled }" @click="n.enabled = !n.enabled">
              <span class="ws-switch__knob" />
            </button>
          </li>
        </ul>
        <button class="ws-btn ws-btn--ghost" @click="openAddLink('header')">+ Add link</button>
      </div>
      <div class="ws-card">
        <div class="ws-card__eyebrow">Footer navigation</div>
        <p class="ws-card__body">Extra links in the footer — usually external partners or legal pages.</p>
        <ul class="ws-nav-list">
          <li v-for="n in navFooter" :key="n.id" class="ws-nav-row">
            <span class="ws-handle" aria-hidden="true">≡</span>
            <div>
              <div class="ws-nav-label">
                {{ n.label }}
                <span v-if="n.external" class="ws-mono ws-muted">(external)</span>
              </div>
              <div class="ws-mono ws-muted">{{ n.target }}</div>
            </div>
            <button class="ws-switch ws-switch--sm" :class="{ 'is-on': n.enabled }" @click="n.enabled = !n.enabled">
              <span class="ws-switch__knob" />
            </button>
          </li>
        </ul>
        <button class="ws-btn ws-btn--ghost" @click="openAddLink('footer')">+ Add link</button>
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

    <CrmModal
      :open="addLinkOpen"
      eyebrow="Navigation"
      :title="`Add a ${addLinkTarget} link`"
      width="sm"
      @close="addLinkOpen = false"
    >
      <div class="ws-form">
        <label class="ws-form-field">
          <span class="ws-form-field__label">Label</span>
          <input v-model="linkForm.label" type="text" placeholder="Membership" autofocus />
        </label>
        <label class="ws-form-field">
          <span class="ws-form-field__label">Target (path or URL)</span>
          <input v-model="linkForm.target" type="text" placeholder="/membership" />
        </label>
        <label class="ws-check">
          <input v-model="linkForm.external" type="checkbox" />
          <span>Opens in a new tab (external link)</span>
        </label>
      </div>
      <template #footer>
        <button type="button" class="ws-modal-btn ws-modal-btn--outline" @click="addLinkOpen = false">Cancel</button>
        <button type="button" class="ws-modal-btn ws-modal-btn--primary" :disabled="!canAddLink" @click="saveLink">Add link</button>
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

.ws-btn { padding: 9px 14px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: none; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
.ws-btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.ws-btn--ghost { background: transparent; color: var(--color-accent); border: 1px dashed var(--color-accent-soft); margin-top: 12px; }
.ws-link { background: transparent; border: 0; color: var(--color-accent); font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; }
.ws-link:hover { text-decoration: underline; }

.ws-row-switch { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 0; }
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
.ws-colour input { width: 40px; height: 40px; border: 0; padding: 0; border-radius: 8px; cursor: pointer; }
.ws-colour__body div { font-family: var(--font-body); font-size: 12px; color: var(--color-ink); font-weight: 600; }

.ws-upload-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ws-upload__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); margin-bottom: 8px; }
.ws-upload__chip { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: var(--color-surface); border-radius: 8px; }

.ws-brand-assets { display: grid; grid-template-columns: 140px 96px; gap: 20px; align-items: start; }
.ws-brand-asset { display: flex; flex-direction: column; }
@media (max-width: 767px) { .ws-brand-assets { grid-template-columns: 140px 96px; } }

.ws-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.ws-field label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.ws-field input, .ws-field select, .ws-field textarea { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; resize: vertical; }
.ws-field input:focus, .ws-field select:focus, .ws-field textarea:focus { outline: none; border-color: var(--color-ink); }

.ws-nav-list { list-style: none; padding: 0; margin: 0; }
.ws-nav-row { display: grid; grid-template-columns: 20px 1fr auto; gap: 12px; align-items: center; padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 10px; margin-bottom: 6px; }
.ws-handle { color: var(--color-mute); cursor: grab; }
.ws-nav-label { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); display: flex; gap: 8px; align-items: baseline; }

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
