<script setup lang="ts">
/**
 * Team selection editor — brief 74.
 *
 * Two modes on the same route:
 *   - `/crm/teams/new` renders a fixture-create form. On submit, POSTs
 *     to `teamSelections.create` and router.replace()s to the new id so
 *     browser back doesn't bring the user to a now-stale empty form.
 *   - `/crm/teams/:id` fetches the full selection + roster pool, lets
 *     the admin drag pool chips onto rink slots, and autosaves the
 *     roster via a debounced PATCH (800ms after the last change).
 *
 * Roster edits lock when `status = 'sent'` — admin must `reopen` first,
 * matching the backend's 409 `selection_sent`. Publish opens a modal
 * for an optional manager message and surfaces the notify_summary
 * echoed back by the server.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ApiError,
  members as membersApi,
  teamSelections,
  type FormatShape,
  type NotifySummary,
  type RosterMember,
  type TeamSelection,
  type TeamSelectionMemberSnapshot,
  type TeamSelectionPosition,
  type TeamSelectionRink,
  type TeamSelectionVenue,
  type UpdateRosterInput,
} from '@torny/api-client'
import { useToast } from '@/composables/useToast'
import { useClubStore } from '@/stores/club'
import CrmModal from '@/components/modals/CrmModal.vue'
import TornySelect from '@/components/TornySelect.vue'
import TornyDatePicker from '@/components/TornyDatePicker.vue'
import TornyTimePicker from '@/components/TornyTimePicker.vue'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const clubStore = useClubStore()

const idParam = computed(() => {
  const raw = route.params.id
  return Array.isArray(raw) ? raw[0] : raw
})
const isNew = computed(() => idParam.value === 'new')
const selectionId = computed(() => {
  if (isNew.value) return null
  const n = Number(idParam.value)
  return Number.isFinite(n) ? n : null
})

// ── Detail state ──────────────────────────────────────────────

const selection = ref<TeamSelection | null>(null)
const rinks = ref<TeamSelectionRink[]>([])
const loading = ref(false)

const pool = ref<RosterMember[]>([])
const poolLoading = ref(false)

const saving = ref(false)
const pendingSave = ref<ReturnType<typeof setTimeout> | null>(null)
const SAVE_DEBOUNCE_MS = 800

const publishOpen = ref(false)
const publishMessage = ref('')
const publishing = ref(false)
const lastNotifySummary = ref<NotifySummary | null>(null)

const cancelOpen = ref(false)
const cancelReason = ref('')
const cancellingSel = ref(false)

const kebabOpen = ref(false)

const isSent = computed(() => selection.value?.status === 'sent')
const isCancelled = computed(() => selection.value?.status === 'cancelled')
const isPlayed = computed(() => selection.value?.status === 'played')
const readOnly = computed(() => isSent.value || isCancelled.value || isPlayed.value)

const filledSlots = computed(() =>
  rinks.value.reduce((n, r) => n + r.slots.filter((s) => s.member != null).length, 0),
)
const totalSlots = computed(() => rinks.value.reduce((n, r) => n + r.slots.length, 0))

const assignedIds = computed(() => {
  const set = new Set<number>()
  for (const r of rinks.value) for (const s of r.slots) if (s.member) set.add(s.member.user_id)
  return set
})

const availablePool = computed(() =>
  pool.value.filter((m) => !assignedIds.value.has(m.user_id)),
)

// ── Loaders ───────────────────────────────────────────────────

async function loadDetail() {
  const cid = clubStore.current?.id
  const sid = selectionId.value
  if (typeof cid !== 'number' || sid == null) return
  loading.value = true
  try {
    const s = await teamSelections.get(cid, sid)
    selection.value = s
    rinks.value = cloneRinks(s.rinks)
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not load the selection.')
  } finally {
    loading.value = false
  }
}

async function loadPool() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  poolLoading.value = true
  try {
    const res = await membersApi.listRoster(cid, { status: 'active', limit: 200, include_invites: false })
    pool.value = res.members
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not load the roster.')
  } finally {
    poolLoading.value = false
  }
}

onMounted(() => {
  if (isNew.value) return  // create mode — nothing to fetch
  loadDetail()
  loadPool()
})

watch(selectionId, (id) => {
  if (id != null) {
    loadDetail()
    loadPool()
  }
})

onBeforeUnmount(() => {
  if (pendingSave.value) clearTimeout(pendingSave.value)
})

function cloneRinks(src: TeamSelectionRink[]): TeamSelectionRink[] {
  return src.map((r) => ({
    ...r,
    slots: r.slots.map((s) => ({ ...s, member: s.member ? { ...s.member } : null })),
  }))
}

function memberToSnapshot(m: RosterMember): TeamSelectionMemberSnapshot {
  return {
    user_id: m.user_id,
    name: m.name,
    preferred_position: (m.preferred_position ?? null) as TeamSelectionPosition | null,
    playing_level: m.playing_level ?? null,
    last_played_at: m.last_played_at ?? null,
    avatar_url: m.avatar_url,
  }
}

// ── Drag + drop + clear ───────────────────────────────────────

const draggingId = ref<number | null>(null)

function onDragStart(memberId: number) {
  if (readOnly.value) return
  draggingId.value = memberId
}
function onDrop(rinkIdx: number, slotIdx: number) {
  if (readOnly.value) return
  const id = draggingId.value
  if (id == null) return
  const targetRink = rinks.value[rinkIdx]
  const targetSlot = targetRink?.slots[slotIdx]
  if (!targetRink || !targetSlot) return
  // Prefer the pool row (fresh roster data) but fall back to a slot
  // snapshot when the member isn't visible in the pool — e.g. the admin
  // is shuffling an already-placed player between rinks.
  const poolHit = pool.value.find((p) => p.user_id === id)
  const slotHit = poolHit
    ? null
    : rinks.value.flatMap((r) => r.slots).find((s) => s.member?.user_id === id)?.member ?? null
  const snapshot: TeamSelectionMemberSnapshot | null = poolHit
    ? memberToSnapshot(poolHit)
    : slotHit
  if (!snapshot) return
  // Clear id from any other slot first — one picker, one place.
  for (const r of rinks.value) for (const s of r.slots) if (s.member?.user_id === id) s.member = null
  targetSlot.member = snapshot
  draggingId.value = null
  scheduleSave()
}
function clearSlot(rinkIdx: number, slotIdx: number) {
  if (readOnly.value) return
  const slot = rinks.value[rinkIdx]?.slots[slotIdx]
  if (!slot) return
  slot.member = null
  scheduleSave()
}

// ── Rink add/remove ───────────────────────────────────────────

function addRink() {
  if (readOnly.value || !selection.value) return
  const nextPosition = rinks.value.length
  // Mirror the slot shape of the last team so positions stay consistent
  // within a selection. If there's no template yet, seed a single blank
  // slot — the admin can rename it + add more as the sport dictates.
  const template = rinks.value[rinks.value.length - 1]
  const slotShape: Array<{ position: TeamSelectionPosition; slot_order: number }> = template
    ? template.slots.map((s) => ({ position: s.position, slot_order: s.slot_order }))
    : [{ position: '', slot_order: 0 }]
  rinks.value.push({
    id: nextTempId(),
    position: nextPosition,
    label: `Team ${nextPosition + 1}`,
    slots: slotShape.map((s, i) => ({
      id: nextTempId() - i - 1,
      position: s.position,
      slot_order: s.slot_order,
      member: null,
      notified_member_id: null,
      notified_at: null,
    })),
  })
  scheduleSave()
}

function removeRink(idx: number) {
  if (readOnly.value) return
  rinks.value.splice(idx, 1)
  scheduleSave()
}

/** Append a blank slot to a team. Sport-agnostic — admin names the
 *  position inline. */
