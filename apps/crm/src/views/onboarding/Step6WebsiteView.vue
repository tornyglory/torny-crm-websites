<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useOnboardingStore } from '@/stores/onboarding'
import { clubOnboarding, ApiError, type SubdomainCheckResult } from '@torny/api-client'
import WizardHeader from '@/components/onboarding/WizardHeader.vue'
import WizardFooter from '@/components/onboarding/WizardFooter.vue'

const onboarding = useOnboardingStore()
const router = useRouter()

interface PageItem { key: keyof typeof onboarding.data.pages; label: string; path: string; hint: string; required?: boolean }
const pages: PageItem[] = [
  { key: 'home', label: 'Home', path: '/', hint: 'Landing page', required: true },
  { key: 'about', label: 'About', path: '/about', hint: 'History + committee' },
  { key: 'membership', label: 'Membership', path: '/membership', hint: 'Tiers + apply flow' },
  { key: 'events', label: 'Events', path: '/events', hint: 'Tournaments + roll-ups' },
  { key: 'shop', label: 'Shop', path: '/shop', hint: 'Add later from settings' },
]

const enabledCount = computed(() => pages.filter(p => onboarding.data.pages[p.key]).length)

// ── Subdomain live-check (brief 11 §4) ────────────────────────
type CheckState = 'idle' | 'checking' | 'available' | 'taken' | 'reserved' | 'invalid' | 'too-short' | 'error'
const subdomainState = ref<CheckState>('idle')
let subdomainAbort: AbortController | null = null
let subdomainTimer: ReturnType<typeof setTimeout> | null = null

function debounceCheck() {
  if (subdomainTimer) clearTimeout(subdomainTimer)
  subdomainTimer = setTimeout(runCheck, 300)
}

async function runCheck() {
  const value = onboarding.data.subdomain.trim().toLowerCase()
  if (value.length < 3) {
    subdomainState.value = 'too-short'
    return
  }
  if (subdomainAbort) subdomainAbort.abort()
  subdomainAbort = new AbortController()
  subdomainState.value = 'checking'
  try {
    const result: SubdomainCheckResult = await clubOnboarding.checkSubdomain(value, { signal: subdomainAbort.signal })
    if (result.available) subdomainState.value = 'available'
    else subdomainState.value = result.reason
  } catch (err) {
    if ((err as Error).name === 'AbortError') return
    if (err instanceof ApiError) subdomainState.value = 'error'
    else subdomainState.value = 'error'
  }
}

watch(() => onboarding.data.subdomain, debounceCheck)

const canPublish = computed(
  () => subdomainState.value === 'available',
)

const pillMeta = computed(() => {
  switch (subdomainState.value) {
    case 'checking':  return { label: 'Checking…', tone: 'mute' }
    case 'available': return { label: 'Available', tone: 'ok' }
    case 'taken':     return { label: 'Taken',     tone: 'danger' }
    case 'reserved':  return { label: 'Reserved',  tone: 'danger' }
    case 'invalid':   return { label: 'Invalid',   tone: 'danger' }
    case 'too-short': return { label: 'Too short', tone: 'mute' }
    case 'error':     return { label: 'Check failed', tone: 'mute' }
    default:          return null
  }
})

const availabilityHint = computed(() => {
  switch (subdomainState.value) {
    case 'taken':     return "Someone else has that one. Try a variation."
    case 'reserved':  return "That's a reserved word (like 'admin' or 'www'). Pick something else."
    case 'invalid':   return 'Only lowercase letters, numbers and hyphens. 3–30 chars.'
    case 'too-short': return 'Needs to be at least 3 characters.'
    case 'error':     return "Couldn't reach the availability service — try again."
    default:          return null
  }
})

onMounted(() => {
  onboarding.setStep(6)
  if (!onboarding.data.subdomain && onboarding.data.clubName) {
    onboarding.data.subdomain = onboarding.data.clubName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30)
  }
  runCheck()
})

function togglePage(item: PageItem) {
  if (item.required) return
  onboarding.data.pages[item.key] = !onboarding.data.pages[item.key]
}
async function publish() {
  // Flush any pending debounced writes so complete() sees the same data the
  // user typed, not the last snapshot from >500ms ago. The actual complete()
  // call happens on CompleteView mount so we have a single source of truth.
  await onboarding.flush()
  router.push({ name: 'onboarding-complete' })
}
</script>

