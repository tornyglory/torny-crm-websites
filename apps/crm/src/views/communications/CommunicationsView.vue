<script setup lang="ts">
/**
 * Communications — campaign list (live).
 *
 * Reads from `campaigns.list()` + `campaigns.metrics()` per brief 69.
 * Mock fallback (`./mockCampaigns.ts`) stays available but is only used
 * when the API returns an empty list AND no club context exists — makes
 * the design iterable without a live backend when needed.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  campaigns as campaignsApi,
  type CampaignRow,
  type CampaignStatus,
  type CampaignsMetricsResponse,
} from '@torny/api-client'
import { useClubStore } from '@/stores/club'
import { usePermissions } from '@/composables/usePermissions'

const { can: _canComms } = usePermissions()
const canSendComms = computed(() => _canComms('communications:send'))

const router = useRouter()
const clubStore = useClubStore()

type Tab = 'all' | 'sent' | 'scheduled' | 'draft'
const activeTab = ref<Tab>('all')
const search = ref('')

// ── Live data refs ────────────────────────────────────────────────
const rows = ref<CampaignRow[]>([])
const countsByStatus = ref<{ sent: number; scheduled: number; drafts: number; all: number }>({
  sent: 0, scheduled: 0, drafts: 0, all: 0,
})
const metricsData = ref<CampaignsMetricsResponse | null>(null)
const loadingList = ref(false)
const loadingMetrics = ref(false)
const listError = ref<string | null>(null)

async function loadList() {
  const cid = clubStore.current?.id
  if (cid == null) return
  loadingList.value = true
  listError.value = null
  try {
    const status = activeTab.value === 'all' ? undefined : [activeTab.value as CampaignStatus]
    const res = await campaignsApi.list(cid, {
      status,
      search: search.value.trim() || undefined,
      sort: 'newest',
      limit: 50,
    })
    rows.value = res.campaigns
    countsByStatus.value = res.counts_by_status
  } catch (err) {
    listError.value = err instanceof Error ? err.message : 'Could not load campaigns.'
    rows.value = []
  } finally {
    loadingList.value = false
  }
}

async function loadMetrics() {
  const cid = clubStore.current?.id
  if (cid == null) return
  loadingMetrics.value = true
  try {
    metricsData.value = await campaignsApi.metrics(cid, { window: '30d' })
  } catch {
    metricsData.value = null
  } finally {
    loadingMetrics.value = false
  }
}

onMounted(() => {
  void loadList()
  void loadMetrics()
})
watch(() => clubStore.current?.id, () => {
  void loadList()
  void loadMetrics()
})
watch(activeTab, () => { void loadList() })

// Debounced search re-fetch
let searchDebounce: number | null = null
watch(search, () => {
  if (searchDebounce) window.clearTimeout(searchDebounce)
  searchDebounce = window.setTimeout(() => { void loadList() }, 240)
})

// ── Tab counts ────────────────────────────────────────────────────
const tabs = computed(() => [
  { value: 'all' as Tab,       label: 'All',       count: countsByStatus.value.all },
  { value: 'sent' as Tab,      label: 'Sent',      count: countsByStatus.value.sent },
  { value: 'scheduled' as Tab, label: 'Scheduled', count: countsByStatus.value.scheduled },
  { value: 'draft' as Tab,     label: 'Drafts',    count: countsByStatus.value.drafts },
])

// ── Hero stats — map backend aggregate → the four cards ──────────
/** Format a 0..1 rate as a whole-percent string without the trailing %.
 *  Returns '—' only when the backend hasn't computed a rate yet. 0 still
 *  renders as "0" — a measured zero is signal, not missing data. */
function pct(rate: number | null | undefined): string {
  if (rate == null) return '—'
  return String(Math.round(rate * 100))
}
function signedPp(pp: number | null | undefined): string {
  if (pp == null) return '—'
  const sign = pp > 0 ? '+' : pp < 0 ? '' : '±'
  return `${sign}${pp.toFixed(1)} pp`
}
function signedCount(n: number | null | undefined): string {
  if (n == null) return '—'
  const sign = n > 0 ? '+' : n < 0 ? '' : '±'
  return `${sign}${n}`
}
/** Rates come from the server, but fall back to a client-side derive
 *  (`numerator / delivered`) when the server returns `null` or omits the
 *  field — keeps the hero honest even if the metrics endpoint drifts. */
