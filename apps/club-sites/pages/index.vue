<script setup lang="ts">
import { BlockRenderer, BLOCK_CONTEXT_KEY, type Block, type BlockContext } from '@torny/content-blocks'

const club = useClub()
const { data: site } = await useSite()

const club_ = computed(() => site.value?.club)
const heading = computed(() => club_.value?.name ?? club.value?.name ?? 'Welcome')
const tagline = computed(
  () => club_.value?.tagline || club_.value?.short_description || 'A friendly bowls club. New members always welcome.',
)
const upcoming = computed(() => site.value?.events_upcoming ?? [])
const tiers = computed(() => site.value?.membership_tiers ?? [])
const accent = computed(() => club_.value?.brand_primary ?? club.value?.brand_primary ?? '#2563EB')

// If the CRM's Home editor has published a layout, render that. Otherwise
// fall back to the hardcoded template below. `site.pages` is populated by
// backend brief 16 §3 — until it ships, `blocks` is always null and the
// fallback runs.
const blocks = computed<Block[] | null>(() => {
  const raw = site.value?.pages?.home?.blocks
  return raw && raw.length > 0 ? (raw as unknown as Block[]) : null
})

// Provide the block context so <EventListBlock>, <HonourBoardBlock> etc.
// can render real data. Non-data blocks (Hero, RichText, CTAs) ignore it.
provide(BLOCK_CONTEXT_KEY, computed<BlockContext>(() => ({
  brandPrimary: accent.value,
  events: upcoming.value,
  honourEntries: site.value?.honour_board_recent ?? [],
})))

useSeoMeta({
  title: () => heading.value,
  description: () => (club_.value?.short_description ?? tagline.value ?? undefined) as string | undefined,
})

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function formatEventDate(iso: string): string {
  const d = new Date(iso)
  return `${DAY_ABBR[d.getDay()]} ${d.getDate()} ${MONTH_ABBR[d.getMonth()]}`
}
function formatEventTime(iso: string): string {
  const d = new Date(iso)
  let h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return m ? `${h}:${m.toString().padStart(2, '0')} ${ampm}` : `${h}${ampm}`
}
</script>

<template>
  <!-- CRM-published block layout takes priority when present. -->
  <div v-if="blocks" class="home home--blocks" :style="{ '--brand': accent } as any">
    <BlockRenderer v-for="b in blocks" :key="b.id" :block="b" />
  </div>

  <!-- Fallback template — used when no layout is published yet. -->
  <div v-else class="home" :style="{ '--brand': accent } as any">
    <section class="hero">
      <div v-if="club_?.founded_year" class="hero__eyebrow">Established {{ club_.founded_year }}</div>
      <h1 class="hero__title">{{ heading }}</h1>
      <p class="hero__tagline">{{ tagline }}</p>
      <div class="hero__cta">
        <NuxtLink v-if="site?.pages_enabled.membership" to="/membership" class="btn btn--primary">Join the club</NuxtLink>
        <NuxtLink v-if="site?.pages_enabled.events" to="/events" class="btn btn--ghost">See what's on</NuxtLink>
      </div>
    </section>

    <section v-if="upcoming.length > 0" class="events">
      <div class="section-head">
        <h2 class="section-head__title">What's on</h2>
        <NuxtLink v-if="site?.pages_enabled.events" to="/events" class="section-head__link">See all →</NuxtLink>
      </div>
      <ul class="event-list">
        <li v-for="e in upcoming.slice(0, 4)" :key="e.id" class="event">
          <div class="event__date">
            <div class="event__date-day">{{ formatEventDate(e.starts_at).split(' ')[1] }}</div>
            <div class="event__date-mo">{{ formatEventDate(e.starts_at).split(' ')[2] }}</div>
          </div>
          <div class="event__body">
            <div class="event__title">{{ e.title }}</div>
            <div class="event__meta">
              {{ formatEventDate(e.starts_at) }} · {{ formatEventTime(e.starts_at) }}<template v-if="e.location"> · {{ e.location }}</template>
            </div>
            <p v-if="e.excerpt" class="event__excerpt">{{ e.excerpt }}</p>
          </div>
        </li>
      </ul>
    </section>

    <section v-if="site?.pages_enabled.membership && tiers.length > 0" class="tiers">
      <div class="section-head">
        <h2 class="section-head__title">Play with us</h2>
        <NuxtLink to="/membership" class="section-head__link">All tiers →</NuxtLink>
      </div>
      <ul class="tier-list">
        <li v-for="t in tiers.slice(0, 3)" :key="t.id" class="tier" :class="{ 'tier--default': t.is_default }">
          <div class="tier__name">{{ t.type_name }}</div>
          <div class="tier__price">
            <span class="tier__price-currency">$</span><span class="tier__price-amount">{{ t.fee ?? '—' }}</span>
            <span v-if="t.cadence" class="tier__price-cadence">/ {{ t.cadence === 'annual' ? 'year' : t.cadence === 'monthly' ? 'month' : 'season' }}</span>
          </div>
          <p v-if="t.description" class="tier__desc">{{ t.description }}</p>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.home { display: flex; flex-direction: column; gap: 64px; padding: 40px 24px 80px; max-width: 1080px; margin: 0 auto; }
