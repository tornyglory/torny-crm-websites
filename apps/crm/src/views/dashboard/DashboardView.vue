<script setup lang="ts">
/**
 * Dashboard — wired to real data from every endpoint we have.
 *
 * KPIs read from members / applications / enquiries / honour-board.
 * Upcoming events pulls a 30-day window from events.list().
 * Attention strip derives from the same counts.
 * Recent activity is the notifications feed (brief 40).
 *
 * Team selections have no backend yet — the section renders a
 * "coming soon" state instead of the old mock.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useClubStore } from '@/stores/club'
import { useNotificationsStore } from '@/stores/notifications'
import { useHonourCategoriesStore } from '@/stores/honourCategories'
import {
  members as membersApi,
  applications as applicationsApi,
  enquiries as enquiriesApi,
  events as eventsApi,
  type Event as CrmEvent,
  type ApplicationRow,
  type NotificationKind,
  type Notification,
} from '@torny/api-client'

const auth = useAuthStore()
const clubStore = useClubStore()
const notificationsStore = useNotificationsStore()
const honourCategoriesStore = useHonourCategoriesStore()

const now = new Date()
const greeting = computed(() => {
  const h = now.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
})
const dateLabel = computed(() => {
  const day = now.toLocaleDateString('en-NZ', { weekday: 'short' }).toUpperCase()
  const dm = now.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }).toUpperCase()
  const week = Math.ceil((((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000) + new Date(now.getFullYear(), 0, 1).getDay() + 1) / 7)
  return `${day} · ${dm} · Week ${week}`
})
const dateLabelMobile = computed(() => {
  const day = now.toLocaleDateString('en-NZ', { weekday: 'short' }).toUpperCase()
  const dm = now.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }).toUpperCase()
  return `${day} · ${dm}`
})

// ── Reactive data sources ─────────────────────────────────────
const memberCounts = ref({ total: 0, active: 0, pending: 0, lapsed: 0 })
const applicationCounts = ref({ pending: 0, approved: 0, rejected: 0 })
const enquiryCounts = ref({ new: 0, read: 0, replied: 0, archived: 0 })
const pendingApps = ref<ApplicationRow[]>([])
const upcomingRaw = ref<CrmEvent[]>([])
const loading = ref(true)

async function loadAll() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  loading.value = true
  try {
    // Fire everything in parallel — dashboard shouldn't wait on the slowest.
    const [roster, appsRes, enquiriesRes, pendingList, eventList] = await Promise.allSettled([
      membersApi.listRoster(cid, { limit: 1, include_invites: false }),
      applicationsApi.list(cid, { status: 'pending', limit: 1 }),
      enquiriesApi.list(cid, { status: 'new', limit: 1 }),
      applicationsApi.list(cid, { status: 'pending', limit: 5, sort: 'oldest' }),
      loadEvents(cid),
    ])
    if (roster.status === 'fulfilled') memberCounts.value = roster.value.counts
    if (appsRes.status === 'fulfilled') applicationCounts.value = appsRes.value.counts
    if (enquiriesRes.status === 'fulfilled') enquiryCounts.value = enquiriesRes.value.counts
    if (pendingList.status === 'fulfilled') pendingApps.value = pendingList.value.applications
    if (eventList.status === 'fulfilled') upcomingRaw.value = eventList.value
    // Notifications + honour categories are already fetched by the shell —
    // just make sure they've loaded at least once.
    if (!notificationsStore.loadedClubId) void notificationsStore.fetchList(cid).catch(() => {})
    if (honourCategoriesStore.loadedClubId !== cid) void honourCategoriesStore.fetch(cid).catch(() => {})
  } finally {
    loading.value = false
  }
}

async function loadEvents(clubId: number): Promise<CrmEvent[]> {
  const from = new Date().toISOString().slice(0, 10)
  const to = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
  const list = await eventsApi.list(clubId, { from, to })
  return list.filter((e) => new Date(e.start_datetime).getTime() >= Date.now())
}

onMounted(loadAll)
watch(() => clubStore.current?.id, loadAll)

// ── KPI cards ─────────────────────────────────────────────────
interface KpiCard {
  label: string
  value: string
  meta: string
  metaTone: 'good' | 'warn' | 'neutral'
  footer: string
  footerTone?: 'danger' | 'muted'
  ctaHref: string
  icon: 'members' | 'applications' | 'enquiries' | 'honour'
  iconBg: string
  iconColor: string
}

const kpis = computed<KpiCard[]>(() => {
  const { total, active, pending: pendingMembers } = memberCounts.value
  const { pending: pendingApps } = applicationCounts.value
  const { new: newEnq } = enquiryCounts.value
  const cats = honourCategoriesStore.count

  return [
    {
      label: 'Membership',
      value: total > 0 ? String(total) : '—',
      meta: pendingMembers > 0 ? `${pendingMembers} pending` : 'all active',
      metaTone: pendingMembers > 0 ? 'warn' : 'good',
      footer: total > 0 ? `${active} active · ${pendingMembers} pending` : 'No members yet',
      ctaHref: '/crm/members',
      icon: 'members',
      iconBg: '#DCFCE7',
      iconColor: 'var(--color-feature-mint)',
    },
    {
      label: 'Applications',
      value: String(pendingApps),
      meta: pendingApps > 0 ? 'need review' : 'inbox zero',
      metaTone: pendingApps > 0 ? 'warn' : 'good',
      footer: pendingApps > 0
        ? oldestPendingLabel()
        : 'Nothing waiting',
      footerTone: pendingApps > 0 ? 'danger' : undefined,
      ctaHref: '/crm/applications',
      icon: 'applications',
      iconBg: 'var(--color-accent-soft)',
      iconColor: 'var(--color-accent)',
    },
    {
      label: 'Enquiries',
      value: String(newEnq),
      meta: newEnq > 0 ? 'awaiting reply' : 'inbox zero',
      metaTone: newEnq > 0 ? 'warn' : 'good',
      footer: newEnq > 0 ? 'New messages from the site' : 'All caught up',
      ctaHref: '/crm/enquiries',
      icon: 'enquiries',
      iconBg: '#FFF1E7',
      iconColor: 'var(--color-feature-tangerine)',
    },
    {
      label: 'Honour board',
      value: cats > 0 ? String(cats) : '—',
      meta: cats > 0 ? 'categories' : 'not set up',
      metaTone: cats > 0 ? 'good' : 'neutral',
      footer: cats > 0 ? 'Trophies + rolls of honour' : 'Add your first category',
      ctaHref: '/crm/honour-board',
      icon: 'honour',
      iconBg: '#EDE9FE',
      iconColor: 'var(--color-feature-violet)',
    },
  ]
})

function oldestPendingLabel(): string {
  const oldest = pendingApps.value[0]
  if (!oldest) return 'Waiting'
  const days = Math.floor((Date.now() - new Date(oldest.received_at).getTime()) / 86_400_000)
  const name = oldest.preferred_name ?? oldest.full_name.split(' ')[0]!
  if (days === 0) return `${name} applied today`
  if (days === 1) return `${name} waiting 1 day`
  return `${name} waiting ${days} days`
}

// ── Attention chips — derived signals ─────────────────────────
interface AttentionItem {
  id: string
  label: string
  detail: string
  href: string
  tone: 'danger' | 'warn' | 'accent'
}

const attentionItems = computed<AttentionItem[]>(() => {
  const items: AttentionItem[] = []
  const urgentApps = pendingApps.value.filter((a) => {
    const days = Math.floor((Date.now() - new Date(a.received_at).getTime()) / 86_400_000)
    return days >= 5
  }).length
  if (urgentApps > 0) {
    items.push({
      id: 'apps-urgent',
      label: `${urgentApps} application${urgentApps === 1 ? '' : 's'}`,
      detail: 'waiting > 5 days',
      href: '/crm/applications',
      tone: 'danger',
    })
  }
  if (enquiryCounts.value.new > 0) {
    items.push({
      id: 'enq-new',
      label: `${enquiryCounts.value.new} new enquir${enquiryCounts.value.new === 1 ? 'y' : 'ies'}`,
      detail: 'awaiting first reply',
      href: '/crm/enquiries',
      tone: 'warn',
    })
  }
  const draftEvents = upcomingRaw.value.filter((e) => e.is_published === 0).length
  if (draftEvents > 0) {
    items.push({
      id: 'events-draft',
      label: `${draftEvents} draft event${draftEvents === 1 ? '' : 's'}`,
      detail: 'not published yet',
      href: '/crm/events',
      tone: 'accent',
    })
  }
  return items
})

const attentionSummary = computed(() => {
  const parts: string[] = []
  if (applicationCounts.value.pending > 0) parts.push(`${applicationCounts.value.pending} application${applicationCounts.value.pending === 1 ? '' : 's'}`)
  if (enquiryCounts.value.new > 0) parts.push(`${enquiryCounts.value.new} enquir${enquiryCounts.value.new === 1 ? 'y' : 'ies'}`)
  if (parts.length === 0) return "You're all caught up today."
  return `${parts.join(' and ')} need${parts.length === 1 && !parts[0]!.endsWith('s') ? 's' : ''} your attention today.`
})

// ── Upcoming events formatting ───────────────────────────────
interface UpcomingEvent {
  id: number
  weekday: string
  day: number
  title: string
  time: string
  location: string
  status: 'published' | 'draft'
}

const upcomingEvents = computed<UpcomingEvent[]>(() =>
  upcomingRaw.value.slice(0, 5).map((e) => {
    const start = new Date(e.start_datetime)
    return {
      id: e.event_id,
      weekday: start.toLocaleDateString('en-NZ', { weekday: 'short' }),
      day: start.getDate(),
      title: e.title,
      time: e.all_day === 1 ? 'All day' : start.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' }),
      location: e.location ?? '—',
      status: e.is_published === 1 ? 'published' : 'draft',
    }
  }),
)

// ── Recent activity — feeds from notifications ────────────────
type SignalIcon = 'application' | 'enquiry' | 'rsvp' | 'team' | 'publish' | 'payment' | 'milestone'
interface Signal {
  id: number
  icon: SignalIcon
  title: string
  meta: string
  titleMobile: string
  time: string
  href?: string
}

/** Map brief 40 notification kinds to the dashboard's icon set (unified). */
function iconFor(kind: NotificationKind): SignalIcon {
  return kind === 'member_milestone' ? 'milestone' : kind
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  const wk = Math.floor(day / 7)
  return `${wk}w`
}

