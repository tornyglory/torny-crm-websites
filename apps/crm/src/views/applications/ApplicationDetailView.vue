<script setup lang="ts">
/**
 * Application detail — full page (converted from the old modal). Left
 * column reads like the join form the applicant filled in: six numbered
 * sections in the same order. Right rail carries the status hero,
 * approve / reject actions when pending, and the internal-notes thread.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CrmModal from '@/components/modals/CrmModal.vue'
import { useToast } from '@/composables/useToast'
import { useClubStore } from '@/stores/club'
import {
  applications as applicationsApi,
  ApiError,
  type ApplicationDetail,
  type ApplicationStatus,
  type RejectReason,
  type Resolution,
} from '@torny/api-client'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const clubStore = useClubStore()

const applicationId = computed(() => Number(route.params.id))
const detail = ref<ApplicationDetail | null>(null)
const loading = ref(true)
const notFound = ref(false)

async function loadDetail() {
  const cid = clubStore.current?.id
  const id = applicationId.value
  if (typeof cid !== 'number' || Number.isNaN(id)) {
    loading.value = false
    notFound.value = true
    return
  }
  loading.value = true
  notFound.value = false
  try {
    detail.value = await applicationsApi.get(cid, id)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound.value = true
    } else {
      toast.error(err instanceof ApiError ? err.message : 'Could not load application.')
      notFound.value = true
    }
    detail.value = null
  } finally {
    loading.value = false
  }
}

onMounted(loadDetail)
watch(() => applicationId.value, loadDetail)
watch(() => clubStore.current?.id, loadDetail)

// ── Formatting helpers ────────────────────────────────────────
const statusTone: Record<ApplicationStatus, 'ok' | 'warn' | 'danger'> = {
  pending: 'warn', approved: 'ok', rejected: 'danger',
}
const statusLabel: Record<ApplicationStatus, string> = {
  pending: 'Pending', approved: 'Approved', rejected: 'Rejected',
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
function formatDob(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}
const DAY_LABELS: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }
function formatDays(days: string[] | null | undefined): string {
  if (!days || days.length === 0) return '—'
  return days.map((d) => DAY_LABELS[d] ?? d).join(', ')
}

// ── Note thread ───────────────────────────────────────────────
const noteBody = ref('')
const addingNote = ref(false)

async function submitNote() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || !detail.value) return
  const body = noteBody.value.trim()
  if (!body) return
  addingNote.value = true
  try {
    const note = await applicationsApi.addNote(cid, detail.value.id, body)
    detail.value.notes = [note, ...detail.value.notes]
    noteBody.value = ''
    toast.success('Note added.')
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not add note.')
  } finally {
    addingNote.value = false
  }
}

// ── Approve modal ─────────────────────────────────────────────
const approveOpen = ref(false)
const approveSubmitting = ref(false)
const approveForm = ref<{ resolution: Resolution; assigned_number: string; send_welcome_email: boolean }>({
  resolution: 'auto',
  assigned_number: '',
  send_welcome_email: true,
})

function openApprove() {
  approveForm.value = { resolution: 'auto', assigned_number: '', send_welcome_email: true }
  approveOpen.value = true
}
async function submitApprove() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || !detail.value) return
  approveSubmitting.value = true
  try {
    const num = approveForm.value.assigned_number.trim()
    const parsedNum = num ? Number(num) : null
    if (num && (parsedNum == null || Number.isNaN(parsedNum))) {
      toast.error('Membership number needs to be a number, or leave it blank.')
      return
    }
    await applicationsApi.approve(cid, detail.value.id, {
      resolution: approveForm.value.resolution,
      assigned_number: parsedNum ?? null,
      send_welcome_email: approveForm.value.send_welcome_email,
    })
    toast.success(`Approved ${detail.value.full_name}.`)
    approveOpen.value = false
    router.push('/crm/applications')
  } catch (err) {
    toast.error(approveErrorMessage(err))
  } finally {
    approveSubmitting.value = false
  }
}
function approveErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Could not approve — try again.'
  const body = (err.body ?? {}) as { code?: string }
  switch (body.code) {
    case 'already_approved': return 'This application has already been approved.'
    case 'already_rejected': return 'This application was rejected earlier — reopen it first.'
    case 'email_exists': return 'That email is already a member — try linking rather than creating a stub.'
    case 'bad_link': return 'Choose a user to link this application to.'
    default: return err.message || 'Could not approve.'
  }
}

// ── Reject modal ──────────────────────────────────────────────
const rejectOpen = ref(false)
const rejectSubmitting = ref(false)
const rejectForm = ref<{ reason: RejectReason; message: string }>({ reason: 'unable_to_verify', message: '' })
const REJECT_REASONS: Array<{ value: RejectReason; label: string }> = [
  { value: 'unable_to_verify', label: "Couldn't verify details" },
  { value: 'duplicate', label: 'Duplicate application' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Other' },
]

function openReject() {
  rejectForm.value = { reason: 'unable_to_verify', message: '' }
  rejectOpen.value = true
}
function downloadPdf() {
  // Use the browser's native print dialog with print styles that hide
  // the rail + button chrome. Every browser offers "Save as PDF" from
  // there, so we get PDF export without adding a client-side lib.
  if (!detail.value) return
  const previousTitle = document.title
  document.title = `Application — ${detail.value.full_name}`
  window.print()
  // Restore the title after the dialog closes. Print is synchronous in
  // the render sense but browsers vary — schedule it back after a tick.
  setTimeout(() => { document.title = previousTitle }, 500)
}

async function submitReject() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || !detail.value) return
  rejectSubmitting.value = true
  try {
    await applicationsApi.reject(cid, detail.value.id, {
      reason: rejectForm.value.reason,
      message: rejectForm.value.message.trim() || undefined,
    })
    const emailNote = rejectForm.value.message.trim() ? ' — email sent' : ' — no email sent'
    toast.success(`Rejected ${detail.value.full_name}${emailNote}.`)
    rejectOpen.value = false
    router.push('/crm/applications')
  } catch (err) {
    const body = err instanceof ApiError ? ((err.body ?? {}) as { code?: string }) : {}
    if (body.code === 'already_approved') toast.error('This application was already approved.')
    else if (body.code === 'already_rejected') toast.error('This application has already been rejected.')
    else toast.error(err instanceof ApiError ? err.message : 'Could not reject.')
  } finally {
    rejectSubmitting.value = false
  }
}
</script>

<template>
  <div class="page">
    <!-- Header + back link -->
    <header class="page__head">
      <router-link to="/crm/applications" class="back">
        <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 5l-5 5 5 5" />
        </svg>
        <span>All applications</span>
      </router-link>
      <div v-if="detail" class="page__title-row">
        <h1 class="page__title">{{ detail.full_name }}</h1>
        <span class="pill" :class="`pill--${statusTone[detail.status]}`">{{ statusLabel[detail.status] }}</span>
        <button type="button" class="download-btn" @click="downloadPdf" aria-label="Download this application as PDF">
          <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 14v2.5A1.5 1.5 0 0 0 5.5 18h9a1.5 1.5 0 0 0 1.5-1.5V14" />
            <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5" />
          </svg>
          <span>Download PDF</span>
        </button>
      </div>
      <p v-if="detail" class="page__sub">
        Applied {{ timeAgo(detail.received_at) }} · {{ formatDateTime(detail.received_at) }}
      </p>
    </header>

    <!-- Loading + not-found states -->
    <div v-if="loading" class="empty">
      <div class="empty__title">Loading…</div>
    </div>
    <div v-else-if="notFound" class="empty">
      <div class="empty__title">Application not found</div>
      <div class="empty__hint">It may have been deleted or belongs to a different club.</div>
      <router-link to="/crm/applications" class="back back--emphasis">Back to applications</router-link>
    </div>

    <div v-else-if="detail" class="page__body">
      <!-- Left: numbered steps mirroring the join-form order -->
      <ol class="steps">
        <li class="step">
          <div class="step__body">
            <div class="step__head">
              <div class="step__eyebrow">STEP 01</div>
              <h2 class="step__title">Membership</h2>
              <p class="step__hint">The tier they chose and when they applied.</p>
            </div>
            <dl class="dl">
              <div class="dl__row"><dt>Tier</dt><dd>{{ detail.tier_name ?? 'No tier chosen' }}</dd></div>
              <div v-if="detail.preferred_name" class="dl__row"><dt>Prefers</dt><dd>{{ detail.preferred_name }}</dd></div>
              <div class="dl__row"><dt>Applied</dt><dd>{{ formatDateTime(detail.received_at) }}<span class="dl__muted"> · {{ timeAgo(detail.received_at) }}</span></dd></div>
              <div v-if="detail.status !== 'pending' && detail.reviewed_at" class="dl__row"><dt>Decided</dt><dd>{{ formatDateTime(detail.reviewed_at) }}</dd></div>
            </dl>
          </div>
        </li>

        <li class="step">
          <div class="step__body">
            <div class="step__head">
              <div class="step__eyebrow">STEP 02</div>
              <h2 class="step__title">About</h2>
              <p class="step__hint">Their contact details.</p>
            </div>
            <dl class="dl">
              <div class="dl__row"><dt>Full name</dt><dd>{{ detail.full_name }}</dd></div>
              <div class="dl__row"><dt>Date of birth</dt><dd>{{ formatDob(detail.dob) }}</dd></div>
              <div class="dl__row"><dt>Email</dt><dd><a class="link" :href="`mailto:${detail.email}`">{{ detail.email }}</a></dd></div>
              <div class="dl__row"><dt>Mobile</dt><dd><a class="link" :href="`tel:${detail.mobile.replace(/\s+/g, '')}`">{{ detail.mobile }}</a></dd></div>
            </dl>
          </div>
        </li>

        <li class="step">
          <div class="step__body">
            <div class="step__head">
              <div class="step__eyebrow">STEP 03</div>
              <h2 class="step__title">Home address</h2>
              <p class="step__hint">Where the club handbook + AGM notices go.</p>
            </div>
            <dl class="dl">
              <div v-if="detail.address.street || detail.address._raw" class="dl__row"><dt>Street</dt><dd>{{ detail.address.street ?? detail.address._raw }}</dd></div>
              <div v-if="detail.address.suburb" class="dl__row"><dt>Suburb</dt><dd>{{ detail.address.suburb }}</dd></div>
              <div v-if="detail.address.postcode" class="dl__row"><dt>Postcode</dt><dd>{{ detail.address.postcode }}</dd></div>
              <div v-if="detail.address.country" class="dl__row"><dt>Country</dt><dd>{{ detail.address.country }}</dd></div>
              <div v-if="!detail.address.street && !detail.address._raw && !detail.address.suburb" class="dl__row"><dt>Address</dt><dd>—</dd></div>
            </dl>
          </div>
        </li>

        <li class="step">
          <div class="step__body">
            <div class="step__head">
              <div class="step__eyebrow">STEP 04</div>
              <h2 class="step__title">Their bowls</h2>
              <p class="step__hint">Where the selectors and coaches will slot them.</p>
            </div>
            <dl class="dl">
              <div class="dl__row"><dt>Experience</dt><dd>{{ detail.bowls?.experience ?? '—' }}</dd></div>
              <div class="dl__row"><dt>Position</dt><dd>{{ detail.bowls?.position ?? '—' }}</dd></div>
              <div class="dl__row"><dt>Days available</dt><dd>{{ formatDays(detail.bowls?.playing_days) }}</dd></div>
              <div class="dl__row"><dt>Bowls NZ #</dt><dd>{{ detail.bowls?.bowls_number ?? '—' }}</dd></div>
            </dl>
          </div>
        </li>

        <li class="step">
          <div class="step__body">
            <div class="step__head">
              <div class="step__eyebrow">STEP 05</div>
              <h2 class="step__title">Emergency contact</h2>
              <p class="step__hint">Who to call if there's an accident on the green.</p>
            </div>
            <dl class="dl">
              <div class="dl__row"><dt>Name</dt><dd>{{ detail.emergency_contact?.name ?? '—' }}</dd></div>
              <div class="dl__row"><dt>Phone</dt><dd v-if="detail.emergency_contact?.phone"><a class="link" :href="`tel:${detail.emergency_contact.phone.replace(/\s+/g, '')}`">{{ detail.emergency_contact.phone }}</a></dd><dd v-else>—</dd></div>
              <div class="dl__row"><dt>Relationship</dt><dd>{{ detail.emergency_contact?.relationship ?? '—' }}</dd></div>
            </dl>
          </div>
        </li>

        <li class="step">
          <div class="step__body">
            <div class="step__head">
              <div class="step__eyebrow">STEP 06</div>
              <h2 class="step__title">Review &amp; agree</h2>
              <p class="step__hint">What they told us at the end of the form.</p>
            </div>
            <blockquote v-if="detail.note" class="step__note">{{ detail.note }}</blockquote>
            <dl class="dl">
              <div class="dl__row"><dt>Referrer</dt><dd>{{ detail.referrer ?? '—' }}</dd></div>
              <div class="dl__row"><dt>Terms</dt><dd>
                <span class="agree-chip" :class="detail.consent?.terms ? 'agree-chip--yes' : 'agree-chip--no'">{{ detail.consent?.terms ? 'Accepted' : 'Not accepted' }}</span>
              </dd></div>
              <div class="dl__row"><dt>Newsletter</dt><dd>
                <span class="agree-chip" :class="detail.consent?.newsletter ? 'agree-chip--yes' : 'agree-chip--no'">{{ detail.consent?.newsletter ? 'Opted in' : 'No' }}</span>
              </dd></div>
              <div class="dl__row"><dt>Club photos</dt><dd>
                <span class="agree-chip" :class="detail.consent?.photo ? 'agree-chip--yes' : 'agree-chip--no'">{{ detail.consent?.photo ? 'Yes' : 'No' }}</span>
              </dd></div>
            </dl>
          </div>
        </li>
      </ol>

      <!-- Right rail: status card + actions + notes -->
      <aside class="rail">
        <div class="rail__status" :class="`rail__status--${statusTone[detail.status]}`">
          <div class="rail__avatar">{{ initials(detail.full_name) }}</div>
          <div class="rail__eyebrow">STATUS</div>
          <div class="rail__status-name">{{ statusLabel[detail.status] }}</div>
          <div v-if="detail.reviewed_at" class="rail__status-meta">Decided {{ timeAgo(detail.reviewed_at) }}</div>
          <div v-else class="rail__status-meta">Awaiting decision</div>
        </div>

        <div v-if="detail.status === 'pending'" class="rail__actions">
          <button type="button" class="rail-btn rail-btn--approve" @click="openApprove">Approve</button>
          <button type="button" class="rail-btn rail-btn--reject" @click="openReject">Reject</button>
        </div>

        <div class="rail__notes">
          <div class="rail__notes-head">
            <h3 class="rail__notes-title">Internal notes</h3>
            <span class="rail__notes-count">{{ detail.notes.length }}</span>
          </div>
          <p class="rail__notes-sub">Only the CRM sees these. Never emailed to the applicant.</p>
          <form class="note-form" @submit.prevent="submitNote">
            <textarea
              v-model="noteBody"
              rows="3"
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

    <!-- Approve modal -->
    <CrmModal
      :open="approveOpen"
      eyebrow="Approve application"
      :title="detail ? `Approve ${detail.full_name}?` : 'Approve'"
      width="sm"
      @close="approveOpen = false"
    >
      <div v-if="detail" class="modal-form">
        <p class="modal-hint">Creates a member record + membership row (if the applicant chose a tier). Same resolution path as the roster's add-member.</p>
        <label class="field">
          <span class="field__label">Resolution</span>
          <select v-model="approveForm.resolution">
            <option value="auto">Auto — link if email matches, otherwise invite</option>
            <option value="invite">Invite by email</option>
            <option value="stub">Create stub (no email match)</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">Membership number (optional)</span>
          <input v-model="approveForm.assigned_number" type="text" inputmode="numeric" placeholder="Leave blank to auto-assign" />
        </label>
        <label class="switch-row">
          <div>
            <div class="switch-row__label">Send welcome email</div>
            <div class="switch-row__hint">Turn off for silent approval — you'll email them yourself.</div>
          </div>
          <button type="button" class="switch" :class="{ 'is-on': approveForm.send_welcome_email }" @click="approveForm.send_welcome_email = !approveForm.send_welcome_email">
            <span class="switch__knob" />
          </button>
        </label>
      </div>
      <template #footer>
        <button type="button" class="rail-btn rail-btn--outline" @click="approveOpen = false" :disabled="approveSubmitting">Cancel</button>
        <button type="button" class="rail-btn rail-btn--approve" @click="submitApprove" :disabled="approveSubmitting">
          {{ approveSubmitting ? 'Approving…' : 'Approve' }}
        </button>
      </template>
    </CrmModal>

    <!-- Reject modal -->
    <CrmModal
      :open="rejectOpen"
      eyebrow="Reject application"
      :title="detail ? `Reject ${detail.full_name}?` : 'Reject'"
      width="sm"
      @close="rejectOpen = false"
    >
      <div class="modal-form">
        <p class="modal-hint">The reason is stored for audit. Only the message (if you write one) is emailed to the applicant.</p>
        <label class="field">
          <span class="field__label">Reason</span>
          <select v-model="rejectForm.reason">
            <option v-for="r in REJECT_REASONS" :key="r.value" :value="r.value">{{ r.label }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">Message to applicant (optional)</span>
          <textarea v-model="rejectForm.message" rows="4" placeholder="Leave empty to reject silently. Otherwise this is emailed as-is." />
        </label>
      </div>
      <template #footer>
        <button type="button" class="rail-btn rail-btn--outline" @click="rejectOpen = false" :disabled="rejectSubmitting">Cancel</button>
        <button type="button" class="rail-btn rail-btn--reject" @click="submitReject" :disabled="rejectSubmitting">
          {{ rejectSubmitting ? 'Rejecting…' : 'Reject' }}
        </button>
      </template>
    </CrmModal>
  </div>
</template>

<style scoped>
.page { max-width: 1280px; display: flex; flex-direction: column; gap: 32px; }

/* Header */
.page__head { display: flex; flex-direction: column; gap: 12px; }
.back { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-fog); text-decoration: none; width: fit-content; }
.back:hover { color: var(--color-ink); }
.back--emphasis { color: var(--color-accent); margin-top: 16px; font-weight: 600; }
.page__title-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.page__title { font-family: var(--font-display); font-size: clamp(28px, 3vw, 40px); font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: 0; line-height: 1.05; }
.page__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin: 0; }

