<script setup lang="ts">
import type { GalleryProps } from '../types'
defineProps<GalleryProps>()
</script>

<template>
  <section class="gallery">
    <h2 v-if="heading" class="gallery__heading">{{ heading }}</h2>
    <div class="gallery__grid">
      <figure v-for="(img, i) in images" :key="i" class="gallery__item">
        <img :src="img.url" :alt="img.alt ?? ''" />
        <figcaption v-if="img.caption">{{ img.caption }}</figcaption>
      </figure>
    </div>
  </section>
</template>

<style scoped>
.gallery { padding: 32px 0; }
.gallery__heading { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 16px; color: var(--color-ink); }
.gallery__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.gallery__item { margin: 0; }
.gallery__item img { width: 100%; aspect-ratio: 4/3; object-fit: cover; border-radius: var(--radius-md); }
.gallery__item figcaption { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 6px; }
</style>
