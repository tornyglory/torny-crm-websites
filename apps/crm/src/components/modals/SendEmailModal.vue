<script setup lang="ts">
/**
 * SendEmailModal — one-off email to one or many members.
 *
 * Server wraps every message in the club's saved header/footer and
 * substitutes {{tokens}} per recipient (see bulkEmail resource). The
 * "Insert field" dropdown writes those tokens at the cursor. Templates,
 * attachments, Cc/Bcc, drafts, and scheduling will ship with the
 * Communications brief.
 */
import { computed, nextTick, reactive, ref, watch } from 'vue'
import {
  bulkEmail as bulkEmailApi,
  ApiError,
  type RosterMember,
} from '@torny/api-client'
import CrmModal from '@/components/modals/CrmModal.vue'
import { useClubStore } from '@/stores/club'
import { useToast } from '@/composables/useToast'

/** Lightweight shape the modal needs — RosterMember already satisfies it,
 *  and callers composing a bulk send can pass trimmed rows without having
 *  to hydrate full roster objects. */
export interface EmailRecipient {
  user_id: number
  name: string
  email: string | null
}

const props = defineProps<{
  open: boolean
  clubId: number | null
  /** Single recipient — kept for the member detail page's quick-email. */
  member?: RosterMember | EmailRecipient | null
  /** Bulk recipients — takes precedence over `member` when provided. */
  members?: EmailRecipient[] | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'sent'): void
}>()

const toast = useToast()
const clubStore = useClubStore()

interface InsertField {
  token: string
  label: string
}
const INSERT_FIELDS: InsertField[] = [
  { token: '{{recipient_first_name}}', label: 'First name' },
  { token: '{{recipient_name}}',       label: 'Full name' },
  { token: '{{club_name}}',            label: 'Club name' },
  { token: '{{year}}',                 label: 'Year' },
]

const SUBJECT_MAX = 200
const BODY_MAX = 8000

const state = reactive({ subject: '', body: '' })
const sending = ref(false)
const insertOpen = ref(false)
const lastFocused = ref<'subject' | 'body'>('body')
const subjectEl = ref<HTMLInputElement | null>(null)
const bodyEl = ref<HTMLTextAreaElement | null>(null)
/** User IDs the sender has removed from the chip row for this compose
 *  session — we hide them from the recipients list but don't mutate the
 *  caller's selection. Cleared on open. */
const removedIds = ref<Set<number>>(new Set())

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      state.subject = ''
      state.body = ''
      sending.value = false
      insertOpen.value = false
      lastFocused.value = 'body'
      removedIds.value = new Set()
      void nextTick(() => bodyEl.value?.focus())
    }
  },
)

/** Normalised recipient list — `members` wins when both props are set,
 *  then we strip out anything the user removed in this compose session. */
const recipients = computed<EmailRecipient[]>(() => {
  const base: EmailRecipient[] = props.members && props.members.length > 0
    ? props.members
    : props.member
      ? [{ user_id: props.member.user_id, name: props.member.name, email: props.member.email ?? null }]
      : []
  return base.filter((r) => !removedIds.value.has(r.user_id))
})

/** Recipients with a real email on file — the only ones the server will
 *  actually mail. Addresses without one are called out in the warning
 *  line so admins can fix a missing email before firing. */
const deliverable = computed(() => recipients.value.filter((r) => !!r.email && r.email.trim().length > 0))
const skipped = computed(() => recipients.value.filter((r) => !r.email || r.email.trim().length === 0))
const isBulk = computed(() => recipients.value.length > 1)

function recipientInitials(r: EmailRecipient): string {
  return r.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?'
}

function removeRecipient(userId: number) {
  const next = new Set(removedIds.value)
  next.add(userId)
  removedIds.value = next
}

const fromLabel = computed(() => clubStore.current?.name ?? 'Your club')

