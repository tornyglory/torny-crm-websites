<script setup lang="ts">
/**
 * Membership applications — the CRM inbox for triaging join-form
 * submissions. Wired to brief 38's endpoints via the api-client
 * applications resource. Row click navigates to
 * /crm/applications/:id (ApplicationDetailView.vue) — the detail lives
 * on its own page now.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { useClubStore } from '@/stores/club'
import {
  applications as applicationsApi,
  ApiError,
  type ApplicationRow,
  type ApplicationStatus,
} from '@torny/api-client'

const toast = useToast()
const clubStore = useClubStore()
const router = useRouter()

// ── List state ────────────────────────────────────────────────
const rows = ref<ApplicationRow[]>([])
const counts = ref({ pending: 0, approved: 0, rejected: 0 })
const total = ref(0)
const loading = ref(true)
const search = ref('')
const debouncedSearch = ref('')
const statusFilter = ref<'all' | ApplicationStatus>('pending')
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
    const res = await applicationsApi.list(cid, {
      status: statusFilter.value,
      search: debouncedSearch.value || undefined,
      limit: 50,
    }, { signal: listAbort.signal })
    rows.value = res.applications
    counts.value = res.counts
    total.value = res.pagination.total
    // Broadcast the pending count so CrmShell's sidebar stays in sync
    // without a second fetch.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('torny:applications-count', { detail: res.counts.pending }))
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    toast.error(err instanceof ApiError ? err.message : 'Could not load applications.')
    rows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => { void loadList() })
watch(() => clubStore.current?.id, () => { void loadList() })
watch([statusFilter, debouncedSearch], () => { void loadList() })

// ── Derived display helpers ───────────────────────────────────
const statusTone: Record<ApplicationStatus, 'ok' | 'warn' | 'danger'> = {
  pending: 'warn',
  approved: 'ok',
  rejected: 'danger',
}
const statusLabel: Record<ApplicationStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
}
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
function waitingLabel(r: ApplicationRow): string | null {
  if (r.status !== 'pending') return null
  const diff = Date.now() - new Date(r.received_at).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return '1 day waiting'
  return `${days} days waiting`
}
function isUrgent(r: ApplicationRow): boolean {
  if (r.status !== 'pending') return false
  const days = Math.floor((Date.now() - new Date(r.received_at).getTime()) / 86_400_000)
  return days >= 5
}

const emptyMessage = computed(() => {
  if (debouncedSearch.value) return { title: 'No matches', hint: 'Try a different search.' }
  switch (statusFilter.value) {
    case 'pending':  return { title: 'Inbox zero', hint: 'No applications waiting for review.' }
    case 'approved': return { title: 'No approvals yet', hint: 'Approved applications land here.' }
    case 'rejected': return { title: 'No rejections', hint: 'Rejected applications live here for audit.' }
    default:         return { title: 'Nothing yet', hint: 'When people apply, they\'ll appear here.' }
  }
})

// Row click routes to the dedicated detail page.
function openDetail(row: ApplicationRow) {
  router.push({ name: 'application-detail', params: { id: String(row.id) } })
}
</script>

<template>
  <div class="apps">
    <header class="apps__header">
      <div>
        <div class="apps__eyebrow">New arrivals</div>
        <h1 class="apps__heading">Applications</h1>
        <p class="apps__sub">{{ counts.pending }} pending · {{ counts.pending + counts.approved + counts.rejected }} all-time</p>
      </div>
      <div class="apps__actions">
        <div class="search">
          <svg class="search__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input v-model="search" placeholder="Search name, email, phone…" class="search__input" />
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
      <input v-model="search" placeholder="Search applications…" class="search__input" />
    </div>

    <div class="filters">
      <div class="chips">
        <button
          v-for="tab in (['pending', 'approved', 'rejected', 'all'] as const)"
          :key="tab"
          class="chip"
          :class="{ 'is-active': statusFilter === tab }"
          @click="statusFilter = tab"
        >
          <span class="chip__label">{{ tab === 'all' ? 'All' : statusLabel[tab] }}</span>
          <span class="chip__count">{{ tab === 'all' ? (counts.pending + counts.approved + counts.rejected) : counts[tab] }}</span>
        </button>
      </div>
      <div v-if="debouncedSearch || statusFilter !== 'pending'" class="filters__result">
        {{ rows.length }} shown
      </div>
    </div>

    <div v-if="loading && rows.length === 0" class="empty">
      <div class="empty__title">Loading…</div>
    </div>

    <ul v-else-if="rows.length" class="list">
      <li
        v-for="a in rows"
        :key="a.id"
        class="row"
        :class="{ 'row--urgent': isUrgent(a) }"
        tabindex="0"
        @click="openDetail(a)"
        @keydown.enter="openDetail(a)"
      >
        <div class="row__avatar">{{ initials(a) }}</div>
        <div class="row__body">
          <div class="row__name-row">
            <div class="row__name">{{ a.full_name }}</div>
            <div class="row__badges">
              <span v-if="isUrgent(a)" class="badge badge--warn">Waiting</span>
              <span v-if="a.tier_name" class="badge badge--mute">{{ a.tier_name }}</span>
              <span v-if="a.referrer" class="badge badge--mute">Referred</span>
            </div>
          </div>
          <div class="row__meta">
            <span>{{ a.email }}</span>
            <span class="row__sep">·</span>
            <span>{{ a.mobile }}</span>
          </div>
        </div>
        <div class="row__time">
          <div class="row__time-main">{{ timeAgo(a.received_at) }}</div>
          <div v-if="waitingLabel(a)" class="row__time-sub">{{ waitingLabel(a) }}</div>
        </div>
        <div class="row__actions">
          <span class="pill" :class="`pill--${statusTone[a.status]}`">{{ statusLabel[a.status] }}</span>
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

/* Filter chips */
.filters { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.chips { display: flex; gap: 6px; padding: 4px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; width: fit-content; }
.chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border: 0; background: transparent; border-radius: 999px; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); cursor: pointer; }
.chip.is-active { background: #fff; color: var(--color-ink); font-weight: 600; box-shadow: var(--shadow-sm); }
.chip__count { font-family: var(--font-mono); font-size: 10px; padding: 1px 7px; background: var(--color-hairline); color: var(--color-graphite); border-radius: 999px; }
.chip.is-active .chip__count { background: var(--color-accent-soft); color: var(--color-accent); }
.filters__result { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }

/* List */
.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; align-items: center; gap: 16px; padding: 16px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; cursor: pointer; transition: border-color 0.12s ease, box-shadow 0.12s ease; position: relative; }
.row:hover { border-color: var(--color-mute); box-shadow: var(--shadow-sm); }
.row:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.row--urgent { border-left: 3px solid #F59E0B; padding-left: 17px; }
.row__avatar { width: 44px; height: 44px; border-radius: 999px; background: var(--color-graphite); color: #fff; display: flex; align-items: center; justify-content: center; font-family: var(--font-body); font-size: 14px; font-weight: 700; flex-shrink: 0; }
.row__body { flex: 1; min-width: 0; }
.row__name-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.row__name { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-ink); }
.row__badges { display: flex; gap: 4px; flex-wrap: wrap; }
.row__meta { display: flex; gap: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 4px; }
.row__sep { opacity: 0.5; }
.row__time { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); white-space: nowrap; text-align: right; flex-shrink: 0; }
.row__time-main { color: var(--color-ink); font-weight: 500; }
.row__time-sub { font-size: 11px; color: var(--color-fog); margin-top: 2px; }
.row__actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
.row__chev { color: var(--color-mute); font-size: 20px; padding-left: 4px; flex-shrink: 0; }

