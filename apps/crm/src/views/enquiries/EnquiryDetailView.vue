<script setup lang="ts">
/**
 * Enquiry detail — full page (mirrors ApplicationDetailView). Left
 * column reads the full message + reply thread + notes. Right rail
 * holds the status hero, the reply form, and archive/unarchive actions.
 *
 * Backend brief 41 §4: GETting a `new` row auto-flips it to `read`
 * server-side — we don't need to POST /read on open.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { useClubStore } from '@/stores/club'
import {
  enquiries as enquiriesApi,
  ApiError,
  type EnquiryDetail,
  type EnquiryStatus,
  type EnquiryTopic,
} from '@torny/api-client'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const clubStore = useClubStore()

const enquiryId = computed(() => Number(route.params.id))
const detail = ref<EnquiryDetail | null>(null)
const loading = ref(true)
const notFound = ref(false)

async function loadDetail() {
  const cid = clubStore.current?.id
  const id = enquiryId.value
  if (typeof cid !== 'number' || Number.isNaN(id)) {
    loading.value = false
    notFound.value = true
    return
  }
  loading.value = true
  notFound.value = false
  try {
    detail.value = await enquiriesApi.get(cid, id)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound.value = true
    } else {
      toast.error(err instanceof ApiError ? err.message : 'Could not load enquiry.')
      notFound.value = true
    }
    detail.value = null
  } finally {
    loading.value = false
  }
}

onMounted(loadDetail)
watch(() => enquiryId.value, loadDetail)
watch(() => clubStore.current?.id, loadDetail)

// ── Formatting helpers ────────────────────────────────────────
const statusTone: Record<EnquiryStatus, 'ok' | 'warn' | 'ink' | 'mute'> = {
  new: 'warn',
  read: 'ink',
  replied: 'ok',
  archived: 'mute',
}
const statusLabel: Record<EnquiryStatus, string> = {
  new: 'New',
  read: 'Read',
  replied: 'Replied',
  archived: 'Archived',
}
const topicLabel: Record<EnquiryTopic, string> = {
  membership: 'Membership',
  events: 'Events & roll-ups',
  facilities: 'Facilities hire',
  general: 'General enquiry',
  media: 'Media',
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const a = parts[0]?.[0] ?? ''
  const b = parts.length > 1 ? parts[parts.length - 1]![0] : ''
  return `${a}${b}`.toUpperCase()
}
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const diff = Date.now() - then
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`
  if (day < 28) { const wk = Math.floor(day / 7); return `${wk} week${wk === 1 ? '' : 's'} ago` }
  return new Date(iso).toLocaleDateString()
}
function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// ── Reply form ────────────────────────────────────────────────
const replyBody = ref('')
const replySubject = ref('')
const replying = ref(false)
const REPLY_MAX = 10000

const replyOverLimit = computed(() => replyBody.value.length > REPLY_MAX)
const defaultSubject = computed(() =>
  detail.value ? `Re: ${topicLabel[detail.value.topic] ?? 'your enquiry'}` : '',
)

async function submitReply() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || !detail.value) return
  const body = replyBody.value.trim()
  if (!body) return
  if (replyOverLimit.value) {
    toast.error('Reply is over 10,000 characters — trim it a little.')
    return
  }
  replying.value = true
  try {
    const res = await enquiriesApi.reply(cid, detail.value.id, {
      body,
      subject: replySubject.value.trim() || undefined,
    })
    // Server already sent the email (or tried). Refresh the row so the
    // reply thread + status pill update in place.
    await loadDetail()
    replyBody.value = ''
    replySubject.value = ''
    if ('sent' in res.email_status && res.email_status.sent) toast.success('Reply sent.')
    else toast.info('Reply saved — email delivery failed. Retry from the thread.')
  } catch (err) {
    toast.error(replyErrorMessage(err))
  } finally {
    replying.value = false
  }
}

function replyErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Could not send reply — try again.'
  const body = (err.body ?? {}) as { code?: string }
  switch (body.code) {
    case 'already_archived': return 'This enquiry is archived — unarchive it first.'
    case 'missing_body': return 'Write a message before sending.'
    case 'body_too_long': return 'Reply is over the 10,000 character limit.'
    default: return err.message || 'Could not send reply.'
  }
}

// ── Notes thread ──────────────────────────────────────────────
const noteBody = ref('')
const addingNote = ref(false)

async function submitNote() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || !detail.value) return
  const body = noteBody.value.trim()
  if (!body) return
  addingNote.value = true
  try {
    const note = await enquiriesApi.addNote(cid, detail.value.id, body)
    detail.value.notes = [note, ...detail.value.notes]
    noteBody.value = ''
    toast.success('Note added.')
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not add note.')
  } finally {
    addingNote.value = false
  }
}

// ── Archive / unarchive ───────────────────────────────────────
const archiving = ref(false)

async function toggleArchive() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || !detail.value) return
  const currentlyArchived = detail.value.status === 'archived'
  archiving.value = true
  try {
    await enquiriesApi.archive(cid, detail.value.id, currentlyArchived ? { unarchive: true } : {})
    toast.success(currentlyArchived ? 'Unarchived.' : 'Archived.')
    if (currentlyArchived) {
      await loadDetail()
    } else {
      router.push('/crm/enquiries')
    }
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not update.')
  } finally {
    archiving.value = false
  }
}
</script>

<template>
  <div class="page">
    <!-- Header + back link -->
    <header class="page__head">
      <router-link to="/crm/enquiries" class="back">
        <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 5l-5 5 5 5" />
        </svg>
        <span>All enquiries</span>
      </router-link>
      <div v-if="detail" class="page__title-row">
        <h1 class="page__title">{{ detail.full_name }}</h1>
        <span class="pill" :class="`pill--${statusTone[detail.status]}`">{{ statusLabel[detail.status] }}</span>
        <span class="pill pill--topic">{{ topicLabel[detail.topic] }}</span>
      </div>
      <p v-if="detail" class="page__sub">
        Sent {{ timeAgo(detail.received_at) }} · {{ formatDateTime(detail.received_at) }}
      </p>
    </header>

    <div v-if="loading" class="empty">
      <div class="empty__title">Loading…</div>
    </div>
    <div v-else-if="notFound" class="empty">
      <div class="empty__title">Enquiry not found</div>
      <div class="empty__hint">It may have been deleted or belongs to a different club.</div>
      <router-link to="/crm/enquiries" class="back back--emphasis">Back to enquiries</router-link>
    </div>

    <div v-else-if="detail" class="page__body">
      <!-- Left — message + thread -->
      <div class="left">
        <section class="message-card">
          <div class="message-card__eyebrow">
            <span class="message-card__dot" />
            <span>MESSAGE</span>
          </div>
          <div class="message-card__body">{{ detail.message }}</div>
          <div class="message-card__foot">
            <div class="dl">
              <div class="dl__row"><dt>From</dt><dd>{{ detail.full_name }}</dd></div>
              <div class="dl__row"><dt>Email</dt><dd><a class="link" :href="`mailto:${detail.email}`">{{ detail.email }}</a></dd></div>
              <div v-if="detail.phone" class="dl__row"><dt>Phone</dt><dd><a class="link" :href="`tel:${detail.phone.replace(/\s+/g, '')}`">{{ detail.phone }}</a></dd></div>
              <div class="dl__row"><dt>Topic</dt><dd>{{ topicLabel[detail.topic] }}</dd></div>
              <div class="dl__row"><dt>Reply OK</dt><dd>{{ detail.consent_reply ? 'Yes' : 'No consent given' }}</dd></div>
            </div>
          </div>
        </section>

        <!-- Reply thread -->
        <section v-if="detail.replies.length > 0" class="thread">
          <div class="thread__head">
            <h3 class="thread__title">Reply thread</h3>
            <span class="thread__count">{{ detail.replies.length }}</span>
          </div>
          <ul class="thread__list">
            <li v-for="r in detail.replies" :key="r.id" class="thread__reply">
              <div class="thread__reply-head">
                <span class="thread__author">{{ r.author_name ?? 'CRM' }}</span>
                <span class="thread__time">{{ timeAgo(r.sent_at) }}</span>
                <span
                  v-if="r.email_status === 'failed'"
                  class="thread__delivery thread__delivery--failed"
                >Delivery failed</span>
              </div>
              <div class="thread__body">{{ r.body }}</div>
            </li>
          </ul>
        </section>
      </div>

      <!-- Right rail -->
      <aside class="rail">
        <div class="rail__status" :class="`rail__status--${statusTone[detail.status]}`">
          <div class="rail__avatar">{{ initials(detail.full_name) }}</div>
          <div class="rail__eyebrow">STATUS</div>
          <div class="rail__status-name">{{ statusLabel[detail.status] }}</div>
          <div v-if="detail.responded_at" class="rail__status-meta">Replied {{ timeAgo(detail.responded_at) }}</div>
          <div v-else-if="detail.status === 'archived'" class="rail__status-meta">Archived — no reply sent</div>
          <div v-else class="rail__status-meta">Awaiting reply</div>
        </div>

        <!-- Reply form -->
        <div v-if="detail.status !== 'archived'" class="rail__section">
          <div class="rail__section-head">
            <h3 class="rail__section-title">Reply</h3>
          </div>
          <p class="rail__hint">Sends from your club address. Replies land in the club's inbox, not the CRM.</p>
          <form class="reply-form" @submit.prevent="submitReply">
            <label class="field">
              <span>Subject <em>(optional)</em></span>
              <input v-model="replySubject" type="text" :placeholder="defaultSubject" />
            </label>
            <label class="field">
              <div class="field__head">
                <span>Message</span>
                <span
                  class="field__counter"
                  :class="{ 'field__counter--over': replyOverLimit }"
                >{{ replyBody.length }} / {{ REPLY_MAX }}</span>
              </div>
              <textarea v-model="replyBody" rows="6" placeholder="Write your reply…" required></textarea>
            </label>
            <button type="submit" class="rail-btn rail-btn--approve" :disabled="!replyBody.trim() || replyOverLimit || replying">
              {{ replying ? 'Sending…' : 'Send reply' }}
            </button>
          </form>
        </div>

        <!-- Archive / unarchive -->
        <button
          type="button"
          class="rail-btn"
          :class="detail.status === 'archived' ? 'rail-btn--outline' : 'rail-btn--reject'"
          :disabled="archiving"
          @click="toggleArchive"
        >
          {{ archiving ? '…' : detail.status === 'archived' ? 'Unarchive' : 'Archive' }}
        </button>

        <!-- Notes -->
        <div class="rail__notes">
          <div class="rail__notes-head">
            <h3 class="rail__notes-title">Internal notes</h3>
            <span class="rail__notes-count">{{ detail.notes.length }}</span>
          </div>
          <p class="rail__hint">Only the CRM sees these. Never emailed.</p>
          <form class="note-form" @submit.prevent="submitNote">
            <textarea
              v-model="noteBody"
              rows="2"
              placeholder="Add an internal note…"
              :disabled="addingNote"
            />
            <button type="submit" class="rail-btn rail-btn--approve rail-btn--sm" :disabled="!noteBody.trim() || addingNote">
              {{ addingNote ? 'Adding…' : 'Add note' }}
            </button>
          </form>
          <ul v-if="detail.notes.length" class="notes">
            <li v-for="n in detail.notes" :key="n.id" class="note">
              <div class="note__head">
                <span class="note__author">{{ n.author_name ?? 'CRM' }}</span>
                <span class="note__time">{{ timeAgo(n.created_at) }}</span>
              </div>
              <div class="note__body">{{ n.body }}</div>
            </li>
          </ul>
          <div v-else class="rail__notes-empty">No notes yet.</div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.page { max-width: 1280px; display: flex; flex-direction: column; gap: 32px; }

/* Header — matches the list page style so nav feels consistent. */
.page__head { display: flex; flex-direction: column; gap: 0; }
.back { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-fog); text-decoration: none; width: fit-content; }
.back:hover { color: var(--color-ink); }
.back--emphasis { color: var(--color-accent); margin-top: 16px; font-weight: 600; letter-spacing: normal; text-transform: none; font-size: 13px; }
.page__title-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 4px 0 6px; }
.page__title { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: 0; line-height: 1.05; }
.page__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin: 0; }

