<script setup lang="ts">
/**
 * Events calendar — full-page block matching the Paper "What's on the greens"
 * design. Month grid on the left with event chips per day, filter chips for
 * event types, plus a right column with highlights + "This month at a glance"
 * stats.
 *
 * Wired to brief 33's public endpoints via api-client:
 *   - events.publicList(slug, { since, until, type }) — one fetch per
 *     visible month; refetches on prev / next.
 *   - events.publicIcalUrl(slug) — powers the "Add to my calendar" button.
 *
 * In the CRM preview, `clubSlug` from BlockContext is null → renders a
 * friendly placeholder instead of firing off requests that 404.
 */
import { computed, inject, isRef, onMounted, ref, watch, type Ref } from 'vue'
import { events as eventsApi, type PublicEvent } from '@torny/api-client'
import { BLOCK_CONTEXT_KEY, type BlockContext, type EventsCalendarProps } from '../types'

const props = withDefaults(defineProps<EventsCalendarProps>(), {
  eyebrow: '',
  heading: "What's on the greens.",
  description: '',
  highlightsCount: 4,
  showIcalExport: true,
})

const ctxRef = inject<Ref<BlockContext> | BlockContext | null>(BLOCK_CONTEXT_KEY, null)
const ctx = computed<BlockContext | null>(() => {
  if (!ctxRef) return null
  return isRef(ctxRef) ? ctxRef.value : ctxRef
})
const clubSlug = computed<string | null>(() => ctx.value?.clubSlug ?? null)
const brand = computed(() => ctx.value?.brandPrimary ?? '#2563EB')

/** Local alias — the block only cares about `PublicEvent` fields. */
type EventEntry = PublicEvent

// ── Visible month state ────────────────────────────────────────
const today = new Date()
const visibleYear = ref<number>(today.getFullYear())
const visibleMonth = ref<number>(today.getMonth()) // 0-indexed

function firstOfMonth(y: number, m: number): Date {
  return new Date(y, m, 1)
}
function lastOfMonth(y: number, m: number): Date {
  return new Date(y, m + 1, 0)
}

function prevMonth() {
  const d = new Date(visibleYear.value, visibleMonth.value - 1, 1)
  visibleYear.value = d.getFullYear()
  visibleMonth.value = d.getMonth()
}
function nextMonth() {
  const d = new Date(visibleYear.value, visibleMonth.value + 1, 1)
  visibleYear.value = d.getFullYear()
  visibleMonth.value = d.getMonth()
}
function goToToday() {
  visibleYear.value = today.getFullYear()
  visibleMonth.value = today.getMonth()
}

const monthLabel = computed(() =>
  new Date(visibleYear.value, visibleMonth.value, 1).toLocaleString('en-NZ', {
    month: 'long',
    year: 'numeric',
  }),
)

// ISO week number (rough — good enough for the eyebrow).
const weekNumber = computed(() => {
  const d = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
})

// ── Fetch (brief 33) ───────────────────────────────────────────
const monthEventsFetched = ref<EventEntry[]>([])
const fetching = ref(false)
let fetchAbort: AbortController | null = null

async function loadMonth() {
  if (!clubSlug.value) return
  if (fetchAbort) fetchAbort.abort()
  fetchAbort = new AbortController()
  fetching.value = true
  try {
    const first = firstOfMonth(visibleYear.value, visibleMonth.value)
    // `until` exclusive — one day past end of month covers the last day fully.
    const until = new Date(visibleYear.value, visibleMonth.value + 1, 1)
    const res = await eventsApi.publicList(
      clubSlug.value,
      {
        since: first.toISOString(),
        until: until.toISOString(),
        limit: 500,
      },
      { signal: fetchAbort.signal },
    )
    monthEventsFetched.value = res.events
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    monthEventsFetched.value = []
  } finally {
    fetching.value = false
  }
}

onMounted(() => { if (clubSlug.value) void loadMonth() })
watch([clubSlug, visibleYear, visibleMonth], () => { void loadMonth() })

