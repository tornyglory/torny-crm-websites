<script setup lang="ts">
/**
 * Honour Board — real CRUD wired to brief 28's endpoints.
 *
 * Left rail lists categories, main pane shows the reigning entry as a
 * feature card and every other entry grouped by decade. Owners create /
 * rename / delete categories and add / edit / delete multi-player entries
 * (singles / pairs / triples / fours). Any linked `user_id` on a player
 * must be an active member of the club; the editor uses the roster
 * typeahead for that and falls back to free-text `display_name` for
 * historic wins with no Torny account.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  honourBoard,
  type HonourCategory,
  type HonourCategoryCreateInput,
  type HonourEntry,
  type HonourFormat,
  members as membersApi,
  type RosterMember,
  ApiError,
} from '@torny/api-client'
import CrmModal from '@/components/modals/CrmModal.vue'
import { useClubStore } from '@/stores/club'
import { useToast } from '@/composables/useToast'

// ── Stores + helpers ──────────────────────────────────────────

const club = useClubStore()
const toast = useToast()
const clubId = computed(() => club.current?.id ?? null)

// ── Categories ────────────────────────────────────────────────

const categories = ref<HonourCategory[]>([])
const activeCategoryId = ref<number | null>(null)
const catsLoading = ref(false)

const activeCategory = computed(
  () => categories.value.find((c) => c.category_id === activeCategoryId.value) ?? null,
)

async function loadCategories() {
  const cid = clubId.value
  if (cid == null) return
  catsLoading.value = true
  try {
    const list = await honourBoard.listCategories(cid)
    categories.value = list
    if (list.length && activeCategoryId.value == null) {
      activeCategoryId.value = list[0]!.category_id
    }
    if (!list.length) activeCategoryId.value = null
  } catch (err) {
    toast.error(errMessage(err, 'Failed to load categories'))
  } finally {
    catsLoading.value = false
  }
}

// ── Formats (lookup) ──────────────────────────────────────────

const formats = ref<HonourFormat[]>([])

async function loadFormats() {
  const cid = clubId.value
  if (cid == null) return
  try {
    formats.value = await honourBoard.listFormats(cid)
  } catch {
    // Non-blocking — dropdown just shows an empty list.
  }
}

function formatFor(formatId: number | null): HonourFormat | null {
  return formats.value.find((f) => f.format_id === formatId) ?? null
}

// ── Entries (for the active category) ─────────────────────────

const entries = ref<HonourEntry[]>([])
const entriesLoading = ref(false)

async function loadEntries() {
  const cid = clubId.value
  const catId = activeCategoryId.value
  if (cid == null || catId == null) {
    entries.value = []
    return
  }
  entriesLoading.value = true
  try {
    const list = await honourBoard.listEntries(cid, { categoryId: catId })
    // Sort newest first, undated (year null) last.
    entries.value = [...list].sort((a, b) => (b.year ?? -1) - (a.year ?? -1))
  } catch (err) {
    entries.value = []
    toast.error(errMessage(err, 'Failed to load entries'))
  } finally {
    entriesLoading.value = false
  }
}

const reigning = computed(() => entries.value[0] ?? null)
const olderEntries = computed(() => entries.value.slice(1))

/** Group older entries into decade buckets, newest decade first. */
const decades = computed(() => {
  const buckets = new Map<string, HonourEntry[]>()
  for (const e of olderEntries.value) {
    const key = e.year == null ? 'Undated' : `${Math.floor(e.year / 10) * 10}s`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(e)
    else buckets.set(key, [e])
  }
  return Array.from(buckets.entries()).map(([label, list]) => ({ label, list }))
})

const reigningTitles = computed(() => {
  if (!reigning.value) return 0
  const key = teamKey(reigning.value)
  return entries.value.filter((e) => teamKey(e) === key).length
})

function teamKey(entry: HonourEntry): string {
  return [...entry.players]
    .map((p) => (p.user_id !== null ? `u:${p.user_id}` : `n:${p.display_name.toLowerCase()}`))
    .sort()
    .join('|')
}

function teamNames(entry: HonourEntry): string {
  return entry.players.map((p) => p.display_name).join(', ')
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => (w[0] ?? '').toUpperCase())
    .join('')
}

// ── Category create modal ─────────────────────────────────────

const catCreateOpen = ref(false)
const catForm = reactive({
  name: '',
  format_id: null as number | null,
  gender: 'open' as string,
  description: '',
  is_visible: true,
})
const catSubmitting = ref(false)
const catError = ref<string | null>(null)

