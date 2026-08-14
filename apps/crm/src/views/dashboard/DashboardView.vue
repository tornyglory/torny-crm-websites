<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

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

interface KpiCard {
  label: string
  value: string
  meta: string
  metaTone: 'good' | 'warn' | 'neutral'
  footer: string
  footerTone?: 'danger' | 'muted'
  ctaLabel: string
  ctaHref: string
  icon: 'members' | 'applications' | 'enquiries'
  accent: string
  iconBg: string
  iconColor: string
}

const kpis: KpiCard[] = [
  {
    label: 'Membership',
    value: '142',
    meta: '+4',
    metaTone: 'good',
    footer: '8 unpaid · $360 outstanding',
    footerTone: 'danger',
    ctaLabel: 'Chase',
    ctaHref: '/crm/members',
    icon: 'members',
    accent: 'var(--color-feature-mint)',
    iconBg: 'var(--color-accent-soft)',
    iconColor: 'var(--color-accent)',
  },
  {
    label: 'Applications',
    value: '3',
    meta: 'new to review',
    metaTone: 'warn',
    footer: 'Sarah Chen waiting 4 days',
    ctaLabel: 'Review',
    ctaHref: '/crm/applications',
    icon: 'applications',
    accent: 'var(--color-accent)',
    iconBg: 'var(--color-accent-soft)',
    iconColor: 'var(--color-accent)',
  },
  {
    label: 'Enquiries',
    value: '2',
    meta: 'green hire, function',
    metaTone: 'neutral',
    footer: 'Awaiting first reply',
    ctaLabel: 'Open',
    ctaHref: '/crm/enquiries',
    icon: 'enquiries',
    accent: 'var(--color-feature-tangerine)',
    iconBg: '#FFF1E7',
    iconColor: 'var(--color-feature-tangerine)',
  },
]

interface UpcomingEvent {
  id: string
  weekday: string
  day: number
  title: string
  time: string
  location: string
  status: 'published' | 'draft'
}

const upcomingEvents: UpcomingEvent[] = [
  { id: 'u1', weekday: 'Fri', day: 15, title: 'Twilight roll-up', time: '5:30 PM', location: 'Social', status: 'published' },
  { id: 'u2', weekday: 'Sat', day: 16, title: 'Club Championship — Rd 2', time: '1:00 PM', location: 'Petone BC', status: 'published' },
  { id: 'u3', weekday: 'Wed', day: 20, title: 'Pennant vs Miramar', time: '1:30 PM', location: 'Home', status: 'draft' },
  { id: 'u4', weekday: 'Thu', day: 21, title: 'Coaching clinic — beginners', time: '5:30 PM', location: 'Green 2', status: 'published' },
]

interface TeamRow { position: string; name: string }

const latestSelection = {
  title: 'Saturday Pennant',
  when: 'Sat 16 Aug',
  meta: 'Team A · Fours · Meet 12:15 PM',
  publishedAt: 'Thu 14 Aug · 2:10 PM',
  rowsDesktop: [
    { position: 'Skip', name: 'Karen Watson' },
    { position: 'Third', name: 'Nevaeh Rodda' },
    { position: 'Second', name: 'Sam Ah Wong' },
    { position: 'Lead', name: 'Jo Kirk' },
  ] as TeamRow[],
  inlineMobile: 'Skip · K. Watson · Third · N. Rodda · Second · S. Ah Wong · Lead · J. Kirk',
}

interface Signal {
  id: string
  icon: 'email' | 'application' | 'team' | 'enquiry' | 'website'
  title: string
  meta: string
  titleMobile: string
  time: string
}