function addSlot(rinkIdx: number) {
  if (readOnly.value) return
  const rink = rinks.value[rinkIdx]
  if (!rink) return
  rink.slots.push({
    id: nextTempId(),
    position: '',
    slot_order: rink.slots.length,
    member: null,
    notified_member_id: null,
    notified_at: null,
  })
  scheduleSave()
}

/** Remove a slot from a team. Re-indexes slot_order so the server-side
 *  diff doesn't see gaps. If the slot had a member they drop back into
 *  the available pool automatically (pool is derived from occupancy). */
function removeSlot(rinkIdx: number, slotIdx: number) {
  if (readOnly.value) return
  const rink = rinks.value[rinkIdx]
  if (!rink || rink.slots.length <= 1) return
  rink.slots.splice(slotIdx, 1)
  rink.slots.forEach((s, i) => { s.slot_order = i })
  scheduleSave()
}

/** Legacy records persist labels like `Rink 1`, `Rink 2` from the
 *  pre-wording-change era. Treat them as unnamed so the UI shows
 *  `Team N` instead. Trimmed empty strings also fall back. */
function teamDisplayName(label: string | null | undefined, idx: number): string {
  const trimmed = (label ?? '').trim()
  if (!trimmed) return `Team ${idx + 1}`
  if (/^Rink\s+\d+$/i.test(trimmed)) return `Team ${idx + 1}`
  return trimmed
}

/** The raw value shown inside the editable input. Legacy `Rink N`
 *  labels show as empty so the placeholder (`Team N`) takes over —
 *  that way the admin isn't editing a string we're trying to deprecate.
 *  Empty strings stay empty so deleting the name doesn't snap back to
 *  the placeholder-as-value during a keystroke. */
function teamEditValue(label: string | null | undefined): string {
  const raw = label ?? ''
  if (/^Rink\s+\d+$/i.test(raw.trim())) return ''
  return raw
}

function onTeamNameInput(idx: number, event: Event) {
  const rink = rinks.value[idx]
  if (!rink) return
  rink.label = (event.target as HTMLInputElement).value
  scheduleSave()
}

/** Trim + collapse multiple spaces when the admin moves away from the
 *  field. Keeps whatever they typed; empty strings persist as empty and
 *  the display falls back to `Team N`. */
function onTeamNameBlur(idx: number) {
  const rink = rinks.value[idx]
  if (!rink) return
  const next = (rink.label ?? '').replace(/\s+/g, ' ').trim()
  if (next !== rink.label) {
    rink.label = next
    scheduleSave()
  }
}

/** Display fallback for a slot position in read-only mode — empty →
 *  `Player N`. Keeps the output sport-agnostic. */
