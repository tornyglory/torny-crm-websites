<script setup lang="ts">
/**
 * Email Templates — index. Paper reference: artboard 77a.
 *
 * Reads from the live `emailTemplate` resource (brief 45 global wrap +
 * brief 46 per-flavour overrides). UI metadata (icon tone, label copy,
 * category) is static — see `./mockTemplates.ts`.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  emailTemplate as templatesApi,
  type EmailFlavor,
  type EmailFlavorRow,
  type EmailTemplate,
} from '@torny/api-client'
import { useClubStore } from '@/stores/club'
import {
  FLAVOR_META,
  FLAVOR_ORDER,
  flavorToSlug,
  fmtRelative,
} from './mockTemplates'

const router = useRouter()
const clubStore = useClubStore()

// ── Live data refs ────────────────────────────────────────────────
const wrap = ref<EmailTemplate | null>(null)
const flavors = ref<EmailFlavorRow[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
const showLogo = ref(true)

const filterLabel = ref('All')

async function loadAll() {
  const cid = clubStore.current?.id
  if (cid == null) return
  loading.value = true
  loadError.value = null
  try {
    const [w, f] = await Promise.all([
      templatesApi.get(cid),
      templatesApi.listFlavors(cid),
    ])
    wrap.value = w
    showLogo.value = w.show_logo
    flavors.value = f.flavors
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : 'Could not load templates.'
  } finally {
    loading.value = false
  }
}

onMounted(() => { void loadAll() })
watch(() => clubStore.current?.id, () => { void loadAll() })

// ── Derived UI rows (merge backend data + static metadata) ────────
interface UiFlavour {
  flavor: EmailFlavor
  slug: string
  label: string
  description: string
  categoryLabel: 'Broadcast' | 'Transactional'
  iconTone: 'ink' | 'violet'
  customised: boolean
  subject: string | null       // null for broadcast
  lastEditedISO: string | null
}

const uiFlavours = computed<UiFlavour[]>(() => {
  // Index server rows by flavor key for fast lookup
  const byFlavor = new Map(flavors.value.map((r) => [r.flavor, r] as const))
  // Render in the UI's preferred order; only include flavours the server knows about
  return FLAVOR_ORDER
    .filter((f) => byFlavor.has(f))
    .map((f) => {
      const row = byFlavor.get(f)!
      const meta = FLAVOR_META[f]
      return {
        flavor: f,
        slug: flavorToSlug(f),
        label: meta.label,
        description: meta.description,
        categoryLabel: meta.categoryLabel,
        iconTone: meta.iconTone,
        customised: row.subject_override !== null || row.body_html_override !== null,
        subject: f === 'broadcast' ? null : (row.subject_override ?? row.subject_default),
        lastEditedISO: row.updated_at,
      }
    })
})

const wrapLastEditedISO = computed(() => wrap.value?.updated_at ?? null)
const clubName = computed(() => clubStore.current?.name ?? 'Your club')

function openFlavour(slug: string) {
  router.push({ name: 'template-edit', params: { slug } })
}
function openWrap() {
  router.push({ name: 'template-wrap' })
}

/** Split a string so `{{token}}` segments render with the accent-soft pill
 *  style while plain text stays default. */
function highlightTokens(input: string): Array<{ id: number; kind: 'text' | 'token'; text: string }> {
  const parts: Array<{ id: number; kind: 'text' | 'token'; text: string }> = []
  let id = 0
  let last = 0
  const re = /\{\{[^}]+\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(input)) !== null) {
    if (m.index > last) parts.push({ id: id++, kind: 'text', text: input.slice(last, m.index) })
    parts.push({ id: id++, kind: 'token', text: m[0] })
    last = re.lastIndex
  }
  if (last < input.length) parts.push({ id, kind: 'text', text: input.slice(last) })
  return parts
}
</script>

