<script setup lang="ts">
import { ref, computed } from 'vue'

type Channel = 'email' | 'sms'
type Status = 'draft' | 'scheduled' | 'sent'

interface Campaign {
  id: string
  subject: string
  channel: Channel
  audience: string
  audienceCount: number
  status: Status
  createdAt: string
  sentAt?: string
  scheduleFor?: string
  openRate?: number
  clickRate?: number
  preview: string
}

const activeTab = ref<'all' | Status>('all')
const composeOpen = ref(false)

const campaigns = ref<Campaign[]>([
  {
    id: 'c1',
    subject: 'Pennant round 8 — team notice + game plan',
    channel: 'email',
    audience: 'Playing members',
    audienceCount: 96,
    status: 'sent',
    createdAt: '2 days ago',
    sentAt: 'Yesterday · 8:12am',
    openRate: 0.72,
    clickRate: 0.28,
    preview: 'Kia ora team — this Saturday we take on Petone A at home. Marcus is captain, calls by 11am. Rink assignments attached.',
  },
  {
    id: 'c2',
    subject: 'Green closed Saturday — heavy rain',
    channel: 'sms',
    audience: 'All members',
    audienceCount: 142,
    status: 'sent',
    createdAt: '4 days ago',
    sentAt: '10 Aug · 6:04am',
    preview: 'GREEN CLOSED Sat 10 Aug. Committee reviewing at 9am. Watch email for updates.',
  },
  {
    id: 'c3',
    subject: 'Twilight roll-up sign-ups open',
    channel: 'email',
    audience: 'Social members',
    audienceCount: 48,
    status: 'sent',
    createdAt: '1 week ago',
    sentAt: '05 Aug · 5:00pm',
    openRate: 0.61,
    clickRate: 0.35,
    preview: 'Wednesday roll-ups are back for spring — six weeks, BYO tumbler, prize on the last night.',
  },
  {
    id: 'c4',
    subject: 'AGM notice + agenda',
    channel: 'email',
    audience: 'All members',
    audienceCount: 142,
    status: 'scheduled',
    createdAt: '2h ago',
    scheduleFor: 'Fri 22 Aug · 9:00am',
    preview: 'Notice is hereby given that the Annual General Meeting will be held at the clubrooms on Sunday 15 Sept, 3pm…',
  },
  {
    id: 'c5',
    subject: 'Working bee — Sat 30 Aug',
    channel: 'email',
    audience: 'Playing members',
    audienceCount: 96,
    status: 'draft',
    createdAt: '1h ago',
    preview: 'Draft — needs BBQ details + morning tea sign-up link before sending.',
  },
])

const counts = computed(() => ({
  all: campaigns.value.length,
  draft: campaigns.value.filter((c) => c.status === 'draft').length,
  scheduled: campaigns.value.filter((c) => c.status === 'scheduled').length,
  sent: campaigns.value.filter((c) => c.status === 'sent').length,
}))

const filtered = computed(() =>
  activeTab.value === 'all'
    ? campaigns.value
    : campaigns.value.filter((c) => c.status === activeTab.value),
)

const totalSent = computed(() =>
  campaigns.value
    .filter((c) => c.status === 'sent')
    .reduce((n, c) => n + c.audienceCount, 0),
)
const avgOpenRate = computed(() => {
  const sent = campaigns.value.filter((c) => c.status === 'sent' && c.openRate != null)
  if (sent.length === 0) return 0
  return sent.reduce((n, c) => n + (c.openRate ?? 0), 0) / sent.length
})

const composeForm = ref({
  channel: 'email' as Channel,
  subject: '',
  audience: 'Playing members',
  body: '',
})

const audiences = [
  { key: 'all', label: 'All members', count: 142 },
  { key: 'playing', label: 'Playing members', count: 96 },
  { key: 'social', label: 'Social members', count: 48 },
  { key: 'committee', label: 'Committee', count: 8 },
]

function formatPct(v: number | undefined) {
  if (v == null) return '—'
  return `${Math.round(v * 100)}%`
}
</script>

