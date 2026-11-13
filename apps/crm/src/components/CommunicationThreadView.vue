<script setup lang="ts">
/**
 * CommunicationThreadView — Gmail-style inline conversation view (brief
 * 101). The parent row (any email in the timeline) renders this inline
 * instead of itself. We fetch the full thread, reverse-sort for display
 * (newest at the top per the Paper 33b design + user's "no collapsed
 * messages" feedback), and dock the reply composer at the bottom.
 *
 * Layout decisions:
 * - The anchor (the comm the admin clicked) gets the ink border + soft
 *   shadow, so the user sees "that's the message you came from" at a
 *   glance. Every other message wears the hairline border.
 * - All messages are fully expanded — we scroll instead of collapsing.
 * - Reply composer uses the shared RichTextEditor from content-blocks.
 *
 * Reply contract (brief 101 §4.3): "Don't optimistically render" — we
 * wait for the 201 then append the server-authoritative row and clear
 * the composer.
 */
import { computed, onMounted, ref, watch, nextTick } from 'vue'
import {
  ApiError,
  communications as communicationsApi,
  type ThreadMessage,
  type ReplyErrorCode,
} from '@torny/api-client'
import { RichTextEditor } from '@torny/content-blocks'
import CrmSpinner from '@/components/CrmSpinner.vue'
import { useToast } from '@/composables/useToast'
import { usePermissions } from '@/composables/usePermissions'

const props = defineProps<{
  clubId: number
  /** The communication_id the admin clicked — becomes the anchor. */
  commId: number
  /** Fallback display when inbound rows are missing from_name/from_email
   *  (e.g. backend populated those fields later). The thread is scoped
   *  to this member, so any inbound reply is by construction from them. */
  memberName?: string | null
  memberEmail?: string | null
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const toast = useToast()
const { canManageTeam } = usePermissions()

// ── Load ────────────────────────────────────────────────────────

const loading = ref(false)
const error = ref<string | null>(null)
const anchorId = ref<number | null>(null)
const messages = ref<ThreadMessage[]>([])
const threadId = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    const res = await communicationsApi.getThread(props.clubId, props.commId)
    threadId.value = res.thread_id
    anchorId.value = res.anchor_id
    messages.value = res.messages
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not load the conversation.'
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => props.commId, load)

/** Newest first for display, per the Paper design. Backend hands them
 *  oldest-first so the ordering is consistent with the DB; we reverse
 *  on the way in. */
const messagesSorted = computed(() => [...messages.value].reverse())

const subject = computed<string>(() => {
  const first = messages.value[0]
  return first?.subject?.trim() || '(no subject)'
})

const participants = computed<string>(() => {
  const names = new Set<string>()
  for (const m of messages.value) {
    if (m.direction === 'inbound') {
      const name = m.from_name || m.from_email || props.memberName || props.memberEmail
      if (name) names.add(name)
    } else if (m.sent_by_name) {
      names.add(m.sent_by_name)
    }
  }
  return Array.from(names).slice(0, 4).join(', ')
})

// ── Time helpers ───────────────────────────────────────────────

const DAY_FMT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

function timestampFor(m: ThreadMessage): { day: string; time: string; isToday: boolean } {
  const iso = m.direction === 'inbound' ? m.received_at ?? m.sent_at : m.sent_at
  if (!iso) return { day: '', time: '', isToday: false }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { day: '', time: '', isToday: false }
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  return { day: DAY_FMT.format(d), time: TIME_FMT.format(d), isToday }
}

function senderName(m: ThreadMessage): string {
  if (m.direction === 'inbound') {
    return m.from_name || m.from_email || props.memberName || props.memberEmail || 'Unknown sender'
  }
  return m.sent_by_name || 'Club admin'
}

function senderInitials(m: ThreadMessage): string {
  const name = senderName(m)
  return name
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'
}

/** "to <name/email> · via/from <torny.pro | personal>" meta line. */
function toLine(m: ThreadMessage): string {
  const parts: string[] = []
  if (m.direction === 'inbound') {
    parts.push('to the club')
    if (m.from_email) parts.push(`via naenaebowls@torny.pro`)
  } else {
    parts.push('to the member')
    parts.push('from naenaebowls@torny.pro')
  }
  return parts.join(' · ')
}

// ── Reply composer ─────────────────────────────────────────────

const replyOpen = ref(false)
const replyBody = ref('')
const replySending = ref(false)
const replyError = ref<string | null>(null)
const replyEditor = ref<{ focus: () => void } | null>(null)

