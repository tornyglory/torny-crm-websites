<script setup lang="ts">
import { ref, computed } from 'vue'
import CrmModal from '@/components/modals/CrmModal.vue'
import { useToast } from '@/composables/useToast'

const toast = useToast()

type Status = 'pending' | 'approved' | 'declined'
type MembershipType = 'Playing member' | 'Social' | 'Junior' | 'Life member'

interface Application {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string
  membershipType: MembershipType
  submittedAt: string
  waitingDays: number
  status: Status
  notes?: string
  referredBy?: string
  interestedIn?: 'coaching' | 'volunteering' | 'committee'
  dob?: string
  isJunior?: boolean
  decidedAt?: string
  decidedBy?: string
}

const applications = ref<Application[]>([
  { id: 'a1', firstName: 'Aroha', lastName: 'Ngata', email: 'aroha@example.com', phone: '021 555 0101', membershipType: 'Playing member', submittedAt: '2 hours ago', waitingDays: 0, status: 'pending', notes: 'Really keen to play in the Tuesday night ladder.', referredBy: 'Marcus Tuilagi', dob: '14 Mar 1992' },
  { id: 'a2', firstName: 'Sam', lastName: 'Harding', email: 'sam.h@example.com', phone: '022 555 0202', membershipType: 'Playing member', submittedAt: 'Yesterday', waitingDays: 1, status: 'pending', dob: '30 Jul 1985' },
  { id: 'a3', firstName: 'Priya', lastName: 'Kaur', email: 'priya.kaur@example.com', phone: '027 555 0303', membershipType: 'Social', submittedAt: '2 days ago', waitingDays: 2, status: 'pending', notes: 'Would love to help with junior coaching if there\'s room.', interestedIn: 'coaching', dob: '8 Dec 1988' },
  { id: 'a4', firstName: 'Ollie', lastName: 'Fraser', email: 'ollie.f@example.com', phone: '021 555 0999', membershipType: 'Junior', submittedAt: '3 days ago', waitingDays: 3, status: 'pending', notes: 'Parent contact: Kate Fraser (021 555 0900). Under-14 pathway.', dob: '3 Aug 2012', isJunior: true },
  { id: 'a5', firstName: 'Rachel', lastName: 'Beale', email: 'rachel.b@example.com', phone: '022 555 0707', membershipType: 'Social', submittedAt: '5 days ago', waitingDays: 5, status: 'pending', notes: 'New to Wellington from Auckland — has played bowls socially for 3 years.', dob: '22 Sep 1978' },
  { id: 'a6', firstName: 'Jack', lastName: 'O\'Connor', email: 'jack@example.com', phone: '021 555 0404', membershipType: 'Playing member', submittedAt: 'Last week', waitingDays: 7, status: 'approved', decidedAt: '3 days ago', decidedBy: 'Grace Whittaker', referredBy: 'Denise Peters', dob: '11 Jan 1990' },
  { id: 'a7', firstName: 'Meredith', lastName: 'Cole', email: 'meredith@example.com', phone: '022 555 0505', membershipType: 'Social', submittedAt: '2 weeks ago', waitingDays: 14, status: 'declined', decidedAt: '1 week ago', decidedBy: 'Grace Whittaker', notes: 'Declined — currently a member at another Wellington club. Advised they can re-apply if they leave.', dob: '5 Nov 1972' },
  { id: 'a8', firstName: 'Toby', lastName: 'Vercoe', email: 'toby.v@example.com', phone: '027 555 0808', membershipType: 'Playing member', submittedAt: '3 weeks ago', waitingDays: 21, status: 'approved', decidedAt: '2 weeks ago', decidedBy: 'Grace Whittaker', dob: '17 May 1994' },
])

const search = ref('')
const statusFilter = ref<'all' | Status>('pending')

const counts = computed(() => ({
  all: applications.value.length,
  pending: applications.value.filter((a) => a.status === 'pending').length,
  approved: applications.value.filter((a) => a.status === 'approved').length,
  declined: applications.value.filter((a) => a.status === 'declined').length,
}))

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return applications.value.filter((a) => {
    if (statusFilter.value !== 'all' && a.status !== statusFilter.value) return false
    if (!q) return true
    return (
      a.firstName.toLowerCase().includes(q) ||
      a.lastName.toLowerCase().includes(q) ||
      a.email.toLowerCase().includes(q) ||
      a.phone.toLowerCase().includes(q) ||
      a.membershipType.toLowerCase().includes(q) ||
      (a.notes ?? '').toLowerCase().includes(q) ||
      (a.referredBy ?? '').toLowerCase().includes(q)
    )
  })
})

