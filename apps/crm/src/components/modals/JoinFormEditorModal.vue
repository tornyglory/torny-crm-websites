<script setup lang="ts">
/**
 * JoinFormEditorModal — brief 106's "Edit join form" dialog.
 *
 * Owner clicks the Join form block in the website editor's right-rail
 * header → modal opens. Left panel: sortable section list (toggle
 * visibility, reorder). Right panel: context-dependent inspector —
 * custom-facet CRUD for the `additional` section, read-only previews
 * for hardcoded sections, and a Settings link for the `tier` section.
 *
 * Section overrides PATCH `/clubs/{id}/join-form-config` on save (brief
 * 106 §3.2). While that endpoint is pre-live it returns 404 and we
 * surface a friendly toast — the facet CRUD (which uses the already-
 * live brief-105 endpoints) still writes immediately.
 *
 * Paper artboard: ◆ CRM Join Form Editor · Modal.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  variant as variantApi,
  customFacets as customFacetsApi,
  ApiError,
  CLUB_DEFAULT_JOIN_FORM_SECTIONS,
  filterLegacyJoinFormSections,
  type VariantConfig,
  type JoinFormSection,
  type JoinFormSectionOverride,
  type CustomFacet,
  type CreateFacetInput,
  type UpdateFacetInput,
  type FacetInputType,
  type FacetOption,
  type FacetErrorCode,
} from '@torny/api-client'
import CrmSpinner from '@/components/CrmSpinner.vue'
import CrmModal from '@/components/modals/CrmModal.vue'
import { useToast } from '@/composables/useToast'
import { useRouter } from 'vue-router'

const props = defineProps<{
  open: boolean
  clubId: number | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved'): void
}>()

const toast = useToast()
const router = useRouter()

// ── Load ───────────────────────────────────────────────────────

const loading = ref(false)
const loadError = ref<string | null>(null)
const variant = ref<VariantConfig | null>(null)
const facets = ref<CustomFacet[]>([])

interface SectionRow {
  key: string
  /** The default label from the variant — what the row renders at if
   *  the admin hasn't overridden it. Never mutated after load. */
  defaultLabel: string
  /** The admin's chosen label. Diff vs `defaultLabel` → send
   *  `label_override` on save; equal → send `null` (clear override). */
  label: string
  visible: boolean
}

/** Local copy of the section list — edits land here, Save commits via
 *  PATCH /join-form-config. Starts aligned with the variant + overrides
 *  and tracks `dirty` so the Save button enables sensibly. */
const sections = ref<SectionRow[]>([])
const initialSections = ref<SectionRow[]>([])
const selectedKey = ref<string>('additional')

async function load() {
  const cid = props.clubId
  if (cid == null) return
  loading.value = true
  loadError.value = null
  try {
    const [v, f] = await Promise.all([
      variantApi.getVariant(cid),
      customFacetsApi.listFacets(cid),
    ])
    variant.value = v
    // Strip retired section keys (brief 106 follow-up — `your_bowls`)
    // before taking the first element with a value. Shrinks to no-op
    // once the backend variant registry drops them.
    const source = filterLegacyJoinFormSections(
      v.join_form_sections?.length ? v.join_form_sections : CLUB_DEFAULT_JOIN_FORM_SECTIONS,
    )
    const list = source.map<SectionRow>((s: JoinFormSection) => ({
      key: s.key,
      defaultLabel: s.label,
      label: s.label,
      visible: s.visible !== false,
    }))
    sections.value = list
    initialSections.value = list.map((r) => ({ ...r }))
    // Backend returns `null` / an empty object for clubs with no facets
    // configured yet — the typed signature says `CustomFacet[]` but the
    // envelope can be sparse. Coerce defensively so the computed `.filter`
    // never hits a non-array.
    facets.value = Array.isArray(f) ? f : []
    // Default to additional so the facet editor is up front — the
    // whole point of the modal for most sessions.
    const hasAdditional = list.some((s) => s.key === 'additional')
    selectedKey.value = hasAdditional ? 'additional' : (list[0]?.key ?? 'additional')
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : 'Could not load the join form config.'
  } finally {
    loading.value = false
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) void load()
    else {
      variant.value = null
      facets.value = []
      sections.value = []
      initialSections.value = []
      expandedFacetId.value = null
      savingAll.value = false
    }
  },
)

// ── Section list editing ───────────────────────────────────────

const sectionsDirty = computed<boolean>(() => {
  if (sections.value.length !== initialSections.value.length) return true
  for (let i = 0; i < sections.value.length; i++) {
    const a = sections.value[i]!
    const b = initialSections.value[i]!
    if (a.key !== b.key || a.visible !== b.visible || a.label !== b.label) return true
  }
  return false
})

function moveSection(i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= sections.value.length) return
  const next = [...sections.value]
  const [row] = next.splice(i, 1)
  if (row) next.splice(j, 0, row)
  sections.value = next
}