function openCatCreate() {
  catForm.name = ''
  catForm.format_id = null
  catForm.gender = 'open'
  catForm.description = ''
  catForm.is_visible = true
  catError.value = null
  catCreateOpen.value = true
}
function closeCatCreate() { catCreateOpen.value = false }

const canSubmitCat = computed(() => catForm.name.trim().length > 0)

async function submitCategory() {
  if (!canSubmitCat.value || catSubmitting.value) return
  const cid = clubId.value
  if (cid == null) return
  catSubmitting.value = true
  catError.value = null
  const payload: HonourCategoryCreateInput = {
    name: catForm.name.trim(),
    format_id: catForm.format_id,
    gender: catForm.gender,
    description: catForm.description.trim() || null,
    is_visible: catForm.is_visible,
  }
  try {
    const created = await honourBoard.createCategory(cid, payload)
    categories.value = [...categories.value, created]
    activeCategoryId.value = created.category_id
    toast.success(`Added the ${created.name} category.`)
    closeCatCreate()
  } catch (err) {
    catError.value = errMessage(err, 'Could not create the category.')
  } finally {
    catSubmitting.value = false
  }
}

async function seedDefaults() {
  const cid = clubId.value
  if (cid == null) return
  try {
    const added = await honourBoard.seedDefaults(cid)
    toast.success(`Seeded ${added.length} standard categories.`)
    await loadCategories()
  } catch (err) {
    toast.error(errMessage(err, 'Could not seed defaults.'))
  }
}

async function deleteCategory(cat: HonourCategory) {
  const cid = clubId.value
  if (cid == null) return
  const ok = confirm(`Delete "${cat.name}" and every entry in it? This cannot be undone.`)
  if (!ok) return
  try {
    await honourBoard.deleteCategory(cid, cat.category_id)
    categories.value = categories.value.filter((c) => c.category_id !== cat.category_id)
    if (activeCategoryId.value === cat.category_id) {
      activeCategoryId.value = categories.value[0]?.category_id ?? null
    }
    toast.success(`Deleted the ${cat.name} category.`)
  } catch (err) {
    toast.error(errMessage(err, 'Could not delete the category.'))
  }
}

// ── Entry editor modal ────────────────────────────────────────

interface EditorPlayer {
  /** Local rowKey for :key stability. */
  rowKey: string
  user_id: number | null
  display_name: string
  position: string
}

const entryEditorOpen = ref(false)
const editingEntry = ref<HonourEntry | null>(null)
const entryForm = reactive({
  year: '' as string,
  note: '',
  players: [] as EditorPlayer[],
})
const entrySubmitting = ref(false)
const entryError = ref<string | null>(null)
/** user_id we flagged as `member_not_in_club` on the last save attempt. */
const invalidUserId = ref<number | null>(null)

const POSITIONS = ['Skip', 'Third', 'Second', 'Lead', ''] as const

