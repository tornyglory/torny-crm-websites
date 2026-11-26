<script setup lang="ts">
/**
 * Suspend / unsuspend confirmation modal — brief 123 §6.3 + §6.4.
 *
 * Toggles between suspend and unsuspend flows based on the `mode` prop
 * so the same container handles both state transitions.
 */
import { ref, watch, computed } from 'vue'
import { admin, ApiError } from '@torny/api-client'
import CrmModal from '@/components/modals/CrmModal.vue'

const props = defineProps<{
  open: boolean
  accountId: number
  accountName: string
  mode: 'suspend' | 'unsuspend'
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'done'): void
}>()

const reason = ref('')
const notifyOwner = ref(false)
const submitting = ref(false)
const error = ref<string | null>(null)

watch(() => props.open, (open) => {
  if (!open) return
  reason.value = ''
  notifyOwner.value = false
  error.value = null
})

const title = computed(() =>
  props.mode === 'suspend'
    ? `Suspend ${props.accountName}`
    : `Unsuspend ${props.accountName}`,
)

async function submit() {
  const trimmed = reason.value.trim()
  if (!trimmed) {
    error.value = 'A reason is required — it goes into the audit log.'
    return
  }
  submitting.value = true
  error.value = null
  try {
    if (props.mode === 'suspend') {
      await admin.suspend(props.accountId, { reason: trimmed, notify_owner: notifyOwner.value })
    } else {
      await admin.unsuspend(props.accountId, { reason: trimmed })
    }
    emit('done')
    emit('close')
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Action failed.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <CrmModal :open="open" eyebrow="PLATFORM · ACCESS" :title="title" width="sm" @close="emit('close')">
    <div class="susp">
      <p v-if="mode === 'suspend'" class="susp__intro">
        Suspending blocks every mutating CRM action for this account. The owner can still sign in and read Settings, but every save will be rejected. Public site keeps rendering. Reversible.
      </p>
      <p v-else class="susp__intro">
        Reinstates CRM writes for this account. The owner will be able to make changes again immediately.
      </p>

      <label class="susp__field">
        <span class="susp__label">Reason</span>
        <textarea
          v-model="reason"
          class="susp__input"
          rows="2"
          maxlength="500"
          :placeholder="mode === 'suspend' ? 'e.g. payment-dispute-2026-11-25' : 'e.g. resolved-2026-11-27'"
          :disabled="submitting"
        />
        <span class="susp__hint">Required. Visible on the account timeline and the audit log.</span>
      </label>

      <label v-if="mode === 'suspend'" class="susp__notify">
        <input v-model="notifyOwner" type="checkbox" :disabled="submitting" />
        <span>Email the owner about the suspension</span>
      </label>

      <div v-if="error" class="susp__error">{{ error }}</div>
    </div>
    <template #footer>
      <button type="button" class="susp__btn" :disabled="submitting" @click="emit('close')">Cancel</button>
      <button
        type="button"
        class="susp__btn"
        :class="mode === 'suspend' ? 'susp__btn--danger' : 'susp__btn--primary'"
        :disabled="submitting || !reason.trim()"
        @click="submit"
      >
        {{ submitting ? 'Working…' : (mode === 'suspend' ? 'Suspend account' : 'Unsuspend account') }}
      </button>
    </template>
  </CrmModal>
</template>

<style scoped>
.susp { display: flex; flex-direction: column; gap: 16px; }
.susp__intro { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; line-height: 1.5; }

.susp__field { display: flex; flex-direction: column; gap: 6px; }
.susp__label { font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-fog); }
.susp__input {
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--color-ink);
  background: var(--color-ground);
  border: 1px solid var(--color-hairline);
  border-radius: 10px;
  padding: 10px 14px;
  outline: none;
  resize: vertical;
}
.susp__input:focus { border-color: var(--color-ink); }
.susp__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }

.susp__notify { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); cursor: pointer; }

.susp__error { font-family: var(--font-body); font-size: 13px; color: var(--color-danger); background: color-mix(in oklab, var(--color-danger) 8%, #fff); padding: 10px 12px; border-radius: 8px; }

.susp__btn { padding: 10px 20px; font-family: var(--font-body); font-size: 13px; font-weight: 600; background: var(--color-surface); color: var(--color-ink); border: 1px solid var(--color-hairline); border-radius: 999px; cursor: pointer; }
.susp__btn:disabled { opacity: 0.5; cursor: not-allowed; }
.susp__btn--primary { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.susp__btn--danger { background: var(--color-danger); color: #fff; border-color: var(--color-danger); }
</style>