function initials(a: Application) {
  return `${a.firstName[0]}${a.lastName[0]}`.toUpperCase()
}

function fullName(a: Application) {
  return `${a.firstName} ${a.lastName}`
}

function waitingLabel(a: Application) {
  if (a.status !== 'pending') return null
  if (a.waitingDays === 0) return 'today'
  if (a.waitingDays === 1) return '1 day'
  if (a.waitingDays >= 7) return `${a.waitingDays} days · waiting`
  return `${a.waitingDays} days`
}

function isUrgent(a: Application) {
  return a.status === 'pending' && a.waitingDays >= 5
}

const statusTone: Record<Status, string> = {
  pending: 'warn',
  approved: 'ok',
  declined: 'danger',
}

const statusLabel: Record<Status, string> = {
  pending: 'Pending',
  approved: 'Approved',
  declined: 'Declined',
}

// ── Detail modal ─────────────────────────────────────────────
const detailOpen = ref(false)
const activeApp = ref<Application | null>(null)

function openDetail(a: Application) {
  activeApp.value = a
  detailOpen.value = true
}
function closeDetail() {
  detailOpen.value = false
}

function updateStatus(a: Application, next: Status) {
  a.status = next
  a.decidedAt = 'just now'
  a.decidedBy = 'You'
  const verb = next === 'approved' ? 'Approved' : next === 'declined' ? 'Declined' : 'Reopened'
  toast.success(`${verb} ${fullName(a)}`)
  if (activeApp.value?.id === a.id) closeDetail()
}

function exportCsv() {
  toast.info(`Exporting ${applications.value.length} applications — check your email in a minute.`)
}

const emptyMessage = computed(() => {
  if (search.value.trim()) return { title: 'No matches', hint: 'Try a different name or clear the search.' }
  switch (statusFilter.value) {
    case 'pending':  return { title: 'Inbox zero', hint: 'No applications waiting for review.' }
    case 'approved': return { title: 'No approvals yet', hint: 'Approved applications land here.' }
    case 'declined': return { title: 'No declines', hint: 'Declined applications live here for audit.' }
    default:         return { title: 'Nothing yet', hint: 'When people apply, they\'ll appear here.' }
  }
})
</script>

