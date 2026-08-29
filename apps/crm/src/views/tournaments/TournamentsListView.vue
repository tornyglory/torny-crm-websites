<script setup lang="ts">
/**
 * CRM Tournaments — list of this club's tournaments.
 *
 * Design lives on Paper canvas ("CRM · Tournaments — Desktop"). Metric
 * row + segmented status tabs + card rows, one per tournament, with
 * capacity progress bar, revenue and CTA to drill into entries.
 *
 * Backend: brief 47 — endpoints under /clubs/{id}/tournaments.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import {
  ApiError,
  tournaments as tournamentsApi,
  type TournamentListItem,
  type TournamentsListResponse,
  type TournamentStatus,
} from '@torny/api-client'
import { useToast } from '@/composables/useToast'
import { useClubStore } from '@/stores/club'

const toast = useToast()
const clubStore = useClubStore()

const rows = ref<TournamentListItem[]>([])
const loading = ref(false)
const activeStatus = ref<TournamentStatus | 'all'>('published')
const searchQuery = ref('')
const startsAfter = ref('')
const startsBefore = ref('')

const EMPTY_COUNTS = {
  draft: 0,
  published: 0,
  entries_closed: 0,
  in_progress: 0,
  complete: 0,
  cancelled: 0,
}
const backendCounts = ref<Record<TournamentStatus, number>>({ ...EMPTY_COUNTS })

/** 250ms debounce so we don't fire on every keystroke. */
const debouncedQuery = ref('')
let searchDebounce: ReturnType<typeof setTimeout> | null = null
watch(searchQuery, (q) => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => { debouncedQuery.value = q.trim() }, 250)
})

async function load() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  loading.value = true
  try {
    const res: TournamentsListResponse = await tournamentsApi.list(cid, {
      status: activeStatus.value === 'all' ? undefined : activeStatus.value,
      q: debouncedQuery.value || undefined,
      starts_after: startsAfter.value || undefined,
      starts_before: startsBefore.value || undefined,
      limit: 50,
    })
    rows.value = res.tournaments
    backendCounts.value = res.counts
      ? { ...EMPTY_COUNTS, ...res.counts }
      : { ...EMPTY_COUNTS }
    // Broadcast the "active" count for the sidebar badge to consume.
    const c = backendCounts.value
    const active = c.draft + c.published + c.entries_closed + c.in_progress
    window.dispatchEvent(new CustomEvent('torny:tournaments-count', { detail: active }))
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      rows.value = []
      backendCounts.value = { ...EMPTY_COUNTS }
    } else {
      toast.error(err instanceof ApiError ? err.message : 'Could not load tournaments.')
    }
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => clubStore.current?.id, load)
watch(activeStatus, load)
watch([debouncedQuery, startsAfter, startsBefore], load)

function clearFilters() {
  searchQuery.value = ''
  debouncedQuery.value = ''
  startsAfter.value = ''
  startsBefore.value = ''
}

const hasActiveFilters = computed(
  () => debouncedQuery.value !== '' || startsAfter.value !== '' || startsBefore.value !== '',
)

// ── Metric aggregation (from the loaded rows) ──────────────────
// Sidebar could later broadcast live counts; for now we surface what's
// present on screen so admins get a live sense of season revenue.
const summary = computed(() => {
  const live = rows.value.filter(r =>
    r.status === 'published' || r.status === 'entries_closed' || r.status === 'in_progress',
  ).length
  const closingSoon = rows.value.filter((r) => {
    if (r.status !== 'published' || !r.entries_close_at) return false
    const closes = new Date(r.entries_close_at).getTime()
    const now = Date.now()
    const daysLeft = (closes - now) / 86400000
    return daysLeft > 0 && daysLeft <= 3
  }).length
  const confirmed = rows.value.reduce((n, r) => n + r.stats.confirmed_count, 0)
  const paid = rows.value.reduce((n, r) => n + (r.stats.revenue_paid_cents ?? 0), 0)
  const pending = rows.value.reduce((n, r) => n + (r.stats.revenue_pending_cents ?? 0), 0)
  const waitlist = rows.value.reduce((n, r) => n + r.stats.waitlist_count, 0)
  return { live, closingSoon, confirmed, paid, pending, waitlist }
})