function slotDisplayName(position: string | null | undefined, idx: number): string {
  const trimmed = (position ?? '').trim()
  return trimmed || `Player ${idx + 1}`
}

/** Raw value shown inside the editable slot-position input. Returns
 *  the stored string verbatim — legacy bowls values (Lead / Second /
 *  Third / Skip / Singles) show up as-is so the admin can either
 *  keep them or edit; empty strings stay empty so deleting mid-edit
 *  doesn't snap back to the placeholder. */
function slotPositionValue(position: string | null | undefined): string {
  return position ?? ''
}

function onSlotPositionInput(rinkIdx: number, slotIdx: number, event: Event) {
  const rink = rinks.value[rinkIdx]
  const slot = rink?.slots[slotIdx]
  if (!slot) return
  slot.position = (event.target as HTMLInputElement).value
  scheduleSave()
}

function onSlotPositionBlur(rinkIdx: number, slotIdx: number) {
  const slot = rinks.value[rinkIdx]?.slots[slotIdx]
  if (!slot) return
  const next = (slot.position ?? '').replace(/\s+/g, ' ').trim()
  if (next !== slot.position) {
    slot.position = next
    scheduleSave()
  }
}

/** Temporary negative ids for not-yet-persisted rinks + slots. The
 *  backend treats id-less entries as INSERTs, but Vue needs a stable
 *  key for v-for. Negative ids never collide with real server ids. */
let tempIdCounter = -1
function nextTempId(): number {
  return tempIdCounter--
}

// ── Save ─────────────────────────────────────────────────────

function scheduleSave() {
  if (pendingSave.value) clearTimeout(pendingSave.value)
  pendingSave.value = setTimeout(() => {
    pendingSave.value = null
    saveRoster()
  }, SAVE_DEBOUNCE_MS)
}

/** Always sends the full desired roster. Rink/slot ids below zero get
 *  stripped (INSERT); real server ids get preserved (UPDATE). Rinks
 *  the admin removed aren't in the payload, so the backend cascades
 *  a DELETE on them. */
function buildRosterPayload(): UpdateRosterInput {
  return {
    rinks: rinks.value.map((r, idx) => ({
      id: r.id > 0 ? r.id : undefined,
      label: r.label,
      position: idx,
      slots: r.slots.map((s, slotIdx) => ({
        id: s.id > 0 ? s.id : undefined,
        position: s.position,
        slot_order: s.slot_order ?? slotIdx,
        member_id: s.member?.user_id ?? null,
      })),
    })),
  }
}

async function saveRoster() {
  const cid = clubStore.current?.id
  const sid = selectionId.value
  if (typeof cid !== 'number' || sid == null || saving.value) return
  saving.value = true
  try {
    const updated = await teamSelections.update(cid, sid, buildRosterPayload())
    // Rehydrate local state from the server echo so temp ids get
    // replaced with real ones and notified_member_id reflects the
    // backend's view.
    selection.value = updated
    rinks.value = cloneRinks(updated.rinks)
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not save roster.')
  } finally {
    saving.value = false
  }
}

/** Explicit "Save draft" bypasses the debounce — the admin is telling
 *  us they're done fiddling. */
async function saveNow() {
  if (pendingSave.value) {
    clearTimeout(pendingSave.value)
    pendingSave.value = null
  }
  await saveRoster()
}

// ── Lifecycle actions ────────────────────────────────────────

async function publish() {
  const cid = clubStore.current?.id
  const sid = selectionId.value
  if (typeof cid !== 'number' || sid == null || publishing.value) return
  await saveNow()  // flush pending roster changes first
  publishing.value = true
  try {
    const res = await teamSelections.publish(
      cid,
      sid,
      publishMessage.value.trim() === '' ? {} : { message: publishMessage.value.trim() },
    )
    selection.value = res.selection
    rinks.value = cloneRinks(res.selection.rinks)
    lastNotifySummary.value = res.notify_summary
    publishOpen.value = false
    publishMessage.value = ''
    toast.success(
      res.notify_summary.picked > 0
        ? `Published — ${res.notify_summary.picked} player${res.notify_summary.picked === 1 ? '' : 's'} notified.`
        : 'Published — no new notifications to send.',
    )
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not publish.')
  } finally {
    publishing.value = false
  }
}

async function reopen() {
  const cid = clubStore.current?.id
  const sid = selectionId.value
  if (typeof cid !== 'number' || sid == null) return
  kebabOpen.value = false
  try {
    const updated = await teamSelections.reopen(cid, sid)
    selection.value = updated
    rinks.value = cloneRinks(updated.rinks)
    toast.success('Selection reopened for edits.')
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not reopen.')
  }
}

async function confirmCancel() {
  const cid = clubStore.current?.id
  const sid = selectionId.value
  if (typeof cid !== 'number' || sid == null || cancellingSel.value) return
  if (cancelReason.value.trim().length === 0) {
    toast.error('Add a reason — players will see this.')
    return
  }
  cancellingSel.value = true
  try {
    const res = await teamSelections.cancel(cid, sid, { reason: cancelReason.value.trim() })
    selection.value = res.selection
    rinks.value = cloneRinks(res.selection.rinks)
    lastNotifySummary.value = res.notify_summary
    cancelOpen.value = false
    cancelReason.value = ''
    toast.success(
      res.notify_summary.dropped > 0
        ? `Cancelled — ${res.notify_summary.dropped} player${res.notify_summary.dropped === 1 ? '' : 's'} notified.`
        : 'Cancelled.',
    )
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not cancel.')
  } finally {
    cancellingSel.value = false
  }
}

