<script setup lang="ts">
import { ContactFormBlock } from '@torny/content-blocks'
const club = useClub()
useSeoMeta({ title: () => `Contact — ${club.value?.name ?? 'Torny'}` })
</script>

<template>
  <div>
    <h1 class="page__heading">Contact</h1>
    <ContactFormBlock />
  </div>
</template>

<style scoped>
.page__heading { font-family: var(--font-display); font-size: 36px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 24px; }
</style>