const tabs: Array<{ value: TournamentStatus | 'all'; label: string }> = [
  { value: 'published', label: 'Open' },
  { value: 'draft', label: 'Draft' },
  { value: 'entries_closed', label: 'Scheduled' },
  { value: 'complete', label: 'Complete' },
  { value: 'all', label: 'All' },
]

const STATUS_TONE: Record<TournamentStatus, 'mint' | 'accent' | 'tangerine' | 'violet' | 'fog'> = {
  draft: 'fog',
  published: 'mint',
  entries_closed: 'violet',
  in_progress: 'accent',
  complete: 'fog',
  cancelled: 'tangerine',
}

function daysUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 86400000)
}

function statusLabel(row: TournamentListItem): string {
  if (row.status === 'draft') return 'Draft'
  if (row.status === 'complete') return 'Complete'
  if (row.status === 'cancelled') return 'Cancelled'
  if (row.status === 'in_progress') return 'In progress'
  if (row.status === 'entries_closed') return 'Entries closed'
  if (!row.entries_close_at) return 'Taking entries'
  const dLeft = daysUntil(row.entries_close_at)
  if (dLeft < 0) return 'Entries closed'
  if (dLeft <= 3) return `Closes in ${dLeft} day${dLeft === 1 ? '' : 's'}`
  return 'Taking entries'
}

function formatDate(iso: string | null): string {
  if (!iso) return 'TBC'
  try {
    return new Date(iso).toLocaleDateString('en-NZ', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })
  } catch { return iso }
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-NZ', { maximumFractionDigits: 0 })}`
}

function capacityPct(row: TournamentListItem): number {
  if (row.entry_cap <= 0) return 0
  return Math.round((row.stats.confirmed_count / row.entry_cap) * 100)
}

/** Status counts come straight from the backend list envelope. */
const tabCounts = computed<Record<string, number>>(() => backendCounts.value)
</script>