// ── Create form ──────────────────────────────────────────────

type FormatPreset = 'fours' | 'triples' | 'pairs' | 'singles'
// Positions are left empty so the editor's `Player N` placeholder takes
// over — admins name each slot inline per the sport they're running. The
// preset only controls how many slots per team get seeded. See brief 75
// for the backend side.
const createPresets: Record<FormatPreset, { label: string; shape: FormatShape }> = {
  fours:   { label: 'Fours',   shape: { positions: ['', '', '', ''], rink_count: 2 } },
  triples: { label: 'Triples', shape: { positions: ['', '', ''], rink_count: 2 } },
  pairs:   { label: 'Pairs',   shape: { positions: ['', ''], rink_count: 2 } },
  singles: { label: 'Singles', shape: { positions: [''], rink_count: 1 } },
}

const createForm = reactive({
  competition: '',
  round_label: '',
  opponent: '',
  venue: 'home' as TeamSelectionVenue,
  /** YYYY-MM-DD — fed to TornyDatePicker. The time half lives in
   *  `starts_at_time` so the picker stays date-only (its popover
   *  doesn't do time). Combined into ISO in submitCreate. */
  starts_at_date: '',
  starts_at_time: '12:30',
  preset: 'fours' as FormatPreset,
  rink_count: 2,
  format_label: 'Fours × 2',
  manager_note: '',
})

const creating = ref(false)

// Keep format_label in sync with the preset until the user manually
// edits it — a small UX nicety so "Triples" shows as "Triples × 2"
// without the admin typing it.
const formatLabelAutoset = ref(true)
watch(() => createForm.preset, (preset) => {
  if (!formatLabelAutoset.value) return
  const label = createPresets[preset].label
  createForm.format_label = createForm.rink_count === 1 ? label : `${label} × ${createForm.rink_count}`
})
watch(() => createForm.rink_count, (count) => {
  if (!formatLabelAutoset.value) return
  const label = createPresets[createForm.preset].label
  createForm.format_label = count === 1 ? label : `${label} × ${count}`
})
function onFormatLabelInput() { formatLabelAutoset.value = false }

const venueOptions = [
  { value: 'home', label: 'Home' },
  { value: 'away', label: 'Away' },
]
const presetOptions = (Object.keys(createPresets) as FormatPreset[]).map((k) => ({
  value: k,
  label: createPresets[k].label,
}))
const rinkCountOptions = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: `${n}` }))

async function submitCreate() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || creating.value) return
  if (createForm.competition.trim() === '' ||
      createForm.round_label.trim() === '' ||
      createForm.opponent.trim() === '' ||
      createForm.starts_at_date === '' ||
      createForm.format_label.trim() === '') {
    toast.error('Fill in all the required fields.')
    return
  }
  creating.value = true
  try {
    const time = createForm.starts_at_time || '12:30'
    const startsAtIso = new Date(`${createForm.starts_at_date}T${time}:00`).toISOString()
    const shape = createPresets[createForm.preset].shape
    const created = await teamSelections.create(cid, {
      competition: createForm.competition.trim(),
      round_label: createForm.round_label.trim(),
      opponent: createForm.opponent.trim(),
      venue: createForm.venue,
      starts_at: startsAtIso,
      format_label: createForm.format_label.trim(),
      format_shape: { positions: shape.positions, rink_count: createForm.rink_count },
      manager_note: createForm.manager_note.trim() === '' ? null : createForm.manager_note.trim(),
    })
    toast.success('Selection created — pick your team.')
    router.replace({ name: 'team-editor', params: { id: String(created.id) } })
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not create selection.')
  } finally {
    creating.value = false
  }
}

// ── Formatters ───────────────────────────────────────────────

function formatWhen(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-NZ', {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: 'numeric', minute: '2-digit',
    })
  } catch { return iso }
}

function formatLastPlayed(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const days = Math.floor(diffMs / 86_400_000)
  if (days < 1) return 'today'
  if (days === 1) return '1d ago'
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  return months < 12 ? `${months}mo ago` : `${Math.floor(days / 365)}y ago`
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((p) => p[0] ?? '').slice(0, 2).join('').toUpperCase()
}

function goBack() {
  router.push({ name: 'teams' })
}
</script>

