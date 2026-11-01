<script setup lang="ts">
/**
 * Campaign detail — Paper artboard 78.
 *
 * Reads `:id` from the route. Numeric IDs call the live
 * `communications.getBatch()` endpoint (brief 67) and map the response
 * into the view model below. String slugs fall back to `mockCampaigns.ts`
 * so the design is iterable without a backend. Fields that only land
 * with brief 70 (`links`, `analytics`, `audience_label`, `sent_at`) are
 * synthesised from the live data when missing.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  campaigns as campaignsApi,
  type CampaignDetail,
  type CampaignRecipient as ApiCampaignRecipient,
} from '@torny/api-client'
import { useClubStore } from '@/stores/club'
import CrmModal from '@/components/modals/CrmModal.vue'
import { findCampaign, type Campaign, type CampaignRecipient, type RecipientStatus } from './mockCampaigns'

const route = useRoute()
const router = useRouter()
const clubStore = useClubStore()

const campaignId = computed(() => String(route.params.id ?? ''))
const liveCampaign = ref<Campaign | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)

const campaign = computed<Campaign | undefined>(() => {
  // Live first; mock slug fallback.
  if (liveCampaign.value) return liveCampaign.value
  return findCampaign(campaignId.value)
})

// ── Live loader ─────────────────────────────────────────────────────
function initialsOf(name: string | null): string {
  if (!name) return '??'
  const parts = name.trim().split(/\s+/)
  const a = parts[0]?.[0] ?? ''
  const b = parts[parts.length - 1]?.[0] ?? ''
  return (a + (parts.length > 1 ? b : '')).toUpperCase() || '??'
}

/** Short time label: 7:02a / 7:14p. */
function fmtTime(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  let h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? 'p' : 'a'
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, '0')}${ampm}`
}

/** 30 Oct · 7:02a */
function fmtDateTime(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d.getDate()} ${months[d.getMonth()]} · ${fmtTime(iso)}`
}

/** First-open relative label: '7:08a (6m)' */
function fmtFirstOpen(firstOpen: string | null, sentAt: string | null): string | null {
  const t = fmtTime(firstOpen)
  if (!t) return null
  if (!sentAt) return t
  const diffMin = Math.round((new Date(firstOpen!).getTime() - new Date(sentAt).getTime()) / 60000)
  if (diffMin < 0 || diffMin > 60 * 48) return t
  const label = diffMin < 60 ? `${diffMin}m` : `${Math.floor(diffMin / 60)}h ${diffMin % 60}m`
  return `${t} (${label})`
}

/** Build a plain-text excerpt from preview_html / body_html. */
function excerptLines(html: string | null, max = 4): string[] {
  if (!html) return []
  const stripped = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
  const lines = stripped
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0 && !/^(view in browser|unsubscribe|© \d{4})/i.test(l))
  return lines.slice(0, max)
}

function recipientTone(status: ApiCampaignRecipient['status']): CampaignRecipient['avatar_tone'] {
  if (status === 'clicked') return 'violet'
  return 'fog'
}

function recipientEmailSuffix(r: ApiCampaignRecipient): string {
  if (r.status === 'bounced' && r.status_reason) return ` · ${r.status_reason}`
  if (r.status === 'unsubscribed') return ' · opted out'
  return ''
}

function mapRecipient(r: ApiCampaignRecipient): CampaignRecipient {
  return {
    user_id: r.user_id,
    name: r.name ?? r.email,
    email: r.email,
    initials: initialsOf(r.name),
    avatar_tone: recipientTone(r.status),
    status: r.status as RecipientStatus,
    delivered_label: fmtTime(r.delivered_at),
    opened_label: fmtTime(r.opened_at),
    opened_count: r.open_count ?? 0,
    clicked_label: fmtTime(r.clicked_at),
    clicked_count: r.click_count ?? 0,
    last_activity_label: '',
    last_activity_detail: recipientEmailSuffix(r),
  }
}

/** 7–8a (72 opens) */
function fmtPeakHourLabel(peakHour: string | null, totalOpens: number): string | null {
  if (!peakHour) return null
  const d = new Date(peakHour)
  if (Number.isNaN(d.getTime())) return null
  const start = d.getHours()
  const end = (start + 1) % 24
  const fmt = (h: number) => {
    const ampm = h >= 12 ? 'p' : 'a'
    const base = h % 12 || 12
    return `${base}${ampm}`
  }
  return `${fmt(start)}–${fmt(end)} (${totalOpens} opens)`
}

function mapCampaignDetail(cd: CampaignDetail): Campaign {
  // Reconcile brief 67 (`counts` + `batch_id`) with brief 71 (`metrics` +
  // `campaign_id`) — the backend may ship either or both.
  const metrics = cd.metrics ?? {
    sent: cd.counts?.sent ?? 0,
    delivered: cd.counts?.delivered ?? 0,
    opened: cd.counts?.opened ?? 0,
    clicked: cd.counts?.clicked ?? 0,
    bounced: cd.counts?.bounced ?? 0,
    complained: cd.counts?.complained ?? 0,
    unsubscribed: cd.counts?.unsubscribed ?? 0,
    open_rate: null,
    click_rate: null,
  }
  const delivered = metrics.delivered
  const openRateFloat = metrics.open_rate ?? (delivered ? metrics.opened / delivered : 0)
  const clickRateFloat = metrics.click_rate ?? (delivered ? metrics.clicked / delivered : 0)

  const id = cd.campaign_id ?? cd.batch_id ?? 0
  const audienceCount = cd.audience_count ?? cd.counts?.matched ?? 0
  const senderName = cd.author?.name ?? cd.sender?.name ?? cd.sender?.label ?? 'Club admin'
  const senderInitials = cd.author?.initials ?? initialsOf(senderName)
  const sentAt = cd.sent_at ?? cd.created_at
  const analytics = cd.analytics ?? null
  const links = cd.links ?? []
  const suppressed = cd.counts?.suppressed ?? 0

  // Synthesise the "first open" / "peak hour" / "avg opens" when brief 71
  // analytics is absent — derive from recipients[] where possible.
  const openedTs = cd.recipients.map((r) => r.opened_at).filter((x): x is string => !!x).sort()
  const synthFirstOpen = openedTs[0] ?? null
  const totalOpens = analytics?.total_opens ?? cd.recipients.reduce((s, r) => s + (r.open_count ?? 0), 0)
  const openedCount = metrics.opened || openedTs.length

  return {
    id: String(id),
    subject: cd.subject,
    status: cd.status ?? 'sent',
    flavor_label: cd.flavor_label ?? 'Broadcast',
    audience_label: cd.audience_label ?? `${audienceCount} recipients`,
    audience_count: audienceCount,
    author_name: senderName,
    author_initials: senderInitials,
    sent_at_time: sentAt,
    sent_at_date: fmtDateTime(sentAt) ?? undefined,
    delivered,
    opens: metrics.opened,
    open_rate: Math.round(openRateFloat * 1000) / 10,     // 0..100
    clicks: metrics.clicked,
    click_rate: Math.round(clickRateFloat * 1000) / 10,
    bounces: metrics.bounced,
    unsubscribes: metrics.unsubscribed,
    suppressed,
    body_lines: excerptLines(cd.body_html ?? cd.preview_html ?? ''),
    cta_label: undefined,
    links: links.map((l) => ({
      url: l.url,
      clicks: l.clicks,
      unique_clickers: l.unique_clickers,
      ctr: delivered ? l.unique_clickers / delivered : 0,
    })),
    recipients: cd.recipients.map(mapRecipient),
    analytics: {
      first_open_at_label: fmtFirstOpen(analytics?.first_open_at ?? synthFirstOpen, sentAt),
      peak_hour_label: analytics?.peak_open_hour
        ? fmtPeakHourLabel(analytics.peak_open_hour, totalOpens)
        : null,
      avg_opens_per_opened:
        openedCount > 0 ? Number((totalOpens / openedCount).toFixed(1)) : null,
      delivered_not_opened: analytics?.delivered_not_opened ?? Math.max(0, delivered - metrics.opened),
    },
    archived_at: cd.archived_at ?? null,
  }
}

