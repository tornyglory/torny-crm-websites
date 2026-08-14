<script setup lang="ts">
import type { HonourBoardProps } from '../types'
withDefaults(defineProps<HonourBoardProps>(), { heading: 'Honour board', yearsToShow: 10 })
</script>

<template>
  <section class="hb">
    <h2 v-if="heading" class="hb__heading">{{ heading }}</h2>
    <p class="hb__placeholder">Honour board entries for {{ categorySlug ?? 'all categories' }}, last {{ yearsToShow }} years.</p>
  </section>
</template>

<style scoped>
.hb { padding: 32px 0; }
.hb__heading { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 16px; color: var(--color-ink); }
.hb__placeholder { font-family: var(--font-body); color: var(--color-fog); font-size: 14px; }
</style>
