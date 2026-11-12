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
  members as membersApi,
  ApiError,
  type MemberRole,
  type MemberStatus,
  type MembershipTierListItem,
  type PaymentStatus,
  type RosterMember,
} from '@torny/api-client'
import CrmModal from '@/components/modals/CrmModal.vue'
import CrmSpinner from '@/components/CrmSpinner.vue'
import TornyMultiSelect from '@/components/TornyMultiSelect.vue'
import { RichTextEditor } from '@torny/content-blocks'
import { useClubStore } from '@/stores/club'
import { useToast } from '@/composables/useToast'
import { useEmailSignatures, stitchSignature } from '@/composables/useEmailSignatures'

/** Lightweight shape the modal needs — RosterMember already satisfies it,
 *  and callers composing a bulk send can pass trimmed rows without having
 *  to hydrate full roster objects. `user_id` is optional for callers that
 *  provide their own `sendHandler` (e.g. the enquiry page, where the
 *  recipient is a prospect not a member). */
export interface EmailRecipient {
  user_id?: number
  name: string
  email: string | null
}

/** Payload handed to a custom `sendHandler`. Includes both the plain-text
 *  body (for endpoints that template server-side, like enquiry replies)
 *  and the HTML version (for endpoints that need wrapped markup). */
export interface SendEmailPayload {
  subject: string
  body: string
  bodyHtml: string
}

