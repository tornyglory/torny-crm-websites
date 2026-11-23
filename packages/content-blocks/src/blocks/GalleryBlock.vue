<script setup lang="ts">
/**
 * Gallery — the Paper "Some Fridays we photograph" block. Editorial
 * header (eyebrow + big heading + right-aligned link) plus a grid of
 * photo tiles with a mono pill caption tucked bottom-left of each tile.
 * Tiles can be marked `wide` (span 2 columns) or `tall` (span 2 rows)
 * to break the grid rhythm — matches the masonry-ish feel in the design.
 */
import { computed, inject, isRef, onBeforeUnmount, ref, watch, type Ref } from 'vue'
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

/** Split tile background: image goes on --tile-image (consumed by
 *  .gal__tile::before so the image-style filter can run on just that
 *  layer); gradient fallback stays on the element. Brief 79. */
function tileStyle(img: GalleryImage, index: number): Record<string, string> {
  const styles: Record<string, string> = {}
  if (img.url) {
    styles['--tile-image'] = `url("${img.url}")`
  } else {
    const tone = img.tone ?? TONE_KEYS[index % TONE_KEYS.length]!
    styles.background = TONE_MAP[tone] ?? TONE_MAP.accent!
  }
  return styles
}

/** Only tiles with a real URL participate in the lightbox — placeholder
 *  coloured tiles stay static. Carries the original array index so
 *  prev/next can skip URL-less tiles cleanly. */
const lightboxable = computed(() =>
  props.images
    .map((img, index) => ({ img, index }))
    .filter((entry) => Boolean(entry.img.url)),
)

const openIndex = ref<number | null>(null)
const activeImage = computed<GalleryImage | null>(() => {
  const i = openIndex.value
  if (i === null) return null
  return props.images[i] ?? null
})
const activePosition = computed(() => {
  const i = openIndex.value
  if (i === null) return { current: 0, total: 0 }
  const pos = lightboxable.value.findIndex((entry) => entry.index === i)
  return { current: pos + 1, total: lightboxable.value.length }
})

function openAt(index: number): void {
  if (!props.images[index]?.url) return
  openIndex.value = index
}
function close(): void {
  openIndex.value = null
}
function step(direction: 1 | -1): void {
  const list = lightboxable.value
  if (list.length === 0 || openIndex.value === null) return
  const currentPos = list.findIndex((entry) => entry.index === openIndex.value)
  if (currentPos < 0) return
  const nextPos = (currentPos + direction + list.length) % list.length
  openIndex.value = list[nextPos]!.index
}

function onKeydown(event: KeyboardEvent): void {
  if (openIndex.value === null) return
  if (event.key === 'Escape') { event.preventDefault(); close() }
  else if (event.key === 'ArrowRight') { event.preventDefault(); step(1) }
  else if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1) }
}

/** Lock body scroll while the overlay is open so wheel / touch input
 *  doesn't scroll the page behind the backdrop. */
watch(openIndex, (next, prev) => {
  if (typeof document === 'undefined') return
  const wasOpen = prev !== null
  const isOpen = next !== null
  if (isOpen && !wasOpen) {
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeydown)
  } else if (!isOpen && wasOpen) {
    document.body.style.overflow = ''
    window.removeEventListener('keydown', onKeydown)
  }
})

onBeforeUnmount(() => {
  if (typeof document !== 'undefined' && openIndex.value !== null) {
    document.body.style.overflow = ''
    window.removeEventListener('keydown', onKeydown)
  }
})

function onTileKey(event: KeyboardEvent, index: number): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    openAt(index)
  }
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
        <h2 v-if="props.heading" class="gal__title" :data-sh="props.headingSize">{{ props.heading }}</h2>
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
        :class="{
          'gal__tile--wide': img.wide,
          'gal__tile--tall': img.tall,
          'gal__tile--clickable': Boolean(img.url),
        }"
        :style="tileStyle(img, i)"
        :role="img.url ? 'button' : undefined"
        :tabindex="img.url ? 0 : undefined"
        :aria-label="img.url ? (img.alt || img.caption || 'Open image') : undefined"
        @click="img.url && openAt(i)"
        @keydown="img.url && onTileKey($event, i)"
      >
        <span v-if="img.alt && !img.url" class="gal__alt-sr">{{ img.alt }}</span>
        <span v-if="img.caption" class="gal__caption">{{ img.caption }}</span>
      </li>
    </ul>

    <div v-else class="gal__empty">
      <div class="gal__empty-title">No images yet</div>
      <p>Add photos in the block editor. Each tile takes a caption pill and can be flagged as a wide or tall feature.</p>
    </div>

    <Teleport v-if="activeImage" to="body">
      <div
        class="gal-lightbox"
        role="dialog"
        aria-modal="true"
        :aria-label="activeImage.alt || activeImage.caption || 'Gallery image'"
        @click.self="close"
      >
        <button
          type="button"
          class="gal-lightbox__close"
          aria-label="Close"
          @click="close"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 6l12 12M6 18L18 6" />
          </svg>
        </button>

        <button
          v-if="lightboxable.length > 1"
          type="button"
          class="gal-lightbox__nav gal-lightbox__nav--prev"
          aria-label="Previous image"
          @click="step(-1)"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>

        <figure class="gal-lightbox__figure" @click.stop>
          <img
            :src="activeImage.url"
            :alt="activeImage.alt || activeImage.caption || ''"
            class="gal-lightbox__img"
          />
          <figcaption v-if="activeImage.caption || lightboxable.length > 1" class="gal-lightbox__caption">
            <span v-if="activeImage.caption">{{ activeImage.caption }}</span>
            <span
              v-if="lightboxable.length > 1"
              class="gal-lightbox__count"
            >{{ activePosition.current }} / {{ activePosition.total }}</span>
          </figcaption>
        </figure>

        <button
          v-if="lightboxable.length > 1"
          type="button"
          class="gal-lightbox__nav gal-lightbox__nav--next"
          aria-label="Next image"
          @click="step(1)"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </Teleport>
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
.gal__title { font-family: var(--font-display); font-size: clamp(40px, 6vw, 72px); font-weight: var(--weight-semibold, 600); line-height: 1; letter-spacing: -0.02em; color: var(--color-ink); margin: 0; }
.gal__cta { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); text-decoration: none; padding-bottom: 6px; border-bottom: 1px solid var(--color-ink); flex-shrink: 0; white-space: nowrap; }
.gal__cta:hover { color: var(--brand); border-color: var(--brand); }