<template>
  <div class="cx">
    <header class="cx__header">
      <div>
        <div class="cx__eyebrow">Communications</div>
        <h1 class="cx__heading">Talk to your club</h1>
        <p class="cx__sub">Email and SMS campaigns to your members. {{ counts.draft }} draft, {{ counts.scheduled }} scheduled.</p>
      </div>
      <button class="btn btn--primary" @click="composeOpen = true">+ New campaign</button>
    </header>

    <section class="metrics">
      <article class="metric">
        <div class="metric__val">{{ counts.sent }}</div>
        <div class="metric__lbl">Sent this year</div>
      </article>
      <article class="metric">
        <div class="metric__val">{{ totalSent }}</div>
        <div class="metric__lbl">Total deliveries</div>
      </article>
      <article class="metric">
        <div class="metric__val">{{ formatPct(avgOpenRate) }}</div>
        <div class="metric__lbl">Avg. open rate</div>
      </article>
      <article class="metric">
        <div class="metric__val">{{ counts.scheduled }}</div>
        <div class="metric__lbl">Scheduled</div>
      </article>
    </section>

    <div class="cx__tabs">
      <button
        v-for="tab in (['all', 'draft', 'scheduled', 'sent'] as const)"
        :key="tab"
        class="tab"
        :class="{ 'is-active': activeTab === tab }"
        @click="activeTab = tab"
      >
        <span>{{ tab }}</span>
        <span class="tab__count">{{ counts[tab] }}</span>
      </button>
    </div>

    <ul class="list">
      <li v-for="c in filtered" :key="c.id" class="row">
        <div class="row__left">
          <div class="row__meta">
            <span class="chan" :class="`chan--${c.channel}`">{{ c.channel.toUpperCase() }}</span>
            <span class="row__aud">{{ c.audience }}</span>
            <span class="dot">·</span>
            <span class="row__count">{{ c.audienceCount }} recipients</span>
          </div>
          <h3 class="row__subject">{{ c.subject }}</h3>
          <p class="row__preview">{{ c.preview }}</p>
        </div>
        <div class="row__right">
          <div class="row__time">
            <template v-if="c.status === 'sent'">
              <span class="row__status stat-sent">Sent</span>
              <span class="row__when">{{ c.sentAt }}</span>
            </template>
            <template v-else-if="c.status === 'scheduled'">
              <span class="row__status stat-scheduled">Scheduled</span>
              <span class="row__when">{{ c.scheduleFor }}</span>
            </template>
            <template v-else>
              <span class="row__status stat-draft">Draft</span>
              <span class="row__when">Updated {{ c.createdAt }}</span>
            </template>
          </div>
          <div v-if="c.status === 'sent'" class="row__rates">
            <div class="rate"><div class="rate__val">{{ formatPct(c.openRate) }}</div><div class="rate__lbl">open</div></div>
            <div class="rate"><div class="rate__val">{{ formatPct(c.clickRate) }}</div><div class="rate__lbl">click</div></div>
          </div>
        </div>
      </li>
    </ul>

    <!-- Compose drawer -->
    <div v-if="composeOpen" class="drawer" @click.self="composeOpen = false">
      <div class="drawer__panel">
        <header class="drawer__head">
          <div class="drawer__eyebrow">New campaign</div>
          <h2 class="drawer__title">Compose</h2>
          <button class="drawer__close" @click="composeOpen = false" aria-label="Close">×</button>
        </header>

        <div class="drawer__body">
          <div class="channel-picker">
            <button
              class="cp"
              :class="{ 'is-active': composeForm.channel === 'email' }"
              @click="composeForm.channel = 'email'"
            >Email</button>
            <button
              class="cp"
              :class="{ 'is-active': composeForm.channel === 'sms' }"
              @click="composeForm.channel = 'sms'"
            >SMS</button>
          </div>

          <div class="field">
            <label class="field__label">Audience</label>
            <div class="audiences">
              <button
                v-for="a in audiences"
                :key="a.key"
                class="aud"
                :class="{ 'is-active': composeForm.audience === a.label }"
                @click="composeForm.audience = a.label"
              >
                <span>{{ a.label }}</span>
                <span class="aud__count">{{ a.count }}</span>
              </button>
            </div>
          </div>

          <div class="field">
            <label class="field__label">{{ composeForm.channel === 'email' ? 'Subject' : 'From label' }}</label>
            <input class="field__input" v-model="composeForm.subject" placeholder="Pennant round 8 — team notice" />
          </div>

          <div class="field">
            <label class="field__label">{{ composeForm.channel === 'email' ? 'Body' : 'Message (160 chars)' }}</label>
            <textarea class="field__input" rows="8" v-model="composeForm.body" />
          </div>
        </div>

        <footer class="drawer__foot">
          <button class="btn btn--outline" @click="composeOpen = false">Save draft</button>
          <button class="btn btn--outline">Schedule…</button>
          <button class="btn btn--primary">Send now</button>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cx { max-width: 1080px; }