/* Empty */
.empty { padding: 96px 40px; text-align: center; font-family: var(--font-body); background: #fff; border: 1px dashed var(--color-hairline); border-radius: 14px; }
.empty__title { font-family: var(--font-display); font-size: 24px; font-weight: 700; color: var(--color-ink); }
.empty__hint { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin-top: 6px; }

/* Layout */
.page__body { display: grid; grid-template-columns: 1fr 340px; gap: 48px; align-items: flex-start; }
.left { display: flex; flex-direction: column; gap: 32px; min-width: 0; }

/* Message card */
.message-card { display: flex; flex-direction: column; gap: 16px; padding: 32px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }
.message-card__eyebrow { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; }
.message-card__dot { width: 6px; height: 6px; border-radius: 999px; background: var(--color-accent); }
.message-card__body { font-family: var(--font-body); font-size: 17px; line-height: 155%; color: var(--color-ink); white-space: pre-wrap; }
.message-card__foot { padding-top: 20px; border-top: 1px solid var(--color-hairline); }

/* Definition list */
.dl { display: flex; flex-direction: column; margin: 0; }
.dl__row { display: grid; grid-template-columns: 100px 1fr; gap: 16px; padding: 8px 0; align-items: baseline; }
.dl dt { font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); margin: 0; }
.dl dd { font-family: var(--font-body); font-size: 14px; color: var(--color-ink); margin: 0; word-break: break-word; }
.link { color: var(--color-accent); text-decoration: none; }
.link:hover { text-decoration: underline; }

