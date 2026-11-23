<script setup lang="ts">
/**
 * Footer config editor — brief 115.
 *
 * Renders inside Settings → Website → Navigation, directly below the
 * header nav editor. Drives the public SiteFooter chrome: description,
 * 0–4 columns of links, 0–6 socials (icon-picker whitelist), 0–5 legal
 * links, and an optional contact-block override.
 *
 * Admin endpoints live on VENUE_BASE (brief 115 ships off the CFN-capped
 * CRM stack); the editor calls through `footer.get/put/remove`.
 * `get()` returns null for clubs that have never configured — in that
 * case we seed the form with the FE hardcoded fallback so admins see a
 * reasonable starting point rather than a blank page.
 */
import { computed, onMounted, ref } from 'vue'
import {
  ApiError,
  footer as footerApi,
  type FooterColumn,
  type FooterConfig,
  type FooterLink,
  type FooterSocial,
  type FooterSocialIcon,
} from '@torny/api-client'
import CrmSpinner from '@/components/CrmSpinner.vue'
import { useClubStore } from '@/stores/club'
import { useToast } from '@/composables/useToast'

const clubStore = useClubStore()
const toast = useToast()

// ── Config caps (mirror the server for client-side nudges) ────────────
const MAX_DESCRIPTION = 300
const MAX_COLUMNS = 4
const MAX_LINKS_PER_COLUMN = 8
const MAX_LABEL = 40
const MAX_SOCIALS = 6
const MAX_LEGAL = 5
const MAX_CONTACT_EMAIL = 120
const MAX_CONTACT_ADDRESS_LINES = 4
const MAX_CONTACT_LINE = 80
const MAX_CONTACT_STATUS = 40

const SOCIAL_ICON_META: Record<FooterSocialIcon, { label: string }> = {
  instagram: { label: 'Instagram' },
  facebook: { label: 'Facebook' },
  twitter: { label: 'X / Twitter' },
  tiktok: { label: 'TikTok' },
  youtube: { label: 'YouTube' },
  linkedin: { label: 'LinkedIn' },
  email: { label: 'Email' },
}
const SOCIAL_ICON_ORDER: FooterSocialIcon[] = [
  'instagram', 'facebook', 'twitter', 'tiktok', 'youtube', 'linkedin', 'email',
]

/** Icon whitelist from the server. Backed by SOCIAL_ICON_ORDER as a
 *  fallback so the picker still works pre-API (and post-404). */
const availableIcons = ref<FooterSocialIcon[]>([...SOCIAL_ICON_ORDER])

// ── Form state ────────────────────────────────────────────────────────
type ContactOverrideForm = {
  email: string
  phone: string
  address_lines: string[]
  status: string
}

type FormState = {
  description: string
  columns: Array<{ heading: string; links: FooterLink[] }>
  socials: FooterSocial[]
  legal_links: FooterLink[]
  contactOverrideEnabled: boolean
  contact: ContactOverrideForm
}

/** Seed when the admin has never saved — matches the FE fallback so the
 *  editor opens on something recognisable rather than a blank form. */
function seedState(): FormState {
  return {
    description: "A community bowling club. Everyone welcome — bring a friend, we'll bring the bowls.",
    columns: [
      { heading: 'Explore', links: [
        { label: 'Home', href: '/' },
        { label: 'About the club', href: '/about' },
        { label: 'Events', href: '/events' },
        { label: 'Honour board', href: '/honour-board' },
        { label: 'Gallery', href: '/gallery' },
      ] },
      { heading: 'Play', links: [
        { label: 'Membership', href: '/membership' },
        { label: 'Coaching', href: '/coaching' },
        { label: 'Function hire', href: '/venue-hire' },
        { label: 'Sponsors', href: '/sponsors' },
      ] },
    ],
    socials: [],
    legal_links: [
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
      { label: 'Cookies', href: '/cookies' },
    ],
    contactOverrideEnabled: false,
    contact: { email: '', phone: '', address_lines: [], status: '' },
  }
}

