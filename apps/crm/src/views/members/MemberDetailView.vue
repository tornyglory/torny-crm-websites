<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'

const toast = useToast()

type Tab = 'overview' | 'membership' | 'activity' | 'communications'

interface Payment {
  id: string
  date: string
  amount: string
  status: 'paid' | 'due'
  reference: string
}
interface ActivityItem {
  id: string
  when: string
  kind: 'event' | 'match' | 'admin' | 'comms'
  label: string
  detail?: string
}
interface CommThread {
  id: string
  date: string
  channel: 'email' | 'sms'
  subject: string
  status: 'opened' | 'delivered' | 'clicked'
}

const route = useRoute()
const router = useRouter()

const memberId = computed(() => String(route.params.id ?? ''))

// Mock member — a lookup layer will replace this with the store call.
const member = ref({
  id: memberId.value || '1',
  firstName: 'Marcus',
  lastName: 'Tuilagi',
  email: 'marcus@example.com',
  phone: '021 555 0101',
  address: '14 Ranui Ave, Kelburn, Wellington 6012',
  membership: 'Playing member',
  status: 'Active' as 'Active' | 'Pending' | 'Lapsed',
  memberSince: 'Joined Aug 2019',
  playerId: 812,
  roles: ['Committee', 'Captain — Div 3'],
  balance: '$0.00',
  nextDues: '$140.00 due 1 Oct 2026',
  emergency: {
    name: 'Latu Tuilagi',
    relation: 'Wife',
    phone: '027 555 9999',
  },
  notes:
    'Long-serving committee member. Prefers email for competition notices, phone for last-minute changes.',
})

const activeTab = ref<Tab>('overview')
const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'membership', label: 'Membership' },
  { value: 'activity', label: 'Activity' },
  { value: 'communications', label: 'Comms' },
]

const payments = ref<Payment[]>([
  { id: 'p1', date: '01 Oct 2025', amount: '$140.00', status: 'paid', reference: 'DUES-2025' },
  { id: 'p2', date: '01 Oct 2024', amount: '$130.00', status: 'paid', reference: 'DUES-2024' },
  { id: 'p3', date: '14 Jun 2024', amount: '$25.00', status: 'paid', reference: 'GREEN-FEE' },
])

const activity = ref<ActivityItem[]>([
  { id: 'a1', when: 'Yesterday · 5:12pm', kind: 'match', label: 'Match — Naenae A vs Kelburn A', detail: 'Skip · Won 21–14' },
  { id: 'a2', when: '3 days ago', kind: 'event', label: 'RSVP’d to Twilight Roll-Up', detail: 'Rink 3 · 6:00pm' },
  { id: 'a3', when: 'Last week', kind: 'admin', label: 'Committee meeting minutes acknowledged' },
  { id: 'a4', when: '18 Aug 2026', kind: 'comms', label: 'Received: Pennant round 8 confirmation' },
  { id: 'a5', when: '02 Aug 2026', kind: 'match', label: 'Match — Div 3 semi-final', detail: 'Skip · Won 22–19' },
])

const comms = ref<CommThread[]>([
  { id: 'c1', date: '18 Aug 2026', channel: 'email', subject: 'Pennant round 8 — team notice', status: 'opened' },
  { id: 'c2', date: '10 Aug 2026', channel: 'email', subject: 'Twilight roll-up sign-ups open', status: 'clicked' },
  { id: 'c3', date: '02 Aug 2026', channel: 'sms', subject: 'Green closed Sat — heavy rain', status: 'delivered' },
])

const initials = computed(
  () => `${member.value.firstName[0] ?? ''}${member.value.lastName[0] ?? ''}`.toUpperCase(),
)
const fullName = computed(() => `${member.value.firstName} ${member.value.lastName}`)

const statusTone: Record<typeof member.value.status, string> = {
  Active: 'ok',
  Pending: 'warn',
  Lapsed: 'danger',
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push({ name: 'members' })
}
</script>

