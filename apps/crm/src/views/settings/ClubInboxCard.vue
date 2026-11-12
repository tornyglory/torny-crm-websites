<script setup lang="ts">
/**
 * Settings → Integrations → Club email card (brief 100).
 *
 * The admin picks a handle; outbound mail flips to `<handle>@torny.pro`
 * as the From + Reply-To, and replies to that address land back in the
 * CRM via the SES Inbound Lambda → /internal/inbound-email pipeline.
 *
 * Interaction grammar is the same as the brief 98 subdomain editor —
 * inline "Edit" button, debounced availability check, confirm modal
 * before save. Keeps the two handle-picking surfaces feeling identical.
 */
import { computed, reactive, ref } from 'vue'
import {
  ApiError,
  clubs,
  type ChangeEmailHandleErrorCode,
  type EmailHandleCheckResult,
} from '@torny/api-client'
import CrmModal from '@/components/modals/CrmModal.vue'
import { useClubStore } from '@/stores/club'
import { useToast } from '@/composables/useToast'
import { usePermissions } from '@/composables/usePermissions'

const clubStore = useClubStore()
const toast = useToast()
const { isOwner } = usePermissions()

/** The brief-100 mailbox domain. Shared constant so it stays single-
 *  source if we ever move off `.torny.pro`. */
const INBOX_DOMAIN = 'torny.pro'

const currentHandle = computed<string>(() => clubStore.current?.emailHandle ?? '')
const currentAddress = computed<string>(() =>
  currentHandle.value ? `${currentHandle.value}@${INBOX_DOMAIN}` : '',
)

// ── Editor state ────────────────────────────────────────────

const editing = ref(false)
const draft = ref('')
const saving = ref(false)
const confirmOpen = ref(false)
const error = ref<string | null>(null)

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'invalid' }
  | { kind: 'reserved' }
  | { kind: 'taken' }
  | { kind: 'transport-error' }
const check = ref<CheckState>({ kind: 'idle' })

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let checkController: AbortController | null = null

function openEditor() {
  if (!isOwner.value) return
  draft.value = currentHandle.value
  error.value = null
  check.value = { kind: 'idle' }
  editing.value = true
}

function cancelEditor() {
  editing.value = false
  if (debounceTimer) clearTimeout(debounceTimer)
  checkController?.abort()
}

function onInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value
  // Normalise as the user types — matches the backend validator's charset
  // so the live check reflects what would be sent.
  const next = raw.toLowerCase().replace(/[^a-z0-9-]/g, '')
  draft.value = next
  error.value = null

  if (next === currentHandle.value) {
    check.value = { kind: 'idle' }
    return
  }

  // Local short-circuits for obvious invalids so we don't flash
  // "Checking…" on a single character.
  if (next.length < 3 || next.length > 30 || next.startsWith('-') || next.endsWith('-')) {
    check.value = { kind: 'invalid' }
    return
  }

  check.value = { kind: 'checking' }
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    void runAvailabilityCheck(next)
  }, 300)
}

async function runAvailabilityCheck(value: string) {
  checkController?.abort()
  checkController = new AbortController()
  try {
    const res: EmailHandleCheckResult = await clubs.checkEmailHandle(value, {
      signal: checkController.signal,
    })
    // Draft moved on while we were waiting — ignore stale response.
    if (value !== draft.value) return
    if (res.available) {
      check.value = { kind: 'available' }
    } else {
      check.value = { kind: res.reason }
    }
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') return
    check.value = { kind: 'transport-error' }
  }
}

const canSave = computed(() =>
  check.value.kind === 'available'
  && draft.value !== currentHandle.value
  && !saving.value,
)

const statusText = computed(() => {
  switch (check.value.kind) {
    case 'checking': return 'Checking…'
    case 'available': return 'Available'
    case 'invalid': return 'Must be 3–30 chars, lowercase letters, numbers, hyphens'
    case 'reserved': return 'That handle is reserved'
    case 'taken': return 'Already in use'
    case 'transport-error': return "Couldn't reach Torny — try again"
    default: return ''
  }
})

// ── Save flow ──────────────────────────────────────────────

const confirmState = reactive({
  nextHandle: '',
  oldAddress: '',
  newAddress: '',
})