<template>
  <!-- ── Create mode ─────────────────────────────────────────── -->
  <div v-if="isNew" class="ed">
    <button class="ed__back" @click="goBack">← Team selections</button>
    <header class="ed__header ed__header--create">
      <div>
        <div class="ed__eyebrow">New selection</div>
        <h1 class="ed__heading">Pick a fixture</h1>
        <p class="ed__sub">Set the fixture details first. We’ll seed your teams and you can start dropping players in.</p>
      </div>
    </header>

    <form class="create" @submit.prevent="submitCreate">
      <div class="create__row create__row--2">
        <label class="field">
          <span class="field__label">Competition</span>
          <input
            v-model="createForm.competition"
            type="text"
            maxlength="80"
            class="field__input"
            placeholder="Pennant Div 3"
            required
          />
        </label>
        <label class="field">
          <span class="field__label">Round</span>
          <input
            v-model="createForm.round_label"
            type="text"
            maxlength="80"
            class="field__input"
            placeholder="Round 8 / Semi-final / Final"
            required
          />
        </label>
      </div>

      <label class="field">
        <span class="field__label">Opponent</span>
        <input
          v-model="createForm.opponent"
          type="text"
          maxlength="80"
          class="field__input"
          placeholder="Petone A"
          required
        />
      </label>

      <div class="create__row create__row--2">
        <div class="field">
          <span class="field__label">Venue</span>
          <TornySelect
            v-model="createForm.venue"
            :options="venueOptions"
          />
        </div>
        <div class="field">
          <span class="field__label">When</span>
          <div class="create__when">
            <TornyDatePicker
              v-model="createForm.starts_at_date"
              placeholder="Pick a date"
            />
            <TornyTimePicker
              v-model="createForm.starts_at_time"
              placeholder="Pick a time"
            />
          </div>
        </div>
      </div>

      <div class="create__row create__row--3">
        <div class="field">
          <span class="field__label">Format</span>
          <TornySelect
            v-model="createForm.preset"
            :options="presetOptions"
          />
        </div>
        <div class="field">
          <span class="field__label">Teams</span>
          <TornySelect
            v-model="createForm.rink_count"
            :options="rinkCountOptions"
          />
        </div>
        <label class="field">
          <span class="field__label">Display label</span>
          <input
            v-model="createForm.format_label"
            type="text"
            maxlength="40"
            class="field__input"
            @input="onFormatLabelInput"
            required
          />
        </label>
      </div>

      <label class="field">
        <span class="field__label">Manager note <span class="field__optional">— optional</span></span>
        <textarea
          v-model="createForm.manager_note"
          rows="3"
          maxlength="500"
          class="field__textarea"
          placeholder="Weather looks perfect — first bowl at 12:30 sharp."
        />
      </label>

      <div class="create__actions">
        <button type="button" class="btn btn--outline" @click="goBack">Cancel</button>
        <button type="submit" class="btn btn--primary" :disabled="creating">
          {{ creating ? 'Creating…' : 'Create + start picking' }}
        </button>
      </div>
    </form>
  </div>

  <!-- ── Edit mode ──────────────────────────────────────────── -->
  <div v-else class="ed">
    <button class="ed__back" @click="goBack">← Team selections</button>

    <div v-if="loading && !selection" class="ed__loading">Loading selection…</div>

    <template v-else-if="selection">
      <header class="ed__header">
        <div>
          <div class="ed__eyebrow">{{ selection.competition }} · {{ selection.round_label }}</div>
          <div class="ed__title-line">
            <h1 class="ed__heading">vs {{ selection.opponent }}</h1>
            <span class="status-pill" :class="`status-pill--${selection.status}`">{{ selection.status }}</span>
          </div>
          <div class="ed__meta">
            <span class="tag" :class="`tag--${selection.venue}`">{{ selection.venue }}</span>
            <span>{{ formatWhen(selection.starts_at) }}</span>
            <span class="dot">·</span>
            <span>{{ selection.format_label }}</span>
            <span class="dot">·</span>
            <span>{{ filledSlots }} / {{ totalSlots }} confirmed</span>
            <span v-if="saving" class="ed__saving">· Saving…</span>
          </div>
          <div v-if="selection.manager_note" class="ed__note">“{{ selection.manager_note }}”</div>
          <div v-if="selection.cancelled_reason" class="ed__cancel-reason">
            Cancelled — {{ selection.cancelled_reason }}
          </div>
        </div>
        <div class="ed__actions">
          <button
            v-if="!readOnly"
            type="button"
            class="btn btn--outline"
            :disabled="saving"
            @click="saveNow"
          >Save draft</button>
          <button
            v-if="!readOnly"
            type="button"
            class="btn btn--primary"
            @click="publishOpen = true"
          >Publish + notify</button>
          <button
            v-if="isSent"
            type="button"
            class="btn btn--outline"
            @click="reopen"
          >Reopen</button>
          <div class="kebab-wrap">
            <button
              type="button"
              class="btn btn--icon"
              aria-label="More actions"
              @click="kebabOpen = !kebabOpen"
            >⋯</button>
            <div v-if="kebabOpen" class="kebab" @click.self="kebabOpen = false">
              <button
                v-if="selection.status !== 'cancelled'"
                type="button"
                class="kebab__item kebab__item--danger"
                @click="cancelOpen = true; kebabOpen = false"
              >Cancel selection</button>
              <div v-else class="kebab__empty">Selection already cancelled.</div>
            </div>
          </div>
        </div>
      </header>

      <div v-if="lastNotifySummary && (lastNotifySummary.picked + lastNotifySummary.dropped + lastNotifySummary.already_notified > 0)" class="notify-summary">
        <strong>Last notification pass:</strong>
        {{ lastNotifySummary.picked }} picked ·
        {{ lastNotifySummary.dropped }} dropped ·
        {{ lastNotifySummary.already_notified }} unchanged
      </div>

      <div class="ed__board">
        <section class="rinks">
          <div class="rinks__head">
            <div class="rinks__label">Teams</div>
            <button
              v-if="!readOnly"
              type="button"
              class="btn btn--ghost"
              @click="addRink"
            >+ Add team</button>
          </div>
          <article v-for="(r, i) in rinks" :key="r.id" class="rink">
            <div class="rink__head">
              <input
                v-if="!readOnly"
                class="rink__label-input"
                type="text"
                maxlength="60"
                :value="teamEditValue(r.label)"
                :placeholder="`Team ${i + 1}`"
                :aria-label="`Team ${i + 1} name`"
                @input="onTeamNameInput(i, $event)"
                @blur="onTeamNameBlur(i)"
              />
              <h3 v-else class="rink__label">{{ teamDisplayName(r.label, i) }}</h3>
              <button
                v-if="!readOnly && rinks.length > 1"
                class="rink__remove"
                @click="removeRink(i)"
              >Remove</button>
            </div>
            <div class="rink__slots">
              <div
                v-for="(s, si) in r.slots"
                :key="s.id"
                class="slot"
                :class="{ 'slot--filled': s.member != null, 'slot--locked': readOnly }"
                @dragover.prevent
                @drop="onDrop(i, si)"
              >
                <input
                  v-if="!readOnly"
                  class="slot__position-input"
                  type="text"
                  maxlength="40"
                  :value="slotPositionValue(s.position)"
                  :placeholder="`Player ${si + 1}`"
                  :aria-label="`Team ${i + 1} player ${si + 1} role`"
                  @input="onSlotPositionInput(i, si, $event)"
                  @blur="onSlotPositionBlur(i, si)"
                />
                <div v-else class="slot__position">{{ slotDisplayName(s.position, si) }}</div>
                <template v-if="s.member">
                  <div class="slot__member">
                    <div class="slot__name">{{ s.member.name }}</div>
                    <div class="slot__meta">
                      <template v-if="s.member.playing_level">Level {{ s.member.playing_level }} · </template>
                      Last {{ formatLastPlayed(s.member.last_played_at) }}
                    </div>
                  </div>
                  <button
                    v-if="!readOnly"
                    type="button"
                    class="slot__clear"
                    :aria-label="`Clear ${slotDisplayName(s.position, si)}`"
                    @click="clearSlot(i, si)"
                  >×</button>
                </template>
                <div v-else class="slot__empty">
                  <template v-if="readOnly">Unfilled</template>
                  <template v-else>Drop a member here</template>
                </div>
                <button
                  v-if="!readOnly && r.slots.length > 1"
                  type="button"
                  class="slot__remove"
                  :aria-label="`Remove player ${si + 1} from team ${i + 1}`"
                  @click="removeSlot(i, si)"
                ><svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M4 4l4 4M8 4l-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
              </div>
              <button
                v-if="!readOnly"
                type="button"
                class="slot slot--add"
                @click="addSlot(i)"
              >
                <span class="slot__add-icon" aria-hidden="true">+</span>
                <span class="slot__add-label">Add player</span>
              </button>
            </div>
          </article>
        </section>

        <aside class="pool">
          <div class="pool__head">
            <h3 class="pool__label">Available</h3>
            <span class="pool__count">{{ availablePool.length }}</span>
          </div>
          <div v-if="poolLoading && availablePool.length === 0" class="pool__loading">Loading roster…</div>
          <ul v-else class="pool__list">
            <li
              v-for="m in availablePool"
              :key="m.user_id"
              class="chip"
              :draggable="!readOnly"
              @dragstart="onDragStart(m.user_id)"
            >
              <div class="chip__avatar">{{ initials(m.name) }}</div>
              <div class="chip__body">
                <div class="chip__name">{{ m.name }}</div>
                <div class="chip__meta">
                  <span v-if="m.preferred_position">{{ m.preferred_position }}</span>
                  <template v-if="m.preferred_position && m.playing_level"><span class="dot">·</span></template>
                  <span v-if="m.playing_level">Level {{ m.playing_level }}</span>
                  <template v-if="m.preferred_position || m.playing_level"><span class="dot">·</span></template>
                  <span>{{ formatLastPlayed(m.last_played_at) }}</span>
                </div>
              </div>
            </li>
          </ul>
        </aside>
      </div>
    </template>

    <!-- Publish modal -->
    <CrmModal
      :open="publishOpen"
      eyebrow="Publish"
      title="Publish + notify players"
      width="sm"
      @close="publishOpen = false"
    >
      <p class="modal-body">
        {{ filledSlots }} of {{ totalSlots }} slots are filled. Players with a filled slot will get a “you’re in” notification and the team-selection email flavour. Previously-notified players who’ve been dropped will get a “change of plans” message.
      </p>
      <label class="field">
        <span class="field__label">Manager note <span class="field__optional">— optional, overrides the one on the fixture</span></span>
        <textarea
          v-model="publishMessage"
          rows="3"
          maxlength="500"
          class="field__textarea"
          placeholder="Weather looks perfect — first bowl at 12:30 sharp."
        />
      </label>
      <template #footer>
        <button type="button" class="btn btn--outline" @click="publishOpen = false">Cancel</button>
        <button type="button" class="btn btn--primary" :disabled="publishing" @click="publish">
          {{ publishing ? 'Publishing…' : 'Publish + notify' }}
        </button>
      </template>
    </CrmModal>

    <!-- Cancel modal -->
    <CrmModal
      :open="cancelOpen"
      eyebrow="Cancel"
      title="Cancel this selection"
      width="sm"
      @close="cancelOpen = false"
    >
      <p class="modal-body">
        Every player who’s been notified will get a cancellation message with the reason you give here. The selection stays in the list for the record.
      </p>
      <label class="field">
        <span class="field__label">Reason</span>
        <textarea
          v-model="cancelReason"
          rows="3"
          maxlength="500"
          class="field__textarea"
          placeholder="Green closed — waterlogged."
          required
        />
      </label>
      <template #footer>
        <button type="button" class="btn btn--outline" @click="cancelOpen = false">Keep selection</button>
        <button type="button" class="btn btn--danger" :disabled="cancellingSel" @click="confirmCancel">
          {{ cancellingSel ? 'Cancelling…' : 'Cancel selection' }}
        </button>
      </template>
    </CrmModal>
  </div>
