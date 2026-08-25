<script setup lang="ts">
const club = useClub()
const { data: site } = await useSite()

const club_ = computed(() => site.value?.club)
const accent = computed(() => club_.value?.brand_primary ?? club.value?.brand_primary ?? '#2563EB')

usePageMeta('about')
</script>

<template>
  <PageRenderer slug="about">
    <div class="about" :style="{ '--brand': accent } as any">
      <header class="page-head">
        <div v-if="club_?.founded_year" class="page-head__eyebrow">Established {{ club_.founded_year }}</div>
        <h1 class="page-head__title">About {{ club_?.name ?? 'the club' }}</h1>
        <p v-if="club_?.tagline || club_?.short_description" class="page-head__sub">{{ club_?.tagline || club_?.short_description }}</p>
      </header>

      <div class="empty">
        <div class="empty__title">Your story goes here.</div>
        <p>Open the Website editor in the CRM to add a hero, some paragraphs, and a photo gallery. Once you publish, this page becomes yours.</p>
      </div>
    </div>
  </PageRenderer>
</template>

<style scoped>
.about { display: flex; flex-direction: column; gap: 32px; padding: 40px max(48px, calc((100vw - var(--container-content, 1280px)) / 2)) 80px; }
.page-head__eyebrow { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }
.page-head__title { font-family: var(--font-display); font-size: clamp(36px, 5vw, 48px); font-weight: 700; letter-spacing: -0.02em; margin: 8px 0 12px; color: var(--color-ink); }
.page-head__sub { font-family: var(--font-body); font-size: 15px; color: var(--color-graphite); margin: 0; max-width: 640px; }

.empty { padding: 48px; text-align: center; background: var(--color-surface); border: 1px dashed var(--color-hairline); border-radius: 16px; font-family: var(--font-body); color: var(--color-fog); }
.empty__title { font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--color-ink); margin-bottom: 6px; }
</style>