.home--blocks { gap: 24px; }

.hero { text-align: center; padding: 40px 0 24px; }
.hero__eyebrow { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }
.hero__title { font-family: var(--font-display); font-size: clamp(40px, 6vw, 72px); font-weight: 700; letter-spacing: -0.02em; line-height: 1.05; color: var(--color-ink); margin: 16px 0 20px; }
.hero__tagline { font-family: var(--font-body); font-size: 18px; line-height: 1.55; color: var(--color-graphite); max-width: 640px; margin: 0 auto 32px; }
.hero__cta { display: inline-flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
.btn { display: inline-flex; align-items: center; gap: 8px; padding: 14px 24px; border-radius: 999px; font-family: var(--font-body); font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; }
.btn--primary { background: var(--brand); color: #fff; border: 0; }
.btn--ghost { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.btn--ghost:hover { background: var(--color-surface); }

.section-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 20px; }
.section-head__title { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0; color: var(--color-ink); }
.section-head__link { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--brand); text-decoration: none; }
.section-head__link:hover { text-decoration: underline; }

.event-list, .tier-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
.event-list { grid-template-columns: 1fr; }
.tier-list { grid-template-columns: repeat(3, 1fr); }

.event { display: flex; align-items: flex-start; gap: 20px; padding: 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }
.event__date { width: 56px; height: 56px; border-radius: 12px; background: var(--brand); color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; flex-shrink: 0; }
.event__date-day { font-family: var(--font-display); font-size: 22px; font-weight: 700; line-height: 1; }
.event__date-mo { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; margin-top: 4px; }
.event__body { flex: 1; min-width: 0; }
.event__title { font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--color-ink); }
.event__meta { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); margin-top: 4px; }
.event__excerpt { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); line-height: 1.55; margin: 8px 0 0; }

.tier { padding: 24px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; display: flex; flex-direction: column; gap: 8px; }
.tier--default { border-color: var(--brand); box-shadow: 0 0 0 3px color-mix(in oklab, var(--brand) 18%, transparent); }
.tier__name { font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--color-ink); }
.tier__price { display: baseline; align-items: baseline; font-family: var(--font-display); }
.tier__price-currency { font-size: 18px; color: var(--color-fog); vertical-align: super; }
.tier__price-amount { font-size: 40px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); }
.tier__price-cadence { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); margin-left: 4px; }
.tier__desc { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); line-height: 1.55; margin: 4px 0 0; }

@media (max-width: 900px) {
  .tier-list { grid-template-columns: 1fr; }
}
</style>
