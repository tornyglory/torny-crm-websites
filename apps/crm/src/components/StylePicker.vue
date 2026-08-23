<script setup lang="ts">
/**
 * Site-wide style-preset picker. Fetches the curated presets from
 * GET /style-presets on mount and PATCHes the club when the user picks
 * one. Each card renders a live preview using its own radii, card
 * treatment, and button radius — so the tradeoffs are visible at a glance.
 *
 * Persists into the club store via `setStyle` so a page refresh reads
 * the right selection without hitting the network again.
 */
import { computed, onMounted, ref, watch } from 'vue'
import {
  ApiError,
  stylePresets,
  type ClubStyle,
  type StyleCardBackground,
  type StyleCardBorder,
  type StyleCardShadow,
  type StylePreset,
} from '@torny/api-client'
import { useClubStore } from '@/stores/club'
import { useToast } from '@/composables/useToast'

const props = defineProps<{
  clubId: number | null | undefined
  /** Slug currently stored on the club. Null = platform default. */
  currentSlug: string | null | undefined
}>()

const emit = defineEmits<{
  (e: 'update:slug', value: string | null): void
}>()

const toast = useToast()
const clubStore = useClubStore()
const presets = ref<StylePreset[]>([])
const defaultSlug = ref<string>('editorial')
const loading = ref(true)
const saving = ref<string | null>(null)
// True when we're using the local fallback because the backend endpoint
// isn't live yet — PATCH won't persist, so we quiet the error toast.
const usingLocalFallback = ref(false)

// Frontend mirror of the shape in brief 23. Used as a fallback while the
// backend endpoints are being built out — once /style-presets ships, the
// live list replaces this and everything else keeps working.
const FALLBACK_PRESETS: StylePreset[] = [
  {
    slug: 'editorial', name: 'Editorial',
    description: 'Clean bordered cards with pill buttons. The Paper default.',
    radius: { xs: 4, sm: 8, md: 12, lg: 20, pill: 999 },
    cards: { background: 'surface', border: 'hairline', shadow: 'none' },
    buttons: { radius: 999 },
    is_default: true,
  },
  {
    slug: 'sharp', name: 'Sharp',
    description: 'Zero radii, tight architectural feel. Great for magazine-style clubs.',
    radius: { xs: 0, sm: 0, md: 0, lg: 0, pill: 4 },
    cards: { background: 'ground', border: 'hairline', shadow: 'none' },
    buttons: { radius: 4 },
  },
  {
    slug: 'soft', name: 'Soft',
    description: 'Gently rounded surfaces, pill buttons — the friendly middle ground.',
    radius: { xs: 6, sm: 12, md: 16, lg: 24, pill: 999 },
    cards: { background: 'surface', border: 'none', shadow: 'none' },
    buttons: { radius: 999 },
  },
  {
    slug: 'rounded', name: 'Rounded',
    description: 'Round cards and pills all the way. Warm, community, playful.',
    radius: { xs: 12, sm: 16, md: 24, lg: 32, pill: 999 },
    cards: { background: 'surface', border: 'none', shadow: 'soft' },
    buttons: { radius: 999 },
  },
  {
    slug: 'classic', name: 'Classic',
    description: 'Subtle radii and a soft card shadow. Traditional print feel.',
    radius: { xs: 2, sm: 4, md: 6, lg: 14, pill: 999 },
    cards: { background: 'ground', border: 'none', shadow: 'soft' },
    buttons: { radius: 6 },
  },
]

const localSlug = ref<string | null>(props.currentSlug ?? null)

watch(() => props.currentSlug, (v) => {
  if (saving.value === null) localSlug.value = v ?? null
})

const effectiveSlug = computed(() => localSlug.value ?? defaultSlug.value)

function presetToClubStyle(preset: StylePreset): ClubStyle {
  return {
    slug: preset.slug,
    radius: preset.radius,
    cards: preset.cards,
    buttons: preset.buttons,
  }
}

async function loadPresets() {
  loading.value = true
  try {
    const res = await stylePresets.list()
    if (!res.presets || res.presets.length === 0) {
      // Backend responded but with no presets yet — fall back silently.
      presets.value = FALLBACK_PRESETS
      defaultSlug.value = 'editorial'
      usingLocalFallback.value = true
    } else {
      presets.value = res.presets
      defaultSlug.value = res.default_slug
      usingLocalFallback.value = false
    }
  } catch {
    // Endpoint likely not shipped yet — fall back to the shape from brief 23.
    // No toast; this is expected until the backend catches up.
    presets.value = FALLBACK_PRESETS
    defaultSlug.value = 'editorial'
    usingLocalFallback.value = true
  } finally {
    // Backfill the store on first mount if the parent passed a slug but the
    // store hasn't hydrated style yet.
    if (props.clubId && props.currentSlug && !clubStore.current?.style) {
      const match = presets.value.find((p) => p.slug === props.currentSlug)
      if (match) clubStore.setStyle(presetToClubStyle(match))
    }
    loading.value = false
  }
}