// ── Filter chips ───────────────────────────────────────────────
// Aligned to the backend whitelist (brief 33 §5).
type FilterEventType = 'all' | 'tournament' | 'pennant' | 'social' | 'training' | 'other'
type LiveEventType = Exclude<FilterEventType, 'all'>

const TYPE_META: Record<LiveEventType, { label: string; color: string }> = {
  tournament: { label: 'Tournament', color: '#1F2937' },
  pennant:    { label: 'Pennant',    color: '#0369A1' },
  social:     { label: 'Social',     color: '#DC2626' },
  training:   { label: 'Training',   color: '#7C3AED' },
  other:      { label: 'Other',      color: '#6B7280' },
}

const activeType = ref<FilterEventType>('all')

const eventTypeCounts = computed<Record<LiveEventType, number>>(() => {
  const counts: Record<LiveEventType, number> = { tournament: 0, pennant: 0, social: 0, training: 0, other: 0 }
  for (const e of monthEventsFetched.value) {
    const key = ((e.event_type as LiveEventType) in counts ? e.event_type : 'other') as LiveEventType
    counts[key] += 1
  }
  return counts
})

const availableTypes = computed<LiveEventType[]>(() =>
  (Object.keys(TYPE_META) as LiveEventType[]).filter((t) => eventTypeCounts.value[t] > 0),
)

// ── Events in the visible month (server already scoped by range) ─
const monthEvents = computed<EventEntry[]>(() => {
  if (activeType.value === 'all') return monthEventsFetched.value
  return monthEventsFetched.value.filter((e) => e.event_type === activeType.value)
})

const eventsByDay = computed<Map<number, EventEntry[]>>(() => {
  const map = new Map<number, EventEntry[]>()
  for (const e of monthEvents.value) {
    const day = new Date(e.starts_at).getDate()
    const bucket = map.get(day)
    if (bucket) bucket.push(e)
    else map.set(day, [e])
  }
  return map
})

// ── Calendar grid ──────────────────────────────────────────────
type Cell = { day: number | null; inMonth: boolean; date?: Date }
const calendarCells = computed<Cell[]>(() => {
  const first = firstOfMonth(visibleYear.value, visibleMonth.value)
  const last = lastOfMonth(visibleYear.value, visibleMonth.value)
  // JS Sunday=0; we want Monday=0.
  const startPad = (first.getDay() + 6) % 7
  const cells: Cell[] = []
  for (let i = 0; i < startPad; i++) cells.push({ day: null, inMonth: false })
  for (let d = 1; d <= last.getDate(); d++) {
    cells.push({ day: d, inMonth: true, date: new Date(visibleYear.value, visibleMonth.value, d) })
  }
  // Pad to a full 6x7 (or 5x7 min) grid so the layout doesn't wobble
  const rowSize = 7
  while (cells.length % rowSize !== 0) cells.push({ day: null, inMonth: false })
  return cells
})

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function isToday(date?: Date): boolean {
  if (!date) return false
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  )
}

// ── Highlights (right column) ──────────────────────────────────
const highlights = computed<EventEntry[]>(() =>
  monthEvents.value
    .slice()
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
    .slice(0, props.highlightsCount),
)

// ── Stats ──────────────────────────────────────────────────────
const monthStats = computed(() => {
  const events = monthEvents.value
  const going = events.reduce((sum, e) => sum + (e.rsvp_going_count ?? 0), 0)
  return {
    events: events.length,
    going,
  }
})

