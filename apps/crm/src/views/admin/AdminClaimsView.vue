<script setup lang="ts">
import { computed, ref, onMounted, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useClaimsStore, type Claim, type ClaimStatus, type Sport } from '@/stores/claims'
import { useToast } from '@/composables/useToast'
import CrmModal from '@/components/modals/CrmModal.vue'

const auth = useAuthStore()
const claims = useClaimsStore()
const toast = useToast()
const route = useRoute()

const activeTab = ref<ClaimStatus>('pending')
const expandedId = ref<string | null>(null)
const rejectingId = ref<string | null>(null)
const rejectionReason = ref('')
const search = ref('')

// Anchor "now" to a fixed point so waiting-days values stay stable in the mock.
const NOW = new Date('2026-08-20T10:00:00Z')

const filtered = computed<Claim[]>(() => {
  const q = search.value.trim().toLowerCase()
  const base = claims.claims.filter((c) => c.status === activeTab.value)
  const searched = q
    ? base.filter((c) =>
        c.clubName.toLowerCase().includes(q) ||
        c.region.toLowerCase().includes(q) ||
        c.sport.toLowerCase().includes(q) ||
        `${c.claimant.firstName} ${c.claimant.lastName}`.toLowerCase().includes(q) ||
        c.claimant.email.toLowerCase().includes(q) ||
        c.claimant.role.toLowerCase().includes(q),
      )
    : base
  return activeTab.value === 'pending'
    ? [...searched].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    : [...searched].sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))
})

const decidedBy = computed(() => {
  if (!auth.user) return 'Platform admin'
  return `${auth.user.firstName ?? ''} ${auth.user.lastName ?? ''}`.trim() || auth.user.email
})

const rejectingClaim = computed(() => claims.claims.find((c) => c.id === rejectingId.value) ?? null)