<template>
  <div class="tpl-idx">
    <!-- Page header -->
    <header class="tpl-idx__head">
      <div class="tpl-idx__head-main">
        <div class="tpl-idx__eyebrow">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M3 4l5 4 5-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Communications · Templates
        </div>
        <h1 class="tpl-idx__title">Email templates</h1>
        <p class="tpl-idx__sub">
          Every email the club sends wears the header and footer below. Edit the global wrap once; per-flavour subject + body overrides live below it.
        </p>
      </div>
      <button type="button" class="tpl-idx__send-test">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 8l6-6 6 6M8 2v12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Send a test
      </button>
    </header>

    <!-- Load error -->
    <div v-if="loadError" class="tpl-idx__error">
      {{ loadError }}
    </div>

    <!-- Wrap hero -->
    <section v-if="wrap" class="tpl-wrap">
      <div class="tpl-wrap__preview">
        <div class="tpl-wrap__preview-head">
          <div class="tpl-wrap__preview-eyebrow">Global wrap · what every email wears</div>
          <div class="tpl-wrap__edited">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 5v3l2 1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
            Edited <span class="tpl-mono">{{ fmtRelative(wrapLastEditedISO) }}</span>
          </div>
        </div>
        <article class="tpl-mail">
          <header class="tpl-mail__head">
            <div class="tpl-mail__logo">{{ clubName.charAt(0) }}</div>
            <div>
              <div class="tpl-mail__club">{{ clubName }}</div>
              <div class="tpl-mail__club-sub">Header + footer render around every email</div>
            </div>
          </header>
          <div class="tpl-mail__body">
            <p>Hi <span class="tpl-token">&#123;&#123;recipient_first_name&#125;&#125;</span>,</p>
            <p>
              Your body text drops in here, between the header and footer. The admin never has to touch the wrap — it stays consistent across every send.
            </p>
            <div class="tpl-mail__divider"></div>
            <div class="tpl-mail__footer-text">{{ clubName }}</div>
            <div class="tpl-mail__footer-mute">Unsubscribe · © {{ new Date().getFullYear() }} {{ clubName }}</div>
          </div>
        </article>
        <div class="tpl-wrap__footer-meta">
          <span class="tpl-wrap__footer-ok">
            <span class="tpl-wrap__dot"></span>Live from the backend
          </span>
          <span class="tpl-wrap__sep">·</span>
          <span>Used in {{ flavors.length }} flavours</span>
        </div>
      </div>

      <aside class="tpl-brand">
        <div class="tpl-brand__eyebrow">Brand controls</div>
        <label class="tpl-field">
          <span class="tpl-field__label">Accent colour</span>
          <div class="tpl-field__input tpl-field__input--swatch">
            <span class="tpl-swatch" :style="{ background: wrap.accent_colour ?? '#14532D' }"></span>
            <span class="tpl-mono tpl-field__mono">{{ wrap.accent_colour ?? 'Default' }}</span>
          </div>
        </label>
        <label class="tpl-field">
          <span class="tpl-field__label">Font family</span>
          <div class="tpl-field__input tpl-field__input--select">
            <span>{{ wrap.font_family ?? 'Inter' }}</span>
            <span class="tpl-field__chev">▾</span>
          </div>
        </label>
        <div class="tpl-toggle">
          <div class="tpl-toggle__text">
            <div class="tpl-toggle__label">Show club logo</div>
            <div class="tpl-toggle__hint">Appears at the top of every email.</div>
          </div>
          <button
            type="button"
            class="tpl-switch"
            :class="{ 'tpl-switch--on': showLogo }"
            :aria-pressed="showLogo"
            @click="showLogo = !showLogo"
          >
            <span class="tpl-switch__nub"></span>
          </button>
        </div>
        <button type="button" class="tpl-brand__edit" @click="openWrap">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M11 2.5l2.5 2.5-8 8-3 .5.5-3 8-8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
          Edit header &amp; footer HTML
        </button>
      </aside>
    </section>

    <!-- Loading -->
    <div v-else-if="loading" class="tpl-idx__loading">Loading templates…</div>

    <!-- Flavours grid -->
    <section v-if="uiFlavours.length > 0" class="tpl-flavs">
      <header class="tpl-flavs__head">
        <div>
          <div class="tpl-flavs__eyebrow">Per-flavour subject + body</div>
          <h2 class="tpl-flavs__title">{{ uiFlavours.length }} flavours</h2>
        </div>
        <button type="button" class="tpl-flavs__filter">
          Filter · {{ filterLabel }}
          <span class="tpl-flavs__filter-chev">▾</span>
        </button>
      </header>

      <div class="tpl-grid">
        <article
          v-for="f in uiFlavours"
          :key="f.slug"
          class="tpl-card"
          tabindex="0"
          @click="openFlavour(f.slug)"
          @keydown.enter="openFlavour(f.slug)"
        >
          <div class="tpl-card__head">
            <div class="tpl-card__title">
              <div class="tpl-card__icon" :class="`tpl-card__icon--${f.iconTone}`">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 6l12-3-3 10-4-3-5-4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
              </div>
              <div class="tpl-card__labels">
                <div class="tpl-card__label">{{ f.label }}</div>
                <div class="tpl-card__desc">{{ f.description }}</div>
              </div>
            </div>
            <span
              class="tpl-card__pill"
              :class="f.customised ? 'tpl-card__pill--custom' : 'tpl-card__pill--default'"
            >
              <span v-if="f.customised" class="tpl-card__pill-dot"></span>
              {{ f.customised ? 'Customised' : 'Default' }}
            </span>
          </div>
          <div class="tpl-card__subject">
            <span class="tpl-card__subject-prefix">Subject:</span>
            <template v-if="f.subject">
              <template v-for="part in highlightTokens(f.subject)" :key="part.id">
                <span v-if="part.kind === 'token'" class="tpl-token tpl-token--inline">{{ part.text }}</span>
                <span v-else>{{ part.text }}</span>
              </template>
            </template>
            <span v-else-if="f.slug === 'broadcast'" class="tpl-card__subject-muted">(set per send in the composer)</span>
            <span v-else class="tpl-card__subject-muted">(default system copy — unedited)</span>
          </div>
          <div class="tpl-card__foot">
            <span>Edited <span class="tpl-mono tpl-card__count">{{ fmtRelative(f.lastEditedISO) }}</span></span>
            <span class="tpl-card__edit">
              Edit
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3l6 5-6 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tpl-idx { display: flex; flex-direction: column; gap: 32px; max-width: 1280px; }
.tpl-idx__loading { padding: 48px; text-align: center; color: var(--color-fog); font-family: var(--font-body); font-size: 14px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }
.tpl-idx__error { padding: 16px 20px; background: #FEE2E2; color: #991B1B; border-radius: 12px; font-family: var(--font-body); font-size: 13px; }
.tpl-mono { font-family: var(--font-mono); color: var(--color-ink); font-weight: 500; letter-spacing: 0.02em; }
.tpl-token { font-family: var(--font-mono); background: var(--color-accent-soft); color: var(--color-accent-strong); padding: 1px 6px; border-radius: 4px; }
.tpl-token--inline { font-size: 12px; }

/* Page header */
.tpl-idx__head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
.tpl-idx__head-main { display: flex; flex-direction: column; gap: 8px; max-width: 720px; }
.tpl-idx__eyebrow { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.tpl-idx__title { font-family: var(--font-display); font-size: 44px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.05; color: var(--color-ink); margin: 0; }
.tpl-idx__sub { font-family: var(--font-body); font-size: 16px; line-height: 1.5; color: var(--color-fog); margin: 0; }
.tpl-idx__send-test { display: inline-flex; align-items: center; gap: 6px; padding: 0 16px; height: 38px; border-radius: 999px; border: 0; background: var(--color-ink); color: #fff; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; }
.tpl-idx__send-test:hover { background: var(--color-graphite); }

/* Wrap hero */
.tpl-wrap { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 20px; padding: 24px; }
.tpl-wrap__preview { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.tpl-wrap__preview-head { display: flex; align-items: center; justify-content: space-between; }
.tpl-wrap__preview-eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.tpl-wrap__edited { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; background: var(--color-surface); font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }

.tpl-mail { border: 1px solid var(--color-hairline); border-radius: 14px; overflow: hidden; background: var(--color-surface); }
.tpl-mail__head { display: flex; align-items: center; gap: 14px; padding: 24px 32px 20px; background: #fff; border-bottom: 1px solid var(--color-hairline); }
.tpl-mail__logo { width: 48px; height: 48px; border-radius: 12px; background: linear-gradient(135deg, #2E5D3C, #14532D); display: flex; align-items: center; justify-content: center; color: #fff; font-family: var(--font-display); font-size: 16px; font-weight: 700; }
.tpl-mail__club { font-family: var(--font-display); font-size: 17px; font-weight: 600; letter-spacing: -0.01em; color: var(--color-ink); line-height: 1.1; }
.tpl-mail__club-sub { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; }
.tpl-mail__body { padding: 26px 32px; background: #fff; display: flex; flex-direction: column; gap: 14px; font-family: var(--font-body); font-size: 15px; line-height: 1.55; color: var(--color-ink); }
.tpl-mail__body p { margin: 0; }
.tpl-mail__divider { height: 1px; background: var(--color-hairline); margin: 4px 0; }
.tpl-mail__footer-text { font-family: var(--font-body); font-size: 12px; line-height: 1.55; color: var(--color-fog); }
.tpl-mail__footer-mute { font-family: var(--font-body); font-size: 11px; color: var(--color-mute); }

.tpl-wrap__footer-meta { display: flex; align-items: center; gap: 14px; font-family: var(--font-body); font-size: 11px; color: var(--color-fog); flex-wrap: wrap; }
.tpl-wrap__footer-ok { display: inline-flex; align-items: center; gap: 4px; }
.tpl-wrap__dot { width: 6px; height: 6px; border-radius: 999px; background: #2E5D3C; }
.tpl-wrap__sep { color: var(--color-mute); }

.tpl-brand { display: flex; flex-direction: column; gap: 14px; border-left: 1px solid var(--color-hairline); padding-left: 20px; }
.tpl-brand__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.tpl-field { display: flex; flex-direction: column; gap: 4px; }
.tpl-field__label { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-mute); }
.tpl-field__input { display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 12px; border: 1px solid var(--color-hairline); border-radius: 12px; background: #fff; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); }
.tpl-field__input--select { justify-content: space-between; padding: 0 14px; cursor: pointer; }
.tpl-field__input--swatch { padding: 0 12px; }
.tpl-swatch { width: 22px; height: 22px; border-radius: 999px; border: 1px solid var(--color-hairline); flex-shrink: 0; }
.tpl-field__mono { font-size: 12px; }
.tpl-field__chev { color: var(--color-mute); }

.tpl-toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border: 1px solid var(--color-hairline); border-radius: 12px; background: #fff; }
.tpl-toggle__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.tpl-toggle__label { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.tpl-toggle__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }
.tpl-switch { position: relative; width: 34px; height: 20px; border-radius: 999px; background: var(--color-mute); border: 0; cursor: pointer; padding: 0; transition: background 0.12s ease; flex-shrink: 0; }
.tpl-switch__nub { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 999px; background: #fff; transition: transform 0.12s ease; }
.tpl-switch--on { background: var(--color-ink); }
.tpl-switch--on .tpl-switch__nub { transform: translateX(14px); }

.tpl-brand__edit { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; padding: 0 14px; height: 36px; border-radius: 999px; border: 1px solid var(--color-hairline); background: #fff; color: var(--color-ink); font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; margin-top: 4px; }
.tpl-brand__edit:hover { border-color: var(--color-ink); background: var(--color-surface); }

/* Flavours grid */
.tpl-flavs { display: flex; flex-direction: column; gap: 20px; }
.tpl-flavs__head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
.tpl-flavs__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.tpl-flavs__title { font-family: var(--font-display); font-size: 28px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; color: var(--color-ink); margin: 0; }
.tpl-flavs__filter { display: inline-flex; align-items: center; gap: 6px; padding: 0 14px; height: 34px; border-radius: 999px; border: 1px solid var(--color-hairline); background: #fff; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-ink); cursor: pointer; }
.tpl-flavs__filter-chev { color: var(--color-mute); }

.tpl-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.tpl-card { display: flex; flex-direction: column; gap: 12px; padding: 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; cursor: pointer; transition: border-color 0.12s ease, box-shadow 0.12s ease; }
.tpl-card:hover,
.tpl-card:focus-visible { outline: none; border-color: var(--color-ink); box-shadow: 0 2px 12px -4px rgba(10, 10, 11, 0.08); }
.tpl-card__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.tpl-card__title { display: flex; align-items: center; gap: 10px; }
.tpl-card__icon { width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #fff; }
.tpl-card__icon--ink    { background: var(--color-ink); }
.tpl-card__icon--violet { background: linear-gradient(135deg, #5B21B6, #7C3AED); }
.tpl-card__labels { display: flex; flex-direction: column; gap: 2px; }
.tpl-card__label { font-family: var(--font-display); font-size: 17px; font-weight: 600; letter-spacing: -0.01em; color: var(--color-ink); line-height: 1.1; }
.tpl-card__desc { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }
.tpl-card__pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; flex-shrink: 0; }
.tpl-card__pill--custom  { background: #DCFCE7; color: #14532D; }
.tpl-card__pill--default { background: var(--color-surface); color: var(--color-fog); }
.tpl-card__pill-dot { width: 5px; height: 5px; border-radius: 999px; background: currentColor; }
.tpl-card__subject { font-family: var(--font-mono); font-size: 12px; color: var(--color-ink); background: var(--color-surface); padding: 8px 10px; border-radius: 8px; line-height: 1.4; display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; overflow: hidden; }
.tpl-card__subject-prefix { color: var(--color-fog); }
.tpl-card__subject-muted  { color: var(--color-fog); }
.tpl-card__foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }
.tpl-card__count { color: var(--color-ink); font-weight: 500; }
.tpl-card__edit { display: inline-flex; align-items: center; gap: 4px; color: var(--color-accent); font-weight: 600; }

@media (max-width: 1023px) {
  .tpl-wrap { grid-template-columns: 1fr; }
  .tpl-brand { border-left: 0; border-top: 1px solid var(--color-hairline); padding-left: 0; padding-top: 20px; }
  .tpl-grid { grid-template-columns: 1fr; }
}
@media (max-width: 767px) {
  .tpl-idx__head { flex-direction: column; align-items: flex-start; }
  .tpl-idx__title { font-size: 32px; }
  .tpl-mail__head { padding: 18px 20px 14px; }
  .tpl-mail__body { padding: 18px 20px; }
}
</style>
