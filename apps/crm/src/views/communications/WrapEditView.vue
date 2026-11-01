<script setup lang="ts">
/**
 * Email template wrap editor — header + footer HTML that wraps every
 * outgoing club email. Lives under Communications → Templates (moved
 * from Settings → Email template, brief 45).
 *
 * The frame + logo state binds to `emailTemplate.get()` + `.update()`;
 * variables + preview come from the same backend. `resolveBrandTokens`
 * substitutes FE-only brand tokens (`{{font_display}}`, `{{font_body}}`,
 * `{{accent_colour}}`) at save time so the backend's variable whitelist
 * stays strict.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  emailTemplate as emailTemplateApi,
  ApiError,
  type EmailFlavor,
  type EmailPreviewResult,
  type EmailTemplate,
  type EmailTemplatePatch,
  type EmailVariable,
} from '@torny/api-client'
import { useClubStore } from '@/stores/club'
import { useClubSettingsStore } from '@/stores/clubSettings'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const clubStore = useClubStore()
const settingsStore = useClubSettingsStore()
const toast = useToast()

// ── State ─────────────────────────────────────────────────────────
const template = ref<EmailTemplate | null>(null)
const loading = ref(false)
const saving = ref(false)
const testSending = ref(false)
const draft = reactive<EmailTemplatePatch>({})
const previewFlavor = ref<EmailFlavor>('member_welcome')
const previewDevice = ref<'desktop' | 'mobile'>('desktop')
const serverPreview = ref<EmailPreviewResult | null>(null)
const serverPreviewLoading = ref(false)
const serverPreviewError = ref<string | null>(null)
let serverPreviewAbort: AbortController | null = null

const PREVIEW_FLAVORS: Array<{ value: EmailFlavor; label: string }> = [
  { value: 'application_received', label: 'Application received' },
  { value: 'application_approved', label: 'Application approved' },
  { value: 'application_rejected', label: 'Application declined' },
  { value: 'enquiry_received',     label: 'Enquiry received' },
  { value: 'enquiry_reply',        label: 'Enquiry reply' },
  { value: 'member_welcome',       label: 'Member welcome' },
  { value: 'broadcast',            label: 'Broadcast' },
]

// ── Load ──────────────────────────────────────────────────────────
async function loadTemplate() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  loading.value = true
  try {
    template.value = await emailTemplateApi.get(cid)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      template.value = stubTemplate()
    } else {
      toast.error(err instanceof ApiError ? err.message : 'Could not load template.')
    }
  } finally {
    loading.value = false
  }
}

async function ensureBrandLoaded() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || settingsStore.data) return
  try {
    await settingsStore.fetch(cid)
  } catch {
    /* non-fatal — brand token resolution falls back to platform defaults */
  }
}

onMounted(() => {
  void ensureBrandLoaded()
  void loadTemplate()
})
watch(() => clubStore.current?.id, () => {
  void ensureBrandLoaded()
  void loadTemplate()
})

async function loadServerPreview() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || !template.value) return
  serverPreviewAbort?.abort()
  serverPreviewAbort = new AbortController()
  serverPreviewLoading.value = true
  serverPreviewError.value = null
  try {
    serverPreview.value = await emailTemplateApi.preview(
      cid,
      previewFlavor.value,
      { signal: serverPreviewAbort.signal },
    )
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return
    if (err instanceof ApiError && err.status === 404) {
      serverPreview.value = null
    } else {
      serverPreviewError.value = err instanceof ApiError ? err.message : 'Could not load preview.'
    }
  } finally {
    serverPreviewLoading.value = false
  }
}
watch([previewFlavor, () => template.value?.updated_at], () => {
  void loadServerPreview()
})

// ── Platform defaults (brand-tokenised) ───────────────────────────
const PLATFORM_DEFAULT_HEADER = `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #FFFFFF;">
  <tr>
    <td valign="middle" style="padding: 32px 0 32px 40px; width: 1px; white-space: nowrap;">
      <img src="{{club_logo_url}}" alt="{{club_name}} logo" style="display: block; height: 44px; width: auto; border: 0;" />
    </td>
    <td align="left" valign="middle" style="padding: 32px 40px 32px 16px;">
      <div style="font-family: '{{font_display}}', 'Space Grotesk', 'Helvetica Neue', Arial, sans-serif; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: #0A0A0B; line-height: 1.2;">{{club_name}}</div>
    </td>
  </tr>
</table>
<div style="height: 4px; background: {{accent_colour}}; line-height: 4px; font-size: 4px;">&nbsp;</div>`

