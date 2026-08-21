<script setup lang="ts">
/**
 * Renders a public-site page from a CRM-published block layout, or falls
 * back to the calling page's default slot when no layout is published.
 *
 * The CRM's Website editor (brief 16) writes per-page layouts into
 * `site.pages[slug].blocks`. When that map has an entry, we hand each
 * block to `<BlockRenderer>` and provide the shared BlockContext so
 * data-hydrated blocks (`eventList`, `honourBoard`) can render real
 * data. Otherwise the page's hand-written fallback runs.
 *
 * Usage:
 *   <PageRenderer slug="membership">
 *     <template #default>  <!-- fallback template --> </template>
 *   </PageRenderer>
 */
import { BlockRenderer, BLOCK_CONTEXT_KEY, type Block, type BlockContext } from '@torny/content-blocks'
import type { PageSlug } from '~/server/utils/tornyApi'

const props = defineProps<{ slug: PageSlug }>()

const club = useClub()
const { data: site } = await useSite()

const blocks = computed<Block[] | null>(() => {
  const raw = site.value?.pages?.[props.slug]?.blocks
  return raw && raw.length > 0 ? (raw as unknown as Block[]) : null
})

const accent = computed(() => site.value?.club.brand_primary ?? club.value?.brand_primary ?? '#2563EB')

// Provide the block context so data-hydrated blocks work without any
// wiring at the page level. Non-data blocks ignore this.
provide(BLOCK_CONTEXT_KEY, computed<BlockContext>(() => ({
  brandPrimary: accent.value,
  events: site.value?.events_upcoming ?? [],
  honourEntries: site.value?.honour_board_recent ?? [],
})))
</script>

<template>
  <div v-if="blocks" class="page-blocks" :style="{ '--brand': accent } as any">
    <BlockRenderer v-for="b in blocks" :key="b.id" :block="b" />
  </div>
  <slot v-else />
</template>

<style scoped>
.page-blocks { display: flex; flex-direction: column; gap: 24px; max-width: 1080px; margin: 0 auto; padding: 40px 24px 80px; }
</style>