/* Empty */
.empty { padding: 96px 40px; text-align: center; font-family: var(--font-body); background: #fff; border: 1px dashed var(--color-hairline); border-radius: 14px; }
.empty__title { font-family: var(--font-display); font-size: 24px; font-weight: 700; color: var(--color-ink); }
.empty__hint { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin-top: 6px; }

/* Body layout */
.page__body { display: grid; grid-template-columns: 1fr 340px; gap: 48px; align-items: flex-start; }

/* Left column — numbered steps. Number sits inside the card as a mono
   eyebrow so the card left-edge aligns with the page header. */
.steps { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 20px; }
.step { display: block; }
.step__body { display: flex; flex-direction: column; gap: 16px; min-width: 0; background: #fff; padding: 24px 28px; border: 1px solid var(--color-hairline); border-radius: 14px; }
.step__head { display: flex; flex-direction: column; gap: 6px; }
.step__eyebrow { font-family: var(--font-mono); font-size: 11px; font-weight: 600; letter-spacing: 0.14em; color: var(--color-mute); text-transform: uppercase; }
.step__title { font-family: var(--font-display); font-size: 22px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); margin: 0; line-height: 1.15; }
.step__hint { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin: 0; line-height: 1.5; }
.step__note {
  padding: 16px 18px;
  background: var(--color-surface);
  border: 1px solid var(--color-hairline);
  border-left: 3px solid var(--color-accent);
  border-radius: 10px;
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 1.55;
  color: var(--color-ink);
  margin: 0;
  font-style: italic;
}

/* Definition list */
.dl { display: flex; flex-direction: column; margin: 0; }
.dl__row { display: grid; grid-template-columns: 160px 1fr; gap: 20px; padding: 12px 0; border-top: 1px solid var(--color-hairline); align-items: baseline; }
.dl__row:first-child { border-top: 0; padding-top: 4px; }
.dl__row:last-child { padding-bottom: 4px; }
.dl dt { font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); margin: 0; }
.dl dd { font-family: var(--font-body); font-size: 14px; color: var(--color-ink); margin: 0; word-break: break-word; }
.dl__muted { color: var(--color-fog); }
.link { color: var(--color-accent); text-decoration: none; }
.link:hover { text-decoration: underline; }