function rateOr(
  serverRate: number | null | undefined,
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): number | null {
  if (serverRate != null) return serverRate
  if (numerator != null && denominator != null && denominator > 0) {
    return numerator / denominator
  }
  return null
}

const stats = computed(() => {
  const cur = metricsData.value?.current
  const d = metricsData.value?.deltas
  return {
    open_rate:      pct(rateOr(cur?.open_rate, cur?.opened, cur?.delivered)),
    click_rate:     pct(rateOr(cur?.click_rate, cur?.clicked, cur?.delivered)),
    unsub_rate:     pct(rateOr(cur?.unsubscribe_rate, cur?.unsubscribed, cur?.delivered)),
    total_sent:     cur?.sent ?? 0,
    total_delivered: cur?.delivered ?? 0,
    total_opens:    cur?.opened ?? 0,
    total_clicks:   cur?.clicked ?? 0,
    total_unsubs:   cur?.unsubscribed ?? 0,
    total_broadcasts: cur?.broadcasts ?? 0,
    open_delta:     signedPp(d?.open_rate_pp),
    click_delta:    signedPp(d?.click_rate_pp),
    sent_delta:     signedCount(d?.sent),
    unsub_delta:    signedCount(d?.unsubscribe_count),
    open_delta_sign:  (d?.open_rate_pp ?? 0) >= 0 ? 'up' : 'down',
    click_delta_sign: (d?.click_rate_pp ?? 0) >= 0 ? 'up' : 'down',
    unsub_delta_sign: (d?.unsubscribe_count ?? 0) <= 0 ? 'up' : 'down',
  }
})

/** Deliverability chip — surfaces when the sent/delivered gap is wide
 *  enough to distort the open-rate story. Threshold: >10% of sent emails
 *  never fired a Delivery event. Common culprit is SES sandbox-mode
 *  silently refusing unverified recipients; could also be bounces /
 *  suppression. Either way the admin should see it before trusting the
 *  headline rate. */
const deliveryWarning = computed<{ delivered: number; sent: number } | null>(() => {
  const cur = metricsData.value?.current
  if (!cur) return null
  const sent = cur.sent ?? 0
  const delivered = cur.delivered ?? 0
  if (sent < 5) return null                   // noise at tiny volumes
  if (delivered >= sent * 0.9) return null    // healthy
  return { delivered, sent }
})

// ── Row display helpers ──────────────────────────────────────────
const SHORT_DATE = new Intl.DateTimeFormat('en-NZ', { day: '2-digit', month: 'short' })
const TIME_FMT = new Intl.DateTimeFormat('en-NZ', { hour: 'numeric', minute: '2-digit' })
const DAY_MS = 86400000
function fmtDateLabel(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : SHORT_DATE.format(d)
}
function fmtRelativeShort(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const days = Math.floor(diff / DAY_MS)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return SHORT_DATE.format(d)
}
function fmtTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : TIME_FMT.format(d)
}
function openRatePct(c: CampaignRow): number | null {
  const r = c.metrics?.open_rate
  if (r == null) return null
  return Math.round(r * 100 * 10) / 10
}
function clickRatePct(c: CampaignRow): number | null {
  const r = c.metrics?.click_rate
  if (r == null) return null
  return Math.round(r * 100 * 10) / 10
}

const filtered = computed(() => rows.value)

function openCampaign(c: CampaignRow) {
  router.push({ name: 'campaign-detail', params: { id: String(c.campaign_id) } })
}
function compose() {
  router.push({ name: 'compose', query: { compose: '1' } })
}
function openTemplates() {
  router.push({ name: 'templates' })
}

/** Icon tone per campaign status + subject vibe. */
function iconTone(c: CampaignRow): { bg: string; stroke: string } {
  if (c.status === 'scheduled') return { bg: '#EDE9FE', stroke: '#5B21B6' }
  if (c.status === 'draft')     return { bg: '#F5F5F2', stroke: '#6B6B72' }
  const openPct = openRatePct(c) ?? 0
  if (openPct >= 75) return { bg: '#DCFCE7', stroke: '#166534' }
  if (openPct >= 55) return { bg: '#FEF3C7', stroke: '#92400E' }
  return { bg: '#DBEAFE', stroke: '#1E40AF' }
}
</script>