function openReply() {
  if (!canManageTeam.value) return
  replyOpen.value = true
  replyBody.value = ''
  replyError.value = null
  void nextTick(() => replyEditor.value?.focus())
}

function cancelReply() {
  if (replyBody.value.trim() && !window.confirm('Discard this reply?')) return
  replyOpen.value = false
  replyBody.value = ''
}

async function sendReply() {
  if (!replyBody.value.trim() || replySending.value) return
  replySending.value = true
  replyError.value = null
  const anchor = anchorId.value
  if (anchor == null) return
  try {
    const res = await communicationsApi.replyToCommunication(props.clubId, anchor, {
      body_html: replyBody.value,
    })
    toast.success('Reply sent.')
    // Brief 101 §4.3: wait for 201, then append the server row. We don't
    // optimistically render — the server is authoritative on message_id,
    // provider_message_id, and timestamps.
    const newRow: ThreadMessage = {
      communication_id: res.communication_id,
      direction: 'outbound',
      channel: 'email',
      subject: `Re: ${subject.value}`,
      body: null,
      body_html: replyBody.value,
      message_id: res.message_id,
      in_reply_to: null,
      parent_communication_id: res.parent_communication_id,
      from_name: null,
      from_email: null,
      sent_by: null,
      sent_by_name: 'You',
      user_id: res.recipient_user_id,
      sent_at: new Date().toISOString(),
      received_at: null,
      status: 'sent',
    }
    messages.value = [...messages.value, newRow]
    replyBody.value = ''
    replyOpen.value = false
  } catch (err) {
    const code = err instanceof ApiError ? (err.code as ReplyErrorCode | undefined) : undefined
    if (code === 'no_recipient') {
      replyError.value = "This sender has no reply address on file."
    } else if (code === 'send_failed') {
      replyError.value = "Couldn't send — try again in a moment."
    } else if (code === 'forbidden') {
      replyError.value = 'Only admins can send replies.'
    } else {
      replyError.value = err instanceof ApiError ? err.message : 'Could not send the reply.'
    }
  } finally {
    replySending.value = false
  }
}

function isAnchor(m: ThreadMessage): boolean {
  return m.communication_id === anchorId.value
}

// ── Body rendering ─────────────────────────────────────────────
//
// Inbound replies arrive with both `body` (plain, Gmail's `> On Thu…`
// style quote markers and `[image: …]` placeholders) and `body_html`
// (the actual message as rendered in Gmail, with inline images and a
// proper `<blockquote>` for the quoted history). We prefer the HTML
// so admins see the email the way the sender wrote it, and fall back
// to the plain-text (pre-wrap) only when the row has no HTML at all.
//
// Backend sanitises HTML on ingest (brief 102 §297) so scripts and
// dangerous attrs are already gone by the time we render. We still
// strip `<style>` / `<script>` tags defensively here so an inbound
// mailer's stylesheet can't leak into the CRM chrome.

type BodyRender =
  | { kind: 'html'; main: string; quoted: string | null }
  | { kind: 'text'; text: string }
  | { kind: 'empty' }

/** Collapsed-quote state is per-message — click "Show quoted history"
 *  to expand a specific message's blockquote. Keyed by communication_id. */
