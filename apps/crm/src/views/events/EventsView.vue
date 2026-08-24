<script setup lang="ts">
/**
 * Events — real CRUD wired to briefs 29 (events CRUD) and 33 (public
 * events range list).
 *
 * Owners see every event (published + draft) in a rolling 12-month
 * window around today. Cards show at-a-glance meta (when, where,
 * format/type, RSVP fill). Clicking a card or "+ New event" opens the
 * unified editor modal; delete lives in the same modal footer. Host is
 * a linked member: typeahead searches the roster, `host_not_in_club`
 * from the API paints the field red inline.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  events as eventsApi,
  members as membersApi,
  type Event,
  type EventCreateInput,
  type EventType,
  type BowlsFormat,
  type RosterMember,
  ApiError,
} from '@torny/api-client'
import CrmModal from '@/components/modals/CrmModal.vue'
import { useClubStore } from '@/stores/club'
import { useToast } from '@/composables/useToast'

// ── Stores + helpers ──────────────────────────────────────────

const clubStore = useClubStore()
const toast = useToast()
const clubId = computed(() => clubStore.current?.id ?? null)

type Tab = 'upcoming' | 'past'

const activeTab = ref<Tab>('upcoming')
const search = ref('')
const typeFilter = ref<'all' | EventType>('all')
const formatFilter = ref<'all' | BowlsFormat>('all')

const events = ref<Event[]>([])
const loading = ref(false)

/** Live clock so upcoming/past bucketing updates as time passes. Ticks
 *  once a minute — good enough for a "when is my event" view. */
const nowTick = ref(Date.now())
let nowTimer: ReturnType<typeof setInterval> | null = null

// ── Data load ─────────────────────────────────────────────────

async function loadEvents() {
  const cid = clubId.value
  if (cid == null) {
    events.value = []
    return
  }
  loading.value = true
  try {
    // Rolling 12mo window either side of today. Backend accepts any ISO —
    // dates are fine (interpreted as start-of-day UTC on the server side).
    const from = new Date()
    from.setFullYear(from.getFullYear() - 1)
    const to = new Date()
    to.setFullYear(to.getFullYear() + 1)
    const list = await eventsApi.list(cid, {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    })
    events.value = list
  } catch (err) {
    events.value = []
    toast.error(errMessage(err, 'Failed to load events.'))
  } finally {
    loading.value = false
  }
}

// ── Filtering ─────────────────────────────────────────────────

const byTab = computed(() => {
  const now = nowTick.value
  return events.value.filter((e) => {
    const start = new Date(e.starts_at).getTime()
    return activeTab.value === 'upcoming' ? start >= now : start < now
  })
})

