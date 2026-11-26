<script setup lang="ts">
/**
 * Comp plan modal — brief 123 §6.2. Plan picker + optional until-date +
 * required reason. Used for strategic deals like the Bowls Wellington
 * free-build.
 */
import { ref, watch } from 'vue'
import { admin, ApiError, type AdminPlanOverrideResult } from '@torny/api-client'
import CrmModal from '@/components/modals/CrmModal.vue'

const props = defineProps<{
  open: boolean
  accountId: number
  accountName: string
  currentPlan: 'starter' | 'pro' | 'comped'
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'done', result: AdminPlanOverrideResult): void
}>()

const plan = ref<'starter' | 'pro'>('pro')
const until = ref<string>('')         // yyyy-mm-dd — optional
const indefinite = ref<boolean>(false)
const reason = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)

watch(() => props.open, (open) => {
  if (!open) return
  plan.value = 'pro'
  until.value = ''
  indefinite.value = false
  reason.value = ''
  error.value = null
})

async function submit() {
  const trimmedReason = reason.value.trim()
  if (!trimmedReason) {
    error.value = 'A reason is required — it goes into the audit log.'
    return
  }
  let untilIso: string | null = null
  if (!indefinite.value) {
    if (!until.value) {
      error.value = 'Pick an end date, or tick "Indefinite".'
      return
    }
    // Interpret as end-of-day UTC so the admin's picked date includes
    // the whole day.
    const d = new Date(`${until.value}T23:59:59.000Z`)
    if (!(d.getTime() > Date.now())) {
      error.value = 'End date must be in the future.'
      return
    }
    untilIso = d.toISOString()
  }
  submitting.value = true
  error.value = null
  try {
    const result = await admin.planOverride(props.accountId, {
      plan: plan.value,
      until: untilIso,
      reason: trimmedReason,
    })
    emit('done', result)
    emit('close')
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not comp plan.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <CrmModal :open="open" eyebrow="PLATFORM · BILLING" :title="`Comp plan — ${accountName}`" width="sm" @close="emit('close')">
    <div class="comp">
      <p class="comp__intro">
        Overrides Stripe-derived plan resolution. The account will show as <strong>Comped</strong> until the end date or until you revert it manually.
      </p>
      <div v-if="currentPlan === 'comped'" class="comp__hint">
        This account already has a comp active — submitting replaces it.
      </div>

      <label class="comp__field">
        <span class="comp__label">Plan</span>
        <div class="comp__plan-picker">
          <button
            type="button"
            class="comp__plan-chip"
            :class="{ 'comp__plan-chip--active': plan === 'starter' }"
            :disabled="submitting"
            @click="plan = 'starter'"
          >Starter</button>
          <button
            type="button"
            class="comp__plan-chip"
            :class="{ 'comp__plan-chip--active': plan === 'pro' }"
            :disabled="submitting"
            @click="plan = 'pro'"
          >Pro</button>
        </div>
      </label>

      <label class="comp__field">
        <span class="comp__label">End date</span>
        <div class="comp__date-row">
          <input
            v-model="until"
            type="date"
            class="comp__input comp__input--date"
            :disabled="submitting || indefinite"
          />
          <label class="comp__indefinite">
            <input v-model="indefinite" type="checkbox" :disabled="submitting" />
            <span>Indefinite</span>
          </label>
        </div>
        <span class="comp__hint">
          When this date passes, the comp expires and plan reverts to Stripe truth. (Nightly revert job lands in Phase 3 — until then, expired overrides persist until a human acts.)
        </span>
      </label>

      <label class="comp__field">
        <span class="comp__label">Reason</span>
        <textarea
          v-model="reason"
          class="comp__input"
          rows="2"
          maxlength="500"
          placeholder="e.g. BW-free-build-deal"
          :disabled="submitting"
        />
        <span class="comp__hint">Required. Visible on the account timeline and the audit log.</span>
      </label>

      <div v-if="error" class="comp__error">{{ error }}</div>
    </div>
    <template #footer>
      <button type="button" class="comp__btn" :disabled="submitting" @click="emit('close')">Cancel</button>
      <button type="button" class="comp__btn comp__btn--primary" :disabled="submitting || !reason.trim()" @click="submit">
        {{ submitting ? 'Applying…' : 'Apply comp' }}
      </button>
    </template>
  </CrmModal>
</template>

<style scoped>
.comp { display: flex; flex-direction: column; gap: 16px; }
.comp__intro { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; line-height: 1.5; }
.comp__intro strong { color: var(--color-feature-violet); }
.comp__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }

.comp__field { display: flex; flex-direction: column; gap: 6px; }
.comp__label { font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-fog); }

.comp__plan-picker { display: inline-flex; gap: 2px; padding: 2px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; align-self: flex-start; }
.comp__plan-chip { padding: 8px 18px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; background: transparent; color: var(--color-fog); border: 0; border-radius: 999px; cursor: pointer; }
.comp__plan-chip--active { background: var(--color-ink); color: #fff; }
.comp__plan-chip:disabled { opacity: 0.5; cursor: not-allowed; }

.comp__input {
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--color-ink);
  background: var(--color-ground);
  border: 1px solid var(--color-hairline);
  border-radius: 10px;
  padding: 10px 14px;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}
.comp__input:focus { border-color: var(--color-ink); }
.comp__input--date { max-width: 200px; }

.comp__date-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.comp__indefinite { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); cursor: pointer; }

.comp__error { font-family: var(--font-body); font-size: 13px; color: var(--color-danger); background: color-mix(in oklab, var(--color-danger) 8%, #fff); padding: 10px 12px; border-radius: 8px; }

.comp__btn { padding: 10px 20px; font-family: var(--font-body); font-size: 13px; font-weight: 600; background: var(--color-surface); color: var(--color-ink); border: 1px solid var(--color-hairline); border-radius: 999px; cursor: pointer; }
.comp__btn:disabled { opacity: 0.5; cursor: not-allowed; }
.comp__btn--primary { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
</style>
