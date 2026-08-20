<script setup lang="ts">
import { computed, ref, onMounted, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useClaimsStore, type Claim, type ClaimStatus } from '@/stores/claims'
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

const filtered = computed<Claim[]>(() => {
  if (activeTab.value === 'pending') return [...claims.pending].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
  if (activeTab.value === 'approved') return [...claims.approved].sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))
  return [...claims.rejected].sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))
})

const decidedBy = computed(() => {
  if (!auth.user) return 'Platform admin'
  return `${auth.user.firstName ?? ''} ${auth.user.lastName ?? ''}`.trim() || auth.user.email
})

const rejectingClaim = computed(() => claims.claims.find(c => c.id === rejectingId.value) ?? null)

onMounted(() => {
  // Deep link support: /admin/claims#clm_001 opens that row
  const hash = route.hash.replace(/^#/, '')
  if (hash) {
    nextTick(() => {
      const claim = claims.claims.find(c => c.id === hash)
      if (claim) {
        activeTab.value = claim.status
        expandedId.value = hash
      }
    })
  }
})

// Reset expanded row when tab changes
watch(activeTab, () => { expandedId.value = null })

function initials(name: string): string {
  return name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

function approve(claim: Claim) {
  claims.approve(claim.id, decidedBy.value)
  toast.success(`Approved ${claim.clubName}`)
}

function openReject(id: string) {
  rejectingId.value = id
  rejectionReason.value = ''
}
function confirmReject() {
  if (!rejectingId.value || !rejectionReason.value.trim()) return
  const claim = claims.claims.find(c => c.id === rejectingId.value)
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

    <div class="tabs">
      <button
        v-for="tab in (['pending','approved','rejected'] as const)"
        :key="tab"
        class="tab"
        :class="{ 'is-active': activeTab === tab }"
        @click="activeTab = tab"
      >
        <span>{{ tab.charAt(0).toUpperCase() + tab.slice(1) }}</span>
        <span class="tab__count">{{ claims[tab].length }}</span>
      </button>
    </div>

    <div v-if="filtered.length === 0" class="empty">
      <div class="empty__mark">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M5 12l5 5 9-11" /></svg>
      </div>
      <div class="empty__title">Nothing here.</div>
      <div class="empty__sub">
        <template v-if="activeTab === 'pending'">You've caught up on every pending claim. Nice.</template>
        <template v-else-if="activeTab === 'approved'">No approvals recorded yet.</template>
        <template v-else>No claims have been rejected.</template>
      </div>
    </div>

    <ul v-else class="rows">
      <li
        v-for="c in filtered"
        :key="c.id"
        :id="c.id"
        class="row"
        :class="{ 'is-open': expandedId === c.id }"
      >
        <div class="row__head" @click="expandedId = expandedId === c.id ? null : c.id">
          <div class="row__avatar">{{ initials(c.clubName) }}</div>
          <div class="row__body">
            <div class="row__club">{{ c.clubName }}</div>
            <div class="row__meta">
              <span>{{ c.region }}</span>
              <span class="row__sep">·</span>
              <span><strong>{{ c.claimant.firstName }} {{ c.claimant.lastName }}</strong></span>
              <span class="row__sep">·</span>
              <span class="row__role">{{ c.claimant.role }}</span>
              <span class="row__sep">·</span>
              <span>{{ formatDate(c.submittedAt) }}</span>
            </div>
          </div>
          <div class="row__status" :class="`row__status--${c.status}`">
            {{ c.status }}
          </div>
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
              <div class="detail__value detail__value--muted">{{ c.region }}</div>
              <div class="detail__value detail__value--muted">Directory ID: {{ c.clubId }}</div>
            </div>
            <div class="detail-block">
              <div class="detail__label">Submitted</div>
              <div class="detail__value">{{ formatDate(c.submittedAt) }}</div>
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

.tabs { display: inline-flex; gap: 4px; padding: 4px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; margin-bottom: 20px; }
.tab { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; background: transparent; border: 0; border-radius: 8px; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-fog); cursor: pointer; text-transform: capitalize; }
.tab:hover { color: var(--color-ink); }
.tab.is-active { background: var(--color-ink); color: #fff; font-weight: 600; }
.tab__count { font-family: var(--font-mono); font-size: 11px; padding: 2px 7px; background: var(--color-surface); color: var(--color-graphite); border-radius: 6px; font-weight: 700; }
.tab.is-active .tab__count { background: rgba(255,255,255,0.14); color: #fff; }

.rows { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.row { background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; overflow: hidden; transition: box-shadow 0.15s ease; }
.row.is-open { box-shadow: 0 12px 30px -12px rgba(15,23,42,0.15); border-color: var(--color-ink); }
.row__head { display: flex; align-items: center; gap: 16px; padding: 16px 20px; cursor: pointer; }
.row__head:hover { background: var(--color-surface); }
.row.is-open .row__head { background: var(--color-surface); }
.row__avatar { width: 44px; height: 44px; border-radius: 10px; background: var(--color-ink); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 13px; font-weight: 700; flex-shrink: 0; }
.row__body { flex: 1; min-width: 0; }
.row__club { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-ink); }
.row__meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 4px; }
.row__meta strong { color: var(--color-graphite); font-weight: 600; }
.row__sep { opacity: 0.5; }
.row__role { color: var(--color-graphite); font-weight: 600; }

.row__status { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; padding: 4px 10px; border-radius: 6px; flex-shrink: 0; }
.row__status--pending { background: #FEF3C7; color: #92400E; }
.row__status--approved { background: #DCFCE7; color: #166534; }
.row__status--rejected { background: #FEE2E2; color: #991B1B; }

.row__chevron { background: transparent; border: 0; padding: 6px; color: var(--color-fog); cursor: pointer; transition: transform 0.15s ease; }
.row__chevron.is-open { transform: rotate(180deg); color: var(--color-ink); }

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
  .detail-grid { grid-template-columns: 1fr; }
  .row__meta { font-size: 11px; }
}
</style>