// ── Urgency + summary ─────────────────────────────────────────
function daysWaiting(iso: string): number {
  const d = new Date(iso)
  return Math.floor((NOW.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
}
function isUrgent(c: Claim): boolean {
  return c.status === 'pending' && daysWaiting(c.submittedAt) >= 2
}
function waitingLabel(c: Claim): string {
  const days = daysWaiting(c.submittedAt)
  if (days === 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

const urgentCount = computed(() => claims.pending.filter(isUrgent).length)

const avgWait = computed(() => {
  const p = claims.pending
  if (!p.length) return 0
  const total = p.reduce((sum, c) => sum + daysWaiting(c.submittedAt), 0)
  return Math.round(total / p.length)
})

// ── Sport display ─────────────────────────────────────────────
const sportLabel: Record<Sport, string> = {
  bowls: 'Bowls',
  tennis: 'Tennis',
  golf: 'Golf',
  cricket: 'Cricket',
  petanque: 'Pétanque',
  croquet: 'Croquet',
}
const sportColour: Record<Sport, string> = {
  bowls: 'var(--color-feature-mint)',
  tennis: 'var(--color-feature-tangerine)',
  golf: '#16A34A',
  cricket: 'var(--color-accent)',
  petanque: 'var(--color-feature-violet)',
  croquet: 'var(--color-graphite)',
}

onMounted(() => {
  const hash = route.hash.replace(/^#/, '')
  if (hash) {
    nextTick(() => {
      const claim = claims.claims.find((c) => c.id === hash)
      if (claim) {
        activeTab.value = claim.status
        expandedId.value = hash
      }
    })
  }
})

watch(activeTab, () => {
  expandedId.value = null
})

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}

function approve(claim: Claim) {
  // MOCK — real approve hits POST /admin/claims/:id/approve (brief 04 §6.2).
  // The side effects (create clubs row, create club_members owner, auto-reject
  // siblings, fire notification) all happen server-side. Frontend just marks
  // local state and shows a toast until then.
  claims.approve(claim.id, decidedBy.value)
  toast.success(`Approved ${claim.clubName}`)
}

function openReject(id: string) {
  rejectingId.value = id
  rejectionReason.value = ''
}
function confirmReject() {
  if (!rejectingId.value || !rejectionReason.value.trim()) return
  const claim = claims.claims.find((c) => c.id === rejectingId.value)
  claims.reject(rejectingId.value, decidedBy.value, rejectionReason.value.trim())
  if (claim) toast.info(`Rejected ${claim.clubName}`)
  rejectingId.value = null
  rejectionReason.value = ''
}
function cancelReject() {
  rejectingId.value = null
  rejectionReason.value = ''
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const emptyMessage = computed(() => {
  if (search.value.trim()) return { title: 'No matches', hint: 'Try clearing the search.' }
  switch (activeTab.value) {
    case 'pending':  return { title: 'Inbox zero', hint: "You've caught up on every pending claim. Nice." }
    case 'approved': return { title: 'No approvals yet', hint: 'Approved claims land here for audit.' }
    case 'rejected': return { title: 'No rejections', hint: 'Rejected claims stay here for reference.' }
  }
  return { title: 'Nothing here', hint: '' }
})
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <div class="head__eyebrow">Platform · Claims queue</div>
        <h1 class="head__title">Club claims</h1>
        <p class="head__sub">
          Review who's asking to admin each club. Approving grants the claimant owner-level access to that club's CRM.
        </p>
      </div>
    </header>

    <!-- Summary strip -->
    <div class="summary">
      <div class="summary__stat">
        <div class="summary__value">{{ claims.pendingCount }}</div>
        <div class="summary__label">Pending review</div>
      </div>
      <div class="summary__stat" :class="{ 'summary__stat--warn': urgentCount > 0 }">
        <div class="summary__value">{{ urgentCount }}</div>
        <div class="summary__label">Waiting &gt;2 days</div>
      </div>
      <div class="summary__stat">
        <div class="summary__value">{{ avgWait }}<span class="summary__unit">d</span></div>
        <div class="summary__label">Avg wait time</div>
      </div>
      <div class="summary__stat summary__stat--muted">
        <div class="summary__value">{{ claims.approved.length + claims.rejected.length }}</div>
        <div class="summary__label">Decided all-time</div>
      </div>
    </div>

    <!-- Toolbar: tabs + search -->
    <div class="toolbar">
      <div class="tabs">
        <button
          v-for="tab in (['pending', 'approved', 'rejected'] as const)"
          :key="tab"
          class="tab"
          :class="{ 'is-active': activeTab === tab }"
          @click="activeTab = tab"
        >
          <span>{{ tab.charAt(0).toUpperCase() + tab.slice(1) }}</span>
          <span class="tab__count">{{ claims[tab].length }}</span>
        </button>
      </div>
      <div class="search">
        <svg class="search__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input v-model="search" class="search__input" placeholder="Search club, region, claimant…" />
        <button v-if="search" class="search__clear" aria-label="Clear search" @click="search = ''">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
    </div>

    <div v-if="filtered.length === 0" class="empty">
      <div class="empty__mark">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M5 12l5 5 9-11" /></svg>
      </div>
      <div class="empty__title">{{ emptyMessage.title }}</div>
      <div class="empty__sub">{{ emptyMessage.hint }}</div>
    </div>

    <ul v-else class="rows">
      <li
        v-for="c in filtered"
        :key="c.id"
        :id="c.id"
        class="row"
        :class="{ 'is-open': expandedId === c.id, 'is-urgent': isUrgent(c) }"
      >
        <div class="row__head" @click="expandedId = expandedId === c.id ? null : c.id">
          <div class="row__avatar">{{ initials(c.clubName) }}</div>
          <div class="row__body">
            <div class="row__title-row">
              <div class="row__club">{{ c.clubName }}</div>
              <span class="badge badge--sport" :style="{ '--sport-colour': sportColour[c.sport] } as any">
                <span class="badge__dot" />
                {{ sportLabel[c.sport] }}
              </span>
              <span v-if="isUrgent(c)" class="badge badge--warn">Waiting {{ daysWaiting(c.submittedAt) }}d</span>
            </div>
            <div class="row__meta">
              <span>{{ c.region }}</span>
              <span class="row__sep">·</span>
              <span><strong>{{ c.claimant.firstName }} {{ c.claimant.lastName }}</strong></span>
              <span class="row__sep">·</span>
              <span class="row__role">{{ c.claimant.role }}</span>
              <span class="row__sep">·</span>
              <span>submitted {{ waitingLabel(c) }}</span>
            </div>
          </div>
          <span class="pill" :class="`pill--${c.status}`">{{ c.status }}</span>
          <button class="row__chevron" :class="{ 'is-open': expandedId === c.id }" aria-label="Toggle details">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="m7 10 5 5 5-5" /></svg>
          </button>
        </div>

        <div v-if="expandedId === c.id" class="row__detail">
          <div class="detail-grid">
            <div class="detail-block">
              <div class="detail__label">Claimant</div>
              <div class="detail__value">{{ c.claimant.firstName }} {{ c.claimant.lastName }}</div>
              <div class="detail__value detail__value--muted">{{ c.claimant.role }}</div>
              <a :href="`mailto:${c.claimant.email}`" class="detail__link">{{ c.claimant.email }}</a>
            </div>
            <div class="detail-block">
              <div class="detail__label">Club</div>
              <div class="detail__value">{{ c.clubName }}</div>
              <div class="detail__value detail__value--muted">{{ c.region }} · {{ sportLabel[c.sport] }}</div>
              <div class="detail__value detail__value--muted">Directory ID: {{ c.clubId }}</div>
            </div>
            <div class="detail-block">
              <div class="detail__label">Submitted</div>
              <div class="detail__value">{{ formatDate(c.submittedAt) }}</div>
              <div class="detail__value detail__value--muted">{{ waitingLabel(c) }}</div>
              <template v-if="c.decidedAt">
                <div class="detail__label detail__label--spaced">Decided</div>
                <div class="detail__value">{{ formatDate(c.decidedAt) }}</div>
                <div class="detail__value detail__value--muted">by {{ c.decidedBy }}</div>
              </template>
            </div>
          </div>

          <div class="detail__eyebrow">Evidence</div>
          <p class="detail__evidence">{{ c.evidence }}</p>

          <div v-if="c.rejectionReason" class="detail__reason">
            <div class="detail__label detail__label--danger">Rejection reason</div>
            <p class="detail__reason-body">{{ c.rejectionReason }}</p>
          </div>

          <div v-if="c.status === 'pending'" class="detail__actions">
            <button class="btn-reject" @click.stop="openReject(c.id)">Reject</button>
            <button class="btn-approve" @click.stop="approve(c)">Approve claim</button>
          </div>
        </div>
      </li>
    </ul>

    <CrmModal
      :open="!!rejectingId"
      eyebrow="Reject claim"
      :title="rejectingClaim ? `Reject ${rejectingClaim.clubName}?` : 'Reject claim'"
      width="sm"
      @close="cancelReject"
    >
      <p class="modal-body">
        This will notify <strong>{{ rejectingClaim?.claimant.firstName }} {{ rejectingClaim?.claimant.lastName }}</strong>
        by email that their claim was not approved. Give them a reason so they know what to fix.
      </p>
      <label class="modal-field">
        <span>Reason</span>
        <textarea
          v-model="rejectionReason"
          rows="3"
          placeholder="e.g. We couldn't verify your role — please attach recent committee minutes and re-submit."
          class="modal-textarea"
        />
      </label>
      <template #footer>
        <button class="btn-ghost" @click="cancelReject">Cancel</button>
        <button class="btn-reject-solid" :disabled="!rejectionReason.trim()" @click="confirmReject">Reject &amp; notify</button>
      </template>
    </CrmModal>
  </div>
</template>

<style scoped>
.page { padding: 32px 40px 60px; }

.head { margin-bottom: 24px; }
.head__eyebrow { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }
.head__title { font-family: var(--font-display); font-size: 40px; font-weight: 600; color: var(--color-ink); letter-spacing: -0.02em; line-height: 1.05; margin: 8px 0 12px; }
.head__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; max-width: 560px; line-height: 1.5; }

/* Summary strip */
.summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
.summary__stat { background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; padding: 14px 16px; }
.summary__stat--warn { background: #FEF3C7; border-color: #FDE68A; }
.summary__stat--warn .summary__value { color: #92400E; }
.summary__stat--muted { background: var(--color-surface); }
.summary__value { font-family: var(--font-display); font-size: 22px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); line-height: 1.15; }
.summary__unit { font-family: var(--font-mono); font-size: 12px; font-weight: 500; color: var(--color-fog); margin-left: 2px; }
.summary__label { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: var(--color-fog); text-transform: uppercase; margin-top: 4px; }

/* Toolbar */
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.tabs { display: inline-flex; gap: 4px; padding: 4px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; }
.tab { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; background: transparent; border: 0; border-radius: 8px; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-fog); cursor: pointer; }
.tab:hover { color: var(--color-ink); }
.tab.is-active { background: var(--color-ink); color: #fff; font-weight: 600; }
.tab__count { font-family: var(--font-mono); font-size: 11px; padding: 2px 7px; background: var(--color-surface); color: var(--color-graphite); border-radius: 6px; font-weight: 700; }
.tab.is-active .tab__count { background: rgba(255,255,255,0.14); color: #fff; }

.search { position: relative; display: flex; align-items: center; min-width: 320px; }
.search__icon { position: absolute; left: 12px; color: var(--color-fog); pointer-events: none; }
.search__input { width: 100%; padding: 9px 36px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; }
.search__input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.search__clear { position: absolute; right: 8px; width: 22px; height: 22px; border-radius: 999px; background: var(--color-surface); border: 0; color: var(--color-graphite); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.search__clear:hover { background: var(--color-hairline); color: var(--color-ink); }

/* Rows */
.rows { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.row { background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; overflow: hidden; transition: box-shadow 0.15s ease, border-color 0.15s ease; }
.row.is-open { box-shadow: 0 12px 30px -12px rgba(15,23,42,0.15); border-color: var(--color-ink); }
.row.is-urgent { border-left: 3px solid #F59E0B; }
.row__head { display: flex; align-items: center; gap: 16px; padding: 16px 20px; cursor: pointer; }
.row__head:hover { background: var(--color-surface); }
.row.is-open .row__head { background: var(--color-surface); }
.row__avatar { width: 44px; height: 44px; border-radius: 10px; background: var(--color-ink); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 13px; font-weight: 700; flex-shrink: 0; }
.row__body { flex: 1; min-width: 0; }
.row__title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.row__club { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-ink); }
.row__meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 4px; }
.row__meta strong { color: var(--color-graphite); font-weight: 600; }
.row__sep { opacity: 0.5; }
.row__role { color: var(--color-graphite); font-weight: 600; }

/* Status pills */
.pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; flex-shrink: 0; }
.pill--pending  { background: #FEF3C7; color: #92400E; }
.pill--approved { background: #DCFCE7; color: #166534; }
.pill--rejected { background: #FEE2E2; color: #991B1B; }

/* Badges */
.badge { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; border: 1px solid transparent; white-space: nowrap; }
.badge--warn  { background: #FEF3C7; color: #92400E; }
.badge--sport { background: var(--color-surface); color: var(--color-graphite); border-color: var(--color-hairline); }
.badge__dot { width: 6px; height: 6px; border-radius: 999px; background: var(--sport-colour, var(--color-graphite)); }

.row__chevron { background: transparent; border: 0; padding: 6px; color: var(--color-fog); cursor: pointer; transition: transform 0.15s ease; }
.row__chevron.is-open { transform: rotate(180deg); color: var(--color-ink); }

/* Row detail (expanded) */
.row__detail { padding: 8px 20px 24px; border-top: 1px solid var(--color-hairline); }
.detail-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin: 20px 0; }
.detail-block { }
.detail__label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; margin-bottom: 6px; }
.detail__label--spaced { margin-top: 16px; }
.detail__label--danger { color: var(--color-danger); }
.detail__value { font-family: var(--font-body); font-size: 14px; color: var(--color-ink); font-weight: 500; }
.detail__value--muted { color: var(--color-fog); font-size: 12px; font-weight: 500; margin-top: 2px; }
.detail__link { font-family: var(--font-mono); font-size: 12px; color: var(--color-accent); text-decoration: none; margin-top: 4px; display: inline-block; }
.detail__link:hover { text-decoration: underline; }

.detail__eyebrow { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; margin-bottom: 8px; }
.detail__evidence { padding: 16px; background: var(--color-surface); border-left: 3px solid var(--color-ink); border-radius: 4px 12px 12px 4px; font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); line-height: 1.55; margin: 0; }

.detail__reason { margin-top: 20px; padding: 16px; background: #FEF2F2; border-left: 3px solid var(--color-danger); border-radius: 4px 12px 12px 4px; }
.detail__reason-body { font-family: var(--font-body); font-size: 13px; color: #7F1D1D; margin: 0; line-height: 1.5; }

.detail__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.btn-approve { padding: 10px 20px; background: var(--color-ink); color: #fff; border: 0; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-approve:hover { background: var(--color-graphite); }
.btn-reject { padding: 10px 20px; background: transparent; color: var(--color-danger); border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 500; cursor: pointer; }
.btn-reject:hover { background: #FEE2E2; border-color: var(--color-danger); }

.empty { padding: 60px 20px; text-align: center; background: #fff; border: 1px dashed var(--color-hairline); border-radius: 14px; }
.empty__mark { width: 56px; height: 56px; border-radius: 999px; background: var(--color-surface); color: var(--color-graphite); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 12px; }
.empty__title { font-family: var(--font-display); font-size: 22px; font-weight: 600; color: var(--color-ink); }
.empty__sub { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); margin-top: 4px; }

.modal-body { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); line-height: 1.55; margin: 0 0 16px; }
.modal-body strong { color: var(--color-ink); font-weight: 700; }
.modal-field { display: flex; flex-direction: column; gap: 8px; }
.modal-field span { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.modal-textarea { padding: 12px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 14px; resize: vertical; color: var(--color-ink); line-height: 1.5; }
.modal-textarea:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.btn-ghost { padding: 10px 18px; background: transparent; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-graphite); cursor: pointer; }
.btn-reject-solid { padding: 10px 18px; background: var(--color-danger); color: #fff; border: 0; border-radius: 8px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-reject-solid:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-reject-solid:hover:not(:disabled) { background: #B91C1C; }

@media (max-width: 900px) {
  .page { padding: 20px; }
  .head__title { font-size: 32px; }
  .summary { grid-template-columns: repeat(2, 1fr); }
  .toolbar { flex-direction: column; align-items: stretch; gap: 8px; }
  .search { min-width: 0; width: 100%; }
  .detail-grid { grid-template-columns: 1fr; }
  .row__meta { font-size: 11px; }
}
</style>
