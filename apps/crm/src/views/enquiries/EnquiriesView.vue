<script setup lang="ts">
/**
 * Enquiries — the CRM inbox for the public contact-form. Wired to brief
 * 41 via the api-client enquiries resource. Row click routes to
 * /crm/enquiries/:id (EnquiryDetailView.vue). Same structural pattern
 * as ApplicationsView.
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
  type EnquiryTopic,
} from '@torny/api-client'

const toast = useToast()
const clubStore = useClubStore()
const router = useRouter()

// ── List state ────────────────────────────────────────────────
const rows = ref<EnquiryRow[]>([])
const counts = ref({ new: 0, read: 0, replied: 0, archived: 0 })
const loading = ref(true)
const search = ref('')
const debouncedSearch = ref('')
const statusFilter = ref<'all' | EnquiryStatus>('new')
const topicFilter = ref<'all' | EnquiryTopic>('all')
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
      status: statusFilter.value,
      topic: topicFilter.value === 'all' ? undefined : topicFilter.value,
      search: debouncedSearch.value || undefined,
      limit: 50,
    }, { signal: listAbort.signal })
    rows.value = res.enquiries
    counts.value = res.counts
    // Keep the sidebar in sync so a fresh submission doesn't leave a
    // stale "3 new" badge sitting there.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('torny:enquiries-count', { detail: res.counts.new }))
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    toast.error(err instanceof ApiError ? err.message : 'Could not load enquiries.')
    rows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => { void loadList() })
watch(() => clubStore.current?.id, () => { void loadList() })
watch([statusFilter, topicFilter, debouncedSearch], () => { void loadList() })

// ── Derived display helpers ───────────────────────────────────
const statusTone: Record<EnquiryStatus, 'warn' | 'ink' | 'ok' | 'mute'> = {
  new: 'warn',
  read: 'ink',
  replied: 'ok',
  archived: 'mute',
}
const statusLabel: Record<EnquiryStatus, string> = {
  new: 'New', read: 'Read', replied: 'Replied', archived: 'Archived',
}
const topicLabel: Record<EnquiryTopic, string> = {
  membership: 'Membership',
  events: 'Events',
  facilities: 'Facilities',
  general: 'General',
  media: 'Media',
}
const TOPICS: EnquiryTopic[] = ['membership', 'events', 'facilities', 'general', 'media']

function initials(r: { full_name: string }) {
  const parts = r.full_name.trim().split(/\s+/)
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

const emptyMessage = computed(() => {
  if (debouncedSearch.value) return { title: 'No matches', hint: 'Try a different search.' }
  switch (statusFilter.value) {
    case 'new':      return { title: 'Inbox zero', hint: 'Nothing waiting to be read.' }
    case 'read':     return { title: 'No read enquiries', hint: 'Read but unresolved messages appear here.' }
    case 'replied':  return { title: 'No replies yet', hint: 'Enquiries you\'ve responded to land here.' }
    case 'archived': return { title: 'No archived enquiries', hint: 'Archived messages live here for audit.' }
    default:         return { title: 'Nothing yet', hint: 'When people write in, they\'ll appear here.' }
  }
})

function openRow(r: EnquiryRow) {
  router.push({ name: 'enquiry-detail', params: { id: String(r.id) } })
}

const totalAll = computed(() => counts.value.new + counts.value.read + counts.value.replied + counts.value.archived)
</script>

<template>
  <div class="apps">
    <header class="apps__header">
      <div>
        <div class="apps__eyebrow">Contact form</div>
        <h1 class="apps__heading">Enquiries</h1>
        <p class="apps__sub">{{ counts.new }} new · {{ totalAll }} all-time</p>
      </div>
      <div class="apps__actions">
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
      <input v-model="search" placeholder="Search enquiries…" class="search__input" />
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
          <span class="chip__count">{{ tab === 'all' ? totalAll : counts[tab] }}</span>
        </button>
      </div>
      <label class="topic-select">
        <span>Topic</span>
        <select v-model="topicFilter">
          <option value="all">All topics</option>
          <option v-for="t in TOPICS" :key="t" :value="t">{{ topicLabel[t] }}</option>
        </select>
      </label>
    </div>

    <div v-if="loading && rows.length === 0" class="empty">
      <div class="empty__title">Loading…</div>
    </div>

    <ul v-else-if="rows.length" class="list">
      <li
        v-for="e in rows"
        :key="e.id"
        class="row"
        :class="{ 'row--unread': e.status === 'new' }"
        tabindex="0"
        @click="openRow(e)"
        @keydown.enter="openRow(e)"
      >
        <div class="row__avatar">{{ initials(e) }}</div>
        <div class="row__body">
          <div class="row__name-row">
            <div class="row__name">{{ e.full_name }}</div>
            <div class="row__badges">
              <span v-if="e.status === 'new'" class="badge badge--warn">New</span>
              <span class="badge badge--topic">{{ topicLabel[e.topic] }}</span>
              <span v-if="e.note_count > 0" class="badge badge--mute">{{ e.note_count }} note{{ e.note_count === 1 ? '' : 's' }}</span>
            </div>
          </div>
          <div class="row__meta">
            <span>{{ e.email }}</span>
            <template v-if="e.phone">
              <span class="row__sep">·</span>
              <span>{{ e.phone }}</span>
            </template>
          </div>
          <div class="row__preview">{{ e.message_preview }}</div>
        </div>
        <div class="row__time">
          <div class="row__time-main">{{ timeAgo(e.received_at) }}</div>
          <div v-if="e.responded_at" class="row__time-sub">Replied {{ timeAgo(e.responded_at) }}</div>
        </div>
        <div class="row__actions">
          <span class="pill" :class="`pill--${statusTone[e.status]}`">{{ statusLabel[e.status] }}</span>
        </div>
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
.apps { max-width: 1280px; display: flex; flex-direction: column; gap: 20px; }
.apps__header { display: flex; align-items: end; justify-content: space-between; gap: 16px; }
.apps__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.apps__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.apps__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin: 0; }
.apps__actions { display: flex; gap: 10px; align-items: center; }

/* Search */
.search { position: relative; display: flex; align-items: center; min-width: 300px; }
.search__icon { position: absolute; left: 12px; color: var(--color-fog); pointer-events: none; }
.search__input { width: 100%; padding: 9px 36px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; }
.search__input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.search__clear { position: absolute; right: 8px; width: 22px; height: 22px; border-radius: 999px; background: var(--color-surface); border: 0; color: var(--color-graphite); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.search__clear:hover { background: var(--color-hairline); color: var(--color-ink); }
.search--mobile { display: none; }

/* Filters */
.filters { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.chips { display: flex; gap: 6px; padding: 4px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; width: fit-content; }
.chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border: 0; background: transparent; border-radius: 999px; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); cursor: pointer; }
.chip.is-active { background: #fff; color: var(--color-ink); font-weight: 600; box-shadow: var(--shadow-sm); }
.chip__count { font-family: var(--font-mono); font-size: 10px; padding: 1px 7px; background: var(--color-hairline); color: var(--color-graphite); border-radius: 999px; }
.chip.is-active .chip__count { background: var(--color-accent-soft); color: var(--color-accent); }

.topic-select { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; }
.topic-select span { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }
.topic-select select { border: 0; background: transparent; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); font-weight: 600; cursor: pointer; }
.topic-select select:focus { outline: none; }

