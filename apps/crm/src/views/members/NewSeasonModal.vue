<script setup lang="ts">
/**
 * NewSeasonModal — "Create a new season" dialog, extracted from
 * MembersView.vue (brief 48). The parent still owns refresh behaviour
 * — this component just emits `created` with the new season payload
 * so the roster view can reload seasons, flip the picker to the new
 * one, and refresh its summary.
 *
 * All form state + validation + field-level error mapping lives in
 * here. On success the modal closes itself; on error it stays open so
 * the admin can tweak + resubmit.
 */
import { computed, reactive, ref, watch } from 'vue'
import { seasons as seasonsApi, ApiError, type Season } from '@torny/api-client'
import CrmModal from '@/components/modals/CrmModal.vue'
import { useToast } from '@/composables/useToast'

const props = defineProps<{
  open: boolean
  clubId: number | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'created', season: Season): void
}>()

const toast = useToast()

const submitting = ref(false)
const generalError = ref<string | null>(null)
const fieldErrors = ref<Partial<Record<'season_name' | 'start_date' | 'end_date' | 'default_fee', string>>>({})
const form = reactive({
  season_name: '',
  start_date: '',
  end_date: '',
  // <input type="number"> + v-model gives us a number once the user types
  // anything, '' when the field is empty. Both are normalised in submit.
  default_fee: '' as string | number,
  description: '',
  set_current: true,
})

function reset() {
  form.season_name = ''
  form.start_date = ''
  form.end_date = ''
  form.default_fee = ''
  form.description = ''
  form.set_current = true
  generalError.value = null
  fieldErrors.value = {}
}

// Fresh form each time the modal is opened — admins expect this to not
// retain a half-filled previous attempt.
watch(() => props.open, (open) => { if (open) reset() })

function close() {
  if (submitting.value) return
  emit('close')
}

const canSubmit = computed(
  () =>
    form.season_name.trim().length > 0 &&
    form.start_date.length > 0 &&
    form.end_date.length > 0 &&
    form.end_date >= form.start_date,
)

