<script setup lang="ts">
/**
 * Tournament Search — the "Find your next comp." block.
 *
 * Paper: "Torny Web · Tournaments (member view)" — repurposed for the
 * club-site block. Left filter rail + main column with editorial header,
 * active-filter chips, one featured card (dark ink with a color-gradient
 * rail), then a row-style list of tournaments.
 *
 * Reads brief 47's `/public/tournaments` endpoint. Two scopes:
 *  - `club`   → filters to `BlockContext.clubSlug` (needs backend `club_slug`
 *               param — see brief 49). Falls back to client-side filter on
 *               `t.club.slug` until that ships.
 *  - `network` → no host filter, whole network.
 *
 * Personalized rails (You're entered in / Come back to these) render only
 * when the parent app injects that data through BlockContext — otherwise
 * they hide.
 */
import { computed, inject, isRef, onMounted, ref, watch, type Ref } from 'vue'
import {
  tournaments,
  type PublicTournamentCard,
  type PublicTournamentsListResponse,
  type TournamentCategory,
  type TournamentFormat,
} from '@torny/api-client'
import Skeleton from '../components/Skeleton.vue'
import {
  BLOCK_CONTEXT_KEY,
  type BlockContext,
  type TournamentSearchProps,
} from '../types'

const props = withDefaults(defineProps<TournamentSearchProps>(), {
  eyebrow: '',
  heading: 'Find your next comp.',
  description: 'Every open tournament across NZ — searchable, filterable, one click entry with your Torny credentials.',
  scope: 'club',
  pageSize: 12,
  showFilterChips: true,
  showSearch: true,
  openOnly: false,
  ctaLabel: '',
  ctaHref: '',
})

const ctxRef = inject<Ref<BlockContext> | BlockContext | null>(BLOCK_CONTEXT_KEY, null)
const ctx = computed<BlockContext | null>(() => {
  if (!ctxRef) return null
  return isRef(ctxRef) ? ctxRef.value : ctxRef
})
const clubSlug = computed<string | null>(() => ctx.value?.clubSlug ?? null)
const brand = computed(() => ctx.value?.brandPrimary ?? '#2563EB')

const needsSlug = computed(() => props.scope === 'club' && !clubSlug.value)

// ── Filter state ───────────────────────────────────────────────

type FormatFilter = 'all' | TournamentFormat
type CategoryFilter = 'all' | TournamentCategory
type GenderFilter = 'all' | 'mens' | 'womens' | 'mixed'

const activeFormat = ref<FormatFilter>('all')
const activeCategory = ref<CategoryFilter>('all')
const activeGender = ref<GenderFilter>('all')
const openOnly = ref<boolean>(props.openOnly)
const searchQuery = ref('')

const debouncedSearch = ref('')
let searchDebounce: ReturnType<typeof setTimeout> | null = null
watch(searchQuery, (q) => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => { debouncedSearch.value = q.trim() }, 250)
})

function resetFilters() {
  activeFormat.value = 'all'
  activeCategory.value = 'all'
  activeGender.value = 'all'
  openOnly.value = props.openOnly
  searchQuery.value = ''
  debouncedSearch.value = ''
}

// ── Data ───────────────────────────────────────────────────────

const results = ref<PublicTournamentCard[]>([])
const total = ref(0)
const loading = ref(true)
let abort: AbortController | null = null