function openConfirm() {
  if (!canSave.value) return
  confirmState.nextHandle = draft.value
  confirmState.oldAddress = currentAddress.value || `(unset)`
  confirmState.newAddress = `${draft.value}@${INBOX_DOMAIN}`
  error.value = null
  confirmOpen.value = true
}

async function commitChange() {
  const clubId = clubStore.current?.id
  if (clubId == null || !canSave.value) return
  saving.value = true
  error.value = null
  const next = draft.value
  try {
    const res = await clubs.changeEmailHandle(clubId, next)
    if (clubStore.current) {
      clubStore.setCurrent({ ...clubStore.current, emailHandle: res.email_handle })
    }
    toast.success(`Club email is now ${res.address}.`)
    confirmOpen.value = false
    editing.value = false
  } catch (err) {
    const code = err instanceof ApiError
      ? (err.code as ChangeEmailHandleErrorCode | undefined)
      : undefined
    if (code === 'email_handle_taken') {
      // Lost the race between check + save — bump back to the editor.
      check.value = { kind: 'taken' }
      confirmOpen.value = false
    } else {
      error.value = err instanceof ApiError
        ? err.message
        : 'Could not update the email handle.'
    }
  } finally {
    saving.value = false
  }
}

function copyAddress() {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return
  void navigator.clipboard.writeText(currentAddress.value).then(
    () => { toast.success('Copied.') },
    () => { /* clipboard denied — silent */ },
  )
}
</script>

<template>
  <section class="ci">
    <header class="ci__head">
      <div class="ci__title">
        <span class="ci__no">01</span>
        <span>Your inbox address</span>
      </div>
      <p class="ci__sub">Members see this address when you send. Replies land back in the CRM against their record — no extra inbox to check.</p>
    </header>

    <!-- Read-only state ──────────────────────────────────── -->
    <div v-if="!editing" class="ci__read">
      <div class="ci__read-main">
        <span class="ci__mono">{{ currentAddress || `yourclub@${INBOX_DOMAIN}` }}</span>
        <button
          v-if="currentAddress"
          type="button"
          class="ci__link"
          @click="copyAddress"
        >Copy</button>
      </div>
      <button
        v-if="isOwner"
        type="button"
        class="ci__btn ci__btn--outline"
        @click="openEditor"
      >{{ currentHandle ? 'Edit' : 'Pick a handle' }}</button>
    </div>

    <!-- Inline editor ────────────────────────────────────── -->
    <div v-else class="ci__editor">
      <label class="ci__label">Handle</label>
      <div class="ci__input-wrap">
        <input
          class="ci__input"
          type="text"
          :value="draft"
          placeholder="yourclub"
          autofocus
          maxlength="30"
          aria-label="New email handle"
          @input="onInput"
        />
        <span class="ci__suffix">@{{ INBOX_DOMAIN }}</span>
      </div>
      <div
        v-if="check.kind !== 'idle'"
        class="ci__status"
        :class="`ci__status--${check.kind === 'available' ? 'ok' : check.kind === 'checking' ? 'muted' : 'bad'}`"
      >
        <span v-if="check.kind === 'checking'" class="ci__spin" aria-hidden="true" />
        <span v-else class="ci__dot" aria-hidden="true" />
        <span>{{ statusText }}</span>
        <span v-if="check.kind === 'available'" class="ci__status-aux">
          · 3–30 chars, lowercase, hyphens allowed
        </span>
      </div>
      <div v-if="error" class="ci__error">{{ error }}</div>
      <div class="ci__editor-actions">
        <button
          type="button"
          class="ci__btn ci__btn--outline"
          @click="cancelEditor"
        >Cancel</button>
        <button
          type="button"
          class="ci__btn ci__btn--primary"
          :disabled="!canSave"
          @click="openConfirm"
        >Save</button>
      </div>
    </div>
  </section>

  <!-- Confirm modal ──────────────────────────────────────── -->
  <CrmModal
    :open="confirmOpen"
    eyebrow="Club email"
    title="Switch over to this address?"
    width="sm"
    @close="confirmOpen = false"
  >
    <p class="ci__hint">
      From the next send, members will see
      <span class="ci__mono">{{ confirmState.newAddress }}</span>
      as the sender. Replies to this new address flow back into the CRM.
    </p>
    <p class="ci__hint">
      Existing mail already queued at
      <span class="ci__mono">{{ confirmState.oldAddress }}</span>
      will still arrive. Replies to the old address stop reaching you
      within about a minute.
    </p>
    <div v-if="error" class="ci__error">{{ error }}</div>
    <template #footer>
      <button
        type="button"
        class="ci__btn ci__btn--outline"
        :disabled="saving"
        @click="confirmOpen = false"
      >Cancel</button>
      <button
        type="button"
        class="ci__btn ci__btn--primary"
        :disabled="saving"
        @click="commitChange"
      >{{ saving ? 'Switching…' : 'Save & switch over' }}</button>
    </template>
  </CrmModal>