async function submit() {
  const cid = props.clubId
  if (cid == null || !canSubmit.value) return
  submitting.value = true
  generalError.value = null
  fieldErrors.value = {}
  try {
    const feeRaw = form.default_fee
    const feeStr = typeof feeRaw === 'number' ? String(feeRaw) : feeRaw.trim()
    const feeNum = feeStr.length > 0 ? Number(feeStr) : undefined
    const created = await seasonsApi.create(cid, {
      season_name: form.season_name.trim(),
      start_date: form.start_date,
      end_date: form.end_date,
      default_fee: feeNum != null && !Number.isNaN(feeNum) ? feeNum : undefined,
      description: form.description.trim() || undefined,
      set_current: form.set_current,
    })
    toast.success(`"${created.season_name}" created.`)
    emit('created', created)
    emit('close')
  } catch (err) {
    if (err instanceof ApiError) {
      const code = err.code ?? ''
      const fieldMap: Record<string, keyof typeof fieldErrors.value> = {
        invalid_name: 'season_name',
        invalid_start_date: 'start_date',
        invalid_end_date: 'end_date',
        invalid_date_range: 'end_date',
        invalid_fee: 'default_fee',
      }
      const key = fieldMap[code]
      if (key) fieldErrors.value[key] = err.message
      else if (code === 'season_exists') generalError.value = 'A season with that name already exists.'
      else generalError.value = err.message
    } else {
      generalError.value = err instanceof Error ? err.message : 'Failed to create season.'
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <CrmModal
    :open="open"
    eyebrow="Seasons"
    title="New season"
    width="md"
    @close="close"
  >
    <form class="form" @submit.prevent="submit">
      <label class="field">
        <span class="field__label">Season name</span>
        <input
          v-model="form.season_name"
          type="text"
          maxlength="100"
          placeholder="2026/27 Summer"
          autofocus
        />
        <span v-if="fieldErrors.season_name" class="field__error">{{ fieldErrors.season_name }}</span>
      </label>
      <div class="form__row">
        <label class="field">
          <span class="field__label">Start date</span>
          <input v-model="form.start_date" type="date" />
          <span v-if="fieldErrors.start_date" class="field__error">{{ fieldErrors.start_date }}</span>
        </label>
        <label class="field">
          <span class="field__label">End date</span>
          <input v-model="form.end_date" type="date" />
          <span v-if="fieldErrors.end_date" class="field__error">{{ fieldErrors.end_date }}</span>
        </label>
      </div>
      <label class="field">
        <span class="field__label">Default fee</span>
        <input
          v-model="form.default_fee"
          type="number"
          min="0"
          step="1"
          placeholder="240"
        />
        <span v-if="fieldErrors.default_fee" class="field__error">{{ fieldErrors.default_fee }}</span>
      </label>
      <label class="field">
        <span class="field__label">Description</span>
        <textarea
          v-model="form.description"
          rows="3"
          placeholder="Optional context for committee members."
        />
      </label>
      <div class="switch-row">
        <div>
          <div class="switch-row__label">Set as current season</div>
          <div class="switch-row__hint">New payments + finance totals attach to this season.</div>
        </div>
        <button
          type="button"
          class="switch"
          :class="{ 'is-on': form.set_current }"
          @click="form.set_current = !form.set_current"
        ><span class="switch__knob" /></button>
      </div>
      <div v-if="generalError" class="form__error" role="alert">{{ generalError }}</div>
    </form>
    <template #footer>
      <button type="button" class="btn btn--outline" :disabled="submitting" @click="close">Cancel</button>
      <button
        type="button"
        class="btn btn--primary"
        :disabled="!canSubmit || submitting"
        @click="submit"
      >{{ submitting ? 'Creating…' : 'Create season' }}</button>
    </template>
  </CrmModal>
</template>

<style scoped>
.form { display: flex; flex-direction: column; gap: 16px; }
.form__row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field__label { font-family: var(--font-body); font-size: 12px; font-weight: 600; color: var(--color-ink); }
.field__error { font-family: var(--font-body); font-size: 11px; color: var(--color-danger); }
.field input, .field textarea {
  padding: 9px 11px;
  border: 1px solid var(--color-hairline);
  border-radius: 8px;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-ink);
  background: #fff;
}
.field textarea { resize: vertical; min-height: 72px; line-height: 1.5; }
.field input:focus, .field textarea:focus { outline: none; border-color: var(--color-ink); }

.switch-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px; background: var(--color-surface); border-radius: 10px; }
.switch-row__label { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.switch-row__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 2px; line-height: 1.4; }
.switch {
  width: 40px; height: 22px; border-radius: 999px; border: 0;
  background: var(--color-mute); cursor: pointer; padding: 2px;
  display: inline-flex; align-items: center;
  transition: background 0.15s ease;
}
.switch.is-on { background: var(--color-ink); }
.switch__knob { width: 18px; height: 18px; border-radius: 999px; background: #fff; transform: translateX(0); transition: transform 0.15s ease; }
.switch.is-on .switch__knob { transform: translateX(18px); }

.form__error {
  padding: 10px 12px;
  background: #FEE2E2; border: 1px solid #FCA5A5;
  border-radius: 10px;
  color: #991B1B; font-family: var(--font-body); font-size: 13px;
}

.btn { display: inline-flex; align-items: center; height: 36px; padding: 0 16px; border-radius: 999px; border: 1px solid transparent; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.12s ease; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn--primary { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.btn--primary:hover:not(:disabled) { background: var(--color-graphite); }
.btn--outline { background: #fff; color: var(--color-ink); border-color: var(--color-hairline); }
.btn--outline:hover:not(:disabled) { background: var(--color-surface); }
</style>