/* Thread */
.thread { display: flex; flex-direction: column; gap: 16px; padding: 24px 28px; background: var(--color-surface); border-radius: 14px; }
.thread__head { display: flex; align-items: baseline; gap: 10px; }
.thread__title { font-family: var(--font-display); font-size: 18px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); margin: 0; }
.thread__count { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; color: var(--color-fog); padding: 2px 8px; border-radius: 999px; background: #fff; }
.thread__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
.thread__reply { padding: 16px 18px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; }
.thread__reply-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.thread__author { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.thread__time { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.thread__delivery { margin-left: auto; padding: 2px 8px; border-radius: 999px; font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.thread__delivery--failed { background: #FEE2E2; color: #991B1B; }
.thread__body { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); line-height: 1.5; white-space: pre-wrap; }

/* Right rail */
.rail { position: sticky; top: 32px; display: flex; flex-direction: column; gap: 20px; }
.rail__status { position: relative; display: flex; flex-direction: column; gap: 8px; padding: 24px 24px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; overflow: hidden; }
.rail__status::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--color-graphite); }
.rail__status--ok::before { background: #16A34A; }
.rail__status--warn::before { background: var(--color-accent); }
.rail__status--ink::before { background: var(--color-ink); }
.rail__status--mute::before { background: var(--color-mute); }
.rail__avatar { width: 56px; height: 56px; border-radius: 999px; background: var(--color-ink); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 20px; font-weight: 700; margin-bottom: 4px; }
.rail__eyebrow { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.rail__status-name { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--color-ink); letter-spacing: -0.01em; }
.rail__status-meta { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); }

/* Rail sections */
.rail__section { display: flex; flex-direction: column; gap: 12px; padding: 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }
.rail__section-head { display: flex; align-items: baseline; gap: 10px; }
.rail__section-title { font-family: var(--font-display); font-size: 16px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); margin: 0; }
.rail__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin: 0; line-height: 1.5; }