/* Grid — 3 columns with 220px min rows. Wide tiles span 2 columns, tall
   tiles span 2 rows; both flag together = huge feature. */
.gal__grid { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: 220px; gap: 16px; }
.gal__tile { position: relative; border-radius: var(--image-radius-md, 14px); overflow: hidden; background: var(--color-surface); box-shadow: var(--image-ring, none); }
/* Image on a pseudo so --image-filter can run without affecting the
   caption. Brief 79. */
.gal__tile::before {
  content: '';
  position: absolute; inset: 0; z-index: 0;
  background-image: var(--tile-image, none);
  background-size: cover;
  background-position: center;
  filter: var(--image-filter, none);
  pointer-events: none;
}
/* Archive duotone overlay — invisible for Soft + Studio. */
.gal__tile::after {
  content: '';
  position: absolute; inset: 0; z-index: 0;
  background: var(--image-overlay-color, transparent);
  mix-blend-mode: color;
  opacity: var(--image-overlay-opacity, 0);
  pointer-events: none;
}
.gal__tile > * { position: relative; z-index: 1; }
.gal__tile--wide { grid-column: span 2; }
.gal__tile--tall { grid-row: span 2; }

.gal__tile--clickable { cursor: zoom-in; }
.gal__tile--clickable:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 3px;
}
.gal__tile--clickable::before { transition: transform 240ms ease; }
.gal__tile--clickable:hover::before { transform: scale(1.04); }

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

/* Mobile (≤640px) — tighten the 48px desktop gutter so the block
   fills the viewport minus a 24px editorial padding, matching the
   Paper mobile artboards. */
@media (max-width: 640px) {
  .gal { padding-left: 20px; padding-right: 20px; overflow-x: hidden; }
}
</style>

<!-- Lightbox styles live outside the scoped block because the overlay
     is teleported to <body>, which would otherwise strip scoped class
     hashes and leave it unstyled. -->
<style>
.gal-lightbox {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px;
  background: rgba(10, 10, 11, 0.92);
  backdrop-filter: blur(4px);
  animation: gal-lightbox-in 160ms ease-out;
}
@keyframes gal-lightbox-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.gal-lightbox__figure {
  position: relative;
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  max-width: min(1200px, calc(100vw - 160px));
  max-height: calc(100vh - 96px);
}
.gal-lightbox__img {
  display: block;
  max-width: 100%;
  max-height: calc(100vh - 160px);
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.4);
}
.gal-lightbox__caption {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  color: #fff;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.gal-lightbox__count { color: rgba(255, 255, 255, 0.55); }

.gal-lightbox__close,
.gal-lightbox__nav {
  position: absolute;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  border-radius: 999px;
  cursor: pointer;
  transition: background-color 120ms ease, transform 120ms ease;
}
.gal-lightbox__close:hover,
.gal-lightbox__nav:hover { background: rgba(255, 255, 255, 0.14); }
.gal-lightbox__close:focus-visible,
.gal-lightbox__nav:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 3px;
}
.gal-lightbox__close { top: 24px; right: 24px; }
.gal-lightbox__nav--prev { left: 24px; top: 50%; transform: translateY(-50%); }
.gal-lightbox__nav--next { right: 24px; top: 50%; transform: translateY(-50%); }
.gal-lightbox__nav--prev:hover { transform: translateY(-50%) translateX(-2px); }
.gal-lightbox__nav--next:hover { transform: translateY(-50%) translateX(2px); }

@media (max-width: 640px) {
  .gal-lightbox { padding: 16px; }
  .gal-lightbox__figure { max-width: 100vw; max-height: calc(100vh - 48px); }
  .gal-lightbox__img { max-height: calc(100vh - 140px); border-radius: 6px; }
  .gal-lightbox__close { top: 12px; right: 12px; width: 40px; height: 40px; }
  .gal-lightbox__nav { width: 40px; height: 40px; }
  .gal-lightbox__nav--prev { left: 8px; }
  .gal-lightbox__nav--next { right: 8px; }
}
</style>