/** Keys the FE never lets the admin hide, even if the backend accepts
 *  a visible:false override. `review` holds the submit button + consent
 *  — hiding it would break every application. */
const LOCKED_VISIBLE_KEYS: readonly string[] = ['review']

function toggleSection(i: number) {
  const row = sections.value[i]
  if (!row) return
  if (LOCKED_VISIBLE_KEYS.includes(row.key)) return
  sections.value = sections.value.map((r, k) => (k === i ? { ...r, visible: !r.visible } : r))
}

const selectedSection = computed<SectionRow | null>(() => {
  return sections.value.find((s) => s.key === selectedKey.value) ?? null
})

const selectedSectionIndex = computed<number>(() => {
  return sections.value.findIndex((s) => s.key === selectedKey.value)
})

/** v-model bridge so editing the heading in the right panel mutates
 *  the selected row immutably — straight mutation of
 *  `selectedSection.value.label` would work, but routing through a
 *  writable computed keeps reactivity + dirty tracking predictable. */
const selectedSectionLabel = computed<string>({
  get() { return selectedSection.value?.label ?? '' },
  set(next) {
    const key = selectedKey.value
    sections.value = sections.value.map((r) => (r.key === key ? { ...r, label: next } : r))
  },
})

function resetSelectedLabel() {
  const row = selectedSection.value
  if (!row) return
  selectedSectionLabel.value = row.defaultLabel
}

const selectedLabelOverridden = computed<boolean>(() => {
  const row = selectedSection.value
  return !!row && row.label.trim() !== row.defaultLabel.trim() && row.label.trim().length > 0
})

// ── Facets (only used when `additional` is selected) ───────────

const expandedFacetId = ref<number | null>(null)
/** Transient draft keyed by facet_id for inline edits. Flushed to the
 *  server on blur / collapse so chatty edits don't fire a PATCH per
 *  keystroke. Null means "editing hasn't started" — use the server row. */
const facetDrafts = reactive<Record<number, { label: string; helper_text: string; options: FacetOption[]; required: boolean; searchable: boolean; input_type: FacetInputType }>>({})
const savingFacetId = ref<number | null>(null)
const addingFacet = ref(false)
const deleteConfirm = ref<CustomFacet | null>(null)
const facetError = ref<string | null>(null)

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

const INPUT_TYPE_OPTIONS: Array<{ value: FacetInputType; label: string; hasOptions: boolean }> = [
  { value: 'select',       label: 'Dropdown (single)',   hasOptions: true  },
  { value: 'multi_select', label: 'Dropdown (multiple)', hasOptions: true  },
  { value: 'radio',        label: 'Radio buttons',       hasOptions: true  },
  { value: 'checkboxes',   label: 'Checkbox group',      hasOptions: true  },
  { value: 'text',         label: 'Short text',          hasOptions: false },
  { value: 'long_text',    label: 'Long text',           hasOptions: false },
  { value: 'number',       label: 'Number',              hasOptions: false },
  { value: 'date',         label: 'Date',                hasOptions: false },
  { value: 'boolean',      label: 'Yes / No toggle',     hasOptions: false },
]

function hasOptionsType(type: FacetInputType): boolean {
  return INPUT_TYPE_OPTIONS.find((t) => t.value === type)?.hasOptions ?? false
}

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64)
}

function ensureDraft(f: CustomFacet) {
  if (facetDrafts[f.facet_id]) return
  facetDrafts[f.facet_id] = {
    label: f.label,
    helper_text: f.helper_text ?? '',
    options: f.options.map((o) => ({ ...o })),
    required: f.required,
    searchable: f.searchable,
    input_type: f.input_type,
  }
}

function expandFacet(f: CustomFacet) {
  if (expandedFacetId.value === f.facet_id) {
    // Clicking the already-expanded card collapses it (+ flushes the draft).
    void flushDraft(f.facet_id)
    expandedFacetId.value = null
    return
  }
  // Collapsing whichever card was open first — commit its draft before swapping.
  if (expandedFacetId.value != null) void flushDraft(expandedFacetId.value)
  ensureDraft(f)
  expandedFacetId.value = f.facet_id
}