</template>

<style scoped>
.ed { max-width: 1280px; }
.ed__back { background: transparent; border: 0; padding: 0 0 12px; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); cursor: pointer; }
.ed__back:hover { color: var(--color-ink); }

.ed__header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--color-hairline); }
.ed__header--create { border-bottom: 0; padding-bottom: 0; }
.ed__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.ed__title-line { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 4px 0 8px; }
.ed__heading { font-family: var(--font-display); font-size: 30px; font-weight: 700; letter-spacing: -0.02em; margin: 0; color: var(--color-ink); }
.ed__sub { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); margin: 6px 0 0; max-width: 560px; }
.ed__meta { display: flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); flex-wrap: wrap; }
.ed__meta .dot { opacity: 0.5; }
.ed__note { font-family: var(--font-body); font-size: 12px; color: var(--color-graphite); font-style: italic; margin-top: 8px; }
.ed__cancel-reason { font-family: var(--font-body); font-size: 12px; color: var(--color-danger); margin-top: 8px; }
.ed__saving { color: var(--color-accent); font-style: italic; }
.ed__actions { display: flex; gap: 8px; flex-shrink: 0; align-items: center; }
.ed__loading { padding: 48px 24px; text-align: center; color: var(--color-fog); }

.status-pill { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; }
.status-pill--draft { background: #FEF3C7; color: #92400E; }
.status-pill--confirmed { background: #DCFCE7; color: #166534; }
.status-pill--sent { background: var(--color-accent-soft); color: var(--color-accent-strong); }
.status-pill--played { background: var(--color-hairline); color: var(--color-graphite); }
.status-pill--cancelled { background: #FEE2E2; color: #991B1B; }

.tag { display: inline-flex; padding: 2px 8px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.tag--home { background: var(--color-accent-soft); color: var(--color-accent-strong); }
.tag--away { background: var(--color-hairline); color: var(--color-graphite); }

.btn { padding: 9px 14px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
.btn--primary { background: var(--color-ink); color: #fff; }
.btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.btn--outline:disabled { opacity: 0.5; cursor: not-allowed; }
.btn--ghost { background: transparent; color: var(--color-accent); border: 1px dashed var(--color-accent-soft); }
.btn--danger { background: #DC2626; color: #fff; }
.btn--danger:disabled { opacity: 0.5; cursor: not-allowed; }
.btn--icon { padding: 7px 12px; background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); font-size: 16px; line-height: 1; }

.kebab-wrap { position: relative; }
.kebab { position: absolute; top: calc(100% + 6px); right: 0; min-width: 200px; padding: 6px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; box-shadow: var(--shadow-md); z-index: 10; display: flex; flex-direction: column; gap: 2px; }
.kebab__item { padding: 8px 12px; background: transparent; border: 0; border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); cursor: pointer; text-align: left; }
.kebab__item:hover { background: var(--color-surface); }
.kebab__item--danger { color: var(--color-danger); }
.kebab__empty { padding: 8px 12px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }

.notify-summary { padding: 10px 16px; background: var(--color-accent-soft); color: var(--color-accent-strong); border-radius: 10px; font-family: var(--font-body); font-size: 12px; margin-bottom: 16px; }

.ed__board { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }

.rinks { display: flex; flex-direction: column; gap: 12px; }
.rinks__head { display: flex; justify-content: space-between; align-items: center; padding: 0 4px; }
.rinks__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }

.rink { padding: 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; }
.rink__head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.rink__label { font-family: var(--font-display); font-size: 18px; font-weight: 700; letter-spacing: -0.01em; margin: 0; color: var(--color-ink); }
.rink__label-input {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--color-ink);
  background: transparent;
  border: 0;
  border-bottom: 1px dashed transparent;
  padding: 2px 4px;
  margin: 0 0 0 -4px;
  outline: none;
  min-width: 120px;
  max-width: 320px;
  width: 100%;
  border-radius: 4px;
  transition: background 0.12s, border-color 0.12s;
}
.rink__label-input::placeholder { color: var(--color-mute); font-weight: 600; }
.rink__label-input:hover { background: var(--color-sand); border-bottom-color: var(--color-hairline); }
.rink__label-input:focus {
  background: #fff;
  border-bottom-color: var(--color-ink);
  box-shadow: 0 1px 0 0 var(--color-ink);
}
.rink__remove { background: transparent; border: 0; font-family: var(--font-body); font-size: 12px; color: var(--color-danger); cursor: pointer; }

.rink__slots { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.slot { display: grid; grid-template-columns: 100px 1fr auto; gap: 12px; align-items: center; padding: 12px 14px; border: 1px dashed var(--color-hairline); border-radius: 10px; background: var(--color-surface); min-height: 60px; }
.slot--filled { background: #fff; border-style: solid; }
.slot--locked { opacity: 0.85; }
.slot__position { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.slot__position-input {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
  background: transparent;
  border: 0;
  border-bottom: 1px dashed transparent;
  padding: 2px 4px;
  margin: 0;
  outline: none;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  border-radius: 4px;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.slot__position-input::placeholder { color: var(--color-mute); }
.slot__position-input:hover { background: var(--color-sand); border-bottom-color: var(--color-hairline); color: var(--color-ink); }
.slot__position-input:focus { background: #fff; border-bottom-color: var(--color-ink); color: var(--color-ink); }
.slot__remove {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: transparent;
  border: 0;
  color: var(--color-mute);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.12s, background 0.12s, color 0.12s;
}
.slot { position: relative; }
.slot:hover .slot__remove,
.slot:focus-within .slot__remove { opacity: 1; }
.slot__remove:hover { background: var(--color-danger-soft); color: var(--color-danger); }
.slot--add {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: transparent;
  border: 1px dashed var(--color-hairline);
  border-radius: 10px;
  color: var(--color-fog);
  cursor: pointer;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 500;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
  width: fit-content;
  margin-top: 4px;
}
.slot--add:hover { border-color: var(--color-ink); color: var(--color-ink); background: var(--color-sand); }
.slot__add-icon { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 999px; background: var(--color-sand); font-family: var(--font-mono); font-size: 14px; font-weight: 700; color: var(--color-ink); }
.slot--add:hover .slot__add-icon { background: var(--color-ink); color: #fff; }
.slot__add-label { font-family: var(--font-body); }
.slot__member { min-width: 0; }
.slot__name { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slot__meta { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 2px; }
.slot__clear { background: transparent; border: 0; color: var(--color-mute); font-size: 16px; cursor: pointer; padding: 0 4px; }
.slot__clear:hover { color: var(--color-danger); }
.slot__empty { font-family: var(--font-body); font-size: 12px; font-style: italic; color: var(--color-mute); }

.pool { padding: 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; position: sticky; top: 24px; max-height: calc(100vh - 60px); overflow-y: auto; }
.pool__head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.pool__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); margin: 0; }
.pool__count { font-family: var(--font-mono); font-size: 11px; padding: 1px 8px; background: var(--color-hairline); color: var(--color-graphite); border-radius: 999px; }
.pool__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.pool__loading { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); text-align: center; padding: 16px 0; }

.chip { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 10px; cursor: grab; background: #fff; }
.chip:hover { border-color: var(--color-mute); }
.chip:active { cursor: grabbing; }
.chip__avatar { width: 32px; height: 32px; border-radius: 999px; background: var(--color-graphite); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-body); font-size: 11px; font-weight: 700; flex-shrink: 0; }
.chip__body { flex: 1; min-width: 0; }
.chip__name { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip__meta { display: flex; gap: 6px; font-family: var(--font-body); font-size: 11px; color: var(--color-fog); flex-wrap: wrap; }
.chip__meta .dot { opacity: 0.5; }

/* ── Create form ── */
.create { display: flex; flex-direction: column; gap: 16px; max-width: 720px; background: #fff; padding: 24px; border: 1px solid var(--color-hairline); border-radius: 14px; }
.create__row { display: grid; gap: 16px; }
.create__row--2 { grid-template-columns: 1fr 1fr; }
.create__row--3 { grid-template-columns: 1fr 120px 1fr; }
.create__actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; padding-top: 16px; border-top: 1px solid var(--color-hairline); }
.create__when { display: grid; grid-template-columns: 1fr 110px; gap: 8px; align-items: stretch; }
.create__time { padding: 10px 12px; }

.field { display: flex; flex-direction: column; gap: 6px; }
.field__label { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-fog); }
.field__optional { font-weight: 500; text-transform: none; letter-spacing: 0; font-style: italic; color: var(--color-mute); margin-left: 4px; }
.field__input, .field__textarea { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; box-sizing: border-box; width: 100%; }
.field__input:focus, .field__textarea:focus { outline: 2px solid color-mix(in srgb, var(--color-ink) 20%, transparent); outline-offset: 1px; border-color: var(--color-ink); }
.field__textarea { font-family: var(--font-body); resize: vertical; }

.modal-body { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); margin: 0 0 16px; line-height: 1.5; }

@media (max-width: 900px) {
  .ed__board { grid-template-columns: 1fr; }
  .pool { position: static; max-height: none; }
  .rink__slots { grid-template-columns: 1fr; }
  .create__row--2, .create__row--3 { grid-template-columns: 1fr; }
}
</style>
