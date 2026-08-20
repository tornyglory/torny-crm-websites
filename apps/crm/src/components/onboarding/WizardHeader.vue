<script setup lang="ts">
defineProps<{ step: number; title: string; description: string }>()
</script>

<template>
  <header class="wiz-head">
    <div class="wiz-head__eyebrow">Step {{ step }} of 6</div>
    <h1 class="wiz-head__title">{{ title }}</h1>
    <p class="wiz-head__desc">{{ description }}</p>
  </header>
</template>

<style scoped>
.wiz-head { max-width: 640px; margin-bottom: 32px; }
.wiz-head__eyebrow { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; margin-bottom: 12px; }
.wiz-head__title { font-family: var(--font-display); font-size: clamp(28px, 5vw, 44px); font-weight: 500; color: var(--color-ink); letter-spacing: -0.02em; line-height: 1.05; margin: 0 0 12px; }
.wiz-head__desc { font-family: var(--font-body); font-size: 15px; line-height: 1.55; color: var(--color-graphite); margin: 0; max-width: 520px; }

@media (max-width: 640px) {
  .wiz-head { margin-bottom: 24px; }
  .wiz-head__desc { font-size: 14px; }
}
</style>