<template>
  <div class="comms">
    <!-- Page header: editorial heading + Templates / Compose actions. -->
    <header class="comms__head">
      <div class="comms__heading">
        <div class="comms__eyebrow">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <rect x="1.5" y="2.5" width="9" height="7" rx="1" stroke="currentColor" stroke-width="1.2"/>
            <path d="M1.8 3L6 6.5 10.2 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Email campaigns
        </div>
        <h1>Communications</h1>
        <p>Every email you've sent to members, with open and click rates. New broadcasts live here too.</p>
      </div>
      <div class="comms__actions">
        <button v-if="canSendComms" type="button" class="btn btn--ghost" @click="openTemplates">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2.5 3h9v8h-9z M2.5 5.5h9 M5 3v8" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
          Templates
        </button>
        <button v-if="canSendComms" type="button" class="btn btn--ink" @click="compose">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          New campaign
        </button>
      </div>
    </header>

    <!-- Stat tiles: one hero dark card (open rate) + three light tiles. -->
    <section class="comms__stats">
      <article class="stat stat--hero">
        <header>
          <span class="stat__label">Open rate · 30d</span>
          <span class="stat__trend" :class="`stat__trend--${stats.open_delta_sign}`">
            {{ stats.open_delta_sign === 'up' ? '▲' : '▼' }} {{ stats.open_delta }}
          </span>
        </header>
        <div class="stat__value">{{ stats.open_rate }}<span class="stat__unit">%</span></div>
        <footer>
          {{ stats.total_opens.toLocaleString() }} of {{ stats.total_delivered.toLocaleString() }} delivered ·
          {{ stats.total_sent.toLocaleString() }} sent total
        </footer>
        <div v-if="deliveryWarning" class="stat__warn" role="status">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M6 1.5L11 10.5H1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
            <path d="M6 5v2.5M6 9v0" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
          </svg>
          <span>
            Low delivery — {{ deliveryWarning.delivered }} of {{ deliveryWarning.sent }} landed.
            Check SES account status or the suppression list.
          </span>
        </div>
      </article>

      <article class="stat">
        <header>
          <span class="stat__label">Sent · 30d</span>
          <div class="stat__icon">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l8-4-3 10-2-4-3-2z" stroke="#0A0A0B" stroke-width="1.2" stroke-linejoin="round"/></svg>
          </div>
        </header>
        <div class="stat__value stat__value--md">{{ stats.total_sent.toLocaleString() }}</div>
        <footer>Across <strong>{{ stats.total_broadcasts }}</strong> broadcasts</footer>
      </article>

      <article class="stat">
        <header>
          <span class="stat__label">Click rate · 30d</span>
          <span class="stat__trend" :class="`stat__trend--${stats.click_delta_sign}`">
            {{ stats.click_delta_sign === 'up' ? '▲' : '▼' }} {{ stats.click_delta }}
          </span>
        </header>
        <div class="stat__value stat__value--md">{{ stats.click_rate }}<span class="stat__unit">%</span></div>
        <footer>{{ stats.total_clicks }} clicks on links &amp; buttons</footer>
      </article>

      <article class="stat">
        <header>
          <span class="stat__label">Unsubscribes · 30d</span>
          <span class="stat__trend" :class="`stat__trend--${stats.unsub_delta_sign}`">
            {{ stats.unsub_delta_sign === 'up' ? '▲' : '▼' }} {{ stats.unsub_delta }}
          </span>
        </header>
        <div class="stat__value stat__value--md">{{ stats.total_unsubs }}</div>
        <footer>{{ stats.unsub_rate }}% unsubscribe rate</footer>
      </article>
    </section>

    <!-- Campaign list card -->
    <section class="comms__card">
      <header class="comms__toolbar">
        <div class="tabs">
          <button
            v-for="t in tabs"
            :key="t.value"
            type="button"
            class="tab"
            :class="{ 'tab--active': activeTab === t.value }"
            @click="activeTab = t.value"
          >
            {{ t.label }}
            <span class="tab__count">{{ t.count }}</span>
          </button>
        </div>
        <div class="comms__toolbar-right">
          <label class="search">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><circle cx="5" cy="5" r="3.5" stroke="currentColor" stroke-width="1.3"/><path d="M8 8l2.5 2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
            <input v-model="search" type="search" placeholder="Search campaigns…" />
          </label>
          <button type="button" class="btn btn--chip">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M1.5 2.5h9L7 6.5V10l-2 1V6.5L1.5 2.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
            Filter
          </button>
          <button type="button" class="btn btn--chip">
            Newest
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M2.5 4L5 6.5 7.5 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </header>

      <!-- Column labels -->
      <div class="list__head">
        <div>Campaign</div>
        <div class="list__r">To</div>
        <div class="list__r">Sent</div>
        <div>Open rate</div>
        <div class="list__r">Clicks</div>
        <div></div>
      </div>

      <!-- Rows -->
      <ul class="list">
        <li
          v-for="c in filtered"
          :key="c.campaign_id"
          class="row"
          :class="{ 'row--muted': c.status !== 'sent' }"
          @click="openCampaign(c)"
        >
          <div class="row__campaign">
            <div class="row__icon" :style="{ background: iconTone(c).bg }">
              <svg v-if="c.status === 'sent'" width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M2 5l7 5 7-5v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5z" :stroke="iconTone(c).stroke" stroke-width="1.4" stroke-linejoin="round"/>
                <path d="M2 5l7 5 7-5" :stroke="iconTone(c).stroke" stroke-width="1.4" stroke-linejoin="round"/>
              </svg>
              <svg v-else-if="c.status === 'scheduled'" width="18" height="18" viewBox="0 0 18 18" fill="none">
                <rect x="2.5" y="4" width="13" height="11" rx="1" :stroke="iconTone(c).stroke" stroke-width="1.4"/>
                <path d="M5 2v3M13 2v3M2.5 8h13" :stroke="iconTone(c).stroke" stroke-width="1.4" stroke-linecap="round"/>
              </svg>
              <svg v-else width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M12 2.5l3.5 3.5-9 9H3v-3.5l9-9z" :stroke="iconTone(c).stroke" stroke-width="1.4" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="row__text">
              <div class="row__title-line">
                <h3 class="row__title">{{ c.subject }}</h3>
                <span v-if="c.status === 'scheduled'" class="pill pill--scheduled">Scheduled</span>
                <span v-else-if="c.status === 'draft'" class="pill pill--draft">Draft</span>
              </div>
              <div class="row__meta">
                <span>{{ c.audience_label ?? '—' }}</span>
                <span class="row__dot">·</span>
                <span v-if="c.status === 'scheduled'">{{ fmtTime(c.scheduled_for) }}</span>
                <span v-else-if="c.status === 'draft'">{{ fmtRelativeShort(c.created_at) }}</span>
                <span v-else>by {{ c.author.name ?? '—' }}</span>
              </div>
            </div>
          </div>

          <div class="list__r cell-mono">{{ c.status === 'draft' ? '—' : c.audience_count }}</div>
          <div class="list__r cell-date">
            <template v-if="c.status === 'draft'">—</template>
            <template v-else-if="c.status === 'scheduled'">
              <div class="cell-date__primary cell-date__primary--scheduled">{{ fmtDateLabel(c.scheduled_for) }}</div>
              <div class="cell-date__sub">{{ fmtRelativeShort(c.scheduled_for) }}</div>
            </template>
            <template v-else>
              <div class="cell-date__primary">{{ fmtDateLabel(c.sent_at) }}</div>
              <div class="cell-date__sub">{{ fmtRelativeShort(c.sent_at) }}</div>
            </template>
          </div>
          <div class="cell-rate">
            <template v-if="c.status === 'sent' && openRatePct(c) != null">
              <div class="cell-rate__top">
                <div class="cell-rate__value">{{ openRatePct(c) }}<span>%</span></div>
                <div class="cell-rate__frac">{{ c.metrics?.opened ?? 0 }}/{{ c.metrics?.delivered ?? 0 }}</div>
              </div>
              <div class="bar"><div class="bar__fill" :style="{ width: `${openRatePct(c)}%` }"></div></div>
            </template>
            <template v-else>—</template>
          </div>
          <div class="list__r cell-clicks">
            <template v-if="c.status === 'sent' && clickRatePct(c) != null">
              <div class="cell-clicks__value">{{ clickRatePct(c) }}%</div>
              <div class="cell-clicks__sub">{{ c.metrics?.clicked ?? 0 }} clicks</div>
            </template>
            <template v-else>—</template>
          </div>
          <div class="row__chevron">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
        </li>

        <li v-if="loadingList && filtered.length === 0" class="empty">
          <div class="empty__title">Loading campaigns…</div>
        </li>
        <li v-else-if="listError" class="empty">
          <div class="empty__title">Couldn't load campaigns</div>
          <div class="empty__sub">{{ listError }}</div>
        </li>
        <li v-else-if="filtered.length === 0" class="empty">
          <div class="empty__title">
            <template v-if="search">No campaigns match "{{ search }}"</template>
            <template v-else-if="activeTab === 'scheduled'">No scheduled sends yet</template>
            <template v-else-if="activeTab === 'draft'">No drafts yet</template>
            <template v-else>No campaigns yet</template>
          </div>
          <div class="empty__sub">
            <template v-if="search">Try a different search or clear the filter.</template>
            <template v-else-if="activeTab === 'all' || activeTab === 'sent'">Hit <strong>New campaign</strong> to compose the first one.</template>
            <template v-else>Scheduling + drafts land in a follow-up — compose now sends immediately.</template>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.comms {
  display: flex;
  flex-direction: column;
  gap: 28px;
  max-width: 1280px;
}

