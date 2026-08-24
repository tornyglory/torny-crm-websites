<script setup lang="ts">
const club = useClub()
const { data: site } = await useSite()

const entries = computed(() => site.value?.honour_board_recent ?? [])
const accent = computed(() => site.value?.club.brand_primary ?? club.value?.brand_primary ?? '#2563EB')

usePageMeta('honour-board')

// Group by category so the page reads by trophy, not chronologically.
const byCategory = computed(() => {
  const map = new Map<string, { name: string; entries: typeof entries.value }>()
  for (const e of entries.value) {
    const bucket = map.get(e.category_slug)
    if (bucket) bucket.entries.push(e)
    else map.set(e.category_slug, { name: e.category_name, entries: [e] })
  }
  return Array.from(map.values())
})
</script>

<template>
  <PageRenderer slug="honour-board">
  <div class="honour" :style="{ '--brand': accent } as any">
    <header class="page-head">
      <div class="page-head__eyebrow">A century of results</div>
      <h1 class="page-head__title">Honour board</h1>
      <p class="page-head__sub">The club's winners across every competition, year by year.</p>
    </header>

    <div v-if="entries.length === 0" class="empty">
      <div class="empty__title">Honour board is coming together.</div>
      <p>Once results are recorded, they'll show up here — championship winners, pennant sides, life members.</p>
    </div>

    <div v-else class="categories">
      <section v-for="c in byCategory" :key="c.name" class="category">
        <h2 class="category__title">{{ c.name }}</h2>
        <ul class="entries">
          <li v-for="e in c.entries" :key="`${e.category_slug}-${e.year}`" class="entry">
            <span class="entry__year">{{ e.year }}</span>
            <span class="entry__name">
              <template v-if="e.players && e.players.length > 1">{{ e.players.map(p => p.display_name).join(', ') }}</template>
              <template v-else>{{ e.member_name }}</template>
            </span>
            <span v-if="e.notes" class="entry__notes">{{ e.notes }}</span>
          </li>
        </ul>
      </section>
    </div>
  </div>
  </PageRenderer>
</template>

<style scoped>
.honour { display: flex; flex-direction: column; gap: 32px; padding: 40px 24px 80px; max-width: 900px; margin: 0 auto; }
.page-head__eyebrow { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }
.page-head__title { font-family: var(--font-display); font-size: clamp(36px, 5vw, 48px); font-weight: 700; letter-spacing: -0.02em; margin: 8px 0 12px; color: var(--color-ink); }
.page-head__sub { font-family: var(--font-body); font-size: 15px; color: var(--color-graphite); margin: 0; }

.empty { padding: 48px; text-align: center; background: var(--color-surface); border: 1px dashed var(--color-hairline); border-radius: 16px; font-family: var(--font-body); color: var(--color-fog); }
.empty__title { font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--color-ink); margin-bottom: 6px; }

.categories { display: flex; flex-direction: column; gap: 40px; }
.category__title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-ink); margin: 0 0 12px; letter-spacing: -0.01em; }

.entries { list-style: none; padding: 0; margin: 0; }
.entry { display: grid; grid-template-columns: 80px 1fr auto; gap: 16px; padding: 14px 4px; border-top: 1px solid var(--color-hairline); align-items: baseline; }
.entry:first-child { border-top: 0; }
.entry__year { font-family: var(--font-mono); font-size: 14px; color: var(--brand); font-weight: 700; }
.entry__name { font-family: var(--font-display); font-size: 16px; font-weight: 500; color: var(--color-ink); }
.entry__notes { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); font-style: italic; }
</style>