function newRowKey(): string {
  return `row_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function openEntryCreate() {
  editingEntry.value = null
  entryForm.year = String(new Date().getFullYear())
  entryForm.note = ''
  entryForm.players = defaultPlayerRows()
  entryError.value = null
  invalidUserId.value = null
  entryEditorOpen.value = true
}

function openEntryEdit(entry: HonourEntry) {
  editingEntry.value = entry
  entryForm.year = entry.year == null ? '' : String(entry.year)
  entryForm.note = entry.note ?? ''
  entryForm.players = entry.players
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => ({
      rowKey: newRowKey(),
      user_id: p.user_id,
      display_name: p.display_name,
      position: p.position ?? '',
    }))
  entryError.value = null
  invalidUserId.value = null
  entryEditorOpen.value = true
}

function closeEntryEditor() {
  entryEditorOpen.value = false
}

/** Default row set based on active category's format player_count. */
function defaultPlayerRows(): EditorPlayer[] {
  const fmt = formatFor(activeCategory.value?.format_id ?? null)
  const n = Math.max(1, fmt?.player_count ?? 1)
  return Array.from({ length: n }).map(() => blankPlayer())
}

function blankPlayer(): EditorPlayer {
  return { rowKey: newRowKey(), user_id: null, display_name: '', position: '' }
}

function addPlayerRow() {
  entryForm.players.push(blankPlayer())
}

function removePlayerRow(idx: number) {
  entryForm.players.splice(idx, 1)
  if (entryForm.players.length === 0) entryForm.players.push(blankPlayer())
}

function unlinkPlayer(idx: number) {
  const p = entryForm.players[idx]
  if (!p) return
  p.user_id = null
  invalidUserId.value = null
}

const canSubmitEntry = computed(() => {
  if (activeCategoryId.value == null) return false
  const hasName = entryForm.players.every((p) => p.display_name.trim().length > 0)
  return hasName && entryForm.players.length > 0
})

const teamSizeHint = computed(() => {
  const fmt = formatFor(activeCategory.value?.format_id ?? null)
  if (!fmt || fmt.player_count == null) return null
  if (entryForm.players.length === fmt.player_count) return null
  return `Team size for ${fmt.label} is usually ${fmt.player_count}. Currently ${entryForm.players.length}.`
})

async function submitEntry() {
  const cid = clubId.value
  const catId = activeCategoryId.value
  if (cid == null || catId == null || !canSubmitEntry.value || entrySubmitting.value) return

  entrySubmitting.value = true
  entryError.value = null
  invalidUserId.value = null

  const yearNum = entryForm.year.trim() === '' ? null : Number(entryForm.year.trim())
  if (yearNum != null && !Number.isFinite(yearNum)) {
    entryError.value = 'Year must be a number, or leave it blank for undated entries.'
    entrySubmitting.value = false
    return
  }

  const payload = {
    category_id: catId,
    year: yearNum,
    note: entryForm.note.trim() || null,
    players: entryForm.players.map((p, i) => ({
      user_id: p.user_id,
      display_name: p.display_name.trim(),
      position: p.position || null,
      sort_order: i,
    })),
  }

  try {
    if (editingEntry.value) {
      const updated = await honourBoard.updateEntry(cid, editingEntry.value.entry_id, payload)
      const idx = entries.value.findIndex((e) => e.entry_id === updated.entry_id)
      if (idx >= 0) {
        entries.value.splice(idx, 1, updated)
        entries.value = [...entries.value].sort((a, b) => (b.year ?? -1) - (a.year ?? -1))
      } else {
        await loadEntries()
      }
      toast.success('Entry updated.')
    } else {
      const created = await honourBoard.createEntry(cid, payload)
      entries.value = [...entries.value, created].sort((a, b) => (b.year ?? -1) - (a.year ?? -1))
      toast.success('Entry added.')
    }
    closeEntryEditor()
  } catch (err) {
    if (err instanceof ApiError) {
      const body = (err.body ?? {}) as { code?: string; user_id?: number }
      if (body.code === 'member_not_in_club' && body.user_id != null) {
        invalidUserId.value = body.user_id
        entryError.value = `That user isn't a current member of the club. Unlink them or pick a different member.`
      } else {
        entryError.value = err.message
      }
    } else {
      entryError.value = errMessage(err, 'Could not save the entry.')
    }
  } finally {
    entrySubmitting.value = false
  }
}

async function deleteEntry(entry: HonourEntry) {
  const cid = clubId.value
  if (cid == null) return
  const label = entry.year != null ? `${entry.year} — ${teamNames(entry)}` : teamNames(entry)
  const ok = confirm(`Delete this entry?\n\n${label}`)
  if (!ok) return
  try {
    await honourBoard.deleteEntry(cid, entry.entry_id)
    entries.value = entries.value.filter((e) => e.entry_id !== entry.entry_id)
    toast.success('Entry deleted.')
  } catch (err) {
    toast.error(errMessage(err, 'Could not delete the entry.'))
  }
}

// ── Member typeahead (shared across player rows) ──────────────

const memberQuery = ref('')
const memberResults = ref<RosterMember[]>([])
const memberSearching = ref(false)
const focusedRow = ref<string | null>(null)
let memberDebounce: ReturnType<typeof setTimeout> | null = null
let memberAbort: AbortController | null = null

function scheduleMemberSearch(q: string) {
  if (memberDebounce) clearTimeout(memberDebounce)
  if (q.trim().length < 2) {
    memberResults.value = []
    memberSearching.value = false
    return
  }
  memberSearching.value = true
  memberDebounce = setTimeout(() => {
    void fireMemberSearch(q.trim())
  }, 250)
}

async function fireMemberSearch(q: string) {
  const cid = clubId.value
  if (cid == null) return
  if (memberAbort) memberAbort.abort()
  memberAbort = new AbortController()
  try {
    const res = await membersApi.listRoster(
      cid,
      { search: q, limit: 8, status: 'all', include_invites: false },
      { signal: memberAbort.signal },
    )
    memberResults.value = res.members
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    memberResults.value = []
  } finally {
    memberSearching.value = false
  }
}

function onRowInput(row: EditorPlayer, value: string) {
  row.display_name = value
  focusedRow.value = row.rowKey
  memberQuery.value = value
  // Typing in the row also breaks a prior link — the display name diverging
  // from the linked member's canonical name is likely intentional though,
  // so only unlink if the user is starting fresh (empty → typing).
  if (row.user_id != null && value.trim() === '') {
    row.user_id = null
  }
  scheduleMemberSearch(value)
}