function hydrateFromServer(cfg: FooterConfig): FormState {
  const override = cfg.contact_override
  return {
    description: cfg.description ?? '',
    columns: cfg.columns.map((c) => ({
      heading: c.heading,
      links: c.links.map((l) => ({ label: l.label, href: l.href })),
    })),
    socials: cfg.socials.map((s) => ({ ...s })),
    legal_links: cfg.legal_links.map((l) => ({ label: l.label, href: l.href })),
    contactOverrideEnabled: override !== null,
    contact: {
      email: override?.email ?? '',
      phone: override?.phone ?? '',
      address_lines: override?.address_lines ? [...override.address_lines] : [],
      status: override?.status ?? '',
    },
  }
}

function cloneState(s: FormState): FormState {
  return JSON.parse(JSON.stringify(s))
}

const form = ref<FormState>(seedState())
const baseline = ref<FormState>(seedState())
const loading = ref(true)
const saving = ref(false)
const resetting = ref(false)
/** True once the admin saves at least one config. Drives the Reset
 *  button's visibility (nothing to reset for a fresh club). */
const hasSavedConfig = ref(false)

const dirty = computed(() => JSON.stringify(form.value) !== JSON.stringify(baseline.value))

// ── Field-level validation ────────────────────────────────────────────
// Server-side errors from brief 115 §3. Each 400 code points at the
// field it targets so we can surface the right inline message.
type FieldKey =
  | 'description'
  | `column.${number}.heading`
  | `column.${number}.link.${number}.label`
  | `column.${number}.link.${number}.href`
  | `social.${number}.href`
  | `legal.${number}.label`
  | `legal.${number}.href`
  | 'contact.email'
  | 'contact.address'
  | 'form'

const fieldErrors = ref<Partial<Record<string, string>>>({})

function clearFieldErrors() { fieldErrors.value = {} }
function setFieldError(key: FieldKey, message: string) {
  fieldErrors.value = { ...fieldErrors.value, [key]: message }
}

/** Best-effort href rule — matches brief 115 §4. Just a UX nudge; the
 *  server is the source of truth and will 400 on anything we miss. */
function isHrefOk(href: string, strict: boolean): boolean {
  const v = href.trim()
  if (!v) return false
  if (v.startsWith('javascript:') || v.startsWith('data:')) return false
  if (!strict && v.startsWith('/')) return true
  if (v.startsWith('https://') || v.startsWith('mailto:') || v.startsWith('tel:')) return true
  return false
}

// ── Column / link / social / legal ops ────────────────────────────────
function addColumn() {
  if (form.value.columns.length >= MAX_COLUMNS) return
  form.value.columns.push({ heading: 'New column', links: [{ label: 'New link', href: '/' }] })
  clearFieldErrors()
}
function removeColumn(i: number) {
  form.value.columns.splice(i, 1)
  clearFieldErrors()
}
function addLink(column: FormState['columns'][number]) {
  if (column.links.length >= MAX_LINKS_PER_COLUMN) return
  column.links.push({ label: 'New link', href: '/' })
}
function removeLink(column: FormState['columns'][number], i: number) {
  column.links.splice(i, 1)
}

function addSocial() {
  if (form.value.socials.length >= MAX_SOCIALS) return
  const used = new Set(form.value.socials.map((s) => s.icon))
  const nextIcon = availableIcons.value.find((i) => !used.has(i)) ?? 'instagram'
  form.value.socials.push({
    icon: nextIcon,
    label: SOCIAL_ICON_META[nextIcon].label,
    href: '',
  })
}
function removeSocial(i: number) {
  form.value.socials.splice(i, 1)
}

function addLegal() {
  if (form.value.legal_links.length >= MAX_LEGAL) return
  form.value.legal_links.push({ label: 'New link', href: '/' })
}
function removeLegal(i: number) {
  form.value.legal_links.splice(i, 1)
}

function addAddressLine() {
  if (form.value.contact.address_lines.length >= MAX_CONTACT_ADDRESS_LINES) return
  form.value.contact.address_lines.push('')
}
function removeAddressLine(i: number) {
  form.value.contact.address_lines.splice(i, 1)
}