<template>
  <div class="tx">
    <header class="tx__head">
      <div>
        <div class="tx__eyebrow">Tournaments</div>
        <h1 class="tx__title">Run the comp.</h1>
        <p class="tx__sub">Create, publish and take entries — one place.</p>
      </div>
      <RouterLink :to="{ name: 'tournament-new' }" class="primary-btn">+ New tournament</RouterLink>
    </header>

    <section class="metrics">
      <article class="metric">
        <div class="metric__label">LIVE TOURNAMENTS</div>
        <div class="metric__row">
          <div class="metric__val">{{ summary.live }}</div>
          <div v-if="summary.closingSoon > 0" class="metric__delta metric__delta--warn">
            {{ summary.closingSoon }} closing soon
          </div>
        </div>
      </article>
      <article class="metric">
        <div class="metric__label">ENTRIES THIS SEASON</div>
        <div class="metric__row">
          <div class="metric__val">{{ summary.confirmed }}</div>
        </div>
      </article>
      <article class="metric">
        <div class="metric__label">REVENUE COLLECTED</div>
        <div class="metric__row">
          <div class="metric__val">{{ formatMoney(summary.paid) }}</div>
          <div v-if="summary.pending > 0" class="metric__delta">
            {{ formatMoney(summary.pending) }} pending
          </div>
        </div>
      </article>
      <article class="metric">
        <div class="metric__label">WAITLIST</div>
        <div class="metric__row">
          <div class="metric__val">{{ summary.waitlist }}</div>
          <div class="metric__delta">teams waiting</div>
        </div>
      </article>
    </section>

    <div class="filters">
      <label class="search">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.4"/><path d="M9 9L12 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        <input v-model="searchQuery" type="search" placeholder="Search tournament titles…" />
      </label>
      <div class="date-range">
        <span class="date-range__label">From</span>
        <input v-model="startsAfter" type="date" />
        <span class="date-range__sep">→</span>
        <input v-model="startsBefore" type="date" />
      </div>
      <button v-if="hasActiveFilters" type="button" class="reset-btn" @click="clearFilters">Clear</button>
    </div>

    <div class="tabs">
      <button
        v-for="t in tabs"
        :key="t.value"
        type="button"
        class="tab"
        :class="{ 'is-on': activeStatus === t.value }"
        @click="activeStatus = t.value"
      >
        {{ t.label }}
        <span v-if="t.value !== 'all' && tabCounts[t.value] != null" class="tab__count">
          {{ tabCounts[t.value] }}
        </span>
      </button>
    </div>

    <div v-if="loading" class="empty">Loading…</div>

    <div v-else-if="rows.length === 0" class="empty">
      <div class="empty__title">No tournaments here yet.</div>
      <div class="empty__sub">Create your first tournament to start taking entries.</div>
    </div>

    <ul v-else class="rows">
      <li v-for="row in rows" :key="row.id">
        <RouterLink
          :to="{ name: 'tournament-detail', params: { id: row.id } }"
          class="row"
        >
          <div class="row__rail" :class="`row__rail--${STATUS_TONE[row.status]}`" aria-hidden="true"></div>
          <div class="row__body">
            <div class="row__meta">
              <span class="row__meta-type">{{ row.format }} · {{ row.category }}</span>
              <span class="row__meta-dot"></span>
              <span class="row__meta-date">{{ formatDate(row.starts_at) }}</span>
              <span
                class="row__status"
                :class="`row__status--${STATUS_TONE[row.status]}`"
              >
                <span class="row__status-dot"></span>
                {{ statusLabel(row) }}
              </span>
            </div>
            <div class="row__title">{{ row.title }}</div>
            <div class="row__stats">
              <div class="stat">
                <div class="stat__label">ENTRIES</div>
                <div class="stat__val">
                  {{ row.stats.confirmed_count }}
                  <span class="stat__cap">/ {{ row.entry_cap }} {{ row.entry_cap === 1 ? 'team' : 'teams' }}</span>
                </div>
                <div class="progress">
                  <div
                    class="progress__fill"
                    :class="`progress__fill--${STATUS_TONE[row.status]}`"
                    :style="{ width: `${capacityPct(row)}%` }"
                  ></div>
                </div>
              </div>
              <div class="stat">
                <div class="stat__label">REVENUE</div>
                <div class="stat__val">
                  {{ formatMoney(row.stats.revenue_paid_cents ?? 0) }}
                  <span
                    v-if="(row.stats.revenue_pending_cents ?? 0) > 0"
                    class="stat__cap stat__cap--warn"
                  >
                    {{ formatMoney(row.stats.revenue_pending_cents ?? 0) }} due
                  </span>
                  <span v-else class="stat__cap stat__cap--good">✓ paid</span>
                </div>
              </div>
              <div class="stat">
                <div class="stat__label">WAITLIST</div>
                <div class="stat__val">
                  {{ row.stats.waitlist_count > 0 ? row.stats.waitlist_count : '—' }}
                </div>
              </div>
            </div>
          </div>
          <div class="row__cta">
            <div class="row__cta-primary">Manage entries →</div>
            <div class="row__cta-secondary">Public page ↗</div>
          </div>
        </RouterLink>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.tx { max-width: 1280px; }

.tx__head { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.tx__eyebrow { font-family: var(--font-mono); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-fog); }
.tx__title { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.tx__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; }

.primary-btn { padding: 10px 18px; border-radius: 999px; background: var(--color-ink); color: #fff; font-family: var(--font-body); font-weight: 600; font-size: 13px; border: 0; cursor: pointer; }

.metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
.metric { padding: 16px 20px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 12px; }
.metric__label { font-family: var(--font-mono); font-size: 10px; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); margin-bottom: 6px; }
.metric__row { display: flex; align-items: baseline; gap: 8px; }
.metric__val { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); line-height: 100%; }
.metric__delta { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; color: var(--color-fog); }
.metric__delta--warn { color: var(--color-feature-tangerine); }