function onRowFocus(row: EditorPlayer) {
  focusedRow.value = row.rowKey
  memberQuery.value = row.display_name
  scheduleMemberSearch(row.display_name)
}

function onRowBlur(row: EditorPlayer) {
  // Delay so a click on a dropdown item (mousedown.prevent) can commit
  // before the dropdown unmounts.
  setTimeout(() => {
    if (focusedRow.value === row.rowKey) focusedRow.value = null
  }, 120)
}

function pickMember(row: EditorPlayer, member: RosterMember) {
  row.user_id = member.user_id
  row.display_name = member.name
  focusedRow.value = null
  memberResults.value = []
  memberQuery.value = ''
  if (invalidUserId.value === member.user_id) invalidUserId.value = null
}

// ── Error helper ──────────────────────────────────────────────

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback
  if (err instanceof Error) return err.message || fallback
  return fallback
}

// ── Wiring ────────────────────────────────────────────────────

onMounted(() => {
  if (clubId.value != null) {
    void loadCategories()
    void loadFormats()
  }
})

watch(clubId, (cid) => {
  categories.value = []
  entries.value = []
  activeCategoryId.value = null
  if (cid != null) {
    void loadCategories()
    void loadFormats()
  }
})

watch(activeCategoryId, () => {
  void loadEntries()
})
</script>