// ── Payload shaping ───────────────────────────────────────────────────
function buildPayload(): FooterConfig {
  const description = form.value.description.trim()
  const columns: FooterColumn[] = form.value.columns.map((c) => ({
    heading: c.heading.trim(),
    links: c.links.map((l) => ({ label: l.label.trim(), href: l.href.trim() })),
  }))
  const socials: FooterSocial[] = form.value.socials.map((s) => ({
    icon: s.icon,
    label: s.label.trim(),
    href: s.href.trim(),
  }))
  const legal_links: FooterLink[] = form.value.legal_links.map((l) => ({
    label: l.label.trim(),
    href: l.href.trim(),
  }))
  const contact = form.value.contact
  const trimmedLines = contact.address_lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const contact_override = form.value.contactOverrideEnabled
    ? {
        email: contact.email.trim() || null,
        phone: contact.phone.trim() || null,
        address_lines: trimmedLines.length > 0 ? trimmedLines : null,
        status: contact.status.trim() || null,
      }
    : null
  return {
    description: description || null,
    columns,
    socials,
    legal_links,
    contact_override,
  }
}

// ── Load / save / reset ───────────────────────────────────────────────
async function load() {
  const clubId = clubStore.current?.id
  if (typeof clubId !== 'number') return
  loading.value = true
  try {
    const cfg = await footerApi.get(clubId)
    if (cfg === null) {
      // Never saved — keep the seed on screen but leave hasSavedConfig
      // false so the Reset button stays hidden.
      hasSavedConfig.value = false
      // Pre-brief-115 servers may 404 without a social_icons payload;
      // in that case we keep the fallback whitelist already in place.
      const seed = seedState()
      form.value = seed
      baseline.value = cloneState(seed)
    } else {
      hasSavedConfig.value = true
      if (cfg.social_icons?.length) availableIcons.value = cfg.social_icons
      const hydrated = hydrateFromServer(cfg)
      form.value = hydrated
      baseline.value = cloneState(hydrated)
    }
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Could not load footer config'
    toast.error(msg)
  } finally {
    loading.value = false
  }
}

const SERVER_ERROR_MESSAGES: Record<string, string> = {
  footer_description_too_long: `Description is over ${MAX_DESCRIPTION} characters.`,
  footer_columns_too_many: `Pick at most ${MAX_COLUMNS} columns.`,
  footer_column_heading_too_long: `Column heading is over ${MAX_LABEL} characters.`,
  footer_column_empty: 'Each column needs at least one link.',
  footer_column_too_many_links: `Pick at most ${MAX_LINKS_PER_COLUMN} links per column.`,
  footer_link_label_too_long: `Link label is over ${MAX_LABEL} characters.`,
  footer_link_href_invalid: 'URL must be a /path, https:// link, mailto: or tel:.',
  footer_social_icon_unknown: 'Pick an icon from the list.',
  footer_social_href_invalid: 'Social URL must be an absolute https://, mailto: or tel: link.',
  footer_socials_too_many: `Pick at most ${MAX_SOCIALS} social links.`,
  footer_legal_links_too_many: `Pick at most ${MAX_LEGAL} legal links.`,
  footer_contact_email_invalid: 'Contact email is invalid.',
  footer_contact_address_too_many: `Pick at most ${MAX_CONTACT_ADDRESS_LINES} address lines.`,
  footer_contact_line_too_long: `Keep each line under ${MAX_CONTACT_LINE} characters.`,
  bad_json: 'Could not save — please check the form and try again.',
}

/** Map a server error code back to a specific form field so the inline
 *  message lands next to the input that caused it. Best-effort — the
 *  server returns one code at a time so we attach it to the first
 *  matching field. */