async function loadLive() {
  const cid = clubStore.current?.id
  const batchId = Number(campaignId.value)
  if (cid == null || !Number.isFinite(batchId)) {
    liveCampaign.value = null
    return
  }
  loading.value = true
  loadError.value = null
  try {
    const cd = await campaignsApi.get(cid, batchId)
    liveCampaign.value = mapCampaignDetail(cd)
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : 'Could not load campaign.'
    liveCampaign.value = null
  } finally {
    loading.value = false
  }
}

onMounted(() => { void loadLive() })
watch(() => clubStore.current?.id, () => { void loadLive() })
watch(campaignId, () => { void loadLive() })

// ── Actions (brief 71) ───────────────────────────────────────────────
const isLive = computed(() => liveCampaign.value !== null)
const isArchived = computed(() => !!campaign.value?.archived_at)
const unopenedCount = computed(() => campaign.value?.analytics?.delivered_not_opened ?? 0)

const confirmResend = ref(false)
const actionBusy = ref(false)
const actionError = ref<string | null>(null)
const resendResult = ref<{ newBatchId: number; count: number; skipped: number } | null>(null)

function openResendModal() {
  if (!isLive.value) return
  if (unopenedCount.value === 0) return
  actionError.value = null
  resendResult.value = null
  confirmResend.value = true
}

async function doResend() {
  const cid = clubStore.current?.id
  const batchId = Number(campaignId.value)
  if (cid == null || !Number.isFinite(batchId)) return
  actionBusy.value = true
  actionError.value = null
  try {
    const r = await campaignsApi.resendUnopened(cid, batchId, {})
    resendResult.value = { newBatchId: r.new_batch_id, count: r.resend_count, skipped: r.skipped_count }
    confirmResend.value = false
    router.push({ name: 'campaign-detail', params: { id: String(r.new_batch_id) } })
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : 'Resend failed.'
  } finally {
    actionBusy.value = false
  }
}

type StatusFilter = 'all' | 'clicked' | 'opened' | 'delivered' | 'bounced' | 'unsubscribed'
const statusFilter = ref<StatusFilter>('all')
const search = ref('')

const PAGE_SIZE = 5
const page = ref(1)

const filterCounts = computed(() => {
  const r = campaign.value?.recipients ?? []
  return {
    all: campaign.value?.audience_count ?? r.length,
    clicked: r.filter((x) => x.status === 'clicked').length || campaign.value?.clicks || 0,
    opened: campaign.value?.opens ?? r.filter((x) => x.status === 'opened' || x.status === 'clicked').length,
    delivered: campaign.value?.analytics?.delivered_not_opened ?? 0,
    bounced: campaign.value?.bounces ?? 0,
    unsubscribed: campaign.value?.unsubscribes ?? 0,
  }
})

const filteredRecipients = computed<CampaignRecipient[]>(() => {
  const r = campaign.value?.recipients ?? []
  const q = search.value.trim().toLowerCase()
  return r.filter((x) => {
    if (q && !x.name.toLowerCase().includes(q) && !x.email.toLowerCase().includes(q)) return false
    switch (statusFilter.value) {
      case 'clicked':      return x.status === 'clicked'
      case 'opened':       return x.status === 'opened' || x.status === 'clicked'
      case 'delivered':    return x.status === 'delivered'
      case 'bounced':      return x.status === 'bounced'
      case 'unsubscribed': return x.status === 'unsubscribed'
      default:             return true
    }
  })
})

const pagedRecipients = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE
  return filteredRecipients.value.slice(start, start + PAGE_SIZE)
})
const totalPages = computed(() => Math.max(1, Math.ceil(filteredRecipients.value.length / PAGE_SIZE)))

/** Delivery-outcomes bar segments as % of audience_count. */
const outcomeBreakdown = computed(() => {
  const c = campaign.value
  if (!c) return null
  const total = c.audience_count || 1
  const opened = c.opens ?? 0
  const deliveredNotOpened = c.analytics?.delivered_not_opened ?? Math.max(0, (c.delivered ?? 0) - opened)
  const bounced = c.bounces ?? 0
  const unsubscribed = c.unsubscribes ?? 0
  const suppressed = c.suppressed ?? 0
  return {
    opened: { count: opened, pct: (opened / total) * 100 },
    delivered: { count: deliveredNotOpened, pct: (deliveredNotOpened / total) * 100 },
    bounced: { count: bounced, pct: (bounced / total) * 100 },
    unsubscribed: { count: unsubscribed, pct: (unsubscribed / total) * 100 },
    suppressed: { count: suppressed, pct: (suppressed / total) * 100 },
  }
})