</template>

<style scoped>
.ci {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 16px;
}

.ci__head { display: flex; flex-direction: column; gap: 6px; }
.ci__title {
  display: inline-flex;
  align-items: baseline;
  gap: 10px;
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--color-ink);
}
.ci__no {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  color: var(--color-mute);
}
.ci__sub {
  margin: 0;
  max-width: 540px;
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.55;
  color: var(--color-fog);
}

/* ── Read-only row ───────────────────────────────────────── */
.ci__read {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.ci__read-main { display: inline-flex; align-items: center; gap: 12px; }

.ci__mono {
  font-family: var(--font-mono);
  font-size: 14px;
  color: var(--color-ink);
}
.ci__link {
  padding: 0;
  background: transparent;
  border: 0;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-accent, #2563eb);
  cursor: pointer;
}
.ci__link:hover { text-decoration: underline; }

/* ── Editor ──────────────────────────────────────────────── */
.ci__editor { display: flex; flex-direction: column; gap: 10px; }
.ci__label {
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.ci__input-wrap {
  display: flex;
  align-items: stretch;
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.ci__input-wrap:focus-within {
  border-color: var(--color-ink);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-ink) 8%, transparent);
}
.ci__input {
  flex: 1;
  min-width: 0;
  padding: 14px 16px;
  border: 0;
  background: transparent;
  font-family: var(--font-mono);
  font-size: 16px;
  color: var(--color-ink);
}
.ci__input:focus { outline: none; }
.ci__suffix {
  display: inline-flex;
  align-items: center;
  padding: 0 18px;
  background: var(--color-surface);
  border-left: 1px solid var(--color-hairline);
  font-family: var(--font-mono);
  font-size: 15px;
  color: var(--color-graphite);
  white-space: nowrap;
}

.ci__status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 500;
}
.ci__status-aux { color: var(--color-mute); font-weight: 400; }
.ci__status--ok { color: #166534; }
.ci__status--muted { color: var(--color-fog); }
.ci__status--bad { color: var(--color-danger); }

.ci__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
}
.ci__spin {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  border: 1.5px solid color-mix(in srgb, currentColor 30%, transparent);
  border-top-color: currentColor;
  animation: ci-spin 700ms linear infinite;
}
@keyframes ci-spin { to { transform: rotate(360deg); } }

.ci__error {
  color: var(--color-danger);
  font-family: var(--font-body);
  font-size: 12px;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--color-danger) 8%, transparent);
  border-radius: 8px;
}
.ci__editor-actions {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  align-self: flex-end;
  margin-top: 4px;
}

/* ── Buttons ─────────────────────────────────────────────── */
.ci__btn {
  padding: 9px 18px;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 0;
  transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
}
.ci__btn--outline {
  background: transparent;
  color: var(--color-ink);
  border: 1px solid var(--color-hairline);
}
.ci__btn--outline:hover:not(:disabled) { border-color: var(--color-ink); }
.ci__btn--primary {
  background: var(--color-ink);
  color: #fff;
}
.ci__btn--primary:hover:not(:disabled) { background: var(--color-graphite); transform: translateY(-1px); }
.ci__btn--primary:disabled { opacity: 0.45; cursor: not-allowed; }
.ci__btn:disabled { cursor: not-allowed; }

.ci__hint {
  margin: 0 0 12px;
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.55;
  color: var(--color-graphite);
}
</style>