<template>
  <div class="mem">
    <button class="mem__back" @click="goBack">← Members</button>

    <header class="mem__hero">
      <div class="mem__avatar">{{ initials }}</div>
      <div class="mem__id">
        <div class="mem__eyebrow">Member · #{{ member.playerId }}</div>
        <h1 class="mem__name">{{ fullName }}</h1>
        <div class="mem__badges">
          <span class="badge" :class="`badge--${statusTone[member.status]}`">{{ member.status }}</span>
          <span class="badge badge--soft">{{ member.membership }}</span>
          <span
            v-for="r in member.roles"
            :key="r"
            class="badge badge--outline"
          >{{ r }}</span>
        </div>
        <div class="mem__meta">
          <span>{{ member.memberSince }}</span>
          <span class="dot">·</span>
          <span>{{ member.email }}</span>
          <span class="dot">·</span>
          <span>{{ member.phone }}</span>
        </div>
      </div>
      <div class="mem__actions">
        <button class="btn btn--ghost" @click="toast.info(`Compose to ${fullName} opens in Communications.`)">Message</button>
        <button class="btn btn--outline" @click="toast.info('Member edit form opens next session.')">Edit</button>
      </div>
    </header>

    <nav class="mem__tabs">
      <button
        v-for="t in TABS"
        :key="t.value"
        class="tab"
        :class="{ 'is-active': activeTab === t.value }"
        @click="activeTab = t.value"
      >{{ t.label }}</button>
    </nav>

    <!-- Overview -->
    <section v-if="activeTab === 'overview'" class="grid">
      <article class="card">
        <div class="card__eyebrow">Contact</div>
        <div class="kv"><span>Email</span><b>{{ member.email }}</b></div>
        <div class="kv"><span>Phone</span><b>{{ member.phone }}</b></div>
        <div class="kv"><span>Address</span><b>{{ member.address }}</b></div>
      </article>
      <article class="card">
        <div class="card__eyebrow">Emergency</div>
        <div class="kv"><span>Name</span><b>{{ member.emergency.name }}</b></div>
        <div class="kv"><span>Relation</span><b>{{ member.emergency.relation }}</b></div>
        <div class="kv"><span>Phone</span><b>{{ member.emergency.phone }}</b></div>
      </article>
      <article class="card card--wide">
        <div class="card__eyebrow">Committee notes</div>
        <p class="card__note">{{ member.notes }}</p>
      </article>
    </section>

    <!-- Membership -->
    <section v-else-if="activeTab === 'membership'" class="grid">
      <article class="card">
        <div class="card__eyebrow">Balance</div>
        <div class="metric">{{ member.balance }}</div>
        <div class="metric-sub">{{ member.nextDues }}</div>
      </article>
      <article class="card card--wide">
        <div class="card__eyebrow">Payment history</div>
        <ul class="rows">
          <li v-for="p in payments" :key="p.id" class="frow">
            <div class="frow__date">{{ p.date }}</div>
            <div class="frow__ref">{{ p.reference }}</div>
            <div class="frow__amount">{{ p.amount }}</div>
            <div class="frow__status" :class="`frow__status--${p.status}`">{{ p.status }}</div>
          </li>
        </ul>
      </article>
    </section>

    <!-- Activity -->
    <section v-else-if="activeTab === 'activity'" class="tl">
      <div v-for="a in activity" :key="a.id" class="tl__item">
        <div class="tl__dot" :class="`tl__dot--${a.kind}`" aria-hidden="true" />
        <div class="tl__body">
          <div class="tl__when">{{ a.when }}</div>
          <div class="tl__label">{{ a.label }}</div>
          <div v-if="a.detail" class="tl__detail">{{ a.detail }}</div>
        </div>
      </div>
    </section>

    <!-- Comms -->
    <section v-else class="grid">
      <article class="card card--wide">
        <div class="card__eyebrow">Recent messages</div>
        <ul class="rows">
          <li v-for="c in comms" :key="c.id" class="frow">
            <div class="frow__date">{{ c.date }}</div>
            <div class="frow__channel" :class="`frow__channel--${c.channel}`">{{ c.channel.toUpperCase() }}</div>
            <div class="frow__subject">{{ c.subject }}</div>
            <div class="frow__status">{{ c.status }}</div>
          </li>
        </ul>
      </article>
    </section>
  </div>
</template>

<style scoped>
.mem { max-width: 1080px; }
.mem__back { background: transparent; border: 0; padding: 0 0 12px; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); cursor: pointer; }
.mem__back:hover { color: var(--color-ink); }

