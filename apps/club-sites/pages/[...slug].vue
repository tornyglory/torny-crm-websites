<script setup lang="ts">
// Catch-all for CMS-driven custom pages published from the CRM Website Editor.
// Fetches the page's block payload for the current club + path, then renders
// via BlockRenderer.

import { BlockRenderer, type Block } from '@torny/content-blocks'

const route = useRoute()
const club = useClub()

const { data: blocks } = await useAsyncData<Block[]>(
  () => `page:${club.value?.id}:${route.path}`,
  async () => {
    // TODO: fetch from Torny API — /clubs/:id/pages?path=…
    return []
  },
)

useSeoMeta({
  title: () => `${route.params.slug} — ${club.value?.name ?? 'Torny'}`,
})
</script>

<template>
  <div v-if="blocks && blocks.length" class="custom-page">
    <BlockRenderer v-for="block in blocks" :key="block.id" :block="block" />
  </div>
  <div v-else>
    <h1 class="page__heading">Page not found</h1>
    <p class="page__stub">No content yet for {{ route.path }}.</p>
  </div>
</template>

<style scoped>
.custom-page { display: flex; flex-direction: column; gap: 32px; }
.page__heading { font-family: var(--font-display); font-size: 36px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 12px; }
.page__stub { font-family: var(--font-body); color: var(--color-fog); }
</style>