<template>
  <div class="hb">
    <header class="hb__header">
      <div>
        <div class="hb__eyebrow">Clubroom wall · Digital edition</div>
        <h1 class="hb__heading">Honour board</h1>
        <p class="hb__sub">
          <template v-if="categories.length">
            {{ categories.length }} categor{{ categories.length === 1 ? 'y' : 'ies' }} · shown on your public site
          </template>
          <template v-else>Set up your honour board — categories and results.</template>
        </p>
      </div>
      <div class="hb__actions">
        <button v-if="categories.length" class="btn btn--ghost" @click="seedDefaults" title="Adds standard bowls categories, safely skipping any that already exist.">
          + Standard set
        </button>
        <button class="btn btn--primary" @click="openCatCreate">+ Add category</button>
      </div>
    </header>

    <!-- Empty state — no categories yet -->
    <div v-if="!catsLoading && categories.length === 0" class="empty-state">
      <div class="empty-state__title">No categories yet.</div>
      <p class="empty-state__body">
        Bowls clubs usually keep an honour board of every championship — Men's Singles, Ladies Pairs, Champion of Champions, and so on. We can seed the standard set in one click, or start with just the ones your club runs.
      </p>
      <div class="empty-state__actions">
        <button class="btn btn--primary" @click="seedDefaults">Seed standard categories</button>
        <button class="btn btn--ghost" @click="openCatCreate">+ Add one manually</button>
      </div>
    </div>

    <div v-else-if="categories.length" class="grid">
      <!-- Categories rail -->
      <aside class="cats">
        <div class="cats__header">
          <div class="cats__label">Categories</div>
          <button class="cats__new" @click="openCatCreate">+ New</button>
        </div>
        <div class="cats__list">
          <button
            v-for="c in categories"
            :key="c.category_id"
            class="cat"
            :class="{ 'is-active': activeCategoryId === c.category_id, 'is-hidden': !c.is_visible }"
            @click="activeCategoryId = c.category_id"
          >
            <span class="cat__dot" />
            <span class="cat__name">{{ c.name }}</span>
            <span v-if="!c.is_visible" class="cat__badge">Hidden</span>
          </button>
        </div>
        <div class="cats__footer">
          <span>{{ categories.length }} total</span>
        </div>
      </aside>

      <!-- Feature pane -->
      <section class="feature">
        <div v-if="activeCategory" class="cat-toolbar">
          <div class="cat-toolbar__title">
            <h2 class="cat-toolbar__name">{{ activeCategory.name }}</h2>
            <div class="cat-toolbar__meta">
              <span v-if="formatFor(activeCategory.format_id)">{{ formatFor(activeCategory.format_id)!.label }}</span>
              <span v-if="activeCategory.gender && activeCategory.gender !== 'na'">·  {{ activeCategory.gender }}</span>
              <span>·  {{ entries.length }} entr{{ entries.length === 1 ? 'y' : 'ies' }}</span>
            </div>
            <p v-if="activeCategory.description" class="cat-toolbar__desc">{{ activeCategory.description }}</p>
          </div>
          <div class="cat-toolbar__actions">
            <button class="btn btn--ghost" @click="deleteCategory(activeCategory)">Delete category</button>
            <button class="btn btn--primary" @click="openEntryCreate">+ Add entry</button>
          </div>
        </div>

        <!-- Loading -->
        <div v-if="entriesLoading" class="loading">Loading entries…</div>

        <!-- No entries -->
        <div v-else-if="entries.length === 0" class="empty-cat">
          <div class="empty-cat__title">No entries in this category yet.</div>
          <p class="empty-cat__body">Add the reigning champion first — you can backfill older years anytime.</p>
          <button class="btn btn--primary" @click="openEntryCreate">+ Add first entry</button>
        </div>

        <template v-else>
          <!-- Reigning champion feature -->
          <div v-if="reigning" class="hero">
            <div class="hero__medallion">
              <div class="hero__medallion-inner">{{ initialsFor(reigning.players[0]?.display_name ?? '') }}</div>
              <div class="hero__star">
                <svg viewBox="0 0 24 24" fill="#fff" width="16" height="16"><path d="M12 2l2.4 6.9H21l-5.4 4 2 6.9L12 15.6l-5.6 4.2 2-6.9L3 8.9h6.6z"/></svg>
              </div>
            </div>
            <div class="hero__body">
              <div class="hero__eyebrow">{{ reigning.players.length > 1 ? 'Reigning champions' : 'Reigning champion' }} · {{ reigning.year ?? 'Undated' }}</div>
              <div class="hero__name">{{ teamNames(reigning) }}</div>
              <div class="hero__cat">{{ activeCategory?.name }}</div>
              <p v-if="reigning.note" class="hero__note">{{ reigning.note }}</p>
              <div class="hero__stats">
                <div class="hero__stat">
                  <div class="hero__stat-value">{{ reigningTitles }}</div>
                  <div class="hero__stat-label">Titles held</div>
                </div>
                <div class="hero__stat">
                  <div class="hero__stat-value">{{ reigning.players.length }}</div>
                  <div class="hero__stat-label">In team</div>
                </div>
              </div>
            </div>
            <div class="hero__actions">
              <button class="hero__btn hero__btn--solid" @click="openEntryEdit(reigning)">Edit entry</button>
              <button class="hero__btn hero__btn--ghost" @click="deleteEntry(reigning)">Delete</button>
            </div>
          </div>

          <!-- Decade groups -->
          <div v-if="olderEntries.length" class="decades">
            <div v-for="d in decades" :key="d.label" class="decade">
              <div class="decade__header">
                <h3 class="decade__title">{{ d.label }}</h3>
                <span class="decade__meta">{{ d.list.length }} entr{{ d.list.length === 1 ? 'y' : 'ies' }}</span>
              </div>
              <ul class="entry-rows">
                <li v-for="e in d.list" :key="e.entry_id" class="entry-row" @click="openEntryEdit(e)">
                  <div class="entry-row__year">{{ e.year ?? '—' }}</div>
                  <div class="entry-row__names">
                    {{ teamNames(e) }}
                    <span v-if="e.note" class="entry-row__note">— {{ e.note }}</span>
                  </div>
                  <div class="entry-row__actions">
                    <button class="entry-row__btn" @click.stop="openEntryEdit(e)">Edit</button>
                    <button class="entry-row__btn entry-row__btn--ghost" @click.stop="deleteEntry(e)">Delete</button>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </template>
      </section>
    </div>

    <!-- Category modal -->
    <CrmModal
      :open="catCreateOpen"
      eyebrow="Honour board"
      title="Add a category"
      width="md"
      @close="closeCatCreate"
    >
      <form class="form" @submit.prevent="submitCategory">
        <label class="field">
          <span class="field__label">Name</span>
          <input v-model="catForm.name" type="text" placeholder="Champion of Champions" autofocus />
        </label>
        <div class="form__row">
          <label class="field">
            <span class="field__label">Format</span>
            <select v-model="catForm.format_id">
              <option :value="null">— none —</option>
              <option v-for="f in formats" :key="f.format_id" :value="f.format_id">{{ f.label }}</option>
            </select>
          </label>
          <label class="field">
            <span class="field__label">Grade</span>
            <select v-model="catForm.gender">
              <option value="mens">Men's</option>
              <option value="womens">Women's</option>
              <option value="mixed">Mixed</option>
              <option value="open">Open</option>
              <option value="na">N/A</option>
            </select>
          </label>
        </div>
        <label class="field">
          <span class="field__label">Description (optional)</span>
          <input v-model="catForm.description" type="text" placeholder="Started 1968" />
        </label>
        <div class="switch-row">
          <div>
            <div class="switch-row__label">Visible on public site</div>
            <div class="switch-row__hint">Off = hidden from the honour board page until you toggle on.</div>
          </div>
          <button type="button" class="switch" :class="{ 'is-on': catForm.is_visible }" @click="catForm.is_visible = !catForm.is_visible"><span class="switch__knob" /></button>
        </div>
        <div v-if="catError" class="form__error">{{ catError }}</div>
      </form>
      <template #footer>
        <button type="button" class="modal-btn modal-btn--outline" @click="closeCatCreate">Cancel</button>
        <button type="button" class="modal-btn modal-btn--primary" :disabled="!canSubmitCat || catSubmitting" @click="submitCategory">
          {{ catSubmitting ? 'Adding…' : 'Add category' }}
        </button>
      </template>
    </CrmModal>

    <!-- Entry editor modal -->
    <CrmModal
      :open="entryEditorOpen"
      eyebrow="Honour board"
      :title="editingEntry ? 'Edit entry' : 'Add entry'"
      width="lg"
      @close="closeEntryEditor"
    >
      <form class="form" @submit.prevent="submitEntry">
        <div class="form__row">
          <label class="field">
            <span class="field__label">Year</span>
            <input v-model="entryForm.year" type="text" placeholder="2026" />
            <span class="field__hint">Leave blank for undated (e.g. Life Members).</span>
          </label>
          <label class="field">
            <span class="field__label">Note (optional)</span>
            <input v-model="entryForm.note" type="text" placeholder="Down 12–8 at end 15" />
          </label>
        </div>

        <div class="players">
          <div class="players__head">
            <div class="players__label">
              Players
              <span v-if="teamSizeHint" class="players__hint">{{ teamSizeHint }}</span>
            </div>
          </div>
          <ul class="player-rows">
            <li
              v-for="(p, idx) in entryForm.players"
              :key="p.rowKey"
              class="player-row"
              :class="{ 'is-invalid': p.user_id != null && invalidUserId === p.user_id }"
            >
              <div class="player-row__name">
                <input
                  v-model="p.display_name"
                  type="text"
                  :placeholder="idx === 0 ? 'Skip name — start typing to search members' : 'Player name'"
                  @input="onRowInput(p, ($event.target as HTMLInputElement).value)"
                  @focus="onRowFocus(p)"
                  @blur="onRowBlur(p)"
                />
                <div v-if="p.user_id != null" class="player-row__linked">
                  <span class="player-row__linked-badge">✓ Linked to member</span>
                  <button type="button" class="player-row__unlink" @click="unlinkPlayer(idx)">Unlink</button>
                </div>
                <!-- Member results dropdown -->
                <div
                  v-if="focusedRow === p.rowKey && (memberResults.length > 0 || memberSearching)"
                  class="member-dropdown"
                >
                  <div v-if="memberSearching && memberResults.length === 0" class="member-dropdown__loading">Searching…</div>
                  <button
                    v-for="m in memberResults"
                    :key="m.user_id"
                    type="button"
                    class="member-dropdown__item"
                    @mousedown.prevent="pickMember(p, m)"
                  >
                    <span class="member-dropdown__avatar">{{ initialsFor(m.name) }}</span>
                    <span class="member-dropdown__body">
                      <span class="member-dropdown__name">{{ m.name }}</span>
                      <span v-if="m.email" class="member-dropdown__email">{{ m.email }}</span>
                    </span>
                  </button>
                </div>
              </div>
              <select v-model="p.position" class="player-row__position">
                <option v-for="pos in POSITIONS" :key="pos || 'none'" :value="pos">{{ pos || '— position —' }}</option>
              </select>
              <button type="button" class="player-row__remove" @click="removePlayerRow(idx)" title="Remove player">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16"><path d="M6 6l12 12M18 6L6 18"/></svg>
              </button>
            </li>
          </ul>
          <button type="button" class="players__add" @click="addPlayerRow">+ Add another player</button>
        </div>

        <div v-if="entryError" class="form__error">{{ entryError }}</div>
      </form>

      <template #footer>
        <button type="button" class="modal-btn modal-btn--outline" @click="closeEntryEditor">Cancel</button>
        <button type="button" class="modal-btn modal-btn--primary" :disabled="!canSubmitEntry || entrySubmitting" @click="submitEntry">
          {{ entrySubmitting ? 'Saving…' : editingEntry ? 'Save changes' : 'Add entry' }}
        </button>
      </template>
    </CrmModal>

  </div>
