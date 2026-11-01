<script setup lang="ts">
/**
 * Email Templates — edit one flavour. Paper reference: artboard 77b.
 *
 * Live-wired to `emailTemplate.listFlavors()` + `.updateFlavor()` +
 * `.resetFlavor()`. The textarea holds plain text; we round-trip to the
 * backend's HTML via `plainToHtml()` / `htmlToPlain()` so admins never
 * see raw `<p>` tags. Preview substitution happens client-side with the
 * token sample fixtures below — the server-side `preview()` endpoint
 * stays available but is only called when the admin hits "Send a test".
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  emailTemplate as templatesApi,
  ApiError,
  type EmailFlavor,
  type EmailFlavorRow,
} from '@torny/api-client'
import { useClubStore } from '@/stores/club'
import { useToast } from '@/composables/useToast'
import {
  FLAVOR_META,
  fmtRelative,
  htmlToPlain,
  plainToHtml,
  slugToFlavor,
} from './mockTemplates'

const route = useRoute()
const router = useRouter()
const clubStore = useClubStore()
const toast = useToast()

const slug = computed(() => String(route.params.slug ?? ''))
const flavor = computed<EmailFlavor | null>(() => slugToFlavor(slug.value))

// ── Live data ─────────────────────────────────────────────────────
const row = ref<EmailFlavorRow | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)
const saving = ref(false)
const resetting = ref(false)

const subject = ref('')
const body = ref('')
const dirty = ref(false)
const suppressDirty = ref(false)       // true while we're resetting form state programmatically
const previewDevice = ref<'desktop' | 'mobile'>('desktop')

const meta = computed(() => (flavor.value ? FLAVOR_META[flavor.value] : null))
const customised = computed(() =>
  row.value ? row.value.subject_override !== null || row.value.body_html_override !== null : false,
)
const supportedTokens = computed<string[]>(() => row.value?.supported_tokens ?? [])

async function loadFlavor() {
  const cid = clubStore.current?.id
  if (cid == null || !flavor.value) return
  loading.value = true
  loadError.value = null
  try {
    const res = await templatesApi.listFlavors(cid)
    const hit = res.flavors.find((f) => f.flavor === flavor.value) ?? null
    row.value = hit
    if (hit) {
      suppressDirty.value = true
      subject.value = hit.subject_override ?? hit.subject_default
      body.value = htmlToPlain(hit.body_html_override ?? hit.body_html_default)
      await Promise.resolve()         // let the watchers tick once
      suppressDirty.value = false
      dirty.value = false
    }
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : 'Could not load template.'
  } finally {
    loading.value = false
  }
}

onMounted(() => { void loadFlavor() })
watch(() => clubStore.current?.id, () => { void loadFlavor() })
watch(flavor, () => { void loadFlavor() })

// Mark dirty on any change (unless we're the ones setting it)
watch([subject, body], () => {
  if (!suppressDirty.value) dirty.value = true
})

// ── Preview substitution — hard-coded sample recipient ────────────
const sample = {
  initials: 'NR',
  name: 'Nev Rodda',
  tier: 'Full member',
  fee: '$260/yr',
  email: 'nev@qubestudio.co.nz',
  firstName: 'Nev',
  signInUrl: 'naenaebowls.nz/signin',
}
const clubName = computed(() => clubStore.current?.name ?? 'Your club')

const tokenMap = computed<Record<string, string>>(() => ({
  recipient_first_name: sample.firstName,
  recipient_name: sample.name,
  recipient_email: sample.email,
  club_name: clubName.value,
  tier_name: sample.tier,
  sign_in_url: sample.signInUrl,
  claim_url: 'naenaebowls.nz/claim/abc123',
  enquiry_subject: 'Can I bring a guest Saturday?',
  reply_body: 'Yes — bring whoever you like, no need to sign them in.',
  sender_name: 'The committee',
  notification_label: 'New application',
  action_url: 'torny.co.nz/crm/applications',
}))

function substitute(input: string): string {
  const map = tokenMap.value
  return input.replace(/\{\{([^}]+)\}\}/g, (_, key) => map[key.trim()] ?? `{{${key}}}`)
}

// ── Bodies rendered line-by-line for the live preview ─────────────
interface Line { id: number; kind: 'p' | 'li'; text: string }
const bodyLines = computed<Line[]>(() => {
  const raw = body.value.split('\n')
  const out: Line[] = []
  let id = 0
  for (const r of raw) {
    const t = r.trimEnd()
    if (t === '') continue
    if (t.startsWith('- ')) out.push({ id: id++, kind: 'li', text: t.slice(2) })
    else out.push({ id: id++, kind: 'p', text: t })
  }
  return out
})
const renderedBodyLines = computed<Line[]>(() =>
  bodyLines.value.map((l) => ({ ...l, text: substitute(l.text) })),
)
const subjectRenderedSample = computed(() => substitute(subject.value))

// ── Token picker ─────────────────────────────────────────────────
const visibleTokens = computed(() => supportedTokens.value.slice(0, 4))
const moreTokensCount = computed(() => Math.max(0, supportedTokens.value.length - visibleTokens.value.length))

function insertToken(key: string) {
  body.value = body.value.replace(/\s*$/, '') + ` {{${key}}}`
}

// ── Save / Reset / Cancel ────────────────────────────────────────
function cancelBack() {
  router.push({ name: 'templates' })
}

async function saveTemplate() {
  const cid = clubStore.current?.id
  if (cid == null || !flavor.value || !row.value) return
  if (!subject.value.trim()) {
    toast.error('Subject can\'t be empty.')
    return
  }
  if (!body.value.trim()) {
    toast.error('Body can\'t be empty.')
    return
  }
  saving.value = true
  try {
    // Only send fields that actually changed.
    const subjectChanged = subject.value !== (row.value.subject_override ?? row.value.subject_default)
    const bodyPlainCurrent = htmlToPlain(row.value.body_html_override ?? row.value.body_html_default)
    const bodyChanged = body.value !== bodyPlainCurrent
    const patch: Partial<{ subject_override: string | null; body_html_override: string | null }> = {}
    if (subjectChanged) {
      patch.subject_override = subject.value === row.value.subject_default ? null : subject.value
    }
    if (bodyChanged) {
      const bodyHtml = plainToHtml(body.value)
      patch.body_html_override = bodyHtml === row.value.body_html_default ? null : bodyHtml
    }
    if (Object.keys(patch).length === 0) {
      // Nothing to save — treat as success and bounce.
      dirty.value = false
      router.push({ name: 'templates' })
      return
    }
    const updated = await templatesApi.updateFlavor(cid, flavor.value, patch)
    row.value = updated
    dirty.value = false
    toast.success(`${meta.value?.label ?? 'Template'} saved.`)
    router.push({ name: 'templates' })
  } catch (err) {
    toast.error(saveErrorMessage(err))
  } finally {
    saving.value = false
  }
}

function saveErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'subject_too_long':  return 'Subject is too long — trim it and try again.'
      case 'body_too_long':     return 'Body is too long — trim it and try again.'
      case 'empty_subject':     return 'Subject can\'t be empty.'
      case 'empty_body':        return 'Body can\'t be empty.'
      case 'unknown_variable':  return 'That contains a token the backend doesn\'t support for this flavour.'
      case 'bad_html':          return 'The body HTML is malformed.'
      default:                  return err.message || 'Could not save.'
    }
  }
  return err instanceof Error ? err.message : 'Could not save.'
}

async function resetToDefault() {
  const cid = clubStore.current?.id
  if (cid == null || !flavor.value) return
  resetting.value = true
  try {
    await templatesApi.resetFlavor(cid, flavor.value)
    toast.success('Reset to Torny default.')
    await loadFlavor()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Could not reset.')
  } finally {
    resetting.value = false
  }
}

// ── Metrics ─────────────────────────────────────────────────────
const subjectLen = computed(() => subject.value.length)
const bodyLen = computed(() => body.value.length)
const tokensUsed = computed(() => {
  const text = `${subject.value}\n${body.value}`
  const matches = text.match(/\{\{[^}]+\}\}/g)
  return matches ? new Set(matches).size : 0
})
const lastEditedISO = computed(() => row.value?.updated_at ?? null)
</script>

<template>
  <div v-if="row && meta" class="te">
    <!-- Topbar -->
    <header class="te__topbar">
      <div class="te__topbar-left">
        <button type="button" class="te__back" @click="cancelBack">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3L4 8l6 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          All templates
        </button>
        <div class="te__crumb">
          <span class="te__crumb-root">Templates</span>
          <span class="te__crumb-sep">/</span>
          <span class="te__crumb-leaf">{{ meta.label }}</span>
        </div>
      </div>
      <div class="te__topbar-right">
        <span v-if="dirty" class="te__status">
          <span class="te__status-dot"></span>
          Unsaved changes
        </span>
        <button type="button" class="te__reset" :disabled="resetting || !customised" @click="resetToDefault">
          {{ resetting ? 'Resetting…' : 'Reset to default' }}
        </button>
        <button type="button" class="te__save" :disabled="saving" @click="saveTemplate">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 4L6 11l-3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          {{ saving ? 'Saving…' : 'Save template' }}
        </button>
      </div>
    </header>

    <!-- Hero -->
    <section class="te__hero">
      <div class="te__hero-main">
        <div class="te__hero-pills">
          <span class="te__pill te__pill--category">{{ meta.categoryLabel }}</span>
          <span class="te__pill" :class="customised ? 'te__pill--custom' : 'te__pill--default'">
            <span v-if="customised" class="te__pill-dot"></span>
            {{ customised ? 'Customised' : 'Default' }}
          </span>
        </div>
        <h1 class="te__hero-title">{{ meta.label }}</h1>
        <p class="te__hero-sub">
          {{ row.hint || meta.description }} Lives inside the global header + footer wrap — only subject and body are editable here.
        </p>
      </div>
      <div class="te__hero-meta">
        <span class="te__hero-meta-item">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 5v3l2 1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          Edited <span class="te-mono">{{ fmtRelative(lastEditedISO) }}</span>
        </span>
      </div>
    </section>

    <!-- Body: editor + rail -->
    <div class="te__body">
      <!-- Editor -->
      <article class="te-editor">
        <div class="te-editor__row">
          <span class="te-editor__label">Subject</span>
          <input
            v-model="subject"
            class="te-editor__input"
            type="text"
            placeholder="Welcome to {{club_name}}"
            maxlength="200"
          />
          <span class="te-editor__counter">{{ subjectLen }} / 200</span>
        </div>
        <div v-if="visibleTokens.length > 0" class="te-editor__vars">
          <span class="te-editor__vars-label">Insert</span>
          <button
            v-for="t in visibleTokens"
            :key="t"
            type="button"
            class="te-var"
            @click="insertToken(t)"
          >{{ t }}</button>
          <span v-if="moreTokensCount > 0" class="te-var te-var--more">+ {{ moreTokensCount }} more</span>
        </div>
        <textarea
          v-model="body"
          class="te-editor__body"
          rows="14"
          spellcheck="false"
          placeholder="Hi {{recipient_first_name}}, …"
        ></textarea>
      </article>

      <!-- Rail -->
      <aside class="te-rail">
        <!-- Preview as -->
        <div class="te-rail__card">
          <div class="te-rail__card-head">
            <div class="te-rail__eyebrow">Preview as</div>
            <div class="te-device">
              <button
                type="button"
                :class="{ 'is-on': previewDevice === 'desktop' }"
                @click="previewDevice = 'desktop'"
              >Desktop</button>
              <button
                type="button"
                :class="{ 'is-on': previewDevice === 'mobile' }"
                @click="previewDevice = 'mobile'"
              >Mobile</button>
            </div>
          </div>
          <div class="te-recipient">
            <div class="te-recipient__avatar">{{ sample.initials }}</div>
            <div class="te-recipient__text">
              <div class="te-recipient__name">{{ sample.name }}</div>
              <div class="te-recipient__meta te-mono">{{ sample.tier }} · {{ sample.fee }}</div>
            </div>
            <button type="button" class="te-recipient__change" disabled>Change</button>
          </div>
        </div>

        <!-- Rendered -->
        <div class="te-rendered">
          <header class="te-rendered__head">
            <div class="te-rendered__meta">
              <span class="te-rendered__label">From</span>
              <span class="te-rendered__value">{{ clubName }}</span>
            </div>
            <div class="te-rendered__meta">
              <span class="te-rendered__label">To</span>
              <span class="te-rendered__value">{{ sample.name }}</span>
            </div>
            <div class="te-rendered__meta">
              <span class="te-rendered__label">Subject</span>
              <span class="te-rendered__value te-rendered__value--bold">{{ subjectRenderedSample || '(no subject)' }}</span>
            </div>
          </header>
          <div class="te-rendered__body">
            <div class="te-rendered__brand">
              <div class="te-rendered__logo">{{ clubName.charAt(0) }}</div>
              <div class="te-rendered__club">{{ clubName }}</div>
            </div>
            <template v-for="l in renderedBodyLines" :key="l.id">
              <p v-if="l.kind === 'p'" class="te-rendered__p">{{ l.text }}</p>
              <ul v-else class="te-rendered__ul"><li>{{ l.text }}</li></ul>
            </template>
          </div>
          <div class="te-rendered__foot">
            <div class="te-rendered__foot-text">{{ clubName }}</div>
            <div class="te-rendered__foot-mute">Unsubscribe · © {{ new Date().getFullYear() }} {{ clubName }}</div>
          </div>
        </div>

        <!-- At-a-glance -->
        <div class="te-rail__card">
          <div class="te-rail__eyebrow">At a glance</div>
          <div class="te-rail__row"><span>Subject length</span><span class="te-mono te-rail__num">{{ subjectLen }} ch</span></div>
          <div class="te-rail__row"><span>Tokens used</span><span class="te-mono te-rail__num">{{ tokensUsed }}</span></div>
          <div class="te-rail__row"><span>Body length</span><span class="te-mono te-rail__num">{{ bodyLen }} ch</span></div>
          <div class="te-rail__row"><span>Last edited</span><span class="te-mono te-rail__num">{{ fmtRelative(lastEditedISO) }}</span></div>
        </div>

        <!-- Fallback -->
        <div class="te-fallback">
          <div class="te-fallback__eyebrow">Fallback</div>
          <div class="te-fallback__title">Reset to Torny default</div>
          <div class="te-fallback__hint">Deletes your overrides. The system default copy ships for every new club — pick it back up if you've overcooked yours.</div>
        </div>
      </aside>
    </div>
  </div>

  <div v-else-if="loading" class="te-missing">
    <div class="te-missing__title">Loading template…</div>
  </div>

  <div v-else class="te-missing">
    <div class="te-missing__title">Template not found</div>
    <p v-if="loadError" class="te-missing__err">{{ loadError }}</p>
    <button type="button" class="te__back" @click="cancelBack">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3L4 8l6 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      All templates
    </button>
  </div>
</template>

<style scoped>
.te { display: flex; flex-direction: column; min-height: calc(100vh - 60px); background: var(--color-surface); margin: -24px -24px 0; border: 1px solid var(--color-hairline); border-radius: 16px 16px 0 0; overflow: hidden; }
.te-mono { font-family: var(--font-mono); color: var(--color-ink); font-weight: 500; letter-spacing: 0.02em; }

/* Topbar */
.te__topbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 16px 32px; background: #fff; border-bottom: 1px solid var(--color-hairline); }
.te__topbar-left { display: flex; align-items: center; gap: 16px; }
.te__back { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 999px; border: 1px solid var(--color-hairline); background: #fff; color: var(--color-ink); font-family: var(--font-body); font-size: 12px; font-weight: 500; cursor: pointer; }
.te__back:hover { border-color: var(--color-ink); background: var(--color-surface); }
.te__crumb { display: flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.te__crumb-root { font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; }
.te__crumb-sep { color: var(--color-mute); }
.te__crumb-leaf { color: var(--color-ink); font-weight: 500; }
.te__topbar-right { display: flex; align-items: center; gap: 14px; }
.te__status { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.te__status-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--color-feature-tangerine); }
.te__reset { display: inline-flex; align-items: center; gap: 6px; padding: 0 14px; height: 34px; border-radius: 999px; border: 1px solid var(--color-hairline); background: #fff; color: var(--color-ink); font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; }
.te__reset:hover { border-color: var(--color-ink); background: var(--color-surface); }
.te__save { display: inline-flex; align-items: center; gap: 6px; padding: 0 18px; height: 34px; border-radius: 999px; background: var(--color-ink); color: #fff; border: 0; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; }
.te__save:hover { background: var(--color-graphite); }

/* Hero */
.te__hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding: 40px 48px 24px; background: var(--color-surface); }
.te__hero-main { display: flex; flex-direction: column; gap: 10px; max-width: 720px; min-width: 0; }
.te__hero-pills { display: inline-flex; align-items: center; gap: 8px; }
.te__pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; height: 24px; }
.te__pill--category { background: #F3E8FF; color: #5B21B6; }
.te__pill--custom   { background: #DCFCE7; color: #14532D; }
.te__pill--default  { background: #fff; color: var(--color-fog); border: 1px solid var(--color-hairline); }
.te__pill-dot { width: 5px; height: 5px; border-radius: 999px; background: currentColor; }
.te__hero-title { font-family: var(--font-display); font-size: 40px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.05; color: var(--color-ink); margin: 0; }
.te__hero-sub { font-family: var(--font-body); font-size: 15px; line-height: 1.5; color: var(--color-fog); margin: 0; }
.te__hero-meta { display: flex; align-items: center; gap: 14px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.te__hero-meta-item { display: inline-flex; align-items: center; gap: 6px; }
.te__hero-meta-sep { color: var(--color-mute); }

/* Body grid */
.te__body { display: grid; grid-template-columns: minmax(0, 1fr) 420px; gap: 24px; padding: 12px 48px 48px; background: var(--color-surface); align-items: flex-start; }

/* Editor */
.te-editor { background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; display: flex; flex-direction: column; overflow: hidden; }
.te-editor__row { display: flex; align-items: center; gap: 14px; padding: 18px 24px; border-bottom: 1px solid var(--color-hairline); }
.te-editor__row--muted { background: var(--color-surface); padding: 14px 24px; }
.te-editor__label { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); width: 72px; flex-shrink: 0; }
.te-editor__input { flex: 1; min-width: 0; border: 0; background: transparent; outline: none; font-family: var(--font-display); font-size: 22px; font-weight: 600; letter-spacing: -0.01em; color: var(--color-ink); }
.te-editor__input::placeholder { color: var(--color-mute); font-weight: 400; }
.te-editor__input--small { font-family: var(--font-body); font-size: 13px; font-weight: 500; letter-spacing: 0; }
.te-editor__counter { font-family: var(--font-mono); font-size: 11px; color: var(--color-mute); flex-shrink: 0; }
.te-editor__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); flex-shrink: 0; }
.te-editor__vars { display: flex; align-items: center; gap: 8px; padding: 12px 24px; border-bottom: 1px solid var(--color-hairline); flex-wrap: wrap; }
.te-editor__vars-label { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); margin-right: 4px; }
.te-var { display: inline-flex; align-items: center; padding: 4px 10px; border: 1px solid var(--color-hairline); border-radius: 999px; background: var(--color-surface); color: var(--color-ink); font-family: var(--font-mono); font-size: 11px; font-weight: 500; cursor: pointer; transition: background 0.12s ease, border-color 0.12s ease; }
.te-var:hover { border-color: var(--color-ink); background: #fff; }
.te-var--more { background: #fff; color: var(--color-fog); border-style: dashed; font-family: var(--font-body); cursor: default; }
.te-editor__body { width: 100%; box-sizing: border-box; padding: 24px; border: 0; outline: none; background: #fff; font-family: var(--font-mono); font-size: 13px; line-height: 1.6; color: var(--color-ink); resize: vertical; min-height: 320px; }

/* Rail */
.te-rail { display: flex; flex-direction: column; gap: 14px; position: sticky; top: 24px; }
.te-rail__card { background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; }
.te-rail__card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.te-rail__eyebrow { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.te-rail__row { display: flex; align-items: baseline; justify-content: space-between; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.te-rail__num { color: var(--color-ink); font-weight: 600; }

.te-device { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border-radius: 999px; border: 1px solid var(--color-hairline); background: #fff; }
.te-device button { padding: 4px 12px; border: 0; background: transparent; border-radius: 999px; cursor: pointer; font-family: var(--font-body); font-size: 11px; font-weight: 500; color: var(--color-fog); }
.te-device button.is-on { background: var(--color-ink); color: #fff; font-weight: 600; }

.te-recipient { display: flex; align-items: center; gap: 10px; }
.te-recipient__avatar { width: 30px; height: 30px; border-radius: 999px; background: #EDE9FE; color: #5B21B6; display: flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 11px; font-weight: 600; flex-shrink: 0; }
.te-recipient__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.te-recipient__name { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.te-recipient__meta { font-family: var(--font-mono); font-size: 10px; color: var(--color-fog); }
.te-recipient__change { margin-left: auto; background: none; border: 0; color: var(--color-accent); font-family: var(--font-body); font-size: 11px; font-weight: 600; cursor: pointer; padding: 0; }
.te-recipient__change:hover { text-decoration: underline; }

/* Rendered preview */
.te-rendered { background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; overflow: hidden; }
.te-rendered__head { padding: 14px 18px 10px; background: var(--color-surface); border-bottom: 1px solid var(--color-hairline); display: flex; flex-direction: column; gap: 4px; }
.te-rendered__meta { display: flex; align-items: baseline; gap: 10px; font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }
.te-rendered__label { font-family: var(--font-body); font-size: 9px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-mute); width: 52px; flex-shrink: 0; }
.te-rendered__value { color: var(--color-ink); font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.te-rendered__value--bold { font-weight: 600; }
.te-rendered__body { padding: 20px 22px; background: #fff; display: flex; flex-direction: column; gap: 12px; }
.te-rendered__brand { display: flex; align-items: center; gap: 10px; padding-bottom: 12px; border-bottom: 1px solid var(--color-hairline); }
.te-rendered__logo { width: 28px; height: 28px; border-radius: 6px; background: linear-gradient(135deg, #2E5D3C, #14532D); display: flex; align-items: center; justify-content: center; color: #fff; font-family: var(--font-display); font-size: 11px; font-weight: 700; }
.te-rendered__club { font-family: var(--font-display); font-size: 14px; font-weight: 600; letter-spacing: -0.01em; color: var(--color-ink); }
.te-rendered__p { font-family: var(--font-body); font-size: 13px; line-height: 1.6; color: var(--color-ink); margin: 0; }
.te-rendered__ul { font-family: var(--font-body); font-size: 13px; line-height: 1.6; color: var(--color-ink); margin: 0; padding-left: 18px; }
.te-rendered__foot { padding: 12px 22px 16px; background: var(--color-surface); border-top: 1px solid var(--color-hairline); display: flex; flex-direction: column; gap: 4px; }
.te-rendered__foot-text { font-family: var(--font-body); font-size: 10px; color: var(--color-fog); line-height: 1.5; }
.te-rendered__foot-mute { font-family: var(--font-body); font-size: 10px; color: var(--color-mute); }

/* Fallback ink card */
.te-fallback { padding: 14px 18px; background: var(--color-ink); color: #fff; border-radius: 14px; display: flex; flex-direction: column; gap: 8px; }
.te-fallback__eyebrow { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255, 255, 255, 0.6); }
.te-fallback__title { font-family: var(--font-display); font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
.te-fallback__hint { font-family: var(--font-body); font-size: 11px; color: rgba(255, 255, 255, 0.6); line-height: 1.5; }

/* Missing */
.te-missing { padding: 80px 32px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
.te-missing__title { font-family: var(--font-display); font-size: 24px; font-weight: 600; color: var(--color-ink); }
.te-missing__err { font-family: var(--font-body); font-size: 13px; color: #DC2F3B; margin: 0; }
.te__reset:disabled,
.te__save:disabled { opacity: 0.5; cursor: not-allowed; }

@media (max-width: 1023px) {
  .te__body { grid-template-columns: 1fr; }
  .te-rail { position: static; }
}
@media (max-width: 767px) {
  .te__topbar { padding: 12px 20px; flex-wrap: wrap; gap: 12px; }
  .te__hero { padding: 24px 20px 16px; }
  .te__hero-title { font-size: 28px; }
  .te__body { padding: 12px 20px 32px; }
}
</style>