async function load() {
  if (needsSlug.value) {
    results.value = []
    total.value = 0
    loading.value = false
    return
  }
  abort?.abort()
  abort = new AbortController()
  loading.value = true
  try {
    const res: PublicTournamentsListResponse = await tournaments.publicList(
      {
        format: activeFormat.value === 'all' ? undefined : activeFormat.value,
        category: activeCategory.value === 'all' ? undefined : activeCategory.value,
        gender: activeGender.value === 'all' ? undefined : activeGender.value,
        open_only: openOnly.value ? true : undefined,
        q: debouncedSearch.value || undefined,
        limit: props.pageSize,
        sort: 'entries_close_asc',
      },
      { signal: abort.signal },
    )
    let list = res.tournaments
    if (props.scope === 'club' && clubSlug.value) {
      list = list.filter((t) => t.club.slug === clubSlug.value)
    }
    results.value = list
    total.value = res.pagination.total_items
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    results.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(
  [activeFormat, activeCategory, activeGender, openOnly, debouncedSearch, clubSlug],
  load,
)

// Featured = first result when sorted by closing-soonest (client picks it).
const featured = computed<PublicTournamentCard | null>(() => results.value[0] ?? null)
const rest = computed(() => results.value.slice(1))

const activeFilterCount = computed(() => {
  let n = 0
  if (activeFormat.value !== 'all') n++
  if (activeCategory.value !== 'all') n++
  if (activeGender.value !== 'all') n++
  if (openOnly.value) n++
  if (debouncedSearch.value) n++
  return n
})

// ── Format helpers ─────────────────────────────────────────────

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-NZ', { maximumFractionDigits: 0 })}`
}
function formatDayShort(iso: string | null): { day: string; month: string; weekday: string } {
  if (!iso) return { day: 'TBC', month: '', weekday: '' }
  const d = new Date(iso)
  return {
    day: String(d.getDate()),
    month: d.toLocaleDateString('en-NZ', { month: 'short' }).toUpperCase(),
    weekday: d.toLocaleDateString('en-NZ', { weekday: 'short' }).toUpperCase(),
  }
}
function formatRowDate(iso: string | null): string {
  if (!iso) return 'Dates TBC'
  try {
    return new Date(iso).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })
  } catch { return iso }
}
function urgency(iso: string | null): { tone: 'mint' | 'tangerine' | 'fog'; label: string } {
  if (!iso) return { tone: 'fog', label: 'Dates TBC' }
  const daysLeft = Math.round((new Date(iso).getTime() - Date.now()) / 86400_000)
  if (daysLeft < 0) return { tone: 'fog', label: 'Entries closed' }
  if (daysLeft <= 1) return { tone: 'tangerine', label: daysLeft === 0 ? 'Closes today' : 'Closes tomorrow' }
  if (daysLeft <= 7) return { tone: 'tangerine', label: `Closes ${new Date(iso).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })}` }
  return { tone: 'mint', label: 'Taking entries' }
}
function statusToneClass(t: PublicTournamentCard): 'mint' | 'tangerine' | 'violet' | 'fog' {
  const days = t.entries_close_at
    ? Math.round((new Date(t.entries_close_at).getTime() - Date.now()) / 86400_000)
    : 999
  if (days <= 3) return 'tangerine'
  if (t.category === 'championship') return 'violet'
  if ((t.stats?.spots_remaining ?? 0) > 0) return 'mint'
  return 'fog'
}
function initials(name: string): string {
  return name.split(/\s+/).map((s) => s[0] ?? '').join('').slice(0, 2).toUpperCase()
}
function href(t: PublicTournamentCard): string {
  return `/tournaments/${t.slug}/enter`
}
</script>