</template>

<style scoped>
.hb { max-width: 1280px; }
.hb__header { display: flex; align-items: end; justify-content: space-between; margin-bottom: 24px; gap: 16px; }
.hb__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.hb__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.hb__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; }
.hb__actions { display: flex; gap: 8px; }

.btn { padding: 9px 14px; border: none; border-radius: 10px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; }
.btn--primary { background: var(--color-ink); color: #fff; }
.btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn--ghost { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }

.empty-state { padding: 48px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; text-align: center; max-width: 640px; margin: 0 auto; }
.empty-state__title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-ink); margin-bottom: 8px; }
.empty-state__body { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); line-height: 1.6; margin: 0 0 20px; }
.empty-state__actions { display: flex; gap: 8px; justify-content: center; }

.grid { display: grid; grid-template-columns: 280px 1fr; gap: 28px; align-items: start; }

/* Categories rail */
.cats { border: 1px solid var(--color-hairline); border-radius: 16px; background: #fff; overflow: hidden; position: sticky; top: 108px; }
.cats__header { padding: 16px 18px; border-bottom: 1px solid var(--color-hairline); display: flex; align-items: center; justify-content: space-between; }
.cats__label { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.cats__new { padding: 5px 9px; border: 1px solid var(--color-hairline); background: #fff; border-radius: 999px; font-family: var(--font-body); font-size: 11px; color: var(--color-ink); cursor: pointer; }
.cats__list { padding: 10px 8px; display: flex; flex-direction: column; gap: 1px; }
.cat { display: flex; align-items: center; gap: 10px; padding: 9px 12px; background: transparent; border: none; border-radius: 8px; cursor: pointer; text-align: left; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); }
.cat.is-active { background: var(--color-accent-soft); font-weight: 600; }
.cat.is-hidden { opacity: 0.6; }
.cat__dot { width: 6px; height: 6px; border-radius: 999px; background: var(--color-hairline); }
.cat.is-active .cat__dot { background: var(--color-accent); }
.cat__name { flex: 1; }
.cat__badge { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; color: var(--color-fog); text-transform: uppercase; }
.cats__footer { padding: 12px 16px; border-top: 1px solid var(--color-hairline); background: var(--color-surface); font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }

.feature { display: flex; flex-direction: column; gap: 20px; min-width: 0; }

/* Category header */
.cat-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 20px 24px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }
.cat-toolbar__name { font-family: var(--font-display); font-size: 22px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 4px; color: var(--color-ink); }
.cat-toolbar__meta { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); text-transform: capitalize; }
.cat-toolbar__desc { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); margin: 8px 0 0; line-height: 1.5; }
.cat-toolbar__actions { display: flex; gap: 8px; flex-shrink: 0; }