.mem__hero { display: flex; align-items: flex-start; gap: 20px; padding-bottom: 20px; border-bottom: 1px solid var(--color-hairline); margin-bottom: 20px; }
.mem__avatar { width: 72px; height: 72px; border-radius: 999px; background: var(--color-graphite); color: #fff; display: flex; align-items: center; justify-content: center; font-family: var(--font-body); font-size: 24px; font-weight: 700; flex-shrink: 0; }
.mem__id { flex: 1; min-width: 0; }
.mem__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-fog); }
.mem__name { font-family: var(--font-display); font-size: 30px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 10px; color: var(--color-ink); }
.mem__badges { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.mem__meta { display: flex; gap: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); flex-wrap: wrap; }
.mem__meta .dot { opacity: 0.5; }
.mem__actions { display: flex; gap: 8px; flex-shrink: 0; }

.badge { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; font-family: var(--font-body); font-size: 11px; font-weight: 600; text-transform: capitalize; }
.badge--ok { background: #DCFCE7; color: #166534; }
.badge--warn { background: #FEF3C7; color: #92400E; }
.badge--danger { background: #FEE2E2; color: #991B1B; }
.badge--soft { background: var(--color-accent-soft); color: var(--color-accent-strong); }
.badge--outline { background: transparent; color: var(--color-graphite); border: 1px solid var(--color-hairline); }

.btn { padding: 9px 14px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
.btn--ghost { background: var(--color-ink); color: #fff; }
.btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }

.mem__tabs { display: flex; gap: 4px; padding: 4px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; width: fit-content; margin-bottom: 20px; }
.tab { padding: 8px 16px; background: transparent; border: none; border-radius: 999px; cursor: pointer; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-fog); }
.tab.is-active { background: #fff; color: var(--color-ink); font-weight: 600; box-shadow: var(--shadow-sm); }

.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.card { background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; padding: 20px; }
.card--wide { grid-column: 1 / -1; }
.card__eyebrow { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); margin-bottom: 12px; }
.card__note { font-family: var(--font-body); font-size: 14px; line-height: 1.55; color: var(--color-graphite); margin: 0; }
.kv { display: flex; justify-content: space-between; gap: 20px; padding: 8px 0; border-bottom: 1px solid var(--color-hairline); font-family: var(--font-body); font-size: 13px; }
.kv:last-child { border-bottom: 0; }
.kv > span { color: var(--color-fog); }
.kv > b { color: var(--color-ink); font-weight: 600; }

.metric { font-family: var(--font-display); font-size: 40px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); }
.metric-sub { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); margin-top: 4px; }

.rows { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; }
.frow { display: grid; grid-template-columns: 120px 100px 1fr 100px; gap: 12px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--color-hairline); font-family: var(--font-body); font-size: 13px; }
.frow:last-child { border-bottom: 0; }
.frow__date, .frow__ref { color: var(--color-fog); }
.frow__amount { color: var(--color-ink); font-weight: 600; text-align: right; }
.frow__status { text-align: right; text-transform: capitalize; font-size: 11px; font-weight: 600; }
.frow__status--paid { color: #166534; }
.frow__status--due { color: #991B1B; }
.frow__channel { font-family: var(--font-mono); font-size: 10px; color: var(--color-fog); }
.frow__channel--sms { color: var(--color-feature-violet); }
.frow__subject { color: var(--color-ink); }

.tl { position: relative; padding-left: 20px; }
.tl::before { content: ''; position: absolute; left: 5px; top: 6px; bottom: 6px; width: 1px; background: var(--color-hairline); }
.tl__item { display: flex; gap: 16px; padding: 12px 0; position: relative; }
.tl__dot { position: absolute; left: -20px; top: 16px; width: 11px; height: 11px; border-radius: 999px; background: var(--color-fog); border: 2px solid var(--color-surface); }
.tl__dot--match { background: var(--color-feature-mint); }
.tl__dot--event { background: var(--color-accent); }
.tl__dot--admin { background: var(--color-graphite); }
.tl__dot--comms { background: var(--color-feature-tangerine); }
.tl__body { flex: 1; }
.tl__when { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); letter-spacing: 0.02em; }
.tl__label { font-family: var(--font-body); font-size: 14px; font-weight: 600; color: var(--color-ink); margin-top: 2px; }
.tl__detail { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); margin-top: 2px; }

@media (max-width: 767px) {
  .mem__hero { flex-direction: column; }
  .mem__actions { width: 100%; }
  .btn { flex: 1; }
  .grid { grid-template-columns: 1fr; }
  .frow { grid-template-columns: 1fr 1fr; }
  .frow__subject { grid-column: 1 / -1; }
}
</style>