const topLinkClicks = computed(() => campaign.value?.links?.[0]?.clicks ?? 1)

function back() { router.push({ name: 'communications' }) }
function setFilter(f: StatusFilter) { statusFilter.value = f; page.value = 1 }
function prevPage() { if (page.value > 1) page.value-- }
function nextPage() { if (page.value < totalPages.value) page.value++ }

function statusChipClass(s: RecipientStatus) {
  return `cd-chip cd-chip--${s}`
}
function statusChipLabel(s: RecipientStatus) {
  return s === 'unsubscribed' ? 'Unsub.' : s.charAt(0).toUpperCase() + s.slice(1)
}
function fmtPct(n: number) {
  return `${n.toFixed(1)}%`
}
function body(line: string) {
  return line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
}
</script>

<template>
  <div v-if="campaign" class="cd">
    <!-- Topbar -->
    <div class="cd__topbar">
      <div class="cd__topbar-left">
        <button type="button" class="pill-btn pill-btn--ghost cd__back" @click="back">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M8 2L4 6l4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          All campaigns
        </button>
        <div class="cd__crumb">
          <span>CAMPAIGNS</span>
          <span class="cd__crumb-sep">/</span>
          <span class="cd__crumb-current">{{ campaign.subject.length > 48 ? campaign.subject.slice(0, 48) + '…' : campaign.subject }}</span>
        </div>
      </div>
      <div class="cd__topbar-actions">
        <button
          type="button"
          class="pill-btn pill-btn--ghost"
          :disabled="!isLive || isArchived || unopenedCount === 0"
          :title="isArchived ? 'Restore first to resend' : unopenedCount === 0 ? 'Everyone opened it!' : undefined"
          @click="openResendModal"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M1 6l4 4M5 10V2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Resend to unopened
        </button>
      </div>
    </div>

    <!-- Hero -->
    <header class="cd__hero">
      <div class="cd__hero-pills">
        <span class="cd-chip cd-chip--sent"><span class="cd-chip__check">✓</span> Sent</span>
        <span class="cd-chip cd-chip--flavor">{{ (campaign.flavor_label ?? 'Broadcast').toUpperCase() }}</span>
        <span class="cd-chip cd-chip--batch">BATCH #{{ campaign.id }}</span>
        <span v-if="isArchived" class="cd-chip cd-chip--archived">ARCHIVED</span>
      </div>
      <h1 class="cd__hero-title">{{ campaign.subject }}</h1>
      <div class="cd__hero-meta">
        <div class="cd__author">
          <div class="cd__author-avatar">{{ campaign.author_initials }}</div>
          <span>{{ campaign.author_name }}</span>
        </div>
        <span class="cd__dot">·</span>
        <span>Sent <span class="mono">{{ campaign.sent_at_date ?? campaign.sent_at_time }}</span></span>
        <span class="cd__dot">·</span>
        <span><strong>{{ campaign.audience_count }}</strong> recipients</span>
        <span class="cd__dot">·</span>
        <span>Flavour <strong>{{ campaign.flavor_label ?? 'Broadcast' }}</strong></span>
      </div>
    </header>

    <!-- Funnel strip -->
    <section class="cd__funnel">
      <article class="cd-fnl">
        <div class="cd-fnl__label">Sent</div>
        <div class="cd-fnl__value">{{ campaign.audience_count }}</div>
        <div class="cd-fnl__sub">Attempted</div>
      </article>
      <div class="cd-fnl__arrow">→</div>
      <article class="cd-fnl">
        <div class="cd-fnl__label">Delivered</div>
        <div class="cd-fnl__value">{{ campaign.delivered ?? 0 }}<span class="cd-fnl__pct">{{ fmtPct(campaign.audience_count ? ((campaign.delivered ?? 0) / campaign.audience_count) * 100 : 0) }}</span></div>
        <div class="cd-fnl__sub">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M2 5l2 2 4-5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          {{ campaign.bounces ?? 0 }} bounced
        </div>
      </article>
      <div class="cd-fnl__arrow">→</div>
      <article class="cd-fnl">
        <div class="cd-fnl__label">Opened</div>
        <div class="cd-fnl__value">{{ campaign.opens ?? 0 }}<span class="cd-fnl__pct">{{ fmtPct(campaign.open_rate ?? 0) }}</span></div>
        <div class="cd-fnl__sub cd-fnl__sub--eye">
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M1 6s2-4 5-4 5 4 5 4-2 4-5 4-5-4-5-4z" stroke="currentColor" stroke-width="1.3"/><circle cx="6" cy="6" r="1.3" fill="currentColor"/></svg>
          Avg {{ campaign.analytics?.avg_opens_per_opened ?? '—' }} opens / recipient
        </div>
      </article>
      <div class="cd-fnl__arrow">→</div>
      <article class="cd-fnl">
        <div class="cd-fnl__label">Clicked</div>
        <div class="cd-fnl__value">{{ campaign.clicks ?? 0 }}<span class="cd-fnl__pct">{{ fmtPct(campaign.click_rate ?? 0) }}</span></div>
        <div class="cd-fnl__sub">On any link</div>
      </article>
    </section>

    <!-- Body: left column + right rail -->
    <section class="cd__body">
      <!-- LEFT COLUMN -->
      <div class="cd__left">
        <!-- Delivery outcomes -->
        <article class="cd-card">
          <header class="cd-card__head">
            <div>
              <div class="cd-eyebrow">Delivery outcomes</div>
              <h2 class="cd-card__title">What happened to each send</h2>
            </div>
            <span class="cd-card__sub">{{ campaign.audience_count }} total · hover for exact counts</span>
          </header>
          <div v-if="outcomeBreakdown" class="cd-stack">
            <div class="cd-stack__seg cd-stack__seg--opened" :style="{ width: `${outcomeBreakdown.opened.pct}%` }" :title="`Opened + clicked: ${outcomeBreakdown.opened.count}`"></div>
            <div class="cd-stack__seg cd-stack__seg--delivered" :style="{ width: `${outcomeBreakdown.delivered.pct}%` }" :title="`Delivered, not opened: ${outcomeBreakdown.delivered.count}`"></div>
            <div class="cd-stack__seg cd-stack__seg--bounced" :style="{ width: `${outcomeBreakdown.bounced.pct}%` }" :title="`Bounced: ${outcomeBreakdown.bounced.count}`"></div>
            <div class="cd-stack__seg cd-stack__seg--unsub" :style="{ width: `${outcomeBreakdown.unsubscribed.pct}%` }" :title="`Unsubscribed: ${outcomeBreakdown.unsubscribed.count}`"></div>
            <div class="cd-stack__seg cd-stack__seg--suppressed" :style="{ width: `${outcomeBreakdown.suppressed.pct}%` }" :title="`Suppressed: ${outcomeBreakdown.suppressed.count}`"></div>
          </div>
          <div v-if="outcomeBreakdown" class="cd-legend">
            <div class="cd-legend__cell">
              <div class="cd-legend__label"><span class="cd-dot cd-dot--opened"></span>Opened + clicked</div>
              <div class="cd-legend__value">{{ outcomeBreakdown.opened.count }}</div>
              <div class="cd-legend__sub">{{ fmtPct(outcomeBreakdown.opened.pct) }}</div>
            </div>
            <div class="cd-legend__cell">
              <div class="cd-legend__label"><span class="cd-dot cd-dot--delivered"></span>Delivered, not opened</div>
              <div class="cd-legend__value">{{ outcomeBreakdown.delivered.count }}</div>
              <div class="cd-legend__sub">{{ fmtPct(outcomeBreakdown.delivered.pct) }}</div>
            </div>
            <div class="cd-legend__cell">
              <div class="cd-legend__label"><span class="cd-dot cd-dot--bounced"></span>Bounced</div>
              <div class="cd-legend__value">{{ outcomeBreakdown.bounced.count }}</div>
              <div class="cd-legend__sub">{{ fmtPct(outcomeBreakdown.bounced.pct) }}</div>
            </div>
            <div class="cd-legend__cell">
              <div class="cd-legend__label"><span class="cd-dot cd-dot--unsub"></span>Unsubscribed</div>
              <div class="cd-legend__value">{{ outcomeBreakdown.unsubscribed.count }}</div>
              <div class="cd-legend__sub">{{ fmtPct(outcomeBreakdown.unsubscribed.pct) }}</div>
            </div>
            <div class="cd-legend__cell">
              <div class="cd-legend__label"><span class="cd-dot cd-dot--suppressed"></span>Suppressed</div>
              <div class="cd-legend__value">{{ outcomeBreakdown.suppressed.count }}</div>
              <div class="cd-legend__sub">{{ fmtPct(outcomeBreakdown.suppressed.pct) }} · opted out</div>
            </div>
          </div>
        </article>

        <!-- Click breakdown -->
        <article class="cd-card">
          <header class="cd-card__head">
            <div>
              <div class="cd-eyebrow">Click breakdown</div>
              <h2 class="cd-card__title">{{ campaign.clicks ?? 0 }} clicks on {{ campaign.links?.length ?? 0 }} links</h2>
            </div>
            <span class="cd-card__sub">Avg {{ fmtPct(campaign.click_rate ?? 0) }} CTR</span>
          </header>
          <div v-if="campaign.links && campaign.links.length > 0" class="cd-links">
            <div v-for="lnk in campaign.links" :key="lnk.url" class="cd-links__row">
              <div class="cd-links__url">{{ lnk.url }}</div>
              <div class="cd-links__count">{{ lnk.clicks }}</div>
              <div class="cd-links__pct">{{ ((lnk.clicks / (campaign.clicks ?? 1)) * 100).toFixed(1) }}%</div>
              <div class="cd-links__bar">
                <div class="cd-links__fill" :style="{ width: `${(lnk.clicks / topLinkClicks) * 100}%` }"></div>
              </div>
            </div>
          </div>
          <div v-else class="cd-links-empty">
            Per-link click breakdown lands with brief 70.
          </div>
        </article>

        <!-- Recipients -->
        <article class="cd-card cd-card--flush">
          <header class="cd-card__head cd-card__head--pad">
            <div>
              <div class="cd-eyebrow">Recipients</div>
              <h2 class="cd-card__title">{{ campaign.audience_count }} {{ campaign.audience_count === 1 ? 'member' : 'members' }} · {{ campaign.opens }} engaged</h2>
            </div>
            <div class="cd-search">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.6"/><path d="M11 11l3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
              <input v-model="search" type="search" placeholder="Search by name or email…" />
            </div>
          </header>
          <div class="cd-filters">
            <button type="button" class="cd-pill" :class="{ 'cd-pill--active': statusFilter === 'all' }" @click="setFilter('all')">All <span>{{ filterCounts.all }}</span></button>
            <button type="button" class="cd-pill" :class="{ 'cd-pill--active': statusFilter === 'clicked' }" @click="setFilter('clicked')">Clicked <span>{{ filterCounts.clicked }}</span></button>
            <button type="button" class="cd-pill" :class="{ 'cd-pill--active': statusFilter === 'opened' }" @click="setFilter('opened')">Opened <span>{{ filterCounts.opened }}</span></button>
            <button type="button" class="cd-pill" :class="{ 'cd-pill--active': statusFilter === 'delivered' }" @click="setFilter('delivered')">Delivered, not opened <span>{{ filterCounts.delivered }}</span></button>
            <button type="button" class="cd-pill" :class="{ 'cd-pill--active': statusFilter === 'bounced' }" @click="setFilter('bounced')">Bounced <span>{{ filterCounts.bounced }}</span></button>
            <button type="button" class="cd-pill" :class="{ 'cd-pill--active': statusFilter === 'unsubscribed' }" @click="setFilter('unsubscribed')">Unsubscribed <span>{{ filterCounts.unsubscribed }}</span></button>
          </div>

          <div class="cd-tbl__head">
            <div></div>
            <div>Member</div>
            <div class="cd-tbl__right">Status</div>
            <div class="cd-tbl__right">Delivered</div>
            <div class="cd-tbl__right">Opened</div>
            <div class="cd-tbl__right">Clicked</div>
          </div>

          <div class="cd-tbl__body">
            <div v-for="r in pagedRecipients" :key="r.user_id" class="cd-tbl__row">
              <div class="cd-tbl__avatar" :class="`cd-tbl__avatar--${r.avatar_tone}`">{{ r.initials }}</div>
              <div class="cd-tbl__person">
                <div class="cd-tbl__name">{{ r.name }}</div>
                <div class="cd-tbl__email">
                  <span>{{ r.email }}</span>
                  <span v-if="r.status === 'bounced'" class="cd-tbl__email-bad"> · mailbox full</span>
                  <span v-else-if="r.status === 'unsubscribed'" class="cd-tbl__email-mute"> · opted out</span>
                </div>
              </div>
              <div class="cd-tbl__right">
                <span :class="statusChipClass(r.status)">{{ statusChipLabel(r.status) }}</span>
              </div>
              <div class="cd-tbl__right mono cd-tbl__ts" :class="{ 'cd-tbl__ts--mute': !r.delivered_label }" data-label="Delivered">
                {{ r.delivered_label ?? '—' }}
              </div>
              <div class="cd-tbl__right mono cd-tbl__ts" :class="{ 'cd-tbl__ts--mute': !r.opened_label }" data-label="Opened">
                <template v-if="r.opened_label">
                  {{ r.opened_label }}<span v-if="r.opened_count > 1" class="cd-tbl__ts-sub"> · {{ r.opened_count }}×</span>
                </template>
                <template v-else>—</template>
              </div>
              <div class="cd-tbl__right mono cd-tbl__ts" :class="{ 'cd-tbl__ts--mute': !r.clicked_label }" data-label="Clicked">
                <template v-if="r.clicked_label">
                  {{ r.clicked_label }}<span v-if="r.clicked_count > 1" class="cd-tbl__ts-sub"> · {{ r.clicked_count }}×</span>
                </template>
                <template v-else>—</template>
              </div>
            </div>
            <div v-if="pagedRecipients.length === 0" class="cd-tbl__empty">
              No recipients in this filter.
            </div>
          </div>

          <footer class="cd-tbl__foot">
            <div class="mono">Showing {{ (page - 1) * PAGE_SIZE + 1 }}–{{ Math.min(page * PAGE_SIZE, filteredRecipients.length) }} of {{ filteredRecipients.length }}</div>
            <div class="cd-tbl__pager">
              <button type="button" class="pill-btn pill-btn--ghost" :disabled="page === 1" @click="prevPage">Previous</button>
              <button type="button" class="pill-btn pill-btn--ghost" :disabled="page === totalPages" @click="nextPage">Next</button>
            </div>
          </footer>
        </article>
      </div>

      <!-- RIGHT RAIL -->
      <aside class="cd__rail">
        <!-- Email preview -->
        <article class="cd-card cd-card--rail">
          <header class="cd-rail__head">
            <div class="cd-eyebrow">The email</div>
            <button type="button" class="pill-btn pill-btn--ghost cd-rail__view">View full →</button>
          </header>
          <div class="cd-mail">
            <div class="cd-mail__meta">
              <div class="cd-eyebrow cd-eyebrow--mono">FROM</div>
              <div class="cd-mail__from">{{ campaign.author_name }} &lt;{{ campaign.sender_email ?? 'hello@naenaebowls.nz' }}&gt;</div>
              <div class="cd-eyebrow cd-eyebrow--mono cd-mail__spacer">SUBJECT</div>
              <div class="cd-mail__subject">{{ campaign.subject }}</div>
            </div>
            <div class="cd-mail__body">
              <div class="cd-mail__hero">Season kick-off</div>
              <p v-for="(line, i) in campaign.body_lines ?? []" :key="i" class="cd-mail__line" v-html="body(line)"></p>
              <div v-if="campaign.cta_label" class="cd-mail__cta">{{ campaign.cta_label }}</div>
            </div>
          </div>
        </article>

        <!-- At a glance -->
        <article class="cd-card cd-card--rail">
          <div class="cd-eyebrow">At a glance</div>
          <div class="cd-glance">
            <div class="cd-glance__row">
              <div class="cd-glance__key">Flavor</div>
              <div class="cd-glance__val">{{ campaign.flavor_label ?? 'Broadcast' }}</div>
            </div>
            <div class="cd-glance__row">
              <div class="cd-glance__key">Sent by</div>
              <div class="cd-glance__val">{{ campaign.author_name }}</div>
            </div>
            <div class="cd-glance__row">
              <div class="cd-glance__key">Sent at</div>
              <div class="cd-glance__val mono">{{ campaign.sent_at_date ?? campaign.sent_at_time }}</div>
            </div>
            <div class="cd-glance__row">
              <div class="cd-glance__key">Audience</div>
              <div class="cd-glance__val">{{ campaign.audience_label }}</div>
            </div>
            <div class="cd-glance__row">
              <div class="cd-glance__key">First open</div>
              <div class="cd-glance__val mono">{{ campaign.analytics?.first_open_at_label ?? '—' }}</div>
            </div>
            <div class="cd-glance__row cd-glance__row--last">
              <div class="cd-glance__key">Peak hour</div>
              <div class="cd-glance__val mono">{{ campaign.analytics?.peak_hour_label ?? '—' }}</div>
            </div>
          </div>
        </article>

      </aside>
    </section>
  </div>

  <!-- Loading -->
  <div v-else-if="loading" class="cd__empty">
    <h1>Loading campaign…</h1>
  </div>

  <!-- Not-found / error fallback -->
  <div v-else class="cd__empty">
    <h1>Campaign not found</h1>
    <p v-if="loadError">{{ loadError }}</p>
    <p v-else>No campaign matches "<code>{{ campaignId }}</code>".</p>
    <button type="button" class="pill-btn pill-btn--ink" @click="back">Back to all campaigns</button>
  </div>

  <!-- Action modals (sibling root nodes so v-if/v-else-if chain above stays intact) -->
  <CrmModal
    :open="confirmResend"
    eyebrow="Resend campaign"
    :title="`Send to ${unopenedCount} unopened?`"
    width="sm"
    @close="confirmResend = false"
  >
    <p class="cd-modal__text">
      This creates a new batch targeted at recipients who didn't open the original.
      Suppressions (bounced / unsubscribed / complained) are dropped automatically.
    </p>
    <p v-if="actionError" class="cd-modal__err">{{ actionError }}</p>
    <template #footer>
      <button type="button" class="pill-btn pill-btn--ghost" :disabled="actionBusy" @click="confirmResend = false">Cancel</button>
      <button type="button" class="pill-btn pill-btn--ink" :disabled="actionBusy" @click="doResend">
        {{ actionBusy ? 'Sending…' : 'Send now' }}
      </button>
    </template>
  </CrmModal>

