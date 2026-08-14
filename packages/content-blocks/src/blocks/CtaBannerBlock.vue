<script setup lang="ts">
import type { CtaBannerProps } from '../types'
withDefaults(defineProps<CtaBannerProps>(), { tone: 'accent' })
</script>

<template>
  <section class="cta" :class="`cta--${tone}`">
    <div class="cta__body">
      <h3 class="cta__heading">{{ heading }}</h3>
      <p v-if="body" class="cta__text">{{ body }}</p>
    </div>
    <a v-if="ctaHref && ctaLabel" :href="ctaHref" class="cta__btn">{{ ctaLabel }}</a>
  </section>
</template>

<style scoped>
.cta { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 24px 28px; border-radius: var(--radius-lg); flex-wrap: wrap; }
.cta--accent { background: var(--color-accent); color: var(--color-white); }
.cta--ink { background: var(--color-ink); color: var(--color-white); }
.cta--surface { background: var(--color-surface); color: var(--color-ink); }
.cta__heading { font-family: var(--font-display); font-size: 20px; font-weight: 600; margin: 0 0 4px; }
.cta__text { font-family: var(--font-body); font-size: 14px; margin: 0; opacity: 0.85; }
.cta__btn { display: inline-block; padding: 10px 18px; background: var(--color-white); color: var(--color-ink); border-radius: var(--radius-full); font-family: var(--font-body); font-size: 13px; font-weight: 600; text-decoration: none; }
.cta--surface .cta__btn { background: var(--color-accent); color: var(--color-white); }
</style>
