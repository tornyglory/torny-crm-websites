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
import { computed, inject, isRef, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { events as eventsApi, type PublicEvent } from '@torny/api-client'
import Skeleton from '../components/Skeleton.vue'
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
// Start `fetching=true` so the skeleton fires on the very first render
// (before onMounted → loadMonth kicks in). Otherwise a page nav that
// lands on a page with this block would flash the "no events" empty
// state for one tick before the fetch flips it to true.
const fetching = ref(true)
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

/** Per-type palette — richer than the previous single-hue setup so tiles,
 *  chips and card top-borders can pull from consistent gradient stops.
 *  `color` remains the single-hex accent used by dot chips and inline
 *  text tints; `from` / `to` / `ring` power gradients + glows. */
const TYPE_META: Record<LiveEventType, { label: string; color: string; from: string; to: string; ring: string }> = {
  tournament: { label: 'Tournament', color: '#B45309', from: '#F5A623', to: '#E85D5D', ring: '#F5A623' }, // gold → red
  pennant:    { label: 'Pennant',    color: '#0369A1', from: '#0EA5E9', to: '#0369A1', ring: '#38BDF8' }, // sky → deep blue
  social:     { label: 'Social',     color: '#BE185D', from: '#EC4899', to: '#831843', ring: '#F472B6' }, // pink → burgundy
  training:   { label: 'Training',   color: '#7C3AED', from: '#7C3AED', to: '#DB2777', ring: '#A855F7' }, // violet → pink
  other:      { label: 'Other',      color: '#4B5563', from: '#6B7280', to: '#374151', ring: '#9CA3AF' }, // greys
}

const activeType = ref<FilterEventType>('all')

// ── View mode ──────────────────────────────────────────────────
type ViewMode = 'calendar' | 'list'
const viewMode = ref<ViewMode>('calendar')

// ── List-view search + format filter (calendar mode ignores these) ─
const listSearch = ref('')
type FilterFormat = 'all' | 'singles' | 'pairs' | 'triples' | 'fours' | 'other'
const activeFormat = ref<FilterFormat>('all')

const FORMAT_LABEL: Record<Exclude<FilterFormat, 'all'>, string> = {
  singles: 'Singles', pairs: 'Pairs', triples: 'Triples', fours: 'Fours', other: 'Other',
}

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

const formatCounts = computed<Record<Exclude<FilterFormat, 'all'>, number>>(() => {
  const counts = { singles: 0, pairs: 0, triples: 0, fours: 0, other: 0 } as Record<Exclude<FilterFormat, 'all'>, number>
  for (const e of monthEventsFetched.value) {
    if (activeType.value !== 'all' && e.event_type !== activeType.value) continue
    if (e.format && e.format in counts) counts[e.format as Exclude<FilterFormat, 'all'>] += 1
  }
  return counts
})
const availableFormats = computed<Array<Exclude<FilterFormat, 'all'>>>(() =>
  (Object.keys(FORMAT_LABEL) as Array<Exclude<FilterFormat, 'all'>>).filter((f) => formatCounts.value[f] > 0),
)

// ── Events in the visible month (server already scoped by range) ─
const monthEvents = computed<EventEntry[]>(() => {
  if (activeType.value === 'all') return monthEventsFetched.value
  return monthEventsFetched.value.filter((e) => e.event_type === activeType.value)
})

/** List view sees the same type-scoped set, then applies search + format. */
const listEvents = computed<EventEntry[]>(() => {
  const q = listSearch.value.trim().toLowerCase()
  return monthEvents.value
    .filter((e) => {
      if (activeFormat.value !== 'all' && e.format !== activeFormat.value) return false
      if (!q) return true
      return (
        e.title.toLowerCase().includes(q) ||
        (e.excerpt ?? '').toLowerCase().includes(q) ||
        (e.location ?? '').toLowerCase().includes(q) ||
        (e.host_name ?? '').toLowerCase().includes(q)
      )
    })
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
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
/** Full palette for a type — gradient + glow ring. Used by date tiles + card borders. */
function typePalette(t: string | null | undefined): { from: string; to: string; ring: string } {
  const key = (t ?? 'other') as LiveEventType
  return TYPE_META[key] ?? TYPE_META.other
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

// ── Detail modal ───────────────────────────────────────────────
// Click an event chip or a highlights row to open. Deep-linked URLs
// aren't available yet (no per-event public endpoint — brief 33 §5).
const activeEvent = ref<EventEntry | null>(null)
function openEvent(e: EventEntry) { activeEvent.value = e }
function closeEvent() { activeEvent.value = null }

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && activeEvent.value) {
    e.preventDefault()
    closeEvent()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

/** Full formatted date + time range for the modal header. */
function formatFullDateTime(iso: string, endIso?: string | null): string {
  const start = new Date(iso)
  const dateStr = start.toLocaleString('en-NZ', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  return `${dateStr} · ${formatTimeRange(iso, endIso)}`
}

/** Total spots taken (going + maybe) for the capacity read-out. */
function spotsTaken(e: EventEntry): number {
  return (e.rsvp_going_count ?? 0) + (e.rsvp_maybe_count ?? 0)
}
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
      <div class="evc__view-toggle" role="tablist" aria-label="View">
        <button
          type="button"
          role="tab"
          class="evc__view-btn"
          :class="{ 'evc__view-btn--active': viewMode === 'calendar' }"
          :aria-selected="viewMode === 'calendar'"
          @click="viewMode = 'calendar'"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4"/>
          </svg>
          <span>Month</span>
        </button>
        <button
          type="button"
          role="tab"
          class="evc__view-btn"
          :class="{ 'evc__view-btn--active': viewMode === 'list' }"
          :aria-selected="viewMode === 'list'"
          @click="viewMode = 'list'"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>
          </svg>
          <span>List</span>
        </button>
      </div>
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

      <!-- Skeleton — fires on the first load of a month before any events land. -->
      <div
        v-if="fetching && monthEventsFetched.length === 0"
        class="evc__body evc__body--skel"
        aria-busy="true"
        aria-label="Loading events"
      >
        <div class="cal cal--skel">
          <div class="cal__week">
            <div v-for="w in WEEKDAY_LABELS" :key="w" class="cal__wday">{{ w }}</div>
          </div>
          <div class="cal__grid">
            <div v-for="n in 35" :key="n" class="cal__cell">
              <Skeleton width="22px" height="22px" radius="pill" />
              <div v-if="[3, 9, 15, 16, 22, 27].includes(n)" class="cal__events">
                <Skeleton width="80%" height="14px" radius="sm" />
                <Skeleton v-if="n === 15 || n === 22" width="65%" height="14px" radius="sm" />
              </div>
            </div>
          </div>
        </div>
        <aside class="side side--skel">
          <div class="side__label">Highlights</div>
          <ul class="side__list">
            <li v-for="n in 3" :key="n">
              <div class="hl hl--skel">
                <Skeleton width="44px" height="52px" radius="md" />
                <div class="hl__body" style="width: 100%;">
                  <Skeleton :width="`${75 - n * 8}%`" height-variant="lg" />
                  <Skeleton width="60%" style="margin-top: 6px;" />
                  <Skeleton width="45%" style="margin-top: 6px;" />
                </div>
              </div>
            </li>
          </ul>
          <div class="stats stats--skel">
            <div class="stats__label">This month at a glance</div>
            <div class="stats__row">
              <Skeleton width="60px" height-variant="xl" />
            </div>
            <div class="stats__row">
              <Skeleton width="48px" height-variant="xl" />
            </div>
          </div>
        </aside>
      </div>

      <!-- Grid + side panel (calendar view) -->
      <div v-else-if="viewMode === 'calendar'" class="evc__body">
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
                <button
                  v-for="e in eventsByDay.get(cell.day)"
                  :key="e.id"
                  type="button"
                  class="cal__event"
                  :style="{ background: typeColor(e.event_type) + '18', color: typeColor(e.event_type), borderLeftColor: typeColor(e.event_type) } as any"
                  :title="`${e.title} · ${formatTimeRange(e.starts_at, e.ends_at)}${e.location ? ' · ' + e.location : ''}`"
                  @click.stop="openEvent(e)"
                >
                  {{ e.title }}
                </button>
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
            <li v-for="e in highlights" :key="e.id">
              <button
                type="button"
                class="hl"
                :style="{
                  '--hl-from': typePalette(e.event_type).from,
                  '--hl-to': typePalette(e.event_type).to,
                  '--hl-ring': typePalette(e.event_type).ring,
                } as any"
                @click="openEvent(e)"
              >
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
              </button>
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

      <!-- List view -->
      <div v-else-if="viewMode === 'list'" class="evc__list-wrap">
        <div class="evc__list-toolbar">
          <div class="evc__search">
            <svg class="evc__search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              v-model="listSearch"
              type="text"
              class="evc__search-input"
              :placeholder="`Search ${monthEvents.length} event${monthEvents.length === 1 ? '' : 's'} — name, place, host…`"
              autocomplete="off"
            />
            <button v-if="listSearch" type="button" class="evc__search-clear" aria-label="Clear search" @click="listSearch = ''">×</button>
          </div>
          <div v-if="availableFormats.length" class="evc__format-chips" aria-label="Filter by format">
            <button
              type="button"
              class="evc__chip evc__chip--sm"
              :class="{ 'evc__chip--active': activeFormat === 'all' }"
              @click="activeFormat = 'all'"
            >
              <span>All formats</span>
              <span class="evc__chip-count">{{ monthEvents.length }}</span>
            </button>
            <button
              v-for="f in availableFormats"
              :key="f"
              type="button"
              class="evc__chip evc__chip--sm"
              :class="{ 'evc__chip--active': activeFormat === f }"
              @click="activeFormat = f"
            >
              <span>{{ FORMAT_LABEL[f] }}</span>
              <span class="evc__chip-count">{{ formatCounts[f] }}</span>
            </button>
          </div>
        </div>

        <div v-if="listEvents.length === 0" class="evc__list-empty">
          <div class="evc__list-empty-title">No events match.</div>
          <p>Try clearing the search or changing filters.</p>
        </div>

        <ul v-else class="evc__list">
          <li v-for="e in listEvents" :key="e.id">
            <button
              type="button"
              class="lst"
              :style="{
                '--lst-from': typePalette(e.event_type).from,
                '--lst-to': typePalette(e.event_type).to,
                '--lst-ring': typePalette(e.event_type).ring,
              } as any"
              @click="openEvent(e)"
            >
              <div class="lst__date">
                <div class="lst__date-month">{{ formatShortDate(e.starts_at).month }}</div>
                <div class="lst__date-day">{{ formatShortDate(e.starts_at).day }}</div>
              </div>
              <div class="lst__body">
                <div class="lst__title-row">
                  <h3 class="lst__title">{{ e.title }}</h3>
                  <div class="lst__tags">
                    <span class="lst__type" :style="{ background: typeColor(e.event_type) + '18', color: typeColor(e.event_type) } as any">
                      {{ typeLabel(e.event_type) }}
                    </span>
                    <span v-if="e.format" class="lst__format">{{ FORMAT_LABEL[e.format as Exclude<FilterFormat, 'all'>] ?? e.format }}</span>
                  </div>
                </div>
                <p v-if="e.excerpt" class="lst__excerpt">{{ e.excerpt }}</p>
                <div class="lst__meta">
                  <span>{{ formatTimeRange(e.starts_at, e.ends_at) }}</span>
                  <template v-if="e.location">
                    <span class="lst__sep">·</span><span>{{ e.location }}</span>
                  </template>
                  <template v-if="e.host_name">
                    <span class="lst__sep">·</span><span>Hosted by {{ e.host_name }}</span>
                  </template>
                </div>
                <div v-if="e.rsvp_going_count > 0 || e.capacity" class="lst__rsvp">
                  <template v-if="e.rsvp_going_count > 0">
                    <span class="lst__rsvp-num">{{ e.rsvp_going_count }}</span> going
                  </template>
                  <template v-if="e.capacity != null">
                    <span v-if="e.rsvp_going_count > 0" class="lst__sep">·</span>
                    {{ e.capacity }} spots
                  </template>
                </div>
              </div>
              <div class="lst__chev" aria-hidden="true">›</div>
            </button>
          </li>
        </ul>
      </div>
    </template>

    <!-- Event detail modal — click an event chip or highlight row to open. -->
    <Teleport to="body">
      <div v-if="activeEvent" class="evd" role="dialog" aria-modal="true" @click.self="closeEvent">
        <div class="evd__card" :style="{ '--brand': brand } as any">
          <button
            type="button"
            class="evd__close"
            aria-label="Close"
            @click="closeEvent"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>

          <header class="evd__head">
            <div class="evd__eyebrow">
              <span class="evd__type-dot" :style="{ background: typeColor(activeEvent.event_type) } as any" />
              <span>{{ typeLabel(activeEvent.event_type) }}<template v-if="activeEvent.format"> · {{ activeEvent.format }}</template></span>
            </div>
            <h3 class="evd__title">{{ activeEvent.title }}</h3>
            <div class="evd__when">{{ formatFullDateTime(activeEvent.starts_at, activeEvent.ends_at) }}</div>
          </header>

          <div class="evd__meta">
            <div v-if="activeEvent.location" class="evd__meta-row">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <span>{{ activeEvent.location }}</span>
            </div>
            <div v-if="activeEvent.host_name" class="evd__meta-row">
              <span v-if="activeEvent.host_avatar_url" class="evd__host-avatar"><img :src="activeEvent.host_avatar_url" :alt="activeEvent.host_name" /></span>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>
              <span>Hosted by {{ activeEvent.host_name }}</span>
            </div>
            <div v-if="activeEvent.capacity != null" class="evd__meta-row">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <span>{{ spotsTaken(activeEvent) }} / {{ activeEvent.capacity }} spots</span>
            </div>
          </div>

          <p v-if="activeEvent.excerpt" class="evd__excerpt">{{ activeEvent.excerpt }}</p>

          <div v-if="activeEvent.rsvp_going_count > 0 || activeEvent.rsvp_maybe_count > 0" class="evd__rsvp">
            <div class="evd__rsvp-count">
              <span class="evd__rsvp-num">{{ activeEvent.rsvp_going_count }}</span>
              <span class="evd__rsvp-key">going</span>
              <template v-if="activeEvent.rsvp_maybe_count > 0">
                <span class="evd__rsvp-sep">·</span>
                <span class="evd__rsvp-num">{{ activeEvent.rsvp_maybe_count }}</span>
                <span class="evd__rsvp-key">maybe</span>
              </template>
            </div>
            <div v-if="activeEvent.rsvp_going_preview?.length" class="evd__avatars">
              <template v-for="(p, i) in activeEvent.rsvp_going_preview" :key="i">
                <img v-if="p.avatar_url" :src="p.avatar_url" :alt="p.initials" class="evd__avatar" />
                <span v-else class="evd__avatar evd__avatar--initials">{{ p.initials }}</span>
              </template>
            </div>
          </div>

          <footer class="evd__foot">
            <button type="button" class="evd__btn evd__btn--ghost" @click="closeEvent">Close</button>
            <template v-if="activeEvent.rsvp_open">
              <button
                type="button"
                class="evd__btn evd__btn--primary"
                @click="closeEvent"
                title="RSVP submission ships in a later brief — this closes the modal for now."
              >
                RSVP coming soon
              </button>
            </template>
          </footer>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.evc {
  display: flex;
  flex-direction: column;
  gap: 32px;
  /* Match HeroBlock + HonourBoardBlock + EventListBlock: break out of the
     parent .page-blocks max-width so the block spans the viewport.
     Horizontal padding aligns the inner grid with the site's reading rhythm. */
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
  padding: 64px max(48px, calc((100vw - var(--container-content, 1280px)) / 2));
  box-sizing: border-box;
}

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

/* View toggle (Month / List) */
.evc__view-toggle { display: inline-flex; padding: 4px; gap: 2px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; flex-shrink: 0; }
.evc__view-btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border: 0; border-radius: 999px; background: transparent; font-family: var(--font-body); font-size: 12px; font-weight: 600; color: var(--color-graphite); cursor: pointer; }
.evc__view-btn:hover { color: var(--color-ink); }
.evc__view-btn--active { background: #fff; color: var(--color-ink); box-shadow: 0 1px 2px rgba(0,0,0,0.05); }

/* List-mode toolbar (search + format chips) */
.evc__list-wrap { display: flex; flex-direction: column; gap: 20px; }
.evc__list-toolbar { display: flex; flex-direction: column; gap: 12px; }
.evc__search { position: relative; }
.evc__search-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--color-fog); pointer-events: none; }
.evc__search-input { width: 100%; padding: 12px 44px 12px 42px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 14px; background: #fff; color: var(--color-ink); box-sizing: border-box; }
.evc__search-input:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px color-mix(in oklab, var(--brand) 15%, transparent); }
.evc__search-clear { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: transparent; border: 0; font-size: 20px; color: var(--color-fog); cursor: pointer; padding: 0 6px; line-height: 1; }
.evc__format-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.evc__chip--sm { padding: 5px 10px; font-size: 11px; }

/* List rows */
.evc__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.evc__list-empty { padding: 40px 24px; text-align: center; background: var(--color-surface); border: 1px dashed var(--color-hairline); border-radius: 14px; color: var(--color-fog); font-family: var(--font-body); }
.evc__list-empty-title { font-family: var(--font-display); font-size: 16px; font-weight: 700; color: var(--color-ink); margin-bottom: 4px; }
.evc__list-empty p { margin: 0; font-size: 13px; }

.lst { position: relative; display: grid; grid-template-columns: 56px 1fr auto; gap: 16px; align-items: start; width: 100%; padding: 16px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; cursor: pointer; text-align: left; transition: transform 160ms, box-shadow 160ms; overflow: hidden; }
.lst::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, var(--lst-from, #F5A623), var(--lst-to, #E85D5D)); }
.lst:hover { transform: translateY(-1px); box-shadow: 0 8px 24px color-mix(in oklab, var(--lst-ring, var(--brand)) 22%, transparent); }
.lst:focus-visible { outline: 2px solid var(--lst-ring, var(--brand)); outline-offset: 2px; }
.lst__date { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px 4px; background-image: linear-gradient(160deg, var(--lst-from, #F5A623) 0%, var(--lst-to, #E85D5D) 100%); color: #fff; border-radius: 10px; box-shadow: 0 4px 12px color-mix(in oklab, var(--lst-ring, #F5A623) 28%, transparent); }
.lst__date-month { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; opacity: 0.8; }
.lst__date-day { font-family: var(--font-display); font-size: 22px; font-weight: 700; line-height: 1; margin-top: 2px; }
.lst__body { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.lst__title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.lst__title { font-family: var(--font-display); font-size: 16px; font-weight: 700; color: var(--color-ink); margin: 0; letter-spacing: -0.01em; }
.lst__tags { display: inline-flex; gap: 6px; flex-shrink: 0; }
.lst__type { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.lst__format { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; background: var(--color-surface); color: var(--color-graphite); font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.lst__excerpt { font-family: var(--font-body); font-size: 13px; line-height: 1.5; color: var(--color-graphite); margin: 0; }
.lst__meta { display: flex; flex-wrap: wrap; gap: 4px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.lst__sep { opacity: 0.5; margin: 0 2px; }
.lst__rsvp { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-body); font-size: 12px; color: var(--color-graphite); margin-top: 2px; }
.lst__rsvp-num { font-family: var(--font-display); font-weight: 700; color: var(--color-ink); }
.lst__chev { font-family: var(--font-display); font-size: 20px; color: var(--color-fog); line-height: 1; }

/* Body: grid + side */
.evc__body { display: grid; grid-template-columns: 1fr 300px; gap: 24px; align-items: start; }
/* Skeleton state — dampen colour and hide interactions. Rainbow ribbon on
   the stats card is hidden too so the load looks calm. */
.evc__body--skel { pointer-events: none; }
.cal--skel .cal__cell, .side--skel .hl--skel { animation: none; }
.stats--skel::before { display: none; }
.hl--skel { display: flex; gap: 12px; padding: 12px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; align-items: flex-start; }

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
.cal__event { font-family: var(--font-body); font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; border-left: 3px solid; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; text-align: left; width: 100%; box-sizing: border-box; }
.cal__event:hover { filter: brightness(0.95); }

/* Side */
.side { display: flex; flex-direction: column; gap: 20px; }
.side__label { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.side__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.side__empty { padding: 20px; background: #fff; border: 1px dashed var(--color-hairline); border-radius: 12px; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); text-align: center; }

.hl { position: relative; display: flex; gap: 12px; padding: 12px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; cursor: pointer; text-align: left; width: 100%; transition: transform 160ms, box-shadow 160ms; overflow: hidden; }
.hl::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, var(--hl-from, #F5A623), var(--hl-to, #E85D5D)); }
.hl:hover { transform: translateY(-1px); box-shadow: 0 6px 16px color-mix(in oklab, var(--hl-ring, var(--brand)) 22%, transparent); }
.hl:focus-visible { outline: 2px solid var(--hl-ring, var(--brand)); outline-offset: 2px; }
.hl__date { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 44px; padding: 6px 4px; background-image: linear-gradient(160deg, var(--hl-from, #F5A623) 0%, var(--hl-to, #E85D5D) 100%); color: #fff; border-radius: 8px; flex-shrink: 0; box-shadow: 0 2px 8px color-mix(in oklab, var(--hl-ring, #F5A623) 25%, transparent); }
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
.stats { position: relative; display: flex; flex-direction: column; gap: 12px; padding: 20px; background: radial-gradient(circle at 20% 20%, rgba(245, 166, 35, 0.22) 0%, transparent 55%), radial-gradient(circle at 80% 100%, rgba(124, 58, 237, 0.18) 0%, transparent 55%), var(--color-ink); color: #fff; border-radius: 14px; overflow: hidden; }
.stats::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, #F5A623, #E85D5D 30%, #7C3AED 60%, #0EA5E9); }
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

/* ── Event detail modal ─────────────────────────────────────── */
.evd { position: fixed; inset: 0; background: rgba(10, 10, 11, 0.5); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 24px; animation: evd-fade 160ms ease-out; }
@keyframes evd-fade { from { opacity: 0; } to { opacity: 1; } }
.evd__card { position: relative; width: 100%; max-width: 520px; max-height: calc(100vh - 48px); overflow-y: auto; background: #fff; border-radius: 20px; padding: 32px; box-shadow: 0 24px 64px rgba(0,0,0,0.24); animation: evd-slide 200ms cubic-bezier(0.16, 1, 0.3, 1); }
.evd__card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 4px; border-radius: 20px 20px 0 0; background: linear-gradient(90deg, #F5A623, #E85D5D 30%, #7C3AED 60%, #0EA5E9); }
@keyframes evd-slide { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
.evd__close { position: absolute; top: 16px; right: 16px; width: 32px; height: 32px; border-radius: 999px; background: var(--color-surface); border: 0; display: inline-flex; align-items: center; justify-content: center; color: var(--color-fog); cursor: pointer; transition: background 120ms, color 120ms; }
.evd__close:hover { background: var(--color-hairline); color: var(--color-ink); }

.evd__head { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; padding-right: 40px; }
.evd__eyebrow { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.evd__type-dot { width: 8px; height: 8px; border-radius: 999px; }
.evd__title { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: 0; line-height: 1.15; }
.evd__when { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); }

.evd__meta { display: flex; flex-direction: column; gap: 10px; padding: 16px 0; border-top: 1px solid var(--color-hairline); border-bottom: 1px solid var(--color-hairline); }
.evd__meta-row { display: flex; align-items: center; gap: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); }
.evd__meta-row svg { flex-shrink: 0; color: var(--color-fog); }
.evd__host-avatar { width: 20px; height: 20px; border-radius: 999px; overflow: hidden; flex-shrink: 0; }
.evd__host-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }

.evd__excerpt { font-family: var(--font-body); font-size: 14px; line-height: 1.55; color: var(--color-ink); margin: 20px 0; }

.evd__rsvp { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px; background: var(--color-surface); border-radius: 12px; margin-bottom: 20px; }
.evd__rsvp-count { display: flex; align-items: baseline; gap: 6px; }
.evd__rsvp-num { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--color-ink); }
.evd__rsvp-key { font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-fog); }
.evd__rsvp-sep { color: var(--color-fog); }
.evd__avatars { display: inline-flex; align-items: center; }
.evd__avatar { width: 28px; height: 28px; border-radius: 999px; border: 2px solid #fff; background: var(--color-hairline); color: var(--color-graphite); display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 10px; font-weight: 700; margin-left: -8px; overflow: hidden; box-sizing: border-box; }
.evd__avatar:first-child { margin-left: 0; }
.evd__avatar img { width: 100%; height: 100%; object-fit: cover; }

.evd__foot { display: flex; gap: 10px; justify-content: flex-end; }
.evd__btn { padding: 10px 18px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: 0; }
.evd__btn--primary { background: var(--color-ink); color: #fff; }
.evd__btn--primary:hover { background: var(--color-graphite); }
.evd__btn--ghost { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.evd__btn--ghost:hover { background: var(--color-surface); }

@media (max-width: 640px) {
  .evd { padding: 16px; }
  .evd__card { padding: 24px 20px; border-radius: 16px; }
  .evd__title { font-size: 22px; }
}
</style>
