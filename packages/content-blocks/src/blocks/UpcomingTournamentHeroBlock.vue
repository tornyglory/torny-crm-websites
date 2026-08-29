<script setup lang="ts">
/**
 * Upcoming Tournament · Hero — full-bleed statement block for a single
 * featured tournament. Meant for the top of a club homepage while the
 * event is on.
 *
 * Paper: "Upcoming Tournament · Hero block". Cover image (or gradient)
 * fills the section, big display type dominates, and a glassmorphic
 * details card floats on the right with countdown, fee, prize, and a
 * spot-fill progress bar.
 *
 * Reads brief 47's `/public/tournaments` sorted by `entries_close_asc`,
 * scoped to the current club, and takes the first result. Owners can
 * force a specific tournament by slug through the `tournamentSlug` prop.
 */
import { computed, inject, isRef, onMounted, ref, watch, type Ref } from 'vue'
import {
  tournaments,
  type PublicTournamentCard,
  type PublicTournamentDetail,
  type PublicTournamentsListResponse,
} from '@torny/api-client'
import Skeleton from '../components/Skeleton.vue'
import {
  BLOCK_CONTEXT_KEY,
  type BlockContext,
  type UpcomingTournamentHeroProps,
} from '../types'

const props = withDefaults(defineProps<UpcomingTournamentHeroProps>(), {
  tournamentSlug: '',
  primaryLabel: 'Enter a team',
  secondaryLabel: 'Full details',
  description: '',
})

const ctxRef = inject<Ref<BlockContext> | BlockContext | null>(BLOCK_CONTEXT_KEY, null)
const ctx = computed<BlockContext | null>(() => {
  if (!ctxRef) return null
  return isRef(ctxRef) ? ctxRef.value : ctxRef
})
const clubSlug = computed<string | null>(() => ctx.value?.clubSlug ?? null)
const brand = computed(() => ctx.value?.brandPrimary ?? '#16A34A')
const needsSlug = computed(() => !clubSlug.value)

const featured = ref<PublicTournamentCard | PublicTournamentDetail | null>(null)
const loading = ref(true)

async function load() {
  if (needsSlug.value) {
    featured.value = null
    loading.value = false
    return
  }
  loading.value = true
  try {
    if (props.tournamentSlug && clubSlug.value) {
      featured.value = await tournaments.publicGet(clubSlug.value, props.tournamentSlug)
      return
    }
    const res: PublicTournamentsListResponse = await tournaments.publicList({
      open_only: true,
      limit: 10,
      sort: 'entries_close_asc',
    })
    const own = res.tournaments.filter((t) => t.club.slug === clubSlug.value)
    featured.value = own[0] ?? null
  } catch {
    featured.value = null
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch([clubSlug, () => props.tournamentSlug], load)

// ── Helpers ────────────────────────────────────────────────────

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-NZ', { maximumFractionDigits: 0 })}`
}
function formatDateRange(startsAt: string | null, endsAt: string | null): string {
  if (!startsAt) return 'Dates TBC'
  const s = new Date(startsAt)
  const startStr = s.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()
  if (!endsAt) return startStr + ' ' + s.getFullYear()
  const e = new Date(endsAt)
  if (e.toDateString() === s.toDateString()) return startStr + ' ' + s.getFullYear()
  return startStr + ' – ' + e.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase() + ' ' + e.getFullYear()
}
function formatCloseAt(iso: string | null): string {
  if (!iso) return 'TBC'
  const d = new Date(iso)
  const day = d.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()
  const time = d.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })
  return `${day} · ${time}`
}
const countdown = computed<{ value: string; unit: string }>(() => {
  const iso = featured.value?.entries_close_at
  if (!iso) return { value: '–', unit: 'days' }
  const ms = new Date(iso).getTime() - Date.now()
  if (ms < 0) return { value: 'Closed', unit: '' }
  const days = Math.round(ms / 86400_000)
  if (days >= 2) return { value: String(days), unit: 'days' }
  const hours = Math.round(ms / 3600_000)
  if (hours >= 2) return { value: String(hours), unit: 'hours' }
  const minutes = Math.max(1, Math.round(ms / 60_000))
  return { value: String(minutes), unit: 'min' }
})
const capacityPct = computed(() => {
  const t = featured.value
  if (!t || t.entry_cap <= 0) return 0
  return Math.min(100, Math.round(((t.stats?.confirmed_count ?? 0) / t.entry_cap) * 100))
})
const enterHref = computed(() => featured.value ? `/tournaments/${featured.value.slug}/enter` : '#')
const detailHref = computed(() => featured.value ? `/tournaments/${featured.value.slug}` : '#')
</script>