function attachServerError(code: string): void {
  const message = SERVER_ERROR_MESSAGES[code] ?? code
  // Description.
  if (code === 'footer_description_too_long') {
    setFieldError('description', message)
    return
  }
  // Column-level.
  if (code === 'footer_column_heading_too_long') {
    const idx = form.value.columns.findIndex((c) => c.heading.trim().length === 0 || c.heading.trim().length > MAX_LABEL)
    if (idx >= 0) setFieldError(`column.${idx}.heading`, message)
    else setFieldError('form', message)
    return
  }
  if (code === 'footer_column_empty') {
    const idx = form.value.columns.findIndex((c) => c.links.length === 0)
    if (idx >= 0) setFieldError(`column.${idx}.heading`, message)
    else setFieldError('form', message)
    return
  }
  if (code === 'footer_column_too_many_links' || code === 'footer_columns_too_many') {
    setFieldError('form', message)
    return
  }
  // Link-level.
  if (code === 'footer_link_label_too_long' || code === 'footer_link_href_invalid') {
    for (let c = 0; c < form.value.columns.length; c++) {
      const col = form.value.columns[c]!
      for (let l = 0; l < col.links.length; l++) {
        const link = col.links[l]!
        const trip = code === 'footer_link_label_too_long'
          ? link.label.trim().length > MAX_LABEL || link.label.trim().length === 0
          : !isHrefOk(link.href, false)
        if (trip) {
          const key = code === 'footer_link_label_too_long'
            ? (`column.${c}.link.${l}.label` as FieldKey)
            : (`column.${c}.link.${l}.href` as FieldKey)
          setFieldError(key, message)
          return
        }
      }
    }
    setFieldError('form', message)
    return
  }
  // Social-level.
  if (code === 'footer_social_href_invalid' || code === 'footer_social_icon_unknown') {
    const idx = form.value.socials.findIndex((s) => !isHrefOk(s.href, true))
    if (idx >= 0) setFieldError(`social.${idx}.href`, message)
    else setFieldError('form', message)
    return
  }
  if (code === 'footer_socials_too_many') {
    setFieldError('form', message)
    return
  }
  // Legal.
  if (code === 'footer_legal_links_too_many') {
    setFieldError('form', message)
    return
  }
  // Contact.
  if (code === 'footer_contact_email_invalid') {
    setFieldError('contact.email', message)
    return
  }
  if (code === 'footer_contact_address_too_many' || code === 'footer_contact_line_too_long') {
    setFieldError('contact.address', message)
    return
  }
  // Fallback.
  setFieldError('form', message)
}

async function save() {
  const clubId = clubStore.current?.id
  if (typeof clubId !== 'number') {
    toast.error('No active club — refresh and try again.')
    return
  }
  clearFieldErrors()
  saving.value = true
  try {
    const payload = buildPayload()
    const res = await footerApi.put(clubId, payload)
    hasSavedConfig.value = true
    if (res.social_icons?.length) availableIcons.value = res.social_icons
    const hydrated = hydrateFromServer(res)
    form.value = hydrated
    baseline.value = cloneState(hydrated)
    toast.success('Footer saved.')
  } catch (err) {
    if (err instanceof ApiError && err.code) {
      attachServerError(err.code)
      toast.error(SERVER_ERROR_MESSAGES[err.code] ?? err.message ?? 'Could not save footer')
    } else {
      const msg = err instanceof Error ? err.message : 'Could not save footer'
      toast.error(msg)
    }
  } finally {
    saving.value = false
  }
}

function discard() {
  form.value = cloneState(baseline.value)
  clearFieldErrors()
}

async function resetToFallback() {
  const clubId = clubStore.current?.id
  if (typeof clubId !== 'number') return
  const ok = confirm(
    'Reset your footer to the Torny defaults? This clears every link, social, and contact override you\'ve saved.',
  )
  if (!ok) return
  resetting.value = true
  try {
    await footerApi.remove(clubId)
    hasSavedConfig.value = false
    const seed = seedState()
    form.value = seed
    baseline.value = cloneState(seed)
    toast.success('Footer reset.')
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Could not reset footer'
    toast.error(msg)
  } finally {
    resetting.value = false
  }
}

onMounted(() => { void load() })

// ── UI helpers ────────────────────────────────────────────────────────
const totalSocialCount = computed(() => form.value.socials.length)
const totalLegalCount = computed(() => form.value.legal_links.length)
const totalColumnCount = computed(() => form.value.columns.length)
</script>

