<script setup lang="ts">
import { ref, computed } from 'vue'

type Tab = 'upcoming' | 'past'
type Format = 'singles' | 'pairs' | 'triples' | 'fours' | 'social'

interface EventRow {
  id: string
  title: string
  format: Format
  startsAt: string
  endsAt: string
  location: string
  rsvpYes: number
  rsvpMaybe: number
  capacity: number
  isPublished: boolean
}

const activeTab = ref<Tab>('upcoming')

const events = ref<EventRow[]>([
  { id: 'e1', title: "Champion of Champions — Round 1", format: 'singles', startsAt: 'Sat 22 Aug · 9:00 AM', endsAt: '1:00 PM', location: 'Green 1', rsvpYes: 24, rsvpMaybe: 4, capacity: 32, isPublished: true },
  { id: 'e2', title: 'Twilight Triples', format: 'triples', startsAt: 'Wed 26 Aug · 5:30 PM', endsAt: '8:30 PM', location: 'Green 2 & 3', rsvpYes: 18, rsvpMaybe: 6, capacity: 24, isPublished: true },
  { id: 'e3', title: 'Ladies Open Fours', format: 'fours', startsAt: 'Sat 5 Sep · 10:00 AM', endsAt: '4:00 PM', location: 'All greens', rsvpYes: 12, rsvpMaybe: 8, capacity: 40, isPublished: true },
  { id: 'e4', title: 'Sunday Social Roll-up', format: 'social', startsAt: 'Sun 13 Sep · 1:00 PM', endsAt: '4:00 PM', location: 'Green 1', rsvpYes: 8, rsvpMaybe: 3, capacity: 20, isPublished: false },
  { id: 'e5', title: 'Mid-week Mens Pairs', format: 'pairs', startsAt: 'Thu 6 Aug · 6:00 PM', endsAt: '9:00 PM', location: 'Green 2', rsvpYes: 22, rsvpMaybe: 0, capacity: 24, isPublished: true },
])

const filtered = computed(() =>
  activeTab.value === 'upcoming'
    ? events.value.filter(e => !e.title.startsWith('Mid-week'))
    : events.value.filter(e => e.title.startsWith('Mid-week')),
)

const formatColour: Record<Format, string> = {
  singles: 'var(--color-feature-mint)',
  pairs: 'var(--color-accent)',
  triples: 'var(--color-feature-tangerine)',
  fours: 'var(--color-feature-violet)',
  social: 'var(--color-graphite)',
}

function fillPct(e: EventRow): number {
  return Math.min(100, Math.round(((e.rsvpYes + e.rsvpMaybe) / e.capacity) * 100))
}
</script>

<template>
  <div class="events">
    <header class="events__header">
      <div>
        <div class="events__eyebrow">Whats on</div>
        <h1 class="events__heading">Events</h1>
        <p class="events__sub">{{ events.length }} scheduled — {{ events.filter(e => e.isPublished).length }} live on your site.</p>
      </div>
      <div class="events__actions">
        <button class="btn btn--ghost">View calendar</button>
        <button class="btn btn--primary">+ New event</button>
      </div>
    </header>

    <div class="toolbar">
      <div class="tabs">
        <button class="tab" :class="{ 'is-active': activeTab === 'upcoming' }" @click="activeTab = 'upcoming'">Upcoming</button>
        <button class="tab" :class="{ 'is-active': activeTab === 'past' }" @click="activeTab = 'past'">Past</button>
      </div>
      <input class="search" placeholder="Filter events…" />
    </div>

    <ul class="list">
      <li v-for="e in filtered" :key="e.id" class="event">
        <div class="event__format" :style="{ background: formatColour[e.format] }" />
        <div class="event__main">
          <div class="event__title-row">
            <h3 class="event__title">{{ e.title }}</h3>
            <span v-if="!e.isPublished" class="event__pill event__pill--draft">Draft</span>
          </div>
          <div class="event__meta">
            <span>{{ e.startsAt }} — {{ e.endsAt }}</span>
            <span class="event__sep">·</span>
            <span>{{ e.location }}</span>
            <span class="event__sep">·</span>
            <span class="event__format-label">{{ e.format }}</span>
          </div>
        </div>
        <div class="event__rsvp">
          <div class="event__rsvp-count">{{ e.rsvpYes }}<span class="event__rsvp-cap">/{{ e.capacity }}</span></div>
          <div class="event__rsvp-bar">
            <div class="event__rsvp-fill" :style="{ width: fillPct(e) + '%' }" />
          </div>
          <div class="event__rsvp-label">{{ e.rsvpMaybe }} maybe</div>
        </div>
        <div class="event__actions">
          <button class="event__btn">Manage</button>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.events { max-width: 1080px; }