<template>
  <div class="page">
    <WizardHeader
      :step="6"
      title="Website"
      description="Turn on the pages you want to publish and pick a domain. You can keep working after go-live — changes push in seconds."
    />

    <form class="form" @submit.prevent="publish">
      <div class="card">
        <div class="dom-head">
          <div>
            <div class="field__label">Your address</div>
            <div class="dom-sub">A free Torny subdomain to start. You can point a custom domain later in settings.</div>
          </div>
          <span v-if="pillMeta" class="pill" :class="`pill--${pillMeta.tone}`">{{ pillMeta.label }}</span>
        </div>
        <div class="dom">
          <span class="dom__prefix">https://</span>
          <input
            v-model="onboarding.data.subdomain"
            class="dom__input"
            placeholder="kelburn"
            maxlength="30"
            @input="onboarding.data.subdomain = ($event.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9-]/g, '')"
          />
          <span class="dom__suffix">.torny.club</span>
        </div>
        <div v-if="availabilityHint" class="dom-hint" :class="{ 'dom-hint--danger': ['taken','reserved','invalid','error'].includes(subdomainState) }">{{ availabilityHint }}</div>
      </div>

      <div>
        <div class="field-head">
          <div class="field__label">Pages</div>
          <div class="field__count">{{ enabledCount }} of {{ pages.length }} on</div>
        </div>
        <div class="pages">
          <div v-for="p in pages" :key="p.key" class="prow" :class="{ 'is-off': !onboarding.data.pages[p.key] }">
            <span class="prow__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" />
              </svg>
            </span>
            <div class="prow__body">
              <div class="prow__label">{{ p.label }}</div>
              <div class="prow__path">{{ p.path }}</div>
            </div>
            <span v-if="p.required" class="pill pill--ink">Required</span>
            <span v-else class="prow__hint">{{ p.hint }}</span>
            <button
              type="button"
              class="toggle"
              :class="{ 'is-on': onboarding.data.pages[p.key] }"
              :disabled="p.required"
              @click="togglePage(p)"
              :aria-label="`Toggle ${p.label}`"
            >
              <span class="toggle__dot" />
            </button>
          </div>
        </div>
      </div>

      <div class="preview">
        <div class="preview__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="16" height="16"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></svg>
        </div>
        <div class="preview__body">
          <div class="preview__title">Not published yet</div>
          <div class="preview__desc">
            Nothing is public until you hit <b>Publish site</b>. When you do, your address will be
            <span class="preview__code">{{ onboarding.data.subdomain || 'yourclub' }}.torny.club</span>.
          </div>
        </div>
        <span class="pill pill--dark">Preview only</span>
      </div>
    </form>

    <WizardFooter
      backTo="onboarding-step-5"
      skipTo="onboarding-complete"
      continueLabel="Publish site"
      :disabled="!canPublish"
      @continue="publish"
    />
  </div>
</template>

<style scoped>
.page { max-width: 720px; margin: 0 auto; }
.form { display: flex; flex-direction: column; gap: 20px; }
.field__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.field-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }
.field__count { font-family: var(--font-mono); font-size: 10px; color: var(--color-mute); }

.card { padding: 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }
.dom-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 14px; }
.dom-sub { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 4px; }
.dom { display: flex; align-items: center; padding: 4px 4px 4px 16px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 12px; gap: 4px; }
.dom__prefix, .dom__suffix { font-family: var(--font-mono); font-size: 13px; color: var(--color-fog); }
.dom__suffix { padding-right: 8px; }
.dom__input { flex: 1; min-width: 0; padding: 10px 8px; background: transparent; border: 0; outline: none; font-family: var(--font-mono); font-size: 15px; font-weight: 600; color: var(--color-ink); }
.dom__check { padding: 10px 14px; background: var(--color-ink); color: #fff; border: 0; border-radius: 8px; font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; }
.dom__check:hover { background: var(--color-graphite); }

.pill { font-family: var(--font-mono); font-size: 10px; padding: 4px 10px; border-radius: 6px; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 700; white-space: nowrap; }
.pill--ok { background: #DCFCE7; color: #166534; }
.pill--danger { background: #FEE2E2; color: #991B1B; }
.pill--mute { background: var(--color-surface); color: var(--color-fog); }
.pill--ink { background: var(--color-ink); color: #fff; }
.pill--dark { background: rgba(255,255,255,0.08); color: #fff; }

.dom-hint { margin-top: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.dom-hint--danger { color: #991B1B; }

.pages { padding: 6px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; display: flex; flex-direction: column; }
.prow { display: flex; align-items: center; gap: 14px; padding: 12px 14px; border-bottom: 1px solid var(--color-hairline); }
.prow:last-child { border-bottom: 0; }
.prow.is-off { opacity: 0.55; }
.prow__icon { width: 32px; height: 32px; border-radius: 8px; background: var(--color-surface); color: var(--color-ink); display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.prow__body { flex: 1; min-width: 0; }
.prow__label { font-family: var(--font-body); font-size: 14px; font-weight: 600; color: var(--color-ink); }
.prow__path { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); margin-top: 2px; }
.prow__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }

.toggle { width: 34px; height: 20px; padding: 2px; background: var(--color-hairline); border: 0; border-radius: 999px; cursor: pointer; display: inline-flex; justify-content: flex-start; flex-shrink: 0; }
.toggle.is-on { background: var(--color-ink); justify-content: flex-end; }
.toggle:disabled { cursor: not-allowed; }
.toggle__dot { width: 16px; height: 16px; border-radius: 999px; background: #fff; }

.preview { padding: 16px 20px; background: var(--color-ink); border-radius: 16px; display: flex; align-items: center; gap: 16px; color: #fff; }
.preview__icon { width: 36px; height: 36px; border-radius: 10px; background: rgba(255,255,255,0.08); display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; color: #fff; }
.preview__body { flex: 1; min-width: 0; }
.preview__title { font-family: var(--font-display); font-size: 14px; font-weight: 600; }
.preview__desc { font-family: var(--font-body); font-size: 12px; color: rgba(255,255,255,0.7); margin-top: 2px; line-height: 1.5; }
.preview__desc b { color: #fff; font-weight: 600; }
.preview__code { font-family: var(--font-mono); color: #fff; font-weight: 600; }

@media (max-width: 640px) {
  .card { padding: 16px; }
  .dom-head { flex-direction: column; align-items: stretch; gap: 8px; }
  .dom { flex-wrap: wrap; padding: 6px 10px; }
  .dom__prefix { display: none; }
  .dom__input { min-width: 0; font-size: 14px; padding: 8px 6px; }
  .dom__suffix { font-size: 12px; padding-right: 4px; }
  .prow { flex-wrap: wrap; gap: 10px; padding: 12px; }
  .prow__body { flex-basis: calc(100% - 46px); min-width: 0; }
  .prow__hint { flex-basis: 100%; margin-left: 46px; margin-top: -4px; }
  .preview { padding: 14px 16px; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
  .preview__body { flex-basis: calc(100% - 48px); }
  .pill--dark { flex-basis: 100%; align-self: flex-start; }
}
</style>
