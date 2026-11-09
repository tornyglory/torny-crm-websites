<script setup lang="ts">
/**
 * Tournament results editor — sport-flexibility brief §6.
 *
 * One row per entry. Admin fills position / placement label / prize /
 * won / notes. "Mark tournament complete" checkbox at the bottom
 * flips `tournament.status` atomically with the save.
 *
 * Prize is entered in dollars; converted to cents on submit.
 *
 * Save always sends every row in the table — including unplaced ones
 * — so the backend can detect "admin cleared this result" by seeing a
 * row with position=null + won=false land where there was a value
 * before.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ApiError,
  tournaments as tournamentsApi,
  tournamentResults,
  type Tournament,
  type TournamentResultEntry,
  type TournamentResultInput,
} from '@torny/api-client'
import { useToast } from '@/composables/useToast'
import { useClubStore } from '@/stores/club'
import CrmSpinner from '@/components/CrmSpinner.vue'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const clubStore = useClubStore()

const tournamentId = computed(() => {
  const raw = route.params.id
  const id = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isFinite(id) ? id : null
})

const tournament = ref<Tournament | null>(null)
const entries = ref<TournamentResultEntry[]>([])
/** Per-entry editor state, keyed by entry_id. Dollars in `prize`
 *  (not cents) so the input renders naturally. */
interface RowDraft {
  position: string
  placement_label: string
  prize: string
  won: boolean
  notes: string
}
const drafts = reactive<Record<number, RowDraft>>({})
const markComplete = ref(false)
const loading = ref(false)
const saving = ref(false)

const tournamentComplete = computed(() => tournament.value?.status === 'complete')

function emptyDraft(): RowDraft {
  return { position: '', placement_label: '', prize: '', won: false, notes: '' }
}

function seedDraft(entry: TournamentResultEntry) {
  const r = entry.result
  drafts[entry.entry_id] = r
    ? {
        position: r.position == null ? '' : String(r.position),
        placement_label: r.placement_label ?? '',
        // cents → dollars, trimming trailing .00 for display.
        prize: r.prize_money_cents > 0
          ? (r.prize_money_cents / 100).toFixed(2).replace(/\.00$/, '')
          : '',
        won: r.won === true,
        notes: r.notes ?? '',
      }
    : emptyDraft()
}