.loading { padding: 32px; text-align: center; font-family: var(--font-body); font-size: 14px; color: var(--color-fog); }

.empty-cat { padding: 32px; background: #fff; border: 1px dashed var(--color-hairline); border-radius: 16px; text-align: center; }
.empty-cat__title { font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-ink); margin-bottom: 6px; }
.empty-cat__body { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); margin: 0 0 16px; }

/* Hero */
.hero { position: relative; padding: 32px; border-radius: 20px; background: linear-gradient(135deg, #0F1930 0%, #1E3A8A 100%); color: #fff; display: flex; gap: 28px; align-items: center; overflow: hidden; }
.hero__medallion { position: relative; flex-shrink: 0; }
.hero__medallion-inner { width: 120px; height: 120px; border-radius: 999px; background: linear-gradient(135deg, #D97706 0%, #F59E0B 60%, #FCD34D 100%); display: flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 32px; font-weight: 800; color: #fff; letter-spacing: -0.02em; box-shadow: 0 8px 24px rgba(0,0,0,0.35); border: 4px solid #fff; }
.hero__star { position: absolute; bottom: -4px; right: -4px; width: 36px; height: 36px; border-radius: 999px; background: #F59E0B; border: 3px solid #0F1930; display: flex; align-items: center; justify-content: center; }
.hero__body { flex: 1; min-width: 0; }
.hero__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.2em; color: rgba(255,255,255,0.6); text-transform: uppercase; margin-bottom: 8px; }
.hero__name { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 6px; line-height: 1.15; }
.hero__cat { font-family: var(--font-display); font-size: 14px; font-weight: 500; color: rgba(255,255,255,0.7); margin-bottom: 12px; }
.hero__note { font-family: var(--font-body); font-size: 13px; color: rgba(255,255,255,0.75); margin: 0 0 16px; line-height: 1.5; }
.hero__stats { display: flex; gap: 20px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.14); flex-wrap: wrap; }
.hero__stat-value { font-family: var(--font-mono); font-size: 22px; font-weight: 700; }
.hero__stat-label { font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.12em; color: rgba(255,255,255,0.55); text-transform: uppercase; margin-top: 2px; }
.hero__actions { display: flex; flex-direction: column; gap: 8px; align-self: flex-start; }
.hero__btn { padding: 8px 14px; border-radius: 999px; font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; border: none; }
.hero__btn--solid { background: #fff; color: var(--color-ink); }
.hero__btn--ghost { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,0.24); }

/* Decade groups */
.decades { display: flex; flex-direction: column; gap: 20px; }
.decade { padding: 20px 24px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }
.decade__header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }
.decade__title { font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: -0.02em; margin: 0; color: var(--color-ink); }
.decade__meta { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.entry-rows { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; }
.entry-row { display: grid; grid-template-columns: 80px 1fr auto; align-items: center; gap: 16px; padding: 12px 8px; border-top: 1px solid var(--color-hairline); cursor: pointer; }
.entry-row:first-child { border-top: 0; }
.entry-row:hover { background: var(--color-surface); }
.entry-row__year { font-family: var(--font-mono); font-size: 13px; color: var(--color-graphite); font-weight: 700; }
.entry-row__names { font-family: var(--font-body); font-size: 14px; color: var(--color-ink); }
.entry-row__note { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); font-style: italic; }
.entry-row__actions { display: flex; gap: 6px; }
.entry-row__btn { padding: 6px 10px; border-radius: 6px; border: 1px solid var(--color-hairline); background: #fff; font-family: var(--font-body); font-size: 11px; font-weight: 600; color: var(--color-ink); cursor: pointer; }
.entry-row__btn--ghost { color: var(--color-fog); }

/* Editor: players */
.players { display: flex; flex-direction: column; gap: 8px; padding-top: 4px; border-top: 1px solid var(--color-hairline); }
.players__head { display: flex; align-items: baseline; justify-content: space-between; padding-top: 12px; }
.players__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.players__hint { font-family: var(--font-body); font-size: 11px; font-weight: 500; letter-spacing: 0; text-transform: none; color: var(--color-feature-tangerine); }
.player-rows { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.player-row { display: grid; grid-template-columns: 1fr 160px 32px; gap: 10px; align-items: start; padding: 10px; background: var(--color-surface); border-radius: 10px; }
.player-row.is-invalid { background: #FEE2E2; border: 1px solid #FCA5A5; }
.player-row__name { position: relative; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.player-row__name input { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; }
.player-row__name input:focus { outline: none; border-color: var(--color-ink); }
.player-row__linked { display: flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 11px; }
.player-row__linked-badge { color: var(--color-accent); font-weight: 600; }
.player-row__unlink { background: transparent; border: 0; color: var(--color-fog); text-decoration: underline; cursor: pointer; font-size: 11px; padding: 0; }
.player-row__position { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; }
.player-row__remove { border: 1px solid var(--color-hairline); background: #fff; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; color: var(--color-fog); height: 40px; }
.player-row__remove:hover { color: #DC2626; border-color: #FCA5A5; }
.players__add { align-self: flex-start; margin-top: 4px; padding: 8px 14px; background: transparent; border: 1px dashed var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-ink); cursor: pointer; }

/* Member dropdown */
.member-dropdown { position: absolute; top: 44px; left: 0; right: 0; z-index: 20; max-height: 240px; overflow-y: auto; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; box-shadow: var(--shadow-md); padding: 4px; }
.member-dropdown__loading { padding: 12px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); text-align: center; }
.member-dropdown__item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; background: transparent; border: 0; border-radius: 8px; cursor: pointer; text-align: left; }
.member-dropdown__item:hover { background: var(--color-surface); }
.member-dropdown__avatar { width: 32px; height: 32px; border-radius: 999px; background: var(--color-accent); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 11px; font-weight: 700; flex-shrink: 0; }
.member-dropdown__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.member-dropdown__name { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.member-dropdown__email { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }

/* Form / modal */
.form { display: flex; flex-direction: column; gap: 14px; }
.form__row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form__error { padding: 10px 12px; background: #FEE2E2; color: #991B1B; border-radius: 8px; font-family: var(--font-body); font-size: 13px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.field__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }
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

@media (max-width: 900px) {
  .grid { grid-template-columns: 1fr; }
  .cats { position: static; }
  .cat-toolbar { flex-direction: column; align-items: stretch; }
  .cat-toolbar__actions { justify-content: stretch; }
  .cat-toolbar__actions .btn { flex: 1; }
  .hero { flex-direction: column; align-items: flex-start; text-align: left; }
  .hero__actions { flex-direction: row; align-self: stretch; }
  .hero__actions .hero__btn { flex: 1; }
  .player-row { grid-template-columns: 1fr auto; }
  .player-row__position { grid-column: 1; }
  .player-row__remove { grid-column: 2; grid-row: 1; }
}
</style>
