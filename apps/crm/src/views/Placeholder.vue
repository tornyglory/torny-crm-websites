<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <div class="placeholder">
    <h1 class="placeholder__heading">{{ title }}</h1>
    <p class="placeholder__body">This view is scaffolded. Content follows the Paper design and hydrates from the Torny API.</p>
  </div>
</template>

<style scoped>
.placeholder { max-width: 720px; }
.placeholder__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 8px; color: var(--color-ink); }
.placeholder__body { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; }
</style>
