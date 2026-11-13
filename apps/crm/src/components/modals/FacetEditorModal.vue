<script setup lang="ts">
/**
 * FacetEditorModal — create / edit a custom facet on the public join
 * form. Backed by `customFacetsApi` (brief 105 §2.2).
 *
 * The caller passes `facet: null` to open in create mode or `facet: CustomFacet`
 * to edit. Emits `saved` with the new/updated row so the parent list
 * can update in place without a second roundtrip.
 */
import { computed, nextTick, reactive, ref, watch } from 'vue'
import {
  customFacets as customFacetsApi,
  ApiError,
  type CustomFacet,
  type CreateFacetInput,
  type UpdateFacetInput,
  type FacetInputType,
  type FacetOption,
  type FacetErrorCode,
  type JoinFormSection,
} from '@torny/api-client'
import CrmModal from '@/components/modals/CrmModal.vue'
import CrmSpinner from '@/components/CrmSpinner.vue'
import TornySelect from '@/components/TornySelect.vue'
import { useToast } from '@/composables/useToast'

const props = defineProps<{
  open: boolean
  clubId: number | null
  /** null = create mode, CustomFacet = edit mode. */
  facet: CustomFacet | null
  /** Variant join-form sections driving the placement dropdown. */
  sections: JoinFormSection[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved', row: CustomFacet): void
}>()

const toast = useToast()

interface DraftOption extends FacetOption {
  /** Local-only id so the v-for key stays stable while editing. */
  _k: number
}

interface Draft {
  label: string
  slug: string
  helper_text: string
  input_type: FacetInputType
  options: DraftOption[]
  required: boolean
  searchable: boolean
  section_key: string
}

const INPUT_TYPES: { value: FacetInputType; label: string; hint: string; hasOptions: boolean }[] = [
  { value: 'select',       label: 'Dropdown (single)',    hint: 'Pick one from a list.',                 hasOptions: true  },
  { value: 'multi_select', label: 'Dropdown (multiple)',  hint: 'Pick one or more from a list.',         hasOptions: true  },
  { value: 'radio',        label: 'Radio buttons',        hint: 'Pick one — options visible as buttons.', hasOptions: true  },
  { value: 'checkboxes',   label: 'Checkbox group',       hint: 'Tick any that apply.',                  hasOptions: true  },
  { value: 'text',         label: 'Short text',           hint: 'Single-line text input.',               hasOptions: false },
  { value: 'long_text',    label: 'Long text',            hint: 'Multi-line textarea.',                  hasOptions: false },
  { value: 'number',       label: 'Number',               hint: 'Whole or decimal number.',              hasOptions: false },
  { value: 'date',         label: 'Date',                 hint: 'Calendar picker (YYYY-MM-DD).',         hasOptions: false },
  { value: 'boolean',      label: 'Yes / No toggle',      hint: 'Single checkbox or switch.',            hasOptions: false },
]

const inputTypeOptions = INPUT_TYPES.map((t) => ({ value: t.value, label: t.label }))
const sectionOptions = computed(() =>
  props.sections.map((s) => ({ value: s.key, label: s.label })),
)

function blankDraft(): Draft {
  return {
    label: '',
    slug: '',
    helper_text: '',
    input_type: 'select',
    options: [{ value: '', label: '', _k: 1 }, { value: '', label: '', _k: 2 }],
    required: false,
    searchable: true,
    section_key: 'additional',
  }
}

const draft = reactive<Draft>(blankDraft())
const saving = ref(false)
const slugDirty = ref(false)
const error = ref<string | null>(null)
const labelEl = ref<HTMLInputElement | null>(null)

const isEdit = computed(() => props.facet != null)
const currentTypeMeta = computed(
  () => INPUT_TYPES.find((t) => t.value === draft.input_type) ?? INPUT_TYPES[0]!,
)

// ── Lifecycle: hydrate draft from props when the modal opens ──

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    error.value = null
    saving.value = false
    slugDirty.value = false
    const f = props.facet
    if (f) {
      Object.assign(draft, {
        label: f.label,
        slug: f.slug,
        helper_text: f.helper_text ?? '',
        input_type: f.input_type,
        options: (f.options ?? []).map((o, i) => ({ ...o, _k: i + 1 })),
        required: f.required,
        searchable: f.searchable,
        section_key: f.section_key,
      })
      // Existing facets have a server-assigned slug — treat it as locked
      // against label-derived updates so we don't rename a live column.
      slugDirty.value = true
    } else {
      Object.assign(draft, blankDraft())
    }
    void nextTick(() => labelEl.value?.focus())
  },
)