<template>
  <div class="footer-editor">
    <div class="ws-nav-toolbar">
      <div class="ws-nav-toolbar__hint">
        Footer content — the description, link columns, socials, legal links, and contact block that render below every page. Unsaved clubs render Torny's defaults.
      </div>
      <div class="ws-nav-toolbar__actions">
        <button
          v-if="hasSavedConfig"
          type="button"
          class="ws-btn ws-btn--ghost"
          :disabled="resetting || saving"
          @click="resetToFallback"
        >
          <CrmSpinner v-if="resetting" size="sm" label="Resetting" />
          <span>{{ resetting ? 'Resetting…' : 'Reset to defaults' }}</span>
        </button>
        <button
          type="button"
          class="ws-btn ws-btn--outline"
          :disabled="!dirty || saving"
          @click="discard"
        >Discard</button>
        <button
          type="button"
          class="ws-btn"
          :disabled="!dirty || saving || loading"
          @click="save"
        >
          <CrmSpinner v-if="saving" size="sm" label="Saving" />
          <span>{{ saving ? 'Saving…' : 'Save footer' }}</span>
        </button>
      </div>
    </div>

    <div v-if="loading" class="footer-editor__loading">
      <CrmSpinner size="md" label="Loading footer" />
      <span>Loading footer…</span>
    </div>

    <template v-else>
      <div v-if="fieldErrors.form" class="footer-editor__form-error">{{ fieldErrors.form }}</div>

      <!-- Description -->
      <div class="ws-card">
        <div class="ws-card__eyebrow">Description</div>
        <p class="ws-card__hint">Short blurb under the club name. Shown in the brand column of the footer.</p>
        <textarea
          v-model="form.description"
          class="ws-textarea"
          :maxlength="MAX_DESCRIPTION"
          rows="3"
          placeholder="A community bowling club. Everyone welcome…"
        />
        <div class="footer-editor__meta">
          <span>{{ form.description.length }} / {{ MAX_DESCRIPTION }}</span>
        </div>
        <div v-if="fieldErrors.description" class="footer-editor__err">{{ fieldErrors.description }}</div>
      </div>

      <!-- Columns -->
      <div class="ws-card">
        <div class="ws-card__eyebrow">Link columns</div>
        <p class="ws-card__hint">Up to {{ MAX_COLUMNS }} columns of links. Each column needs at least one link.</p>

        <div
          v-for="(col, ci) in form.columns"
          :key="ci"
          class="footer-editor__column"
        >
          <div class="footer-editor__column-head">
            <input
              v-model="col.heading"
              class="ws-nav-input footer-editor__column-heading"
              :maxlength="MAX_LABEL"
              placeholder="Column heading"
              aria-label="Column heading"
            />
            <button
              type="button"
              class="ws-nav-remove"
              aria-label="Remove column"
              @click="removeColumn(ci)"
            >×</button>
          </div>
          <div
            v-if="fieldErrors[`column.${ci}.heading`]"
            class="footer-editor__err"
          >{{ fieldErrors[`column.${ci}.heading`] }}</div>

          <ul class="footer-editor__link-list">
            <li v-for="(link, li) in col.links" :key="li" class="footer-editor__link">
              <input
                v-model="link.label"
                :maxlength="MAX_LABEL"
                placeholder="Label"
                class="ws-nav-input"
                aria-label="Link label"
              />
              <input
                v-model="link.href"
                placeholder="/path or https://…"
                class="ws-nav-input ws-mono"
                aria-label="Link URL"
              />
              <button
                type="button"
                class="ws-nav-remove"
                aria-label="Remove link"
                @click="removeLink(col, li)"
              >×</button>
              <div
                v-if="fieldErrors[`column.${ci}.link.${li}.label`]"
                class="footer-editor__err footer-editor__err--row"
              >{{ fieldErrors[`column.${ci}.link.${li}.label`] }}</div>
              <div
                v-if="fieldErrors[`column.${ci}.link.${li}.href`]"
                class="footer-editor__err footer-editor__err--row"
              >{{ fieldErrors[`column.${ci}.link.${li}.href`] }}</div>
            </li>
          </ul>

          <button
            type="button"
            class="ws-btn ws-btn--ghost"
            :disabled="col.links.length >= MAX_LINKS_PER_COLUMN"
            @click="addLink(col)"
          >+ Add link{{ col.links.length >= MAX_LINKS_PER_COLUMN ? ' (max reached)' : '' }}</button>
        </div>

        <button
          type="button"
          class="ws-btn ws-btn--ghost"
          :disabled="totalColumnCount >= MAX_COLUMNS"
          @click="addColumn"
        >+ Add column{{ totalColumnCount >= MAX_COLUMNS ? ' (max reached)' : '' }}</button>
      </div>

      <!-- Socials -->
      <div class="ws-card">
        <div class="ws-card__eyebrow">Social links</div>
        <p class="ws-card__hint">Pick an icon, give it a label and a URL (absolute https / mailto / tel). Max {{ MAX_SOCIALS }}.</p>

        <ul class="footer-editor__socials">
          <li v-for="(social, si) in form.socials" :key="si" class="footer-editor__social">
            <div class="footer-editor__social-row">
              <label class="footer-editor__picker">
                <select v-model="social.icon" class="ws-nav-input footer-editor__picker-select">
                  <option v-for="icon in availableIcons" :key="icon" :value="icon">
                    {{ SOCIAL_ICON_META[icon]?.label ?? icon }}
                  </option>
                </select>
              </label>
              <input
                v-model="social.label"
                :maxlength="MAX_LABEL"
                placeholder="aria-label (e.g. Instagram)"
                class="ws-nav-input"
                aria-label="Social label"
              />
              <input
                v-model="social.href"
                placeholder="https://instagram.com/yourclub"
                class="ws-nav-input ws-mono"
                aria-label="Social URL"
              />
              <button
                type="button"
                class="ws-nav-remove"
                aria-label="Remove social"
                @click="removeSocial(si)"
              >×</button>
            </div>
            <div
              v-if="fieldErrors[`social.${si}.href`]"
              class="footer-editor__err footer-editor__err--row"
            >{{ fieldErrors[`social.${si}.href`] }}</div>
          </li>
        </ul>

        <button
          type="button"
          class="ws-btn ws-btn--ghost"
          :disabled="totalSocialCount >= MAX_SOCIALS"
          @click="addSocial"
        >+ Add social{{ totalSocialCount >= MAX_SOCIALS ? ' (max reached)' : '' }}</button>
      </div>

      <!-- Legal -->
      <div class="ws-card">
        <div class="ws-card__eyebrow">Legal links</div>
        <p class="ws-card__hint">Rendered inline with the copyright. Max {{ MAX_LEGAL }}.</p>

        <ul class="footer-editor__link-list">
          <li v-for="(link, li) in form.legal_links" :key="li" class="footer-editor__link">
            <input
              v-model="link.label"
              :maxlength="MAX_LABEL"
              placeholder="Label"
              class="ws-nav-input"
              aria-label="Legal link label"
            />
            <input
              v-model="link.href"
              placeholder="/privacy"
              class="ws-nav-input ws-mono"
              aria-label="Legal link URL"
            />
            <button
              type="button"
              class="ws-nav-remove"
              aria-label="Remove legal link"
              @click="removeLegal(li)"
            >×</button>
          </li>
        </ul>

        <button
          type="button"
          class="ws-btn ws-btn--ghost"
          :disabled="totalLegalCount >= MAX_LEGAL"
          @click="addLegal"
        >+ Add legal link{{ totalLegalCount >= MAX_LEGAL ? ' (max reached)' : '' }}</button>
      </div>

      <!-- Contact override -->
      <div class="ws-card">
        <div class="ws-card__eyebrow">Contact block</div>

        <div class="ws-row-switch ws-row-switch--inline">
          <div>
            <h3>Override footer contact details</h3>
            <p v-if="!form.contactOverrideEnabled">
              Off — the footer pulls your canonical club contact (set in Settings → Club &amp; Brand).
            </p>
            <p v-else>
              On — the footer shows the values below instead of your canonical club contact.
            </p>
          </div>
          <button
            type="button"
            class="ws-switch"
            :class="{ 'is-on': form.contactOverrideEnabled }"
            @click="form.contactOverrideEnabled = !form.contactOverrideEnabled"
          >
            <span class="ws-switch__knob" />
          </button>
        </div>

        <div v-if="form.contactOverrideEnabled" class="footer-editor__contact">
          <label class="footer-editor__field">
            <span>Email</span>
            <input
              v-model="form.contact.email"
              :maxlength="MAX_CONTACT_EMAIL"
              type="email"
              placeholder="hello@yourclub.co.nz"
              class="ws-nav-input ws-mono"
            />
            <div v-if="fieldErrors['contact.email']" class="footer-editor__err">
              {{ fieldErrors['contact.email'] }}
            </div>
          </label>

          <label class="footer-editor__field">
            <span>Phone</span>
            <input
              v-model="form.contact.phone"
              placeholder="(04) 567 1234"
              class="ws-nav-input ws-mono"
            />
          </label>

          <label class="footer-editor__field">
            <span>Status pill (optional)</span>
            <input
              v-model="form.contact.status"
              :maxlength="MAX_CONTACT_STATUS"
              placeholder="Open until 9 PM"
              class="ws-nav-input"
            />
          </label>

          <div class="footer-editor__field">
            <span>Address lines</span>
            <ul class="footer-editor__link-list footer-editor__link-list--single">
              <li v-for="(_, ai) in form.contact.address_lines" :key="ai" class="footer-editor__link">
                <input
                  v-model="form.contact.address_lines[ai]"
                  :maxlength="MAX_CONTACT_LINE"
                  :placeholder="ai === 0 ? 'Street address' : 'City / region'"
                  class="ws-nav-input"
                  aria-label="Address line"
                />
                <button
                  type="button"
                  class="ws-nav-remove"
                  aria-label="Remove address line"
                  @click="removeAddressLine(ai)"
                >×</button>
              </li>
            </ul>
            <button
              type="button"
              class="ws-btn ws-btn--ghost"
              :disabled="form.contact.address_lines.length >= MAX_CONTACT_ADDRESS_LINES"
              @click="addAddressLine"
            >
              + Add address line{{ form.contact.address_lines.length >= MAX_CONTACT_ADDRESS_LINES ? ' (max reached)' : '' }}
            </button>
            <div v-if="fieldErrors['contact.address']" class="footer-editor__err">
              {{ fieldErrors['contact.address'] }}
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* The `ws-*` utility classes are duplicated here because the parent
 * panel scopes its styles, so this child's DOM wouldn't match the
 * parent's rules. Keep these visually in sync with WebsiteSettingsPanel.vue. */
