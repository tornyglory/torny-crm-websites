<script setup lang="ts">
import type { HeroProps } from '../types'
defineProps<HeroProps>()
</script>

<template>
  <section class="hero">
    <div class="hero__inner">
      <h1 class="hero__heading">{{ heading }}</h1>
      <p v-if="subheading" class="hero__sub">{{ subheading }}</p>
      <div v-if="primaryCta || secondaryCta" class="hero__ctas">
        <a v-if="primaryCta" :href="primaryCta.href" class="btn btn--primary">{{ primaryCta.label }}</a>
        <a v-if="secondaryCta" :href="secondaryCta.href" class="btn btn--ghost">{{ secondaryCta.label }}</a>
      </div>
    </div>
    <img v-if="imageUrl" :src="imageUrl" alt="" class="hero__image" />
  </section>
</template>

<style scoped>
.hero { position: relative; padding: 64px 40px; background: var(--color-ink); color: var(--color-white); overflow: hidden; border-radius: var(--radius-lg); }
.hero__inner { max-width: 640px; position: relative; z-index: 1; }
.hero__heading { font-family: var(--font-display); font-size: 48px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 12px; }
.hero__sub { font-family: var(--font-body); font-size: 18px; opacity: 0.8; margin: 0 0 24px; }
.hero__ctas { display: flex; gap: 12px; }
.hero__image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.25; z-index: 0; }
.btn { display: inline-block; padding: 10px 18px; border-radius: var(--radius-full); font-family: var(--font-body); font-size: 14px; font-weight: 600; text-decoration: none; }
.btn--primary { background: var(--color-accent); color: var(--color-white); }
.btn--ghost { background: transparent; color: var(--color-white); border: 1px solid rgba(255,255,255,0.3); }
</style>