async function flushDraft(facetId: number): Promise<void> {
  const draft = facetDrafts[facetId]
  if (!draft) return
  const row = facets.value.find((f) => f.facet_id === facetId)
  if (!row) return
  // Compare — if nothing changed don't fire a PATCH.
  const sameOptions = JSON.stringify(row.options) === JSON.stringify(draft.options.filter((o) => o.value.trim() && o.label.trim()))
  if (
    row.label === draft.label.trim() &&
    (row.helper_text ?? '') === draft.helper_text.trim() &&
    row.required === draft.required &&
    row.searchable === draft.searchable &&
    row.input_type === draft.input_type &&
    sameOptions
  ) {
    delete facetDrafts[facetId]
    return
  }
  const patch: UpdateFacetInput = {
    label: draft.label.trim() || row.label,
    helper_text: draft.helper_text.trim() || null,
    required: draft.required,
    searchable: draft.searchable,
    input_type: draft.input_type,
  }
  if (hasOptionsType(draft.input_type)) {
    patch.options = draft.options
      .filter((o) => o.value.trim() && o.label.trim())
      .map((o) => ({ value: o.value.trim(), label: o.label.trim() }))
  }
  const cid = props.clubId
  if (cid == null) return
  savingFacetId.value = facetId
  try {
    const updated = await customFacetsApi.updateFacet(cid, facetId, patch)
    const idx = facets.value.findIndex((f) => f.facet_id === facetId)
    if (idx >= 0) facets.value.splice(idx, 1, updated)
    delete facetDrafts[facetId]
    facetError.value = null
  } catch (err) {
    facetError.value = messageFor(err, 'Could not save the field.')
  } finally {
    savingFacetId.value = null
  }
}

async function addFacet() {
  const cid = props.clubId
  if (cid == null) return
  addingFacet.value = true
  facetError.value = null
  try {
    const row = await customFacetsApi.createFacet(cid, {
      label: 'Untitled field',
      input_type: 'text',
      options: [],
      required: false,
      searchable: true,
      section_key: 'additional',
      // Backend defaults `is_active` to false when omitted, which hides
      // the facet from the public endpoint. New fields should land
      // live; admins can hide them later from Settings → Custom fields.
      is_active: true,
    } as CreateFacetInput)
    facets.value = [row, ...facets.value]
    expandedFacetId.value = row.facet_id
    ensureDraft(row)
    // Focus the label in the next tick.
    void nextTick(() => {
      const el = document.querySelector<HTMLInputElement>(`[data-facet-label="${row.facet_id}"]`)
      el?.focus()
      el?.select()
    })
  } catch (err) {
    facetError.value = messageFor(err, 'Could not add the field.')
  } finally {
    addingFacet.value = false
  }
}

function askDelete(f: CustomFacet) {
  deleteConfirm.value = f
}

async function doDelete() {
  const row = deleteConfirm.value
  const cid = props.clubId
  if (!row || cid == null) return
  try {
    await customFacetsApi.deleteFacet(cid, row.facet_id)
    facets.value = facets.value.filter((f) => f.facet_id !== row.facet_id)
    if (expandedFacetId.value === row.facet_id) expandedFacetId.value = null
    delete facetDrafts[row.facet_id]
    deleteConfirm.value = null
  } catch (err) {
    toast.error(messageFor(err, 'Could not delete the field.'))
  }
}

async function moveFacet(i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= facets.value.length) return
  const next = [...facets.value]
  const [row] = next.splice(i, 1)
  if (row) next.splice(j, 0, row)
  facets.value = next.map((f, k) => ({ ...f, display_order: k }))
  const cid = props.clubId
  if (cid == null) return
  try {
    facets.value = await customFacetsApi.reorderFacets(cid, { order: facets.value.map((f) => f.facet_id) })
  } catch (err) {
    toast.error(messageFor(err, 'Could not save the new order.'))
  }
}

// ── Facet editor helpers (bind to draft) ───────────────────────

function draftFor(facetId: number) {
  return facetDrafts[facetId]
}

function addOption(facetId: number) {
  const d = facetDrafts[facetId]
  if (!d) return
  d.options.push({ value: '', label: '' })
}

function removeOption(facetId: number, i: number) {
  const d = facetDrafts[facetId]
  if (!d) return
  d.options.splice(i, 1)
}

function onOptionLabelInput(facetId: number, i: number, label: string) {
  const d = facetDrafts[facetId]
  const opt = d?.options[i]
  if (!opt) return
  const prev = opt.label
  opt.label = label
  if (!opt.value || opt.value === slugify(prev)) {
    opt.value = slugify(label)
  }
}

// ── Save ───────────────────────────────────────────────────────

const savingAll = ref(false)
const saveError = ref<string | null>(null)

const canSave = computed<boolean>(() => {
  if (savingAll.value) return false
  return sectionsDirty.value
})

async function save() {
  // Flush any open facet draft first so unsaved field edits don't get lost.
  if (expandedFacetId.value != null) {
    await flushDraft(expandedFacetId.value)
  }

  const cid = props.clubId
  if (cid == null) {
    emit('close')
    return
  }

  if (!sectionsDirty.value) {
    toast.success('Join form updated.')
    emit('saved')
    emit('close')
    return
  }

  savingAll.value = true
  saveError.value = null
  const payload = {
    sections: sections.value.map<JoinFormSectionOverride>((s, i) => {
      const trimmed = s.label.trim()
      const override = trimmed && trimmed !== s.defaultLabel ? trimmed : null
      return {
        key: s.key,
        order: i,
        visible: s.visible,
        label_override: override,
      }
    }),
  }
  try {
    const updated = await variantApi.updateJoinFormConfig(cid, payload)
    variant.value = updated
    initialSections.value = sections.value.map((r) => ({ ...r }))
    toast.success('Join form updated.')
    emit('saved')
    emit('close')
  } catch (err) {
    saveError.value = sectionConfigMessageFor(err, 'Could not save section changes.')
  } finally {
    savingAll.value = false
  }
}