async function load() {
  const cid = clubStore.current?.id
  const tid = tournamentId.value
  if (typeof cid !== 'number' || tid == null) return
  loading.value = true
  try {
    const [t, rs] = await Promise.all([
      tournamentsApi.get(cid, tid),
      tournamentResults.get(cid, tid),
    ])
    tournament.value = t
    // Seed drafts BEFORE handing entries to the template — otherwise the
    // v-for first-pass accesses drafts[entry_id].position before the
    // forEach runs on the same tick and crashes on a null read.
    for (const key of Object.keys(drafts)) delete drafts[Number(key)]
    rs.entries.forEach(seedDraft)
    entries.value = rs.entries
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not load results.')
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => clubStore.current?.id, load)
watch(tournamentId, load)

// v-model on <input type="number"> casts to a Number once the user has
// typed — the draft fields are therefore string | number | null in
// practice. Both helpers coerce defensively.
function parsePositive(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const s = typeof value === 'string' ? value.trim() : String(value)
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function priceToCents(value: unknown): number {
  if (value === null || value === undefined) return 0
  const s = typeof value === 'string' ? value.trim() : String(value)
  if (s === '') return 0
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

async function save() {
  const cid = clubStore.current?.id
  const tid = tournamentId.value
  if (typeof cid !== 'number' || tid == null || saving.value) return

  const payload: TournamentResultInput[] = entries.value.map((e) => {
    const d = drafts[e.entry_id] ?? emptyDraft()
    const position = parsePositive(d.position)
    return {
      entry_id: e.entry_id,
      position,
      placement_label: d.placement_label.trim() === '' ? null : d.placement_label.trim(),
      prize_money_cents: priceToCents(d.prize),
      won: d.won === true,
      notes: d.notes.trim() === '' ? null : d.notes.trim(),
    }
  })

  saving.value = true
  try {
    const next = await tournamentResults.submit(cid, tid, {
      results: payload,
      mark_complete: markComplete.value || undefined,
    })
    // Same seeding order as load(): drafts first, then entries.
    for (const key of Object.keys(drafts)) delete drafts[Number(key)]
    next.entries.forEach(seedDraft)
    entries.value = next.entries
    if (next.tournament_status && tournament.value) {
      tournament.value = { ...tournament.value, status: next.tournament_status as Tournament['status'] }
    }
    markComplete.value = false
    toast.success('Results saved.')
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not save results.')
  } finally {
    saving.value = false
  }
}

function goBack() {
  const tid = tournamentId.value
  if (tid != null) router.push({ name: 'tournament-detail', params: { id: tid } })
  else router.push({ name: 'tournaments' })
}

function teamLabel(entry: TournamentResultEntry): string {
  return entry.team_name ?? (entry.captain_email ?? `Entry ${entry.entry_number}`)
}
</script>

<template>
  <div class="tr">
    <header class="tr__head">
      <button class="crumb" @click="goBack">← Tournament</button>
      <div class="tr__title-row">
        <div class="tr__title-wrap">
          <div class="tr__title-line">
            <h1 class="tr__title">Results</h1>
            <span v-if="tournamentComplete" class="tr__pill tr__pill--mint">
              <span class="tr__pill-dot"></span>
              complete
            </span>
          </div>
          <div class="tr__meta" v-if="tournament">
            <span>{{ tournament.title }}</span>
            <span class="tr__meta-dot">·</span>
            <span>{{ entries.length }} entr{{ entries.length === 1 ? 'y' : 'ies' }}</span>
          </div>
        </div>
      </div>
    </header>

    <div class="tr__body">
      <div v-if="loading && entries.length === 0" class="tr__loading">Loading entries…</div>
      <div v-else-if="entries.length === 0" class="tr__empty">
        <div class="tr__empty-title">No entries yet.</div>
        <div class="tr__empty-sub">Once teams confirm their entry, they’ll appear here for result entry.</div>
      </div>
      <div v-else class="tr__table">
        <div class="tr__table-head">
          <div class="tr__col tr__col--num">#</div>
          <div class="tr__col tr__col--team">TEAM</div>
          <div class="tr__col tr__col--pos">POSITION</div>
          <div class="tr__col tr__col--label">PLACEMENT</div>
          <div class="tr__col tr__col--prize">PRIZE ($)</div>
          <div class="tr__col tr__col--won">WON</div>
          <div class="tr__col tr__col--notes">NOTES</div>
        </div>
        <table class="tr__rows" aria-label="Tournament results">
          <tbody>
            <tr
              v-for="entry in entries"
              :key="entry.entry_id"
              class="tr__row"
              :class="{ 'tr__row--placed': drafts[entry.entry_id]?.won || parsePositive(drafts[entry.entry_id]?.position ?? '') !== null }"
            >
              <td class="tr__col tr__col--num">{{ entry.entry_number }}</td>
              <td class="tr__col tr__col--team">
                <div class="tr__team-name">{{ teamLabel(entry) }}</div>
                <div class="tr__team-sub" v-if="entry.captain_email">{{ entry.captain_email }}</div>
              </td>
              <td class="tr__col tr__col--pos">
                <label class="tr__sr">Position</label>
                <input
                  v-model="drafts[entry.entry_id]!.position"
                  type="number"
                  min="1"
                  inputmode="numeric"
                  class="tr__input tr__input--num"
                  placeholder="—"
                  :aria-label="`Position for ${teamLabel(entry)}`"
                />
              </td>
              <td class="tr__col tr__col--label">
                <label class="tr__sr">Placement</label>
                <input
                  v-model="drafts[entry.entry_id]!.placement_label"
                  type="text"
                  maxlength="60"
                  class="tr__input"
                  placeholder="Champion / Runner-up / …"
                  :aria-label="`Placement label for ${teamLabel(entry)}`"
                />
              </td>
              <td class="tr__col tr__col--prize">
                <label class="tr__sr">Prize</label>
                <input
                  v-model="drafts[entry.entry_id]!.prize"
                  type="number"
                  min="0"
                  step="0.01"
                  inputmode="decimal"
                  class="tr__input tr__input--num"
                  placeholder="0"
                  :aria-label="`Prize money for ${teamLabel(entry)}`"
                />
              </td>
              <td class="tr__col tr__col--won">
                <label class="tr__check">
                  <input
                    v-model="drafts[entry.entry_id]!.won"
                    type="checkbox"
                  />
                  <span>Won</span>
                </label>
              </td>
              <td class="tr__col tr__col--notes">
                <label class="tr__sr">Notes</label>
                <input
                  v-model="drafts[entry.entry_id]!.notes"
                  type="text"
                  maxlength="280"
                  class="tr__input"
                  placeholder="Optional notes"
                  :aria-label="`Notes for ${teamLabel(entry)}`"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer class="tr__footer" v-if="entries.length > 0">
        <label class="tr__complete">
          <input
            v-model="markComplete"
            type="checkbox"
            :disabled="tournamentComplete"
          />
          <span>Mark tournament complete</span>
          <span class="tr__complete-hint" v-if="tournamentComplete">(already complete)</span>
        </label>
        <div class="tr__footer-actions">
          <button
            type="button"
            class="primary-btn"
            :disabled="saving"
            @click="save"
          >
            <CrmSpinner v-if="saving" size="sm" label="Saving" />
            <span>{{ saving ? 'Saving…' : 'Save results' }}</span>
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.tr { padding: 24px; max-width: 1200px; margin: 0 auto; }

.tr__head { padding-bottom: 0; margin-bottom: 24px; }
.crumb { background: transparent; border: 0; padding: 0 0 12px; color: var(--color-fog); font-family: var(--font-body); font-size: 12px; font-weight: 500; cursor: pointer; }
.crumb:hover { color: var(--color-ink); }
.tr__title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.tr__title-line { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; flex-wrap: wrap; }
.tr__title { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: 0; }
.tr__pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; }
.tr__pill--mint { background: color-mix(in srgb, var(--color-mint) 14%, transparent); color: var(--color-mint); }
.tr__pill-dot { width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
.tr__meta { display: flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); flex-wrap: wrap; }
.tr__meta-dot { opacity: 0.5; }

.tr__loading, .tr__empty { padding: 48px 24px; text-align: center; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; color: var(--color-fog); }
.tr__empty-title { font-family: var(--font-display); font-size: 18px; color: var(--color-ink); margin-bottom: 6px; }
.tr__empty-sub { font-size: 13px; }

.tr__table { background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; overflow: hidden; }
.tr__table-head { display: grid; grid-template-columns: 48px minmax(180px, 1.4fr) 100px 1fr 110px 90px 1.4fr; gap: 12px; padding: 12px 20px; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); font-weight: 600; background: var(--color-surface); border-bottom: 1px solid var(--color-hairline); align-items: center; }
.tr__rows { width: 100%; border-collapse: collapse; }
.tr__row { display: grid; grid-template-columns: 48px minmax(180px, 1.4fr) 100px 1fr 110px 90px 1.4fr; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--color-hairline); align-items: center; }
.tr__row:last-child { border-bottom: 0; }
.tr__row--placed { background: color-mix(in srgb, var(--color-mint) 5%, transparent); }
.tr__col { font-family: var(--font-body); font-size: 12px; color: var(--color-graphite); min-width: 0; }
.tr__col--num { font-family: var(--font-mono); color: var(--color-fog); }
.tr__team-name { font-weight: 600; color: var(--color-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tr__team-sub { font-size: 11px; color: var(--color-fog); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.tr__input { width: 100%; padding: 6px 10px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-ink); background: #fff; box-sizing: border-box; }
.tr__input:focus { outline: 2px solid color-mix(in srgb, var(--color-ink) 20%, transparent); outline-offset: 1px; border-color: var(--color-ink); }
.tr__input--num { text-align: left; }

.tr__check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; }
.tr__check input { cursor: pointer; }

.tr__sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

.tr__footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 20px; padding: 16px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; flex-wrap: wrap; }
.tr__complete { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); cursor: pointer; }
.tr__complete input { cursor: pointer; }
.tr__complete-hint { color: var(--color-fog); font-size: 11px; }
.tr__footer-actions { display: flex; gap: 8px; }
.primary-btn { padding: 10px 18px; background: var(--color-ink); color: #fff; border: 0; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; }
.primary-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
