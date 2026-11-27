<script setup lang="ts">
/**
 * Ban / unban confirmation modal — brief 126.
 *
 * Mirrors AdminSuspendModal (brief 123 §6.3) — same shape, different
 * target (user, not club). Mode-switched between `ban` and `unban`
 * since they're symmetric.
 *
 * Both sides are permanent-but-reversible — a ban stays until a human
 * clicks unban. No time-bound bans in Phase 1 (brief 126 §8).
 */
import { ref, watch, computed } from 'vue'
import { admin, ApiError } from '@torny/api-client'
import CrmModal from '@/components/modals/CrmModal.vue'

const props = defineProps<{
  open: boolean
  userId: number
  userLabel: string
  mode: 'ban' | 'unban'
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'done'): void
}>()

const reason = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)

watch(() => props.open, (open) => {
  if (!open) return
  reason.value = ''
  error.value = null
})

const title = computed(() =>
  props.mode === 'ban' ? `Ban ${props.userLabel}` : `Unban ${props.userLabel}`,
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
    if (props.mode === 'ban') {
      await admin.banUser(props.userId, { reason: trimmed })
    } else {
      await admin.unbanUser(props.userId, { reason: trimmed })
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
  <CrmModal :open="open" eyebrow="PLATFORM · MODERATION" :title="title" width="sm" @close="emit('close')">
    <div class="ban">
      <p v-if="mode === 'ban'" class="ban__intro">
        A banned user can't sign in to Torny. Their existing sessions stop authenticating on the next request. Reversible via unban. Their past content (pages they authored, emails they sent) stays.
      </p>
      <p v-else class="ban__intro">
        Lifts the platform ban. The user can sign in again immediately and existing JWTs stop 403-ing.
      </p>

      <label class="ban__field">
        <span class="ban__label">Reason</span>
        <textarea
          v-model="reason"
          class="ban__input"
          rows="2"
          maxlength="500"
          :placeholder="mode === 'ban' ? 'e.g. spam-accounts-2026-11-27' : 'e.g. appeal-cleared-2026-12-02'"
          :disabled="submitting"
        />
        <span class="ban__hint">Required. Visible on the audit log.</span>
      </label>

      <div v-if="error" class="ban__error">{{ error }}</div>
    </div>
    <template #footer>
      <button type="button" class="ban__btn" :disabled="submitting" @click="emit('close')">Cancel</button>
      <button
        type="button"
        class="ban__btn"
        :class="mode === 'ban' ? 'ban__btn--danger' : 'ban__btn--primary'"
        :disabled="submitting || !reason.trim()"
        @click="submit"
      >
        {{ submitting ? 'Working…' : (mode === 'ban' ? 'Ban user' : 'Unban user') }}
      </button>
    </template>
  </CrmModal>
</template>

<style scoped>
.ban { display: flex; flex-direction: column; gap: 16px; }
.ban__intro { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; line-height: 1.5; }

.ban__field { display: flex; flex-direction: column; gap: 6px; }
.ban__label { font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-fog); }
.ban__input {
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
.ban__input:focus { border-color: var(--color-ink); }
.ban__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }

.ban__error { font-family: var(--font-body); font-size: 13px; color: var(--color-danger); background: color-mix(in oklab, var(--color-danger) 8%, #fff); padding: 10px 12px; border-radius: 8px; }

.ban__btn { padding: 10px 20px; font-family: var(--font-body); font-size: 13px; font-weight: 600; background: var(--color-surface); color: var(--color-ink); border: 1px solid var(--color-hairline); border-radius: 999px; cursor: pointer; }
.ban__btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ban__btn--primary { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.ban__btn--danger { background: var(--color-danger); color: #fff; border-color: var(--color-danger); }
</style>