</template>

<style scoped>
.cd {
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 1280px;
}

/* ── Shared helpers ──────────────────────────────────────────── */
.mono { font-family: var(--font-mono); }
.cd-eyebrow {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 700;
  color: var(--color-fog);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.cd-eyebrow--mono { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em; }
.cd-eyebrow--danger { color: #DC2F3B; }

.pill-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--color-hairline);
  background: #fff;
  color: var(--color-ink);
  white-space: nowrap;
}
.pill-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.pill-btn--ghost { background: #fff; }
.pill-btn--ghost:hover:not(:disabled) { background: var(--color-surface); }
.pill-btn--ghost[disabled] { color: var(--color-mute); cursor: not-allowed; }
.pill-btn--ink { background: var(--color-ink); color: #fff; border-color: var(--color-ink); font-weight: 600; }
.pill-btn--ink:hover:not(:disabled) { background: var(--color-graphite); }

.cd__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 999px;
  border: 1px solid var(--color-hairline);
  background: #fff;
  color: var(--color-ink);
  cursor: pointer;
}
.cd__icon-btn:hover { background: var(--color-surface); }

/* ── Topbar ──────────────────────────────────────────────────── */
.cd__topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.cd__topbar-left { display: flex; align-items: center; gap: 20px; min-width: 0; }
.cd__back { padding-left: 10px; }
.cd__crumb {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
  min-width: 0;
}
.cd__crumb-sep { color: var(--color-mute); }
.cd__crumb-current {
  color: var(--color-ink);
  text-transform: none;
  letter-spacing: normal;
  font-weight: 500;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cd__topbar-actions { display: flex; align-items: center; gap: 10px; }

/* ── Hero ────────────────────────────────────────────────────── */
.cd__hero { display: flex; flex-direction: column; gap: 20px; padding: 8px 0 0; }
.cd__hero-pills { display: flex; align-items: center; gap: 10px; }
.cd__hero-title {
  font-family: var(--font-display);
  font-size: 44px;
  font-weight: 600;
  color: var(--color-ink);
  letter-spacing: -0.025em;
  line-height: 1.05;
  margin: 0;
  max-width: 900px;
}
.cd__hero-meta {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-fog);
}
.cd__hero-meta strong { color: var(--color-ink); font-weight: 600; }
.cd__dot { color: var(--color-mute); }
.cd__author { display: inline-flex; align-items: center; gap: 8px; }
.cd__author-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: var(--color-ink);
  color: #fff;
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
}
.cd__author span:last-child { color: var(--color-ink); font-weight: 500; }

