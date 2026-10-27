<script setup lang="ts">
/**
 * Venue bookings — v1 is a filtered Enquiries inbox. Every call to
 * `enquiriesApi.list()` is pinned to `topic='facilities'` so admins get
 * a focused tray instead of having to filter the general feed down to
 * booking requests. The row shape is still an EnquiryRow — we parse the
 * structured plaintext written by VenueBookingBlock into display fields.
 *
 * When brief 62's `venue_bookings` resource ships, this view swaps the
 * API call + drops the parser. UX stays identical.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { useClubStore } from '@/stores/club'
import {
  enquiries as enquiriesApi,
  ApiError,
  type EnquiryRow,
  type EnquiryStatus,
} from '@torny/api-client'
import { parseVenueBookingMessage, formatMoney } from './parseMessage'

const toast = useToast()
const clubStore = useClubStore()
const router = useRouter()

const rows = ref<EnquiryRow[]>([])
/** Counts from the list endpoint are club-wide (across all topics). We
 *  only use these as a loose signal — the status chips below show
 *  current-filter counts via a client-side pass. Brief flagged a
 *  `counts_topic=facilities` server-side add if we want them exact. */
const clubCounts = ref({ new: 0, read: 0, replied: 0, archived: 0 })
const loading = ref(true)
const search = ref('')
const debouncedSearch = ref('')
const statusFilter = ref<'all' | EnquiryStatus>('new')
let searchDebounce: ReturnType<typeof setTimeout> | null = null
let listAbort: AbortController | null = null

watch(search, (q) => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => { debouncedSearch.value = q.trim() }, 250)
})