const PLATFORM_DEFAULT_FOOTER = `<div style="padding: 32px 40px 24px; background: #F5F5F2; border-top: 1px solid #E7E7E1;">
  <div style="font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', Consolas, monospace; font-size: 10px; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase; color: #6B6B72; margin-bottom: 12px;">GET IN TOUCH</div>
  <div style="font-family: '{{font_display}}', 'Space Grotesk', 'Helvetica Neue', Arial, sans-serif; font-size: 16px; font-weight: 700; letter-spacing: -0.01em; color: #0A0A0B; margin-bottom: 8px;">{{club_name}}</div>
  <div style="font-family: '{{font_body}}', 'Inter', 'Helvetica Neue', Arial, sans-serif; font-size: 13px; line-height: 1.55; color: #6B6B72;">
    {{club_address}}<br>
    <a href="mailto:{{club_email}}" style="color: {{accent_colour}}; text-decoration: none;">{{club_email}}</a> · {{club_phone}}
  </div>
</div>
<div style="padding: 20px 40px 32px; background: #F5F5F2; border-top: 1px solid #E7E7E1;">
  <div style="font-family: '{{font_body}}', 'Inter', 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #A3A39B; line-height: 1.55;">
    <a href="{{unsubscribe_url}}" style="color: #A3A39B; text-decoration: underline;">Unsubscribe</a> · © {{year}} {{club_name}}<br>
    <span style="font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: 0.08em;">SENT WITH TORNY</span>
  </div>
</div>`

const STUB_VARIABLES: EmailVariable[] = [
  { key: 'club_name',              token: '{{club_name}}',              label: 'Club name',                     category: 'club',      sample: 'Your Club' },
  { key: 'club_email',             token: '{{club_email}}',             label: 'Club email',                    category: 'club',      sample: 'hello@yourclub.co.nz' },
  { key: 'club_phone',             token: '{{club_phone}}',             label: 'Club phone',                    category: 'club',      sample: '04 123 4567' },
  { key: 'club_address',           token: '{{club_address}}',           label: 'Club address',                  category: 'club',      sample: '1 Example Street' },
  { key: 'club_logo_url',          token: '{{club_logo_url}}',          label: 'Club logo URL',                 category: 'club',      sample: '' },
  { key: 'club_url',               token: '{{club_url}}',               label: 'Public site URL',               category: 'club',      sample: 'https://yourclub.torny.co' },
  { key: 'recipient_name',         token: '{{recipient_name}}',         label: "Recipient's full name",         category: 'recipient', sample: 'Frances Roydon-Miller' },
  { key: 'recipient_first_name',   token: '{{recipient_first_name}}',   label: "Recipient's first name",        category: 'recipient', sample: 'Frances' },
  { key: 'recipient_email',        token: '{{recipient_email}}',        label: "Recipient's email",             category: 'recipient', sample: 'frances@example.co.nz' },
  { key: 'application_tier',       token: '{{application_tier}}',       label: 'Applied membership tier',       category: 'context',   sample: 'Playing member', flavors: ['application_received', 'application_approved', 'application_rejected'] },
  { key: 'event_name',             token: '{{event_name}}',             label: 'Event name',                    category: 'context',   sample: 'Twilight Triples · Round 3', flavors: ['broadcast'] },
  { key: 'event_date',             token: '{{event_date}}',             label: 'Event date',                    category: 'context',   sample: 'Friday 10 October 5:30pm', flavors: ['broadcast'] },
  { key: 'reply_body',             token: '{{reply_body}}',             label: 'Admin reply body',              category: 'context',   sample: 'Great to hear from you — come along Friday.', flavors: ['enquiry_reply'] },
  { key: 'sign_in_url',            token: '{{sign_in_url}}',            label: 'Sign-in URL',                   category: 'auto',      sample: 'https://yourclub.torny.co/sign-in' },
  { key: 'unsubscribe_url',        token: '{{unsubscribe_url}}',        label: 'Unsubscribe URL',               category: 'auto',      sample: 'https://yourclub.torny.co/unsubscribe/…' },
  { key: 'year',                   token: '{{year}}',                   label: 'Current year',                  category: 'auto',      sample: String(new Date().getFullYear()) },
]

