<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

type Position = 'Lead' | 'Second' | 'Third' | 'Skip'

interface RinkSlot {
  position: Position
  memberId: string | null
}
interface Rink {
  id: string
  label: string
  slots: RinkSlot[]
}
interface Available {
  id: string
  name: string
  role: string
  playingLevel: 'A' | 'B' | 'C'
  lastPlayed: string
}

const router = useRouter()

const meta = ref({
  competition: 'Pennant Div 3',
  round: 'Round 8',
  opponent: 'Petone A',
  venue: 'home' as 'home' | 'away',
  when: 'Sat 23 Aug · 12:30pm',
  greenClosureNote: '',
})

const rinks = ref<Rink[]>([
  {
    id: 'r1',
    label: 'Rink 1',
    slots: [
      { position: 'Lead', memberId: 'm2' },
      { position: 'Second', memberId: 'm5' },
      { position: 'Third', memberId: 'm3' },
      { position: 'Skip', memberId: 'm1' },
    ],
  },
  {
    id: 'r2',
    label: 'Rink 2',
    slots: [
      { position: 'Lead', memberId: null },
      { position: 'Second', memberId: null },
      { position: 'Third', memberId: null },
      { position: 'Skip', memberId: null },
    ],
  },
])

const available = ref<Available[]>([
  { id: 'm1', name: 'Marcus Tuilagi', role: 'Skip', playingLevel: 'A', lastPlayed: '2d ago' },
  { id: 'm2', name: 'Denise Peters', role: 'Lead', playingLevel: 'A', lastPlayed: '2d ago' },
  { id: 'm3', name: 'Reggie Marcs', role: 'Third', playingLevel: 'A', lastPlayed: '9d ago' },
  { id: 'm4', name: 'Karen Watson', role: 'Skip', playingLevel: 'B', lastPlayed: '9d ago' },
  { id: 'm5', name: 'Sione Vagana', role: 'Second', playingLevel: 'B', lastPlayed: '2d ago' },
  { id: 'm6', name: 'Ella Weir', role: 'Third', playingLevel: 'B', lastPlayed: '3w ago' },
  { id: 'm7', name: 'Jo Kirk', role: 'Lead', playingLevel: 'C', lastPlayed: 'never' },
  { id: 'm8', name: 'Tama Wong', role: 'Second', playingLevel: 'B', lastPlayed: '9d ago' },
  { id: 'm9', name: 'Peter Harding', role: 'Second', playingLevel: 'B', lastPlayed: '2d ago' },
  { id: 'm10', name: 'Aroha Ngata', role: 'Lead', playingLevel: 'C', lastPlayed: 'never' },
])

const assignedIds = computed(() => {
  const set = new Set<string>()
  rinks.value.forEach((r) => r.slots.forEach((s) => s.memberId && set.add(s.memberId)))
  return set
})

const availableFiltered = computed(() =>
  available.value.filter((a) => !assignedIds.value.has(a.id)),
)

const totalSlots = computed(() => rinks.value.reduce((n, r) => n + r.slots.length, 0))
const filledSlots = computed(() =>
  rinks.value.reduce(
    (n, r) => n + r.slots.filter((s) => s.memberId !== null).length,
    0,
  ),
)

const draggingId = ref<string | null>(null)

function onDragStart(id: string) {
  draggingId.value = id
}
function onDrop(rinkIdx: number, slotIdx: number) {
  const id = draggingId.value
  if (!id) return
  const targetRink = rinks.value[rinkIdx]
  if (!targetRink) return
  const targetSlot = targetRink.slots[slotIdx]
  if (!targetSlot) return
  // If the id is already assigned somewhere, clear that first.
  rinks.value.forEach((r) => r.slots.forEach((s) => { if (s.memberId === id) s.memberId = null }))
  targetSlot.memberId = id
  draggingId.value = null
}
function clearSlot(rinkIdx: number, slotIdx: number) {
  const rink = rinks.value[rinkIdx]
  if (!rink) return
  const slot = rink.slots[slotIdx]
  if (!slot) return
  slot.memberId = null
}

function memberById(id: string | null): Available | null {
  if (!id) return null
  return available.value.find((a) => a.id === id) ?? null
}

function addRink() {
  const label = `Rink ${rinks.value.length + 1}`
  rinks.value.push({
    id: `r${Date.now()}`,
    label,
    slots: (['Lead', 'Second', 'Third', 'Skip'] as Position[]).map((p) => ({ position: p, memberId: null })),
  })
}
function removeRink(idx: number) {
  rinks.value.splice(idx, 1)
}

function saveDraft() {
  router.push({ name: 'teams' })
}
function publish() {
  router.push({ name: 'teams' })
}

function goBack() {
  router.push({ name: 'teams' })
}
</script>