/** Brief 106 §8.2 — map the live PATCH /join-form-config error codes
 *  to admin-friendly copy. Falls back to the server's own message for
 *  anything we haven't typed yet. Kept separate from the facet
 *  messageFor so the two sets stay readable. */
function sectionConfigMessageFor(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return err instanceof Error ? err.message : fallback
  const code = err.code as import('@torny/api-client').JoinFormConfigErrorCode | undefined
  switch (code) {
    case 'sections_required':  return 'Nothing to save — the sections list came through empty.'
    case 'bad_section':        return 'One of the sections is malformed. Refresh and try again.'
    case 'forbidden':          return 'Only the club owner can change the join form layout.'
    case 'not_found':          return 'This club no longer exists — please refresh.'
    case 'unknown_section':    return 'One of the sections is no longer available. Refresh the page and retry.'
    case 'duplicate_section':  return 'The same section appears twice in the list — refresh and try again.'
    case 'bad_order':          return 'The section order looks wrong. Refresh the modal to resync and retry.'
    case 'bad_label':          return 'A section label is too long — keep custom names under 80 characters.'
    default:                   return err.message || fallback
  }
}

// ── Cancel: discard section changes but keep live facet edits ──

function requestClose() {
  if (sectionsDirty.value && !window.confirm('Discard section changes? (Field edits are already saved.)')) return
  emit('close')
}

// ── Facet error mapping ────────────────────────────────────────

function messageFor(err: unknown, fallback: string): string {
  const code = err instanceof ApiError ? (err.code as FacetErrorCode | undefined) : undefined
  switch (code) {
    case 'label_required':      return 'Add a label before saving.'
    case 'label_too_long':      return 'Label is too long — keep it under 120 characters.'
    case 'bad_input_type':      return 'That input type isn’t supported.'
    case 'bad_slug':            return 'Slug can only contain lowercase letters, digits, and underscores.'
    case 'options_required':    return 'Add at least two options.'
    case 'options_not_allowed': return 'This input type doesn’t use options — remove them.'
    case 'bad_option':          return 'One of the options is missing a value or label.'
    case 'duplicate_option':    return 'Option values must be unique.'
    case 'slug_taken':          return 'That slug is already used — pick a different label.'
    case 'forbidden':           return 'Only the club owner can edit custom fields.'
    case 'not_found':           return 'This field no longer exists — refresh and try again.'
    default:                    return err instanceof Error ? err.message : fallback
  }
}

// ── Navigation shortcut: tier section → Settings → Membership ──

function goToMembershipSettings() {
  emit('close')
  void router.push({ name: 'settings', params: { section: 'membership' } })
}

function goToCustomFieldsSettings() {
  emit('close')
  void router.push({ name: 'settings', params: { section: 'custom-fields' } })
}

// ── Keyboard: ⌘↵ saves ──────────────────────────────────────────