.agree-chip { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; font-family: var(--font-body); font-size: 12px; font-weight: 600; }
.agree-chip--yes { background: #DCFCE7; color: #14532D; }
.agree-chip--no  { background: var(--color-surface); color: var(--color-fog); border: 1px solid var(--color-hairline); }

/* Right rail */
.rail { position: sticky; top: 32px; display: flex; flex-direction: column; gap: 20px; }

.rail__status { position: relative; display: flex; flex-direction: column; gap: 8px; padding: 24px 24px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; overflow: hidden; }
.rail__status::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--color-graphite); }
.rail__status--ok::before { background: #16A34A; }
.rail__status--warn::before { background: var(--color-accent); }
.rail__status--danger::before { background: var(--color-danger); }
.rail__avatar { width: 56px; height: 56px; border-radius: 999px; background: var(--color-ink); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 20px; font-weight: 700; margin-bottom: 4px; }
.rail__eyebrow { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.rail__status-name { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--color-ink); letter-spacing: -0.01em; }
.rail__status-meta { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); }

.rail__actions { display: flex; flex-direction: column; gap: 8px; }

.rail-btn { padding: 12px 16px; border-radius: 10px; font-family: var(--font-body); font-size: 14px; font-weight: 600; cursor: pointer; border: 0; transition: background 120ms, color 120ms, border-color 120ms; }
.rail-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.rail-btn--sm { padding: 8px 12px; font-size: 13px; }
.rail-btn--approve { background: var(--color-ink); color: #fff; }
.rail-btn--approve:hover:not(:disabled) { background: var(--color-graphite); }
.rail-btn--reject { background: transparent; color: var(--color-danger); border: 1px solid var(--color-hairline); }
.rail-btn--reject:hover:not(:disabled) { border-color: var(--color-danger); background: color-mix(in oklab, var(--color-danger) 6%, #fff); }
.rail-btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.rail-btn--outline:hover:not(:disabled) { background: var(--color-surface); }

/* Rail notes */
.rail__notes { display: flex; flex-direction: column; gap: 12px; padding: 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }
.rail__notes-head { display: flex; align-items: baseline; gap: 10px; }
.rail__notes-title { font-family: var(--font-display); font-size: 16px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); margin: 0; }
.rail__notes-count { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; color: var(--color-fog); padding: 2px 8px; border-radius: 999px; background: var(--color-surface); }
.rail__notes-sub { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin: 0; line-height: 1.5; }
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

/* Pill (mirrors ApplicationsView) */
.pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.pill--ok { background: #DCFCE7; color: #14532D; }
.pill--warn { background: var(--color-accent-soft); color: var(--color-accent); }
.pill--danger { background: #FEE2E2; color: #991B1B; }

/* Modal form */
.modal-form { display: flex; flex-direction: column; gap: 14px; }
.modal-hint { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); margin: 0; line-height: 1.5; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.field input, .field select, .field textarea { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; resize: vertical; }
.field input:focus, .field select:focus, .field textarea:focus { outline: none; border-color: var(--color-ink); }
.switch-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 0; border-top: 1px solid var(--color-hairline); }
.switch-row__label { font-family: var(--font-body); font-size: 14px; font-weight: 600; color: var(--color-ink); }
.switch-row__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; }
.switch { width: 40px; height: 24px; padding: 3px; border-radius: 999px; background: var(--color-hairline); border: 0; display: flex; cursor: pointer; flex-shrink: 0; }
.switch.is-on { background: var(--color-ink); }
.switch__knob { width: 18px; height: 18px; border-radius: 999px; background: #fff; transition: transform 0.15s ease; }
.switch.is-on .switch__knob { transform: translateX(16px); }

.download-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 999px;
  background: transparent;
  color: var(--color-ink);
  border: 1px solid var(--color-hairline);
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 120ms, border-color 120ms;
  margin-left: auto;
}
.download-btn:hover { background: var(--color-surface); border-color: var(--color-ink); }
.download-btn:active { transform: translateY(1px); }

/* ── Print — Save-as-PDF-friendly. Strip the chrome, print steps only. */
@media print {
  /* Reset the CRM shell padding — the print sheet is the whole thing. */
  :deep(.shell), :deep(.main), :deep(.topbar), :deep(.mobile-top), :deep(.sidebar), :deep(.bottom-tabs) { display: none !important; }
  .back, .rail, .download-btn, .page__title-row .pill { display: none !important; }
  .page { padding: 24px; max-width: none; gap: 24px; }
  .page__body { display: block; }
  .page__title { font-size: 32px; }
  .page__sub { font-size: 12px; }
  .steps { gap: 16px; }
  .step { page-break-inside: avoid; }
  .step__body { border: 1px solid #E5E5E5; box-shadow: none; padding: 16px 20px; }
  .step__title { font-size: 16px; }
  .step__hint { font-size: 12px; }
  .dl__row { grid-template-columns: 140px 1fr; gap: 12px; padding: 6px 0; }
  .dl dt { font-size: 11px; }
  .dl dd { font-size: 12px; }
  .step__note { font-size: 12px; padding: 10px 14px; }
  .agree-chip { border: 1px solid #E5E5E5; }
  /* Show URLs after links so print carries the info. */
  .link[href^="mailto:"]::after,
  .link[href^="tel:"]::after {
    content: '';
  }
  a { color: inherit; text-decoration: none; }
}

/* Responsive */
@media (max-width: 1023px) {
  .page__body { grid-template-columns: 1fr; gap: 32px; }
  .rail { position: static; }
}
@media (max-width: 767px) {
  .step__body { padding: 18px 20px; }
  .step__title { font-size: 18px; }
  .dl__row { grid-template-columns: 1fr; gap: 4px; padding: 10px 0; }
}
</style>
