<script setup lang="ts">
/**
 * Venue spaces — Paper "Pick your patch" design. Editorial header + a
 * grid of hire-able space cards. Each card has a coloured top slab (or
 * photo), badge chip, name, detail rows, hairline, and a price + book
 * CTA at the foot. Owner authors every field.
 */
import { computed, inject, isRef, type Ref } from 'vue'
import {
  BLOCK_CONTEXT_KEY,
  type BlockContext,
  type VenueSpaceItem,
  type VenueSpacesProps,
  type VenueTone,
} from '../types'

const props = withDefaults(defineProps<VenueSpacesProps>(), {
  eyebrow: '',
  heading: 'Pick your patch.',
  ctaLabel: '',
  ctaHref: '',
  spaces: () => [],
})

const ctxRef = inject<Ref<BlockContext> | BlockContext | null>(BLOCK_CONTEXT_KEY, null)
const ctx = computed<BlockContext | null>(() => {
  if (!ctxRef) return null
  return isRef(ctxRef) ? ctxRef.value : ctxRef
})
const brand = computed(() => ctx.value?.brandPrimary ?? '#2563EB')

const TONE_GRADIENTS: Record<VenueTone, string> = {
  accent:    'linear-gradient(160deg, var(--color-accent, #2563EB), var(--color-accent-strong, #1E40AF))',
  ink:       'linear-gradient(160deg, #1f2b36, #0A0A0B)',
  mint:      'linear-gradient(160deg, #22C55E, #14532D)',
  tangerine: 'linear-gradient(160deg, #F97316, #C2410C)',
  violet:    'linear-gradient(160deg, #7C3AED, #4C1D95)',
  sky:       'linear-gradient(160deg, #98D8E8, #4A90A4)',
}
const TONE_ROTATION: VenueTone[] = ['tangerine', 'mint', 'ink', 'violet', 'sky', 'accent']

function slabStyle(space: VenueSpaceItem, index: number): Record<string, string> {
  const out: Record<string, string> = {}
  if (space.imageUrl) {
    out.backgroundImage = `linear-gradient(160deg, rgba(0,0,0,0.05), rgba(0,0,0,0.28)), url("${space.imageUrl}")`
    out.backgroundSize = 'cover'
    out.backgroundPosition = 'center'
  } else {
    const tone = space.tone ?? TONE_ROTATION[index % TONE_ROTATION.length]!
    out.background = TONE_GRADIENTS[tone] ?? TONE_GRADIENTS.tangerine!
  }
  return out
}
</script>

<template>
  <section class="vs" :style="{ '--brand': brand } as any">
    <header class="vs__head">
      <div class="vs__head-copy">
        <div v-if="props.eyebrow" class="vs__eyebrow">
          <span class="vs__eyebrow-dot" />
          <span>{{ props.eyebrow }}</span>
        </div>
        <h2 v-if="props.heading" class="vs__title">{{ props.heading }}</h2>
      </div>
      <a v-if="props.ctaLabel && props.ctaHref" :href="props.ctaHref" class="vs__cta">
        <span>{{ props.ctaLabel }}</span>
        <svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5"/></svg>
      </a>
    </header>

    <ul v-if="props.spaces.length > 0" class="vs__grid">
      <li v-for="(space, i) in props.spaces" :key="space.name + i" class="vs__card">
        <div class="vs__slab" :style="slabStyle(space, i)">
          <span v-if="space.badge" class="vs__badge">{{ space.badge }}</span>
        </div>
        <div class="vs__body">
          <h3 class="vs__name">{{ space.name }}</h3>
          <p v-if="space.description" class="vs__desc">{{ space.description }}</p>

          <dl class="vs__facts">
            <div v-if="space.capacity" class="vs__fact">
              <dt>Capacity</dt><dd>{{ space.capacity }}</dd>
            </div>
            <div v-if="space.availability" class="vs__fact">
              <dt>Availability</dt><dd>{{ space.availability }}</dd>
            </div>
            <div v-if="space.included" class="vs__fact">
              <dt>Includes now</dt><dd>{{ space.included }}</dd>
            </div>
          </dl>

          <div v-if="space.price || space.ctaLabel" class="vs__foot">
            <div v-if="space.price" class="vs__price">
              <span class="vs__price-value">{{ space.price }}</span>
              <span v-if="space.priceUnit" class="vs__price-unit">{{ space.priceUnit }}</span>
            </div>
            <a v-if="space.ctaLabel" :href="space.ctaHref || '#'" class="vs__book">
              <span>{{ space.ctaLabel }}</span>
              <svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5"/></svg>
            </a>
          </div>
        </div>
      </li>
    </ul>

    <div v-else class="vs__empty">
      <div class="vs__empty-title">No spaces added yet</div>
      <p>Add hire-able spaces (clubhouse, greens, function room) in the block editor.</p>
    </div>
  </section>
