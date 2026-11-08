<script setup lang="ts">
/**
 * TornyImage — the wrapper every content block uses instead of raw <img>.
 *
 * Reads the design-tokens image-treatment vars that cascade from the
 * club site's <body data-image-style="..."> (brief 79):
 *   --image-radius-sm/md/lg, --image-ring, --image-filter,
 *   --image-scrim, --image-overlay-color/opacity
 *
 * Props:
 * - `size` picks which radius token (sm/md/lg).
 * - `fit` sets object-fit on the <img>. Default 'cover'.
 * - `aspect` enforces a ratio so empty states + placeholders don't
 *   collapse. Default 'auto' (lets the image's natural ratio win).
 * - `loading` = 'eager' for above-the-fold heroes; default 'lazy'.
 * - `scrim` overlays a bottom gradient (for text-over-image heroes).
 * - `rounded` = false strips the radius entirely for cases where the
 *   parent already handles corners (e.g. a wrapper with overflow:hidden).
 *
 * Default slot paints over the image — captions, badges, play buttons.
 * Figure/figcaption pattern so screen readers get sensible structure.
 */
interface Props {
  src: string | null | undefined
  alt: string
  size?: 'sm' | 'md' | 'lg'
  fit?: 'cover' | 'contain'
  aspect?: '16/9' | '4/3' | '3/4' | '1/1' | 'auto'
  loading?: 'lazy' | 'eager'
  scrim?: boolean
  rounded?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  fit: 'cover',
  aspect: 'auto',
  loading: 'lazy',
  scrim: false,
  rounded: true,
})
</script>

<template>
  <figure
    class="ti"
    :data-size="size"
    :data-aspect="aspect"
    :class="{ 'ti--scrim': scrim, 'ti--bare': !rounded, 'ti--empty': !src }"
  >
    <img
      v-if="src"
      class="ti__img"
      :src="src"
      :alt="alt"
      :loading="loading"
      :style="{ objectFit: fit }"
    />
    <div v-else class="ti__placeholder" aria-hidden="true" />
    <div v-if="scrim || $slots.default" class="ti__overlay">
      <slot />
    </div>
  </figure>
</template>

<style scoped>
.ti {
  position: relative;
  margin: 0;
  overflow: hidden;
  border-radius: var(--image-radius-md, 16px);
  box-shadow: var(--image-ring, inset 0 0 0 1px rgba(0, 0, 0, 0.04));
  background: var(--color-surface, #F5F5F2);
  display: block;
  width: 100%;
  height: 100%;
}
.ti[data-size='sm'] { border-radius: var(--image-radius-sm, 10px); }
.ti[data-size='lg'] { border-radius: var(--image-radius-lg, 28px); }

.ti[data-aspect='16/9'] { aspect-ratio: 16 / 9; }
.ti[data-aspect='4/3']  { aspect-ratio: 4 / 3; }
.ti[data-aspect='3/4']  { aspect-ratio: 3 / 4; }
.ti[data-aspect='1/1']  { aspect-ratio: 1 / 1; }

.ti--bare { border-radius: 0; box-shadow: none; }

.ti__img {
  display: block;
  width: 100%;
  height: 100%;
  filter: var(--image-filter, none);
}

.ti__placeholder {
  position: absolute; inset: 0;
  background:
    linear-gradient(135deg,
      color-mix(in oklab, var(--brand, var(--color-accent, #2563EB)) 12%, white) 0%,
      color-mix(in oklab, var(--brand, var(--color-accent, #2563EB)) 4%, white) 100%);
}

/* Archive preset ships --image-overlay-color + --image-overlay-opacity.
   Soft + Studio leave it transparent, so the overlay is invisible. */
.ti::before {
  content: '';
  position: absolute; inset: 0;
  background: var(--image-overlay-color, transparent);
  mix-blend-mode: color;
  opacity: var(--image-overlay-opacity, 0);
  pointer-events: none;
}

/* Scrim overlay for text-over-image heroes. Opt-in per use. */
.ti--scrim::after {
  content: '';
  position: absolute; inset: 0;
  background: var(--image-scrim, linear-gradient(180deg, transparent 40%, rgba(0, 0, 0, 0.55) 100%));
  pointer-events: none;
}

.ti__overlay {
  position: absolute; inset: 0;
  display: flex;
  z-index: 1;
  pointer-events: none;
}
.ti__overlay > * { pointer-events: auto; }
</style>