function onKey(e: KeyboardEvent) {
  if (!props.open) return
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSave.value) {
    e.preventDefault()
    void save()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// ── Facet in the selected section ──────────────────────────────

const facetsForSelected = computed<CustomFacet[]>(() => {
  if (selectedKey.value !== 'additional') return []
  const list = Array.isArray(facets.value) ? facets.value : []
  return list.filter((f) => f.section_key === 'additional')
})
</script>

<template>
  <CrmModal
    :open="open"
    eyebrow="Website block"
    title="Edit join form"
    width="xl"
    @close="requestClose"
  >
    <div class="jfe">
      <!-- Loading / error -->
      <div v-if="loading" class="jfe__state">
        <CrmSpinner size="sm" label="Loading join form config" />
      </div>
      <div v-else-if="loadError" class="jfe__state jfe__state--error">
        {{ loadError }}
        <button type="button" class="jfe__retry" @click="load">Retry</button>
      </div>

      <template v-else>
        <!-- Left panel · section list ───────────────────── -->
        <aside class="jfe__sections">
          <div class="jfe__eyebrow">Sections</div>
          <p class="jfe__sub">Reorder with the arrows. Toggle to hide.</p>
          <ul class="jfe__sec-list">
            <li
              v-for="(sec, i) in sections"
              :key="sec.key"
              class="jfe__sec"
              :class="{
                'is-selected': selectedKey === sec.key,
                'is-hidden': !sec.visible,
              }"
              @click="selectedKey = sec.key"
            >
              <div class="jfe__sec-handles">
                <button
                  type="button"
                  class="jfe__sec-handle"
                  :disabled="i === 0"
                  aria-label="Move up"
                  @click.stop="moveSection(i, -1)"
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 10l4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
                </button>
                <button
                  type="button"
                  class="jfe__sec-handle"
                  :disabled="i === sections.length - 1"
                  aria-label="Move down"
                  @click.stop="moveSection(i, 1)"
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
                </button>
              </div>
              <div class="jfe__sec-index">{{ String(i + 1).padStart(2, '0') }}</div>
              <div class="jfe__sec-label">{{ sec.label }}</div>
              <button
                type="button"
                class="jfe__toggle"
                :class="{ 'is-on': sec.visible, 'is-locked': LOCKED_VISIBLE_KEYS.includes(sec.key) }"
                :aria-label="sec.visible ? 'Hide section' : 'Show section'"
                :disabled="LOCKED_VISIBLE_KEYS.includes(sec.key)"
                :title="LOCKED_VISIBLE_KEYS.includes(sec.key) ? 'Can’t hide — this section holds the submit button.' : ''"
                @click.stop="toggleSection(i)"
              ><span class="jfe__toggle-knob" /></button>
            </li>
          </ul>
        </aside>

        <!-- Right panel · contextual inspector ───────────── -->
        <section class="jfe__inspector">
          <template v-if="selectedSection">
            <div class="jfe__insp-head">
              <div class="jfe__eyebrow">
                Section {{ String(selectedSectionIndex + 1).padStart(2, '0') }}
                <template v-if="selectedKey === 'additional'">
                  · {{ facetsForSelected.length }} {{ facetsForSelected.length === 1 ? 'field' : 'fields' }}
                </template>
              </div>
              <!-- Brief 107 — inline label editor. Clubs can rename
                   every section (e.g. "Additional questions" →
                   "Tell us more"). Diff vs the variant default commits
                   as `label_override` on save. -->
              <div class="jfe__insp-title-row">
                <input
                  v-model="selectedSectionLabel"
                  class="jfe__insp-title-input"
                  :placeholder="selectedSection.defaultLabel"
                  :aria-label="`Rename ${selectedSection.defaultLabel}`"
                  maxlength="80"
                />
                <button
                  v-if="selectedLabelOverridden"
                  type="button"
                  class="jfe__insp-reset"
                  @click="resetSelectedLabel"
                >Reset</button>
              </div>
              <p v-if="selectedKey === 'additional'" class="jfe__insp-sub">
                Custom fields members fill in when they join. Searchable
                fields also appear as filter chips on the Members list.
              </p>
              <p v-else-if="selectedKey === 'tier'" class="jfe__insp-sub">
                Tiers are managed in <a href="#" @click.prevent="goToMembershipSettings">Settings → Membership types</a>.
                Toggle this section off in the list to hide tier picking
                on the public form.
              </p>
              <p v-else class="jfe__insp-sub">
                Fields in this section are built in — toggle the whole
                section off in the list on the left if you don't want
                them on the public form.
              </p>
            </div>

            <!-- Facet CRUD when `additional` is selected -->
            <template v-if="selectedKey === 'additional'">
              <div class="jfe__fields-head">
                <div class="jfe__eyebrow">Fields</div>
                <button
                  type="button"
                  class="jfe__add"
                  :disabled="addingFacet"
                  @click="addFacet"
                >
                  <CrmSpinner v-if="addingFacet" size="sm" label="Adding" />
                  <svg v-else width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                  </svg>
                  <span>Add field</span>
                </button>
              </div>

              <div v-if="facetError" class="jfe__field-error">{{ facetError }}</div>

              <div v-if="facetsForSelected.length === 0" class="jfe__empty">
                <div class="jfe__empty-title">No custom fields yet.</div>
                <p class="jfe__empty-sub">Add one and it'll render under <em>Additional questions</em> on the public join form.</p>
              </div>

              <ul v-else class="jfe__facets">
                <li
                  v-for="(f, i) in facetsForSelected"
                  :key="f.facet_id"
                  class="jfe__facet"
                  :class="{ 'is-expanded': expandedFacetId === f.facet_id }"
                >
                  <!-- Header (always rendered) -->
                  <header class="jfe__facet-head" @click="expandFacet(f)">
                    <div class="jfe__facet-handles">
                      <button
                        type="button"
                        class="jfe__sec-handle"
                        :disabled="i === 0"
                        aria-label="Move up"
                        @click.stop="moveFacet(i, -1)"
                      >
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 10l4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
                      </button>
                      <button
                        type="button"
                        class="jfe__sec-handle"
                        :disabled="i === facetsForSelected.length - 1"
                        aria-label="Move down"
                        @click.stop="moveFacet(i, 1)"
                      >
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
                      </button>
                    </div>
                    <div class="jfe__facet-title">
                      {{ draftFor(f.facet_id)?.label ?? f.label ?? 'Untitled field' }}
                    </div>
                    <span class="jfe__pill">{{ INPUT_TYPE_LABELS[draftFor(f.facet_id)?.input_type ?? f.input_type] }}</span>
                    <span v-if="(draftFor(f.facet_id)?.searchable ?? f.searchable)" class="jfe__pill jfe__pill--soft">Searchable</span>
                    <CrmSpinner v-if="savingFacetId === f.facet_id" size="sm" label="Saving" />
                    <svg
                      class="jfe__chev"
                      :class="{ 'is-up': expandedFacetId === f.facet_id }"
                      width="12"
                      height="12"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </header>

                  <!-- Expanded editor -->
                  <div v-if="expandedFacetId === f.facet_id && draftFor(f.facet_id)" class="jfe__facet-body">
                    <div class="jfe__row">
                      <label class="jfe__field">
                        <span class="jfe__label">Question</span>
                        <input
                          v-model="draftFor(f.facet_id)!.label"
                          :data-facet-label="f.facet_id"
                          type="text"
                          class="jfe__input"
                          maxlength="120"
                          placeholder="e.g. Preferred position"
                        />
                      </label>
                      <label class="jfe__field">
                        <span class="jfe__label">Field type</span>
                        <select
                          v-model="draftFor(f.facet_id)!.input_type"
                          class="jfe__select"
                        >
                          <option
                            v-for="opt in INPUT_TYPE_OPTIONS"
                            :key="opt.value"
                            :value="opt.value"
                          >{{ opt.label }}</option>
                        </select>
                      </label>
                    </div>

                    <section v-if="hasOptionsType(draftFor(f.facet_id)!.input_type)" class="jfe__options">
                      <div class="jfe__label">Options</div>
                      <ul class="jfe__opt-list">
                        <li
                          v-for="(opt, oi) in draftFor(f.facet_id)!.options"
                          :key="oi"
                          class="jfe__opt"
                        >
                          <input
                            v-model="opt.value"
                            type="text"
                            class="jfe__input jfe__input--mono jfe__opt-value"
                            placeholder="value"
                          />
                          <input
                            :value="opt.label"
                            type="text"
                            class="jfe__input jfe__opt-label"
                            placeholder="Label"
                            @input="(e) => onOptionLabelInput(f.facet_id, oi, (e.target as HTMLInputElement).value)"
                          />
                          <button
                            type="button"
                            class="jfe__opt-delete"
                            aria-label="Remove option"
                            @click="removeOption(f.facet_id, oi)"
                          >
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
                          </button>
                        </li>
                      </ul>
                      <button type="button" class="jfe__add-opt" @click="addOption(f.facet_id)">
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
                        <span>Add option</span>
                      </button>
                    </section>

                    <div class="jfe__facet-foot">
                      <label class="jfe__switch-row">
                        <button
                          type="button"
                          class="jfe__toggle"
                          :class="{ 'is-on': draftFor(f.facet_id)!.required }"
                          @click="draftFor(f.facet_id)!.required = !draftFor(f.facet_id)!.required"
                        ><span class="jfe__toggle-knob" /></button>
                        <span>Required</span>
                      </label>
                      <label class="jfe__switch-row">
                        <button
                          type="button"
                          class="jfe__toggle"
                          :class="{ 'is-on': draftFor(f.facet_id)!.searchable }"
                          @click="draftFor(f.facet_id)!.searchable = !draftFor(f.facet_id)!.searchable"
                        ><span class="jfe__toggle-knob" /></button>
                        <span>Show in Members filters</span>
                      </label>
                      <button
                        type="button"
                        class="jfe__delete-field"
                        @click="askDelete(f)"
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M5 4l1 9a1 1 0 001 1h2a1 1 0 001-1l1-9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
                        Delete field
                      </button>
                    </div>
                  </div>
                </li>
              </ul>

              <p class="jfe__footnote">
                Need to edit without opening this modal? Go to
                <a href="#" @click.prevent="goToCustomFieldsSettings">Settings → Custom fields</a>.
              </p>
            </template>

            <!-- Hardcoded section preview -->
            <template v-else>
              <div class="jfe__read-only">
                <div class="jfe__read-only-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.6" />
                    <path d="M7 9h10M7 13h6M7 17h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                  </svg>
                </div>
                <div class="jfe__read-only-title">Built-in fields</div>
                <p class="jfe__read-only-sub">
                  This section's inputs are shipped with the join form.
                  Flip the toggle in the left panel to hide the whole
                  section on the public page.
                </p>
              </div>
            </template>
          </template>
        </section>
      </template>
    </div>

    <template #footer>
      <div class="jfe__foot-hint">
        <template v-if="saveError">
          <span class="jfe__foot-hint--error">{{ saveError }}</span>
        </template>
        <template v-else>
          Changes publish to the public join form when you save.
        </template>
      </div>
      <button
        type="button"
        class="pill-btn pill-btn--ghost"
        :disabled="savingAll"
        @click="requestClose"
      >Cancel</button>
      <button
        type="button"
        class="pill-btn pill-btn--ink"
        :disabled="savingAll || !canSave"
        @click="save"
      >
        <CrmSpinner v-if="savingAll" size="sm" label="Saving" />
        <span>{{ savingAll ? 'Saving…' : 'Save changes' }}</span>
      </button>
    </template>

    <CrmModal
      :open="deleteConfirm != null"
      eyebrow="Remove field"
      :title="deleteConfirm ? `Delete “${deleteConfirm.label}”?` : ''"
      width="sm"
      @close="deleteConfirm = null"
    >
      <p class="jfe__confirm">
        Existing member answers stay on their records — the field just
        stops rendering on the public form and filters.
      </p>
      <template #footer>
        <button type="button" class="pill-btn pill-btn--ghost" @click="deleteConfirm = null">Cancel</button>
        <button type="button" class="pill-btn pill-btn--danger" @click="doDelete">Remove field</button>
      </template>
    </CrmModal>
  </CrmModal>