<template>
  <div class="apps">
    <header class="apps__header">
      <div>
        <div class="apps__eyebrow">New arrivals</div>
        <h1 class="apps__heading">Applications</h1>
        <p class="apps__sub">{{ counts.pending }} pending · {{ counts.all }} all-time</p>
      </div>
      <div class="apps__actions">
        <div class="search">
          <svg class="search__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input v-model="search" placeholder="Search name, email, referrer…" class="search__input" />
          <button v-if="search" class="search__clear" aria-label="Clear search" @click="search = ''">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <button class="apps__btn" @click="exportCsv">Export CSV</button>
      </div>
    </header>

    <div class="search search--mobile">
      <svg class="search__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <input v-model="search" placeholder="Search applications…" class="search__input" />
    </div>

    <div class="filters">
      <div class="chips">
        <button
          v-for="tab in (['all', 'pending', 'approved', 'declined'] as const)"
          :key="tab"
          class="chip"
          :class="{ 'is-active': statusFilter === tab }"
          @click="statusFilter = tab"
        >
          <span class="chip__label">{{ tab === 'all' ? 'All' : statusLabel[tab] }}</span>
          <span class="chip__count">{{ counts[tab] }}</span>
        </button>
      </div>
      <div v-if="search || statusFilter !== 'pending'" class="filters__result">
        {{ filtered.length }} of {{ counts.all }}
      </div>
    </div>

    <ul v-if="filtered.length" class="list">
      <li v-for="a in filtered" :key="a.id" class="row" :class="{ 'row--urgent': isUrgent(a) }" tabindex="0" @click="openDetail(a)" @keydown.enter="openDetail(a)">
        <div class="row__avatar">{{ initials(a) }}</div>
        <div class="row__body">
          <div class="row__name-row">
            <div class="row__name">{{ fullName(a) }}</div>
            <div class="row__badges">
              <span v-if="isUrgent(a)" class="badge badge--warn">Waiting</span>
              <span v-if="a.isJunior" class="badge badge--sky">Junior</span>
              <span v-if="a.referredBy" class="badge badge--mute">Referred</span>
              <span v-if="a.interestedIn === 'coaching'" class="badge badge--tangerine">Coach</span>
              <span v-if="a.interestedIn === 'volunteering'" class="badge badge--mute">Volunteer</span>
            </div>
          </div>
          <div class="row__meta">
            <span>{{ a.membershipType }}</span>
            <span class="row__sep">·</span>
            <span>{{ a.email }}</span>
          </div>
          <div v-if="a.notes" class="row__notes">{{ a.notes }}</div>
        </div>
        <div class="row__time">
          <div class="row__time-main">{{ a.submittedAt }}</div>
          <div v-if="waitingLabel(a)" class="row__time-sub">{{ waitingLabel(a) }}</div>
        </div>
        <div class="row__actions" @click.stop>
          <template v-if="a.status === 'pending'">
            <button class="btn btn--decline" @click="updateStatus(a, 'declined')">Decline</button>
            <button class="btn btn--approve" @click="updateStatus(a, 'approved')">Approve</button>
          </template>
          <template v-else>
            <span class="pill" :class="`pill--${statusTone[a.status]}`">{{ statusLabel[a.status] }}</span>
            <button class="btn btn--ghost" @click="updateStatus(a, 'pending')">Reopen</button>
          </template>
        </div>
        <div class="row__chev" aria-hidden="true">›</div>
      </li>
    </ul>
    <div v-else class="empty">
      <div class="empty__title">{{ emptyMessage.title }}</div>
      <div class="empty__hint">{{ emptyMessage.hint }}</div>
    </div>

    <!-- Detail modal -->
    <CrmModal
      :open="detailOpen"
      eyebrow="Application"
      :title="activeApp ? fullName(activeApp) : ''"
      width="lg"
      @close="closeDetail"
    >
      <template v-if="activeApp">
        <div class="detail">
          <div class="detail__hero" :class="`detail__hero--${statusTone[activeApp.status]}`">
            <div class="detail__avatar">{{ initials(activeApp) }}</div>
            <div class="detail__hero-body">
              <div class="detail__hero-line">{{ activeApp.membershipType }}</div>
              <div class="detail__hero-meta">Applied {{ activeApp.submittedAt }} · {{ activeApp.status === 'pending' ? `waiting ${activeApp.waitingDays}d` : `decided ${activeApp.decidedAt}` }}</div>
            </div>
            <div class="detail__hero-badges">
              <span class="pill" :class="`pill--${statusTone[activeApp.status]}`">{{ statusLabel[activeApp.status] }}</span>
              <span v-if="activeApp.isJunior" class="badge badge--sky">Junior</span>
              <span v-if="activeApp.referredBy" class="badge badge--mute">Referred</span>
              <span v-if="activeApp.interestedIn === 'coaching'" class="badge badge--tangerine">Coach</span>
            </div>
          </div>

          <div class="detail__cols">
            <section class="detail__section">
              <div class="detail__section-title">Contact</div>
              <dl class="dl">
                <div class="dl__row"><dt>Email</dt><dd><a class="link" :href="`mailto:${activeApp.email}`">{{ activeApp.email }}</a></dd></div>
                <div class="dl__row"><dt>Phone</dt><dd><a class="link" :href="`tel:${activeApp.phone.replace(/\s+/g, '')}`">{{ activeApp.phone }}</a></dd></div>
                <div class="dl__row"><dt>Date of birth</dt><dd>{{ activeApp.dob ?? '—' }}</dd></div>
              </dl>
            </section>

            <section class="detail__section">
              <div class="detail__section-title">Application</div>
              <dl class="dl">
                <div class="dl__row"><dt>Membership</dt><dd>{{ activeApp.membershipType }}</dd></div>
                <div class="dl__row"><dt>Submitted</dt><dd>{{ activeApp.submittedAt }}</dd></div>
                <div class="dl__row"><dt>Referred by</dt><dd>{{ activeApp.referredBy ?? '—' }}</dd></div>
                <div v-if="activeApp.status !== 'pending'" class="dl__row"><dt>Decided</dt><dd>{{ activeApp.decidedAt }} · {{ activeApp.decidedBy }}</dd></div>
              </dl>
            </section>
          </div>

          <section v-if="activeApp.notes" class="detail__notes">
            <div class="detail__section-title">Notes from applicant</div>
            <p>{{ activeApp.notes }}</p>
          </section>
        </div>
      </template>

      <template #footer>
        <template v-if="activeApp?.status === 'pending'">
          <button type="button" class="btn btn--decline" @click="updateStatus(activeApp!, 'declined')">Decline</button>
          <button type="button" class="btn btn--approve" @click="updateStatus(activeApp!, 'approved')">Approve</button>
        </template>
        <template v-else>
          <button type="button" class="btn btn--outline" @click="closeDetail">Close</button>
          <button type="button" class="btn btn--ghost" @click="updateStatus(activeApp!, 'pending')">Reopen</button>
        </template>
      </template>
    </CrmModal>
  </div>
