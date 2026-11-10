<script setup lang="ts">
/**
 * Venue bookings — admin inbox (brief 62 v1).
 *
 * Reads from the dedicated `venue_bookings` resource — not the
 * enquiries hack. Status chips map 1:1 to the backend state machine
 * (pending / confirmed / declined / cancelled / completed). Counts
 * come straight from the server envelope (respects search but not
 * active status filter, per brief §2).
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useClubStore } from '@/stores/club'
import { useToast } from '@/composables/useToast'
import {
  venueBookings as venueBookingsApi,
  ApiError,
  type VenueBooking,
  type BookingStatus,
  type VenueBookingCounts,
} from '@torny/api-client'

const router = useRouter()
const clubStore = useClubStore()
const toast = useToast()

const rows = ref<VenueBooking[]>([])
const counts = ref<VenueBookingCounts>({
  pending: 0, confirmed: 0, declined: 0, cancelled: 0, completed: 0, total: 0,
})
const loading = ref(true)
const statusFilter = ref<BookingStatus>('pending')
const search = ref('')
const debouncedSearch = ref('')
let searchDebounce: ReturnType<typeof setTimeout> | null = null
let listAbort: AbortController | null = null

watch(search, (q) => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => { debouncedSearch.value = q.trim() }, 240)
})

async function loadList(): Promise<void> {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') { rows.value = []; loading.value = false; return }
  if (listAbort) listAbort.abort()
  listAbort = new AbortController()
  loading.value = true
  try {
    const res = await venueBookingsApi.list(
      cid,
      {
        status: [statusFilter.value],
        search: debouncedSearch.value || undefined,
        limit: 50,
      },
      { signal: listAbort.signal },
    )
    rows.value = res.bookings
    counts.value = res.counts
    // Broadcast the pending count so the sidebar badge stays in sync
    // without a second fetch.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('torny:venue-bookings-count', { detail: res.counts.pending }))
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    toast.error(err instanceof ApiError ? err.message : 'Could not load bookings.')
    rows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => { void loadList() })
watch(() => clubStore.current?.id, () => { void loadList() })
watch([statusFilter, debouncedSearch], () => { void loadList() })

// ── Display helpers ──────────────────────────────────────────
const statusTone: Record<BookingStatus, 'ok' | 'warn' | 'danger' | 'ink' | 'mute'> = {
  pending: 'warn',
  confirmed: 'ok',
  declined: 'danger',
  cancelled: 'mute',
  completed: 'ink',
}
const statusLabel: Record<BookingStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  declined: 'Declined',
  cancelled: 'Cancelled',
  completed: 'Completed',
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const a = parts[0]?.[0] ?? ''
  const b = parts.length > 1 ? parts[parts.length - 1]![0] : ''
  return `${a}${b}`.toUpperCase()
}

const BOOKING_DATE_FMT = new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
function formatBookingDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : BOOKING_DATE_FMT.format(d)
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

const emptyMessage = computed(() => {
  if (debouncedSearch.value) return { title: 'No matches', hint: 'Try a different search.' }
  switch (statusFilter.value) {
    case 'pending':   return { title: 'No bookings yet', hint: 'Inbox zero — new submissions land here.' }
    case 'confirmed': return { title: 'No confirmed bookings', hint: 'Confirmed bookings live here.' }
    case 'declined':  return { title: 'No declines', hint: 'Declined bookings stay here for audit.' }
    case 'cancelled': return { title: 'No cancellations', hint: 'Cancelled bookings live here.' }
    case 'completed': return { title: 'No completed bookings', hint: 'Completed bookings arrive after the booking date passes.' }
    default:          return { title: 'No bookings', hint: '' }
  }
})

function openDetail(row: VenueBooking): void {
  router.push({ name: 'venue-booking-detail', params: { id: String(row.id) } })
}
</script>

<template>
  <div class="vb">
    <header class="vb__header">
      <div>
        <div class="vb__eyebrow">Venue hire</div>
        <h1 class="vb__heading">Venue bookings</h1>
        <p class="vb__sub">{{ counts.pending }} pending · {{ counts.total }} total</p>
      </div>
      <div class="vb__actions">
        <div class="search">
          <svg class="search__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input v-model="search" placeholder="Search name, email, ref…" class="search__input" />
          <button v-if="search" class="search__clear" aria-label="Clear search" @click="search = ''">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      </div>
    </header>

    <div class="filters">
      <div class="chips">
        <button
          v-for="tab in (['pending', 'confirmed', 'declined', 'cancelled', 'completed'] as const)"
          :key="tab"
          class="chip"
          :class="{ 'is-active': statusFilter === tab }"
          @click="statusFilter = tab"
        >
          <span class="chip__label">{{ statusLabel[tab] }}</span>
          <span class="chip__count">{{ counts[tab] }}</span>
        </button>
      </div>
    </div>

    <div v-if="loading && rows.length === 0" class="empty">
      <div class="empty__title">Loading…</div>
    </div>

    <ul v-else-if="rows.length > 0" class="list">
      <li
        v-for="r in rows"
        :key="r.id"
        class="row"
        tabindex="0"
        @click="openDetail(r)"
        @keydown.enter="openDetail(r)"
      >
        <div class="row__avatar">{{ initials(r.full_name) }}</div>
        <div class="row__body">
          <div class="row__name-row">
            <div class="row__name">{{ r.full_name }}</div>
            <div class="row__ref">{{ r.booking_ref }}</div>
          </div>
          <div class="row__meta">
            <span class="row__pkg">{{ r.package_name_snapshot ?? '—' }}</span>
            <span class="row__sep">·</span>
            <span>{{ r.slot_label_snapshot ?? '—' }}</span>
          </div>
        </div>
        <div class="row__when">
          <div class="row__when-date">{{ formatBookingDate(r.booking_date) }}</div>
          <div class="row__when-total">{{ formatCurrency(r.total_cents) }}</div>
        </div>
        <div class="row__actions">
          <span class="pill" :class="`pill--${statusTone[r.status]}`">{{ statusLabel[r.status] }}</span>
        </div>
        <div class="row__chev" aria-hidden="true">›</div>
      </li>
    </ul>

    <div v-else class="empty">
      <div class="empty__title">{{ emptyMessage?.title }}</div>
      <div class="empty__hint">{{ emptyMessage?.hint }}</div>
    </div>
  </div>
</template>

<style scoped>
.vb { max-width: 1280px; display: flex; flex-direction: column; gap: 20px; }

.vb__header { display: flex; align-items: end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.vb__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.vb__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.vb__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin: 0; }
.vb__actions { display: flex; gap: 10px; align-items: center; }

.search { position: relative; display: flex; align-items: center; min-width: 300px; }
.search__icon { position: absolute; left: 12px; color: var(--color-fog); pointer-events: none; }
.search__input { width: 100%; padding: 9px 36px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; }
.search__input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.search__clear { position: absolute; right: 8px; width: 22px; height: 22px; border-radius: 999px; background: var(--color-surface); border: 0; color: var(--color-graphite); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }

.filters { display: flex; align-items: center; gap: 12px; }
.chips { display: flex; gap: 6px; padding: 4px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; width: fit-content; }
.chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border: 0; background: transparent; border-radius: 999px; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); cursor: pointer; }
.chip.is-active { background: #fff; color: var(--color-ink); font-weight: 600; box-shadow: var(--shadow-sm); }
.chip__count { font-family: var(--font-mono); font-size: 10px; padding: 1px 7px; background: var(--color-hairline); color: var(--color-graphite); border-radius: 999px; }
.chip.is-active .chip__count { background: var(--color-accent-soft); color: var(--color-accent); }

.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; align-items: center; gap: 16px; padding: 16px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; cursor: pointer; transition: border-color 0.12s ease, box-shadow 0.12s ease; }
.row:hover { border-color: var(--color-mute); box-shadow: var(--shadow-sm); }
.row:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }

.row__avatar { width: 44px; height: 44px; border-radius: 999px; background: var(--color-graphite); color: #fff; display: flex; align-items: center; justify-content: center; font-family: var(--font-body); font-size: 14px; font-weight: 700; flex-shrink: 0; }
.row__body { flex: 1; min-width: 0; }
.row__name-row { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.row__name { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-ink); }
.row__ref { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); }
.row__meta { display: flex; gap: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 4px; }
.row__pkg { color: var(--color-graphite); font-weight: 500; }
.row__sep { opacity: 0.5; }
.row__when { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); white-space: nowrap; text-align: right; flex-shrink: 0; }
.row__when-date { color: var(--color-ink); font-weight: 500; }
.row__when-total { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); margin-top: 2px; }
.row__actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
.row__chev { color: var(--color-mute); font-size: 20px; padding-left: 4px; flex-shrink: 0; }

.pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.pill--ok { background: #DCFCE7; color: #14532D; }
.pill--warn { background: var(--color-accent-soft); color: var(--color-accent); }
.pill--danger { background: #FEE2E2; color: #991B1B; }
.pill--ink { background: var(--color-ink); color: #fff; }
.pill--mute { background: var(--color-surface); color: var(--color-fog); border: 1px solid var(--color-hairline); }

.empty { padding: 64px 32px; text-align: center; font-family: var(--font-body); background: #fff; border: 1px dashed var(--color-hairline); border-radius: 14px; }
.empty__title { font-family: var(--font-display); font-size: 20px; font-weight: 600; color: var(--color-ink); }
.empty__hint { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin-top: 6px; }

@media (max-width: 767px) {
  .row { flex-wrap: wrap; padding: 14px 16px; gap: 12px; }
  .row__body { flex-basis: calc(100% - 60px); min-width: 0; }
  .row__when { flex-basis: 100%; text-align: left; margin-left: 60px; margin-top: -8px; }
  .row__actions { flex-basis: 100%; justify-content: flex-end; }
  .row__chev { display: none; }
}
</style>
