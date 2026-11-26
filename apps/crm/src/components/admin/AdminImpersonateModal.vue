<script setup lang="ts">
/**
 * Impersonation confirmation modal — brief 123 §6.1.
 *
 * Collects a reason (required, max 500 chars, audit-logged) and
 * requests an impersonation JWT. On success emits the result so the
 * parent (Account detail view) can hand off to the impersonation
 * session manager.
 */
import { ref, watch } from 'vue'
import { admin, ApiError, type AdminImpersonateResult } from '@torny/api-client'
import CrmModal from '@/components/modals/CrmModal.vue'

const props = defineProps<{
  open: boolean
  accountId: number
  accountName: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'done', result: AdminImpersonateResult): void
}>()

const reason = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)

watch(() => props.open, (open) => {
  if (!open) return
  reason.value = ''
  error.value = null
})

async function submit() {
  const trimmed = reason.value.trim()
  if (!trimmed) {
    error.value = 'A reason is required — it goes into the audit log.'
    return
  }
  submitting.value = true
  error.value = null
  try {
    const result = await admin.impersonate(props.accountId, { reason: trimmed })
    emit('done', result)
    emit('close')
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not start impersonation.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <CrmModal :open="open" eyebrow="PLATFORM · SUPPORT" :title="`Impersonate ${accountName}`" width="sm" @close="emit('close')">
    <div class="impersonate">
      <p class="impersonate__intro">
        You'll be signed in as the owner for 15 minutes. Every action during the session is attributed to you via the audit log.
      </p>
      <label class="impersonate__field">
        <span class="impersonate__label">Reason</span>
        <textarea
          v-model="reason"
          class="impersonate__input"
          rows="3"
          maxlength="500"
          placeholder="e.g. support-ticket-4421"
          :disabled="submitting"
          @keydown.enter.ctrl.exact="submit"
        />
        <span class="impersonate__hint">Required. Visible on the account timeline and the audit log.</span>
      </label>
      <div v-if="error" class="impersonate__error">{{ error }}</div>
    </div>
    <template #footer>
      <button type="button" class="impersonate__btn" :disabled="submitting" @click="emit('close')">Cancel</button>
      <button type="button" class="impersonate__btn impersonate__btn--primary" :disabled="submitting || !reason.trim()" @click="submit">
        {{ submitting ? 'Starting…' : 'Start impersonation' }}
      </button>
    </template>
  </CrmModal>
</template>

<style scoped>
.impersonate { display: flex; flex-direction: column; gap: 16px; }
.impersonate__intro { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; line-height: 1.5; }
.impersonate__field { display: flex; flex-direction: column; gap: 6px; }
.impersonate__label { font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-fog); }
.impersonate__input {
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--color-ink);
  background: var(--color-ground);
  border: 1px solid var(--color-hairline);
  border-radius: 10px;
  padding: 10px 14px;
  resize: vertical;
  outline: none;
}
.impersonate__input:focus { border-color: var(--color-ink); }
.impersonate__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.impersonate__error { font-family: var(--font-body); font-size: 13px; color: var(--color-danger); background: color-mix(in oklab, var(--color-danger) 8%, #fff); padding: 10px 12px; border-radius: 8px; }

.impersonate__btn { padding: 10px 20px; font-family: var(--font-body); font-size: 13px; font-weight: 600; background: var(--color-surface); color: var(--color-ink); border: 1px solid var(--color-hairline); border-radius: 999px; cursor: pointer; }
.impersonate__btn:disabled { opacity: 0.5; cursor: not-allowed; }
.impersonate__btn--primary { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
</style>