function stubTemplate(): EmailTemplate {
  return {
    header_html: resolveBrandTokens(PLATFORM_DEFAULT_HEADER),
    footer_html: resolveBrandTokens(PLATFORM_DEFAULT_FOOTER),
    accent_colour: null,
    font_family: null,
    show_logo: true,
    sample_overrides: {},
    variables: STUB_VARIABLES,
    updated_at: null,
  }
}

/** Resolve FE-only brand tokens into concrete values from the club's
 *  Settings. These tokens aren't on the backend whitelist — inlining them
 *  here keeps the template brand-driven without triggering unknown_variable
 *  on PATCH. */
function resolveBrandTokens(html: string): string {
  const brand = settingsStore.data?.brand
  const fontDisplay = brand?.font_pair_resolved?.heading?.family ?? 'Space Grotesk'
  const fontBody = brand?.font_pair_resolved?.body?.family ?? 'Inter'
  const accent = brand?.accent_colour ?? '#2563EB'
  return html
    .split('{{font_display}}').join(fontDisplay)
    .split('{{font_body}}').join(fontBody)
    .split('{{accent_colour}}').join(accent)
}

// ── Draft helpers ────────────────────────────────────────────────
function draftedHeader(): string { return draft.header_html ?? template.value?.header_html ?? '' }
function draftedFooter(): string { return draft.footer_html ?? template.value?.footer_html ?? '' }
function draftedShowLogo(): boolean { return draft.show_logo ?? template.value?.show_logo ?? true }
const draftedHeaderVal = computed(draftedHeader)
const draftedFooterVal = computed(draftedFooter)
const draftedShowLogoVal = computed(draftedShowLogo)

function stageHeader(v: string) {
  const stored = template.value?.header_html ?? ''
  if (v === stored) delete draft.header_html
  else draft.header_html = v
}
function stageFooter(v: string) {
  const stored = template.value?.footer_html ?? ''
  if (v === stored) delete draft.footer_html
  else draft.footer_html = v
}
function stageShowLogo() {
  const stored = template.value?.show_logo ?? true
  const next = !draftedShowLogo()
  if (next === stored) delete draft.show_logo
  else draft.show_logo = next
}
const isDirty = computed(() =>
  draft.header_html !== undefined || draft.footer_html !== undefined || draft.show_logo !== undefined,
)
function clearDraft() {
  delete draft.header_html
  delete draft.footer_html
  delete draft.show_logo
}

function resetToDefault() {
  stageHeader(resolveBrandTokens(PLATFORM_DEFAULT_HEADER))
  stageFooter(resolveBrandTokens(PLATFORM_DEFAULT_FOOTER))
  toast.info('Reset to Torny default — hit Save to apply.')
}

// ── Save ──────────────────────────────────────────────────────────
interface SaveErrorBody {
  code?: string
  ctx?: { tag?: string; attr?: string; value?: string }
  missing?: string[]
}
function saveErrorMessage(body: SaveErrorBody, fallback: string): string {
  switch (body.code) {
    case 'bad_html': {
      const c = body.ctx ?? {}
      if (c.tag && c.attr) return `<${c.tag} ${c.attr}="…"> isn't allowed. Remove that attribute and try again.`
      if (c.tag) return `<${c.tag}> isn't allowed in email HTML. Remove it and try again.`
      if (c.attr) return `The "${c.attr}" attribute isn't allowed. Remove it and try again.`
      return 'The HTML has a disallowed tag or attribute — check the console for details.'
    }
    case 'unknown_variable': {
      const missing = body.missing ?? []
      if (missing.length === 1) return `${missing[0]} isn't a recognised variable — check the palette.`
      if (missing.length > 1) return `These variables aren't recognised: ${missing.join(', ')}. Check the palette.`
      return 'One of the {{variables}} isn\'t recognised — check the palette.'
    }
    case 'header_too_long': return 'Header HTML is too long (max 20,000 chars). Trim it back.'
    case 'footer_too_long': return 'Footer HTML is too long (max 20,000 chars). Trim it back.'
    default: return fallback
  }
}

