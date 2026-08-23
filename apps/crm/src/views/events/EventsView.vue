<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import CrmModal from '@/components/modals/CrmModal.vue'
import { useToast } from '@/composables/useToast'

const toast = useToast()

type Tab = 'upcoming' | 'past'
type EventType =
  | 'tournament'
  | 'social'
  | 'meeting'
  | 'coaching'
  | 'working-bee'
  | 'presentation'
  | 'fundraiser'
  | 'function'
  | 'other'
type BowlsFormat = 'singles' | 'pairs' | 'triples' | 'fours' | 'other'

interface EventRow {
  id: string
  title: string
  type: EventType
  format: BowlsFormat | null    // required for tournaments, null otherwise
  startsAt: string              // ISO — source of truth
  endsAt: string                // ISO
  location: string
  description?: string
  host?: string
  rsvpYes: number
  rsvpMaybe: number
  rsvpNo: number
  capacity: number
  isPublished: boolean
}

// Anchor "now" at 2026-08-20 to keep the mock data feeling live.
const NOW = new Date('2026-08-20T10:00:00')

const activeTab = ref<Tab>('upcoming')
const search = ref('')
const typeFilter = ref<'all' | EventType>('all')
const formatFilter = ref<'all' | BowlsFormat>('all')

const events = ref<EventRow[]>([
  { id: 'e1', title: 'Champion of Champions — Round 1', type: 'tournament', format: 'singles', startsAt: '2026-08-22T09:00:00', endsAt: '2026-08-22T13:00:00', location: 'Green 1', description: 'Opening round of the annual singles championship. Best-of-21 ends knock-out format. Bring lunch — cafe closed until noon.', host: 'Marcus Tuilagi', rsvpYes: 24, rsvpMaybe: 4, rsvpNo: 2, capacity: 32, isPublished: true },
  { id: 'e2', title: 'Twilight Triples', type: 'tournament', format: 'triples', startsAt: '2026-08-26T17:30:00', endsAt: '2026-08-26T20:30:00', location: 'Green 2 & 3', description: 'Casual mid-week triples. Rounds run to 12 ends. BBQ and bar open from 5pm — book a table for after.', host: 'Denise Peters', rsvpYes: 18, rsvpMaybe: 6, rsvpNo: 3, capacity: 24, isPublished: true },
  { id: 'e3', title: 'Ladies Open Fours', type: 'tournament', format: 'fours', startsAt: '2026-09-05T10:00:00', endsAt: '2026-09-05T16:00:00', location: 'All greens', description: 'Regional open — teams from Petone, Kelburn, and Naenae. Prize-giving at the clubrooms from 4:30pm.', host: 'Jo Kirk', rsvpYes: 36, rsvpMaybe: 8, rsvpNo: 4, capacity: 40, isPublished: true },
  { id: 'e4', title: 'Sunday Social Roll-up', type: 'social', format: null, startsAt: '2026-09-13T13:00:00', endsAt: '2026-09-13T16:00:00', location: 'Green 1', description: 'Bring anyone — members, non-members, kids. Sausages on. Suggested $5 koha to cover the bar.', host: 'Sione Vagana', rsvpYes: 8, rsvpMaybe: 3, rsvpNo: 1, capacity: 20, isPublished: false },
  { id: 'e5', title: 'Wellington Regional Pairs', type: 'tournament', format: 'pairs', startsAt: '2026-09-19T09:00:00', endsAt: '2026-09-19T17:00:00', location: 'Away — Petone Central', description: 'Away round — pairs qualifiers. Meet at the club at 8am, van leaving 8:15 sharp.', host: 'Tama Wong', rsvpYes: 12, rsvpMaybe: 2, rsvpNo: 6, capacity: 16, isPublished: true },
  { id: 'e6', title: 'Annual Prize Giving', type: 'presentation', format: null, startsAt: '2026-09-28T18:30:00', endsAt: '2026-09-28T22:00:00', location: 'Clubrooms', description: 'End-of-season awards night. Champion of Champions, most-improved, and the coveted Skip of the Year. Dress: smart casual. Tickets $25 members / $35 guests.', host: 'Grace Whittaker', rsvpYes: 96, rsvpMaybe: 12, rsvpNo: 4, capacity: 120, isPublished: true },
  { id: 'e7', title: 'Green A Working Bee', type: 'working-bee', format: null, startsAt: '2026-09-06T08:00:00', endsAt: '2026-09-06T12:00:00', location: 'Green A', description: 'Pre-season prep — coring, top-dressing, and edge trim. Coffee and bacon rolls at 10. Wear old clothes and closed shoes.', host: 'Tāne Rahupene', rsvpYes: 14, rsvpMaybe: 3, rsvpNo: 2, capacity: 30, isPublished: true },
  { id: 'e8', title: 'AGM — 2026', type: 'meeting', format: null, startsAt: '2026-09-24T19:00:00', endsAt: '2026-09-24T21:00:00', location: 'Clubrooms', description: 'Annual General Meeting. Financials, committee elections, and next-year planning. All members welcome; quorum is 30.', host: 'Committee', rsvpYes: 28, rsvpMaybe: 8, rsvpNo: 3, capacity: 60, isPublished: true },
  { id: 'e9', title: 'Learn-to-Bowl · Term 4', type: 'coaching', format: null, startsAt: '2026-10-11T10:00:00', endsAt: '2026-10-11T11:30:00', location: 'Green 3', description: 'First of an 8-week beginner series. No experience needed, all equipment provided. Bring flat-soled shoes.', host: 'Sarah Kim', rsvpYes: 9, rsvpMaybe: 4, rsvpNo: 0, capacity: 12, isPublished: true },
  { id: 'e10', title: 'Quiz Night · Junior Team Fundraiser', type: 'fundraiser', format: null, startsAt: '2026-09-20T19:00:00', endsAt: '2026-09-20T22:30:00', location: 'Clubrooms', description: 'Six-person teams, $10 a head, bar open all night. Proceeds fund the juniors\' trip to Nationals.', host: 'Denise Peters', rsvpYes: 42, rsvpMaybe: 18, rsvpNo: 5, capacity: 80, isPublished: true },
  { id: 'e11', title: 'Mid-week Mens Pairs', type: 'tournament', format: 'pairs', startsAt: '2026-08-06T18:00:00', endsAt: '2026-08-06T21:00:00', location: 'Green 2', description: 'Weekly Thursday night pairs. Consistent turnout — winners announced end of season.', rsvpYes: 22, rsvpMaybe: 0, rsvpNo: 0, capacity: 24, isPublished: true },
  { id: 'e12', title: 'Winter Championship — Semis', type: 'tournament', format: 'singles', startsAt: '2026-07-25T09:00:00', endsAt: '2026-07-25T15:00:00', location: 'Green 1 & 2', description: 'Semi-finals of the winter singles. Best two through to the final in August.', host: 'Marcus Tuilagi', rsvpYes: 16, rsvpMaybe: 0, rsvpNo: 0, capacity: 16, isPublished: true },
])