/* List */
.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; align-items: center; gap: 16px; padding: 16px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; cursor: pointer; transition: border-color 0.12s ease, box-shadow 0.12s ease; position: relative; }
.row:hover { border-color: var(--color-mute); box-shadow: var(--shadow-sm); }
.row:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.row--unread { border-left: 3px solid var(--color-accent); padding-left: 17px; }
.row__avatar { width: 44px; height: 44px; border-radius: 999px; background: var(--color-graphite); color: #fff; display: flex; align-items: center; justify-content: center; font-family: var(--font-body); font-size: 14px; font-weight: 700; flex-shrink: 0; }
.row__body { flex: 1; min-width: 0; }
.row__name-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.row__name { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-ink); }
.row__badges { display: flex; gap: 4px; flex-wrap: wrap; }
.row__meta { display: flex; gap: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 4px; }
.row__sep { opacity: 0.5; }
.row__preview { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); margin-top: 6px; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.row--unread .row__preview { color: var(--color-ink); }
.row__time { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); white-space: nowrap; text-align: right; flex-shrink: 0; }
.row__time-main { color: var(--color-ink); font-weight: 500; }
.row__time-sub { font-size: 11px; color: var(--color-fog); margin-top: 2px; }
.row__actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
.row__chev { color: var(--color-mute); font-size: 20px; padding-left: 4px; flex-shrink: 0; }

/* Pills */
.pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; flex-shrink: 0; }
.pill--ok { background: #DCFCE7; color: #14532D; }
.pill--warn { background: var(--color-accent-soft); color: var(--color-accent); }
.pill--ink { background: var(--color-ink); color: #fff; }
.pill--mute { background: var(--color-surface); color: var(--color-fog); border: 1px solid var(--color-hairline); }

/* Badges */
.badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; border: 1px solid transparent; }
.badge--warn      { background: #FEF3C7; color: #92400E; }
.badge--topic     { background: var(--color-accent-soft); color: var(--color-accent-strong); }
.badge--mute      { background: var(--color-surface); color: var(--color-graphite); border-color: var(--color-hairline); }

/* Empty */
.empty { padding: 48px 32px; text-align: center; font-family: var(--font-body); background: #fff; border: 1px dashed var(--color-hairline); border-radius: 14px; }
.empty__title { font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--color-ink); }
.empty__hint { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); margin-top: 4px; }

@media (max-width: 767px) {
  .apps__header { flex-direction: column; align-items: stretch; gap: 12px; }
  .apps__actions { display: none; }
  .search--mobile { display: flex; min-width: 0; }
  .apps__heading { font-size: 28px; }
  .chips { width: 100%; overflow-x: auto; }
  .row { flex-wrap: wrap; padding: 14px 16px; gap: 12px; }
  .row__body { flex-basis: calc(100% - 60px); min-width: 0; }
  .row__time { flex-basis: 100%; text-align: left; margin-left: 60px; margin-top: -8px; }
  .row__actions { flex-basis: 100%; justify-content: flex-end; }
  .row__chev { display: none; }
}
</style>