// ── Slug derivation ────────────────────────────────────────────

/** Mirrors the backend's expected slug shape: lowercase, snake_case,
 *  underscores only, trimmed to 64 chars. The server will normalise
 *  server-side too, but deriving locally means the preview chip
 *  shows what the admin is about to commit. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
}

watch(
  () => draft.label,
  (label) => {
    if (slugDirty.value) return
    draft.slug = slugify(label)
  },
)

function onSlugInput(next: string) {
  slugDirty.value = true
  draft.slug = next
}

// ── Options editor ─────────────────────────────────────────────

let optionKeyCounter = 100
function addOption() {
  draft.options.push({ value: '', label: '', _k: ++optionKeyCounter })
}
function removeOption(i: number) {
  if (draft.options.length <= 1) return
  draft.options.splice(i, 1)
}
function moveOption(i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= draft.options.length) return
  const next = [...draft.options]
  const [row] = next.splice(i, 1)
  if (row) next.splice(j, 0, row)
  draft.options = next
}
/** Keep value in step with label when the admin hasn't edited it. */
function onOptionLabel(i: number, label: string) {
  const opt = draft.options[i]
  if (!opt) return
  const prev = opt.label
  opt.label = label
  if (!opt.value || opt.value === slugify(prev)) {
    opt.value = slugify(label)
  }
}

// ── Validation + save ──────────────────────────────────────────

const canSave = computed<boolean>(() => {
  if (saving.value) return false
  if (!draft.label.trim()) return false
  if (currentTypeMeta.value.hasOptions) {
    const nonBlank = draft.options.filter((o) => o.value.trim() && o.label.trim())
    if (nonBlank.length < 2) return false
    const uniq = new Set(nonBlank.map((o) => o.value.trim()))
    if (uniq.size !== nonBlank.length) return false
  }
  return true
})

function buildPayload(): CreateFacetInput | UpdateFacetInput {
  const base = {
    label: draft.label.trim(),
    slug: draft.slug.trim() || undefined,
    helper_text: draft.helper_text.trim() || null,
    input_type: draft.input_type,
    required: draft.required,
    searchable: draft.searchable,
    section_key: draft.section_key,
  }
  if (currentTypeMeta.value.hasOptions) {
    return {
      ...base,
      options: draft.options
        .filter((o) => o.value.trim() && o.label.trim())
        .map((o) => ({ value: o.value.trim(), label: o.label.trim() })),
    }
  }
  return { ...base, options: [] }
}

/** Map typed error codes to admin-friendly copy. Falls back to the
 *  server's own message for anything unmapped. */
function messageFor(code: FacetErrorCode | undefined, fallback: string): string {
  switch (code) {
    case 'label_required':      return 'Add a label before saving.'
    case 'label_too_long':      return 'Label is too long — keep it under 120 characters.'
    case 'bad_input_type':      return 'That input type isn’t supported.'
    case 'bad_slug':            return 'Slug can only contain lowercase letters, digits, and underscores.'
    case 'options_required':    return 'Add at least two options.'
    case 'options_not_allowed': return 'This input type doesn’t use options — remove them.'
    case 'bad_option':          return 'One of the options is missing a value or label.'
    case 'too_many_options':    return 'Too many options — keep it under 50.'
    case 'duplicate_option':    return 'Option values must be unique.'
    case 'slug_taken':          return 'That slug is already used — pick a different label.'
    case 'forbidden':           return 'Only the club owner can edit custom fields.'
    case 'not_found':           return 'This field no longer exists — refresh and try again.'
    default:                    return fallback
  }
}

async function save() {
  if (!canSave.value || props.clubId == null) return
  saving.value = true
  error.value = null
  const payload = buildPayload()
  try {
    const row = isEdit.value
      ? await customFacetsApi.updateFacet(props.clubId, props.facet!.facet_id, payload)
      : await customFacetsApi.createFacet(props.clubId, payload as CreateFacetInput)
    toast.success(isEdit.value ? 'Custom field updated.' : 'Custom field added.')
    emit('saved', row)
    emit('close')
  } catch (err) {
    const code = err instanceof ApiError ? (err.code as FacetErrorCode | undefined) : undefined
    const fallback = err instanceof Error ? err.message : 'Could not save the field.'
    error.value = messageFor(code, fallback)
  } finally {
    saving.value = false
  }
}

function onCmdEnter(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSave.value) {
    e.preventDefault()
    void save()
  }
}
</script>