<template>
  <div class="ed">
    <button class="ed__back" @click="goBack">← Team selections</button>

    <header class="ed__header">
      <div>
        <div class="ed__eyebrow">{{ meta.competition }} · {{ meta.round }}</div>
        <h1 class="ed__heading">vs {{ meta.opponent }}</h1>
        <div class="ed__meta">
          <span class="tag" :class="`tag--${meta.venue}`">{{ meta.venue }}</span>
          <span>{{ meta.when }}</span>
          <span class="dot">·</span>
          <span>{{ filledSlots }} / {{ totalSlots }} confirmed</span>
        </div>
      </div>
      <div class="ed__actions">
        <button class="btn btn--outline" @click="saveDraft">Save draft</button>
        <button class="btn btn--primary" @click="publish">Publish + notify</button>
      </div>
    </header>

    <div class="ed__board">
      <section class="rinks">
        <div class="rinks__head">
          <div class="rinks__label">Rinks</div>
          <button class="btn btn--ghost" @click="addRink">+ Add rink</button>
        </div>
        <article v-for="(r, i) in rinks" :key="r.id" class="rink">
          <div class="rink__head">
            <h3 class="rink__label">{{ r.label }}</h3>
            <button v-if="rinks.length > 1" class="rink__remove" @click="removeRink(i)">Remove</button>
          </div>
          <div class="rink__slots">
            <div
              v-for="(s, si) in r.slots"
              :key="s.position + si"
              class="slot"
              :class="{ 'slot--filled': s.memberId !== null }"
              @dragover.prevent
              @drop="onDrop(i, si)"
            >
              <div class="slot__position">{{ s.position }}</div>
              <template v-if="memberById(s.memberId)">
                <div class="slot__member">
                  <div class="slot__name">{{ memberById(s.memberId)!.name }}</div>
                  <div class="slot__meta">Level {{ memberById(s.memberId)!.playingLevel }} · Last {{ memberById(s.memberId)!.lastPlayed }}</div>
                </div>
                <button class="slot__clear" @click="clearSlot(i, si)">×</button>
              </template>
              <div v-else class="slot__empty">Drop a member here</div>
            </div>
          </div>
        </article>
      </section>

      <aside class="pool">
        <div class="pool__head">
          <h3 class="pool__label">Available</h3>
          <span class="pool__count">{{ availableFiltered.length }}</span>
        </div>
        <ul class="pool__list">
          <li
            v-for="a in availableFiltered"
            :key="a.id"
            class="chip"
            draggable="true"
            @dragstart="onDragStart(a.id)"
          >
            <div class="chip__avatar">{{ a.name.split(' ').map((s) => s[0]).slice(0,2).join('') }}</div>
            <div class="chip__body">
              <div class="chip__name">{{ a.name }}</div>
              <div class="chip__meta">
                <span>{{ a.role }}</span>
                <span class="dot">·</span>
                <span>Level {{ a.playingLevel }}</span>
                <span class="dot">·</span>
                <span>{{ a.lastPlayed }}</span>
              </div>
            </div>
          </li>
        </ul>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.ed { max-width: 1280px; }
.ed__back { background: transparent; border: 0; padding: 0 0 12px; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); cursor: pointer; }
.ed__back:hover { color: var(--color-ink); }

.ed__header { display: flex; justify-content: space-between; align-items: end; gap: 16px; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--color-hairline); }
.ed__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.ed__heading { font-family: var(--font-display); font-size: 30px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 8px; color: var(--color-ink); }
.ed__meta { display: flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); }
.ed__meta .dot { opacity: 0.5; }
.ed__actions { display: flex; gap: 8px; }

.tag { display: inline-flex; padding: 2px 8px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.tag--home { background: var(--color-accent-soft); color: var(--color-accent-strong); }
.tag--away { background: var(--color-hairline); color: var(--color-graphite); }

.btn { padding: 9px 14px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
.btn--primary { background: var(--color-ink); color: #fff; }
.btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.btn--ghost { background: transparent; color: var(--color-accent); border: 1px dashed var(--color-accent-soft); }

.ed__board { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }

.rinks { display: flex; flex-direction: column; gap: 12px; }
.rinks__head { display: flex; justify-content: space-between; align-items: center; padding: 0 4px; }
.rinks__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }

.rink { padding: 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; }
.rink__head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.rink__label { font-family: var(--font-display); font-size: 18px; font-weight: 700; letter-spacing: -0.01em; margin: 0; color: var(--color-ink); }
.rink__remove { background: transparent; border: 0; font-family: var(--font-body); font-size: 12px; color: var(--color-danger); cursor: pointer; }

.rink__slots { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.slot { display: grid; grid-template-columns: 60px 1fr auto; gap: 12px; align-items: center; padding: 12px 14px; border: 1px dashed var(--color-hairline); border-radius: 10px; background: var(--color-surface); min-height: 60px; }
.slot--filled { background: #fff; border-style: solid; }
.slot__position { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.slot__member { min-width: 0; }
.slot__name { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.slot__meta { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 2px; }
.slot__clear { background: transparent; border: 0; color: var(--color-mute); font-size: 16px; cursor: pointer; padding: 0 4px; }
.slot__clear:hover { color: var(--color-danger); }
.slot__empty { font-family: var(--font-body); font-size: 12px; font-style: italic; color: var(--color-mute); }

.pool { padding: 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; position: sticky; top: 24px; max-height: calc(100vh - 60px); overflow-y: auto; }
.pool__head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.pool__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); margin: 0; }
.pool__count { font-family: var(--font-mono); font-size: 11px; padding: 1px 8px; background: var(--color-hairline); color: var(--color-graphite); border-radius: 999px; }
.pool__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }

.chip { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 10px; cursor: grab; background: #fff; }
.chip:hover { border-color: var(--color-mute); }
.chip:active { cursor: grabbing; }
.chip__avatar { width: 32px; height: 32px; border-radius: 999px; background: var(--color-graphite); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-body); font-size: 11px; font-weight: 700; }
.chip__body { flex: 1; min-width: 0; }
.chip__name { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.chip__meta { display: flex; gap: 6px; font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }
.chip__meta .dot { opacity: 0.5; }

@media (max-width: 900px) {
  .ed__board { grid-template-columns: 1fr; }
  .pool { position: static; max-height: none; }
  .rink__slots { grid-template-columns: 1fr; }
}
</style>
