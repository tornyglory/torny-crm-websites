<script setup lang="ts">
/**
 * Upcoming Tournaments · List — compact strip for a club homepage.
 *
 * Paper: "Upcoming Tournaments · List block". Editorial title + subtitle,
 * "View all" pill, then N stacked rows with a big color-tinted date tile
 * on the left, meta + description in the middle, and a progress bar +
 * Enter CTA on the right.
 *
 * Reads brief 47's `/public/tournaments` sorted by `entries_close_asc`,
 * scoped to the current club via `BlockContext.clubSlug`.
 */
import { computed, inject, isRef, onMounted, ref, watch, type Ref } from 'vue'
import {
  tournaments,
  type PublicTournamentCard,
  type PublicTournamentsListResponse,
} from '@torny/api-client'
import Skeleton from '../components/Skeleton.vue'
import {
  BLOCK_CONTEXT_KEY,
  type BlockContext,
  type UpcomingTournamentsListProps,
} from '../types'

const props = withDefaults(defineProps<UpcomingTournamentsListProps>(), {
  eyebrow: '',
  heading: 'Grab your spot.',
  description: '',
  limit: 3,
  ctaLabel: 'View all tournaments',
  ctaHref: '/tournaments',
  scope: 'club',
})

const ctxRef = inject<Ref<BlockContext> | BlockContext | null>(BLOCK_CONTEXT_KEY, null)
const ctx = computed<BlockContext | null>(() => {
  if (!ctxRef) return null
  return isRef(ctxRef) ? ctxRef.value : ctxRef
})
const clubSlug = computed<string | null>(() => ctx.value?.clubSlug ?? null)
const brand = computed(() => ctx.value?.brandPrimary ?? '#16A34A')

const needsSlug = computed(() => props.scope === 'club' && !clubSlug.value)

const results = ref<PublicTournamentCard[]>([])
const loading = ref(true)

async function load() {
  if (needsSlug.value) {
    results.value = []
    loading.value = false
    return
  }
  loading.value = true
  try {
    const res: PublicTournamentsListResponse = await tournaments.publicList({
      open_only: true,
      limit: 20,
      sort: 'entries_close_asc',
    })
    let list = res.tournaments
    if (props.scope === 'club' && clubSlug.value) {
      list = list.filter((t) => t.club.slug === clubSlug.value)
    }
    results.value = list.slice(0, props.limit)
  } catch {
    results.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(clubSlug, load)

// ── Helpers ────────────────────────────────────────────────────

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-NZ', { maximumFractionDigits: 0 })}`
}
function splitDate(iso: string | null): { weekday: string; day: string; month: string } {
  if (!iso) return { weekday: '', day: 'TBC', month: '' }
  const d = new Date(iso)
  return {
    weekday: d.toLocaleDateString('en-NZ', { weekday: 'short' }).toUpperCase(),
    day: String(d.getDate()),
    month: d.toLocaleDateString('en-NZ', { month: 'short' }).toUpperCase(),
  }
}
function timeOf(iso: string | null): string {
  if (!iso) return 'TBC'
  return new Date(iso).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })
}
function urgency(iso: string | null): { tone: 'mint' | 'tangerine' | 'violet'; label: string; tint: string } {
  if (!iso) return { tone: 'violet', label: 'Opening soon', tint: 'rgba(124,58,237,0.08)' }
  const daysLeft = Math.round((new Date(iso).getTime() - Date.now()) / 86400_000)
  if (daysLeft <= 1) return { tone: 'tangerine', label: daysLeft === 0 ? 'Closes today' : 'Closes tomorrow', tint: 'rgba(234,88,12,0.08)' }
  if (daysLeft <= 5) return { tone: 'tangerine', label: `Closes in ${daysLeft} days`, tint: 'rgba(234,88,12,0.08)' }
  return { tone: 'mint', label: 'Taking entries', tint: 'rgba(22,163,74,0.08)' }
}
function capacityPct(t: PublicTournamentCard): number {
  if (t.entry_cap <= 0) return 0
  const confirmed = t.stats?.confirmed_count ?? 0
  return Math.min(100, Math.round((confirmed / t.entry_cap) * 100))
}
function href(t: PublicTournamentCard): string {
  return `/tournaments/${t.slug}/enter`
}
</script>