<template>
  <section class="tsx" :style="{ '--brand': brand }">
    <!-- Head — spans full block width, matches EventsCalendarBlock -->
    <header class="tsx__head">
      <div class="tsx__head-text">
        <div class="tsx__eyebrow">
          <template v-if="eyebrow">{{ eyebrow }}</template>
          <template v-else>Tournaments · <span class="tsx__eyebrow-accent">{{ needsSlug ? 'Preview' : `${total} listed` }}</span></template>
        </div>
        <h2 class="tsx__heading">{{ heading }}</h2>
        <p v-if="description" class="tsx__desc">{{ description }}</p>
      </div>
    </header>

    <div class="tsx__inner">
      <!-- Filter rail (left) -->
      <aside class="tsx__rail">
        <section class="tsx__card">
          <div class="tsx__card-head">
            <div class="tsx__card-title">Advanced filters</div>
            <button v-if="activeFilterCount > 0" type="button" class="tsx__reset" @click="resetFilters">RESET</button>
          </div>

          <div class="tsx__group">
            <div class="tsx__group-label">FORMAT</div>
            <div class="tsx__chips">
              <button
                v-for="f in (['singles', 'pairs', 'triples', 'fours'] as const)"
                :key="f"
                type="button"
                class="tsx__chip"
                :class="{ 'is-on': activeFormat === f }"
                @click="activeFormat = activeFormat === f ? 'all' : f"
              >{{ f.charAt(0).toUpperCase() + f.slice(1) }}</button>
            </div>
          </div>

          <div class="tsx__group">
            <div class="tsx__group-label">CATEGORY</div>
            <div class="tsx__chips">
              <button
                v-for="c in (['open', 'restricted', 'championship'] as const)"
                :key="c"
                type="button"
                class="tsx__chip"
                :class="{ 'is-on': activeCategory === c }"
                @click="activeCategory = activeCategory === c ? 'all' : c"
              >{{ c.charAt(0).toUpperCase() + c.slice(1) }}</button>
            </div>
          </div>

          <div class="tsx__group">
            <div class="tsx__group-label">GENDER</div>
            <div class="tsx__chips">
              <button type="button" class="tsx__chip" :class="{ 'is-on': activeGender === 'mens' }" @click="activeGender = activeGender === 'mens' ? 'all' : 'mens'">Men's</button>
              <button type="button" class="tsx__chip" :class="{ 'is-on': activeGender === 'womens' }" @click="activeGender = activeGender === 'womens' ? 'all' : 'womens'">Women's</button>
              <button type="button" class="tsx__chip" :class="{ 'is-on': activeGender === 'mixed' }" @click="activeGender = activeGender === 'mixed' ? 'all' : 'mixed'">Mixed</button>
            </div>
          </div>

          <label class="tsx__toggle">
            <input v-model="openOnly" type="checkbox" />
            <span>Only tournaments taking entries</span>
          </label>
        </section>
      </aside>

      <!-- Main column -->
      <div class="tsx__main">
        <div v-if="showSearch" class="tsx__search">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          <input v-model="searchQuery" type="search" placeholder="Search tournaments, clubs, formats…" />
          <button v-if="searchQuery" type="button" class="tsx__clear" @click="searchQuery = ''">× CLEAR</button>
        </div>

        <!-- Placeholder for CRM preview -->
        <div v-if="needsSlug" class="tsx__stub">
          <div class="tsx__stub-title">Tournaments will render here.</div>
          <div class="tsx__stub-sub">In the CRM preview we don't have a club slug to filter against. Once this page is live on the site it'll list every open tournament you're running.</div>
        </div>

        <!-- Loading skeleton -->
        <div v-else-if="loading">
          <div class="tsx__feature tsx__feature--skeleton">
            <Skeleton height="280px" />
          </div>
          <div class="tsx__rows">
            <Skeleton v-for="i in 3" :key="i" height="88px" style="border-radius: 14px;" />
          </div>
        </div>

        <!-- Empty -->
        <div v-else-if="results.length === 0" class="tsx__empty">
          <div class="tsx__empty-title">No tournaments match yet.</div>
          <div class="tsx__empty-sub">Try clearing filters, widening the search, or check back closer to the season.</div>
        </div>

        <!-- Featured + rows -->
        <template v-else>
          <a v-if="featured" :href="href(featured)" class="tsx__feature">
            <div class="tsx__feature-left" :style="{ backgroundImage: featured.cover_image_url ? `url(${featured.cover_image_url})` : `linear-gradient(155deg, #7C3AED 0%, #2563EB 45%, #16A34A 100%)` }">
              <div class="tsx__feature-club">
                <div class="tsx__feature-club-avatar">{{ initials(featured.club.name) }}</div>
                <div>
                  <div class="tsx__feature-club-name">{{ featured.club.name }}</div>
                  <div class="tsx__feature-club-meta">{{ formatRowDate(featured.starts_at) }}</div>
                </div>
              </div>
              <div>
                <h3 class="tsx__feature-title">{{ featured.title }}</h3>
                <p v-if="featured.subtitle" class="tsx__feature-sub">{{ featured.subtitle }}</p>
              </div>
              <div class="tsx__feature-stats">
                <div>
                  <div class="tsx__feature-stat-label">ENTRY FEE</div>
                  <div class="tsx__feature-stat-val">{{ formatMoney(featured.entry_fee_cents) }}</div>
                </div>
                <div>
                  <div class="tsx__feature-stat-label">FORMAT</div>
                  <div class="tsx__feature-stat-val">{{ featured.format.charAt(0).toUpperCase() + featured.format.slice(1) }}</div>
                </div>
                <div>
                  <div class="tsx__feature-stat-label">SPOTS</div>
                  <div class="tsx__feature-stat-val">{{ featured.stats?.spots_remaining ?? 0 }} of {{ featured.entry_cap }}</div>
                </div>
              </div>
            </div>
            <div class="tsx__feature-right">
              <div class="tsx__feature-badges">
                <span class="tsx__feature-pill" :class="`tsx__feature-pill--${urgency(featured.entries_close_at).tone}`">
                  <span class="tsx__feature-pill-dot"></span>
                  {{ featured.stats?.spots_remaining ?? 0 }} spots · {{ urgency(featured.entries_close_at).label }}
                </span>
                <div class="tsx__feature-prize-label">PRIZE POOL</div>
              </div>
              <div class="tsx__feature-prize">
                <div class="tsx__feature-prize-val">{{ featured.prize_pool_cents ? formatMoney(featured.prize_pool_cents) : formatMoney(featured.entry_fee_cents * featured.entry_cap) }}</div>
                <div class="tsx__feature-prize-note">{{ featured.category.toUpperCase() }} · {{ featured.format.toUpperCase() }}<template v-if="featured.gender_scope"> · {{ featured.gender_scope.toUpperCase() }}</template></div>
              </div>
              <div class="tsx__feature-actions">
                <span class="tsx__feature-enter">
                  Enter
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6H10M10 6L7 3M10 6L7 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </span>
                <span class="tsx__feature-details">Details</span>
              </div>
            </div>
          </a>

          <div class="tsx__rows">
            <a v-for="t in rest" :key="t.id" :href="href(t)" class="tsx__row">
              <div class="tsx__row-rail" :class="`tsx__row-rail--${statusToneClass(t)}`"></div>
              <div class="tsx__row-avatar" :class="`tsx__row-avatar--${statusToneClass(t)}`">{{ initials(t.club.name) }}</div>
              <div class="tsx__row-body">
                <div class="tsx__row-meta">
                  <span class="tsx__row-meta-text">{{ t.club.name.toUpperCase() }} · {{ t.format.toUpperCase() }} · {{ t.category.toUpperCase() }}</span>
                  <span class="tsx__row-pill" :class="`tsx__row-pill--${statusToneClass(t)}`">{{ urgency(t.entries_close_at).label }}</span>
                </div>
                <div class="tsx__row-title">{{ t.title }}</div>
                <div class="tsx__row-sub">
                  {{ formatRowDate(t.starts_at) }}<template v-if="t.club.suburb"> · {{ t.club.suburb }}</template> · {{ formatMoney(t.entry_fee_cents) }} / team<template v-if="t.prize_pool_cents"> · {{ formatMoney(t.prize_pool_cents) }} prize pool</template>
                </div>
              </div>
              <div class="tsx__row-actions">
                <div class="tsx__row-close" :class="`tsx__row-close--${urgency(t.entries_close_at).tone}`">{{ urgency(t.entries_close_at).label }}</div>
                <span class="tsx__row-enter">Enter →</span>
              </div>
            </a>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.tsx {
  background: var(--site-bg, #FFFFFF);
  color: var(--site-ink, #0A0A0B);
  /* Break out of parent .page-blocks padding so the block spans the viewport,
     then re-apply the site's 1280px container formula. Matches EventsCalendarBlock. */
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
  padding: 64px max(48px, calc((100vw - var(--container-content, 1280px)) / 2)) 96px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 32px;
}
.tsx__inner { display: grid; grid-template-columns: 300px 1fr; gap: 32px; align-items: start; }

/* ── Left filter rail ─────────────────────────────────────────── */
.tsx__rail { position: sticky; top: 24px; display: flex; flex-direction: column; gap: 16px; }
.tsx__card { background: #FFFFFF; border: 1px solid #E7E7E1; border-radius: 16px; padding: 22px; display: flex; flex-direction: column; gap: 18px; }
.tsx__card-head { display: flex; align-items: center; justify-content: space-between; }
.tsx__card-title { font-family: var(--site-font-display, 'Space Grotesk', system-ui, sans-serif); font-weight: 700; font-size: 16px; color: var(--site-ink, #0A0A0B); letter-spacing: -0.01em; }
.tsx__reset { padding: 4px 10px; background: transparent; border: 0; font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 10px; color: #6B6B72; letter-spacing: 0.14em; font-weight: 600; cursor: pointer; }
.tsx__reset:hover { color: var(--site-ink, #0A0A0B); }

.tsx__group { display: flex; flex-direction: column; gap: 8px; }
.tsx__group-label { font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 10px; color: #6B6B72; letter-spacing: 0.14em; font-weight: 600; }
.tsx__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.tsx__chip { padding: 6px 12px; background: #FFFFFF; border: 1px solid #E7E7E1; border-radius: 999px; font-family: var(--site-font-body, 'Inter', system-ui, sans-serif); font-size: 12px; font-weight: 500; color: var(--site-ink, #0A0A0B); cursor: pointer; }
.tsx__chip:hover { border-color: #A3A39B; }
.tsx__chip.is-on { background: var(--site-ink, #0A0A0B); color: #FFFFFF; border-color: var(--site-ink, #0A0A0B); font-weight: 600; }

.tsx__toggle { display: flex; align-items: center; gap: 10px; padding-top: 8px; border-top: 1px solid #E7E7E1; cursor: pointer; }
.tsx__toggle input { width: 16px; height: 16px; accent-color: var(--site-ink, #0A0A0B); }
.tsx__toggle span { font-family: var(--site-font-body, 'Inter', system-ui, sans-serif); font-size: 12px; color: var(--site-ink, #0A0A0B); font-weight: 500; }

/* ── Head (spans full block width — mirrors EventsCalendarBlock) ─ */
.tsx__head { display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; flex-wrap: wrap; }
.tsx__head-text { display: flex; flex-direction: column; gap: 12px; max-width: 720px; }
.tsx__eyebrow { font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 12px; color: #6B6B72; letter-spacing: 0.14em; font-weight: 700; text-transform: uppercase; }
.tsx__eyebrow-accent { color: #16A34A; }
.tsx__heading { font-family: var(--site-font-display, 'Space Grotesk', system-ui, sans-serif); font-weight: 700; font-size: clamp(40px, 5vw, 64px); letter-spacing: -0.02em; line-height: 1.05; margin: 0; color: var(--site-ink, #0A0A0B); }
.tsx__desc { font-family: var(--site-font-body, 'Inter', system-ui, sans-serif); font-size: 15px; color: #6B6B72; line-height: 1.55; margin: 0; max-width: 560px; }

/* ── Main column ─────────────────────────────────────────────── */
.tsx__main { display: flex; flex-direction: column; gap: 20px; min-width: 0; }

.tsx__search { padding: 12px 16px; background: #FFFFFF; border: 1px solid #E7E7E1; border-radius: 12px; display: flex; align-items: center; gap: 10px; color: #6B6B72; }
.tsx__search input { flex: 1; border: 0; outline: 0; font-family: var(--site-font-body, 'Inter', system-ui, sans-serif); font-size: 14px; color: var(--site-ink, #0A0A0B); background: transparent; font-weight: 500; }
.tsx__clear { padding: 4px 10px; background: #F5F5F2; border: 0; border-radius: 999px; font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 10px; color: #6B6B72; letter-spacing: 0.12em; font-weight: 600; cursor: pointer; }

.tsx__stub, .tsx__empty { padding: 48px 32px; background: var(--site-bg-alt, #F5F5F2); border: 1px dashed #E7E7E1; border-radius: 16px; text-align: center; }
.tsx__stub-title, .tsx__empty-title { font-family: var(--site-font-display, 'Space Grotesk', system-ui, sans-serif); font-weight: 700; font-size: 22px; letter-spacing: -0.02em; color: var(--site-ink, #0A0A0B); margin-bottom: 6px; }
.tsx__stub-sub, .tsx__empty-sub { font-family: var(--site-font-body, 'Inter', system-ui, sans-serif); font-size: 14px; color: #6B6B72; max-width: 520px; margin: 0 auto; line-height: 150%; }

/* ── Featured card ───────────────────────────────────────────── */
.tsx__feature { display: grid; grid-template-columns: 45% 55%; background: #0A0A0B; border-radius: 16px; overflow: hidden; color: #FFFFFF; text-decoration: none; margin-bottom: 4px; transition: transform 0.15s ease; }
.tsx__feature:hover { transform: translateY(-2px); }
.tsx__feature--skeleton { display: block; height: 280px; background: transparent; }

.tsx__feature-left { padding: 24px; display: flex; flex-direction: column; justify-content: space-between; gap: 20px; background-size: cover; background-position: center; }
.tsx__feature-club { display: flex; align-items: center; gap: 10px; }
.tsx__feature-club-avatar { width: 32px; height: 32px; border-radius: 8px; background: rgba(255,255,255,0.14); border: 1px solid rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center; font-family: var(--site-font-display, 'Space Grotesk', system-ui, sans-serif); font-weight: 700; color: #FFFFFF; font-size: 12px; }
.tsx__feature-club-name { font-family: var(--site-font-body, 'Inter', system-ui, sans-serif); font-weight: 600; font-size: 12px; }
.tsx__feature-club-meta { font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 9px; opacity: 0.7; letter-spacing: 0.14em; margin-top: 2px; text-transform: uppercase; }
.tsx__feature-title { font-family: var(--site-font-display, 'Space Grotesk', system-ui, sans-serif); font-weight: 700; font-size: clamp(24px, 3vw, 32px); letter-spacing: -0.03em; line-height: 100%; margin: 0 0 8px; color: #FFFFFF; }
.tsx__feature-sub { font-family: var(--site-font-body, 'Inter', system-ui, sans-serif); font-size: 12px; opacity: 0.8; line-height: 145%; margin: 0; }
.tsx__feature-stats { display: flex; gap: 20px; }
.tsx__feature-stat-label { font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 9px; opacity: 0.6; letter-spacing: 0.14em; font-weight: 600; }
.tsx__feature-stat-val { font-family: var(--site-font-display, 'Space Grotesk', system-ui, sans-serif); font-weight: 700; font-size: 16px; letter-spacing: -0.02em; margin-top: 2px; color: #FFFFFF; }

.tsx__feature-right { padding: 24px 28px; display: flex; flex-direction: column; justify-content: space-between; gap: 20px; }
.tsx__feature-badges { display: flex; flex-direction: column; gap: 12px; }
.tsx__feature-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 10px; letter-spacing: 0.14em; font-weight: 700; align-self: flex-start; }
.tsx__feature-pill-dot { width: 5px; height: 5px; border-radius: 999px; background: currentColor; }
.tsx__feature-pill--mint { background: rgba(22,163,74,0.18); border: 1px solid rgba(22,163,74,0.3); color: #86EFAC; }
.tsx__feature-pill--tangerine { background: rgba(234,88,12,0.18); border: 1px solid rgba(234,88,12,0.3); color: #FDBA74; }
.tsx__feature-pill--fog { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.16); color: rgba(255,255,255,0.7); }
.tsx__feature-prize-label { font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 10px; opacity: 0.5; letter-spacing: 0.14em; font-weight: 600; }
.tsx__feature-prize-val { font-family: var(--site-font-display, 'Space Grotesk', system-ui, sans-serif); font-weight: 700; font-size: clamp(48px, 6vw, 80px); letter-spacing: -0.04em; line-height: 90%; color: #FFFFFF; }
.tsx__feature-prize-note { font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 11px; opacity: 0.5; letter-spacing: 0.14em; font-weight: 600; margin-top: 8px; }

.tsx__feature-actions { display: flex; align-items: center; gap: 10px; }
.tsx__feature-enter { flex: 1; padding: 12px 20px; background: #FFFFFF; color: #0A0A0B; border-radius: 999px; font-family: var(--site-font-body, 'Inter', system-ui, sans-serif); font-size: 13px; font-weight: 700; text-align: center; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
.tsx__feature-details { padding: 12px 18px; background: transparent; color: #FFFFFF; border: 1px solid rgba(255,255,255,0.2); border-radius: 999px; font-family: var(--site-font-body, 'Inter', system-ui, sans-serif); font-size: 13px; font-weight: 600; }

/* ── Row list ────────────────────────────────────────────────── */
.tsx__rows { display: flex; flex-direction: column; gap: 12px; }
.tsx__row { background: #FFFFFF; border: 1px solid #E7E7E1; border-radius: 14px; overflow: hidden; display: flex; align-items: center; text-decoration: none; color: inherit; transition: transform 0.15s ease, box-shadow 0.15s ease; }
.tsx__row:hover { transform: translateY(-1px); box-shadow: 0 8px 24px -10px rgba(10,10,11,0.12); }
.tsx__row-rail { width: 4px; align-self: stretch; flex-shrink: 0; }
.tsx__row-rail--mint { background: #16A34A; }
.tsx__row-rail--tangerine { background: #EA580C; }
.tsx__row-rail--violet { background: #7C3AED; }
.tsx__row-rail--fog { background: #A3A39B; }
.tsx__row-avatar { width: 56px; height: 56px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-family: var(--site-font-display, 'Space Grotesk', system-ui, sans-serif); font-weight: 700; color: #FFFFFF; font-size: 14px; flex-shrink: 0; margin: 18px 22px; }
.tsx__row-avatar--mint { background: linear-gradient(135deg, #16A34A 0%, #0F5132 100%); }
.tsx__row-avatar--tangerine { background: linear-gradient(135deg, #EA580C 0%, #DC2F3B 100%); }
.tsx__row-avatar--violet { background: linear-gradient(135deg, #7C3AED 0%, #2563EB 100%); }
.tsx__row-avatar--fog { background: linear-gradient(135deg, #A3A39B 0%, #6B6B72 100%); }
.tsx__row-body { flex: 1; min-width: 0; padding: 18px 0; }
.tsx__row-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap; }
.tsx__row-meta-text { font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 10px; color: #6B6B72; letter-spacing: 0.14em; font-weight: 600; }
.tsx__row-pill { padding: 2px 6px; border-radius: 999px; font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 9px; letter-spacing: 0.12em; font-weight: 700; }
.tsx__row-pill--mint { background: rgba(22,163,74,0.14); color: #16A34A; }
.tsx__row-pill--tangerine { background: rgba(234,88,12,0.14); color: #EA580C; }
.tsx__row-pill--violet { background: rgba(124,58,237,0.14); color: #7C3AED; }
.tsx__row-pill--fog { background: #F5F5F2; color: #6B6B72; }
.tsx__row-title { font-family: var(--site-font-display, 'Space Grotesk', system-ui, sans-serif); font-weight: 700; font-size: 22px; color: var(--site-ink, #0A0A0B); letter-spacing: -0.02em; line-height: 105%; margin-bottom: 4px; }
.tsx__row-sub { font-family: var(--site-font-body, 'Inter', system-ui, sans-serif); font-size: 12px; color: #6B6B72; }
.tsx__row-actions { padding: 18px 22px; text-align: right; flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.tsx__row-close { font-family: var(--site-font-mono, 'JetBrains Mono', monospace); font-size: 10px; letter-spacing: 0.14em; font-weight: 600; }
.tsx__row-close--mint { color: #16A34A; }
.tsx__row-close--tangerine { color: #EA580C; }
.tsx__row-close--fog { color: #6B6B72; }
.tsx__row-enter { padding: 6px 14px; background: var(--site-ink, #0A0A0B); color: #FFFFFF; border-radius: 999px; font-family: var(--site-font-body, 'Inter', system-ui, sans-serif); font-size: 12px; font-weight: 600; }

@media (max-width: 1023px) {
  .tsx { padding: 56px 24px; }
  .tsx__inner { grid-template-columns: 1fr; gap: 24px; }
  .tsx__rail { position: static; }
  .tsx__feature { grid-template-columns: 1fr; }
  .tsx__row { flex-wrap: wrap; }
  .tsx__row-actions { padding: 0 22px 18px 22px; text-align: left; align-items: flex-start; }
}
</style>