function applyLocal(slug: string | null) {
  const target = slug ?? defaultSlug.value
  const applied = presets.value.find((p) => p.slug === target)
  if (applied) clubStore.setStyle(presetToClubStyle(applied))
  return applied
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
  // Apply locally straight away so the CRM preview updates.
  const applied = applyLocal(slug)
  try {
    await stylePresets.updateForClub(props.clubId, slug)
    emit('update:slug', slug)
    toast.success(`Style set to ${applied?.name ?? slug}.`)
  } catch (err) {
    if (usingLocalFallback.value) {
      // Endpoint isn't shipped yet — keep the local application, no rollback.
      emit('update:slug', slug)
      toast.info(`Style set to ${applied?.name ?? slug} (local preview only).`)
    } else {
      localSlug.value = previous
      applyLocal(previous)
      const msg = err instanceof ApiError ? err.message : 'Could not save style'
      toast.error(msg || 'Could not save style')
    }
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
  applyLocal(null)
  try {
    await stylePresets.updateForClub(props.clubId, null)
    emit('update:slug', null)
    toast.success('Style reset to default.')
  } catch (err) {
    if (usingLocalFallback.value) {
      emit('update:slug', null)
      toast.info('Style reset to default (local preview only).')
    } else {
      localSlug.value = previous
      applyLocal(previous)
      const msg = err instanceof ApiError ? err.message : 'Could not reset style'
      toast.error(msg || 'Could not reset style')
    }
  } finally {
    saving.value = null
  }
}

onMounted(loadPresets)

// ── Preview helpers — translate token slugs into concrete CSS values ──
function cardBg(bg: StyleCardBackground): string {
  return bg === 'ground' ? 'var(--color-ground, #fff)' : 'var(--color-surface, #F5F5F2)'
}
function cardBorder(border: StyleCardBorder): string {
  return border === 'hairline' ? '1px solid var(--color-hairline, #E7E7E1)' : '1px solid transparent'
}
function cardShadow(shadow: StyleCardShadow): string {
  return shadow === 'soft' ? '0 6px 16px -6px rgba(15, 23, 42, 0.15)' : 'none'
}

function previewCardStyle(preset: StylePreset) {
  return {
    borderRadius: `${preset.radius.md}px`,
    background: cardBg(preset.cards.background),
    border: cardBorder(preset.cards.border),
    boxShadow: cardShadow(preset.cards.shadow),
  }
}
function previewButtonStyle(preset: StylePreset) {
  return { borderRadius: `${preset.buttons.radius}px` }
}
function previewImageStyle(preset: StylePreset) {
  return { borderRadius: `${preset.radius.lg}px` }
}
</script>

<template>
  <div class="sp">
    <div class="sp__header">
      <div class="sp__hint">
        Sets the border radius and card treatment for every block on your public site.
      </div>
      <button
        v-if="localSlug !== null"
        type="button"
        class="sp__reset"
        :disabled="saving !== null"
        @click="resetToDefault"
      >↺ Reset to default</button>
    </div>

    <div v-if="loading" class="sp__loading">Loading styles…</div>

    <div v-else class="sp__grid">
      <button
        v-for="preset in presets"
        :key="preset.slug"
        type="button"
        class="sp__card"
        :class="{
          'sp__card--active': effectiveSlug === preset.slug,
          'sp__card--saving': saving === preset.slug,
        }"
        :disabled="saving !== null"
        @click="pick(preset.slug)"
      >
        <div class="sp__card-head">
          <div class="sp__card-name">{{ preset.name }}</div>
          <div v-if="effectiveSlug === preset.slug" class="sp__badge">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span>{{ localSlug === null ? 'Default' : 'Selected' }}</span>
          </div>
        </div>

        <div class="sp__preview">
          <div class="sp__preview-inner" :style="previewCardStyle(preset)">
            <div class="sp__preview-image" :style="previewImageStyle(preset)" />
            <div class="sp__preview-line sp__preview-line--wide" />
            <div class="sp__preview-line" />
            <div class="sp__preview-btn" :style="previewButtonStyle(preset)">Join the club</div>
          </div>
        </div>

        <div class="sp__card-desc">{{ preset.description }}</div>
      </button>
    </div>
  </div>
</template>

<style scoped>
.sp { display: flex; flex-direction: column; gap: 16px; }
.sp__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.sp__eyebrow {
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.sp__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 4px; max-width: 480px; line-height: 145%; }

.sp__reset {
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
.sp__reset:hover:not(:disabled) { color: var(--color-ink); border-color: var(--color-ink); background: var(--color-surface); }
.sp__reset:disabled { opacity: 0.5; cursor: not-allowed; }

.sp__loading {
  padding: 40px 20px;
  text-align: center;
  color: var(--color-fog);
  font-family: var(--font-body);
  font-size: 13px;
}

.sp__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 1023px) { .sp__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 639px)  { .sp__grid { grid-template-columns: 1fr; } }

.sp__card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}
.sp__card:hover:not(:disabled) {
  border-color: var(--color-ink);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
  transform: translateY(-1px);
}
.sp__card:active { transform: translateY(0); }
.sp__card:disabled { cursor: default; opacity: 0.7; }
.sp__card--active { border-color: var(--color-ink); box-shadow: 0 0 0 2px var(--color-ink) inset; }
.sp__card--saving { opacity: 0.65; }

.sp__card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sp__card-name {
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 600;
  color: var(--color-ink);
}

.sp__badge {
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

.sp__preview {
  padding: 12px;
  background: var(--color-surface);
  border-radius: 8px;
}

.sp__preview-inner {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
}

.sp__preview-image {
  aspect-ratio: 16 / 9;
  background: linear-gradient(160deg, #B0E0E6 0%, #4A90A4 100%);
}

.sp__preview-line {
  height: 4px;
  background: var(--color-ink);
  border-radius: 3px;
  width: 50%;
  opacity: 0.85;
}
.sp__preview-line--wide { width: 80%; }

.sp__preview-btn {
  align-self: flex-start;
  padding: 6px 12px;
  background: var(--color-ink);
  color: #fff;
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 600;
  margin-top: 4px;
}

.sp__card-desc {
  font-family: var(--font-body);
  font-size: 12px;
  line-height: 145%;
  color: var(--color-fog);
}
</style>