// ── Display helpers ────────────────────────────────────────────
function typeColor(t: string | null | undefined): string {
  const key = (t ?? 'other') as LiveEventType
  return TYPE_META[key]?.color ?? TYPE_META.other.color
}
function typeLabel(t: string | null | undefined): string {
  const key = (t ?? 'other') as LiveEventType
  return TYPE_META[key]?.label ?? 'Other'
}
function formatTimeRange(iso: string, endIso?: string | null): string {
  const start = new Date(iso).toLocaleString('en-NZ', {
    hour: 'numeric',
    minute: '2-digit',
  })
  if (!endIso) return start
  const end = new Date(endIso).toLocaleString('en-NZ', {
    hour: 'numeric',
    minute: '2-digit',
  })
  return `${start} – ${end}`
}
function formatShortDate(iso: string): { day: string; month: string } {
  const d = new Date(iso)
  return {
    day: String(d.getDate()).padStart(2, '0'),
    month: d.toLocaleString('en-NZ', { month: 'short' }).toUpperCase(),
  }
}

const icalUrl = computed(() => (clubSlug.value ? eventsApi.publicIcalUrl(clubSlug.value) : null))
</script>

<template>
  <section class="evc" :style="{ '--brand': brand } as any">
    <!-- Head -->
    <header class="evc__head">
      <div class="evc__head-text">
        <div class="evc__eyebrow">
          <template v-if="props.eyebrow">{{ props.eyebrow }}</template>
          <template v-else>{{ monthLabel.toUpperCase() }} · WEEK {{ weekNumber }}</template>
        </div>
        <h2 class="evc__title">{{ props.heading }}</h2>
        <p v-if="props.description" class="evc__sub">{{ props.description }}</p>
      </div>
      <!-- Month/List/Team toggle would live here — MVP renders only Month. -->
    </header>

    <!-- CRM-preview placeholder — no clubSlug means no data. -->
    <div v-if="!clubSlug" class="evc__placeholder">
      <div class="evc__placeholder-title">Events calendar</div>
      <p>Preview shows on the public site — this block renders the full club calendar with filter chips, highlights, and monthly stats.</p>
    </div>

    <template v-else>
      <!-- Toolbar -->
      <div class="evc__toolbar">
        <div class="evc__month-nav">
          <button type="button" class="evc__month-btn" aria-label="Previous month" @click="prevMonth">‹</button>
          <div class="evc__month-label">{{ monthLabel }}</div>
          <button type="button" class="evc__month-btn" aria-label="Next month" @click="nextMonth">›</button>
          <button type="button" class="evc__today" @click="goToToday">Today</button>
        </div>

        <div class="evc__chips" aria-label="Filter by type">
          <button
            type="button"
            class="evc__chip"
            :class="{ 'evc__chip--active': activeType === 'all' }"
            @click="activeType = 'all'"
          >
            <span class="evc__chip-dot" :style="{ background: '#111' } as any" />
            <span>All</span>
            <span class="evc__chip-count">{{ monthEvents.length }}</span>
          </button>
          <button
            v-for="t in availableTypes"
            :key="t"
            type="button"
            class="evc__chip"
            :class="{ 'evc__chip--active': activeType === t }"
            @click="activeType = t"
          >
            <span class="evc__chip-dot" :style="{ background: TYPE_META[t].color } as any" />
            <span>{{ TYPE_META[t].label }}</span>
            <span class="evc__chip-count">{{ eventTypeCounts[t] }}</span>
          </button>
        </div>

        <a
          v-if="props.showIcalExport && icalUrl"
          :href="icalUrl"
          class="evc__ical"
          aria-label="Add to my calendar"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
          <span>Add to my calendar</span>
        </a>
      </div>

      <!-- Grid + side panel -->
      <div class="evc__body">
        <div class="cal">
          <!-- Weekday header -->
          <div class="cal__week">
            <div v-for="w in WEEKDAY_LABELS" :key="w" class="cal__wday">{{ w }}</div>
          </div>
          <!-- Day cells -->
          <div class="cal__grid">
            <div
              v-for="(cell, i) in calendarCells"
              :key="i"
              class="cal__cell"
              :class="{
                'cal__cell--empty': !cell.inMonth,
                'cal__cell--today': isToday(cell.date),
              }"
            >
              <div v-if="cell.day != null" class="cal__day">{{ cell.day }}</div>
              <div v-if="cell.day != null && eventsByDay.get(cell.day)" class="cal__events">
                <div
                  v-for="e in eventsByDay.get(cell.day)"
                  :key="e.id"
                  class="cal__event"
                  :style="{ background: typeColor(e.event_type) + '18', color: typeColor(e.event_type), borderLeftColor: typeColor(e.event_type) } as any"
                  :title="`${e.title} · ${formatTimeRange(e.starts_at, e.ends_at)}${e.location ? ' · ' + e.location : ''}`"
                >
                  {{ e.title }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <aside class="side">
          <div class="side__label">Highlights</div>
          <div v-if="highlights.length === 0" class="side__empty">
            Nothing scheduled this month.
          </div>
          <ul v-else class="side__list">
            <li v-for="e in highlights" :key="e.id" class="hl">
              <div class="hl__date">
                <div class="hl__date-month">{{ formatShortDate(e.starts_at).month }}</div>
                <div class="hl__date-day">{{ formatShortDate(e.starts_at).day }}</div>
              </div>
              <div class="hl__body">
                <div class="hl__title">{{ e.title }}</div>
                <div class="hl__meta">
                  <span>{{ formatTimeRange(e.starts_at, e.ends_at) }}</span>
                  <template v-if="e.location">
                    <span class="hl__sep">·</span><span>{{ e.location }}</span>
                  </template>
                </div>
                <div class="hl__tags">
                  <span class="hl__type" :style="{ color: typeColor(e.event_type) } as any">{{ typeLabel(e.event_type) }}</span>
                  <span v-if="e.rsvp_going_count" class="hl__going">{{ e.rsvp_going_count }} going</span>
                </div>
              </div>
            </li>
          </ul>

          <div class="stats">
            <div class="stats__label">This month at a glance</div>
            <div class="stats__row">
              <div class="stats__num">{{ monthStats.events }}</div>
              <div class="stats__key">Events</div>
            </div>
            <div class="stats__row">
              <div class="stats__num">{{ monthStats.going }}</div>
              <div class="stats__key">Members going</div>
            </div>
          </div>
        </aside>
      </div>
    </template>
  </section>
</template>

<style scoped>
.evc { display: flex; flex-direction: column; gap: 32px; padding: 64px 0; }

/* Head */
.evc__head { display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; flex-wrap: wrap; }
.evc__head-text { display: flex; flex-direction: column; gap: 12px; max-width: 720px; }
.evc__eyebrow { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }
.evc__title { font-family: var(--font-display); font-size: clamp(40px, 5vw, 64px); font-weight: 700; letter-spacing: -0.02em; margin: 0; color: var(--color-ink); line-height: 1.05; }
.evc__sub { font-family: var(--font-body); font-size: 15px; color: var(--color-graphite); margin: 0; max-width: 560px; line-height: 1.55; }

.evc__placeholder { padding: 40px; text-align: center; background: var(--color-surface); border: 1px dashed var(--color-hairline); border-radius: 16px; font-family: var(--font-body); color: var(--color-graphite); }
.evc__placeholder-title { font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-ink); margin-bottom: 6px; }