const expandedQuotes = ref<Set<number>>(new Set())
function toggleQuote(id: number) {
  const next = new Set(expandedQuotes.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedQuotes.value = next
}

const STYLE_SCRIPT_RE = /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi

/** Pull the Gmail-style quoted history (`<blockquote type="cite">` and
 *  the `gmail_quote` / `gmail_attr` divs most clients use) off the end
 *  of an HTML body so we can render it collapsed. Returns `[main, quoted]`
 *  where `quoted` is null when nothing matched. */
function splitQuotedHistory(html: string): [string, string | null] {
  // Gmail's quoted-reply wrapper(s). Order matters: match the attr + quote
  // together so we don't leave a dangling attribution line in `main`.
  const markers = [
    /<div[^>]*class="[^"]*gmail_quote[^"]*"[\s\S]*$/i,
    /<blockquote[^>]*(?:class="gmail_quote"|type="cite")[\s\S]*$/i,
  ]
  for (const re of markers) {
    const match = html.match(re)
    if (match && typeof match.index === 'number') {
      return [html.slice(0, match.index), html.slice(match.index)]
    }
  }
  return [html, null]
}

const bodyCache = new Map<number, BodyRender>()
function bodyFor(m: ThreadMessage): BodyRender {
  const cached = bodyCache.get(m.communication_id)
  if (cached) return cached
  const html = m.body_html?.trim() || ''
  let render: BodyRender
  if (html) {
    const cleaned = html.replace(STYLE_SCRIPT_RE, '')
    const [main, quoted] = splitQuotedHistory(cleaned)
    render = { kind: 'html', main, quoted }
  } else {
    const text = m.body?.trim() || ''
    render = text ? { kind: 'text', text } : { kind: 'empty' }
  }
  bodyCache.set(m.communication_id, render)
  return render
}
function bodyHtmlMain(m: ThreadMessage): string {
  const b = bodyFor(m)
  return b.kind === 'html' ? b.main : ''
}
function bodyHtmlQuoted(m: ThreadMessage): string | null {
  const b = bodyFor(m)
  return b.kind === 'html' ? b.quoted : null
}
function bodyText(m: ThreadMessage): string {
  const b = bodyFor(m)
  return b.kind === 'text' ? b.text : ''
}
function bodyKind(m: ThreadMessage): BodyRender['kind'] {
  return bodyFor(m).kind
}
</script>

<template>
  <section class="thread">
    <!-- Thread head: back nav, subject, participants, controls ─── -->
    <header class="thread__head">
      <button type="button" class="thread__back" @click="emit('close')">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span>All communications</span>
      </button>
      <div class="thread__title-row">
        <div class="thread__title-text">
          <h2 class="thread__subject">{{ subject }}</h2>
          <div class="thread__meta">
            <span>{{ messages.length }} message{{ messages.length === 1 ? '' : 's' }}</span>
            <template v-if="participants">
              <span class="thread__meta-dot">·</span>
              <span>{{ participants }}</span>
            </template>
            <span class="thread__meta-dot">·</span>
            <span class="thread__chip thread__chip--inbox">Inbox</span>
          </div>
        </div>
        <div class="thread__actions">
          <button type="button" class="thread__icon-btn" aria-label="Star thread">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 2l1.9 4 4.1.5-3 3 .8 4.3L8 11.7 4.2 13.8 5 9.5l-3-3L6.1 6z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
            </svg>
          </button>
          <button type="button" class="thread__icon-btn" aria-label="Archive thread">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="3" width="12" height="11" rx="1.4" stroke="currentColor" stroke-width="1.4" />
              <path d="M6 6v5M10 6v5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
            </svg>
          </button>
          <button type="button" class="thread__icon-btn" aria-label="More">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="3" cy="8" r="1.1" fill="currentColor" />
              <circle cx="8" cy="8" r="1.1" fill="currentColor" />
              <circle cx="13" cy="8" r="1.1" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>
    </header>

    <!-- Loading / error ─────────────────────────────────────────── -->
    <div v-if="loading" class="thread__state">
      <CrmSpinner size="sm" label="Loading thread" />
      <span>Loading conversation…</span>
    </div>
    <div v-else-if="error" class="thread__state thread__state--error">{{ error }}</div>

    <!-- Message stack — newest at top, older below. ────────────── -->
    <div v-else class="thread__stack">
      <article
        v-for="m in messagesSorted"
        :key="m.communication_id"
        class="msg"
        :class="{ 'msg--anchor': isAnchor(m) }"
      >
        <header class="msg__head">
          <span
            class="msg__avatar"
            :class="m.direction === 'inbound' ? 'msg__avatar--inbound' : 'msg__avatar--outbound'"
          >{{ senderInitials(m) }}</span>
          <div class="msg__sender">
            <div class="msg__sender-line">
              <span class="msg__name">{{ senderName(m) }}</span>
              <span v-if="m.direction === 'inbound' && m.from_email" class="msg__email">&lt;{{ m.from_email }}&gt;</span>
              <span
                v-if="m.direction === 'inbound' && m.user_id"
                class="msg__chip msg__chip--matched"
              >
                <svg width="8" height="8" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M2 8l4 4 8-8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <span>Matched</span>
              </span>
              <span v-else-if="m.direction === 'outbound'" class="msg__chip msg__chip--muted">You</span>
            </div>
            <div class="msg__to">{{ toLine(m) }}</div>
          </div>
          <div class="msg__time">
            <template v-if="timestampFor(m).isToday">Today</template>
            <template v-else>{{ timestampFor(m).day }}</template>
            <span>·</span>
            <span>{{ timestampFor(m).time }}</span>
          </div>
        </header>
        <!-- Body: prefer sanitised HTML (inline images, blockquotes,
             etc.). Gmail's quoted history (`gmail_quote` / `type="cite"`)
             collapses behind a toggle so the latest reply is the thing
             you see first. Plain-text fallback only when there's no HTML. -->
        <div class="msg__body">
          <template v-if="bodyKind(m) === 'html'">
            <div class="msg__body-html" v-html="bodyHtmlMain(m)" />
            <template v-if="bodyHtmlQuoted(m)">
              <button
                type="button"
                class="msg__quote-toggle"
                @click="toggleQuote(m.communication_id)"
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path v-if="!expandedQuotes.has(m.communication_id)" d="M4 8h8M8 4v8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                  <path v-else d="M4 8h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                </svg>
                <span>{{ expandedQuotes.has(m.communication_id) ? 'Hide quoted history' : 'Show quoted history' }}</span>
              </button>
              <div
                v-if="expandedQuotes.has(m.communication_id)"
                class="msg__body-html msg__body-html--quoted"
                v-html="bodyHtmlQuoted(m) ?? ''"
              />
            </template>
          </template>
          <div v-else-if="bodyKind(m) === 'text'" class="msg__body-text">{{ bodyText(m) }}</div>
          <div v-else class="msg__body-empty">(empty message)</div>
        </div>
      </article>
    </div>

    <!-- Reply dock ─────────────────────────────────────────────── -->
    <div v-if="!loading && !error && canManageTeam && !replyOpen" class="thread__reply-prompt">
      <button type="button" class="thread__reply-cta" @click="openReply">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M7 4L3 8l4 4M3 8h7a3 3 0 013 3v1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span>Reply</span>
      </button>
    </div>

    <div v-if="replyOpen" class="thread__dock">
      <div class="thread__dock-head">
        <div class="thread__dock-head-left">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M7 4L3 8l4 4M3 8h7a3 3 0 013 3v1" stroke="var(--color-ink)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span class="thread__dock-label">Reply</span>
        </div>
        <button type="button" class="thread__link" @click="cancelReply">Cancel</button>
      </div>

      <div class="thread__dock-editor">
        <RichTextEditor
          ref="replyEditor"
          v-model="replyBody"
          size="sm"
          placeholder="Write your reply…"
          hide-image
        />
      </div>

      <div v-if="replyError" class="thread__dock-error">{{ replyError }}</div>

      <div class="thread__dock-foot">
        <span class="thread__dock-hint">Replies go to the sender and thread automatically in their inbox.</span>
        <button
          type="button"
          class="thread__send"
          :disabled="replySending || !replyBody.trim()"
          @click="sendReply"
        >
          <span>{{ replySending ? 'Sending…' : 'Send reply' }}</span>
          <svg v-if="!replySending" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.thread { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

/* ── Head ────────────────────────────────────────────────────── */
.thread__head { display: flex; flex-direction: column; gap: 10px; }
.thread__back {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: 0;
  background: transparent;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 500;
  color: var(--color-fog);
  cursor: pointer;
  width: fit-content;
}
.thread__back:hover { color: var(--color-ink); }
.thread__title-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
}
.thread__title-text { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.thread__subject {
  margin: 0;
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--color-ink);
}
.thread__meta {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
}
.thread__meta-dot { color: var(--color-hairline); }
.thread__chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.thread__chip--inbox { background: var(--color-accent-soft, #DBEAFE); color: #1E40AF; }

.thread__actions { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; }
.thread__icon-btn {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  border: 1px solid var(--color-hairline);
  background: #fff;
  color: var(--color-fog);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease;
}
.thread__icon-btn:hover { border-color: var(--color-ink); color: var(--color-ink); }

/* ── Loading / error ────────────────────────────────────────── */
.thread__state {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 24px 0;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-fog);
}
.thread__state--error { color: var(--color-danger); }

/* ── Message stack ──────────────────────────────────────────── */
.thread__stack { display: flex; flex-direction: column; gap: 14px; }

.msg {
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  overflow: hidden;
}
.msg--anchor {
  border-color: var(--color-ink);
  box-shadow: 0 4px 16px -10px rgba(0, 0, 0, 0.15);
}

.msg__head {
  display: grid;
  grid-template-columns: 40px 1fr auto;
  gap: 16px;
  align-items: flex-start;
  padding: 20px 24px 10px;
}
.msg__avatar {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}
.msg__avatar--outbound { background: var(--color-ink); color: #fff; }
.msg__avatar--inbound { background: var(--color-accent-soft, #DBEAFE); color: #1E40AF; }

.msg__sender { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.msg__sender-line {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.msg__name {
  font-family: var(--font-body);
  font-size: 15px;
  font-weight: 600;
  color: var(--color-ink);
}
.msg__email {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-fog);
}
.msg__to {
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
}
.msg__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
}
.msg__chip--matched { background: #DCFCE7; color: #166534; }
.msg__chip--muted { background: var(--color-surface); color: var(--color-fog); }

.msg__time {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-fog);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.msg__body {
  padding: 6px 24px 24px 80px;
}
.msg__body-text {
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 1.65;
  color: var(--color-ink);
  white-space: pre-wrap;
}
.msg__body-html {
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 1.65;
  color: var(--color-ink);
  /* Scope to prevent inbound inline styles from spilling onto page chrome. */
  contain: content;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
.msg__body-html :deep(p) { margin: 0 0 14px; font-size: 15px; line-height: 1.65; color: var(--color-ink); }
.msg__body-html :deep(p:last-child) { margin-bottom: 0; }
.msg__body-html :deep(a) { color: var(--color-accent, #2563eb); word-break: break-word; }
.msg__body-html :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  display: inline-block;
}
.msg__body-html :deep(h1),
.msg__body-html :deep(h2),
.msg__body-html :deep(h3) {
  font-family: var(--font-display);
  margin: 18px 0 8px;
  color: var(--color-ink);
}
.msg__body-html :deep(ul),
.msg__body-html :deep(ol) { padding-left: 22px; margin: 0 0 14px; }
.msg__body-html :deep(li) { margin: 2px 0; }
.msg__body-html :deep(hr) {
  border: 0;
  border-top: 1px solid var(--color-hairline);
  margin: 18px 0;
}
.msg__body-html :deep(blockquote) {
  margin: 0 0 14px;
  padding: 2px 0 2px 14px;
  border-left: 3px solid var(--color-hairline);
  color: var(--color-fog);
}
.msg__body-html :deep(table) {
  max-width: 100%;
  border-collapse: collapse;
}
.msg__body-html :deep(pre),
.msg__body-html :deep(code) {
  white-space: pre-wrap;
  font-family: var(--font-mono);
  font-size: 13px;
  background: var(--color-surface);
  padding: 1px 4px;
  border-radius: 4px;
}

/* Quoted-history toggle sits inline between the main body and the
 * collapsed (or expanded) `<blockquote>` with the prior message. */
.msg__quote-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0 0;
  padding: 4px 10px;
  border: 1px solid var(--color-hairline);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-fog);
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.msg__quote-toggle:hover { color: var(--color-ink); border-color: var(--color-ink); }

.msg__body-html--quoted {
  margin-top: 12px;
  padding: 10px 0 2px 14px;
  border-left: 3px solid var(--color-hairline);
  color: var(--color-fog);
  font-size: 13px;
}
.msg__body-html--quoted :deep(p) { font-size: 13px; color: var(--color-fog); margin: 0 0 8px; }
.msg__body-html--quoted :deep(a) { color: var(--color-mute); }

.msg__body-empty {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-fog);
  font-style: italic;
}

/* ── Reply prompt (collapsed state) ─────────────────────────── */
.thread__reply-prompt {
  display: flex;
  justify-content: flex-start;
  padding: 4px 0 0;
}
.thread__reply-cta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 999px;
  border: 1px solid var(--color-hairline);
  background: #fff;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-ink);
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
}
.thread__reply-cta:hover {
  border-color: var(--color-ink);
  background: var(--color-surface);
  transform: translateY(-1px);
}

/* ── Reply dock (expanded) ──────────────────────────────────── */
.thread__dock {
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  overflow: hidden;
}
.thread__dock-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-hairline);
}
.thread__dock-head-left { display: inline-flex; align-items: center; gap: 10px; }
.thread__dock-label {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-ink);
}
.thread__link {
  padding: 0;
  border: 0;
  background: transparent;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-fog);
  cursor: pointer;
}
.thread__link:hover { color: var(--color-ink); text-decoration: underline; }

.thread__dock-editor { padding: 2px 4px; }
.thread__dock-error {
  color: var(--color-danger);
  font-family: var(--font-body);
  font-size: 12px;
  padding: 8px 20px 0;
}
.thread__dock-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 20px;
  border-top: 1px solid var(--color-hairline);
}
.thread__dock-hint {
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--color-fog);
}
.thread__send {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 999px;
  border: 0;
  background: var(--color-ink);
  color: #fff;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 120ms ease, transform 120ms ease;
}
.thread__send:hover:not(:disabled) { background: var(--color-graphite); transform: translateY(-1px); }
.thread__send:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
