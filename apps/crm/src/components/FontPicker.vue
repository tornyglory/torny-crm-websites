<script setup lang="ts">
/**
 * Font pair picker. Fetches the curated pairs from GET /font-pairs on mount,
 * lazy-loads every pair's Google Fonts stylesheet in a single request so the
 * previews are legible immediately, and PATCHes the club when the user picks
 * a card.
 *
 * The parent passes `clubId` + the currently-selected pair slug (or null to
 * fall back to the platform default). We emit `update:slug` with the newly-
 * selected slug (or null after reset), plus toasts on success/failure.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { fontPairs, ApiError, type FontPair, type ClubFonts } from '@torny/api-client'
import { useClubStore } from '@/stores/club'
import { useToast } from '@/composables/useToast'

const props = defineProps<{
  clubId: number | null | undefined
  clubName?: string
  /** Slug currently stored on the club. Null = platform default. */
  currentSlug: string | null | undefined
}>()

const emit = defineEmits<{
  (e: 'update:slug', value: string | null): void
}>()

const toast = useToast()
const clubStore = useClubStore()
const pairs = ref<FontPair[]>([])
const defaultSlug = ref<string>('space-grotesk-inter')
const loading = ref(true)
const saving = ref<string | null>(null)  // slug being saved, for spinner
const previewLoaded = ref(false)

// Optimistic slug — mirrors the store until the PATCH completes.
const localSlug = ref<string | null>(props.currentSlug ?? null)

// Follow the parent as it hydrates (auth stub → hydrateFull → store fonts),
// unless we're mid-save (in which case the optimistic value wins).
watch(() => props.currentSlug, (v) => {
  if (saving.value === null) localSlug.value = v ?? null
})

const effectiveSlug = computed(() => localSlug.value ?? defaultSlug.value)

function pairToClubFonts(pair: FontPair): ClubFonts {
  return {
    slug: pair.slug,
    heading: pair.heading,
    body: pair.body,
    mono: pair.mono,
  }
}

async function loadPairs() {
  loading.value = true
  try {
    const res = await fontPairs.list()
    pairs.value = res.pairs
    defaultSlug.value = res.default_slug
    loadPreviewStylesheet(res.pairs)
    // If the store hasn't hydrated fonts yet but we do have a currentSlug,
    // build the ClubFonts shape now and cache it — so a page refresh keeps
    // the highlight state without needing another round-trip.
    if (props.clubId && props.currentSlug && !clubStore.current?.fonts) {
      const match = res.pairs.find((p) => p.slug === props.currentSlug)
      if (match) clubStore.setFonts(pairToClubFonts(match))
    }
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Could not load fonts'
    toast.error(msg || 'Could not load fonts')
  } finally {
    loading.value = false
  }
}

/**
 * One-time preview stylesheet — joins every pair's heading + body fonts
 * into a single Google Fonts URL so the picker never flashes fallback
 * fonts while the previews render.
 */