.btn { padding: 8px 14px; border: none; border-radius: 999px; font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn--approve { background: var(--color-ink); color: #fff; }
.btn--approve:hover:not(:disabled) { background: var(--color-graphite); }
.btn--decline { background: transparent; color: var(--color-danger); border: 1px solid var(--color-hairline); }
.btn--decline:hover:not(:disabled) { background: color-mix(in oklab, var(--color-danger) 8%, #fff); border-color: var(--color-danger); }
.btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.btn--outline:hover:not(:disabled) { background: var(--color-surface); }

/* Pills — status */
.pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; flex-shrink: 0; }
.pill--ok { background: #DCFCE7; color: #14532D; }
.pill--warn { background: var(--color-accent-soft); color: var(--color-accent); }
.pill--danger { background: #FEE2E2; color: #991B1B; }

/* Badges */
.badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; border: 1px solid transparent; }
.badge--warn      { background: #FEF3C7; color: #92400E; }
.badge--mute      { background: var(--color-surface); color: var(--color-graphite); border-color: var(--color-hairline); }

/* Empty */
.empty { padding: 48px 32px; text-align: center; font-family: var(--font-body); background: #fff; border: 1px dashed var(--color-hairline); border-radius: 14px; }
.empty__title { font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--color-ink); }
.empty__hint { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); margin-top: 4px; }

/* Detail modal */
.detail { display: flex; flex-direction: column; gap: 20px; }
.detail__hero { position: relative; display: flex; align-items: center; gap: 16px; padding: 20px 22px; border-radius: 14px; background: linear-gradient(135deg, var(--color-surface) 0%, #fff 100%); border: 1px solid var(--color-hairline); overflow: hidden; }
.detail__hero::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--color-graphite); }
.detail__hero--ok::before { background: #16A34A; }
.detail__hero--warn::before { background: var(--color-accent); }
.detail__hero--danger::before { background: var(--color-danger); }
.detail__avatar { width: 60px; height: 60px; border-radius: 999px; background: var(--color-ink); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 20px; font-weight: 700; flex-shrink: 0; }
.detail__hero-body { flex: 1; min-width: 0; }
.detail__hero-line { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-ink); }
.detail__hero-meta { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; }
.detail__hero-badges { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; flex-shrink: 0; max-width: 240px; }

/* Numbered steps — mirrors the join-form structure so the reviewer
   reads the same sections in the same order. */
.steps { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 40px; padding: 8px 4px 0; }
.step { display: grid; grid-template-columns: 40px 1fr; gap: 16px; align-items: flex-start; padding-top: 24px; border-top: 1px solid var(--color-hairline); }
.step:first-child { padding-top: 0; border-top: 0; }
.step__num { font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.14em; color: var(--color-mute); text-transform: uppercase; padding-top: 2px; }
.step__body { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.step__head { display: flex; flex-direction: column; gap: 4px; }
.step__title { font-family: var(--font-display); font-size: 18px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); margin: 0; line-height: 1.2; }
.step__hint { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); margin: 0; line-height: 1.5; }
.step__note {
  padding: 14px 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-hairline);
  border-left: 3px solid var(--color-accent);
  border-radius: 10px;
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.55;
  color: var(--color-ink);
  margin: 0;
  font-style: italic;
}

.dl { display: flex; flex-direction: column; margin: 0; }
.dl__row { display: grid; grid-template-columns: 140px 1fr; gap: 16px; padding: 10px 0; border-top: 1px solid var(--color-hairline); align-items: baseline; }
.dl__row:first-child { border-top: 0; padding-top: 0; }
.dl__row:last-child { padding-bottom: 0; }
.dl dt { font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); margin: 0; }
.dl dd { font-family: var(--font-body); font-size: 14px; color: var(--color-ink); margin: 0; word-break: break-word; }
.dl__muted { color: var(--color-fog); }
.link { color: var(--color-accent); text-decoration: none; }
.link:hover { text-decoration: underline; }

.agree-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
}
.agree-chip--yes { background: #DCFCE7; color: #14532D; }
.agree-chip--no  { background: var(--color-surface); color: var(--color-fog); border: 1px solid var(--color-hairline); }

/* Internal notes thread */
.detail__notes-thread { display: flex; flex-direction: column; gap: 12px; padding-top: 24px; margin-top: 8px; border-top: 1px solid var(--color-hairline); }
.detail__notes-head { display: flex; align-items: baseline; gap: 10px; }
.detail__notes-title { font-family: var(--font-display); font-size: 15px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); margin: 0; }
.detail__notes-count { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; color: var(--color-fog); padding: 2px 8px; border-radius: 999px; background: var(--color-surface); }
.note-form { display: flex; gap: 8px; align-items: stretch; }
.note-form textarea { flex: 1; padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; resize: vertical; min-height: 44px; }
.note-form textarea:focus { outline: none; border-color: var(--color-ink); }
.notes { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.note { padding: 12px 14px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; }
.note__head { display: flex; gap: 8px; align-items: baseline; }
.note__author { font-family: var(--font-body); font-size: 12px; font-weight: 600; color: var(--color-ink); }
.note__time { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }
.note__body { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); line-height: 1.5; margin-top: 6px; }