// ── Filtering ─────────────────────────────────────────────────
const byTab = computed(() => {
  return events.value.filter((e) => {
    const start = new Date(e.startsAt)
    return activeTab.value === 'upcoming' ? start >= NOW : start < NOW
  })
})

const counts = computed(() => {
  const now = NOW
  return {
    upcoming: events.value.filter((e) => new Date(e.startsAt) >= now).length,
    past:     events.value.filter((e) => new Date(e.startsAt) < now).length,
  }
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return byTab.value
    .filter((e) => {
      if (typeFilter.value !== 'all' && e.type !== typeFilter.value) return false
      if (formatFilter.value !== 'all' && e.format !== formatFilter.value) return false
      if (!q) return true
      return (
        e.title.toLowerCase().includes(q) ||
        e.location.toLowerCase().includes(q) ||
        (e.description ?? '').toLowerCase().includes(q) ||
        (e.host ?? '').toLowerCase().includes(q) ||
        (e.format ?? '').toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      const da = new Date(a.startsAt).getTime()
      const db = new Date(b.startsAt).getTime()
      return activeTab.value === 'upcoming' ? da - db : db - da
    })
})

// Format chips only make sense when scoping to tournaments.
const formatFilterVisible = computed(() =>
  typeFilter.value === 'all' || typeFilter.value === 'tournament',
)

const typeCounts = computed(() => {
  const src = byTab.value
  const zero = {
    all: src.length,
    tournament: 0,
    social: 0,
    meeting: 0,
    coaching: 0,
    'working-bee': 0,
    presentation: 0,
    fundraiser: 0,
    function: 0,
    other: 0,
  } as Record<'all' | EventType, number>
  for (const e of src) zero[e.type] += 1
  return zero
})

const formatCounts = computed(() => {
  const src = byTab.value.filter((e) => typeFilter.value === 'all' || e.type === typeFilter.value)
  return {
    all: src.length,
    singles: src.filter((e) => e.format === 'singles').length,
    pairs:   src.filter((e) => e.format === 'pairs').length,
    triples: src.filter((e) => e.format === 'triples').length,
    fours:   src.filter((e) => e.format === 'fours').length,
  }
})

// ── Display helpers ───────────────────────────────────────────
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${DAY_ABBR[d.getDay()]} ${d.getDate()} ${MONTH_ABBR[d.getMonth()]}`
}
function formatTime(iso: string) {
  const d = new Date(iso)
  let h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return m ? `${h}:${m.toString().padStart(2, '0')} ${ampm}` : `${h}:00 ${ampm}`
}
function formatRange(startIso: string, endIso: string) {
  return `${formatDate(startIso)} · ${formatTime(startIso)} – ${formatTime(endIso)}`
}

function daysUntil(iso: string) {
  const d = new Date(iso)
  const diff = Math.round((d.getTime() - NOW.getTime()) / (1000 * 60 * 60 * 24))
  return diff
}

function timeUntilLabel(iso: string) {
  const days = daysUntil(iso)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days > 0 && days < 7) return `in ${days} days`
  if (days >= 7 && days < 14) return 'next week'
  if (days >= 14 && days < 28) return `in ${Math.floor(days / 7)} weeks`
  if (days < 0 && days >= -1) return 'yesterday'
  if (days < -1 && days >= -7) return `${-days} days ago`
  if (days < -7 && days >= -14) return 'last week'
  if (days < -14 && days >= -60) return `${Math.floor(-days / 7)} weeks ago`
  return formatDate(iso)
}

function fillPct(e: EventRow): number {
  return Math.min(100, Math.round(((e.rsvpYes + e.rsvpMaybe) / e.capacity) * 100))
}

const formatColour: Record<BowlsFormat, string> = {
  singles: 'var(--color-feature-mint)',
  pairs:   'var(--color-accent)',
  triples: 'var(--color-feature-tangerine)',
  fours:   'var(--color-feature-violet)',
  other:   'var(--color-graphite)',
}

const formatLabel: Record<BowlsFormat, string> = {
  singles: 'Singles',
  pairs:   'Pairs',
  triples: 'Triples',
  fours:   'Fours',
  other:   'Other',
}

const typeLabel: Record<EventType, string> = {
  tournament:    'Tournament',
  social:        'Social',
  meeting:       'Meeting',
  coaching:      'Coaching',
  'working-bee': 'Working bee',
  presentation:  'Presentation',
  fundraiser:    'Fundraiser',
  function:      'Function',
  other:         'Other',
}

// Accent bar down the left of each card, and dot on the type chip.
const typeColour: Record<EventType, string> = {
  tournament:    'var(--color-accent)',
  social:        'var(--color-feature-mint)',
  meeting:       'var(--color-graphite)',
  coaching:      'var(--color-feature-tangerine)',
  'working-bee': '#B45309',
  presentation:  'var(--color-feature-violet)',
  fundraiser:    '#E85D5D',
  function:      '#0369A1',
  other:         'var(--color-mute)',
}

const TYPE_ORDER: EventType[] = [
  'tournament', 'social', 'meeting', 'coaching', 'working-bee',
  'presentation', 'fundraiser', 'function', 'other',
]

function eventSecondaryLine(e: EventRow): string {
  // Non-tournaments show the type; tournaments show the bowls format.
  if (e.type === 'tournament' && e.format) return formatLabel[e.format]
  return typeLabel[e.type]
}

function eventBadge(e: EventRow): { label: string; tone: string } | null {
  if (!e.isPublished) return { label: 'Draft', tone: 'mute' }
  const pct = (e.rsvpYes + e.rsvpMaybe) / e.capacity
  if (pct >= 1) return { label: 'Full', tone: 'danger' }
  if (pct >= 0.75) return { label: 'Nearly full', tone: 'warn' }
  const d = daysUntil(e.startsAt)
  if (d >= 0 && d <= 3) return { label: 'This week', tone: 'accent' }
  return null
}

// ── Detail modal ──────────────────────────────────────────────
const detailOpen = ref(false)
const activeEvent = ref<EventRow | null>(null)

function openDetail(e: EventRow) {
  activeEvent.value = e
  detailOpen.value = true
}
function closeDetail() {
  detailOpen.value = false
}
function togglePublish() {
  if (!activeEvent.value) return
  activeEvent.value.isPublished = !activeEvent.value.isPublished
  toast.success(activeEvent.value.isPublished ? 'Event published.' : 'Event moved to draft.')
}
function editEvent() {
  if (!activeEvent.value) return
  toast.info(`Editing ${activeEvent.value.title} — event editor opens next session.`)
}

// ── New event modal ───────────────────────────────────────────
const createOpen = ref(false)
const emptyForm = () => ({
  title: '',
  type: 'tournament' as EventType,
  format: 'singles' as BowlsFormat,
  date: '',
  startTime: '',
  endTime: '',
  location: '',
  capacity: 24,
  publishNow: true,
  syncCalendar: true,
})
const form = reactive(emptyForm())
const formNeedsFormat = computed(() => form.type === 'tournament')

function openCreate() {
  Object.assign(form, emptyForm())
  createOpen.value = true
}
function closeCreate() { createOpen.value = false }

const canSubmit = computed(
  () => form.title.trim().length > 0 && form.date.length > 0 && form.startTime.length > 0,
)

function submit() {
  if (!canSubmit.value) return
  // Best-effort mock ISO — real form would use proper date/time inputs.
  const startsAt = `${form.date}T${form.startTime}:00`
  const endsAt = form.endTime ? `${form.date}T${form.endTime}:00` : `${form.date}T${form.startTime}:00`
  events.value.unshift({
    id: `e${Date.now()}`,
    title: form.title.trim(),
    type: form.type,
    format: form.type === 'tournament' ? form.format : null,
    startsAt,
    endsAt,
    location: form.location.trim() || 'TBC',
    rsvpYes: 0,
    rsvpMaybe: 0,
    rsvpNo: 0,
    capacity: Number(form.capacity) || 0,
    isPublished: form.publishNow,
  })
  closeCreate()
  toast.success(`Created ${form.title.trim()}.`)
}

const emptyMessage = computed(() => {
  if (search.value.trim() || typeFilter.value !== 'all' || formatFilter.value !== 'all') {
    return { title: 'No matches', hint: 'Try clearing the search or filters.' }
  }
  return activeTab.value === 'upcoming'
    ? { title: 'No events scheduled', hint: 'Click "+ New event" to get one on the calendar.' }
    : { title: 'No past events', hint: 'Wrapped-up events land here.' }
})
</script>

<template>
  <div class="events">
    <header class="events__header">
      <div>
        <div class="events__eyebrow">What's on</div>
        <h1 class="events__heading">Events</h1>
        <p class="events__sub">{{ counts.upcoming }} upcoming · {{ events.filter(e => e.isPublished).length }} live on your site</p>
      </div>
      <div class="events__actions">
        <button class="btn btn--ghost" @click="toast.info('Calendar view opens next session.')">View calendar</button>
        <button class="btn btn--primary" @click="openCreate">+ New event</button>
      </div>
    </header>

    <div class="toolbar">
      <div class="tabs">
        <button class="tab" :class="{ 'is-active': activeTab === 'upcoming' }" @click="activeTab = 'upcoming'; typeFilter = 'all'; formatFilter = 'all'">
          <span>Upcoming</span>
          <span class="tab__count">{{ counts.upcoming }}</span>
        </button>
        <button class="tab" :class="{ 'is-active': activeTab === 'past' }" @click="activeTab = 'past'; typeFilter = 'all'; formatFilter = 'all'">
          <span>Past</span>
          <span class="tab__count">{{ counts.past }}</span>
        </button>
      </div>
      <div class="search">
        <svg class="search__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input v-model="search" class="search__input" placeholder="Filter events…" />
        <button v-if="search" class="search__clear" aria-label="Clear search" @click="search = ''">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
    </div>

    <div class="chips">
      <button
        class="chip"
        :class="{ 'is-active': typeFilter === 'all' }"
        @click="typeFilter = 'all'; formatFilter = 'all'"
      >
        <span class="chip__label">All types</span>
        <span class="chip__count">{{ typeCounts.all }}</span>
      </button>
      <button
        v-for="t in TYPE_ORDER"
        :key="t"
        class="chip"
        :class="{ 'is-active': typeFilter === t }"
        :disabled="typeCounts[t] === 0"
        @click="typeFilter = t; if (t !== 'tournament') formatFilter = 'all'"
      >
        <span class="chip__dot" :style="{ background: typeColour[t] }" />
        <span class="chip__label">{{ typeLabel[t] }}</span>
        <span class="chip__count">{{ typeCounts[t] }}</span>
      </button>
    </div>

    <div v-if="formatFilterVisible" class="chips chips--sub">
      <button
        v-for="fmt in (['all', 'singles', 'pairs', 'triples', 'fours'] as const)"
        :key="fmt"
        class="chip chip--sm"
        :class="{ 'is-active': formatFilter === fmt }"
        @click="formatFilter = fmt"
      >
        <span v-if="fmt !== 'all'" class="chip__dot" :style="{ background: formatColour[fmt] }" />
        <span class="chip__label">{{ fmt === 'all' ? 'All formats' : formatLabel[fmt] }}</span>
        <span class="chip__count">{{ formatCounts[fmt] }}</span>
      </button>
    </div>

    <ul v-if="filtered.length" class="list">
      <li v-for="e in filtered" :key="e.id" class="event" tabindex="0" @click="openDetail(e)" @keydown.enter="openDetail(e)">
        <div class="event__format" :style="{ background: typeColour[e.type] }" />
        <div class="event__main">
          <div class="event__title-row">
            <h3 class="event__title">{{ e.title }}</h3>
            <span v-if="eventBadge(e)" class="badge" :class="`badge--${eventBadge(e)!.tone}`">{{ eventBadge(e)!.label }}</span>
          </div>
          <div class="event__meta">
            <span>{{ formatRange(e.startsAt, e.endsAt) }}</span>
            <span class="event__sep">·</span>
            <span>{{ e.location }}</span>
            <span class="event__sep">·</span>
            <span class="event__format-label">{{ eventSecondaryLine(e) }}</span>
          </div>
          <div class="event__when">{{ timeUntilLabel(e.startsAt) }}</div>
        </div>
        <div class="event__rsvp">
          <div class="event__rsvp-count">{{ e.rsvpYes }}<span class="event__rsvp-cap">/{{ e.capacity }}</span></div>
          <div class="event__rsvp-bar">
            <div class="event__rsvp-fill" :style="{ width: fillPct(e) + '%' }" />
          </div>
          <div class="event__rsvp-label">{{ e.rsvpMaybe }} maybe · {{ e.capacity - e.rsvpYes }} spots</div>
        </div>
        <div class="event__chev" aria-hidden="true">›</div>
      </li>
    </ul>
    <div v-else class="empty">
      <div class="empty__title">{{ emptyMessage.title }}</div>
      <div class="empty__hint">{{ emptyMessage.hint }}</div>
      <button v-if="activeTab === 'upcoming' && !search && typeFilter === 'all' && formatFilter === 'all'" class="btn btn--primary empty__cta" @click="openCreate">+ New event</button>
    </div>

    <!-- Detail modal -->
    <CrmModal
      :open="detailOpen"
      eyebrow="Event"
      :title="activeEvent?.title ?? ''"
      width="lg"
      @close="closeDetail"
    >
      <template v-if="activeEvent">
        <div class="detail">
          <div class="detail__hero" :style="{ '--hero-accent': typeColour[activeEvent.type] } as any">
            <div class="detail__hero-body">
              <div class="detail__hero-line">{{ eventSecondaryLine(activeEvent) }} · {{ activeEvent.location }}</div>
              <div class="detail__hero-meta">{{ formatRange(activeEvent.startsAt, activeEvent.endsAt) }} · {{ timeUntilLabel(activeEvent.startsAt) }}</div>
            </div>
            <div class="detail__hero-badges">
              <span v-if="!activeEvent.isPublished" class="badge badge--mute">Draft</span>
              <span v-else class="badge badge--ok">Published</span>
              <span v-if="eventBadge(activeEvent) && eventBadge(activeEvent)!.label !== 'Draft'" class="badge" :class="`badge--${eventBadge(activeEvent)!.tone}`">{{ eventBadge(activeEvent)!.label }}</span>
            </div>
          </div>

          <div class="detail__stats">
            <div class="stat">
              <div class="stat__value">{{ activeEvent.rsvpYes }}</div>
              <div class="stat__label">Going</div>
            </div>
            <div class="stat">
              <div class="stat__value">{{ activeEvent.rsvpMaybe }}</div>
              <div class="stat__label">Maybe</div>
            </div>
            <div class="stat">
              <div class="stat__value">{{ Math.max(0, activeEvent.capacity - activeEvent.rsvpYes) }}</div>
              <div class="stat__label">Spots left</div>
            </div>
            <div class="stat">
              <div class="stat__value">{{ activeEvent.rsvpNo }}</div>
              <div class="stat__label">Declined</div>
            </div>
          </div>

          <div class="detail__cols">
            <section class="detail__section">
              <div class="detail__section-title">Details</div>
              <dl class="dl">
                <div class="dl__row"><dt>When</dt><dd>{{ formatRange(activeEvent.startsAt, activeEvent.endsAt) }}</dd></div>
                <div class="dl__row"><dt>Where</dt><dd>{{ activeEvent.location }}</dd></div>
                <div class="dl__row"><dt>Type</dt><dd>{{ typeLabel[activeEvent.type] }}</dd></div>
                <div v-if="activeEvent.type === 'tournament' && activeEvent.format" class="dl__row"><dt>Format</dt><dd>{{ formatLabel[activeEvent.format] }}</dd></div>
                <div class="dl__row"><dt>Capacity</dt><dd>{{ activeEvent.capacity }} {{ activeEvent.type === 'tournament' ? 'players' : 'attendees' }}</dd></div>
              </dl>
            </section>

            <section class="detail__section">
              <div class="detail__section-title">Organiser</div>
              <dl class="dl">
                <div class="dl__row"><dt>Host</dt><dd>{{ activeEvent.host ?? '—' }}</dd></div>
                <div class="dl__row"><dt>Status</dt><dd>{{ activeEvent.isPublished ? 'Live on public site' : 'Draft (only visible to CRM)' }}</dd></div>
                <div class="dl__row"><dt>RSVP fill</dt><dd>{{ fillPct(activeEvent) }}%</dd></div>
              </dl>
            </section>
          </div>

          <section v-if="activeEvent.description" class="detail__notes">
            <div class="detail__section-title">About</div>
            <p>{{ activeEvent.description }}</p>
          </section>
        </div>
      </template>

      <template #footer>
        <button type="button" class="modal-btn modal-btn--outline" @click="togglePublish">{{ activeEvent?.isPublished ? 'Move to draft' : 'Publish' }}</button>
        <button type="button" class="modal-btn modal-btn--primary" @click="editEvent">Edit event</button>
      </template>
    </CrmModal>

    <!-- Create modal -->
    <CrmModal
      :open="createOpen"
      eyebrow="Events"
      title="Create an event"
      width="md"
      @close="closeCreate"
    >
      <form class="form" @submit.prevent="submit">
        <label class="field">
          <span class="field__label">Title</span>
          <input v-model="form.title" type="text" placeholder="Twilight Triples" autofocus />
        </label>
        <div class="form__row" :class="{ 'form__row--three': formNeedsFormat }">
          <label class="field">
            <span class="field__label">Type</span>
            <select v-model="form.type">
              <option v-for="t in TYPE_ORDER" :key="t" :value="t">{{ typeLabel[t] }}</option>
            </select>
          </label>
          <label v-if="formNeedsFormat" class="field">
            <span class="field__label">Format</span>
            <select v-model="form.format">
              <option value="singles">Singles</option>
              <option value="pairs">Pairs</option>
              <option value="triples">Triples</option>
              <option value="fours">Fours</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label class="field">
            <span class="field__label">Capacity</span>
            <input v-model.number="form.capacity" type="number" min="1" />
          </label>
        </div>
        <div class="form__row form__row--three">
          <label class="field">
            <span class="field__label">Date</span>
            <input v-model="form.date" type="date" />
          </label>
          <label class="field">
            <span class="field__label">Starts</span>
            <input v-model="form.startTime" type="time" />
          </label>
          <label class="field">
            <span class="field__label">Ends</span>
            <input v-model="form.endTime" type="time" />
          </label>
        </div>
        <label class="field">
          <span class="field__label">Location</span>
          <input v-model="form.location" type="text" placeholder="Green 1 & 2" />
        </label>

        <div class="switch-row">
          <div>
            <div class="switch-row__label">Publish to public site immediately</div>
            <div class="switch-row__hint">Off = save as draft. You can still add fields.</div>
          </div>
          <button type="button" class="switch" :class="{ 'is-on': form.publishNow }" @click="form.publishNow = !form.publishNow"><span class="switch__knob" /></button>
        </div>
        <div class="switch-row">
          <div>
            <div class="switch-row__label">Sync to club calendar</div>
            <div class="switch-row__hint">Requires the Google Calendar integration to be connected.</div>
          </div>
          <button type="button" class="switch" :class="{ 'is-on': form.syncCalendar }" @click="form.syncCalendar = !form.syncCalendar"><span class="switch__knob" /></button>
        </div>
      </form>

      <template #footer>
        <button type="button" class="modal-btn modal-btn--outline" @click="closeCreate">Cancel</button>
        <button type="button" class="modal-btn modal-btn--primary" :disabled="!canSubmit" @click="submit">Create event</button>
      </template>
    </CrmModal>
  </div>
</template>

<style scoped>
.events { max-width: 1280px; display: flex; flex-direction: column; gap: 20px; }
.events__header { display: flex; align-items: end; justify-content: space-between; gap: 16px; }
.events__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.events__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.events__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin: 0; }
.events__actions { display: flex; gap: 8px; }

.btn { padding: 9px 14px; border: none; border-radius: 10px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.btn--primary { background: var(--color-ink); color: #fff; }
.btn--primary:hover { background: var(--color-graphite); }
.btn--ghost { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.btn--ghost:hover { background: var(--color-surface); }

/* Toolbar */
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.tabs { display: flex; gap: 6px; padding: 4px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; }
.tab { display: inline-flex; align-items: center; gap: 8px; padding: 7px 16px; background: transparent; border: none; border-radius: 999px; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); cursor: pointer; }
.tab.is-active { background: #fff; color: var(--color-ink); font-weight: 600; box-shadow: var(--shadow-sm); }
.tab__count { font-family: var(--font-mono); font-size: 10px; padding: 1px 7px; background: var(--color-hairline); color: var(--color-graphite); border-radius: 999px; }
.tab.is-active .tab__count { background: var(--color-accent-soft); color: var(--color-accent); }

.search { position: relative; display: flex; align-items: center; min-width: 300px; }
.search__icon { position: absolute; left: 12px; color: var(--color-fog); pointer-events: none; }
.search__input { width: 100%; padding: 9px 36px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; }
.search__input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.search__clear { position: absolute; right: 8px; width: 22px; height: 22px; border-radius: 999px; background: var(--color-surface); border: 0; color: var(--color-graphite); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.search__clear:hover { background: var(--color-hairline); color: var(--color-ink); }

/* Filter chips */
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chips--sub { padding-left: 2px; }
.chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border: 1px solid var(--color-hairline); background: #fff; border-radius: 999px; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-graphite); cursor: pointer; }
.chip:hover:not(:disabled) { border-color: var(--color-mute); }
.chip:disabled { opacity: 0.4; cursor: not-allowed; }
.chip.is-active { background: var(--color-ink); border-color: var(--color-ink); color: #fff; font-weight: 600; }
.chip--sm { padding: 4px 10px; font-size: 11px; }
.chip__dot { width: 8px; height: 8px; border-radius: 999px; }
.chip__count { font-family: var(--font-mono); font-size: 10px; padding: 1px 7px; background: var(--color-surface); color: var(--color-fog); border-radius: 999px; }
.chip.is-active .chip__count { background: rgba(255,255,255,0.12); color: rgba(255,255,255,0.8); }

/* List */
.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.event { display: flex; align-items: center; gap: 20px; padding: 16px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; cursor: pointer; transition: border-color 0.12s ease, box-shadow 0.12s ease; }
.event:hover { border-color: var(--color-mute); box-shadow: var(--shadow-sm); }
.event:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.event__format { width: 4px; align-self: stretch; border-radius: 2px; }
.event__main { flex: 1; min-width: 0; }
.event__title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.event__title { font-family: var(--font-display); font-size: 17px; font-weight: 600; color: var(--color-ink); margin: 0; }
.event__meta { display: flex; gap: 8px; align-items: center; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 4px; }
.event__sep { opacity: 0.5; }
.event__format-label { font-weight: 500; }
.event__when { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--color-accent); margin-top: 6px; }
.event__rsvp { min-width: 160px; text-align: right; }
.event__rsvp-count { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-ink); }
.event__rsvp-cap { font-family: var(--font-mono); font-size: 12px; font-weight: 500; color: var(--color-fog); margin-left: 2px; }
.event__rsvp-bar { height: 4px; background: var(--color-hairline); border-radius: 2px; margin: 4px 0 4px; overflow: hidden; }
.event__rsvp-fill { height: 100%; background: var(--color-accent); border-radius: 2px; }
.event__rsvp-label { font-family: var(--font-body); font-size: 10px; color: var(--color-fog); letter-spacing: 0.04em; text-transform: uppercase; }
.event__chev { color: var(--color-mute); font-size: 20px; padding-left: 4px; flex-shrink: 0; }

/* Badges */
.badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; border: 1px solid transparent; white-space: nowrap; }
.badge--ok       { background: #DCFCE7; color: #14532D; }
.badge--warn     { background: #FEF3C7; color: #92400E; }
.badge--danger   { background: #FEE2E2; color: #991B1B; }
.badge--accent   { background: var(--color-accent-soft); color: var(--color-accent); }
.badge--mute     { background: var(--color-surface); color: var(--color-graphite); border-color: var(--color-hairline); }

/* Empty */
.empty { padding: 48px 32px; text-align: center; font-family: var(--font-body); background: #fff; border: 1px dashed var(--color-hairline); border-radius: 14px; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.empty__title { font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--color-ink); }
.empty__hint { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); }
.empty__cta { margin-top: 14px; }

/* Detail modal */
.detail { display: flex; flex-direction: column; gap: 20px; }
.detail__hero { position: relative; display: flex; align-items: center; gap: 16px; padding: 20px 22px; border-radius: 14px; background: linear-gradient(135deg, var(--color-surface) 0%, #fff 100%); border: 1px solid var(--color-hairline); overflow: hidden; }
.detail__hero::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--hero-accent, var(--color-graphite)); }
.detail__hero-body { flex: 1; min-width: 0; }
.detail__hero-line { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-ink); }
.detail__hero-meta { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; }
.detail__hero-badges { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; flex-shrink: 0; max-width: 220px; }

.detail__stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.stat { background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 2px; }
.stat__value { font-family: var(--font-display); font-size: 22px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); line-height: 1.15; }
.stat__label { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: var(--color-fog); text-transform: uppercase; margin-top: 4px; }

.detail__cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 4px 4px 0; }
.detail__section-title { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); margin: 0 0 12px; }
.dl { display: flex; flex-direction: column; margin: 0; }
.dl__row { display: grid; grid-template-columns: 96px 1fr; gap: 12px; padding: 10px 0; border-top: 1px solid var(--color-hairline); align-items: baseline; }
.dl__row:first-child { border-top: 0; padding-top: 0; }
.dl__row:last-child { padding-bottom: 0; }
.dl dt { font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); margin: 0; }
.dl dd { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); margin: 0; word-break: break-word; }

.detail__notes { padding: 16px 18px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 12px; }
.detail__notes p { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); line-height: 1.6; margin: 8px 0 0; }

/* Modal form */
.form { display: flex; flex-direction: column; gap: 14px; }
.form__row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form__row--three { grid-template-columns: 1fr 1fr 1fr; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.field input, .field select { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; }
.field input:focus, .field select:focus { outline: none; border-color: var(--color-ink); }
.switch-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 0; border-top: 1px solid var(--color-hairline); }
.switch-row__label { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.switch-row__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; }
.switch { width: 40px; height: 24px; padding: 3px; border-radius: 999px; background: var(--color-hairline); border: 0; display: flex; cursor: pointer; flex-shrink: 0; }
.switch.is-on { background: var(--color-ink); }
.switch__knob { width: 18px; height: 18px; border-radius: 999px; background: #fff; transition: transform 0.15s ease; }
.switch.is-on .switch__knob { transform: translateX(16px); }
.modal-btn { padding: 9px 16px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: 0; }
.modal-btn--primary { background: var(--color-ink); color: #fff; }
.modal-btn--primary:hover:not(:disabled) { background: var(--color-graphite); }
.modal-btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
.modal-btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.modal-btn--outline:hover { background: var(--color-surface); }

@media (max-width: 900px) {
  .detail__cols { grid-template-columns: 1fr; gap: 20px; }
  .detail__stats { grid-template-columns: repeat(2, 1fr); }
  .detail__hero { flex-wrap: wrap; }
  .detail__hero-badges { justify-content: flex-start; max-width: none; }
}

@media (max-width: 767px) {
  .events__header { flex-direction: column; align-items: stretch; gap: 12px; }
  .events__actions { display: none; }
  .events__heading { font-size: 28px; }
  .toolbar { flex-direction: column; align-items: stretch; gap: 8px; }
  .search { min-width: 0; width: 100%; }
  .tabs { width: 100%; }
  .tab { flex: 1; justify-content: center; }
  .chips { overflow-x: auto; flex-wrap: nowrap; padding-bottom: 2px; }
  .chip { flex-shrink: 0; }
  .event { flex-wrap: wrap; gap: 12px; padding: 14px 16px; }
  .event__main { flex-basis: calc(100% - 20px); min-width: 0; }
  .event__title { font-size: 15px; }
  .event__meta { flex-wrap: wrap; gap: 6px; font-size: 11px; }
  .event__rsvp { flex: 1; text-align: left; min-width: 0; }
  .event__rsvp-count { font-size: 18px; }
  .event__chev { display: none; }
  .form__row, .form__row--three { grid-template-columns: 1fr; }
}
</style>