const counts = computed(() => {
  const now = nowTick.value
  return {
    upcoming: events.value.filter((e) => new Date(e.starts_at).getTime() >= now).length,
    past: events.value.filter((e) => new Date(e.starts_at).getTime() < now).length,
  }
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return byTab.value
    .filter((e) => {
      if (typeFilter.value !== 'all' && e.event_type !== typeFilter.value) return false
      if (formatFilter.value !== 'all' && e.format !== formatFilter.value) return false
      if (!q) return true
      return (
        e.title.toLowerCase().includes(q) ||
        (e.location ?? '').toLowerCase().includes(q) ||
        (e.host_name ?? '').toLowerCase().includes(q) ||
        (e.format ?? '').toLowerCase().includes(q) ||
        e.event_type.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      const da = new Date(a.starts_at).getTime()
      const db = new Date(b.starts_at).getTime()
      return activeTab.value === 'upcoming' ? da - db : db - da
    })
})

// Format sub-chips only make sense when scoping to tournaments.
const formatFilterVisible = computed(
  () => typeFilter.value === 'all' || typeFilter.value === 'tournament',
)

const TYPE_ORDER: EventType[] = ['tournament', 'pennant', 'social', 'training', 'other']

const typeCounts = computed(() => {
  const src = byTab.value
  const base: Record<'all' | EventType, number> = {
    all: src.length,
    tournament: 0,
    pennant: 0,
    social: 0,
    training: 0,
    other: 0,
  }
  for (const e of src) base[e.event_type] += 1
  return base
})

const formatCounts = computed(() => {
  const src = byTab.value.filter(
    (e) => typeFilter.value === 'all' || e.event_type === typeFilter.value,
  )
  return {
    all: src.length,
    singles: src.filter((e) => e.format === 'singles').length,
    pairs: src.filter((e) => e.format === 'pairs').length,
    triples: src.filter((e) => e.format === 'triples').length,
    fours: src.filter((e) => e.format === 'fours').length,
  }
})

// ── Display helpers ───────────────────────────────────────────

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${DAY_ABBR[d.getDay()]} ${d.getDate()} ${MONTH_ABBR[d.getMonth()]}`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  let h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return m ? `${h}:${m.toString().padStart(2, '0')} ${ampm}` : `${h}:00 ${ampm}`
}

function formatRange(startIso: string, endIso: string | null): string {
  const base = `${formatDate(startIso)} · ${formatTime(startIso)}`
  if (!endIso) return base
  return `${base} – ${formatTime(endIso)}`
}

function daysUntil(iso: string): number {
  const d = new Date(iso).getTime()
  return Math.round((d - nowTick.value) / (1000 * 60 * 60 * 24))
}

function timeUntilLabel(iso: string): string {
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

function fillPct(e: Event): number {
  if (e.capacity == null || e.capacity <= 0) return 0
  return Math.min(
    100,
    Math.round(((e.rsvp_going_count + e.rsvp_maybe_count) / e.capacity) * 100),
  )
}

const formatColour: Record<BowlsFormat, string> = {
  singles: 'var(--color-feature-mint)',
  pairs: 'var(--color-accent)',
  triples: 'var(--color-feature-tangerine)',
  fours: 'var(--color-feature-violet)',
  other: 'var(--color-graphite)',
}

const formatLabel: Record<BowlsFormat, string> = {
  singles: 'Singles',
  pairs: 'Pairs',
  triples: 'Triples',
  fours: 'Fours',
  other: 'Other',
}

const typeLabel: Record<EventType, string> = {
  tournament: 'Tournament',
  pennant: 'Pennant',
  social: 'Social',
  training: 'Training',
  other: 'Other',
}

// Accent bar on the left of each card + the dot on the type chip.
const typeColour: Record<EventType, string> = {
  tournament: 'var(--color-ink)',
  pennant: '#1D4ED8',
  social: '#E85D5D',
  training: 'var(--color-feature-violet)',
  other: 'var(--color-graphite)',
}

function eventSecondaryLine(e: Event): string {
  if (e.event_type === 'tournament' && e.format) return formatLabel[e.format]
  return typeLabel[e.event_type]
}

function eventBadge(e: Event): { label: string; tone: string } | null {
  if (!e.is_published) return { label: 'Draft', tone: 'mute' }
  if (e.capacity != null && e.capacity > 0) {
    const pct = (e.rsvp_going_count + e.rsvp_maybe_count) / e.capacity
    if (pct >= 1) return { label: 'Full', tone: 'danger' }
    if (pct >= 0.75) return { label: 'Nearly full', tone: 'warn' }
  }
  const d = daysUntil(e.starts_at)
  if (d >= 0 && d <= 3) return { label: 'This week', tone: 'accent' }
  return null
}

// ── Editor modal (create + edit unified) ──────────────────────

const editorOpen = ref(false)
const editing = ref<Event | null>(null)
const submitting = ref(false)
const editorError = ref<string | null>(null)
/** user_id we flagged as `host_not_in_club` on the last save attempt. */
const invalidHostUserId = ref<number | null>(null)

interface EditorForm {
  title: string
  event_type: EventType
  format: BowlsFormat
  excerpt: string
  description: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  location: string
  host_user_id: number | null
  host_name: string
  capacity: string
  is_ticketed: boolean
  rsvp_open: boolean
  is_published: boolean
}

function emptyForm(): EditorForm {
  return {
    title: '',
    event_type: 'tournament',
    format: 'singles',
    excerpt: '',
    description: '',
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    location: '',
    host_user_id: null,
    host_name: '',
    capacity: '',
    is_ticketed: false,
    rsvp_open: true,
    is_published: true,
  }
}

const form = reactive<EditorForm>(emptyForm())
const formNeedsFormat = computed(() => form.event_type === 'tournament')

function resetForm(next: EditorForm) {
  Object.assign(form, next)
}

/** Split an ISO datetime into the two `YYYY-MM-DD` + `HH:MM` chunks the
 *  bare <input type="date"> / <input type="time"> pair needs. */
function splitIsoForInputs(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { date: '', time: '' }
  const pad = (n: number) => n.toString().padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return { date, time }
}

/** Combine date + time back into a local-tz ISO datetime string. */
function combineDateTime(date: string, time: string): string | null {
  if (!date) return null
  const t = time || '00:00'
  // `${date}T${time}` is local-time; new Date() converts to UTC ISO.
  const d = new Date(`${date}T${t}`)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function openCreate() {
  editing.value = null
  editorError.value = null
  invalidHostUserId.value = null
  resetForm(emptyForm())
  editorOpen.value = true
}

function openEdit(e: Event) {
  editing.value = e
  editorError.value = null
  invalidHostUserId.value = null
  const start = splitIsoForInputs(e.starts_at)
  const end = splitIsoForInputs(e.ends_at)
  resetForm({
    title: e.title,
    event_type: e.event_type,
    format: e.format ?? 'singles',
    excerpt: e.excerpt ?? '',
    description: e.description ?? '',
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    location: e.location ?? '',
    host_user_id: e.host_user_id == null ? null : Number(e.host_user_id),
    host_name: e.host_name ?? '',
    capacity: e.capacity == null ? '' : String(e.capacity),
    is_ticketed: e.is_ticketed,
    rsvp_open: e.rsvp_open,
    is_published: e.is_published,
  })
  editorOpen.value = true
}

function closeEditor() {
  editorOpen.value = false
}

const canSubmit = computed(() => {
  return (
    form.title.trim().length > 0 &&
    form.startDate.length > 0 &&
    form.startTime.length > 0
  )
})

async function submitEditor() {
  const cid = clubId.value
  if (cid == null || !canSubmit.value || submitting.value) return

  const startsAt = combineDateTime(form.startDate, form.startTime)
  if (!startsAt) {
    editorError.value = 'Please pick a valid start date and time.'
    return
  }
  const endsAt = combineDateTime(form.endDate, form.endTime)

  const capacityNum = form.capacity.trim() === '' ? null : Number(form.capacity)
  if (capacityNum != null && !Number.isFinite(capacityNum)) {
    editorError.value = 'Capacity must be a number, or blank.'
    return
  }

  submitting.value = true
  editorError.value = null
  invalidHostUserId.value = null

  const payload: EventCreateInput = {
    title: form.title.trim(),
    event_type: form.event_type,
    starts_at: startsAt,
    ends_at: endsAt,
    format: form.event_type === 'tournament' ? form.format : null,
    excerpt: form.excerpt.trim() || null,
    description: form.description.trim() || null,
    location: form.location.trim() || null,
    host_user_id: form.host_user_id,
    host_name: form.host_name.trim() || null,
    capacity: capacityNum,
    is_ticketed: form.is_ticketed,
    is_published: form.is_published,
    rsvp_open: form.rsvp_open,
  }

  try {
    if (editing.value) {
      const eventId = Number(editing.value.id)
      const updated = await eventsApi.update(cid, eventId, payload)
      const idx = events.value.findIndex((e) => e.id === updated.id)
      if (idx >= 0) events.value.splice(idx, 1, updated)
      else events.value = [...events.value, updated]
      toast.success('Event updated.')
    } else {
      const created = await eventsApi.create(cid, payload)
      events.value = [created, ...events.value]
      toast.success(`Created ${created.title}.`)
    }
    closeEditor()
  } catch (err) {
    if (err instanceof ApiError) {
      const body = (err.body ?? {}) as { code?: string; user_id?: number }
      if (body.code === 'host_not_in_club' && body.user_id != null) {
        invalidHostUserId.value = body.user_id
        editorError.value =
          "That user isn't a current member of the club. Unlink them or pick a different member."
      } else {
        editorError.value = err.message
      }
    } else {
      editorError.value = errMessage(err, 'Could not save the event.')
    }
  } finally {
    submitting.value = false
  }
}

async function deleteEditing() {
  const cid = clubId.value
  const target = editing.value
  if (cid == null || target == null) return
  const ok = confirm(`Delete "${target.title}"? This cannot be undone.`)
  if (!ok) return
  try {
    await eventsApi.remove(cid, Number(target.id))
    events.value = events.value.filter((e) => e.id !== target.id)
    toast.success('Event deleted.')
    closeEditor()
  } catch (err) {
    editorError.value = errMessage(err, 'Could not delete the event.')
  }
}

// ── Host typeahead ────────────────────────────────────────────

const hostResults = ref<RosterMember[]>([])
const hostSearching = ref(false)
const hostFocused = ref(false)
let hostDebounce: ReturnType<typeof setTimeout> | null = null
let hostAbort: AbortController | null = null

function scheduleHostSearch(q: string) {
  if (hostDebounce) clearTimeout(hostDebounce)
  if (q.trim().length < 2) {
    hostResults.value = []
    hostSearching.value = false
    return
  }
  hostSearching.value = true
  hostDebounce = setTimeout(() => {
    void fireHostSearch(q.trim())
  }, 250)
}

async function fireHostSearch(q: string) {
  const cid = clubId.value
  if (cid == null) return
  if (hostAbort) hostAbort.abort()
  hostAbort = new AbortController()
  try {
    const res = await membersApi.listRoster(
      cid,
      { search: q, limit: 8, status: 'all', include_invites: false },
      { signal: hostAbort.signal },
    )
    hostResults.value = res.members
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    hostResults.value = []
  } finally {
    hostSearching.value = false
  }
}

function onHostInput(value: string) {
  form.host_name = value
  hostFocused.value = true
  if (form.host_user_id != null && value.trim() === '') {
    form.host_user_id = null
  }
  scheduleHostSearch(value)
}

function onHostFocus() {
  hostFocused.value = true
  scheduleHostSearch(form.host_name)
}

function onHostBlur() {
  // Delay so a click on a dropdown item (mousedown.prevent) can commit
  // before the dropdown unmounts.
  setTimeout(() => {
    hostFocused.value = false
  }, 120)
}

function pickHost(member: RosterMember) {
  form.host_user_id = member.user_id
  form.host_name = member.name
  hostFocused.value = false
  hostResults.value = []
  if (invalidHostUserId.value === member.user_id) invalidHostUserId.value = null
}

function unlinkHost() {
  form.host_user_id = null
  invalidHostUserId.value = null
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => (w[0] ?? '').toUpperCase())
    .join('')
}

// ── View calendar (link out to public site) ───────────────────

function openPublicCalendar() {
  const slug = clubStore.current?.slug
  if (!slug) {
    toast.error("Couldn't get this club's slug — try refreshing.")
    return
  }
  window.open(`http://localhost:3001/events?host=${slug}.torny.club`, '_blank', 'noopener')
}

