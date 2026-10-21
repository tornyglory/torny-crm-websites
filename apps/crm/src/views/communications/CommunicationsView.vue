<script setup lang="ts">
/**
 * Communications — campaign list (mock).
 *
 * Renders the Paper design 74 artboard against hardcoded fixtures in
 * `mockCampaigns.ts`. No backend yet — the Communications analytics
 * brief will swap `CAMPAIGNS` for a real list endpoint and the Compose
 * CTA for the already-wired composer at `/communications/compose`.
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CAMPAIGNS, summarise, type Campaign, type CampaignStatus } from './mockCampaigns'

const router = useRouter()

type Tab = 'all' | 'sent' | 'scheduled' | 'draft'
const activeTab = ref<Tab>('all')
const search = ref('')

const tabs = computed(() => {
  const counts: Record<CampaignStatus, number> = { sent: 0, scheduled: 0, draft: 0 }
  for (const c of CAMPAIGNS) counts[c.status]++
  return [
    { value: 'all' as Tab,       label: 'All',       count: CAMPAIGNS.length },
    { value: 'sent' as Tab,      label: 'Sent',      count: counts.sent + 7 /* mock history we didn't fixture */ },
    { value: 'scheduled' as Tab, label: 'Scheduled', count: counts.scheduled },
    { value: 'draft' as Tab,     label: 'Drafts',    count: counts.draft },
  ]
})

const stats = summarise()

const filtered = computed<Campaign[]>(() => {
  const q = search.value.trim().toLowerCase()
  return CAMPAIGNS.filter((c) => {
    if (activeTab.value !== 'all' && c.status !== activeTab.value) return false
    if (!q) return true
    return (
      c.subject.toLowerCase().includes(q) ||
      c.audience_label.toLowerCase().includes(q) ||
      c.author_name.toLowerCase().includes(q)
    )
  })
})

function openCampaign(c: Campaign) {
  router.push({ name: 'campaign-detail', params: { id: c.id } })
}
function compose() {
  router.push({ name: 'compose' })
}

/** Icon tone per campaign status + subject vibe. Keeps the row leading
 *  thumbnail colourful without rendering a real image. */
function iconTone(c: Campaign): { bg: string; stroke: string } {
  if (c.status === 'scheduled') return { bg: '#EDE9FE', stroke: '#5B21B6' }
  if (c.status === 'draft')     return { bg: '#F5F5F2', stroke: '#6B6B72' }
  if ((c.open_rate ?? 0) >= 75) return { bg: '#DCFCE7', stroke: '#166534' }
  if ((c.open_rate ?? 0) >= 55) return { bg: '#FEF3C7', stroke: '#92400E' }
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
        <button type="button" class="btn btn--ghost">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2.5 3h9v8h-9z M2.5 5.5h9 M5 3v8" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
          Templates
        </button>
        <button type="button" class="btn btn--ink" @click="compose">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          Compose
        </button>
      </div>
    </header>

    <!-- Stat tiles: one hero dark card (open rate) + three light tiles. -->
    <section class="comms__stats">
      <article class="stat stat--hero">
        <header>
          <span class="stat__label">Open rate · 30d</span>
          <span class="stat__trend stat__trend--up">▲ +4.2 pp</span>
        </header>
        <div class="stat__value">{{ stats.open_rate }}<span class="stat__unit">%</span></div>
        <footer>{{ stats.total_opens.toLocaleString() }} opens across {{ stats.total_broadcasts }} broadcasts. Industry benchmark 38%.</footer>
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
          <span class="stat__trend stat__trend--up stat__trend--success">▲ +1.3 pp</span>
        </header>
        <div class="stat__value stat__value--md">{{ stats.click_rate }}<span class="stat__unit">%</span></div>
        <footer>{{ stats.total_clicks }} clicks on links &amp; buttons</footer>
      </article>

      <article class="stat">
        <header>
          <span class="stat__label">Unsubscribes · 30d</span>
          <span class="stat__trend">▼ -1</span>
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
          :key="c.id"
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
                <span>{{ c.audience_label }}</span>
                <span class="row__dot">·</span>
                <span v-if="c.status === 'scheduled'">{{ c.sent_at_time }}</span>
                <span v-else-if="c.status === 'draft'">{{ c.sent_at_relative }}</span>
                <span v-else>by {{ c.author_name }}</span>
              </div>
            </div>
          </div>

          <div class="list__r cell-mono">{{ c.status === 'draft' ? '—' : c.audience_count }}</div>
          <div class="list__r cell-date">
            <template v-if="c.status === 'draft'">—</template>
            <template v-else-if="c.status === 'scheduled'">
              <div class="cell-date__primary cell-date__primary--scheduled">{{ c.sent_at_label }}</div>
              <div class="cell-date__sub">{{ c.sent_at_relative }}</div>
            </template>
            <template v-else>
              <div class="cell-date__primary">{{ c.sent_at_label }}</div>
              <div class="cell-date__sub">{{ c.sent_at_relative }}</div>
            </template>
          </div>
          <div class="cell-rate">
            <template v-if="c.status === 'sent' && c.open_rate != null">
              <div class="cell-rate__top">
                <div class="cell-rate__value">{{ c.open_rate }}<span>%</span></div>
                <div class="cell-rate__frac">{{ c.opens }}/{{ c.delivered }}</div>
              </div>
              <div class="bar"><div class="bar__fill" :style="{ width: `${c.open_rate}%` }"></div></div>
            </template>
            <template v-else>—</template>
          </div>
          <div class="list__r cell-clicks">
            <template v-if="c.status === 'sent' && c.click_rate != null">
              <div class="cell-clicks__value">{{ c.click_rate }}%</div>
              <div class="cell-clicks__sub">{{ c.clicks }} clicks</div>
            </template>
            <template v-else>—</template>
          </div>
          <div class="row__chevron">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
        </li>

        <li v-if="filtered.length === 0" class="empty">
          <div class="empty__title">No campaigns match "{{ search }}"</div>
          <div class="empty__sub">Try a different search or clear the filter.</div>
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
  padding: 32px 32px 48px;
  max-width: 1440px;
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
.stat--hero .stat__value { font-size: 72px; }
.stat--hero .stat__unit { color: rgba(255, 255, 255, 0.65); font-size: 36px; }
.stat--hero footer { color: rgba(255, 255, 255, 0.75); line-height: 1.5; }
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