.cx__header { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.cx__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-fog); }
.cx__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.cx__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; }

.metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
.metric { padding: 16px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; }
.metric__val { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); }
.metric__lbl { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); margin-top: 4px; }

.cx__tabs { display: flex; gap: 6px; margin-bottom: 20px; padding: 4px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; width: fit-content; }
.tab { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: transparent; border: none; border-radius: 999px; cursor: pointer; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-fog); text-transform: capitalize; }
.tab.is-active { background: #fff; color: var(--color-ink); font-weight: 600; box-shadow: var(--shadow-sm); }
.tab__count { font-family: var(--font-mono); font-size: 11px; padding: 1px 7px; background: var(--color-hairline); color: var(--color-graphite); border-radius: 999px; }
.tab.is-active .tab__count { background: var(--color-accent-soft); color: var(--color-accent); }

.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; gap: 16px; align-items: flex-start; padding: 16px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; }
.row__left { flex: 1; min-width: 0; }
.row__meta { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.chan { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; padding: 2px 8px; border-radius: 999px; }
.chan--email { background: var(--color-accent-soft); color: var(--color-accent-strong); }
.chan--sms { background: #EDE9FE; color: var(--color-feature-violet); }
.row__aud { color: var(--color-ink); font-weight: 600; }
.row__subject { font-family: var(--font-display); font-size: 17px; font-weight: 600; letter-spacing: -0.005em; margin: 0 0 4px; color: var(--color-ink); }
.row__preview { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); line-height: 1.5; margin: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.row__right { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; flex-shrink: 0; text-align: right; }
.row__time { display: flex; flex-direction: column; align-items: flex-end; }
.row__status { font-family: var(--font-body); font-size: 12px; font-weight: 700; text-transform: capitalize; }
.stat-sent { color: #166534; }
.stat-scheduled { color: var(--color-accent); }
.stat-draft { color: #92400E; }
.row__when { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 2px; }
.row__rates { display: flex; gap: 12px; padding-top: 8px; border-top: 1px solid var(--color-hairline); }
.rate { text-align: right; }
.rate__val { font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--color-ink); }
.rate__lbl { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.dot { opacity: 0.5; }

.btn { padding: 9px 14px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
.btn--primary { background: var(--color-ink); color: #fff; }
.btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }

.drawer { position: fixed; inset: 0; background: rgba(10, 10, 11, 0.4); z-index: 50; display: flex; justify-content: flex-end; }
.drawer__panel { width: 100%; max-width: 560px; background: #fff; display: flex; flex-direction: column; height: 100%; }
.drawer__head { display: flex; align-items: end; gap: 12px; padding: 24px; border-bottom: 1px solid var(--color-hairline); }
.drawer__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.drawer__title { font-family: var(--font-display); font-size: 24px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 0; color: var(--color-ink); flex: 1; }
.drawer__close { background: transparent; border: 0; font-size: 22px; color: var(--color-fog); cursor: pointer; }
.drawer__body { flex: 1; overflow-y: auto; padding: 24px; }
.drawer__foot { display: flex; justify-content: flex-end; gap: 8px; padding: 16px 24px; border-top: 1px solid var(--color-hairline); }

.channel-picker { display: inline-flex; padding: 3px; background: var(--color-surface); border-radius: 999px; margin-bottom: 20px; }
.cp { padding: 6px 18px; background: transparent; border: 0; border-radius: 999px; cursor: pointer; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); }
.cp.is-active { background: #fff; color: var(--color-ink); font-weight: 600; box-shadow: var(--shadow-sm); }

.field { margin-bottom: 16px; }
.field__label { display: block; font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); margin-bottom: 8px; }
.field__input { width: 100%; padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 14px; color: var(--color-ink); background: #fff; resize: vertical; }
.field__input:focus { outline: none; border-color: var(--color-ink); }

.audiences { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.aud { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; cursor: pointer; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); }
.aud.is-active { border-color: var(--color-ink); background: var(--color-accent-soft); }
.aud__count { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); }

@media (max-width: 767px) {
  .metrics { grid-template-columns: 1fr 1fr; }
  .row { flex-direction: column; }
  .row__right { align-items: flex-start; text-align: left; }
  .row__rates { border-top: 0; padding-top: 0; }
}
</style>