// ── Error helper ──────────────────────────────────────────────

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback
  if (err instanceof Error) return err.message || fallback
  return fallback
}

// ── Empty message ─────────────────────────────────────────────

const emptyMessage = computed(() => {
  if (search.value.trim() || typeFilter.value !== 'all' || formatFilter.value !== 'all') {
    return { title: 'No matches', hint: 'Try clearing the search or filters.' }
  }
  return activeTab.value === 'upcoming'
    ? { title: 'No events scheduled', hint: 'Click "+ New event" to get one on the calendar.' }
    : { title: 'No past events', hint: 'Wrapped-up events land here.' }
})

// ── Wiring ────────────────────────────────────────────────────

onMounted(() => {
  if (clubId.value != null) void loadEvents()
  nowTimer = setInterval(() => {
    nowTick.value = Date.now()
  }, 60_000)
})

watch(clubId, (cid) => {
  events.value = []
  if (cid != null) void loadEvents()
})

onBeforeUnmount(() => {
  if (nowTimer) clearInterval(nowTimer)
  if (hostDebounce) clearTimeout(hostDebounce)
  if (hostAbort) hostAbort.abort()
})
</script>

<template>
  <div class="events">
    <header class="events__header">
      <div>
        <div class="events__eyebrow">What's on</div>
        <h1 class="events__heading">Events</h1>
        <p class="events__sub">
          {{ counts.upcoming }} upcoming ·
          {{ events.filter((e) => e.is_published).length }} live on your site
        </p>
      </div>
      <div class="events__actions">
        <button class="btn btn--ghost" @click="openPublicCalendar">View calendar</button>
        <button class="btn btn--primary" @click="openCreate">+ New event</button>
      </div>
    </header>

    <div class="toolbar">
      <div class="tabs">
        <button
          class="tab"
          :class="{ 'is-active': activeTab === 'upcoming' }"
          @click="activeTab = 'upcoming'; typeFilter = 'all'; formatFilter = 'all'"
        >
          <span>Upcoming</span>
          <span class="tab__count">{{ counts.upcoming }}</span>
        </button>
        <button
          class="tab"
          :class="{ 'is-active': activeTab === 'past' }"
          @click="activeTab = 'past'; typeFilter = 'all'; formatFilter = 'all'"
        >
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
      <template v-for="t in TYPE_ORDER" :key="t">
        <button
          v-if="typeCounts[t] > 0"
          class="chip"
          :class="{ 'is-active': typeFilter === t }"
          @click="typeFilter = t; if (t !== 'tournament') formatFilter = 'all'"
        >
          <span class="chip__dot" :style="{ background: typeColour[t] }" />
          <span class="chip__label">{{ typeLabel[t] }}</span>
          <span class="chip__count">{{ typeCounts[t] }}</span>
        </button>
      </template>
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
      <li
        v-for="e in filtered"
        :key="e.id"
        class="event"
        tabindex="0"
        @click="openEdit(e)"
        @keydown.enter="openEdit(e)"
      >
        <div class="event__format" :style="{ background: typeColour[e.event_type] }" />
        <div class="event__main">
          <div class="event__title-row">
            <h3 class="event__title">{{ e.title }}</h3>
            <span
              v-if="eventBadge(e)"
              class="badge"
              :class="`badge--${eventBadge(e)!.tone}`"
            >{{ eventBadge(e)!.label }}</span>
          </div>
          <div class="event__meta">
            <span>{{ formatRange(e.starts_at, e.ends_at) }}</span>
            <template v-if="e.location">
              <span class="event__sep">·</span>
              <span>{{ e.location }}</span>
            </template>
            <span class="event__sep">·</span>
            <span class="event__format-label">{{ eventSecondaryLine(e) }}</span>
          </div>
          <div class="event__when">{{ timeUntilLabel(e.starts_at) }}</div>
        </div>
        <div class="event__rsvp">
          <div class="event__rsvp-count">
            {{ e.rsvp_going_count }}<span class="event__rsvp-cap">/{{ e.capacity ?? '∞' }}</span>
          </div>
          <div class="event__rsvp-bar">
            <div class="event__rsvp-fill" :style="{ width: fillPct(e) + '%' }" />
          </div>
          <div class="event__rsvp-label">
            {{ e.rsvp_maybe_count }} maybe ·
            {{ e.capacity != null ? Math.max(0, e.capacity - e.rsvp_going_count) + ' spots' : 'no cap' }}
          </div>
        </div>
        <div class="event__chev" aria-hidden="true">›</div>
      </li>
    </ul>

    <div v-else-if="loading" class="empty">
      <div class="empty__title">Loading events…</div>
      <div class="empty__hint">One moment.</div>
    </div>

    <div v-else class="empty">
      <div class="empty__title">{{ emptyMessage.title }}</div>
      <div class="empty__hint">{{ emptyMessage.hint }}</div>
      <button
        v-if="activeTab === 'upcoming' && !search && typeFilter === 'all' && formatFilter === 'all'"
        class="btn btn--primary empty__cta"
        @click="openCreate"
      >
        + New event
      </button>
    </div>

    <!-- Editor modal (create + edit) -->
    <CrmModal
      :open="editorOpen"
      eyebrow="Events"
      :title="editing ? 'Edit event' : 'Create an event'"
      width="lg"
      @close="closeEditor"
    >
      <form class="form" @submit.prevent="submitEditor">
        <label class="field">
          <span class="field__label">Title</span>
          <input v-model="form.title" type="text" placeholder="Twilight Triples" autofocus />
        </label>

        <label class="field">
          <span class="field__label">Excerpt (optional)</span>
          <input v-model="form.excerpt" type="text" maxlength="500" placeholder="One-liner for the calendar tile" />
          <span class="field__hint">Shown on the calendar tile. Up to 500 characters.</span>
        </label>

        <div class="form__row" :class="{ 'form__row--three': formNeedsFormat }">
          <label class="field">
            <span class="field__label">Type</span>
            <select v-model="form.event_type">
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
            <span class="field__label">Capacity (optional)</span>
            <input v-model="form.capacity" type="number" min="1" placeholder="24" />
          </label>
        </div>

        <div class="form__row form__row--three">
          <label class="field">
            <span class="field__label">Start date</span>
            <input v-model="form.startDate" type="date" />
          </label>
          <label class="field">
            <span class="field__label">Starts</span>
            <input v-model="form.startTime" type="time" />
          </label>
          <label class="field">
            <span class="field__label">Ends (optional)</span>
            <input v-model="form.endTime" type="time" />
          </label>
        </div>

        <label class="field">
          <span class="field__label">End date (optional)</span>
          <input v-model="form.endDate" type="date" />
          <span class="field__hint">Only needed if the event runs past midnight or spans multiple days.</span>
        </label>

        <label class="field">
          <span class="field__label">Location (optional)</span>
          <input v-model="form.location" type="text" placeholder="Green 1 & 2" />
        </label>

        <label class="field">
          <span class="field__label">Description (optional)</span>
          <textarea v-model="form.description" rows="4" placeholder="Format details, prizes, dress code…" />
        </label>

        <div
          class="field field--host"
          :class="{ 'is-invalid': form.host_user_id != null && invalidHostUserId === form.host_user_id }"
        >
          <span class="field__label">Host (optional)</span>
          <div class="host">
            <input
              :value="form.host_name"
              type="text"
              placeholder="Start typing a member's name…"
              @input="onHostInput(($event.target as HTMLInputElement).value)"
              @focus="onHostFocus()"
              @blur="onHostBlur()"
            />
            <div v-if="form.host_user_id != null" class="host__linked">
              <span class="host__linked-badge">✓ Linked to member</span>
              <button type="button" class="host__unlink" @click="unlinkHost">Unlink</button>
            </div>
            <div
              v-if="hostFocused && (hostResults.length > 0 || hostSearching)"
              class="member-dropdown"
            >
              <div v-if="hostSearching && hostResults.length === 0" class="member-dropdown__loading">
                Searching…
              </div>
              <button
                v-for="m in hostResults"
                :key="m.user_id"
                type="button"
                class="member-dropdown__item"
                @mousedown.prevent="pickHost(m)"
              >
                <span class="member-dropdown__avatar">{{ initialsFor(m.name) }}</span>
                <span class="member-dropdown__body">
                  <span class="member-dropdown__name">{{ m.name }}</span>
                  <span v-if="m.email" class="member-dropdown__email">{{ m.email }}</span>
                </span>
              </button>
            </div>
          </div>
          <span class="field__hint">
            Leave blank if there's no host. Pick a member to link — you can also type a name that isn't a Torny user (e.g. "Committee").
          </span>
        </div>

        <div class="switch-row">
          <div>
            <div class="switch-row__label">Ticketed event</div>
            <div class="switch-row__hint">On = attendees pay (integration coming). Off = free / RSVP only.</div>
          </div>
          <button type="button" class="switch" :class="{ 'is-on': form.is_ticketed }" @click="form.is_ticketed = !form.is_ticketed"><span class="switch__knob" /></button>
        </div>
        <div class="switch-row">
          <div>
            <div class="switch-row__label">RSVPs open</div>
            <div class="switch-row__hint">Off = attendees can't RSVP (event visible but locked).</div>
          </div>
          <button type="button" class="switch" :class="{ 'is-on': form.rsvp_open }" @click="form.rsvp_open = !form.rsvp_open"><span class="switch__knob" /></button>
        </div>
        <div class="switch-row">
          <div>
            <div class="switch-row__label">Publish to public site</div>
            <div class="switch-row__hint">Off = save as draft. Only owners see drafts.</div>
          </div>
          <button type="button" class="switch" :class="{ 'is-on': form.is_published }" @click="form.is_published = !form.is_published"><span class="switch__knob" /></button>
        </div>

        <div v-if="editorError" class="form__error">{{ editorError }}</div>
      </form>

      <template #footer>
        <button
          v-if="editing"
          type="button"
          class="modal-btn modal-btn--danger"
          :disabled="submitting"
          @click="deleteEditing"
        >
          Delete
        </button>
        <button type="button" class="modal-btn modal-btn--outline" @click="closeEditor">Cancel</button>
        <button
          type="button"
          class="modal-btn modal-btn--primary"
          :disabled="!canSubmit || submitting"
          @click="submitEditor"
        >
          {{ submitting ? 'Saving…' : editing ? 'Save changes' : 'Create event' }}
        </button>
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