<template>
  <section class="ut-list" :style="{ '--brand': brand }">
    <div class="ut-list__inner">
      <header class="ut-list__head">
        <div class="ut-list__head-copy">
          <div class="ut-list__eyebrow">
            <span class="ut-list__eyebrow-dot"></span>
            <template v-if="eyebrow">{{ eyebrow }}</template>
            <template v-else>{{ results.length }} upcoming · Taking entries</template>
          </div>
          <h2 class="ut-list__heading">{{ heading }}</h2>
          <p v-if="description" class="ut-list__desc">{{ description }}</p>
        </div>
        <a v-if="ctaLabel && ctaHref" :href="ctaHref" class="ut-list__cta">
          {{ ctaLabel }}
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6H10M10 6L7 3M10 6L7 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a>
      </header>

      <div v-if="needsSlug" class="ut-list__stub">
        Tournaments will render here when this page is live on the site.
      </div>
      <div v-else-if="loading" class="ut-list__body">
        <Skeleton v-for="i in limit" :key="i" height="130px" style="border-radius: 20px;" />
      </div>
      <div v-else-if="results.length === 0" class="ut-list__stub">
        No open tournaments right now — check back closer to the season.
      </div>
      <div v-else class="ut-list__body">
        <a v-for="t in results" :key="t.id" :href="href(t)" class="ut-list__row">
          <div class="ut-list__date" :class="`ut-list__date--${urgency(t.entries_close_at).tone}`" :style="{ backgroundColor: urgency(t.entries_close_at).tint }">
            <div class="ut-list__date-weekday">{{ splitDate(t.starts_at).weekday }}</div>
            <div class="ut-list__date-day">{{ splitDate(t.starts_at).day }}</div>
            <div class="ut-list__date-month">{{ splitDate(t.starts_at).month }}</div>
          </div>
          <div class="ut-list__body-col">
            <div class="ut-list__row-meta">
              <span class="ut-list__row-pill" :class="`ut-list__row-pill--${urgency(t.entries_close_at).tone}`">{{ urgency(t.entries_close_at).label }}</span>
              <span class="ut-list__row-eyebrow">{{ t.format.toUpperCase() }} · {{ t.category.toUpperCase() }} · {{ formatMoney(t.entry_fee_cents) }}</span>
            </div>
            <div class="ut-list__row-title">{{ t.title }}</div>
            <div class="ut-list__row-sub">
              <template v-if="t.subtitle">{{ t.subtitle }}</template>
              <template v-else-if="t.prize_pool_cents">{{ formatMoney(t.prize_pool_cents) }} prize pool<template v-if="t.sanctioned_by"> · Sanctioned by {{ t.sanctioned_by }}</template></template>
              <template v-else>{{ timeOf(t.starts_at) }}<template v-if="t.club.suburb"> · {{ t.club.suburb }}</template></template>
            </div>
          </div>
          <div class="ut-list__stats">
            <div class="ut-list__stats-numbers">
              <span class="ut-list__stats-val">{{ t.stats?.confirmed_count ?? 0 }} <span class="ut-list__stats-cap">/ {{ t.entry_cap }}</span></span>
              <span class="ut-list__stats-label" :class="{ 'is-warn': urgency(t.entries_close_at).tone === 'tangerine' }">{{ urgency(t.entries_close_at).tone === 'tangerine' ? `${t.stats?.spots_remaining ?? 0} spots left` : 'Teams entered' }}</span>
            </div>
            <div class="ut-list__progress">
              <div class="ut-list__progress-fill" :class="`ut-list__progress-fill--${urgency(t.entries_close_at).tone}`" :style="{ width: `${capacityPct(t)}%` }"></div>
            </div>
            <span class="ut-list__row-enter">Enter team →</span>
          </div>
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ut-list { padding: 80px 0; background: var(--site-bg, #FFFFFF); color: var(--site-ink, #0A0A0B); }
.ut-list__inner { max-width: 1240px; margin: 0 auto; padding: 0 48px; box-sizing: border-box; display: flex; flex-direction: column; gap: 32px; }

.ut-list__head { display: flex; align-items: flex-end; justify-content: space-between; gap: 40px; }
.ut-list__head-copy { max-width: 540px; }
.ut-list__eyebrow { display: inline-flex; align-items: center; gap: 8px; font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #16A34A; font-weight: 600; margin-bottom: 12px; }
.ut-list__eyebrow-dot { width: 6px; height: 6px; border-radius: 999px; background: #16A34A; }
.ut-list__heading { font-family: var(--site-font-display, 'Space Grotesk', system-ui, sans-serif); font-weight: 700; font-size: clamp(36px, 5vw, 48px); letter-spacing: -0.03em; line-height: 100%; margin: 0 0 10px; color: var(--site-ink, #0A0A0B); }
.ut-list__desc { font-family: var(--site-font-body, 'Inter', system-ui, sans-serif); font-size: 15px; color: #6B6B72; line-height: 150%; margin: 0; }
.ut-list__cta { display: inline-flex; align-items: center; gap: 8px; padding: 12px 20px; background: #FFFFFF; border: 1px solid #E7E7E1; border-radius: 999px; font-family: var(--site-font-body, 'Inter', system-ui, sans-serif); font-size: 13px; font-weight: 600; color: var(--site-ink, #0A0A0B); text-decoration: none; }
.ut-list__cta:hover { background: var(--site-ink, #0A0A0B); color: #FFFFFF; border-color: var(--site-ink, #0A0A0B); }

.ut-list__stub { padding: 48px 32px; border: 1px dashed #E7E7E1; border-radius: 16px; text-align: center; font-family: var(--site-font-body, 'Inter', system-ui, sans-serif); color: #6B6B72; }

.ut-list__body { background: #FFFFFF; border: 1px solid #E7E7E1; border-radius: 20px; overflow: hidden; }
.ut-list__row { display: flex; align-items: center; gap: 24px; padding: 24px 28px; text-decoration: none; color: inherit; border-bottom: 1px solid #E7E7E1; transition: background-color 0.15s ease; }
.ut-list__row:last-child { border-bottom: 0; }
.ut-list__row:hover { background: #FAFAF7; }

.ut-list__date { width: 88px; padding: 12px 8px; border-radius: 12px; text-align: center; flex-shrink: 0; }
.ut-list__date-weekday, .ut-list__date-month { font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 10px; letter-spacing: 0.14em; font-weight: 700; }
.ut-list__date-day { font-family: var(--site-font-display, 'Space Grotesk', system-ui, sans-serif); font-weight: 700; font-size: 32px; letter-spacing: -0.03em; line-height: 100%; margin: 2px 0; }
.ut-list__date--mint, .ut-list__date--mint .ut-list__date-weekday, .ut-list__date--mint .ut-list__date-day, .ut-list__date--mint .ut-list__date-month { color: #16A34A; }
.ut-list__date--tangerine, .ut-list__date--tangerine .ut-list__date-weekday, .ut-list__date--tangerine .ut-list__date-day, .ut-list__date--tangerine .ut-list__date-month { color: #EA580C; }
.ut-list__date--violet, .ut-list__date--violet .ut-list__date-weekday, .ut-list__date--violet .ut-list__date-day, .ut-list__date--violet .ut-list__date-month { color: #7C3AED; }

.ut-list__body-col { flex: 1; min-width: 0; }
.ut-list__row-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
.ut-list__row-pill { padding: 3px 8px; border-radius: 999px; font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 9px; letter-spacing: 0.14em; font-weight: 600; }
.ut-list__row-pill--mint { background: rgba(22,163,74,0.12); color: #16A34A; }
.ut-list__row-pill--tangerine { background: rgba(234,88,12,0.12); color: #EA580C; }
.ut-list__row-pill--violet { background: rgba(124,58,237,0.12); color: #7C3AED; }
.ut-list__row-eyebrow { font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 10px; color: #6B6B72; letter-spacing: 0.14em; font-weight: 600; }
.ut-list__row-title { font-family: var(--site-font-display, 'Space Grotesk', system-ui, sans-serif); font-weight: 700; font-size: 24px; color: var(--site-ink, #0A0A0B); letter-spacing: -0.02em; line-height: 105%; margin-bottom: 6px; }
.ut-list__row-sub { font-family: var(--site-font-body, 'Inter', system-ui, sans-serif); font-size: 12px; color: #6B6B72; }

.ut-list__stats { width: 200px; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; flex-shrink: 0; }
.ut-list__stats-numbers { text-align: right; }
.ut-list__stats-val { font-family: var(--site-font-display, 'Space Grotesk', system-ui, sans-serif); font-weight: 700; font-size: 24px; color: var(--site-ink, #0A0A0B); letter-spacing: -0.02em; line-height: 100%; }
.ut-list__stats-cap { font-family: var(--site-font-body, 'Inter', system-ui, sans-serif); font-size: 12px; color: #6B6B72; font-weight: 500; }
.ut-list__stats-label { display: block; font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 9px; color: #6B6B72; letter-spacing: 0.14em; font-weight: 600; margin-top: 4px; text-transform: uppercase; }
.ut-list__stats-label.is-warn { color: #EA580C; }

.ut-list__progress { width: 100%; height: 3px; background: #F5F5F2; border-radius: 999px; overflow: hidden; }
.ut-list__progress-fill { height: 100%; }
.ut-list__progress-fill--mint { background: #16A34A; }
.ut-list__progress-fill--tangerine { background: #EA580C; }
.ut-list__progress-fill--violet { background: #7C3AED; }

.ut-list__row-enter { padding: 8px 16px; background: var(--site-ink, #0A0A0B); color: #FFFFFF; border-radius: 999px; font-family: var(--site-font-body, 'Inter', system-ui, sans-serif); font-size: 12px; font-weight: 600; }

@media (max-width: 760px) {
  .ut-list { padding: 56px 0; }
  .ut-list__head { flex-direction: column; align-items: flex-start; }
  .ut-list__row { flex-wrap: wrap; padding: 20px; }
  .ut-list__date { order: -1; }
  .ut-list__stats { width: auto; align-items: flex-start; }
}
</style>