</template>

<style scoped>
.vs {
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
  padding: 96px max(48px, calc((100vw - var(--container-content, 1280px)) / 2));
  box-sizing: border-box;
  background: var(--color-ground);
  color: var(--color-ink);
  display: flex;
  flex-direction: column;
  gap: 48px;
}

.vs__head { display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; padding-bottom: 24px; border-bottom: 1px solid var(--color-hairline); }
.vs__head-copy { display: flex; flex-direction: column; gap: 12px; }
.vs__eyebrow { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.08em; color: var(--color-fog); text-transform: uppercase; }
.vs__eyebrow-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--brand); }
.vs__title { font-family: var(--font-display); font-size: clamp(40px, 6vw, 72px); font-weight: 700; line-height: 1; letter-spacing: -0.02em; margin: 0; }
.vs__cta { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; text-decoration: none; white-space: nowrap; }
.vs__cta:hover { color: var(--color-ink); }

.vs__grid { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }

.vs__card { display: flex; flex-direction: column; background: #fff; border: 1px solid var(--color-hairline); border-radius: 20px; overflow: hidden; }
.vs__slab { position: relative; aspect-ratio: 4 / 3; padding: 20px; display: flex; align-items: flex-start; justify-content: flex-end; }
.vs__badge { padding: 6px 12px; background: #fff; color: var(--color-ink); border-radius: 999px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }

.vs__body { display: flex; flex-direction: column; gap: 16px; padding: 24px; }
.vs__name { font-family: var(--font-display); font-size: 24px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: 0; }
.vs__desc { font-family: var(--font-body); font-size: 14px; line-height: 150%; color: var(--color-graphite); margin: -4px 0 0; }

.vs__facts { display: flex; flex-direction: column; margin: 0; }
.vs__fact { display: grid; grid-template-columns: 120px 1fr; gap: 12px; padding: 8px 0; border-top: 1px solid var(--color-hairline); align-items: baseline; }
.vs__fact:first-child { border-top: 0; padding-top: 0; }
.vs__fact dt { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.12em; color: var(--color-fog); text-transform: uppercase; margin: 0; }
.vs__fact dd { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); margin: 0; }

.vs__foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 16px; border-top: 1px solid var(--color-hairline); flex-wrap: wrap; }
.vs__price { display: flex; align-items: baseline; gap: 6px; }
.vs__price-value { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); }
.vs__price-unit { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.vs__book { display: inline-flex; align-items: center; gap: 6px; padding: 10px 18px; background: var(--color-ink); color: #fff; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; text-decoration: none; transition: background 120ms; }
.vs__book:hover { background: var(--color-graphite); }

.vs__empty { padding: 48px; text-align: center; background: var(--color-surface); border: 1px dashed var(--color-hairline); border-radius: 16px; font-family: var(--font-body); color: var(--color-fog); }
.vs__empty-title { font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-ink); margin-bottom: 6px; }
.vs__empty p { margin: 0; }

@media (max-width: 1023px) {
  .vs__head { flex-direction: column; align-items: stretch; }
  .vs__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 599px) {
  .vs__grid { grid-template-columns: 1fr; }
}
</style>
