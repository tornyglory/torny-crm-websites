<script setup lang="ts">
/**
 * RecordPaymentModal — captures amount + method + reference + date + notes
 * for a manual payment entry. Replaces the old hardcoded `payment_method:
 * 'cash'` on Mark paid. Backend contract: brief 12 + brief 55.
 */
import { nextTick, reactive, ref, watch } from 'vue'
import {
  members as membersApi,
  ApiError,
  type RosterMember,
  type PaymentMethod,
  type MembershipSnapshot,
} from '@torny/api-client'
import CrmModal from '@/components/modals/CrmModal.vue'
import { useToast } from '@/composables/useToast'

const props = defineProps<{
  open: boolean
  clubId: number | null
  member: RosterMember | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'recorded', result: { amount: number; method: PaymentMethod; season_name: string | null; membership: MembershipSnapshot | null }): void
}>()

const toast = useToast()

interface MethodOption {
  value: PaymentMethod
  label: string
  hint: string
}
const METHODS: MethodOption[] = [
  { value: 'cash',          label: 'Cash',          hint: 'Over the counter · at the clubrooms' },
  { value: 'card',          label: 'Card',          hint: 'EFTPOS · credit · online portal' },
  { value: 'bank_transfer', label: 'Bank transfer', hint: 'Direct deposit · internet banking' },
  { value: 'cheque',        label: 'Cheque',        hint: 'Rare — most banks have stopped issuing' },
  { value: 'other',         label: 'Other',         hint: 'Barter · internal credit · correction' },
]

function todayIso(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const amountInputEl = ref<HTMLInputElement | null>(null)
const state = reactive({
  amount: '' as string,
  method: 'cash' as PaymentMethod,
  reference: '',
  date: todayIso(),
  notes: '',
})
const saving = ref(false)
const error = ref<string | null>(null)

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    const fee = props.member?.membership?.fee ?? 0
    state.amount = fee > 0 ? String(fee) : ''
    state.method = 'cash'
    state.reference = ''
    state.date = todayIso()
    state.notes = ''
    error.value = null
    saving.value = false
    void nextTick(() => amountInputEl.value?.focus())
  },
)

async function save() {
  if (saving.value) return
  const member = props.member
  const cid = props.clubId
  if (!member || cid == null) return
  const amount = Number(state.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    error.value = 'Enter an amount greater than $0.'
    return
  }
  saving.value = true
  error.value = null
  try {
    const result = await membersApi.recordPayment(cid, member.user_id, {
      amount,
      payment_method: state.method,
      payment_reference: state.reference.trim() || undefined,
      payment_date: state.date || undefined,
      notes: state.notes.trim() || undefined,
    })
    const methodLabel = METHODS.find((m) => m.value === state.method)?.label ?? state.method
    const seasonSuffix = result.season_name ? ` to ${result.season_name}` : ''
    toast.success(`$${amount} · ${methodLabel} recorded${seasonSuffix}.`)
    emit('recorded', {
      amount,
      method: state.method,
      season_name: result.season_name ?? null,
      membership: result.membership ?? null,
    })
    emit('close')
  } catch (err) {
    error.value = err instanceof ApiError
      ? err.message
      : err instanceof Error
        ? err.message
        : 'Could not record the payment.'
  } finally {
    saving.value = false
  }
}

function onCmdEnter(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    void save()
  }
}
</script>

<template>
  <CrmModal
    :open="open"
    :eyebrow="member ? `Payment · ${member.name}` : 'Payment'"
    title="Record payment"
    width="md"
    @close="emit('close')"
  >
    <section class="record-pay__section">
      <div class="record-pay__row">
        <label class="record-pay__field record-pay__field--amount">
          <span class="record-pay__label">Amount</span>
          <div class="record-pay__amount-wrap">
            <span class="record-pay__amount-prefix">$</span>
            <input
              ref="amountInputEl"
              v-model="state.amount"
              type="number"
              min="0"
              step="0.01"
              inputmode="decimal"
              class="record-pay__amount-input"
              :disabled="saving"
              @keydown="onCmdEnter"
            />
          </div>
        </label>
        <label class="record-pay__field">
          <span class="record-pay__label">Date</span>
          <input
            v-model="state.date"
            type="date"
            class="record-pay__input"
            :disabled="saving"
          />
        </label>
      </div>
    </section>

    <section class="record-pay__section">
      <div class="record-pay__label record-pay__label--block">Method</div>
      <div class="record-pay__methods">
        <button
          v-for="m in METHODS"
          :key="m.value"
          type="button"
          class="record-pay__method"
          :class="{ 'record-pay__method--active': state.method === m.value }"
          :disabled="saving"
          @click="state.method = m.value"
        >
          <span class="record-pay__method-label">{{ m.label }}</span>
          <span class="record-pay__method-hint">{{ m.hint }}</span>
        </button>
      </div>
    </section>

    <section class="record-pay__section">
      <label class="record-pay__field">
        <span class="record-pay__label">Reference <span class="record-pay__optional">optional</span></span>
        <input
          v-model="state.reference"
          type="text"
          class="record-pay__input"
          maxlength="100"
          placeholder="ANZ-12345 · Receipt #A234 · cheque no."
          :disabled="saving"
          @keydown="onCmdEnter"
        />
      </label>
    </section>

    <section class="record-pay__section">
      <label class="record-pay__field">
        <span class="record-pay__label">Notes <span class="record-pay__optional">optional</span></span>
        <textarea
          v-model="state.notes"
          class="record-pay__textarea"
          rows="2"
          maxlength="500"
          placeholder="e.g. Cleared October invoice · half paid, half owing"
          :disabled="saving"
          @keydown="onCmdEnter"
        />
      </label>
    </section>

    <div v-if="error" class="record-pay__error" role="alert">{{ error }}</div>

    <template #footer>
      <div class="record-pay__foot-hint">
        <kbd>⌘</kbd><kbd>↵</kbd> to save
      </div>
      <button
        type="button"
        class="pill-btn pill-btn--ghost"
        :disabled="saving"
        @click="emit('close')"
      >
        Cancel
      </button>
      <button
        type="button"
        class="pill-btn pill-btn--ink"
        :disabled="saving || !state.amount"
        @click="save"
      >
        {{ saving ? 'Recording…' : 'Record payment' }}
      </button>
    </template>
  </CrmModal>