.ws-card { padding: 24px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; }
.ws-card__eyebrow { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); margin-bottom: 8px; }
.ws-card__hint { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); margin: 0 0 16px; }

.ws-btn { padding: 9px 14px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: none; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; background: var(--color-ink); color: #fff; }
.ws-btn:hover:not(:disabled) { background: var(--color-graphite); }
.ws-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.ws-btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.ws-btn--outline:hover:not(:disabled) { background: var(--color-surface); border-color: var(--color-ink); }
.ws-btn--ghost { background: transparent; color: var(--color-accent); border: 1px dashed var(--color-accent-soft); margin-top: 12px; }
.ws-btn--ghost:hover:not(:disabled) { background: var(--color-accent-soft); }

.ws-nav-input { background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 8px; padding: 8px 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); width: 100%; }
.ws-nav-input:focus { outline: none; border-color: var(--color-ink); background: #fff; }
.ws-mono { font-family: var(--font-mono); font-size: 12px; }
.ws-textarea { background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 8px; padding: 10px 12px; font-family: var(--font-body); font-size: 14px; color: var(--color-ink); width: 100%; resize: vertical; min-height: 72px; }
.ws-textarea:focus { outline: none; border-color: var(--color-ink); background: #fff; }

.ws-nav-remove { width: 28px; height: 28px; border: 0; background: transparent; color: var(--color-fog); font-size: 18px; cursor: pointer; border-radius: 6px; flex-shrink: 0; }
.ws-nav-remove:hover { background: var(--color-surface); color: var(--color-ink); }

.ws-nav-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 20px; margin-bottom: 4px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 12px; }
.ws-nav-toolbar__hint { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); flex: 1; }
.ws-nav-toolbar__actions { display: flex; gap: 8px; flex-shrink: 0; }