<template>
  <CrmModal
    :open="open"
    :eyebrow="isEdit ? 'Custom field · edit' : 'Custom field · new'"
    :title="isEdit ? 'Edit custom field' : 'Add a custom field'"
    width="lg"
    @close="emit('close')"
  >
    <div class="facet-form" @keydown="onCmdEnter">
      <section class="facet-form__row">
        <label class="facet-form__field">
          <span class="facet-form__label">Label</span>
          <input
            ref="labelEl"
            v-model="draft.label"
            type="text"
            class="facet-form__input"
            placeholder="e.g. Preferred playing days"
            maxlength="120"
          />
        </label>
        <label class="facet-form__field facet-form__field--slug">
          <span class="facet-form__label">
            Slug
            <span class="facet-form__hint">how it's stored + queried</span>
          </span>
          <input
            :value="draft.slug"
            type="text"
            class="facet-form__input facet-form__input--mono"
            placeholder="preferred_playing_days"
            maxlength="64"
            @input="(e) => onSlugInput((e.target as HTMLInputElement).value)"
          />
        </label>
      </section>

      <section class="facet-form__row">
        <label class="facet-form__field">
          <span class="facet-form__label">Input type</span>
          <TornySelect v-model="draft.input_type" :options="inputTypeOptions" />
          <span class="facet-form__field-hint">{{ currentTypeMeta.hint }}</span>
        </label>
        <label class="facet-form__field">
          <span class="facet-form__label">Section placement</span>
          <TornySelect v-model="draft.section_key" :options="sectionOptions" />
          <span class="facet-form__field-hint">Where this appears on the public join form.</span>
        </label>
      </section>

      <label class="facet-form__field">
        <span class="facet-form__label">
          Helper text
          <span class="facet-form__hint">optional</span>
        </span>
        <input
          v-model="draft.helper_text"
          type="text"
          class="facet-form__input"
          placeholder="Shown under the field on the public form"
          maxlength="200"
        />
      </label>

      <section v-if="currentTypeMeta.hasOptions" class="facet-form__options">
        <div class="facet-form__options-head">
          <div>
            <span class="facet-form__label">Options</span>
            <span class="facet-form__field-hint">At least two. Value is stored; label is what the applicant sees.</span>
          </div>
          <button type="button" class="facet-form__add-option" @click="addOption">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
            Add option
          </button>
        </div>

        <ul class="facet-form__option-list">
          <li
            v-for="(opt, i) in draft.options"
            :key="opt._k"
            class="facet-form__option"
          >
            <div class="facet-form__option-handles">
              <button
                type="button"
                class="facet-form__option-handle"
                :disabled="i === 0"
                aria-label="Move up"
                @click="moveOption(i, -1)"
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 10l4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
              <button
                type="button"
                class="facet-form__option-handle"
                :disabled="i === draft.options.length - 1"
                aria-label="Move down"
                @click="moveOption(i, 1)"
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
            </div>
            <input
              :value="opt.label"
              type="text"
              class="facet-form__input facet-form__option-label"
              placeholder="Label"
              @input="(e) => onOptionLabel(i, (e.target as HTMLInputElement).value)"
            />
            <input
              v-model="opt.value"
              type="text"
              class="facet-form__input facet-form__input--mono facet-form__option-value"
              placeholder="value"
            />
            <button
              type="button"
              class="facet-form__option-delete"
              :disabled="draft.options.length <= 1"
              aria-label="Remove option"
              @click="removeOption(i)"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M5 4l1 9a1 1 0 001 1h2a1 1 0 001-1l1-9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
          </li>
        </ul>
      </section>

      <section class="facet-form__switches">
        <label class="facet-form__switch">
          <div>
            <div class="facet-form__switch-label">Required</div>
            <div class="facet-form__switch-hint">Applicant must answer before submitting.</div>
          </div>
          <button
            type="button"
            class="switch"
            :class="{ 'is-on': draft.required }"
            @click="draft.required = !draft.required"
          ><span class="switch__knob" /></button>
        </label>

        <label class="facet-form__switch">
          <div>
            <div class="facet-form__switch-label">Searchable</div>
            <div class="facet-form__switch-hint">Admins can filter the Members list by this answer.</div>
          </div>
          <button
            type="button"
            class="switch"
            :class="{ 'is-on': draft.searchable }"
            @click="draft.searchable = !draft.searchable"
          ><span class="switch__knob" /></button>
        </label>
      </section>

      <div v-if="error" class="facet-form__error">{{ error }}</div>
    </div>

    <template #footer>
      <div class="facet-form__foot-hint">
        <kbd>⌘</kbd><kbd>↵</kbd> to save
      </div>
      <button
        type="button"
        class="pill-btn pill-btn--ghost"
        :disabled="saving"
        @click="emit('close')"
      >Cancel</button>
      <button
        type="button"
        class="pill-btn pill-btn--ink"
        :disabled="!canSave"
        @click="save"
      >
        <CrmSpinner v-if="saving" size="sm" label="Saving" />
        <span>{{ saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add field' }}</span>
      </button>
    </template>
  </CrmModal>
</template>

<style scoped>
.facet-form { display: flex; flex-direction: column; gap: 18px; }
.facet-form__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.facet-form__field { display: flex; flex-direction: column; gap: 6px; }
.facet-form__field--slug { min-width: 0; }
.facet-form__label {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-fog);
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
}
.facet-form__hint {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  color: var(--color-mute);
}
.facet-form__field-hint {
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
}
.facet-form__input {
  width: 100%;
  padding: 11px 14px;
  border-radius: 10px;
  border: 1px solid var(--color-hairline);
  background: #fff;
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--color-ink);
  box-sizing: border-box;
}
.facet-form__input:focus { outline: none; border-color: var(--color-ink); }
.facet-form__input--mono {
  font-family: var(--font-mono);
  font-size: 13px;
}