</template>

<style scoped>
.jfe {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 24px;
  min-height: 560px;
}

.jfe__state { grid-column: 1 / -1; padding: 60px; text-align: center; color: var(--color-fog); font-family: var(--font-body); font-size: 13px; }
.jfe__state--error { color: #b91c1c; }
.jfe__retry { margin-left: 10px; background: transparent; border: 0; padding: 0; font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); cursor: pointer; text-decoration: underline; }

/* ── Left panel ──────────────────────────────────────────────── */
.jfe__sections {
  border-right: 1px solid var(--color-hairline);
  padding-right: 24px;
}
.jfe__eyebrow {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.jfe__sub {
  margin: 4px 0 16px;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
}
.jfe__sec-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.jfe__sec {
  display: grid;
  grid-template-columns: 28px 24px 1fr 40px;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.jfe__sec:hover:not(.is-selected) { background: var(--color-surface); }
.jfe__sec.is-selected {
  background: var(--color-accent-soft, #DBEAFE);
}
.jfe__sec.is-selected .jfe__sec-index,
.jfe__sec.is-selected .jfe__sec-label { color: var(--color-accent-strong, #1E40AF); }
.jfe__sec.is-hidden .jfe__sec-label,
.jfe__sec.is-hidden .jfe__sec-index { color: var(--color-mute); }

.jfe__sec-handles { display: flex; flex-direction: column; gap: 2px; }
.jfe__sec-handle {
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
.jfe__sec-handle:hover:not(:disabled) { color: var(--color-ink); background: rgba(255, 255, 255, 0.4); }
.jfe__sec-handle:disabled { opacity: 0.25; cursor: not-allowed; }

.jfe__sec-index { font-family: var(--font-mono); font-size: 11px; font-weight: 600; color: var(--color-fog); }
.jfe__sec-label { font-family: var(--font-body); font-size: 14px; font-weight: 600; color: var(--color-ink); }

/* Blue iOS-style toggle, matching Paper. */
.jfe__toggle {
  width: 40px;
  height: 22px;
  border-radius: 999px;
  background: var(--color-hairline);
  border: 0;
  position: relative;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s ease;
}
.jfe__toggle.is-on { background: var(--color-accent, #2563eb); }
.jfe__toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  background: #fff;
  border-radius: 999px;
  transition: transform 0.12s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}
.jfe__toggle.is-on .jfe__toggle-knob { transform: translateX(18px); }
.jfe__toggle.is-locked { opacity: 0.4; cursor: not-allowed; }

/* ── Right panel ─────────────────────────────────────────────── */
.jfe__inspector {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  padding-left: 0;
}
.jfe__insp-head { display: flex; flex-direction: column; gap: 6px; }
.jfe__insp-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--color-ink);
}
/* Brief 107 — editable section title. Input visually matches the
 * display title; only reveals a border/background when focused so the
 * resting state still reads as a heading. */
.jfe__insp-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.jfe__insp-title-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 1px solid transparent;
  padding: 4px 8px;
  margin-left: -8px;
  border-radius: 8px;
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--color-ink);
  outline: none;
  transition: border-color 120ms ease, background 120ms ease;
}
.jfe__insp-title-input:hover { border-color: var(--color-hairline); }
.jfe__insp-title-input:focus {
  border-color: var(--color-ink);
  background: #fff;
}
.jfe__insp-reset {
  flex-shrink: 0;
  background: transparent;
  border: 0;
  padding: 4px 10px;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-accent, #2563eb);
  cursor: pointer;
  border-radius: 999px;
}
.jfe__insp-reset:hover { background: var(--color-surface); }
.jfe__insp-sub {
  margin: 4px 0 0;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-fog);
  line-height: 1.55;
}
.jfe__insp-sub a {
  color: var(--color-ink);
  font-weight: 600;
  text-decoration: none;
  border-bottom: 1px solid var(--color-hairline);
}
.jfe__insp-sub a:hover { border-bottom-color: var(--color-ink); }

.jfe__fields-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
}
.jfe__add {
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
}
.jfe__add:hover:not(:disabled) { background: var(--color-graphite); }
.jfe__add:disabled { opacity: 0.6; cursor: not-allowed; }

.jfe__field-error {
  padding: 10px 12px;
  border-radius: 8px;
  background: #fef2f2;
  color: #b91c1c;
  font-family: var(--font-body);
  font-size: 12px;
}

.jfe__empty {
  padding: 32px 24px;
  text-align: center;
  background: var(--color-surface);
  border: 1px dashed var(--color-hairline);
  border-radius: 14px;
}
.jfe__empty-title { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-ink); margin-bottom: 6px; }
.jfe__empty-sub { margin: 0; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); line-height: 1.5; }
.jfe__empty-sub em { font-style: italic; color: var(--color-ink); }

