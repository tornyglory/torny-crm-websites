<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import CrmModal from '@/components/modals/CrmModal.vue'
import { useToast } from '@/composables/useToast'

const toast = useToast()

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

// ── New event modal ────────────────────────────────────────────
const createOpen = ref(false)
const emptyForm = () => ({
  title: '',
  format: 'social' as Format,
  date: '',
  startTime: '',
  endTime: '',
  location: '',
  capacity: 24,
  publishNow: true,
  syncCalendar: true,
})
const form = reactive(emptyForm())

function openCreate() {
  Object.assign(form, emptyForm())
  createOpen.value = true
}
function closeCreate() { createOpen.value = false }

const canSubmit = computed(
  () => form.title.trim().length > 0 && form.date.length > 0 && form.startTime.length > 0,
)

function submit() {
  if (!canSubmit.value) return
  const startsAt = `${form.date} · ${form.startTime}`
  const endsAt = form.endTime ? form.endTime : 'TBC'
  events.value.unshift({
    id: `e${Date.now()}`,
    title: form.title.trim(),
    format: form.format,
    startsAt,
    endsAt,
    location: form.location.trim() || 'TBC',
    rsvpYes: 0,
    rsvpMaybe: 0,
    capacity: Number(form.capacity) || 0,
    isPublished: form.publishNow,
  })
  closeCreate()
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
        <button class="btn btn--ghost" @click="toast.info('Calendar view opens next session.')">View calendar</button>
        <button class="btn btn--primary" @click="openCreate">+ New event</button>
      </div>
    </header>

    <div class="toolbar">
      <div class="tabs">
        <button class="tab" :class="{ 'is-active': activeTab === 'upcoming' }" @click="activeTab = 'upcoming'">Upcoming</button>
        <button class="tab" :class="{ 'is-active': activeTab === 'past' }" @click="activeTab = 'past'">Past</button>
      </div>
      <input class="search" placeholder="Filter events…" />
    </div>

    <CrmModal
      :open="createOpen"
      eyebrow="Events"
      title="Create an event"
      width="md"
      @close="closeCreate"
    >
      <form class="form" @submit.prevent="submit">
        <label class="field">
          <span class="field__label">Title</span>
          <input v-model="form.title" type="text" placeholder="Twilight Triples" autofocus />
        </label>
        <div class="form__row">
          <label class="field">
            <span class="field__label">Format</span>
            <select v-model="form.format">
              <option value="singles">Singles</option>
              <option value="pairs">Pairs</option>
              <option value="triples">Triples</option>
              <option value="fours">Fours</option>
              <option value="social">Social roll-up</option>
            </select>
          </label>
          <label class="field">
            <span class="field__label">Capacity</span>
            <input v-model.number="form.capacity" type="number" min="1" />
          </label>
        </div>
        <div class="form__row form__row--three">
          <label class="field">
            <span class="field__label">Date</span>
            <input v-model="form.date" type="text" placeholder="Sat 13 Sep" />
          </label>
          <label class="field">
            <span class="field__label">Starts</span>
            <input v-model="form.startTime" type="text" placeholder="9:00 AM" />
          </label>
          <label class="field">
            <span class="field__label">Ends</span>
            <input v-model="form.endTime" type="text" placeholder="1:00 PM" />
          </label>
        </div>
        <label class="field">
          <span class="field__label">Location</span>
          <input v-model="form.location" type="text" placeholder="Green 1 & 2" />
        </label>

        <div class="switch-row">
          <div>
            <div class="switch-row__label">Publish to public site immediately</div>
            <div class="switch-row__hint">Off = save as draft. You can still add fields.</div>
          </div>
          <button type="button" class="switch" :class="{ 'is-on': form.publishNow }" @click="form.publishNow = !form.publishNow"><span class="switch__knob" /></button>
        </div>
        <div class="switch-row">
          <div>
            <div class="switch-row__label">Sync to club calendar</div>
            <div class="switch-row__hint">Requires the Google Calendar integration to be connected.</div>
          </div>
          <button type="button" class="switch" :class="{ 'is-on': form.syncCalendar }" @click="form.syncCalendar = !form.syncCalendar"><span class="switch__knob" /></button>
        </div>
      </form>

      <template #footer>
        <button type="button" class="modal-btn modal-btn--outline" @click="closeCreate">Cancel</button>
        <button type="button" class="modal-btn modal-btn--primary" :disabled="!canSubmit" @click="submit">Create event</button>
      </template>
    </CrmModal>

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
          <button class="event__btn" @click="toast.info(`Managing ${e.title} — event editor opens next session.`)">Manage</button>
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

/* Modal form */
.form { display: flex; flex-direction: column; gap: 14px; }
.form__row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form__row--three { grid-template-columns: 1fr 1fr 1fr; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.field input, .field select { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; }
.field input:focus, .field select:focus { outline: none; border-color: var(--color-ink); }
.switch-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 0; border-top: 1px solid var(--color-hairline); }
.switch-row__label { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.switch-row__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; }
.switch { width: 40px; height: 24px; padding: 3px; border-radius: 999px; background: var(--color-hairline); border: 0; display: flex; cursor: pointer; flex-shrink: 0; }
.switch.is-on { background: var(--color-ink); }
.switch__knob { width: 18px; height: 18px; border-radius: 999px; background: #fff; transition: transform 0.15s ease; }
.switch.is-on .switch__knob { transform: translateX(16px); }
.modal-btn { padding: 9px 16px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: 0; }
.modal-btn--primary { background: var(--color-ink); color: #fff; }
.modal-btn--primary:hover:not(:disabled) { background: var(--color-graphite); }
.modal-btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
.modal-btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }

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
  .form__row, .form__row--three { grid-template-columns: 1fr; }
}
</style>