/* Toolbar */
.evc__toolbar { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.evc__month-nav { display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 999px; }
.evc__month-btn { width: 26px; height: 26px; border-radius: 999px; background: transparent; border: 0; cursor: pointer; font-family: var(--font-body); font-size: 18px; color: var(--color-ink); line-height: 1; padding: 0; }
.evc__month-btn:hover { background: var(--color-surface); }
.evc__month-label { font-family: var(--font-body); font-weight: 600; color: var(--color-ink); padding: 0 8px; min-width: 130px; text-align: center; }
.evc__today { padding: 6px 12px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-body); font-size: 12px; font-weight: 600; color: var(--color-ink); cursor: pointer; }
.evc__today:hover { background: var(--color-surface); }

.evc__chips { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; min-width: 280px; }
.evc__chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: transparent; border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-body); font-size: 12px; color: var(--color-graphite); cursor: pointer; }
.evc__chip:hover { background: #fff; }
.evc__chip--active { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.evc__chip-dot { width: 6px; height: 6px; border-radius: 999px; flex-shrink: 0; }
.evc__chip-count { font-family: var(--font-mono); font-size: 10px; opacity: 0.7; }

.evc__ical { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; background: var(--color-ink); color: #fff; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; text-decoration: none; }
.evc__ical:hover { background: var(--color-graphite); }

/* Body: grid + side */
.evc__body { display: grid; grid-template-columns: 1fr 300px; gap: 24px; align-items: start; }

/* Calendar */
.cal { background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; overflow: hidden; }
.cal__week { display: grid; grid-template-columns: repeat(7, 1fr); background: var(--color-surface); border-bottom: 1px solid var(--color-hairline); }
.cal__wday { padding: 10px 12px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.cal__grid { display: grid; grid-template-columns: repeat(7, 1fr); }
.cal__cell { border-right: 1px solid var(--color-hairline); border-bottom: 1px solid var(--color-hairline); min-height: 96px; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; background: #fff; }
.cal__cell:nth-child(7n) { border-right: 0; }
.cal__cell--empty { background: var(--color-surface); }
.cal__cell--today .cal__day { background: var(--color-ink); color: #fff; }
.cal__day { font-family: var(--font-mono); font-size: 12px; font-weight: 600; color: var(--color-graphite); width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; }
.cal__events { display: flex; flex-direction: column; gap: 3px; }
.cal__event { font-family: var(--font-body); font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; border-left: 3px solid; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Side */
.side { display: flex; flex-direction: column; gap: 20px; }
.side__label { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.side__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.side__empty { padding: 20px; background: #fff; border: 1px dashed var(--color-hairline); border-radius: 12px; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); text-align: center; }

.hl { display: flex; gap: 12px; padding: 12px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; }
.hl__date { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 44px; padding: 6px 4px; background: var(--color-ink); color: #fff; border-radius: 8px; flex-shrink: 0; }
.hl__date-month { font-family: var(--font-mono); font-size: 9px; font-weight: 700; letter-spacing: 0.08em; opacity: 0.8; }
.hl__date-day { font-family: var(--font-display); font-size: 18px; font-weight: 700; line-height: 1; margin-top: 2px; }
.hl__body { flex: 1; min-width: 0; }
.hl__title { font-family: var(--font-display); font-size: 14px; font-weight: 600; color: var(--color-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hl__meta { display: flex; flex-wrap: wrap; gap: 4px; font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 3px; }
.hl__sep { opacity: 0.5; }
.hl__tags { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.hl__type { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.hl__going { font-family: var(--font-body); font-size: 10px; padding: 2px 8px; background: var(--color-surface); border-radius: 999px; color: var(--color-graphite); font-weight: 600; }

/* Stats */
.stats { display: flex; flex-direction: column; gap: 12px; padding: 20px; background: var(--color-ink); color: #fff; border-radius: 14px; }
.stats__label { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.7; }
.stats__row { display: flex; align-items: baseline; gap: 12px; }
.stats__num { font-family: var(--font-display); font-size: 36px; font-weight: 700; letter-spacing: -0.02em; line-height: 1; }
.stats__key { font-family: var(--font-body); font-size: 12px; opacity: 0.8; }

@media (max-width: 1023px) {
  .evc__body { grid-template-columns: 1fr; }
  .cal__cell { min-height: 72px; padding: 6px; }
  .cal__event { font-size: 9px; }
}
@media (max-width: 640px) {
  .evc__toolbar { flex-direction: column; align-items: stretch; }
  .cal__wday { font-size: 9px; padding: 8px 4px; }
  .cal__cell { min-height: 56px; padding: 4px; }
  .cal__day { width: 18px; height: 18px; font-size: 10px; }
  .cal__event { display: none; }
  .cal__cell:has(.cal__events) .cal__day { background: var(--brand); color: #fff; }
}
</style>