const signals: Signal[] = [
  { id: 's1', icon: 'email', title: 'Bulk email "Championship reminder" sent to 84 members', titleMobile: 'Bulk email sent · 84 members', meta: 'Sent by Grace Whittaker', time: '2h' },
  { id: 's2', icon: 'application', title: 'Application Sarah Chen approved — full member', titleMobile: 'Sarah Chen approved · Full member', meta: 'Approved by you', time: '5h' },
  { id: 's3', icon: 'team', title: 'Team selection "Saturday Pennant · Sat 16 Aug" published', titleMobile: 'Team selection published', meta: 'Published to site', time: '18h' },
  { id: 's4', icon: 'enquiry', title: 'New enquiry from Wellington Rotary — function venue', titleMobile: 'New enquiry · Wellington Rotary', meta: 'Preferred date Sat 20 Sep', time: '2d' },
  { id: 's5', icon: 'website', title: 'Website page "About the club" edited', titleMobile: 'Website page "About the club" edited', meta: 'Edited by Grace Whittaker', time: '2d' },
]

const iconTone: Record<Signal['icon'], { bg: string; fg: string }> = {
  email: { bg: 'var(--color-accent-soft)', fg: 'var(--color-accent)' },
  application: { bg: '#DCFCE7', fg: 'var(--color-feature-mint)' },
  team: { bg: 'var(--color-accent-soft)', fg: 'var(--color-accent)' },
  enquiry: { bg: '#FFF1E7', fg: 'var(--color-feature-tangerine)' },
  website: { bg: 'var(--color-surface)', fg: 'var(--color-graphite)' },
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
        <p class="dash__sub dash__sub--desktop">Three applications and two enquiries need your attention today.</p>
        <p class="dash__sub dash__sub--mobile">3 applications · 2 enquiries need attention.</p>
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
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
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
          <div class="section__eyebrow">Next 7 days</div>
          <h2 class="section__heading section__heading--desktop">Next 7 days · {{ upcomingEvents.length }}</h2>
        </div>
        <RouterLink to="/crm/events" class="section__link section__link--desktop">
          Open calendar
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
        </RouterLink>
        <div class="section__meta section__meta--mobile">{{ upcomingEvents.length }} events</div>
      </div>
      <ul class="events">
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

    <!-- Latest team selection -->
    <section class="team-card">
      <div class="team-card__head">
        <div>
          <div class="section__eyebrow">Latest team selection</div>
          <h2 class="section__heading">{{ latestSelection.title }} · {{ latestSelection.when }}</h2>
          <div class="team-card__meta team-card__meta--mobile">{{ latestSelection.meta }}</div>
        </div>
        <span class="pill pill--published">Published</span>
      </div>
      <table class="team team--desktop">
        <thead>
          <tr>
            <th>Position</th>
            <th>Player</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in latestSelection.rowsDesktop" :key="row.position">
            <td class="team__pos">{{ row.position }}</td>
            <td>{{ row.name }}</td>
          </tr>
        </tbody>
      </table>
      <div class="team-card__inline team-card__inline--mobile">{{ latestSelection.inlineMobile }}</div>
      <div class="team-card__foot team-card__foot--desktop">
        <span class="team-card__foot-meta">Published {{ latestSelection.publishedAt }}</span>
        <RouterLink to="/crm/teams" class="section__link">
          Open selection
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
      <ul class="signals">
        <li v-for="s in signals" :key="s.id" class="signal">
          <div class="signal__icon" :style="{ background: iconTone[s.icon].bg, color: iconTone[s.icon].fg }">
            <svg v-if="s.icon === 'email'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M4 4h16v16H4z" /><path d="M22 6l-10 7L2 6" /></svg>
            <svg v-else-if="s.icon === 'application'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M20 6 9 17l-5-5" /></svg>
            <svg v-else-if="s.icon === 'team'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
            <svg v-else-if="s.icon === 'enquiry'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /></svg>
          </div>
          <div class="signal__body">
            <div class="signal__title signal__title--desktop">{{ s.title }}</div>
            <div class="signal__title signal__title--mobile">{{ s.titleMobile }}</div>
            <div class="signal__meta signal__meta--desktop">{{ s.meta }}</div>
          </div>
          <div class="signal__time">{{ s.time }}</div>
        </li>
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

/* ==================== KPI cards ==================== */
.kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
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

/* ==================== Team card ==================== */
.team-card { background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; padding: 20px 24px; }
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
.signal { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--color-hairline); }
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