async function saveTemplate() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || !isDirty.value) return
  saving.value = true
  try {
    const patch: EmailTemplatePatch = { ...draft }
    if (patch.header_html != null) patch.header_html = resolveBrandTokens(patch.header_html)
    if (patch.footer_html != null) patch.footer_html = resolveBrandTokens(patch.footer_html)
    template.value = await emailTemplateApi.update(cid, patch)
    clearDraft()
    toast.success('Email wrap saved.')
  } catch (err) {
    const body = err instanceof ApiError ? ((err.body ?? {}) as SaveErrorBody) : {}
    const fallback = err instanceof ApiError ? err.message : 'Could not save.'
    toast.error(saveErrorMessage(body, fallback))
  } finally {
    saving.value = false
  }
}

async function sendTestEmail() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  testSending.value = true
  try {
    const res = await emailTemplateApi.testSend(cid, { flavor: previewFlavor.value })
    const idSuffix = res.provider_message_id ? ` · ${res.provider_message_id.slice(0, 16)}…` : ''
    toast.success(`Test email sent to ${res.to}${idSuffix}`)
  } catch (err) {
    const body = err instanceof ApiError
      ? ((err.body ?? {}) as { code?: string; data?: { provider_error?: string } })
      : {}
    if (body.code === 'rate_limited') toast.error('3 test sends per hour — try again in a bit.')
    else if (body.code === 'bad_flavor') toast.error('That preview flavour isn\'t recognised.')
    else if (body.code === 'bad_email') toast.error('Recipient email isn\'t valid.')
    else if (body.code === 'send_failed') {
      const providerErr = body.data?.provider_error
      toast.error(providerErr ? `SES rejected the send: ${providerErr}` : 'Send failed — check SES setup.')
    } else {
      toast.error(err instanceof ApiError ? err.message : 'Could not send test.')
    }
  } finally {
    testSending.value = false
  }
}

// ── Variables ─────────────────────────────────────────────────────
function copyToken(token: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return
  void navigator.clipboard.writeText(token).catch(() => {})
  toast.success(`Copied ${token}`)
}
function insertToken(target: 'header' | 'footer', token: string) {
  if (target === 'header') stageHeader(draftedHeader() + token)
  else stageFooter(draftedFooter() + token)
}
const availableVariables = computed(() => {
  const list = template.value?.variables ?? STUB_VARIABLES
  return list.filter((v) => !v.flavors || v.flavors.includes(previewFlavor.value))
})
const variablesByCategory = computed(() => {
  const groups: Record<string, EmailVariable[]> = { club: [], recipient: [], context: [], auto: [] }
  for (const v of availableVariables.value) {
    if (groups[v.category]) groups[v.category]!.push(v)
  }
  return groups
})

// ── Client-side preview fallback (when brief 45 preview endpoint 404s) ──
function sampleValueFor(v: EmailVariable): string {
  const override = template.value?.sample_overrides[v.key]
  return override ?? v.sample
}
function substituteTokens(html: string): string {
  const vars = template.value?.variables ?? STUB_VARIABLES
  return vars.reduce((acc, v) => acc.split(v.token).join(sampleValueFor(v)), html)
}
const renderedHeader = computed(() => substituteTokens(draftedHeaderVal.value))
const renderedFooter = computed(() => substituteTokens(draftedFooterVal.value))
const previewShellStyle = computed(() => ({
  maxWidth: previewDevice.value === 'mobile' ? '390px' : '640px',
}))

function back() { router.push({ name: 'templates' }) }
</script>

