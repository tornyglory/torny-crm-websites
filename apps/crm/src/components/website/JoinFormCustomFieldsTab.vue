<script setup lang="ts">
/**
 * JoinFormCustomFieldsTab — the Website builder's Custom fields tab on
 * the Membership page's Join form block. CRUD + reorder over custom
 * facets (brief 105 §3.2). Not block-prop state — facets are a
 * club-level config at /clubs/{id}/custom-facets, so the panel lives
 * next to the block editor but talks to its own endpoints.
 */
import { computed, onMounted, ref, watch } from 'vue'
import {
  customFacets as customFacetsApi,
  ApiError,
  type CustomFacet,
  type FacetInputType,
} from '@torny/api-client'
import { useClubStore } from '@/stores/club'
import { useToast } from '@/composables/useToast'
import CrmSpinner from '@/components/CrmSpinner.vue'
import CrmModal from '@/components/modals/CrmModal.vue'
import FacetEditorModal from '@/components/modals/FacetEditorModal.vue'

const clubStore = useClubStore()
const toast = useToast()

const facets = ref<CustomFacet[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)

// Modal state
const editorOpen = ref(false)
const editorFacet = ref<CustomFacet | null>(null)
const confirmDelete = ref<CustomFacet | null>(null)
const deleting = ref(false)
// Debounce for drag-reorder PUT — we optimistically reorder locally
// then commit after 400ms of quiet. Keeps the list responsive even if
// the admin shuffles several rows in a row.
const reorderTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const savingOrder = ref(false)

const clubId = computed(() => clubStore.current?.id ?? null)

/** Short label for the input type — same copy as the editor modal. */
const INPUT_TYPE_LABELS: Record<FacetInputType, string> = {
  select:       'Dropdown',
  multi_select: 'Multi-select',
  radio:        'Radio',
  checkboxes:   'Checkboxes',
  text:         'Short text',
  long_text:    'Long text',
  number:       'Number',
  date:         'Date',
  boolean:      'Yes / No',
}

function sectionLabel(key: string): string {
  const match = clubStore.joinFormSections.find((s) => s.key === key)
  return match?.label ?? key
}

// ── Load ───────────────────────────────────────────────────────

async function load() {
  const cid = clubId.value
  if (cid == null) return
  loading.value = true
  loadError.value = null
  try {
    facets.value = await customFacetsApi.listFacets(cid)
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : 'Could not load custom fields.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(clubId, (next, prev) => {
  if (next !== prev) {
    facets.value = []
    void load()
  }
})

// ── Create / edit ──────────────────────────────────────────────

function openCreate() {
  editorFacet.value = null
  editorOpen.value = true
}
function openEdit(f: CustomFacet) {
  editorFacet.value = f
  editorOpen.value = true
}
function closeEditor() {
  editorOpen.value = false
  editorFacet.value = null
}
function onSaved(row: CustomFacet) {
  const idx = facets.value.findIndex((f) => f.facet_id === row.facet_id)
  if (idx >= 0) facets.value.splice(idx, 1, row)
  else facets.value.push(row)
  // Keep display order in sync so a newly-created row doesn't flicker
  // to the bottom then jump — backend already assigns the right order.
  facets.value.sort((a, b) => a.display_order - b.display_order)
}

// ── Reorder ────────────────────────────────────────────────────

function move(i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= facets.value.length) return
  const next = [...facets.value]
  const [row] = next.splice(i, 1)
  if (row) next.splice(j, 0, row)
  // Re-stamp display_order so the UI stays consistent with what the
  // server will echo back after the reorder POST.
  facets.value = next.map((f, k) => ({ ...f, display_order: k }))
  scheduleReorder()
}

function scheduleReorder() {
  if (reorderTimer.value) clearTimeout(reorderTimer.value)
  reorderTimer.value = setTimeout(commitReorder, 400)
}

async function commitReorder() {
  reorderTimer.value = null
  const cid = clubId.value
  if (cid == null) return
  const order = facets.value.map((f) => f.facet_id)
  savingOrder.value = true
  try {
    facets.value = await customFacetsApi.reorderFacets(cid, { order })
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Could not save the new order.')
    // Refetch so the UI doesn't drift from the server's truth.
    void load()
  } finally {
    savingOrder.value = false
  }
}

// ── Toggle active ──────────────────────────────────────────────

async function toggleActive(f: CustomFacet) {
  const cid = clubId.value
  if (cid == null) return
  const next = !f.is_active
  try {
    const updated = await customFacetsApi.updateFacet(cid, f.facet_id, { is_active: next })
    const idx = facets.value.findIndex((x) => x.facet_id === f.facet_id)
    if (idx >= 0) facets.value.splice(idx, 1, updated)
    toast.success(next ? 'Field enabled.' : 'Field hidden from join form.')
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not update the field.')
  }
}

