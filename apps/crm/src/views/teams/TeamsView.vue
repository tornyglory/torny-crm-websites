<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'

type Status = 'draft' | 'confirmed' | 'sent' | 'played'

interface Team {
  id: string
  competition: string
  round: string
  opponent: string
  venue: 'home' | 'away'
  when: string
  format: string
  status: Status
  confirmedCount: number
  totalPositions: number
  managerNote?: string
}

const router = useRouter()

const teams = ref<Team[]>([
  { id: 't1', competition: 'Pennant Div 3', round: 'Round 8', opponent: 'Petone A', venue: 'home', when: 'Sat 23 Aug · 12:30pm', format: 'Fours × 2', status: 'draft', confirmedCount: 4, totalPositions: 8 },
  { id: 't2', competition: 'Pennant Div 3', round: 'Round 7', opponent: 'Kelburn A', venue: 'away', when: 'Sat 16 Aug · 12:30pm', format: 'Fours × 2', status: 'confirmed', confirmedCount: 8, totalPositions: 8, managerNote: 'M. Tuilagi captain — call by 11am' },
  { id: 't3', competition: 'Champion of Champions', round: 'Semi-final', opponent: 'D. Peters (Naenae)', venue: 'home', when: 'Sun 24 Aug · 1:00pm', format: 'Singles', status: 'sent', confirmedCount: 1, totalPositions: 1 },
  { id: 't4', competition: 'Kelburn Fours Champs', round: 'Final', opponent: 'Reggie’s Four', venue: 'home', when: 'Sat 30 Aug · 10:00am', format: 'Fours', status: 'draft', confirmedCount: 2, totalPositions: 4 },
  { id: 't5', competition: 'Pennant Div 3', round: 'Round 6', opponent: 'Wainuiomata B', venue: 'home', when: 'Sat 09 Aug', format: 'Fours × 2', status: 'played', confirmedCount: 8, totalPositions: 8 },
])

const activeTab = ref<'upcoming' | 'past'>('upcoming')

const upcoming = computed(() => teams.value.filter((t) => t.status !== 'played'))
const past = computed(() => teams.value.filter((t) => t.status === 'played'))
const visible = computed(() => (activeTab.value === 'upcoming' ? upcoming.value : past.value))

const statusTone: Record<Status, string> = {
  draft: 'warn',
  confirmed: 'ok',
  sent: 'info',
  played: 'muted',
}

function openEditor(t: Team) {
  router.push({ name: 'team-editor', params: { id: t.id } })
}

function newSelection() {
  router.push({ name: 'team-editor', params: { id: 'new' } })
}
</script>

<template>
  <div class="teams">
    <header class="teams__header">
      <div>
        <div class="teams__eyebrow">Selections</div>
        <h1 class="teams__heading">Team selections</h1>
        <p class="teams__sub">Every draft, confirmation, and post-match card. {{ upcoming.length }} upcoming.</p>
      </div>
      <button class="btn btn--primary" @click="newSelection">+ New selection</button>
    </header>

    <div class="teams__tabs">
      <button class="tab" :class="{ 'is-active': activeTab === 'upcoming' }" @click="activeTab = 'upcoming'">
        <span>Upcoming</span><span class="tab__count">{{ upcoming.length }}</span>
      </button>
      <button class="tab" :class="{ 'is-active': activeTab === 'past' }" @click="activeTab = 'past'">
        <span>Past</span><span class="tab__count">{{ past.length }}</span>
      </button>
    </div>

    <ul class="list">
      <li v-for="t in visible" :key="t.id" class="row" @click="openEditor(t)">
        <div class="row__left">
          <div class="row__comp">{{ t.competition }}</div>
          <div class="row__title">{{ t.round }} · {{ t.opponent }}</div>
          <div class="row__meta">
            <span class="tag" :class="`tag--${t.venue}`">{{ t.venue }}</span>
            <span>{{ t.when }}</span>
            <span class="dot">·</span>
            <span>{{ t.format }}</span>
          </div>
          <div v-if="t.managerNote" class="row__note">“{{ t.managerNote }}”</div>
        </div>
        <div class="row__right">
          <div class="row__fill">
            <div class="fill__bar">
              <div
                class="fill__inner"
                :style="{ width: `${(t.confirmedCount / t.totalPositions) * 100}%` }"
              />
            </div>
            <div class="fill__label">{{ t.confirmedCount }} / {{ t.totalPositions }} confirmed</div>
          </div>
          <span class="badge" :class="`badge--${statusTone[t.status]}`">{{ t.status }}</span>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.teams { max-width: 1280px; }
.teams__header { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.teams__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-fog); }
.teams__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.teams__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; }

.teams__tabs { display: flex; gap: 6px; margin-bottom: 20px; padding: 4px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; width: fit-content; }
.tab { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: transparent; border: none; border-radius: 999px; cursor: pointer; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-fog); }
.tab.is-active { background: #fff; color: var(--color-ink); font-weight: 600; box-shadow: var(--shadow-sm); }
.tab__count { font-family: var(--font-mono); font-size: 11px; padding: 1px 7px; background: var(--color-hairline); color: var(--color-graphite); border-radius: 999px; }
.tab.is-active .tab__count { background: var(--color-accent-soft); color: var(--color-accent); }

.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; gap: 16px; align-items: center; padding: 16px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; cursor: pointer; transition: border-color 0.15s ease, transform 0.05s ease; }
.row:hover { border-color: var(--color-mute); }
.row:active { transform: scale(0.998); }
.row__left { flex: 1; min-width: 0; }
.row__comp { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.row__title { font-family: var(--font-display); font-size: 17px; font-weight: 600; letter-spacing: -0.005em; color: var(--color-ink); margin: 3px 0; }
.row__meta { display: flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); flex-wrap: wrap; }
.row__meta .dot { opacity: 0.5; }
.row__note { font-family: var(--font-body); font-size: 12px; color: var(--color-graphite); font-style: italic; margin-top: 6px; }
.row__right { display: flex; align-items: center; gap: 16px; flex-shrink: 0; }
.row__fill { width: 180px; text-align: right; }
.fill__bar { height: 6px; background: var(--color-surface); border-radius: 999px; overflow: hidden; margin-bottom: 4px; }
.fill__inner { height: 100%; background: var(--color-ink); border-radius: 999px; transition: width 0.2s ease; }
.fill__label { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }

.tag { display: inline-flex; padding: 2px 8px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.tag--home { background: var(--color-accent-soft); color: var(--color-accent-strong); }
.tag--away { background: var(--color-hairline); color: var(--color-graphite); }

.badge { display: inline-flex; padding: 3px 10px; border-radius: 999px; font-family: var(--font-body); font-size: 11px; font-weight: 600; text-transform: capitalize; }
.badge--ok { background: #DCFCE7; color: #166534; }
.badge--warn { background: #FEF3C7; color: #92400E; }
.badge--info { background: var(--color-accent-soft); color: var(--color-accent-strong); }
.badge--muted { background: var(--color-hairline); color: var(--color-graphite); }

.btn { padding: 9px 14px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
.btn--primary { background: var(--color-ink); color: #fff; }

@media (max-width: 767px) {
  .row { flex-direction: column; align-items: stretch; }
  .row__right { justify-content: space-between; }
  .row__fill { width: auto; flex: 1; text-align: left; }
}
</style>
