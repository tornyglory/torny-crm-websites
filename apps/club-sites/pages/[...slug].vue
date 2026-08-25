<script setup lang="ts">
/**
 * Catch-all for CMS-driven custom pages published from the CRM Website
 * Editor (brief 27). The `/site` payload already carries every page's
 * block layout in `site.pages[slug]`, so we just resolve the current
 * route's slug and hand it to `<PageRenderer>` — same code path as the
 * system pages.
 *
 * If the slug isn't in `site.pages`, we render a friendly empty state
 * (page hasn't been published yet, or the owner deleted it).
 */
const route = useRoute()
const { data: site } = await useSite()

const slug = computed(() => {
  const raw = route.params.slug
  return Array.isArray(raw) ? raw.join('/') : (raw ?? '')
})

const hasBlocks = computed(() => {
  const entry = site.value?.pages?.[slug.value]
  return !!(entry && Array.isArray(entry.blocks) && entry.blocks.length > 0)
})

usePageMeta(slug.value)

const accent = computed(
  () => site.value?.club?.brand_primary ?? '#2563EB',
)
</script>

<template>
  <PageRenderer :slug="slug">
    <div class="custom-empty" :style="{ '--brand': accent } as any">
      <div class="custom-empty__eyebrow">
        <span class="custom-empty__eyebrow-dot" />
        <span>Page not published</span>
      </div>
      <h1 class="custom-empty__title">Nothing here yet.</h1>
      <p class="custom-empty__body">
        This page exists in the club's CMS but hasn't been given any blocks or published.
        Once the owner drops in a hero, some paragraphs, or any block from the palette, it'll show up here.
      </p>
      <NuxtLink to="/" class="custom-empty__cta">Back to the club</NuxtLink>
    </div>
  </PageRenderer>
</template>

<style scoped>
.custom-empty {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 640px;
  padding: 80px 0 120px;
}
.custom-empty__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
  font-weight: 700;
}
.custom-empty__eyebrow-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--brand);
}
.custom-empty__title {
  font-family: var(--font-display);
  font-size: clamp(36px, 4vw, 48px);
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--color-ink);
  margin: 0;
  line-height: 1.05;
}
.custom-empty__body {
  font-family: var(--font-body);
  font-size: 15px;
  color: var(--color-graphite);
  margin: 0;
  line-height: 1.55;
}
.custom-empty__cta {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  padding: 12px 20px;
  background: var(--color-ink);
  color: #fff;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  margin-top: 8px;
}
</style>
