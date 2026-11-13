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
// Brief 105 — public custom facets. Hydrated once per tenant and
// fed into the BlockContext so the MembershipJoinFormBlock renders
// them under the Additional questions section.
const { facets: publicFacets } = usePublicFacets()
// Brief 106 — join form section overrides. The merged variant list
// drives per-section visibility on the public MembershipJoinFormBlock
// (admins can hide About you / Address / etc. from the modal).
const { variant: publicVariant } = useVariant()

const blocks = computed<Block[] | null>(() => {
  const raw = site.value?.pages?.[props.slug]?.blocks
  return raw && raw.length > 0 ? (raw as unknown as Block[]) : null
})

/** Full-bleed blocks render edge-to-edge via negative margins — the
 *  wrapper's top padding leaves an awkward gap between the header and
 *  the hero. When the first block is one of these, kill the top padding
 *  so the hero sits flush against the nav. */
const FULL_BLEED_TYPES = new Set<string>([
  'hero',
  'fullBleedImage',
  'fullBleedMedia',
  'venueHireHero',
  'upcomingTournamentHero',
])
const flushTop = computed<boolean>(() => {
  const first = blocks.value?.[0]
  return first != null && FULL_BLEED_TYPES.has(first.type)
})

const accent = computed(() => site.value?.club.brand_primary ?? club.value?.brand_primary ?? '#2563EB')

// Provide the block context so data-hydrated blocks work without any
// wiring at the page level. Non-data blocks ignore this.
provide(BLOCK_CONTEXT_KEY, computed<BlockContext>(() => ({
  brandPrimary: accent.value,
  clubSlug: club.value?.slug ?? site.value?.club?.slug ?? null,
  events: site.value?.events_upcoming ?? [],
  honourEntries: site.value?.honour_board_recent ?? [],
  membershipTiers: site.value?.membership_tiers ?? [],
  cadence: site.value?.cadence ?? null,
  firstYearDiscount: site.value?.first_year_discount ?? false,
  contact: site.value?.contact ?? undefined,
  hours: site.value?.hours ?? [],
  customFacets: publicFacets.value ?? [],
  joinFormSections: publicVariant.value?.join_form_sections ?? [],
})))
</script>

<template>
  <div
    v-if="blocks"
    class="page-blocks"
    :class="{ 'page-blocks--flush-top': flushTop }"
    :style="{ '--brand': accent } as any"
  >
    <BlockRenderer v-for="b in blocks" :key="b.id" :block="b" />
  </div>
  <slot v-else />
</template>

<style scoped>
.page-blocks {
  display: flex;
  flex-direction: column;
  /* Blocks stack flush — each block paints its own full-width background
     via the standard width: 100vw + margin-left: calc(50% - 50vw) escape,
     so there's no visual seam between consecutive sections even when
     they have different background tokens. In-flow blocks that DON'T
     escape (RichText, etc.) get the shared horizontal gutter from the
     padding below. */
  gap: 0;
  /* Container background matches the ground token so any leftover
     vertical space (e.g. above the first block on a short page) reads
     as the theme colour rather than browser white. */
  background: var(--color-ground);
  padding: 0 max(48px, calc((100vw - var(--container-content, 1280px)) / 2));
}
/* Top-padding is zero by default so flush-top (hero) pages work; a page
   with no hero gets its own breathing room from the first block's own
   padding. */
.page-blocks--flush-top { padding-top: 0; }
</style>