/* Reply form */
.reply-form { display: flex; flex-direction: column; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field__head { display: flex; align-items: baseline; justify-content: space-between; }
.field > span, .field__head > span:first-child { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.field em { font-style: normal; color: var(--color-mute); font-weight: 400; }
.field__counter { font-family: var(--font-mono); font-size: 11px; color: var(--color-mute); }
.field__counter--over { color: var(--color-danger); }
.field input, .field textarea { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; resize: vertical; }
.field textarea { min-height: 96px; line-height: 1.5; }
.field input:focus, .field textarea:focus { outline: none; border-color: var(--color-ink); }

.rail-btn { padding: 12px 16px; border-radius: 10px; font-family: var(--font-body); font-size: 14px; font-weight: 600; cursor: pointer; border: 0; transition: background 120ms, color 120ms, border-color 120ms; }
.rail-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.rail-btn--sm { padding: 8px 12px; font-size: 13px; }
.rail-btn--approve { background: var(--color-ink); color: #fff; }
.rail-btn--approve:hover:not(:disabled) { background: var(--color-graphite); }
.rail-btn--reject { background: transparent; color: var(--color-graphite); border: 1px solid var(--color-hairline); }
.rail-btn--reject:hover:not(:disabled) { border-color: var(--color-ink); background: var(--color-surface); }
.rail-btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.rail-btn--outline:hover:not(:disabled) { background: var(--color-surface); }

/* Notes */
.rail__notes { display: flex; flex-direction: column; gap: 12px; padding: 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }
.rail__notes-head { display: flex; align-items: baseline; gap: 10px; }
.rail__notes-title { font-family: var(--font-display); font-size: 16px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); margin: 0; }
.rail__notes-count { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; color: var(--color-fog); padding: 2px 8px; border-radius: 999px; background: var(--color-surface); }
.rail__notes-empty { padding: 16px; text-align: center; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); background: var(--color-surface); border-radius: 10px; }
.note-form { display: flex; flex-direction: column; gap: 8px; }
.note-form textarea { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; resize: vertical; min-height: 68px; }
.note-form textarea:focus { outline: none; border-color: var(--color-ink); }
.notes { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.note { padding: 12px 14px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 10px; }
.note__head { display: flex; gap: 8px; align-items: baseline; }
.note__author { font-family: var(--font-body); font-size: 12px; font-weight: 600; color: var(--color-ink); }
.note__time { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }
.note__body { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); line-height: 1.5; margin-top: 6px; }

/* Pills */
.pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.pill--ok { background: #DCFCE7; color: #14532D; }
.pill--warn { background: var(--color-accent-soft); color: var(--color-accent); }
.pill--ink { background: var(--color-ink); color: #fff; }
.pill--mute { background: var(--color-surface); color: var(--color-fog); border: 1px solid var(--color-hairline); }
.pill--topic { background: var(--color-surface); color: var(--color-graphite); border: 1px solid var(--color-hairline); text-transform: none; letter-spacing: normal; font-weight: 500; }

/* Responsive */
@media (max-width: 1023px) {
  .page__body { grid-template-columns: 1fr; gap: 32px; }
  .rail { position: static; }
}
</style>
