<script setup lang="ts">
/**
 * Site-wide colour-scheme picker. Fetches the curated palettes from
 * GET /color-schemes on mount and PATCHes the club when the user picks
 * one. Each card renders a mini stack of the ground / surface / hairline
 * swatches plus the ink colour so the palette is legible at a glance.
 *
 * Persists into the club store via `setColorScheme` so a refresh keeps
 * the selection without a second fetch. Structural twin of StylePicker.
 */
import { computed, onMounted, ref, watch } from 'vue'
import {
  ApiError,
  colorSchemes,
  type ColorScheme,
  type ClubColorScheme,
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
const schemes = ref<ColorScheme[]>([])
const defaultSlug = ref<string>('clean-white')
const loading = ref(true)
const saving = ref<string | null>(null)

const localSlug = ref<string | null>(props.currentSlug ?? null)

watch(() => props.currentSlug, (v) => {
  if (saving.value === null) localSlug.value = v ?? null
})

const effectiveSlug = computed(() => localSlug.value ?? defaultSlug.value)

function schemeToClubColorScheme(scheme: ColorScheme): ClubColorScheme {
  return { slug: scheme.slug, tokens: scheme.tokens }
}

async function loadSchemes() {
  loading.value = true
  try {
    const res = await colorSchemes.list()
    schemes.value = res.schemes
    defaultSlug.value = res.default_slug
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Could not load colour schemes'
    toast.error(msg || 'Could not load colour schemes')
  } finally {
    // Backfill the store on first mount if the parent passed a slug but the
    // store hasn't hydrated it yet.
    if (props.clubId && props.currentSlug && !clubStore.current?.colorScheme) {
      const match = schemes.value.find((s) => s.slug === props.currentSlug)
      if (match) clubStore.setColorScheme(schemeToClubColorScheme(match))
    }
    loading.value = false
  }
}

function applyLocal(slug: string | null) {
  const target = slug ?? defaultSlug.value
  const applied = schemes.value.find((s) => s.slug === target)
  if (applied) clubStore.setColorScheme(schemeToClubColorScheme(applied))
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
  const applied = applyLocal(slug)
  try {
    await colorSchemes.updateForClub(props.clubId, slug)
    emit('update:slug', slug)
    toast.success(`Palette set to ${applied?.name ?? slug}.`)
  } catch (err) {
    localSlug.value = previous
    applyLocal(previous)
    const msg = err instanceof ApiError ? err.message : 'Could not save colour scheme'
    toast.error(msg || 'Could not save colour scheme')
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
    await colorSchemes.updateForClub(props.clubId, null)
    emit('update:slug', null)
    toast.success('Palette reset to default.')
  } catch (err) {
    localSlug.value = previous
    applyLocal(previous)
    const msg = err instanceof ApiError ? err.message : 'Could not reset palette'
    toast.error(msg || 'Could not reset palette')
  } finally {
    saving.value = null
  }
}

onMounted(loadSchemes)
</script>

<template>
  <div class="cs">
    <div class="cs__header">
      <div class="cs__hint">
        Sets the surface, hairline, and text colours used site-wide. Applies to every block on your public site.
      </div>
      <button
        v-if="localSlug !== null"
        type="button"
        class="cs__reset"
        :disabled="saving !== null"
        @click="resetToDefault"
      >↺ Reset to default</button>
    </div>

    <div v-if="loading" class="cs__loading">Loading palettes…</div>

    <div v-else class="cs__grid">
      <button
        v-for="scheme in schemes"
        :key="scheme.slug"
        type="button"
        class="cs__card"
        :class="{
          'cs__card--active': effectiveSlug === scheme.slug,
          'cs__card--saving': saving === scheme.slug,
        }"
        :disabled="saving !== null"
        @click="pick(scheme.slug)"
      >
        <div class="cs__card-head">
          <div class="cs__card-name">{{ scheme.name }}</div>
          <div v-if="effectiveSlug === scheme.slug" class="cs__badge">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span>{{ localSlug === null ? 'Default' : 'Selected' }}</span>
          </div>
        </div>

        <div
          class="cs__preview"
          :style="{ background: scheme.tokens.ground, border: `1px solid ${scheme.tokens.hairline}` }"
        >
          <div
            class="cs__preview-panel"
            :style="{ background: scheme.tokens.surface, border: `1px solid ${scheme.tokens.hairline}` }"
          >
            <div class="cs__preview-line cs__preview-line--wide" :style="{ background: scheme.tokens.ink }" />
            <div class="cs__preview-line" :style="{ background: scheme.tokens.graphite }" />
            <div class="cs__preview-line cs__preview-line--narrow" :style="{ background: scheme.tokens.fog }" />
          </div>
          <div class="cs__swatches">
            <span class="cs__swatch" :style="{ background: scheme.tokens.ink }" title="Ink" />
            <span class="cs__swatch" :style="{ background: scheme.tokens.graphite }" title="Graphite" />
            <span class="cs__swatch" :style="{ background: scheme.tokens.fog }" title="Fog" />
            <span class="cs__swatch" :style="{ background: scheme.tokens.mute }" title="Mute" />
          </div>
        </div>

        <div class="cs__card-desc">{{ scheme.description }}</div>
      </button>
    </div>
  </div>
</template>

<style scoped>
.cs { display: flex; flex-direction: column; gap: 16px; }
.cs__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.cs__hint {
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
  margin-top: 4px;
  max-width: 480px;
  line-height: 145%;
}

.cs__reset {
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
.cs__reset:hover:not(:disabled) { color: var(--color-ink); border-color: var(--color-ink); background: var(--color-surface); }
.cs__reset:disabled { opacity: 0.5; cursor: not-allowed; }

.cs__loading {
  padding: 40px 20px;
  text-align: center;
  color: var(--color-fog);
  font-family: var(--font-body);
  font-size: 13px;
}

.cs__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 1023px) { .cs__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 639px)  { .cs__grid { grid-template-columns: 1fr; } }

.cs__card {
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
.cs__card:hover:not(:disabled) {
  border-color: var(--color-ink);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
  transform: translateY(-1px);
}
.cs__card:active { transform: translateY(0); }
.cs__card:disabled { cursor: default; opacity: 0.7; }
.cs__card--active { border-color: var(--color-ink); box-shadow: 0 0 0 2px var(--color-ink) inset; }
.cs__card--saving { opacity: 0.65; }

.cs__card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.cs__card-name {
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 600;
  color: var(--color-ink);
}

.cs__badge {
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

.cs__preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 8px;
}

.cs__preview-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border-radius: 6px;
}
.cs__preview-line { height: 4px; border-radius: 3px; opacity: 0.9; }
.cs__preview-line--wide { width: 80%; }
.cs__preview-line--narrow { width: 40%; opacity: 0.7; }

.cs__swatches { display: flex; gap: 6px; }
.cs__swatch {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08) inset;
}

.cs__card-desc {
  font-family: var(--font-body);
  font-size: 12px;
  line-height: 145%;
  color: var(--color-fog);
}
</style>