const canSend = computed(() => {
  return (
    !sending.value &&
    deliverable.value.length > 0 &&
    state.subject.trim().length > 0 &&
    state.body.trim().length > 0
  )
})

/** Convert a plain-text body into HTML paragraphs. Blank lines split
 *  paragraphs; single `\n` becomes `<br>`. Escapes HTML so pasted text
 *  can't inject markup — except `{{tokens}}`, which we leave intact so
 *  the server can substitute them (they contain no HTML-special chars). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
function toBodyHtml(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  return trimmed
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('\n')
}

async function send() {
  if (!canSend.value) return
  const cid = props.clubId
  const userIds = deliverable.value.map((r) => r.user_id)
  if (cid == null || userIds.length === 0) return
  sending.value = true
  try {
    const result = await bulkEmailApi.send(cid, {
      subject: state.subject.trim(),
      body_html: toBodyHtml(state.body),
      recipients: { mode: 'ids', user_ids: userIds },
    })
    if (result.sent_count === 0 && result.failed_count > 0) {
      const reason = result.failed[0]?.reason ?? 'Delivery failed.'
      toast.error(`Could not send: ${reason}`)
      return
    }
    if (result.failed_count > 0) {
      toast.info(
        `Sent to ${result.sent_count} — ${result.failed_count} couldn't be delivered.`,
      )
    } else if (result.sent_count === 1) {
      toast.success('Email sent.')
    } else {
      toast.success(`Email sent to ${result.sent_count} members.`)
    }
    emit('sent')
    emit('close')
  } catch (err) {
    const msg = err instanceof ApiError
      ? err.message
      : err instanceof Error
        ? err.message
        : 'Could not send the email.'
    toast.error(msg)
  } finally {
    sending.value = false
  }
}

function onCmdEnter(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    void send()
  }
}

function insertAt(target: 'subject' | 'body', token: string) {
  const el = target === 'subject' ? subjectEl.value : bodyEl.value
  const current = target === 'subject' ? state.subject : state.body
  const start = el?.selectionStart ?? current.length
  const end = el?.selectionEnd ?? current.length
  const next = current.slice(0, start) + token + current.slice(end)
  if (target === 'subject') state.subject = next
  else state.body = next
  void nextTick(() => {
    el?.focus()
    const caret = start + token.length
    el?.setSelectionRange(caret, caret)
  })
}

function pickField(f: InsertField) {
  insertOpen.value = false
  insertAt(lastFocused.value, f.token)
}
</script>

<template>
  <CrmModal
    :open="open"
    eyebrow="Compose · from the club"
    :title="isBulk ? `Send email to ${recipients.length} members` : 'Send email'"
    width="lg"
    @close="emit('close')"
  >
    <!-- Address rows (To / From / Subject) sit flush against the modal body
         with 72px label columns so values share one vertical lane. -->
    <section class="email__rows">
      <div class="email__row">
        <div class="email__row-label">
          To
          <span v-if="isBulk" class="email__row-count">{{ recipients.length }}</span>
        </div>
        <div class="email__row-main">
          <template v-if="recipients.length === 0">
            <div class="email__chip-warn">No recipients selected.</div>
          </template>
          <template v-else-if="isBulk">
            <div
              v-for="r in recipients"
              :key="r.user_id"
              class="email__chip email__chip--removable"
              :class="{ 'email__chip--no-email': !r.email }"
            >
              <span class="email__chip-avatar">{{ recipientInitials(r) }}</span>
              <span class="email__chip-name">{{ r.name }}</span>
              <button
                type="button"
                class="email__chip-remove"
                :disabled="sending"
                :aria-label="`Remove ${r.name}`"
                @click="removeRecipient(r.user_id)"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                </svg>
              </button>
            </div>
          </template>
          <template v-else>
            <div
              v-for="r in recipients"
              :key="r.user_id"
              class="email__chip"
              :class="{ 'email__chip--no-email': !r.email }"
            >
              <span class="email__chip-avatar">{{ recipientInitials(r) }}</span>
              <span class="email__chip-name">{{ r.name }}</span>
              <span v-if="r.email" class="email__chip-email">{{ r.email }}</span>
            </div>
          </template>
        </div>
      </div>
      <div v-if="skipped.length > 0" class="email__skip-row">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.4" />
          <path d="M7 4v3.5M7 9.5v.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
        <span>
          <template v-if="isBulk">
            {{ skipped.length }} of {{ recipients.length }} selected
            {{ skipped.length === 1 ? 'has' : 'have' }} no email on file and will be skipped.
          </template>
          <template v-else>
            No email on file — add one from the member profile to send.
          </template>
        </span>
      </div>

      <div class="email__row">
        <div class="email__row-label">From</div>
        <div class="email__row-main email__row-main--muted">
          <span class="email__from-name">{{ fromLabel }}</span>
          <span class="email__from-hint">· via the club's saved sender</span>
        </div>
      </div>

      <div class="email__row">
        <div class="email__row-label">Subject</div>
        <input
          ref="subjectEl"
          v-model="state.subject"
          type="text"
          class="email__subject"
          :maxlength="SUBJECT_MAX"
          :disabled="sending"
          placeholder="What's this about?"
          @focus="lastFocused = 'subject'"
          @keydown="onCmdEnter"
        />
        <div class="email__row-aux">{{ state.subject.length }} / {{ SUBJECT_MAX }}</div>
      </div>
    </section>

    <!-- Composer — toolbar + white body card on a soft tint, so the writing
         surface reads as the primary focus the way the design shows. -->
    <section class="email__composer">
      <div class="email__toolbar">
        <div class="email__insert">
          <button
            type="button"
            class="email__insert-btn"
            :class="{ 'email__insert-btn--open': insertOpen }"
            :disabled="sending"
            @click="insertOpen = !insertOpen"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
            Insert field
          </button>
          <ul v-if="insertOpen" class="email__insert-menu" role="menu">
            <li v-for="f in INSERT_FIELDS" :key="f.token">
              <button type="button" class="email__insert-item" @click="pickField(f)">
                <span class="email__insert-item-label">{{ f.label }}</span>
                <span class="email__insert-item-token">{{ f.token }}</span>
              </button>
            </li>
          </ul>
        </div>
        <div class="email__toolbar-hint">
          Server adds the club header &amp; footer and personalises
          <code v-pre>{{tokens}}</code> per recipient.
        </div>
      </div>

      <textarea
        ref="bodyEl"
        v-model="state.body"
        class="email__body"
        rows="10"
        :maxlength="BODY_MAX"
        :disabled="sending"
        :placeholder="`Hi {{recipient_first_name}},\n\nJust a quick note from the club…`"
        @focus="lastFocused = 'body'"
        @keydown="onCmdEnter"
      />
    </section>

    <template #footer>
      <div class="email__foot-hint">
        <kbd>⌘</kbd><kbd>↵</kbd> to send
      </div>
      <button
        type="button"
        class="pill-btn pill-btn--ghost"
        :disabled="sending"
        @click="emit('close')"
      >
        Cancel
      </button>
      <button
        type="button"
        class="pill-btn pill-btn--ink"
        :disabled="!canSend"
        @click="send"
      >
        {{ sending
          ? 'Sending…'
          : isBulk
            ? `Send to ${deliverable.length}`
            : 'Send email' }}
        <svg v-if="!sending" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M2.5 7h8M7 3.5L10.5 7 7 10.5"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </template>
  </CrmModal>
</template>

<style scoped>
.email__rows { display: flex; flex-direction: column; }
.email__row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-hairline);
  min-height: 52px;
}
.email__row:first-child { padding-top: 0; }
.email__row-label {
  width: 72px;
  flex-shrink: 0;
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.email__row-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.email__row-main--muted { color: var(--color-fog); }
.email__row-aux {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-mute);
}
.email__chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 10px 0 4px;
  border-radius: 999px;
  background: var(--color-surface);
}
.email__chip-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--color-ink);
  color: #fff;
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
}
.email__chip-name {
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-ink);
}
.email__chip-email {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-fog);
}
.email__chip-warn {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-danger);
}
.email__row-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  margin-left: 6px;
  border-radius: 999px;
  background: var(--color-ink);
  color: #fff;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0;
}
.email__chip--removable { padding-right: 6px; }
.email__chip--no-email { opacity: 0.6; }
.email__chip--no-email .email__chip-avatar {
  background: var(--color-mute);
}
.email__chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: 2px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--color-fog);
  cursor: pointer;
}
.email__chip-remove:hover:not(:disabled) {
  background: var(--color-hairline);
  color: var(--color-ink);
}
.email__chip-remove:disabled { opacity: 0.4; cursor: not-allowed; }
.email__skip-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  margin-top: 8px;
  border-radius: 10px;
  background: #FFFBEB;
  border: 1px solid #FDE68A;
  font-family: var(--font-body);
  font-size: 12px;
  color: #92400E;
}
.email__skip-row svg { flex-shrink: 0; margin-top: 1px; }
.email__from-name {
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 500;
  color: var(--color-ink);
}
.email__from-hint {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-fog);
}
.email__subject {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  padding: 6px 0;
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 500;
  letter-spacing: -0.01em;
  color: var(--color-ink);
  background: transparent;
}
.email__subject::placeholder { color: var(--color-mute); }
.email__subject:disabled { opacity: 0.6; cursor: not-allowed; }

.email__composer {
  margin-top: 18px;
  padding: 14px;
  border-radius: 14px;
  background: var(--color-surface);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.email__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.email__insert { position: relative; }
.email__insert-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--color-accent-soft);
  color: var(--color-accent-strong);
  border: 0;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.email__insert-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-accent-soft) 80%, var(--color-accent) 20%);
}
.email__insert-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.email__insert-btn--open {
  background: var(--color-accent);
  color: var(--color-accent-ink);
}
.email__insert-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 5;
  min-width: 220px;
  padding: 6px;
  margin: 0;
  list-style: none;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 10px;
  box-shadow: 0 12px 28px -14px rgba(10, 10, 11, 0.25);
}
.email__insert-item {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
}
.email__insert-item:hover { background: var(--color-surface); }
.email__insert-item-label {
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-ink);
}
.email__insert-item-token {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-fog);
}
.email__toolbar-hint {
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--color-fog);
}
.email__toolbar-hint code {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 4px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  color: var(--color-graphite);
}

.email__body {
  width: 100%;
  min-height: 260px;
  padding: 18px 20px;
  border-radius: 10px;
  border: 1px solid var(--color-hairline);
  background: #fff;
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 1.6;
  color: var(--color-ink);
  resize: vertical;
}
.email__body:focus { outline: none; border-color: var(--color-ink); }
.email__body:disabled { opacity: 0.6; cursor: not-allowed; }

.email__foot-hint {
  margin-right: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
}
.email__foot-hint kbd {
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
.pill-btn:focus-visible {
  outline: 2px solid var(--color-ink);
  outline-offset: 2px;
}
.pill-btn--ghost {
  background: transparent;
  color: var(--color-ink);
}
.pill-btn--ghost:hover:not(:disabled) { background: var(--color-hairline); }
.pill-btn--ghost:disabled { color: var(--color-mute); cursor: not-allowed; }
.pill-btn--ink {
  background: var(--color-ink);
  color: #fff;
  padding: 0 22px;
}
.pill-btn--ink:hover:not(:disabled) { background: var(--color-graphite); }
/* Disabled primary stays a solid dark pill — the design never shows the
 * primary action looking washed out, so avoid blanket opacity-fading. */
.pill-btn--ink:disabled {
  background: var(--color-mute);
  color: #fff;
  cursor: not-allowed;
}
</style>