function loadPreviewStylesheet(pairs: FontPair[]) {
  if (previewLoaded.value || typeof document === 'undefined') return
  const seen = new Set<string>()
  const families: string[] = []
  for (const p of pairs) {
    for (const font of [p.heading, p.body, p.mono]) {
      if (seen.has(font.family)) continue
      seen.add(font.family)
      const weights = font.weights.join(';')
      families.push(`family=${encodeURIComponent(font.family)}:wght@${weights}`)
    }
  }
  if (families.length === 0) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`
  link.dataset.tornyFontPreview = '1'
  document.head.appendChild(link)
  previewLoaded.value = true
}

async function pick(slug: string) {
  if (!props.clubId) {
    toast.error('No active club — refresh and try again.')
    return
  }
  if (slug === effectiveSlug.value) return
  const previous = localSlug.value
  localSlug.value = slug
  saving.value = slug
  try {
    const res = await fontPairs.updateForClub(props.clubId, slug)
    // Persist the full font pair into the club store so a page refresh
    // reads the right selected state without hitting the network.
    const applied = pairs.value.find((p) => p.slug === res.effective_slug)
    if (applied) clubStore.setFonts(pairToClubFonts(applied))
    emit('update:slug', slug)
    toast.success(`Font pair set to ${applied?.name ?? slug}.`)
  } catch (err) {
    localSlug.value = previous
    const msg = err instanceof ApiError ? err.message : 'Could not save font pair'
    toast.error(msg || 'Could not save font pair')
  } finally {
    saving.value = null
  }
}

async function resetToDefault() {
  if (!props.clubId) return
  if (localSlug.value === null) return
  const previous = localSlug.value
  localSlug.value = null
  saving.value = defaultSlug.value
  try {
    const res = await fontPairs.updateForClub(props.clubId, null)
    // Cache the default pair against the club so refresh still highlights it.
    const applied = pairs.value.find((p) => p.slug === res.effective_slug)
    if (applied) clubStore.setFonts(pairToClubFonts(applied))
    emit('update:slug', null)
    toast.success('Font pair reset to default.')
  } catch (err) {
    localSlug.value = previous
    const msg = err instanceof ApiError ? err.message : 'Could not reset font pair'
    toast.error(msg || 'Could not reset font pair')
  } finally {
    saving.value = null
  }
}

onMounted(loadPairs)

const previewClub = computed(() => props.clubName || 'Your Bowling Club')
</script>

<template>
  <div class="fp">
    <div class="fp__header">
      <div>
        <div class="fp__eyebrow">Font pair</div>
        <div class="fp__hint">
          Applies to every page on your public site. Preview each pair below.
        </div>
      </div>
      <button
        v-if="localSlug !== null"
        type="button"
        class="fp__reset"
        :disabled="saving !== null"
        @click="resetToDefault"
      >↺ Reset to default</button>
    </div>

    <div v-if="loading" class="fp__loading">Loading fonts…</div>

    <div v-else class="fp__grid">
      <button
        v-for="pair in pairs"
        :key="pair.slug"
        type="button"
        class="fp__card"
        :class="{
          'fp__card--active': effectiveSlug === pair.slug,
          'fp__card--saving': saving === pair.slug,
        }"
        :disabled="saving !== null"
        @click="pick(pair.slug)"
      >
        <div class="fp__card-head">
          <div class="fp__card-name">{{ pair.name }}</div>
          <div class="fp__card-fonts">{{ pair.heading.family }} · {{ pair.body.family }}</div>
        </div>

        <div class="fp__preview">
          <div
            class="fp__preview-heading"
            :style="{ fontFamily: `'${pair.heading.family}', system-ui, sans-serif` }"
          >{{ previewClub }}</div>
          <div
            class="fp__preview-body"
            :style="{ fontFamily: `'${pair.body.family}', system-ui, sans-serif` }"
          >{{ pair.description }}</div>
          <div
            class="fp__preview-mono"
            :style="{ fontFamily: `'${pair.mono.family}', ui-monospace, monospace` }"
          >EST. 1953 · HUTT VALLEY</div>
        </div>

        <div v-if="effectiveSlug === pair.slug" class="fp__badge">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>{{ localSlug === null ? 'Default' : 'Selected' }}</span>
        </div>
      </button>
    </div>
  </div>
</template>

<style scoped>
.fp { display: flex; flex-direction: column; gap: 16px; }
.fp__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.fp__eyebrow {
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.fp__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 4px; max-width: 480px; line-height: 145%; }

.fp__reset {
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 500;
  color: var(--color-fog);
  cursor: pointer;
  transition: color 0.12s ease, border-color 0.12s ease, background-color 0.12s ease;
}
.fp__reset:hover:not(:disabled) { color: var(--color-ink); border-color: var(--color-ink); background: var(--color-surface); }
.fp__reset:disabled { opacity: 0.5; cursor: not-allowed; }

.fp__loading {
  padding: 40px 20px;
  text-align: center;
  color: var(--color-fog);
  font-family: var(--font-body);
  font-size: 13px;
}

.fp__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 1023px) { .fp__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 639px)  { .fp__grid { grid-template-columns: 1fr; } }

.fp__card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}
.fp__card:hover:not(:disabled) {
  border-color: var(--color-ink);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
  transform: translateY(-1px);
}
.fp__card:active { transform: translateY(0); }
.fp__card:disabled { cursor: default; opacity: 0.7; }
.fp__card--active {
  border-color: var(--color-ink);
  box-shadow: 0 0 0 2px var(--color-ink) inset;
}
.fp__card--saving { opacity: 0.65; }

.fp__card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.fp__card-name {
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-ink);
}
.fp__card-fonts {
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--color-fog);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex-shrink: 1;
}

.fp__preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  background: var(--color-surface);
  border-radius: 8px;
}
.fp__preview-heading {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.1;
  color: var(--color-ink);
}
.fp__preview-body {
  font-size: 12px;
  line-height: 1.45;
  color: var(--color-graphite);
}
.fp__preview-mono {
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.08em;
  color: var(--color-fog);
}

.fp__badge {
  position: absolute;
  top: 10px;
  right: 10px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: var(--color-ink);
  color: #fff;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 600;
}
</style>