/* Chips */
.cd-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.cd-chip__check { font-size: 11px; }
.cd-chip--sent { background: #DCFCE7; color: #166534; }
.cd-chip--flavor { background: var(--color-ink); color: #fff; }
.cd-chip--batch {
  background: #fff;
  color: var(--color-ink);
  border: 1px solid var(--color-hairline);
  font-family: var(--font-mono);
  letter-spacing: 0.06em;
}
.cd-chip--clicked { background: #1E40AF; color: #fff; }
.cd-chip--opened { background: #F3EEFF; color: #5B21B6; }
.cd-chip--delivered { background: #DCFCE7; color: #166534; }
.cd-chip--bounced { background: #FEE2E2; color: #DC2F3B; }
.cd-chip--unsubscribed, .cd-chip--complained, .cd-chip--suppressed {
  background: var(--color-surface);
  color: var(--color-mute);
  border: 1px solid var(--color-hairline);
}
.cd-chip--archived {
  background: #FEF3C7;
  color: #92400E;
}

/* ── Funnel strip ────────────────────────────────────────────── */
.cd__funnel {
  display: grid;
  grid-template-columns: 1fr 24px 1fr 24px 1fr 24px 1fr;
  gap: 12px;
  align-items: stretch;
  padding: 20px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 16px;
}
.cd-fnl { display: flex; flex-direction: column; gap: 6px; padding: 4px 8px; }
.cd-fnl__label {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 700;
  color: var(--color-fog);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.cd-fnl__value {
  font-family: var(--font-display);
  font-size: 36px;
  font-weight: 600;
  letter-spacing: -0.03em;
  color: var(--color-ink);
  line-height: 1;
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.cd-fnl__pct { font-family: var(--font-mono); font-size: 13px; color: var(--color-mute); font-weight: 400; letter-spacing: 0; }
.cd-fnl__sub {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--color-fog);
}
.cd-fnl__sub--eye { color: #5B21B6; }
.cd-fnl__arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
  color: var(--color-mute);
  font-size: 14px;
}

/* ── Body shell ──────────────────────────────────────────────── */
.cd__body { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
.cd__left { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.cd__rail { display: flex; flex-direction: column; gap: 16px; position: sticky; top: 20px; }

.cd-card {
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 16px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.cd-card--flush { padding: 0; }
.cd-card--rail { padding: 20px; gap: 14px; }
.cd-card__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}
.cd-card__head--pad { padding: 24px 24px 16px; margin: 0; }
.cd-card__title {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--color-ink);
  margin: 4px 0 0;
  line-height: 1.1;
}
.cd-card__sub { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }

/* ── Stacked outcomes bar ────────────────────────────────────── */
.cd-stack {
  display: flex;
  height: 14px;
  border-radius: 999px;
  overflow: hidden;
  border: 1px solid var(--color-hairline);
}
.cd-stack__seg { height: 100%; }
.cd-stack__seg--opened { background: #1E40AF; }
.cd-stack__seg--delivered { background: #86EFAC; }
.cd-stack__seg--bounced { background: #FEE2E2; }
.cd-stack__seg--unsub { background: var(--color-mute); }
.cd-stack__seg--suppressed { background: var(--color-surface); }

.cd-legend { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; }
.cd-legend__cell { display: flex; flex-direction: column; gap: 4px; }
.cd-legend__label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-ink);
}
.cd-legend__value {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--color-ink);
}
.cd-legend__sub { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); }
.cd-dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; }
.cd-dot--opened { background: #1E40AF; }
.cd-dot--delivered { background: #86EFAC; }
.cd-dot--bounced { background: #DC2F3B; }
.cd-dot--unsub { background: var(--color-mute); }
.cd-dot--suppressed { background: var(--color-surface); border: 1px solid var(--color-hairline); }

/* ── Links card ──────────────────────────────────────────────── */
.cd-links { display: flex; flex-direction: column; gap: 0; border-top: 1px solid var(--color-hairline); }
.cd-links__row {
  display: grid;
  grid-template-columns: 1fr 90px 70px 70px;
  gap: 16px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--color-hairline);
}
.cd-links__row:last-child { border-bottom: 0; }
.cd-links__url {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cd-links__count { font-family: var(--font-mono); font-size: 12px; font-weight: 600; color: var(--color-ink); text-align: right; }
.cd-links__pct { font-family: var(--font-mono); font-size: 12px; color: var(--color-fog); text-align: right; }
.cd-links__bar { height: 4px; border-radius: 999px; background: var(--color-surface); overflow: hidden; }
.cd-links__fill { height: 100%; background: #1E40AF; border-radius: 999px; }
.cd-links-empty {
  padding: 24px 0 8px;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
  border-top: 1px solid var(--color-hairline);
}

/* ── Recipients ──────────────────────────────────────────────── */
.cd-search {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--color-hairline);
  background: #fff;
  min-width: 280px;
  color: var(--color-mute);
}
.cd-search input {
  border: 0;
  background: transparent;
  outline: none;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-ink);
  flex: 1;
  min-width: 0;
}
.cd-search input::placeholder { color: var(--color-mute); }

.cd-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 0 24px 16px;
}
.cd-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  background: #fff;
  color: var(--color-ink);
  border: 1px solid var(--color-hairline);
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.cd-pill:hover:not(.cd-pill--active) { background: var(--color-surface); }
.cd-pill--active { background: var(--color-ink); color: #fff; font-weight: 600; border-color: var(--color-ink); }
.cd-pill span { font-family: var(--font-mono); font-size: 10px; color: var(--color-fog); }
.cd-pill--active span { color: rgba(255,255,255,0.6); }

.cd-tbl__head {
  display: grid;
  grid-template-columns: 36px 1fr 100px 100px 100px 100px;
  gap: 14px;
  padding: 12px 24px;
  background: var(--color-surface);
  border-top: 1px solid var(--color-hairline);
  border-bottom: 1px solid var(--color-hairline);
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.cd-tbl__right { text-align: right; }
.cd-tbl__body { display: flex; flex-direction: column; }
.cd-tbl__row {
  display: grid;
  grid-template-columns: 36px 1fr 100px 100px 100px 100px;
  gap: 14px;
  padding: 14px 24px;
  align-items: center;
  border-bottom: 1px solid var(--color-hairline);
}
.cd-tbl__row:last-child { border-bottom: 0; }
.cd-tbl__avatar {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  color: var(--color-ink);
  background: var(--color-surface);
  border: 1px solid var(--color-hairline);
}
.cd-tbl__avatar--violet { background: #1E40AF; color: #fff; border-color: #1E40AF; }
.cd-tbl__avatar--ink { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.cd-tbl__avatar--graphite { background: var(--color-graphite); color: #fff; border-color: var(--color-graphite); }
.cd-tbl__person { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.cd-tbl__name { font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-ink); }
.cd-tbl__email { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cd-tbl__email-bad { color: #DC2F3B; }
.cd-tbl__email-mute { color: var(--color-mute); }
.cd-tbl__ts { font-size: 11px; color: var(--color-ink); }
.cd-tbl__ts--mute { color: var(--color-mute); }
.cd-tbl__ts-sub { color: var(--color-fog); }
.cd-tbl__empty { padding: 32px 24px; text-align: center; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); }

.cd-tbl__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 24px;
  background: var(--color-surface);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-fog);
}
.cd-tbl__pager { display: flex; align-items: center; gap: 8px; }

/* ── Rail cards ──────────────────────────────────────────────── */
.cd-rail__head { display: flex; align-items: center; justify-content: space-between; }
.cd-rail__view { height: 26px; padding: 0 10px; font-size: 11px; }

.cd-mail {
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
}
.cd-mail__meta { padding: 14px 16px; border-bottom: 1px solid var(--color-hairline); display: flex; flex-direction: column; gap: 4px; }
.cd-mail__from { font-family: var(--font-body); font-size: 12px; color: var(--color-ink); word-break: break-all; }
.cd-mail__spacer { margin-top: 6px; }
.cd-mail__subject { font-family: var(--font-display); font-size: 14px; font-weight: 600; color: var(--color-ink); line-height: 1.3; }
.cd-mail__body { padding: 16px; background: var(--color-surface); display: flex; flex-direction: column; gap: 12px; }
.cd-mail__hero {
  height: 120px;
  border-radius: 8px;
  background: linear-gradient(135deg, #1E40AF 0%, #5B21B6 100%);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.cd-mail__line { font-family: var(--font-body); font-size: 11px; color: var(--color-ink); line-height: 1.5; margin: 0; }
.cd-mail__cta {
  align-self: flex-start;
  height: 28px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--color-ink);
  color: #fff;
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
}

.cd-glance { display: flex; flex-direction: column; }
.cd-glance__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-hairline);
}
.cd-glance__row--last { border-bottom: 0; }
.cd-glance__key { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.cd-glance__val { font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-ink); }
.cd-glance__val.mono { font-family: var(--font-mono); }

.cd-rail__btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 14px;
  border-radius: 999px;
  background: #fff;
  color: var(--color-ink);
  border: 1px solid var(--color-hairline);
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.cd-rail__btn:hover:not(:disabled) { background: var(--color-surface); }
.cd-rail__btn:disabled { opacity: 0.45; cursor: not-allowed; }
.cd-rail__btn--ink { background: var(--color-ink); color: #fff; border-color: var(--color-ink); font-weight: 600; }
.cd-rail__btn--ink:hover:not(:disabled) { background: var(--color-graphite); }
.cd-rail__btn--ink:disabled { background: var(--color-mute); border-color: var(--color-mute); opacity: 1; }
.cd-rail__btn-arrow { font-family: var(--font-mono); font-size: 11px; opacity: 0.6; }
.cd-rail__btn--ink .cd-rail__btn-arrow { opacity: 0.8; }

/* Danger zone */
.cd-card--danger { border-color: #FEE2E2; }
.cd-danger__text { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); line-height: 1.5; margin: 0; }
.cd-danger__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  background: #fff;
  color: #DC2F3B;
  border: 1px solid #FEE2E2;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.cd-danger__btn:hover:not(:disabled) { background: #FEE2E2; }
.cd-danger__btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* Modal copy */
.cd-modal__text { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); line-height: 1.5; margin: 0 0 8px; }
.cd-modal__err { font-family: var(--font-body); font-size: 12px; color: #DC2F3B; margin: 8px 0 0; }

/* ── Empty ───────────────────────────────────────────────────── */
.cd__empty {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
  padding: 24px 0;
}
.cd__empty h1 { font-family: var(--font-display); font-size: 32px; color: var(--color-ink); margin: 0; }
.cd__empty p { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); }
.cd__empty code { font-family: var(--font-mono); font-size: 13px; padding: 2px 6px; background: var(--color-surface); border-radius: 4px; }

/* ── Responsive ──────────────────────────────────────────────── */
@media (max-width: 1180px) {
  .cd__body { grid-template-columns: 1fr; }
  .cd__rail { position: static; }
  .cd__funnel { grid-template-columns: repeat(2, 1fr); grid-template-rows: auto auto; }
  .cd__funnel .cd-fnl__arrow { display: none; }
  .cd-legend { grid-template-columns: repeat(2, 1fr); }
}

/* Phone */
@media (max-width: 720px) {
  .cd { gap: 16px; }

  /* Topbar — collapse to just the back pill + an actions row below */
  .cd__topbar { flex-wrap: wrap; gap: 10px; }
  .cd__topbar-left { gap: 10px; width: 100%; }
  .cd__crumb { display: none; }
  .cd__topbar-actions { width: 100%; justify-content: flex-end; }
  .cd__topbar-actions .pill-btn { padding: 0 12px; }

  /* Hero */
  .cd__hero { gap: 14px; }
  .cd__hero-pills { flex-wrap: wrap; gap: 6px; }
  .cd__hero-title { font-size: 28px; letter-spacing: -0.02em; }
  .cd__hero-meta { font-size: 12px; gap: 8px; }
  .cd__hero-meta .cd__dot { display: none; }
  .cd__hero-meta > * { padding-right: 10px; border-right: 1px solid var(--color-hairline); }
  .cd__hero-meta > *:last-child { border-right: 0; padding-right: 0; }

  /* Funnel strip — stack 1×4 */
  .cd__funnel {
    grid-template-columns: 1fr;
    padding: 14px;
    gap: 10px;
  }
  .cd-fnl { padding: 10px 4px; border-top: 1px solid var(--color-hairline); }
  .cd-fnl:first-child { border-top: 0; padding-top: 0; }
  .cd-fnl__value { font-size: 28px; }

  /* Cards — tighter padding */
  .cd-card { padding: 18px 16px; gap: 14px; }
  .cd-card__title { font-size: 18px; }

  /* Delivery outcomes legend — 1 col */
  .cd-legend { grid-template-columns: 1fr; gap: 10px; }
  .cd-legend__cell {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 10px;
    align-items: baseline;
    padding: 8px 0;
    border-bottom: 1px solid var(--color-hairline);
  }
  .cd-legend__cell:last-child { border-bottom: 0; }
  .cd-legend__value { font-size: 18px; }

  /* Links card — collapse to 2 columns (url · clicks/pct stacked) */
  .cd-links__row {
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
    row-gap: 6px;
    column-gap: 10px;
    padding: 10px 0;
  }
  .cd-links__url { grid-column: 1 / 2; }
  .cd-links__count { grid-column: 2 / 3; grid-row: 1 / 2; }
  .cd-links__pct { grid-column: 2 / 3; grid-row: 2 / 3; }
  .cd-links__bar { grid-column: 1 / 3; grid-row: 2 / 3; }

  /* Recipients card — stack into row cards, hide the table head */
  .cd-card--flush { padding: 0; }
  .cd-card__head--pad { flex-direction: column; align-items: stretch; gap: 12px; padding: 18px 16px 12px; }
  .cd-search { min-width: 0; width: 100%; }

  .cd-filters {
    padding: 0 16px 14px;
    overflow-x: auto;
    flex-wrap: nowrap;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .cd-filters::-webkit-scrollbar { display: none; }
  .cd-pill { flex-shrink: 0; }

  .cd-tbl__head { display: none; }
  /* Mobile recipient row:
       Row 1: [avatar abs-pos] [name/email] [status chip]
       Row 2: [DELIVERED]  [OPENED]  [CLICKED]  — 3 equal columns
     Avatar is absolute-positioned so the person cell can span the first
     two of three equal grid columns without conflicting with it. */
  .cd-tbl__row {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    grid-template-rows: auto auto;
    row-gap: 12px;
    column-gap: 10px;
    padding: 14px 16px 14px 52px;    /* left padding leaves room for abs avatar */
    align-items: start;
  }
  .cd-tbl__avatar {
    position: absolute;
    top: 14px;
    left: 16px;
  }
  .cd-tbl__person {
    grid-column: 1 / 3;
    grid-row: 1;
    min-width: 0;
  }
  .cd-tbl__row > .cd-tbl__right:not(.cd-tbl__ts) {
    grid-column: 3;
    grid-row: 1;
    text-align: right;
  }
  .cd-tbl__row > .cd-tbl__ts {
    grid-row: 2;
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
    font-size: 11px;
    min-width: 0;
    padding-top: 10px;
    border-top: 1px solid var(--color-hairline);
  }
  .cd-tbl__row > .cd-tbl__ts:nth-child(4) { grid-column: 1; }
  .cd-tbl__row > .cd-tbl__ts:nth-child(5) { grid-column: 2; }
  .cd-tbl__row > .cd-tbl__ts:nth-child(6) { grid-column: 3; }
  /* The border-top should only appear on the first ts cell so it reads as
     a single rule separating rows 1 and 2 — but keeping it on all three
     also looks fine as a 3-segment divider. Trim the duplicate: */
  .cd-tbl__row > .cd-tbl__ts:nth-child(n+5) { border-top-color: transparent; }
  .cd-tbl__row > .cd-tbl__ts::before {
    content: attr(data-label);
    font-family: var(--font-body);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-fog);
  }
  .cd-tbl__ts-sub { font-size: 10px; color: var(--color-fog); }

  .cd-tbl__foot { padding: 12px 16px; flex-direction: column; gap: 10px; align-items: stretch; }
  .cd-tbl__pager { justify-content: space-between; }
  .cd-tbl__pager .pill-btn { flex: 1; justify-content: center; }

  /* Email preview */
  .cd-card--rail { padding: 16px; }
  .cd-mail__hero { height: 90px; font-size: 15px; }
}
</style>