/* ── Header ────────────────────────────────────────────────────── */
.comms__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 32px;
}
.comms__heading { display: flex; flex-direction: column; gap: 10px; max-width: 720px; }
.comms__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-fog);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.comms__heading h1 {
  font-family: var(--font-display);
  font-size: 44px;
  font-weight: 600;
  color: var(--color-ink);
  letter-spacing: -0.02em;
  line-height: 100%;
  margin: 0;
}
.comms__heading p {
  font-family: var(--font-body);
  font-size: 15px;
  color: var(--color-fog);
  line-height: 1.5;
  margin: 0;
}
.comms__actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

/* ── Buttons ───────────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s ease;
}
.btn--ghost { background: #fff; border: 1px solid var(--color-hairline); color: var(--color-ink); font-weight: 500; }
.btn--ghost:hover { background: var(--color-surface); }
.btn--ink { background: var(--color-ink); color: #fff; padding: 0 20px; font-size: 14px; }
.btn--ink:hover { background: var(--color-graphite); }
.btn--chip {
  height: 34px;
  padding: 0 12px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  color: var(--color-ink);
  font-weight: 500;
  font-size: 13px;
}
.btn--chip:hover { background: var(--color-surface); }

/* ── Stats row ─────────────────────────────────────────────────── */
.comms__stats {
  display: grid;
  grid-template-columns: 1.3fr 1fr 1fr 1fr;
  gap: 16px;
}
.stat {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 16px;
  padding: 22px 22px 20px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 20px;
  min-height: 180px;
}
.stat header { display: flex; align-items: center; justify-content: space-between; }
.stat__label {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-fog);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.stat__trend {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-fog);
}
.stat__trend--up.stat__trend--success { color: var(--color-success); }
.stat__value {
  font-family: var(--font-display);
  font-size: 44px;
  font-weight: 500;
  color: var(--color-ink);
  letter-spacing: -0.02em;
  line-height: 100%;
}
.stat__value--md { font-size: 44px; }
.stat__unit { font-size: 20px; color: var(--color-mute); }
.stat footer {
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
}
.stat footer strong { color: var(--color-ink); font-weight: 600; }
.stat__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: var(--color-surface);
}

