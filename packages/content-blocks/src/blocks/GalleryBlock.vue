<script setup lang="ts">
/**
 * Gallery — the Paper "Some Fridays we photograph" block. Editorial
 * header (eyebrow + big heading + right-aligned link) plus a grid of
 * photo tiles with a mono pill caption tucked bottom-left of each tile.
 * Tiles can be marked `wide` (span 2 columns) or `tall` (span 2 rows)
 * to break the grid rhythm — matches the masonry-ish feel in the design.
 */
import { computed, inject, isRef, type Ref } from 'vue'
import {
  BLOCK_CONTEXT_KEY,
  type BlockContext,
  type GalleryImage,
  type GalleryProps,
  type PeopleGridTone,
} from '../types'

const props = withDefaults(defineProps<GalleryProps>(), {
  eyebrow: '',
  heading: '',
  ctaLabel: '',
  ctaHref: '',
  images: () => [],
})

const ctxRef = inject<Ref<BlockContext> | BlockContext | null>(BLOCK_CONTEXT_KEY, null)
const ctx = computed<BlockContext | null>(() => {
  if (!ctxRef) return null
  return isRef(ctxRef) ? ctxRef.value : ctxRef
})
const brand = computed(() => ctx.value?.brandPrimary ?? '#2563EB')

/** Preview colours for tiles without images — matches the CRM palette. */
const TONE_MAP: Record<PeopleGridTone, string> = {
  accent:    'linear-gradient(160deg, var(--color-accent, #2563EB), var(--color-accent-strong, #1E40AF))',
  ink:       'linear-gradient(160deg, #1f2b36, #0A0A0B)',
  mint:      'linear-gradient(160deg, #16A34A, #14532D)',
  tangerine: 'linear-gradient(160deg, #F97316, #C2410C)',
  violet:    'linear-gradient(160deg, #7C3AED, #4C1D95)',
  sky:       'linear-gradient(160deg, #98D8E8, #4A90A4)',
}
const TONE_KEYS: PeopleGridTone[] = ['sky', 'tangerine', 'accent', 'ink', 'mint', 'violet']

function tileStyle(img: GalleryImage, index: number): Record<string, string> {
  const styles: Record<string, string> = {}
  if (img.url) {
    styles.backgroundImage = `url("${img.url}")`
    styles.backgroundSize = 'cover'
    styles.backgroundPosition = 'center'
  } else {
    const tone = img.tone ?? TONE_KEYS[index % TONE_KEYS.length]!
    styles.background = TONE_MAP[tone] ?? TONE_MAP.accent!
  }
  return styles
}
</script>

<template>
  <section class="gal" :style="{ '--brand': brand } as any">
    <header class="gal__head">
      <div class="gal__head-copy">
        <div v-if="props.eyebrow" class="gal__eyebrow">
          <span class="gal__eyebrow-dot" />
          <span>{{ props.eyebrow }}</span>
        </div>
        <h2 v-if="props.heading" class="gal__title">{{ props.heading }}</h2>
      </div>
      <a
        v-if="props.ctaLabel && props.ctaHref"
        :href="props.ctaHref"
        class="gal__cta"
      >
        <span>{{ props.ctaLabel }}</span>
        <svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 10h12M11 5l5 5-5 5" />
        </svg>
      </a>
    </header>

    <ul v-if="props.images.length > 0" class="gal__grid">
      <li
        v-for="(img, i) in props.images"
        :key="i"
        class="gal__tile"
        :class="{ 'gal__tile--wide': img.wide, 'gal__tile--tall': img.tall }"
        :style="tileStyle(img, i)"
      >
        <span v-if="img.alt && !img.url" class="gal__alt-sr">{{ img.alt }}</span>
        <span v-if="img.caption" class="gal__caption">{{ img.caption }}</span>
      </li>
    </ul>

    <div v-else class="gal__empty">
      <div class="gal__empty-title">No images yet</div>
      <p>Add photos in the block editor. Each tile takes a caption pill and can be flagged as a wide or tall feature.</p>
    </div>
  </section>
</template>

<style scoped>
.gal {
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

/* Head */
.gal__head { display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; padding-bottom: 24px; border-bottom: 1px solid var(--color-hairline); }
.gal__head-copy { display: flex; flex-direction: column; gap: 12px; }
.gal__eyebrow { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.08em; color: var(--color-fog); text-transform: uppercase; }
.gal__eyebrow-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--brand); flex-shrink: 0; }
.gal__title { font-family: var(--font-display); font-size: clamp(40px, 6vw, 72px); font-weight: 700; line-height: 1; letter-spacing: -0.02em; color: var(--color-ink); margin: 0; }
.gal__cta { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); text-decoration: none; padding-bottom: 6px; border-bottom: 1px solid var(--color-ink); flex-shrink: 0; white-space: nowrap; }
.gal__cta:hover { color: var(--brand); border-color: var(--brand); }

/* Grid — 3 columns with 220px min rows. Wide tiles span 2 columns, tall
   tiles span 2 rows; both flag together = huge feature. */
.gal__grid { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: 220px; gap: 16px; }
.gal__tile { position: relative; border-radius: 14px; overflow: hidden; background: var(--color-surface); }
.gal__tile--wide { grid-column: span 2; }
.gal__tile--tall { grid-row: span 2; }

.gal__caption {
  position: absolute;
  left: 16px;
  bottom: 16px;
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  background: var(--color-ink);
  color: #fff;
  border-radius: 8px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.gal__alt-sr { position: absolute; left: -9999px; }

.gal__empty { padding: 48px; text-align: center; background: var(--color-surface); border: 1px dashed var(--color-hairline); border-radius: 16px; font-family: var(--font-body); color: var(--color-fog); }
.gal__empty-title { font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-ink); margin-bottom: 6px; }
.gal__empty p { margin: 0; max-width: 380px; margin-left: auto; margin-right: auto; }

@media (max-width: 1023px) {
  .gal { gap: 32px; }
  .gal__head { flex-direction: column; align-items: stretch; gap: 16px; }
  .gal__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 200px; }
  .gal__tile--wide { grid-column: span 2; }
}
@media (max-width: 599px) {
  .gal__grid { grid-template-columns: 1fr; grid-auto-rows: 180px; }
  .gal__tile--wide, .gal__tile--tall { grid-column: auto; grid-row: auto; }
}
</style>