.jfe__facets { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.jfe__facet {
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  overflow: hidden;
  transition: border-color 120ms ease;
}
.jfe__facet.is-expanded { border-color: var(--color-ink); }

.jfe__facet-head {
  display: grid;
  grid-template-columns: 28px 1fr auto auto auto auto;
  gap: 10px;
  align-items: center;
  padding: 12px 14px;
  cursor: pointer;
}
.jfe__facet-handles { display: flex; flex-direction: column; gap: 2px; }
.jfe__facet-title {
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 600;
  color: var(--color-ink);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.jfe__pill {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 10px;
  background: var(--color-surface);
  color: var(--color-ink);
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.jfe__pill--soft { background: var(--color-accent-soft, #DBEAFE); color: var(--color-accent-strong, #1E40AF); }

.jfe__chev { color: var(--color-fog); transition: transform 120ms ease; }
.jfe__chev.is-up { transform: rotate(180deg); }

.jfe__facet-body {
  padding: 4px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-top: 1px solid var(--color-hairline);
}
.jfe__row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.jfe__field { display: flex; flex-direction: column; gap: 6px; }
.jfe__label {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.jfe__input, .jfe__select {
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--color-hairline);
  background: #fff;
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--color-ink);
  box-sizing: border-box;
}
.jfe__input:focus, .jfe__select:focus { outline: none; border-color: var(--color-ink); }
.jfe__input--mono { font-family: var(--font-mono); font-size: 13px; }

.jfe__options { display: flex; flex-direction: column; gap: 8px; }
.jfe__opt-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.jfe__opt {
  display: grid;
  grid-template-columns: 140px 1fr 28px;
  gap: 8px;
  align-items: center;
}
.jfe__opt-value { background: var(--color-surface); }
.jfe__opt-delete {
  width: 28px;
  height: 28px;
  border: 0;
  background: transparent;
  color: var(--color-fog);
  border-radius: 6px;
  cursor: pointer;
}
.jfe__opt-delete:hover { color: #b91c1c; background: #fef2f2; }

.jfe__add-opt {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--color-hairline);
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink);
  cursor: pointer;
}
.jfe__add-opt:hover { border-color: var(--color-ink); }

.jfe__facet-foot {
  display: flex;
  align-items: center;
  gap: 24px;
}
.jfe__switch-row { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); cursor: pointer; }
.jfe__delete-field {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 0;
  padding: 0;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  color: #b91c1c;
  cursor: pointer;
}
.jfe__delete-field:hover { text-decoration: underline; }

.jfe__footnote {
  margin: 8px 0 0;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
}
.jfe__footnote a {
  color: var(--color-ink);
  font-weight: 600;
  text-decoration: none;
  border-bottom: 1px solid var(--color-hairline);
}
.jfe__footnote a:hover { border-bottom-color: var(--color-ink); }

.jfe__read-only {
  padding: 32px 24px;
  text-align: center;
  background: var(--color-surface);
  border: 1px solid var(--color-hairline);
  border-radius: 14px;
}
.jfe__read-only-icon {
  display: inline-flex;
  width: 48px;
  height: 48px;
  align-items: center;
  justify-content: center;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  color: var(--color-fog);
  margin-bottom: 12px;
}
.jfe__read-only-title { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-ink); margin-bottom: 6px; }
.jfe__read-only-sub { margin: 0; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); line-height: 1.55; }

/* Footer bits */
.jfe__foot-hint {
  margin-right: auto;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
}
.jfe__foot-hint--error { color: #b91c1c; }

.jfe__confirm { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); line-height: 1.55; margin: 0; }

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
  transition: background 0.12s ease, color 0.12s ease;
}
.pill-btn--ghost { background: transparent; color: var(--color-ink); }
.pill-btn--ghost:hover:not(:disabled) { background: var(--color-hairline); }
.pill-btn--ghost:disabled { color: var(--color-mute); cursor: not-allowed; }
.pill-btn--ink { background: var(--color-ink); color: #fff; padding: 0 22px; }
.pill-btn--ink:hover:not(:disabled) { background: var(--color-graphite); }
.pill-btn--ink:disabled { background: var(--color-mute); color: #fff; cursor: not-allowed; }
.pill-btn--danger { background: #b91c1c; color: #fff; padding: 0 22px; }
.pill-btn--danger:hover:not(:disabled) { background: #991b1b; }
</style>