/* Modal form */
.form { display: flex; flex-direction: column; gap: 14px; }
.form__row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form__row--three { grid-template-columns: 1fr 1fr 1fr; }
.form__error { padding: 10px 12px; background: #FEE2E2; color: #991B1B; border-radius: 8px; font-family: var(--font-body); font-size: 13px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.field__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }
.field input, .field select, .field textarea { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; }
.field input:focus, .field select:focus, .field textarea:focus { outline: none; border-color: var(--color-ink); }
.field textarea { resize: vertical; min-height: 80px; font-family: var(--font-body); line-height: 1.5; }

/* Host picker */
.field--host.is-invalid .host input { border-color: #FCA5A5; background: #FEE2E2; }
.host { position: relative; display: flex; flex-direction: column; gap: 6px; }
.host__linked { display: flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 11px; }
.host__linked-badge { color: var(--color-accent); font-weight: 600; }
.host__unlink { background: transparent; border: 0; color: var(--color-fog); text-decoration: underline; cursor: pointer; font-size: 11px; padding: 0; }

/* Member dropdown (shared style with honour-board) */
.member-dropdown { position: absolute; top: 44px; left: 0; right: 0; z-index: 20; max-height: 240px; overflow-y: auto; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; box-shadow: var(--shadow-md); padding: 4px; }
.member-dropdown__loading { padding: 12px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); text-align: center; }
.member-dropdown__item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; background: transparent; border: 0; border-radius: 8px; cursor: pointer; text-align: left; }
.member-dropdown__item:hover { background: var(--color-surface); }
.member-dropdown__avatar { width: 32px; height: 32px; border-radius: 999px; background: var(--color-accent); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 11px; font-weight: 700; flex-shrink: 0; }
.member-dropdown__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.member-dropdown__name { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.member-dropdown__email { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }

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
.modal-btn--danger { background: transparent; color: #991B1B; border: 1px solid #FCA5A5; margin-right: auto; }
.modal-btn--danger:hover:not(:disabled) { background: #FEE2E2; }
.modal-btn--danger:disabled { opacity: 0.5; cursor: not-allowed; }

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