const signals = computed<Signal[]>(() => {
  const notifs = notificationsStore.rows.slice(0, 6)
  return notifs.map((n: Notification) => ({
    id: n.id,
    icon: iconFor(n.kind),
    title: n.title,
    meta: n.body ?? '',
    titleMobile: n.title,
    time: timeAgo(n.created_at),
    href: n.target?.destination_href,
  }))
})

const iconTone: Record<SignalIcon, { bg: string; fg: string }> = {
  application: { bg: 'var(--color-accent-soft)', fg: 'var(--color-accent)' },
  enquiry: { bg: '#FFF1E7', fg: 'var(--color-feature-tangerine)' },
  rsvp: { bg: '#DCFCE7', fg: 'var(--color-feature-mint)' },
  team: { bg: 'var(--color-accent-soft)', fg: 'var(--color-accent)' },
  publish: { bg: '#EDE9FE', fg: 'var(--color-feature-violet)' },
  payment: { bg: '#DCFCE7', fg: 'var(--color-feature-mint)' },
  milestone: { bg: 'var(--color-surface)', fg: 'var(--color-graphite)' },
}
</script>

<template>
  <div class="dash">
    <!-- Header -->
    <header class="dash__header">
      <div>
        <div class="dash__eyebrow dash__eyebrow--desktop">{{ dateLabel }}</div>
        <div class="dash__eyebrow dash__eyebrow--mobile">{{ dateLabelMobile }}</div>
        <h1 class="dash__heading">
          <span class="dash__heading--desktop">{{ greeting }}, {{ auth.user?.firstName ?? 'friend' }}.</span>
          <span class="dash__heading--mobile">{{ greeting }}.</span>
        </h1>
        <p class="dash__sub">{{ attentionSummary }}</p>
      </div>
      <div class="dash__actions">
        <button class="btn btn--ghost">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
            <path d="M7 17 17 7" /><path d="M7 7h10v10" />
          </svg>
          Preview site
        </button>
        <button class="btn btn--primary">+ Send bulk email</button>
      </div>
    </header>

    <!-- Attention strip -->
    <section v-if="attentionItems.length" class="attention">
      <div class="attention__label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
          <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />
        </svg>
        Needs attention
      </div>
      <div class="attention__chips">
        <RouterLink v-for="a in attentionItems" :key="a.id" :to="a.href" class="attention-chip" :class="`attention-chip--${a.tone}`">
          <span class="attention-chip__label">{{ a.label }}</span>
          <span class="attention-chip__detail">{{ a.detail }}</span>
        </RouterLink>
      </div>
    </section>

    <!-- KPI cards -->
    <section class="kpis">
      <RouterLink v-for="k in kpis" :key="k.label" :to="k.ctaHref" class="kpi">
        <div class="kpi__icon" :style="{ background: k.iconBg, color: k.iconColor }">
          <svg v-if="k.icon === 'members'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
            <circle cx="9" cy="8" r="4" /><path d="M17 11a3 3 0 1 0 0-6" /><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
          </svg>
          <svg v-else-if="k.icon === 'applications'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
          </svg>
          <svg v-else-if="k.icon === 'enquiries'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
            <path d="M6 4h12v3a6 6 0 0 1-12 0V4z" /><path d="M2 4h2v3a4 4 0 0 0 4 4M22 4h-2v3a4 4 0 0 1-4 4M12 15v4M8 19h8" />
          </svg>
        </div>
        <div class="kpi__body">
          <div class="kpi__label">{{ k.label }}</div>
          <div class="kpi__value-row">
            <div class="kpi__value">{{ k.value }}</div>
            <span class="kpi__meta" :class="`kpi__meta--${k.metaTone}`">{{ k.meta }}</span>
          </div>
          <div class="kpi__footer" :class="{ 'kpi__footer--danger': k.footerTone === 'danger' }">{{ k.footer }}</div>
        </div>
        <div class="kpi__chev">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </div>
      </RouterLink>
    </section>

    <!-- Upcoming events -->
    <section class="upcoming">
      <div class="upcoming__head">
        <div>
          <div class="section__eyebrow">Upcoming events</div>
          <h2 class="section__heading section__heading--desktop">Next {{ upcomingEvents.length }} · 30 days</h2>
        </div>
        <RouterLink to="/crm/events" class="section__link section__link--desktop">
          Open calendar
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
        </RouterLink>
        <div class="section__meta section__meta--mobile">{{ upcomingEvents.length }} events</div>
      </div>
      <div v-if="upcomingEvents.length === 0" class="empty">
        <div class="empty__title">Nothing on the calendar</div>
        <div class="empty__hint">Add an event from the Events tab to get things moving.</div>
      </div>
      <ul v-else class="events">
        <li v-for="e in upcomingEvents" :key="e.id" class="event">
          <div class="event__date">
            <div class="event__weekday">{{ e.weekday }}</div>
            <div class="event__day">{{ e.day }}</div>
          </div>
          <div class="event__body">
            <div class="event__title">{{ e.title }}</div>
            <div class="event__meta">{{ e.time }} · {{ e.location }}</div>
          </div>
          <span class="event__pill event__pill--desktop" :class="`event__pill--${e.status}`">{{ e.status }}</span>
          <span class="event__dot event__dot--mobile" :class="`event__dot--${e.status}`" />
        </li>
      </ul>
    </section>

    <!-- Latest team selection — placeholder until the endpoint ships -->
    <section class="team-card team-card--empty">
      <div class="team-card__head">
        <div>
          <div class="section__eyebrow">Team selection</div>
          <h2 class="section__heading">Coming soon</h2>
          <p class="team-card__meta">The team-selection backend is next — this card will show the most recent published selection with the four positions.</p>
        </div>
        <RouterLink to="/crm/teams" class="section__link">
          Open teams
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
        </RouterLink>
      </div>
    </section>

    <!-- Recent activity -->
    <section class="activity">
      <div class="activity__head">
        <div>
          <div class="section__eyebrow">Recent activity</div>
          <h2 class="section__heading section__heading--desktop">Last 5 signals</h2>
        </div>
        <RouterLink to="/crm/communications" class="section__link section__link--desktop">
          View all
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
        </RouterLink>
        <div class="section__meta section__meta--mobile">Last 5</div>
      </div>
      <div v-if="signals.length === 0" class="empty">
        <div class="empty__title">Nothing to show yet</div>
        <div class="empty__hint">Activity appears here as members apply, RSVP, and enquire.</div>
      </div>
      <ul v-else class="signals">
        <component
          :is="s.href ? 'RouterLink' : 'li'"
          v-for="s in signals"
          :key="s.id"
          :to="s.href"
          class="signal"
        >
          <div class="signal__icon" :style="{ background: iconTone[s.icon].bg, color: iconTone[s.icon].fg }">
            <svg v-if="s.icon === 'application'" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="8" cy="6" r="3" /><path d="M2.5 17c0-3 2.5-5 5.5-5s5.5 2 5.5 5" /><path d="M15 8v4M13 10h4" />
            </svg>
            <svg v-else-if="s.icon === 'enquiry'" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 4.5C3 3.7 3.7 3 4.5 3h11c.8 0 1.5.7 1.5 1.5v8c0 .8-.7 1.5-1.5 1.5H8L4 17v-2.5C3.4 14.5 3 14 3 13.5v-9z" />
            </svg>
            <svg v-else-if="s.icon === 'rsvp'" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="5" width="14" height="12" rx="1.5" /><path d="M3 8h14M7 3v4M13 3v4" /><path d="M7 12.5l2 2 4-4" />
            </svg>
            <svg v-else-if="s.icon === 'team'" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="7" cy="7" r="2.5" /><circle cx="13.5" cy="8.5" r="2" /><path d="M2.5 16c0-2.2 2-4 4.5-4s4.5 1.8 4.5 4" /><path d="M12 15.5c0-1.6 1.2-3 2.8-3.4" />
            </svg>
            <svg v-else-if="s.icon === 'publish'" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2c-4 0-8 4-8 8l4 4c4 0 8-4 8-8l-4-4z" /><circle cx="12" cy="8" r="1.5" /><path d="M6 14l-2 4 4-2M6 10l-2 2M10 14l-2 2" />
            </svg>
            <svg v-else-if="s.icon === 'payment'" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2.5" y="5" width="15" height="10" rx="1.5" /><path d="M2.5 9h15M6 13h3" />
            </svg>
            <svg v-else viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 4h8v3a4 4 0 0 1-8 0V4z" /><path d="M4 4H2v2a2 2 0 0 0 2 2M16 4h2v2a2 2 0 0 1-2 2M10 11v4M7 15h6" />
            </svg>
          </div>
          <div class="signal__body">
            <div class="signal__title signal__title--desktop">{{ s.title }}</div>
            <div class="signal__title signal__title--mobile">{{ s.titleMobile }}</div>
            <div v-if="s.meta" class="signal__meta signal__meta--desktop">{{ s.meta }}</div>
          </div>
          <div class="signal__time">{{ s.time }}</div>
        </component>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.dash { max-width: 1200px; display: flex; flex-direction: column; gap: 24px; }