.filters { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.search { flex: 1; min-width: 240px; max-width: 360px; padding: 8px 14px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; display: flex; align-items: center; gap: 8px; color: var(--color-fog); }
.search input { flex: 1; border: 0; outline: 0; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: transparent; }
.date-range { display: flex; align-items: center; gap: 6px; padding: 4px 12px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; }
.date-range__label { font-family: var(--font-mono); font-size: 10px; color: var(--color-fog); letter-spacing: 0.12em; font-weight: 600; text-transform: uppercase; }
.date-range__sep { color: var(--color-mute); }
.date-range input { border: 0; outline: 0; font-family: var(--font-body); font-size: 12px; color: var(--color-ink); background: transparent; padding: 4px 0; }
.reset-btn { padding: 8px 14px; background: transparent; border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-body); font-size: 12px; font-weight: 600; color: var(--color-fog); cursor: pointer; }
.reset-btn:hover { color: var(--color-ink); border-color: var(--color-ink); }
.tabs { display: flex; gap: 4px; margin-bottom: 20px; padding: 4px; background: var(--color-surface); border-radius: 999px; width: fit-content; }
.tab { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 999px; background: transparent; border: 0; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); cursor: pointer; text-transform: capitalize; }
.tab.is-on { background: var(--color-ink); color: #fff; font-weight: 600; }
.tab__count { font-family: var(--font-mono); font-size: 10px; padding: 1px 6px; background: var(--color-hairline); color: var(--color-graphite); border-radius: 999px; line-height: 100%; }
.tab.is-on .tab__count { background: rgba(255, 255, 255, 0.15); color: #fff; }

.empty { padding: 48px 32px; background: #fff; border: 1px dashed var(--color-hairline); border-radius: 14px; text-align: center; }
.empty__title { font-family: var(--font-display); font-size: 18px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); margin-bottom: 4px; }
.empty__sub { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); }

.rows { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
.row { display: flex; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; overflow: hidden; text-decoration: none; color: inherit; }
.row:hover { border-color: var(--color-graphite); }
.row__rail { width: 8px; flex-shrink: 0; }
.row__rail--mint { background: var(--color-feature-mint); }
.row__rail--accent { background: var(--color-accent); }
.row__rail--tangerine { background: var(--color-feature-tangerine); }
.row__rail--violet { background: var(--color-feature-violet); }
.row__rail--fog { background: var(--color-hairline); }
.row__body { flex: 1; padding: 20px 24px; min-width: 0; }
.row__meta { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.row__meta-type { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); font-weight: 600; }
.row__meta-dot { width: 3px; height: 3px; border-radius: 999px; background: var(--color-hairline); }
.row__meta-date { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); font-weight: 600; }
.row__status { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border-radius: 999px; font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; }
.row__status-dot { width: 5px; height: 5px; border-radius: 999px; }
.row__status--mint { color: var(--color-feature-mint); background: color-mix(in srgb, var(--color-feature-mint) 12%, transparent); }
.row__status--mint .row__status-dot { background: var(--color-feature-mint); }
.row__status--accent { color: var(--color-accent-strong); background: color-mix(in srgb, var(--color-accent) 12%, transparent); }
.row__status--accent .row__status-dot { background: var(--color-accent); }
.row__status--tangerine { color: var(--color-feature-tangerine); background: color-mix(in srgb, var(--color-feature-tangerine) 12%, transparent); }
.row__status--tangerine .row__status-dot { background: var(--color-feature-tangerine); }
.row__status--violet { color: var(--color-feature-violet); background: color-mix(in srgb, var(--color-feature-violet) 12%, transparent); }
.row__status--violet .row__status-dot { background: var(--color-feature-violet); }
.row__status--fog { color: var(--color-fog); background: var(--color-surface); }
.row__status--fog .row__status-dot { background: var(--color-fog); }

.row__title { font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); margin-bottom: 16px; }
.row__stats { display: flex; gap: 32px; align-items: flex-end; }
.stat { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.stat__label { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); font-weight: 600; }
.stat__val { font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); line-height: 100%; }
.stat__cap { font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); margin-left: 4px; }
.stat__cap--warn { color: var(--color-feature-tangerine); }
.stat__cap--good { color: var(--color-feature-mint); }
.progress { height: 4px; background: var(--color-surface); border-radius: 999px; overflow: hidden; margin-top: 4px; }
.progress__fill { height: 100%; border-radius: 999px; }
.progress__fill--mint { background: var(--color-feature-mint); }
.progress__fill--accent { background: var(--color-accent); }
.progress__fill--tangerine { background: var(--color-feature-tangerine); }
.progress__fill--violet { background: var(--color-feature-violet); }
.progress__fill--fog { background: var(--color-mute); }

.row__cta { display: flex; flex-direction: column; align-items: flex-end; justify-content: space-between; padding: 20px 24px; border-left: 1px solid var(--color-hairline); background: #fff; gap: 6px; flex-shrink: 0; min-width: 160px; }
.row__cta-primary { padding: 8px 14px; background: var(--color-ink); color: #fff; border-radius: 999px; font-family: var(--font-body); font-size: 12px; font-weight: 600; }
.row__cta-secondary { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); font-weight: 500; }

@media (max-width: 1023px) {
  .metrics { grid-template-columns: 1fr 1fr; }
}
</style>