<template>
  <div class="wrap-edit">
    <!-- Topbar -->
    <header class="wrap-edit__topbar">
      <div class="wrap-edit__topbar-left">
        <button type="button" class="wrap-edit__back" @click="back">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3L4 8l6 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          All templates
        </button>
        <div class="wrap-edit__crumb">
          <span class="wrap-edit__crumb-root">Templates</span>
          <span class="wrap-edit__crumb-sep">/</span>
          <span class="wrap-edit__crumb-leaf">Header &amp; footer</span>
        </div>
      </div>
      <div class="wrap-edit__topbar-right">
        <span v-if="isDirty && !saving" class="wrap-edit__status">
          <span class="wrap-edit__status-dot"></span>
          Unsaved changes
        </span>
        <button type="button" class="wrap-edit__ghost" :disabled="saving" @click="resetToDefault">
          Reset to default
        </button>
        <button type="button" class="wrap-edit__ghost" :disabled="!isDirty || saving" @click="clearDraft">
          Discard
        </button>
        <button type="button" class="wrap-edit__save" :disabled="!isDirty || saving" @click="saveTemplate">
          {{ saving ? 'Saving…' : 'Save changes' }}
        </button>
      </div>
    </header>

    <!-- Hero -->
    <section class="wrap-edit__hero">
      <div class="wrap-edit__eyebrow">Shared frame</div>
      <h1 class="wrap-edit__title">Header &amp; footer</h1>
      <p class="wrap-edit__sub">
        The shared frame that wraps every outgoing club email — your logo, brand accent, address + unsubscribe row.
        Per-flavour subject + body overrides live on the <router-link to="/crm/communications/templates">Templates index</router-link>.
      </p>
    </section>

    <!-- Editor card -->
    <section class="wrap-edit__card">
      <div class="wrap-edit__editor">
        <div class="wrap-edit__pane">
          <label class="wrap-edit__field">
            <span class="wrap-edit__label">Header HTML</span>
            <textarea
              :value="draftedHeaderVal"
              @input="stageHeader(($event.target as HTMLTextAreaElement).value)"
              rows="10"
              class="wrap-edit__textarea"
              spellcheck="false"
            ></textarea>
            <span class="wrap-edit__hint">Rendered above the body. Inline styles only — external CSS is dropped by most mail clients.</span>
          </label>
          <label class="wrap-edit__field">
            <span class="wrap-edit__label">Footer HTML</span>
            <textarea
              :value="draftedFooterVal"
              @input="stageFooter(($event.target as HTMLTextAreaElement).value)"
              rows="10"
              class="wrap-edit__textarea"
              spellcheck="false"
            ></textarea>
            <span class="wrap-edit__hint">Must include the <code v-pre>{{unsubscribe_url}}</code> link for CAN-SPAM compliance.</span>
          </label>
          <label class="wrap-edit__logo" :class="{ 'is-off': !draftedShowLogoVal }">
            <div class="wrap-edit__logo-crest">
              <img
                v-if="clubStore.current?.logoUrl"
                :src="clubStore.current.logoUrl"
                :alt="`${clubStore.current?.name ?? 'Club'} logo`"
              />
              <div v-else class="wrap-edit__logo-placeholder">
                <span class="wrap-edit__logo-eyebrow">No logo</span>
                <router-link to="/crm/settings" class="wrap-edit__logo-link">Add one →</router-link>
              </div>
            </div>
            <div class="wrap-edit__logo-body">
              <div class="wrap-edit__logo-row">
                <span class="wrap-edit__logo-title">Show club logo above the header</span>
                <span class="wrap-edit__logo-badge" :class="draftedShowLogoVal ? 'is-on' : 'is-off'">
                  {{ draftedShowLogoVal ? 'On' : 'Off' }}
                </span>
              </div>
              <div class="wrap-edit__logo-hint">
                Pulled from <router-link to="/crm/settings">Club &amp; brand</router-link>. Turn off if your header HTML already ships its own image.
              </div>
            </div>
            <button
              type="button"
              class="wrap-edit__switch"
              :class="{ 'is-on': draftedShowLogoVal }"
              :aria-pressed="draftedShowLogoVal"
              @click="stageShowLogo"
            >
              <span class="wrap-edit__switch-knob" />
            </button>
          </label>
        </div>

        <aside class="wrap-edit__vars">
          <div class="wrap-edit__vars-head">
            <h3 class="wrap-edit__vars-title">Variables</h3>
            <p class="wrap-edit__vars-hint">Click a token to copy or hit → to append to the editor.</p>
          </div>
          <template v-for="(list, cat) in variablesByCategory" :key="cat">
            <div v-if="list.length > 0" class="wrap-edit__vars-group">
              <div class="wrap-edit__vars-category">{{ cat }}</div>
              <ul class="wrap-edit__vars-list">
                <li v-for="v in list" :key="v.key" class="wrap-edit__vars-item">
                  <button type="button" class="wrap-edit__token" @click="copyToken(v.token)" :title="`${v.label} — sample: ${v.sample}`">
                    {{ v.token }}
                  </button>
                  <span class="wrap-edit__vars-label">{{ v.label }}</span>
                  <div class="wrap-edit__vars-insert">
                    <button type="button" @click="insertToken('header', v.token)">→ Header</button>
                    <button type="button" @click="insertToken('footer', v.token)">→ Footer</button>
                  </div>
                </li>
              </ul>
            </div>
          </template>
        </aside>
      </div>
    </section>

    <!-- Preview card -->
    <section class="wrap-edit__card">
      <div class="wrap-edit__card-head">
        <div>
          <div class="wrap-edit__eyebrow">Preview</div>
          <h2 class="wrap-edit__card-title">See it in a real email</h2>
        </div>
        <button type="button" class="wrap-edit__save" :disabled="testSending" @click="sendTestEmail">
          {{ testSending ? 'Sending…' : 'Send test to me' }}
        </button>
      </div>
      <p class="wrap-edit__card-sub">Substitutes <code v-pre>{{variables}}</code> with sample data. The real send uses the actual recipient's details.</p>

      <div class="wrap-edit__preview-controls">
        <label class="wrap-edit__preview-flavor">
          <span class="wrap-edit__preview-flavor-label">Preview</span>
          <select v-model="previewFlavor" class="wrap-edit__preview-select">
            <option v-for="f in PREVIEW_FLAVORS" :key="f.value" :value="f.value">{{ f.label }}</option>
          </select>
        </label>
        <div class="wrap-edit__segmented">
          <button type="button" :class="{ 'is-on': previewDevice === 'desktop' }" @click="previewDevice = 'desktop'">Desktop</button>
          <button type="button" :class="{ 'is-on': previewDevice === 'mobile' }" @click="previewDevice = 'mobile'">Mobile</button>
        </div>
      </div>

      <div class="wrap-edit__preview-frame">
        <div class="wrap-edit__preview-meta">
          <div class="wrap-edit__preview-row">
            <span>Subject</span>
            <span class="wrap-edit__preview-subject">{{ serverPreview?.subject ?? '(subject rendered server-side)' }}</span>
          </div>
          <div class="wrap-edit__preview-row"><span>To</span><span>frances@example.co.nz</span></div>
        </div>

        <div v-if="isDirty" class="wrap-edit__preview-hint">
          <span class="wrap-edit__preview-hint-dot"></span>
          You've got unsaved edits — this preview still shows the last saved template. Save to update it.
        </div>

        <div class="wrap-edit__preview-shell" :style="previewShellStyle">
          <iframe
            v-if="serverPreview"
            class="wrap-edit__preview-iframe"
            :srcdoc="serverPreview.html"
            sandbox=""
            title="Email preview"
          ></iframe>
          <div v-else-if="serverPreviewLoading" class="wrap-edit__preview-loading">Rendering preview…</div>
          <div v-else-if="serverPreviewError" class="wrap-edit__preview-loading wrap-edit__preview-loading--error">
            {{ serverPreviewError }}
          </div>
          <template v-else>
            <div class="wrap-edit__preview-inner" v-html="renderedHeader" />
            <div class="wrap-edit__preview-body">
              <p>Hi Frances,</p>
              <p>Your body text drops in here, between the header and footer.</p>
            </div>
            <div class="wrap-edit__preview-inner" v-html="renderedFooter" />
          </template>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.wrap-edit { display: flex; flex-direction: column; gap: 20px; max-width: 1280px; }