/* Approve / Reject modal form */
.modal-form { display: flex; flex-direction: column; gap: 14px; }
.modal-hint { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); margin: 0; line-height: 1.5; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.field input, .field select, .field textarea { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; resize: vertical; }
.field input:focus, .field select:focus, .field textarea:focus { outline: none; border-color: var(--color-ink); }
.switch-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 0; border-top: 1px solid var(--color-hairline); }
.switch-row__label { font-family: var(--font-body); font-size: 14px; font-weight: 600; color: var(--color-ink); }
.switch-row__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; }
.switch { width: 40px; height: 24px; padding: 3px; border-radius: 999px; background: var(--color-hairline); border: 0; display: flex; cursor: pointer; flex-shrink: 0; }
.switch.is-on { background: var(--color-ink); }
.switch__knob { width: 18px; height: 18px; border-radius: 999px; background: #fff; transition: transform 0.15s ease; }
.switch.is-on .switch__knob { transform: translateX(16px); }

@media (max-width: 900px) {
  .steps { gap: 32px; }
  .step { grid-template-columns: 32px 1fr; gap: 12px; padding-top: 20px; }
  .dl__row { grid-template-columns: 1fr; gap: 4px; }
  .detail__hero { flex-wrap: wrap; }
  .detail__hero-badges { justify-content: flex-start; max-width: none; width: 100%; padding-left: 76px; }
}
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