/* ==================== Header ==================== */
.dash__header { display: flex; justify-content: space-between; align-items: end; gap: 20px; }
.dash__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.18em; color: var(--color-fog); text-transform: uppercase; }
.dash__heading { font-family: var(--font-display); font-size: clamp(30px, 3.4vw, 40px); font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 8px; color: var(--color-ink); line-height: 1.05; }
.dash__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin: 0; }
.dash__actions { display: flex; gap: 8px; flex-shrink: 0; }
.dash__eyebrow--mobile, .dash__heading--mobile, .dash__sub--mobile { display: none; }

.btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 14px; border: none; border-radius: 10px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; }
.btn--primary { background: var(--color-accent); color: #fff; }
.btn--ghost { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }

@media (max-width: 1100px) and (min-width: 768px) {
  .kpis { grid-template-columns: repeat(2, 1fr); }
}

/* ==================== Attention strip ==================== */
.attention { display: flex; align-items: center; gap: 16px; padding: 12px 16px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; }
.attention__label { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-fog); flex-shrink: 0; }
.attention__chips { display: flex; gap: 8px; flex-wrap: wrap; }
.attention-chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; text-decoration: none; font-family: var(--font-body); font-size: 12px; transition: transform 0.12s ease; border: 1px solid transparent; }
.attention-chip:hover { transform: translateY(-1px); }
.attention-chip--danger { background: #FEE2E2; color: #991B1B; border-color: #FECACA; }
.attention-chip--warn   { background: #FEF3C7; color: #92400E; border-color: #FDE68A; }
.attention-chip--accent { background: var(--color-accent-soft); color: var(--color-accent); border-color: #BFDBFE; }
.attention-chip__label  { font-weight: 700; }
.attention-chip__detail { font-weight: 500; opacity: 0.9; }

/* ==================== KPI cards ==================== */
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.kpi {
  display: flex; align-items: center; gap: 16px;
  padding: 16px 20px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 16px;
  text-decoration: none;
  color: var(--color-ink);
  transition: border-color 100ms;
}
.kpi:hover { border-color: var(--color-accent); }
.kpi__icon {
  width: 44px; height: 44px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.kpi__body { flex: 1; min-width: 0; }
.kpi__label { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.16em; color: var(--color-graphite); text-transform: uppercase; }
.kpi__value-row { display: flex; align-items: baseline; gap: 10px; margin: 6px 0 4px; }
.kpi__value { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.03em; color: var(--color-ink); line-height: 1; }
.kpi__meta { font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); }
.kpi__meta--good { color: var(--color-feature-mint); font-weight: 600; }
.kpi__meta--warn { color: var(--color-fog); }
.kpi__footer { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.kpi__footer--danger { color: var(--color-feature-tangerine); font-weight: 600; }
.kpi__chev { color: var(--color-mute); flex-shrink: 0; }

/* ==================== Section head shared ==================== */
.section__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.section__heading { font-family: var(--font-display); font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: 4px 0 0; }
.section__link { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-body); font-size: 12px; font-weight: 600; color: var(--color-ink); text-decoration: none; flex-shrink: 0; }
.section__meta { font-family: var(--font-body); font-size: 12px; font-weight: 600; letter-spacing: 0.12em; color: var(--color-fog); text-transform: uppercase; }
.section__meta--mobile, .section__heading--mobile { display: none; }

/* ==================== Upcoming events ==================== */
.upcoming { }
.upcoming__head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; gap: 12px; }
.events { list-style: none; padding: 0; margin: 0; }
.event { display: flex; align-items: center; gap: 16px; padding: 14px 4px; border-bottom: 1px solid var(--color-hairline); }
.event:last-child { border-bottom: none; }
.event__date {
  width: 44px; height: 44px;
  border-radius: 10px;
  background: transparent;
  border: 1px solid var(--color-hairline);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.event__weekday { font-family: var(--font-body); font-size: 9px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.event__day { font-family: var(--font-display); font-size: 18px; font-weight: 700; line-height: 1; color: var(--color-ink); }
.event__body { flex: 1; min-width: 0; }
.event__title { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--color-ink); }
.event__meta { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; }
.event__pill { padding: 3px 9px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; flex-shrink: 0; }
.event__pill--published { background: #DCFCE7; color: #14532D; }
.event__pill--draft { background: var(--color-surface); color: var(--color-fog); border: 1px solid var(--color-hairline); }
.event__dot { width: 10px; height: 10px; border-radius: 999px; flex-shrink: 0; }
.event__dot--published { background: var(--color-feature-mint); }
.event__dot--draft { background: transparent; border: 1.5px solid var(--color-hairline); }
.event__dot--mobile { display: none; }

/* ==================== Empty state ==================== */
.empty { padding: 40px 24px; text-align: center; background: #fff; border: 1px dashed var(--color-hairline); border-radius: 14px; font-family: var(--font-body); }
.empty__title { font-family: var(--font-display); font-size: 16px; font-weight: 700; color: var(--color-ink); }
.empty__hint { font-size: 13px; color: var(--color-fog); margin-top: 4px; }

/* ==================== Team card ==================== */
.team-card { background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; padding: 20px 24px; }
.team-card--empty { border-style: dashed; }
.team-card--empty .team-card__meta { max-width: 620px; margin-top: 8px; line-height: 1.5; }
.team-card__head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.team-card__meta { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 4px; }
.team-card__meta--mobile { display: none; }
.pill { padding: 3px 9px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; flex-shrink: 0; }
.pill--published { background: #DCFCE7; color: #14532D; }
.team { width: 100%; border-collapse: collapse; margin-top: 12px; }
.team th { text-align: left; padding: 8px 0; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.12em; color: var(--color-fog); text-transform: uppercase; border-bottom: 1px solid var(--color-hairline); }
.team td { padding: 10px 0; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); border-bottom: 1px solid var(--color-hairline); }
.team tbody tr:last-child td { border-bottom: none; }
.team__pos { font-family: var(--font-body); font-weight: 600; color: var(--color-graphite); width: 80px; }
.team-card__inline { display: none; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: var(--color-surface); border-radius: 12px; padding: 12px 14px; line-height: 1.5; margin-top: 12px; }
.team-card__foot { display: flex; justify-content: space-between; align-items: center; padding-top: 12px; border-top: 1px solid var(--color-hairline); margin-top: 12px; }
.team-card__foot-meta { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }

/* ==================== Activity ==================== */
.activity__head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 12px; }
.signals { list-style: none; padding: 0; margin: 0; }
.signal { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--color-hairline); text-decoration: none; color: inherit; }
.signal[href] { cursor: pointer; }
.signal[href]:hover { background: var(--color-surface); }
.signal:last-child { border-bottom: none; }
.signal__icon { width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.signal__body { flex: 1; min-width: 0; }
.signal__title { font-family: var(--font-body); font-size: 14px; font-weight: 500; color: var(--color-ink); }
.signal__title--mobile { display: none; }
.signal__meta { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; }
.signal__time { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); font-weight: 500; flex-shrink: 0; }

/* ==================== Mobile ==================== */
@media (max-width: 767px) {
  .dash { gap: 20px; }

  .dash__header { flex-direction: column; align-items: stretch; gap: 4px; }
  .dash__actions { display: none; }
  .dash__eyebrow--desktop, .dash__heading--desktop, .dash__sub--desktop { display: none; }
  .dash__eyebrow--mobile, .dash__heading--mobile, .dash__sub--mobile { display: block; }
  .dash__heading { font-size: 38px; letter-spacing: -0.03em; margin: 4px 0 6px; }
  .dash__sub { font-size: 14px; color: var(--color-fog); }

  .attention { flex-direction: column; align-items: stretch; gap: 8px; }
  .attention__chips { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 2px; }
  .attention-chip { flex-shrink: 0; }
  .kpis { grid-template-columns: 1fr; gap: 10px; }
  .kpi { padding: 14px 16px; border-radius: 14px; }
  .kpi__icon { width: 40px; height: 40px; border-radius: 10px; }
  .kpi__value { font-size: 26px; }

  .section__heading--desktop { display: none; }
  .section__heading--mobile { display: block; }
  .section__meta--mobile { display: block; }
  .section__link--desktop { display: none; }

  .event { padding: 12px 0; gap: 14px; }
  .event__pill--desktop { display: none; }
  .event__dot--mobile { display: block; }

  .team-card { border-radius: 14px; padding: 16px 18px; }
  .team-card__meta--mobile { display: block; }
  .team--desktop { display: none; }
  .team-card__inline--mobile { display: block; }
  .team-card__foot--desktop { display: none; }

  .signal { padding: 10px 0; gap: 12px; }
  .signal__title--desktop { display: none; }
  .signal__title--mobile { display: block; }
  .signal__meta--desktop { display: none; }
}
</style>