const props = defineProps<{
  open: boolean
  clubId: number | null
  /** Single recipient — kept for the member detail page's quick-email. */
  member?: RosterMember | EmailRecipient | null
  /** Bulk recipients — takes precedence over `member` when provided. */
  members?: EmailRecipient[] | null
  /** Optional override for the send step. If provided, replaces the
   *  default bulkEmail flow — useful for contexts where recipients
   *  aren't members (enquiries) or need a different backend endpoint. */
  sendHandler?: (payload: SendEmailPayload) => Promise<void>
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

// Body is now HTML (TipTap's output). The initial empty state is '' — the
// RichTextEditor renders its placeholder when the editor is empty.
const state = reactive({ subject: '', body: '' })
const sending = ref(false)
const insertOpen = ref(false)
const lastFocused = ref<'subject' | 'body'>('body')
const subjectEl = ref<HTMLInputElement | null>(null)
const bodyEl = ref<InstanceType<typeof RichTextEditor> | null>(null)
const signatures = useEmailSignatures()
const includeSignature = ref(true)
/** User IDs the sender has removed from the chip row for this compose
 *  session — we hide them from the recipients list but don't mutate the
 *  caller's selection. Cleared on open. */
const removedIds = ref<Set<number>>(new Set())

// ── Audience filters ──────────────────────────────────────────
/** Each filter is an array of selected values; empty = "no filter on this
 *  axis". Combined conjunctively — a member must satisfy every active axis
 *  (OR within an axis). Resolved to a concrete recipient list by refetching
 *  the roster when any axis changes. */
type DuesStatus = 'paid' | 'due' | 'overdue' | 'waived' | 'none'
const audienceFilters = reactive<{
  statuses: MemberStatus[]
  tierSlugs: string[]
  roles: MemberRole[]
  dues: DuesStatus[]
}>({
  statuses: [],
  tierSlugs: [],
  roles: [],
  dues: [],
})
const hasAnyFilter = computed(() =>
  audienceFilters.statuses.length > 0
  || audienceFilters.tierSlugs.length > 0
  || audienceFilters.roles.length > 0
  || audienceFilters.dues.length > 0,
)

const STATUS_OPTIONS: Array<{ value: MemberStatus; label: string }> = [
  { value: 'active',   label: 'Active members' },
  { value: 'prospect', label: 'Prospects' },
  { value: 'visitor',  label: 'Visitors' },
  { value: 'pending',  label: 'Pending invites' },
  { value: 'lapsed',   label: 'Lapsed' },
]
const ROLE_OPTIONS: Array<{ value: MemberRole; label: string }> = [
  { value: 'owner',     label: 'Owner' },
  { value: 'admin',     label: 'Admin' },
  { value: 'member', label: 'Team member' },
  { value: 'player',    label: 'Player' },
]
const DUES_OPTIONS: Array<{ value: DuesStatus; label: string }> = [
  { value: 'paid',    label: 'Paid up' },
  { value: 'due',     label: 'Due soon' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'waived',  label: 'Waived' },
  { value: 'none',    label: 'No membership on file' },
]
/** Loaded on first open to drive the Tier filter. Avoids a round-trip when
 *  the admin opens the modal just to send to a specific picked member. */
const tiers = ref<MembershipTierListItem[]>([])
const tiersLoaded = ref(false)
const tierOptions = computed<Array<{ value: string; label: string }>>(() => {
  const list = tiers.value
    .filter((t) => !!t.slug)
    .map((t) => ({ value: t.slug as string, label: t.type_name }))
    .sort((a, b) => a.label.localeCompare(b.label))
  list.push({ value: 'none', label: 'No tier assigned' })
  return list
})
async function ensureTiersLoaded() {
  if (tiersLoaded.value) return
  const cid = props.clubId
  if (cid == null) return
  try {
    const res = await membersApi.listTiers(cid)
    tiers.value = res.tiers
  } catch {
    tiers.value = []
  } finally {
    tiersLoaded.value = true
  }
}

/** Members matched by the current filter payload. The server honours
 *  `status` + `role` + `membership_type_slug`; dues is a client-side pass
 *  because `payment_status` is nested under `membership`. */
const filterMatches = ref<EmailRecipient[]>([])
const filterLoading = ref(false)
let filterAbort: AbortController | null = null
let filterDebounce: ReturnType<typeof setTimeout> | null = null

function rosterRowDues(m: RosterMember): DuesStatus {
  const ps: PaymentStatus | null = m.membership?.payment_status ?? null
  if (ps === 'paid') return 'paid'
  if (ps === 'unpaid' || ps === 'partial') return 'due'
  if (ps === 'overdue') return 'overdue'
  if (ps === 'waived') return 'waived'
  return 'none'
}

async function refetchFilterMatches() {
  const cid = props.clubId
  if (cid == null || !hasAnyFilter.value) {
    filterMatches.value = []
    return
  }
  if (filterAbort) filterAbort.abort()
  filterAbort = new AbortController()
  filterLoading.value = true
  try {
    // Each axis is a union — the roster endpoint only accepts single
    // values for `status` and `role`, so when the admin picks multiple
    // values on either axis we union the responses here.
    const statusList: Array<'all' | MemberStatus> = audienceFilters.statuses.length === 0
      ? ['all']
      : audienceFilters.statuses
    const roleList: Array<MemberRole | undefined> = audienceFilters.roles.length === 0
      ? [undefined]
      : audienceFilters.roles
    const tierParam = audienceFilters.tierSlugs.length > 0 ? audienceFilters.tierSlugs : undefined

    const combos: Array<{ status: 'all' | MemberStatus; role?: MemberRole }> = []
    for (const s of statusList) for (const r of roleList) combos.push({ status: s, role: r })

    const seen = new Map<number, RosterMember>()
    for (const combo of combos) {
      const res = await membersApi.listRoster(
        cid,
        {
          status: combo.status,
          role: combo.role,
          membership_type_slug: tierParam,
          limit: 200,
          include_invites: false,
        },
        { signal: filterAbort.signal },
      )
      for (const m of res.members) {
        if (!seen.has(m.user_id)) seen.set(m.user_id, m)
      }
    }
    let rows = Array.from(seen.values())
    // Client-side dues pass (server doesn't accept this axis).
    if (audienceFilters.dues.length > 0) {
      const duesSet = new Set(audienceFilters.dues)
      rows = rows.filter((m) => duesSet.has(rosterRowDues(m)))
    }
    filterMatches.value = rows.map<EmailRecipient>((m) => ({
      user_id: m.user_id,
      name: m.name,
      email: m.email ?? null,
    }))
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    filterMatches.value = []
  } finally {
    filterLoading.value = false
  }
}

watch(
  () => [
    audienceFilters.statuses.join(','),
    audienceFilters.tierSlugs.join(','),
    audienceFilters.roles.join(','),
    audienceFilters.dues.join(','),
  ],
  () => {
    if (filterDebounce) clearTimeout(filterDebounce)
    filterDebounce = setTimeout(() => { void refetchFilterMatches() }, 200)
  },
)

function clearAudienceFilters() {
  audienceFilters.statuses = []
  audienceFilters.tierSlugs = []
  audienceFilters.roles = []
  audienceFilters.dues = []
  filterMatches.value = []
}

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
      clearAudienceFilters()
      void ensureTiersLoaded()
      includeSignature.value = true
      void nextTick(() => bodyEl.value?.focus())
    }
  },
)

/** Explicit recipients passed in by the opener — the "pre-selected" set.
 *  Dedup against this set when merging filter matches. */