.facet-form__options {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: var(--color-surface);
  border-radius: 12px;
}
.facet-form__options-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.facet-form__add-option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink);
  cursor: pointer;
  flex-shrink: 0;
}
.facet-form__add-option:hover { border-color: var(--color-ink); background: #fff; }

.facet-form__option-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.facet-form__option {
  display: grid;
  grid-template-columns: 28px 1fr 180px 28px;
  gap: 10px;
  align-items: center;
}
.facet-form__option-handles {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.facet-form__option-handle {
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
.facet-form__option-handle:hover:not(:disabled) { color: var(--color-ink); background: var(--color-hairline); }
.facet-form__option-handle:disabled { opacity: 0.3; cursor: not-allowed; }

.facet-form__option-delete {
  width: 28px;
  height: 28px;
  background: transparent;
  border: 0;
  padding: 0;
  border-radius: 6px;
  color: var(--color-fog);
  cursor: pointer;
}
.facet-form__option-delete:hover:not(:disabled) { color: #b91c1c; background: #fef2f2; }
.facet-form__option-delete:disabled { opacity: 0.3; cursor: not-allowed; }

.facet-form__switches {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
}
.facet-form__switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.facet-form__switch-label { font-family: var(--font-body); font-size: 14px; font-weight: 600; color: var(--color-ink); }
.facet-form__switch-hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; }

.switch {
  width: 40px; height: 22px;
  border-radius: 999px;
  background: var(--color-mute);
  border: 0;
  position: relative;
  cursor: pointer;
  transition: background 0.12s ease;
  flex-shrink: 0;
}
.switch.is-on { background: var(--color-ink); }
.switch__knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  background: #fff;
  border-radius: 999px;
  transition: transform 0.12s ease;
}
.switch.is-on .switch__knob { transform: translateX(18px); }

.facet-form__error {
  padding: 10px 12px;
  border-radius: 8px;
  background: #fef2f2;
  color: #b91c1c;
  font-family: var(--font-body);
  font-size: 13px;
}

.facet-form__foot-hint {
  margin-right: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
}
.facet-form__foot-hint kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border: 1px solid var(--color-hairline);
  border-radius: 4px;
  background: var(--color-surface);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-ink);
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
  transition: background 0.12s ease, color 0.12s ease;
}
.pill-btn--ghost { background: transparent; color: var(--color-ink); }
.pill-btn--ghost:hover:not(:disabled) { background: var(--color-hairline); }
.pill-btn--ghost:disabled { color: var(--color-mute); cursor: not-allowed; }
.pill-btn--ink { background: var(--color-ink); color: #fff; padding: 0 22px; }
.pill-btn--ink:hover:not(:disabled) { background: var(--color-graphite); }
.pill-btn--ink:disabled { background: var(--color-mute); color: #fff; cursor: not-allowed; }

@media (max-width: 640px) {
  .facet-form__row { grid-template-columns: 1fr; }
  .facet-form__option {
    grid-template-columns: 28px 1fr 28px;
    grid-template-rows: auto auto;
    row-gap: 6px;
  }
  .facet-form__option-value { grid-column: 2 / -1; }
}
</style>