// ── Delete ─────────────────────────────────────────────────────

function askDelete(f: CustomFacet) { confirmDelete.value = f }
async function doDelete() {
  const row = confirmDelete.value
  const cid = clubId.value
  if (!row || cid == null) return
  deleting.value = true
  try {
    await customFacetsApi.deleteFacet(cid, row.facet_id)
    facets.value = facets.value.filter((f) => f.facet_id !== row.facet_id)
    toast.success('Custom field removed.')
    confirmDelete.value = null
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not delete the field.')
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <section class="cfields">
    <header class="cfields__head">
      <div>
        <div class="cfields__eyebrow">Brief 105</div>
        <h3 class="cfields__title">Custom fields</h3>
        <p class="cfields__sub">
          Questions you want applicants to answer under the <strong>Additional questions</strong>
          section of the join form. Answers land on the member record and
          can be used to filter the Members list.
        </p>
      </div>
      <button type="button" class="cfields__add" @click="openCreate">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
        Add field
      </button>
    </header>

    <!-- Loading / error / empty -->
    <div v-if="loading && facets.length === 0" class="cfields__state">
      <CrmSpinner size="sm" label="Loading custom fields" />
    </div>
    <div v-else-if="loadError" class="cfields__state cfields__state--error">
      {{ loadError }}
      <button type="button" class="cfields__retry" @click="load">Retry</button>
    </div>
    <div v-else-if="facets.length === 0" class="cfields__empty">
      <div class="cfields__empty-title">No custom fields yet.</div>
      <p class="cfields__empty-sub">
        Add a question — dropdown, multi-select, checkbox, text — and it'll
        appear at the bottom of the public join form.
      </p>
      <button type="button" class="cfields__empty-btn" @click="openCreate">Add your first field</button>
    </div>

    <ul v-else class="cfields__list">
      <li
        v-for="(f, i) in facets"
        :key="f.facet_id"
        class="cfields__row"
        :class="{ 'is-inactive': !f.is_active }"
      >
        <div class="cfields__handles">
          <button
            type="button"
            class="cfields__handle"
            :disabled="i === 0 || savingOrder"
            aria-label="Move up"
            @click="move(i, -1)"
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 10l4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
          <button
            type="button"
            class="cfields__handle"
            :disabled="i === facets.length - 1 || savingOrder"
            aria-label="Move down"
            @click="move(i, 1)"
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        </div>

        <div class="cfields__body">
          <div class="cfields__name">
            {{ f.label }}
            <span v-if="f.required" class="cfields__badge cfields__badge--required">Required</span>
          </div>
          <div class="cfields__meta">
            <span class="cfields__pill">{{ INPUT_TYPE_LABELS[f.input_type] }}</span>
            <span class="cfields__pill cfields__pill--muted">in {{ sectionLabel(f.section_key) }}</span>
            <span v-if="f.searchable" class="cfields__pill cfields__pill--ink">Searchable</span>
            <span class="cfields__slug">{{ f.slug }}</span>
          </div>
        </div>

        <div class="cfields__actions">
          <button
            type="button"
            class="cfields__switch"
            :class="{ 'is-on': f.is_active }"
            :aria-label="f.is_active ? 'Disable field' : 'Enable field'"
            :title="f.is_active ? 'Field is live on the join form' : 'Field is hidden'"
            @click="toggleActive(f)"
          ><span class="cfields__switch-knob" /></button>
          <button
            type="button"
            class="cfields__action"
            aria-label="Edit field"
            @click="openEdit(f)"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11 2.5l2.5 2.5-8 8-3 .5.5-3 8-8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /></svg>
          </button>
          <button
            type="button"
            class="cfields__action cfields__action--danger"
            aria-label="Delete field"
            @click="askDelete(f)"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M5 4l1 9a1 1 0 001 1h2a1 1 0 001-1l1-9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        </div>
      </li>
    </ul>

    <FacetEditorModal
      :open="editorOpen"
      :club-id="clubId"
      :facet="editorFacet"
      :sections="clubStore.joinFormSections"
      @close="closeEditor"
      @saved="onSaved"
    />

    <CrmModal
      :open="confirmDelete != null"
      eyebrow="Remove custom field"
      :title="confirmDelete ? `Delete “${confirmDelete.label}”?` : ''"
      width="sm"
      @close="confirmDelete = null"
    >
      <p class="cfields__confirm-body">
        Existing member answers stay on their records — the field just
        stops rendering on the public join form and filters. You can
        re-add it later.
      </p>
      <template #footer>
        <button type="button" class="pill-btn pill-btn--ghost" :disabled="deleting" @click="confirmDelete = null">Cancel</button>
        <button type="button" class="pill-btn pill-btn--danger" :disabled="deleting" @click="doDelete">
          <CrmSpinner v-if="deleting" size="sm" label="Removing" />
          <span>{{ deleting ? 'Removing…' : 'Remove field' }}</span>
        </button>
      </template>
    </CrmModal>
  </section>
</template>

<style scoped>
.cfields { display: flex; flex-direction: column; gap: 16px; }
.cfields__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.cfields__eyebrow {
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.cfields__title {
  margin: 4px 0 6px;
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 600;
  color: var(--color-ink);
  letter-spacing: -0.01em;
}
.cfields__sub {
  margin: 0;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-fog);
  line-height: 1.5;
}
.cfields__add {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  background: var(--color-ink);
  color: #fff;
  border: 0;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
}
.cfields__add:hover { background: var(--color-graphite); }

.cfields__state { padding: 24px; text-align: center; color: var(--color-fog); font-family: var(--font-body); font-size: 13px; }
.cfields__state--error { color: #b91c1c; }
.cfields__retry {
  margin-left: 10px;
  background: transparent;
  border: 0;
  padding: 0;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-ink);
  cursor: pointer;
  text-decoration: underline;
}

.cfields__empty {
  padding: 32px 20px;
  text-align: center;
  background: var(--color-surface);
  border: 1px dashed var(--color-hairline);
  border-radius: 14px;
}
.cfields__empty-title {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  color: var(--color-ink);
  margin-bottom: 4px;
}
.cfields__empty-sub {
  margin: 0 0 14px;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-fog);
  line-height: 1.5;
}
.cfields__empty-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 18px;
  background: var(--color-ink);
  color: #fff;
  border: 0;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.cfields__empty-btn:hover { background: var(--color-graphite); }

.cfields__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.cfields__row {
  display: grid;
  grid-template-columns: 28px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  transition: border-color 120ms ease, opacity 120ms ease;
}
.cfields__row.is-inactive { opacity: 0.5; }
.cfields__row:hover { border-color: var(--color-ink); }

.cfields__handles { display: flex; flex-direction: column; gap: 2px; }
.cfields__handle {
  width: 24px;
  height: 14px;
  background: transparent;
  border: 0;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-fog);
  cursor: pointer;
  border-radius: 4px;
}
.cfields__handle:hover:not(:disabled) { color: var(--color-ink); background: var(--color-surface); }
.cfields__handle:disabled { opacity: 0.3; cursor: not-allowed; }