</template>

<style scoped>
.record-pay__section + .record-pay__section { margin-top: 20px; }
.record-pay__row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.record-pay__field { display: flex; flex-direction: column; gap: 8px; }
.record-pay__label {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.record-pay__label--block { margin-bottom: 10px; }
.record-pay__optional { font-weight: 500; letter-spacing: 0.04em; color: var(--color-mute); text-transform: none; margin-left: 4px; }

.record-pay__amount-wrap {
  display: flex;
  align-items: center;
  height: 52px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid var(--color-hairline);
  background: #fff;
}
.record-pay__amount-wrap:focus-within { border-color: var(--color-ink); }
.record-pay__amount-prefix {
  font-family: var(--font-mono);
  font-size: 20px;
  font-weight: 600;
  color: var(--color-fog);
  margin-right: 6px;
}
.record-pay__amount-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  font-family: var(--font-mono);
  font-size: 22px;
  font-weight: 700;
  color: var(--color-ink);
  padding: 0;
}

.record-pay__input {
  height: 44px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid var(--color-hairline);
  background: #fff;
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--color-ink);
}
.record-pay__input:focus { outline: none; border-color: var(--color-ink); }

.record-pay__methods {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.record-pay__method {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid var(--color-hairline);
  background: #fff;
  color: var(--color-ink);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.12s ease, background 0.12s ease, color 0.12s ease;
}
.record-pay__method:hover {
  background: var(--color-surface);
  border-color: var(--color-ink);
  color: var(--color-ink);
}
.record-pay__method--active {
  background: var(--color-ink);
  color: #fff;
  border-color: var(--color-ink);
}
/* Hovering the already-selected tile flips it back to white + ink text so
 * admins see an affordance that reads "click to switch". Both label and
 * hint go ink. */
.record-pay__method--active:hover {
  background: #fff;
  color: var(--color-ink);
  border-color: var(--color-ink);
}
.record-pay__method-label {
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: inherit;
}
.record-pay__method-hint {
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--color-fog);
  transition: color 0.12s ease;
}
.record-pay__method:hover .record-pay__method-hint { color: var(--color-ink); }
.record-pay__method--active .record-pay__method-hint { color: rgba(255, 255, 255, 0.65); }
.record-pay__method--active:hover .record-pay__method-hint { color: var(--color-ink); }

.record-pay__textarea {
  width: 100%;
  min-height: 72px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--color-hairline);
  background: #fff;
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.5;
  color: var(--color-ink);
  resize: vertical;
}
.record-pay__textarea:focus { outline: none; border-color: var(--color-ink); }

.record-pay__error {
  margin-top: 16px;
  padding: 10px 14px;
  background: #FEE2E2;
  color: #991B1B;
  border-radius: 10px;
  font-family: var(--font-body);
  font-size: 13px;
}

.record-pay__foot-hint {
  margin-right: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
}
.record-pay__foot-hint kbd {
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
.pill-btn:focus-visible { outline: 2px solid var(--color-ink); outline-offset: 2px; }
.pill-btn--ghost { background: transparent; color: var(--color-ink); }
.pill-btn--ghost:hover:not(:disabled) { background: var(--color-hairline); }
.pill-btn--ghost:disabled { color: var(--color-mute); cursor: not-allowed; }
.pill-btn--ink { background: var(--color-ink); color: #fff; padding: 0 22px; }
.pill-btn--ink:hover:not(:disabled) { background: var(--color-graphite); }
.pill-btn--ink:disabled { background: var(--color-mute); color: #fff; cursor: not-allowed; }

@media (max-width: 540px) {
  .record-pay__row { grid-template-columns: 1fr; }
  .record-pay__methods { grid-template-columns: 1fr; }
}
</style>