</template>

<style scoped>
.apps { max-width: 1280px; display: flex; flex-direction: column; gap: 20px; }
.apps__header { display: flex; align-items: end; justify-content: space-between; gap: 16px; }
.apps__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.apps__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.apps__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin: 0; }
.apps__actions { display: flex; gap: 10px; align-items: center; }
.apps__btn { padding: 9px 14px; background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; font-weight: 500; cursor: pointer; white-space: nowrap; }
.apps__btn:hover { background: var(--color-surface); }

/* Search */
.search { position: relative; display: flex; align-items: center; min-width: 300px; }
.search__icon { position: absolute; left: 12px; color: var(--color-fog); pointer-events: none; }
.search__input { width: 100%; padding: 9px 36px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; }
.search__input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.search__clear { position: absolute; right: 8px; width: 22px; height: 22px; border-radius: 999px; background: var(--color-surface); border: 0; color: var(--color-graphite); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.search__clear:hover { background: var(--color-hairline); color: var(--color-ink); }
.search--mobile { display: none; }

/* Filter chips */
.filters { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.chips { display: flex; gap: 6px; padding: 4px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; width: fit-content; }
.chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border: 0; background: transparent; border-radius: 999px; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); cursor: pointer; }
.chip.is-active { background: #fff; color: var(--color-ink); font-weight: 600; box-shadow: var(--shadow-sm); }
.chip__count { font-family: var(--font-mono); font-size: 10px; padding: 1px 7px; background: var(--color-hairline); color: var(--color-graphite); border-radius: 999px; }
.chip.is-active .chip__count { background: var(--color-accent-soft); color: var(--color-accent); }
.filters__result { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }

/* List */
.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; align-items: center; gap: 16px; padding: 16px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; cursor: pointer; transition: border-color 0.12s ease, box-shadow 0.12s ease; position: relative; }
.row:hover { border-color: var(--color-mute); box-shadow: var(--shadow-sm); }
.row:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.row--urgent { border-left: 3px solid #F59E0B; padding-left: 17px; }
.row__avatar { width: 44px; height: 44px; border-radius: 999px; background: var(--color-graphite); color: #fff; display: flex; align-items: center; justify-content: center; font-family: var(--font-body); font-size: 14px; font-weight: 700; flex-shrink: 0; }
.row__body { flex: 1; min-width: 0; }
.row__name-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.row__name { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-ink); }
.row__badges { display: flex; gap: 4px; flex-wrap: wrap; }
.row__meta { display: flex; gap: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 4px; }
.row__sep { opacity: 0.5; }
.row__notes { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); margin-top: 8px; font-style: italic; }
.row__time { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); white-space: nowrap; text-align: right; flex-shrink: 0; }
.row__time-main { color: var(--color-ink); font-weight: 500; }
.row__time-sub { font-size: 11px; color: var(--color-fog); margin-top: 2px; }
.row__actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
.row__chev { color: var(--color-mute); font-size: 20px; padding-left: 4px; flex-shrink: 0; }