<template>
  <section class="ut-hero" :class="{ 'ut-hero--stub': needsSlug || (!loading && !featured) }">
    <div v-if="featured" class="ut-hero__bg" :style="{ backgroundImage: featured.cover_image_url ? `url(${featured.cover_image_url})` : `linear-gradient(120deg, ${brand} 0%, #0F5132 45%, #0A0A0B 100%)` }"></div>
    <div class="ut-hero__scrim"></div>
    <div class="ut-hero__glow"></div>

    <div v-if="needsSlug" class="ut-hero__stub">
      <div class="ut-hero__stub-title">Featured tournament will render here.</div>
      <div class="ut-hero__stub-sub">Once this page is live on the site we'll show your next big comp — cover, countdown, and enter CTA.</div>
    </div>
    <div v-else-if="loading" class="ut-hero__inner">
      <Skeleton height="72px" width="60%" />
      <Skeleton height="200px" width="90%" style="margin-top: 32px;" />
    </div>
    <div v-else-if="!featured" class="ut-hero__stub">
      <div class="ut-hero__stub-title">No open tournaments right now.</div>
      <div class="ut-hero__stub-sub">This block will light up when your next event is taking entries.</div>
    </div>
    <div v-else class="ut-hero__inner">
      <div class="ut-hero__top">
        <div class="ut-hero__pill">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1L7.5 4L11 4.5L8.5 7L9 10.5L6 8.75L3 10.5L3.5 7L1 4.5L4.5 4L6 1Z" fill="#EA580C"/></svg>
          FEATURED TOURNAMENT
        </div>
        <div class="ut-hero__pill ut-hero__pill--mint">
          <span class="ut-hero__pill-dot"></span>
          LIVE · {{ featured.stats?.confirmed_count ?? 0 }} / {{ featured.entry_cap }} ENTRIES
        </div>
        <div class="ut-hero__hosted">
          {{ featured.club.name.toUpperCase() }}<br />
          {{ featured.sanctioned_by ? `SANCTIONED BY ${featured.sanctioned_by.toUpperCase()}` : `${featured.category.toUpperCase()} · ${featured.format.toUpperCase()}` }}
        </div>
      </div>

      <div class="ut-hero__bottom">
        <div class="ut-hero__copy">
          <div class="ut-hero__eyebrow">{{ formatDateRange(featured.starts_at, featured.ends_at) }} · {{ featured.format.toUpperCase() }} · {{ featured.category.toUpperCase() }}</div>
          <h2 class="ut-hero__title">{{ featured.title }}</h2>
          <p class="ut-hero__desc">{{ description || featured.subtitle || ('description' in featured ? featured.description : '') || '' }}</p>
          <div class="ut-hero__ctas">
            <a :href="enterHref" class="ut-hero__cta ut-hero__cta--primary">
              {{ primaryLabel }}
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7H11.5M11.5 7L8 3.5M11.5 7L8 10.5" stroke="#0A0A0B" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </a>
            <a :href="detailHref" class="ut-hero__cta ut-hero__cta--secondary">{{ secondaryLabel }}</a>
          </div>
        </div>

        <aside class="ut-hero__card">
          <div class="ut-hero__card-label">CLOSES IN</div>
          <div class="ut-hero__countdown">
            <div class="ut-hero__countdown-val">{{ countdown.value }}</div>
            <div class="ut-hero__countdown-side">
              <div class="ut-hero__countdown-unit">{{ countdown.unit }}</div>
              <div class="ut-hero__countdown-when">{{ formatCloseAt(featured.entries_close_at) }}</div>
            </div>
          </div>
          <div class="ut-hero__hr"></div>
          <div class="ut-hero__card-row">
            <div>
              <div class="ut-hero__card-small">ENTRY FEE</div>
              <div class="ut-hero__card-mid">{{ formatMoney(featured.entry_fee_cents) }}<span class="ut-hero__card-tiny"> / team</span></div>
            </div>
            <div>
              <div class="ut-hero__card-small">PRIZE POOL</div>
              <div class="ut-hero__card-mid">{{ featured.prize_pool_cents ? formatMoney(featured.prize_pool_cents) : '—' }}</div>
            </div>
          </div>
          <div>
            <div class="ut-hero__progress-head">
              <span>SPOTS FILLED</span>
              <span class="ut-hero__progress-pct">{{ capacityPct }}%</span>
            </div>
            <div class="ut-hero__progress">
              <div class="ut-hero__progress-fill" :style="{ width: `${capacityPct}%` }"></div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ut-hero { position: relative; background: #0A0A0B; color: #FFFFFF; overflow: hidden; padding: 80px 48px; min-height: 640px; display: flex; }
.ut-hero--stub { min-height: 320px; padding: 96px 48px; }

.ut-hero__bg { position: absolute; inset: 0; background-size: cover; background-position: center; z-index: 0; }
.ut-hero__scrim { position: absolute; inset: 0; background: linear-gradient(120deg, rgba(10,10,11,0.55) 0%, rgba(10,10,11,0.2) 60%, rgba(10,10,11,0.35) 100%); z-index: 1; }
.ut-hero__glow { position: absolute; inset: 0; background: radial-gradient(ellipse at 78% 30%, rgba(234,88,12,0.24) 0%, transparent 55%); z-index: 1; }

.ut-hero__inner { position: relative; z-index: 2; width: 100%; max-width: 1240px; margin: 0 auto; display: flex; flex-direction: column; justify-content: space-between; gap: 40px; }

.ut-hero__top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ut-hero__pill { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14); border-radius: 999px; font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 11px; color: #FFFFFF; letter-spacing: 0.14em; font-weight: 700; backdrop-filter: blur(12px); }
.ut-hero__pill--mint { background: rgba(22,163,74,0.24); border: 1px solid rgba(22,163,74,0.4); color: #86EFAC; }
.ut-hero__pill-dot { width: 5px; height: 5px; border-radius: 999px; background: #86EFAC; }
.ut-hero__hosted { margin-left: auto; text-align: right; font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 11px; color: rgba(255,255,255,0.5); letter-spacing: 0.14em; font-weight: 600; line-height: 1.4; }

.ut-hero__bottom { display: flex; align-items: flex-end; justify-content: space-between; gap: 60px; }
.ut-hero__copy { max-width: 720px; }
.ut-hero__eyebrow { font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 12px; color: rgba(255,255,255,0.6); letter-spacing: 0.14em; font-weight: 600; margin-bottom: 16px; }
.ut-hero__title { font-family: var(--site-font-display, 'Space Grotesk', system-ui, sans-serif); font-weight: 700; font-size: clamp(48px, 8vw, 88px); color: #FFFFFF; letter-spacing: -0.045em; line-height: 92%; margin: 0 0 20px; }
.ut-hero__desc { font-family: var(--site-font-body, 'Inter', system-ui, sans-serif); font-size: 16px; color: rgba(255,255,255,0.72); line-height: 150%; margin: 0 0 32px; max-width: 540px; }

.ut-hero__ctas { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.ut-hero__cta { display: inline-flex; align-items: center; gap: 10px; padding: 16px 28px; border-radius: 999px; font-family: var(--site-font-body, 'Inter', system-ui, sans-serif); font-size: 15px; font-weight: 700; text-decoration: none; }
.ut-hero__cta--primary { background: #FFFFFF; color: #0A0A0B; }
.ut-hero__cta--secondary { background: transparent; color: #FFFFFF; border: 1px solid rgba(255,255,255,0.24); font-weight: 600; }

.ut-hero__card { width: 340px; flex-shrink: 0; padding: 28px; background: rgba(255,255,255,0.06); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.12); border-radius: 20px; color: #FFFFFF; display: flex; flex-direction: column; gap: 20px; }
.ut-hero__card-label { font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 10px; color: #FCA5A5; letter-spacing: 0.14em; font-weight: 700; }
.ut-hero__countdown { display: flex; align-items: baseline; gap: 12px; }
.ut-hero__countdown-val { font-family: var(--site-font-display, 'Space Grotesk', system-ui, sans-serif); font-weight: 700; font-size: 64px; letter-spacing: -0.03em; line-height: 100%; color: #FFFFFF; }
.ut-hero__countdown-unit { font-family: var(--site-font-display, 'Space Grotesk', system-ui, sans-serif); font-weight: 700; font-size: 22px; letter-spacing: -0.02em; line-height: 100%; }
.ut-hero__countdown-when { font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 10px; color: rgba(255,255,255,0.6); letter-spacing: 0.14em; font-weight: 600; margin-top: 4px; }
.ut-hero__hr { height: 1px; background: rgba(255,255,255,0.1); }
.ut-hero__card-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.ut-hero__card-small { font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 10px; color: rgba(255,255,255,0.5); letter-spacing: 0.14em; font-weight: 600; margin-bottom: 4px; }
.ut-hero__card-mid { font-family: var(--site-font-display, 'Space Grotesk', system-ui, sans-serif); font-weight: 700; font-size: 22px; color: #FFFFFF; letter-spacing: -0.02em; line-height: 100%; }
.ut-hero__card-tiny { font-family: var(--site-font-body, 'Inter', system-ui, sans-serif); font-size: 12px; color: rgba(255,255,255,0.5); font-weight: 500; }
.ut-hero__progress-head { display: flex; justify-content: space-between; font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 10px; color: rgba(255,255,255,0.5); letter-spacing: 0.14em; font-weight: 600; margin-bottom: 8px; }
.ut-hero__progress-pct { color: #FFFFFF; }
.ut-hero__progress { height: 6px; background: rgba(255,255,255,0.08); border-radius: 999px; overflow: hidden; }
.ut-hero__progress-fill { height: 100%; background: linear-gradient(90deg, #86EFAC 0%, #FBBF77 100%); border-radius: 999px; }

.ut-hero__stub { position: relative; z-index: 2; max-width: 640px; margin: auto; padding: 0 32px; text-align: center; }
.ut-hero__stub-title { font-family: var(--site-font-display, 'Space Grotesk', system-ui, sans-serif); font-weight: 700; font-size: 28px; color: #FFFFFF; letter-spacing: -0.02em; margin-bottom: 12px; }
.ut-hero__stub-sub { font-family: var(--site-font-body, 'Inter', system-ui, sans-serif); font-size: 15px; color: rgba(255,255,255,0.7); line-height: 150%; }

@media (max-width: 960px) {
  .ut-hero { padding: 56px 32px; min-height: auto; }
  .ut-hero__bottom { flex-direction: column; align-items: flex-start; gap: 32px; }
  .ut-hero__card { width: 100%; }
  .ut-hero__hosted { display: none; }
}
</style>
