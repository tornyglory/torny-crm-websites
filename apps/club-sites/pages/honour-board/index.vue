<script setup lang="ts">
import { HonourBoardBlock } from '@torny/content-blocks'
const club = useClub()
useSeoMeta({ title: () => `Honour board — ${club.value?.name ?? 'Torny'}` })
</script>

<template>
  <div>
    <h1 class="page__heading">Honour board</h1>
    <HonourBoardBlock />
  </div>
</template>

<style scoped>
.page__heading { font-family: var(--font-display); font-size: 36px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 24px; }
</style>
