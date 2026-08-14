<script setup lang="ts">
import type { MembershipCtaProps } from '../types'
withDefaults(defineProps<MembershipCtaProps>(), { ctaLabel: 'Join the club', ctaHref: '/membership' })
</script>

<template>
  <section class="mc">
    <div class="mc__inner">
      <h2 class="mc__heading">{{ heading }}</h2>
      <p v-if="body" class="mc__body">{{ body }}</p>
      <a :href="ctaHref" class="mc__cta">{{ ctaLabel }}</a>
    </div>
  </section>
</template>

<style scoped>
.mc { padding: 32px 0; }
.mc__inner { background: var(--color-accent-soft); border-radius: var(--radius-lg); padding: 40px; }
.mc__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 12px; color: var(--color-ink); }
.mc__body { font-family: var(--font-body); font-size: 16px; color: var(--color-graphite); margin: 0 0 20px; max-width: 60ch; }
.mc__cta { display: inline-block; padding: 12px 22px; background: var(--color-accent); color: var(--color-white); border-radius: var(--radius-full); font-family: var(--font-body); font-size: 14px; font-weight: 600; text-decoration: none; }
</style>