/* Hero dark stat */
.stat--hero {
  padding: 24px 24px 20px;
  background: var(--color-ink);
  color: #fff;
  gap: 20px;
}
.stat--hero .stat__label { color: rgba(255, 255, 255, 0.65); }
.stat--hero .stat__value { font-size: 72px; color: #fff; }
.stat--hero .stat__unit { color: rgba(255, 255, 255, 0.65); font-size: 36px; }
.stat--hero footer { color: rgba(255, 255, 255, 0.75); line-height: 1.5; }
.stat--hero .stat__warn {
  display: inline-flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 10px;
  background: rgba(251, 191, 36, 0.14);
  color: #FDE68A;
  font-family: var(--font-body);
  font-size: 11.5px;
  line-height: 1.4;
  max-width: 100%;
}
.stat--hero .stat__warn svg { flex-shrink: 0; margin-top: 2px; color: #FBBF24; }
.stat--hero .stat__trend { color: var(--color-sky-1); }

/* ── Card + toolbar ────────────────────────────────────────────── */
.comms__card {
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 20px;
  overflow: hidden;
}
.comms__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 24px;
  border-bottom: 1px solid var(--color-hairline);
}
.tabs { display: flex; align-items: center; gap: 4px; }
.tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--color-ink);
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.tab:hover:not(.tab--active) { background: var(--color-surface); }
.tab--active { background: var(--color-ink); color: #fff; font-weight: 600; }
.tab__count {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-mute);
}
.tab--active .tab__count { color: rgba(255, 255, 255, 0.65); }