/* Topbar */
.wrap-edit__topbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 16px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }
.wrap-edit__topbar-left { display: flex; align-items: center; gap: 16px; }
.wrap-edit__back { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 999px; border: 1px solid var(--color-hairline); background: #fff; color: var(--color-ink); font-family: var(--font-body); font-size: 12px; font-weight: 500; cursor: pointer; }
.wrap-edit__back:hover { border-color: var(--color-ink); background: var(--color-surface); }
.wrap-edit__crumb { display: flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.wrap-edit__crumb-root { font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; }
.wrap-edit__crumb-sep { color: var(--color-mute); }
.wrap-edit__crumb-leaf { color: var(--color-ink); font-weight: 500; }
.wrap-edit__topbar-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.wrap-edit__status { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.wrap-edit__status-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--color-feature-tangerine); }
.wrap-edit__ghost { display: inline-flex; align-items: center; height: 34px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--color-hairline); background: #fff; color: var(--color-ink); font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; }
.wrap-edit__ghost:hover:not(:disabled) { border-color: var(--color-ink); background: var(--color-surface); }
.wrap-edit__ghost:disabled { opacity: 0.5; cursor: not-allowed; }
.wrap-edit__save { display: inline-flex; align-items: center; height: 34px; padding: 0 16px; border-radius: 999px; background: var(--color-ink); color: #fff; border: 0; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; }
.wrap-edit__save:hover:not(:disabled) { background: var(--color-graphite); }
.wrap-edit__save:disabled { opacity: 0.5; cursor: not-allowed; }

/* Hero */
.wrap-edit__hero { display: flex; flex-direction: column; gap: 8px; max-width: 720px; }
.wrap-edit__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.wrap-edit__title { font-family: var(--font-display); font-size: 32px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; color: var(--color-ink); margin: 0; }
.wrap-edit__sub { font-family: var(--font-body); font-size: 14px; line-height: 1.55; color: var(--color-fog); margin: 0; }
.wrap-edit__sub a { color: var(--color-ink); font-weight: 500; }

/* Cards */
.wrap-edit__card { background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
.wrap-edit__card-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.wrap-edit__card-title { font-family: var(--font-display); font-size: 22px; font-weight: 600; letter-spacing: -0.01em; color: var(--color-ink); margin: 2px 0 0; line-height: 1.15; }
.wrap-edit__card-sub { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); margin: 0; }
.wrap-edit__card-sub code { font-family: var(--font-mono); font-size: 12px; background: var(--color-surface); padding: 1px 6px; border-radius: 4px; }

/* Editor split */
.wrap-edit__editor { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 20px; }
.wrap-edit__pane { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.wrap-edit__field { display: flex; flex-direction: column; gap: 6px; }
.wrap-edit__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-fog); }
.wrap-edit__textarea { font-family: var(--font-mono); font-size: 12px; line-height: 1.6; color: var(--color-ink); padding: 12px 14px; border: 1px solid var(--color-hairline); border-radius: 10px; background: var(--color-surface); resize: vertical; min-height: 220px; }
.wrap-edit__textarea:focus { outline: none; border-color: var(--color-ink); background: #fff; }
.wrap-edit__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }
.wrap-edit__hint code { font-family: var(--font-mono); font-size: 11px; background: var(--color-surface); padding: 1px 5px; border-radius: 3px; }

/* Logo toggle */
.wrap-edit__logo { display: grid; grid-template-columns: 56px 1fr auto; gap: 14px; align-items: center; padding: 14px 16px; border: 1px solid var(--color-hairline); border-radius: 12px; background: var(--color-surface); }
.wrap-edit__logo.is-off { opacity: 0.6; }
.wrap-edit__logo-crest { width: 48px; height: 48px; border-radius: 10px; background: #fff; border: 1px solid var(--color-hairline); display: flex; align-items: center; justify-content: center; overflow: hidden; }
.wrap-edit__logo-crest img { max-width: 100%; max-height: 100%; }
.wrap-edit__logo-placeholder { display: flex; flex-direction: column; gap: 2px; padding: 4px; text-align: center; }
.wrap-edit__logo-eyebrow { font-family: var(--font-body); font-size: 9px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-mute); }
.wrap-edit__logo-link { font-family: var(--font-body); font-size: 10px; color: var(--color-ink); font-weight: 600; }
.wrap-edit__logo-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.wrap-edit__logo-row { display: flex; align-items: center; gap: 8px; }
.wrap-edit__logo-title { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.wrap-edit__logo-badge { font-family: var(--font-mono); font-size: 10px; padding: 1px 8px; border-radius: 999px; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 700; }
.wrap-edit__logo-badge.is-on { background: #DCFCE7; color: #14532D; }
.wrap-edit__logo-badge.is-off { background: var(--color-surface); color: var(--color-fog); }
.wrap-edit__logo-hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }
.wrap-edit__logo-hint a { color: var(--color-ink); font-weight: 500; }
.wrap-edit__switch { position: relative; width: 36px; height: 22px; border-radius: 999px; background: var(--color-mute); border: 0; cursor: pointer; padding: 0; transition: background 0.12s; }
.wrap-edit__switch.is-on { background: var(--color-ink); }
.wrap-edit__switch-knob { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 999px; background: #fff; transition: transform 0.12s; }
.wrap-edit__switch.is-on .wrap-edit__switch-knob { transform: translateX(14px); }

/* Variables sidebar */
.wrap-edit__vars { display: flex; flex-direction: column; gap: 14px; border: 1px solid var(--color-hairline); border-radius: 12px; padding: 16px; background: var(--color-surface); max-height: 640px; overflow-y: auto; }
.wrap-edit__vars-head { display: flex; flex-direction: column; gap: 4px; }
.wrap-edit__vars-title { font-family: var(--font-display); font-size: 14px; font-weight: 600; color: var(--color-ink); margin: 0; }
.wrap-edit__vars-hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin: 0; }
.wrap-edit__vars-group { display: flex; flex-direction: column; gap: 6px; }
.wrap-edit__vars-category { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-mute); }
.wrap-edit__vars-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.wrap-edit__vars-item { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 8px; }
.wrap-edit__token { align-self: flex-start; font-family: var(--font-mono); font-size: 11px; color: var(--color-ink); background: var(--color-surface); border: 1px solid var(--color-hairline); padding: 2px 8px; border-radius: 4px; cursor: pointer; }
.wrap-edit__token:hover { background: #fff; border-color: var(--color-ink); }
.wrap-edit__vars-label { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }
.wrap-edit__vars-insert { display: flex; gap: 6px; }
.wrap-edit__vars-insert button { background: transparent; border: 0; font-family: var(--font-mono); font-size: 10px; color: var(--color-ink); cursor: pointer; padding: 0; }
.wrap-edit__vars-insert button:hover { text-decoration: underline; }

/* Preview */
.wrap-edit__preview-controls { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.wrap-edit__preview-flavor { display: flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.wrap-edit__preview-flavor-label { font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; font-size: 10px; }
.wrap-edit__preview-select { height: 32px; padding: 0 10px; border: 1px solid var(--color-hairline); border-radius: 8px; background: #fff; font-family: var(--font-body); font-size: 12px; color: var(--color-ink); }
.wrap-edit__segmented { display: inline-flex; padding: 2px; border: 1px solid var(--color-hairline); border-radius: 999px; background: #fff; }
.wrap-edit__segmented button { height: 26px; padding: 0 12px; border: 0; background: transparent; border-radius: 999px; font-family: var(--font-body); font-size: 11px; color: var(--color-fog); font-weight: 500; cursor: pointer; }
.wrap-edit__segmented button.is-on { background: var(--color-ink); color: #fff; font-weight: 600; }
.wrap-edit__preview-frame { display: flex; flex-direction: column; gap: 10px; }
.wrap-edit__preview-meta { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; background: var(--color-surface); font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }
.wrap-edit__preview-row { display: flex; gap: 8px; }
.wrap-edit__preview-row > span:first-child { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-mute); width: 52px; }
.wrap-edit__preview-subject { color: var(--color-ink); font-weight: 500; }
.wrap-edit__preview-hint { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; font-family: var(--font-body); font-size: 11px; color: var(--color-fog); background: #FFF7E6; border: 1px solid #FFECB3; border-radius: 8px; }
.wrap-edit__preview-hint-dot { width: 6px; height: 6px; border-radius: 999px; background: #F59E0B; }
.wrap-edit__preview-shell { margin: 0 auto; width: 100%; max-width: 640px; border: 1px solid var(--color-hairline); border-radius: 12px; overflow: hidden; background: #fff; min-height: 420px; display: flex; flex-direction: column; }
.wrap-edit__preview-iframe { flex: 1; border: 0; min-height: 420px; width: 100%; background: #fff; }
.wrap-edit__preview-loading { padding: 48px; text-align: center; color: var(--color-fog); font-family: var(--font-body); font-size: 13px; }
.wrap-edit__preview-loading--error { color: #DC2F3B; }
.wrap-edit__preview-inner :deep(*) { max-width: 100%; }
.wrap-edit__preview-body { padding: 24px 32px; font-family: var(--font-body); font-size: 15px; line-height: 1.55; color: var(--color-ink); }
.wrap-edit__preview-body p { margin: 0 0 14px; }

@media (max-width: 1023px) {
  .wrap-edit__editor { grid-template-columns: 1fr; }
  .wrap-edit__vars { max-height: 400px; }
}
@media (max-width: 767px) {
  .wrap-edit__topbar { flex-direction: column; align-items: stretch; gap: 12px; }
  .wrap-edit__topbar-right { justify-content: flex-end; }
  .wrap-edit__title { font-size: 24px; }
}
</style>