async function loadList() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') { rows.value = []; loading.value = false; return }
  if (listAbort) listAbort.abort()
  listAbort = new AbortController()
  loading.value = true
  try {
    const res = await enquiriesApi.list(cid, {
      topic: 'facilities',
      status: statusFilter.value,
      search: debouncedSearch.value || undefined,
      limit: 50,
    }, { signal: listAbort.signal })
    rows.value = res.enquiries
    clubCounts.value = res.counts
    // Broadcast the facilities-scoped new count so the sidebar badge
    // stays live after admins triage rows. The sidebar also does its
    // own cheap fetch on mount.
    if (typeof window !== 'undefined') {
      const facilitiesNew = res.enquiries.filter((e) => e.status === 'new').length
      window.dispatchEvent(new CustomEvent('torny:venue-bookings-count', { detail: facilitiesNew }))
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    toast.error(err instanceof ApiError ? err.message : 'Could not load venue bookings.')
    rows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => { void loadList() })
watch(() => clubStore.current?.id, () => { void loadList() })
watch([statusFilter, debouncedSearch], () => { void loadList() })

const statusTone: Record<EnquiryStatus, 'warn' | 'ink' | 'ok' | 'mute'> = {
  new: 'warn',
  read: 'ink',
  replied: 'ok',
  archived: 'mute',
}
const statusLabel: Record<EnquiryStatus, string> = {
  new: 'New', read: 'Read', replied: 'Replied', archived: 'Archived',
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const a = parts[0]?.[0] ?? ''
  const b = parts.length > 1 ? parts[parts.length - 1]![0] : ''
  return `${a}${b}`.toUpperCase()
}
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const diff = Date.now() - then
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`
  if (day < 28) { const wk = Math.floor(day / 7); return `${wk} week${wk === 1 ? '' : 's'} ago` }
  return new Date(iso).toLocaleDateString()
}

/** The list endpoint returns `message_preview` (first ~160 chars). The
 *  preview is enough to pull the first 2–3 lines, which is where the
 *  structured header lives. */
interface BookingRow {
  row: EnquiryRow
  parsed: ReturnType<typeof parseVenueBookingMessage>
}
const parsedRows = computed<BookingRow[]>(() =>
  rows.value.map((row) => ({ row, parsed: parseVenueBookingMessage(row.message_preview) })),
)

const newVisible = computed(() => rows.value.filter((e) => e.status === 'new').length)
const totalVisible = computed(() => rows.value.length)

const emptyMessage = computed(() => {
  if (debouncedSearch.value) return { title: 'No matches', hint: 'Try a different search.' }
  switch (statusFilter.value) {
    case 'new':      return { title: 'Nothing new', hint: 'Fresh venue bookings show up here first.' }
    case 'read':     return { title: 'No read bookings', hint: 'Read but unresolved bookings land here.' }
    case 'replied':  return { title: 'No replies yet', hint: 'Bookings you\'ve responded to land here.' }
    case 'archived': return { title: 'No archived bookings', hint: 'Archived bookings live here for audit.' }
    default:         return { title: 'No venue bookings yet', hint: 'When someone books your venue, they land here.' }
  }
})

function openRow(r: EnquiryRow) {
  router.push({ name: 'venue-booking-detail', params: { id: String(r.id) } })
}
</script>

<template>
  <div class="vb">
    <header class="vb__header">
      <div>
        <div class="vb__eyebrow">Venue hire</div>
        <h1 class="vb__heading">Bookings</h1>
        <p class="vb__sub">
          {{ newVisible }} new in view
          <template v-if="clubCounts.new"> · {{ clubCounts.new }} across the whole inbox</template>
        </p>
      </div>
      <div class="vb__actions">
        <div class="search">
          <svg class="search__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input v-model="search" placeholder="Search name, email, message…" class="search__input" />
          <button v-if="search" class="search__clear" aria-label="Clear search" @click="search = ''">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      </div>
    </header>

    <div class="search search--mobile">
      <svg class="search__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
      </svg>
      <input v-model="search" placeholder="Search bookings…" class="search__input" />
    </div>

    <div class="filters">
      <div class="chips">
        <button
          v-for="tab in (['new', 'read', 'replied', 'archived', 'all'] as const)"
          :key="tab"
          class="chip"
          :class="{ 'is-active': statusFilter === tab }"
          @click="statusFilter = tab"
        >
          <span class="chip__label">{{ tab === 'all' ? 'All' : statusLabel[tab] }}</span>
        </button>
      </div>
    </div>

    <div v-if="loading && rows.length === 0" class="empty">
      <div class="empty__title">Loading…</div>
    </div>

    <ul v-else-if="parsedRows.length" class="list">
      <li
        v-for="{ row, parsed } in parsedRows"
        :key="row.id"
        class="row"
        :class="{ 'row--unread': row.status === 'new' }"
        tabindex="0"
        @click="openRow(row)"
        @keydown.enter="openRow(row)"
      >
        <div class="row__avatar">{{ initials(row.full_name) }}</div>

        <div class="row__body">
          <div class="row__name-row">
            <div class="row__name">{{ row.full_name }}</div>
            <span v-if="row.status === 'new'" class="badge badge--warn">New</span>
            <span v-if="parsed.occasion" class="badge badge--topic">{{ parsed.occasion }}</span>
            <span v-if="row.note_count > 0" class="badge badge--mute">{{ row.note_count }} note{{ row.note_count === 1 ? '' : 's' }}</span>
          </div>
          <div class="row__meta">
            <span>{{ row.email }}</span>
            <template v-if="row.phone"><span class="row__sep">·</span><span>{{ row.phone }}</span></template>
          </div>
          <div v-if="parsed.ok" class="row__summary">
            <span v-if="parsed.date_label" class="summary__date">{{ parsed.date_label }}</span>
            <template v-if="parsed.package">
              <span class="row__sep">·</span>
              <span class="summary__pkg">{{ parsed.package }}<template v-if="parsed.slot"> · {{ parsed.slot }}</template></span>
            </template>
            <template v-if="parsed.guest_count != null">
              <span class="row__sep">·</span>
              <span class="summary__guests">{{ parsed.guest_count }} guests</span>
            </template>
          </div>
          <div v-else class="row__preview">{{ row.message_preview }}</div>
        </div>

        <div class="row__value">
          <div v-if="parsed.total != null" class="row__value-main">{{ formatMoney(parsed.total) }}</div>
          <div class="row__value-sub">{{ timeAgo(row.received_at) }}</div>
        </div>

        <span class="pill" :class="`pill--${statusTone[row.status]}`">{{ statusLabel[row.status] }}</span>
        <div class="row__chev" aria-hidden="true">›</div>
      </li>
    </ul>
    <div v-else class="empty">
      <div class="empty__title">{{ emptyMessage.title }}</div>
      <div class="empty__hint">{{ emptyMessage.hint }}</div>
    </div>
  </div>
</template>

<style scoped>
.vb { max-width: 1280px; display: flex; flex-direction: column; gap: 20px; }
.vb__header { display: flex; align-items: end; justify-content: space-between; gap: 16px; }
.vb__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.vb__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.vb__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin: 0; }
.vb__actions { display: flex; gap: 10px; align-items: center; }

.search { position: relative; display: flex; align-items: center; min-width: 300px; }
.search__icon { position: absolute; left: 12px; color: var(--color-fog); pointer-events: none; }
.search__input { width: 100%; padding: 9px 36px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; }
.search__input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.search__clear { position: absolute; right: 8px; width: 22px; height: 22px; border-radius: 999px; background: var(--color-surface); border: 0; color: var(--color-graphite); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.search__clear:hover { background: var(--color-hairline); color: var(--color-ink); }
.search--mobile { display: none; }

.filters { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.chips { display: flex; gap: 6px; padding: 4px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; width: fit-content; }
.chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border: 0; background: transparent; border-radius: 999px; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); cursor: pointer; }
.chip.is-active { background: #fff; color: var(--color-ink); font-weight: 600; box-shadow: var(--shadow-sm); }

.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; align-items: center; gap: 16px; padding: 16px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; cursor: pointer; transition: border-color 0.12s ease, box-shadow 0.12s ease; position: relative; }
.row:hover { border-color: var(--color-mute); box-shadow: var(--shadow-sm); }
.row:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.row--unread { border-left: 3px solid var(--color-accent); padding-left: 17px; }
.row__avatar { width: 44px; height: 44px; border-radius: 999px; background: var(--color-graphite); color: #fff; display: flex; align-items: center; justify-content: center; font-family: var(--font-body); font-size: 14px; font-weight: 700; flex-shrink: 0; }
.row__body { flex: 1; min-width: 0; }
.row__name-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.row__name { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-ink); }
.row__meta { display: flex; gap: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 4px; }
.row__sep { opacity: 0.5; }
.row__summary { display: flex; gap: 8px; flex-wrap: wrap; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); margin-top: 8px; }
.summary__date { font-weight: 600; }
.summary__pkg { color: var(--color-graphite); }
.summary__guests { color: var(--color-graphite); }
.row__preview { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); margin-top: 6px; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.row__value { text-align: right; flex-shrink: 0; font-family: var(--font-body); }
.row__value-main { font-family: var(--font-display); font-size: 16px; font-weight: 700; color: var(--color-ink); letter-spacing: -0.01em; }
.row__value-sub { font-size: 12px; color: var(--color-fog); margin-top: 2px; }
.row__chev { color: var(--color-mute); font-size: 20px; padding-left: 4px; flex-shrink: 0; }

.pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; flex-shrink: 0; }
.pill--ok { background: #DCFCE7; color: #14532D; }
.pill--warn { background: var(--color-accent-soft); color: var(--color-accent); }
.pill--ink { background: var(--color-ink); color: #fff; }
.pill--mute { background: var(--color-surface); color: var(--color-fog); border: 1px solid var(--color-hairline); }

.badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; border: 1px solid transparent; }
.badge--warn  { background: #FEF3C7; color: #92400E; }
.badge--topic { background: var(--color-accent-soft); color: var(--color-accent-strong); }
.badge--mute  { background: var(--color-surface); color: var(--color-graphite); border-color: var(--color-hairline); }

.empty { padding: 48px 32px; text-align: center; font-family: var(--font-body); background: #fff; border: 1px dashed var(--color-hairline); border-radius: 14px; }
.empty__title { font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--color-ink); }
.empty__hint { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); margin-top: 4px; }

@media (max-width: 767px) {
  .vb__header { flex-direction: column; align-items: stretch; gap: 12px; }
  .vb__actions { display: none; }
  .search--mobile { display: flex; min-width: 0; }
  .vb__heading { font-size: 28px; }
  .chips { width: 100%; overflow-x: auto; }
  .row { flex-wrap: wrap; padding: 14px 16px; gap: 12px; }
  .row__body { flex-basis: calc(100% - 60px); min-width: 0; }
  .row__value { flex-basis: 100%; text-align: left; margin-left: 60px; }
  .row__chev { display: none; }
}
</style>