.ws-row-switch { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 0; }
.ws-row-switch--inline { padding: 0 0 16px; margin-bottom: 0; border-bottom: 1px solid var(--color-hairline); }
.ws-row-switch h3 { font-family: var(--font-body); font-size: 14px; font-weight: 600; margin: 0 0 2px; color: var(--color-ink); }
.ws-row-switch p { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin: 0; }
.ws-switch { width: 40px; height: 24px; padding: 3px; border-radius: 999px; background: var(--color-hairline); border: 0; display: flex; cursor: pointer; flex-shrink: 0; }
.ws-switch.is-on { background: var(--color-ink); }
.ws-switch__knob { width: 18px; height: 18px; border-radius: 999px; background: #fff; transition: transform 0.15s ease; }
.ws-switch.is-on .ws-switch__knob { transform: translateX(16px); }

.footer-editor { display: flex; flex-direction: column; gap: 16px; }

.footer-editor__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 48px 24px;
  color: var(--color-fog, #6B6B72);
  font-family: var(--font-body);
}

.footer-editor__form-error {
  padding: 12px 16px;
  background: var(--color-danger-soft, #fff1f0);
  border: 1px solid var(--color-danger, #d64545);
  color: var(--color-danger, #d64545);
  border-radius: 10px;
  font-size: 13px;
}

.footer-editor__err {
  margin-top: 6px;
  color: var(--color-danger, #d64545);
  font-size: 12px;
}
.footer-editor__err--row { grid-column: 1 / -1; }

.footer-editor__meta {
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-fog, #6B6B72);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.footer-editor__column {
  padding: 16px;
  margin-bottom: 12px;
  border: 1px solid var(--color-hairline, #E7E7E1);
  border-radius: 10px;
  background: var(--color-surface, #FAFAF7);
}
.footer-editor__column-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.footer-editor__column-heading { flex: 1; font-weight: 600; }

.footer-editor__link-list {
  list-style: none;
  padding: 0;
  margin: 0 0 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.footer-editor__link-list--single { margin-bottom: 8px; }
.footer-editor__link {
  display: grid;
  grid-template-columns: 1fr 2fr auto;
  gap: 8px;
  align-items: center;
}
.footer-editor__link-list--single .footer-editor__link {
  grid-template-columns: 1fr auto;
}

.footer-editor__socials { list-style: none; padding: 0; margin: 0 0 10px; display: flex; flex-direction: column; gap: 10px; }
.footer-editor__social-row {
  display: grid;
  grid-template-columns: 160px 1fr 2fr auto;
  gap: 8px;
  align-items: center;
}
.footer-editor__picker-select {
  width: 100%;
  background: var(--color-ground, #FFFFFF);
  border: 1px solid var(--color-hairline, #E7E7E1);
  border-radius: 8px;
  padding: 8px 10px;
  font-family: var(--font-body);
  font-size: 13px;
}

.footer-editor__contact {
  margin-top: 16px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
}
.footer-editor__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-fog, #6B6B72);
  font-weight: 600;
}

@media (max-width: 720px) {
  .footer-editor__link { grid-template-columns: 1fr auto; }
  .footer-editor__link > *:nth-child(2) { grid-column: 1 / -1; }
  .footer-editor__social-row { grid-template-columns: 1fr auto; }
  .footer-editor__social-row > *:nth-child(2),
  .footer-editor__social-row > *:nth-child(3) { grid-column: 1 / -1; }
}
</style>