.comms__toolbar-right { display: flex; align-items: center; gap: 10px; }
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--color-hairline);
  border-radius: 999px;
  background: #fff;
  width: 260px;
  color: var(--color-fog);
}
.search input {
  flex: 1;
  border: 0;
  outline: none;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-ink);
  background: transparent;
}
.search input::placeholder { color: var(--color-mute); }

/* ── List ──────────────────────────────────────────────────────── */
.list__head,
.row {
  display: grid;
  grid-template-columns: 1fr 100px 130px 190px 110px 32px;
  gap: 20px;
  align-items: center;
}
.list__head {
  padding: 14px 24px;
  background: #FAFAF8;
  border-bottom: 1px solid var(--color-hairline);
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  color: var(--color-fog);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.list__r { text-align: right; }

.list { list-style: none; margin: 0; padding: 0; }
.row {
  padding: 18px 24px;
  border-bottom: 1px solid var(--color-hairline);
  background: #fff;
  cursor: pointer;
  transition: background 0.1s ease;
}
.row:last-child { border-bottom: 0; }
.row:hover { background: var(--color-surface); }
.row--muted { background: #FAFAF8; }
.row--muted:hover { background: var(--color-surface); }

.row__campaign { display: flex; align-items: center; gap: 14px; min-width: 0; }
.row__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  flex-shrink: 0;
}
.row__text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.row__title-line { display: flex; align-items: center; gap: 8px; }
.row__title {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  color: var(--color-ink);
  letter-spacing: -0.01em;
  margin: 0;
}
.row--muted .row__title { color: var(--color-fog); font-weight: 500; }

.row__meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
}
.row--muted .row__meta { color: var(--color-mute); }
.row__dot { color: #CCCCCC; }

.pill {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.pill--scheduled { background: #EDE9FE; color: #5B21B6; }
.pill--draft { background: var(--color-surface); color: var(--color-fog); border: 1px solid var(--color-hairline); }

.cell-mono { font-family: var(--font-mono); font-size: 13px; color: var(--color-ink); }
.row--muted .cell-mono { color: var(--color-mute); }

.cell-date {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-ink);
}
.cell-date__primary { color: var(--color-ink); }
.cell-date__primary--scheduled { color: #5B21B6; font-weight: 500; }
.cell-date__sub { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); }

.cell-rate { display: flex; flex-direction: column; gap: 6px; font-family: var(--font-body); font-size: 12px; color: var(--color-mute); }
.cell-rate__top { display: flex; align-items: baseline; justify-content: space-between; }
.cell-rate__value {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  color: var(--color-ink);
}
.cell-rate__value span { font-size: 12px; color: var(--color-fog); font-weight: 400; }
.cell-rate__frac { font-family: var(--font-mono); font-size: 10px; color: var(--color-fog); }
.bar {
  height: 4px;
  border-radius: 999px;
  background: var(--color-surface);
  overflow: hidden;
}
.bar__fill { height: 100%; background: var(--color-ink); border-radius: 999px; }

.cell-clicks { display: flex; flex-direction: column; gap: 2px; align-items: flex-end; }
.cell-clicks__value {
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 500;
  color: var(--color-ink);
}
.cell-clicks__sub { font-family: var(--font-mono); font-size: 10px; color: var(--color-fog); }

.row__chevron { display: flex; justify-content: flex-end; color: var(--color-fog); }

.empty {
  padding: 48px 24px;
  text-align: center;
}
.empty__title { font-family: var(--font-display); font-size: 18px; font-weight: 500; color: var(--color-ink); margin-bottom: 6px; }
.empty__sub { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); }

@media (max-width: 1180px) {
  .comms__stats { grid-template-columns: 1fr 1fr; }
}
</style>