.cfields__body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.cfields__name {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 600;
  color: var(--color-ink);
}
.cfields__meta {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--color-fog);
}
.cfields__pill {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 8px;
  background: var(--color-surface);
  color: var(--color-ink);
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.cfields__pill--muted { color: var(--color-fog); }
.cfields__pill--ink { background: var(--color-ink); color: #fff; }
.cfields__badge {
  display: inline-flex;
  align-items: center;
  height: 16px;
  padding: 0 6px;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.cfields__badge--required { background: #fef3c7; color: #92400e; }
.cfields__slug {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-mute);
}

.cfields__actions { display: inline-flex; align-items: center; gap: 4px; }
.cfields__switch {
  width: 36px;
  height: 20px;
  border: 0;
  background: var(--color-mute);
  border-radius: 999px;
  position: relative;
  cursor: pointer;
  margin-right: 6px;
  transition: background 0.12s ease;
}
.cfields__switch.is-on { background: var(--color-ink); }
.cfields__switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 999px;
  transition: transform 0.12s ease;
}
.cfields__switch.is-on .cfields__switch-knob { transform: translateX(16px); }

.cfields__action {
  width: 30px;
  height: 30px;
  background: transparent;
  border: 0;
  padding: 0;
  border-radius: 8px;
  color: var(--color-fog);
  cursor: pointer;
}
.cfields__action:hover { color: var(--color-ink); background: var(--color-surface); }
.cfields__action--danger:hover { color: #b91c1c; background: #fef2f2; }

.cfields__confirm-body {
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--color-graphite);
  line-height: 1.55;
  margin: 0;
}

.pill-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 18px;
  border: 0;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.pill-btn--ghost { background: transparent; color: var(--color-ink); }
.pill-btn--ghost:hover:not(:disabled) { background: var(--color-hairline); }
.pill-btn--ghost:disabled { color: var(--color-mute); cursor: not-allowed; }
.pill-btn--danger { background: #b91c1c; color: #fff; padding: 0 22px; }
.pill-btn--danger:hover:not(:disabled) { background: #991b1b; }
.pill-btn--danger:disabled { background: var(--color-mute); cursor: not-allowed; }
</style>