.btn { padding: 8px 14px; border: none; border-radius: 999px; font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.btn--approve { background: var(--color-ink); color: #fff; }
.btn--approve:hover { background: var(--color-graphite); }
.btn--decline { background: transparent; color: var(--color-graphite); border: 1px solid var(--color-hairline); }
.btn--decline:hover { background: var(--color-surface); }
.btn--ghost { background: transparent; color: var(--color-accent); border: 1px solid var(--color-accent-soft); }
.btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.btn--outline:hover { background: var(--color-surface); }

/* Pills — status */
.pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; flex-shrink: 0; }
.pill--ok { background: #DCFCE7; color: #14532D; }
.pill--warn { background: var(--color-accent-soft); color: var(--color-accent); }
.pill--danger { background: #FEE2E2; color: #991B1B; }

/* Badges */
.badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; border: 1px solid transparent; }
.badge--warn      { background: #FEF3C7; color: #92400E; }
.badge--sky       { background: var(--color-sky-4); color: #0369A1; }
.badge--tangerine { background: #FFEDD5; color: var(--color-feature-tangerine); }
.badge--mute      { background: var(--color-surface); color: var(--color-graphite); border-color: var(--color-hairline); }

/* Empty */
.empty { padding: 48px 32px; text-align: center; font-family: var(--font-body); background: #fff; border: 1px dashed var(--color-hairline); border-radius: 14px; }
.empty__title { font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--color-ink); }
.empty__hint { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); margin-top: 4px; }

/* Detail modal */
.detail { display: flex; flex-direction: column; gap: 20px; }
.detail__hero { position: relative; display: flex; align-items: center; gap: 16px; padding: 20px 22px; border-radius: 14px; background: linear-gradient(135deg, var(--color-surface) 0%, #fff 100%); border: 1px solid var(--color-hairline); overflow: hidden; }
.detail__hero::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--color-graphite); }
.detail__hero--ok::before { background: #16A34A; }
.detail__hero--warn::before { background: var(--color-accent); }
.detail__hero--danger::before { background: var(--color-danger); }

.detail__avatar { width: 60px; height: 60px; border-radius: 999px; background: var(--color-ink); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 20px; font-weight: 700; flex-shrink: 0; }
.detail__hero-body { flex: 1; min-width: 0; }
.detail__hero-line { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-ink); }
.detail__hero-meta { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; }
.detail__hero-badges { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; flex-shrink: 0; max-width: 240px; }

.detail__cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 4px 4px 0; }
.detail__section-title { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); margin: 0 0 12px; }

.dl { display: flex; flex-direction: column; margin: 0; }
.dl__row { display: grid; grid-template-columns: 96px 1fr; gap: 12px; padding: 10px 0; border-top: 1px solid var(--color-hairline); align-items: baseline; }
.dl__row:first-child { border-top: 0; padding-top: 0; }
.dl__row:last-child { padding-bottom: 0; }
.dl dt { font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); margin: 0; }
.dl dd { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); margin: 0; word-break: break-word; }
.link { color: var(--color-accent); text-decoration: none; }
.link:hover { text-decoration: underline; }

.detail__notes { padding: 16px 18px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 12px; }
.detail__notes p { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); line-height: 1.6; margin: 8px 0 0; font-style: italic; }

@media (max-width: 900px) {
  .detail__cols { grid-template-columns: 1fr; gap: 20px; }
  .detail__hero { flex-wrap: wrap; }
  .detail__hero-badges { justify-content: flex-start; max-width: none; width: 100%; padding-left: 76px; }
}
@media (max-width: 767px) {
  .apps__header { flex-direction: column; align-items: stretch; gap: 12px; }
  .apps__actions { display: none; }
  .search--mobile { display: flex; min-width: 0; }
  .apps__heading { font-size: 28px; }
  .chips { width: 100%; overflow-x: auto; }
  .row { flex-wrap: wrap; padding: 14px 16px; gap: 12px; }
  .row__body { flex-basis: calc(100% - 60px); min-width: 0; }
  .row__time { flex-basis: 100%; text-align: left; margin-left: 60px; margin-top: -8px; }
  .row__actions { flex-basis: 100%; justify-content: flex-end; }
  .row__chev { display: none; }
}
</style>