.events__header { display: flex; align-items: end; justify-content: space-between; margin-bottom: 24px; gap: 16px; }
.events__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.events__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.events__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; }
.events__actions { display: flex; gap: 8px; }

.btn { padding: 9px 14px; border: none; border-radius: 10px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; }
.btn--primary { background: var(--color-ink); color: #fff; }
.btn--ghost { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }

.toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; gap: 12px; }
.tabs { display: flex; gap: 6px; padding: 4px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; }
.tab { padding: 7px 16px; background: transparent; border: none; border-radius: 999px; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); cursor: pointer; }
.tab.is-active { background: #fff; color: var(--color-ink); font-weight: 600; box-shadow: var(--shadow-sm); }
.search { padding: 9px 14px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; min-width: 240px; }

.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.event { display: flex; align-items: center; gap: 20px; padding: 16px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; }
.event__format { width: 4px; height: 44px; border-radius: 2px; }
.event__main { flex: 1; min-width: 0; }
.event__title-row { display: flex; align-items: center; gap: 8px; }
.event__title { font-family: var(--font-display); font-size: 17px; font-weight: 600; color: var(--color-ink); margin: 0; }
.event__pill { padding: 2px 8px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
.event__pill--draft { background: var(--color-surface); color: var(--color-fog); border: 1px solid var(--color-hairline); }
.event__meta { display: flex; gap: 8px; align-items: center; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 4px; }
.event__sep { opacity: 0.5; }
.event__format-label { text-transform: capitalize; font-weight: 500; }
.event__rsvp { min-width: 140px; text-align: right; }
.event__rsvp-count { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--color-ink); }
.event__rsvp-cap { font-family: var(--font-mono); font-size: 12px; font-weight: 500; color: var(--color-fog); margin-left: 2px; }
.event__rsvp-bar { height: 4px; background: var(--color-hairline); border-radius: 2px; margin: 4px 0 4px; overflow: hidden; }
.event__rsvp-fill { height: 100%; background: var(--color-accent); border-radius: 2px; }
.event__rsvp-label { font-family: var(--font-body); font-size: 10px; color: var(--color-fog); letter-spacing: 0.06em; text-transform: uppercase; }
.event__actions { flex-shrink: 0; }
.event__btn { padding: 8px 14px; background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; }

@media (max-width: 767px) {
  .events__header { flex-direction: column; align-items: stretch; gap: 12px; }
  .events__actions { display: none; }
  .events__heading { font-size: 28px; }
  .toolbar { flex-direction: column; align-items: stretch; gap: 8px; }
  .search { min-width: 0; width: 100%; }
  .tabs { width: 100%; justify-content: space-between; }
  .tab { flex: 1; text-align: center; }
  .event { flex-wrap: wrap; gap: 12px; padding: 14px 16px; }
  .event__format { height: 36px; }
  .event__main { flex-basis: calc(100% - 20px); min-width: 0; }
  .event__title { font-size: 15px; }
  .event__meta { flex-wrap: wrap; gap: 6px; font-size: 11px; }
  .event__rsvp { flex: 1; text-align: left; min-width: 0; }
  .event__rsvp-count { font-size: 18px; }
  .event__actions { flex-shrink: 0; }
  .event__btn { padding: 7px 12px; font-size: 11px; }
}
</style>