const explicitRecipients = computed<EmailRecipient[]>(() => {
  if (props.members && props.members.length > 0) return props.members
  if (props.member) {
    return [{
      user_id: 'user_id' in props.member ? props.member.user_id : undefined,
      name: props.member.name,
      email: props.member.email ?? null,
    }]
  }
  return []
})

/** Final recipient list — explicit + filter-matched, de-duped by `user_id`
 *  (and name+email as a fallback for enquiry prospects), then stripped of
 *  anything the user removed in this compose session. */
const recipients = computed<EmailRecipient[]>(() => {
  const seen = new Set<string>()
  const out: EmailRecipient[] = []
  const push = (r: EmailRecipient) => {
    const key = r.user_id != null ? `u:${r.user_id}` : `k:${(r.email ?? '').toLowerCase()}:${r.name}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(r)
  }
  for (const r of explicitRecipients.value) push(r)
  for (const r of filterMatches.value) push(r)
  return out.filter((r) => r.user_id == null || !removedIds.value.has(r.user_id))
})

/** Stable key for v-for over recipients — user_id when available, falls
 *  back to email + name so recipients without a user_id (enquiry prospects)
 *  still render without Vue key warnings. */
function recipientKey(r: EmailRecipient): string | number {
  return r.user_id ?? `${r.email ?? ''}:${r.name}`
}

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

/** Strip HTML tags for the plain-text fallback the server also wants.
 *  Rough — relies on DOM parsing for correctness. Good enough for a
 *  text-only view in mail clients that don't render HTML. */
function htmlToPlain(html: string): string {
  if (typeof document === 'undefined') return html
  const div = document.createElement('div')
  div.innerHTML = html
  return (div.textContent ?? '').trim()
}

/** Stitch the drafted body with the admin's saved signatures when the
 *  toggle is on. See `useEmailSignatures` — brief 103 swaps localStorage
 *  for the real GET/PUT endpoints without changing this call site. */
function finalBodyHtml(): string {
  const body = state.body
  if (!includeSignature.value) return body
  return stitchSignature({
    bodyHtml: body,
    personalHtml: signatures.personal.value || null,
    clubHtml: signatures.club.value || null,
  })
}

async function send() {
  if (!canSend.value) return
  const cid = props.clubId
  if (cid == null) return
  sending.value = true
  try {
    const bodyHtml = finalBodyHtml()
    const payload: SendEmailPayload = {
      subject: state.subject.trim(),
      body: htmlToPlain(bodyHtml),
      bodyHtml,
    }
    // Custom send path (enquiry replies etc). Parent is responsible for
    // its own success toasts — we only surface a generic one.
    if (props.sendHandler) {
      await props.sendHandler(payload)
      toast.success('Email sent.')
      emit('sent')
      emit('close')
      return
    }
    // Default: bulk-email endpoint. Requires every deliverable recipient
    // to have a `user_id` (members only).
    const userIds = deliverable.value
      .map((r) => r.user_id)
      .filter((id): id is number => typeof id === 'number')
    if (userIds.length === 0) return
    const result = await bulkEmailApi.send(cid, {
      subject: payload.subject,
      body_html: payload.bodyHtml,
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
  if (target === 'subject') {
    const el = subjectEl.value
    const current = state.subject
    const start = el?.selectionStart ?? current.length
    const end = el?.selectionEnd ?? current.length
    state.subject = current.slice(0, start) + token + current.slice(end)
    void nextTick(() => {
      el?.focus()
      const caret = start + token.length
      el?.setSelectionRange(caret, caret)
    })
    return
  }
  // Body is the RichTextEditor — ask it to insert at the live cursor.
  bodyEl.value?.insertText(token)
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
    :title="isBulk ? `Send email to ${recipients.length} people` : 'Send email'"
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
              :key="recipientKey(r)"
              class="email__chip email__chip--removable"
              :class="{ 'email__chip--no-email': !r.email }"
            >
              <span class="email__chip-avatar">{{ recipientInitials(r) }}</span>
              <span class="email__chip-name">{{ r.name }}</span>
              <button
                v-if="r.user_id != null"
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
              :key="recipientKey(r)"
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
      <div class="email__row email__row--audience">
        <div class="email__row-label">Audience</div>
        <div class="email__row-main email__audience">
          <TornyMultiSelect
            v-model="audienceFilters.statuses"
            label="Status"
            :options="STATUS_OPTIONS"
          />
          <TornyMultiSelect
            v-model="audienceFilters.tierSlugs"
            label="Tier"
            :options="tierOptions"
            :disabled="tierOptions.length <= 1 && !tiersLoaded"
          />
          <TornyMultiSelect
            v-model="audienceFilters.roles"
            label="Role"
            :options="ROLE_OPTIONS"
          />
          <TornyMultiSelect
            v-model="audienceFilters.dues"
            label="Dues"
            :options="DUES_OPTIONS"
          />
          <button
            v-if="hasAnyFilter"
            type="button"
            class="email__audience-reset"
            @click="clearAudienceFilters"
          >
            Clear filters
          </button>
        </div>
      </div>
      <div v-if="hasAnyFilter" class="email__audience-summary">
        <template v-if="filterLoading">Finding matches…</template>
        <template v-else-if="filterMatches.length === 0">
          No members match these filters.
        </template>
        <template v-else>
          <strong>{{ filterMatches.length }}</strong>
          member{{ filterMatches.length === 1 ? '' : 's' }} match{{ filterMatches.length === 1 ? 'es' : '' }} —
          merged into recipients above.
        </template>
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

      <div class="email__body" @focusin="lastFocused = 'body'" @keydown="onCmdEnter">
        <RichTextEditor
          ref="bodyEl"
          v-model="state.body"
          placeholder="Hi {{recipient_first_name}},

Just a quick note from the club…"
          size="md"
        />
      </div>

      <!-- Signature preview — stitches the admin's saved personal sig +
           the club footer into every send. Hidden when nothing's saved so
           admins without a signature don't see a dead block. -->
      <div
        v-if="includeSignature && (signatures.personal.value || signatures.club.value)"
        class="email__sig"
      >
        <div class="email__sig-head">
          <div class="email__sig-eyebrow">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M2 12c2-3 4-6 6-6s3 3 1 4-3-1-1-3 4-4 6-4"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linecap="round"
              />
            </svg>
            <span>Signature auto-appended</span>
          </div>
          <router-link
            class="email__sig-manage"
            :to="{ name: 'settings', params: { section: 'email-signatures' } }"
          >Manage</router-link>
        </div>
        <div
          v-if="signatures.personal.value"
          class="email__sig-body"
          v-html="signatures.personal.value"
        />
        <hr
          v-if="signatures.personal.value && signatures.club.value"
          class="email__sig-divider"
        />
        <div
          v-if="signatures.club.value"
          class="email__sig-body email__sig-body--muted"
          v-html="signatures.club.value"
        />
      </div>
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
        <CrmSpinner v-if="sending" size="sm" label="Sending" />
        <span>{{ sending
          ? 'Sending…'
          : isBulk
            ? `Send to ${deliverable.length}`
            : 'Send email' }}</span>
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
.email__row--audience { align-items: flex-start; padding-top: 12px; }
.email__row--audience .email__row-label { margin-top: 6px; }
.email__audience {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.email__audience-reset {
  padding: 0;
  border: 0;
  background: transparent;
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-fog);
  cursor: pointer;
  margin-left: 2px;
}
.email__audience-reset:hover { color: var(--color-ink); text-decoration: underline; }
.email__audience-summary {
  margin: 6px 0 0 88px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--color-surface);
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
  line-height: 1.4;
}
.email__audience-summary strong { color: var(--color-ink); font-weight: 700; }

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
  padding: 10px 20px 18px;
  border-radius: 10px;
  border: 1px solid var(--color-hairline);
  background: #fff;
  display: flex;
  flex-direction: column;
  transition: border-color 0.12s ease;
}
.email__body:focus-within { border-color: var(--color-ink); }

/* Signature preview strip — hairline-left muted block previewing what
 * will be appended to the sent email. Not the sender's personal inbox. */
.email__sig {
  margin-top: 14px;
  padding: 14px 16px 14px 18px;
  border-left: 2px solid var(--color-hairline);
  background: #FAFAF7;
  border-radius: 0 10px 10px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.email__sig-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.email__sig-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.email__sig-manage {
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-accent, #2563eb);
  text-decoration: none;
}
.email__sig-manage:hover { text-decoration: underline; }
.email__sig-body {
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.55;
  color: var(--color-graphite);
}
.email__sig-body :deep(p) { margin: 0 0 4px; }
.email__sig-body :deep(p:last-child) { margin-bottom: 0; }
.email__sig-body :deep(a) { color: var(--color-accent, #2563eb); text-decoration: underline; }
.email__sig-body--muted {
  font-size: 12px;
  color: var(--color-fog);
}
.email__sig-divider {
  height: 1px;
  background: var(--color-hairline);
  border: 0;
  margin: 0;
}

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
