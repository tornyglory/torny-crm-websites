<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { RouterLink } from 'vue-router'
import CrmModal from '@/components/modals/CrmModal.vue'
import { useToast } from '@/composables/useToast'

const toast = useToast()

type MemberStatus = 'Active' | 'Pending' | 'Lapsed'
type MemberRole = 'Player' | 'Committee' | 'Coach' | 'Junior' | 'Volunteer'
type MembershipType = 'Playing member' | 'Social member' | 'Life member' | 'Junior'
type DuesStatus = 'Paid' | 'Due' | 'Overdue'

interface Member {
  id: string
  name: string
  email: string
  phone: string
  role: MemberRole
  status: MemberStatus
  membership: MembershipType
  memberNumber: string
  joinedAt: string
  duesStatus: DuesStatus
  duesNote?: string
  dob?: string
  address?: string
  lastActive: string
  eventsAttended: number
  notes?: string
}

const search = ref('')
const statusFilter = ref<'all' | MemberStatus>('all')

const members = ref<Member[]>([
  { id: '1', name: 'Marcus Tuilagi', email: 'marcus@example.com', phone: '021 555 0101', role: 'Player', status: 'Active', membership: 'Playing member', memberNumber: 'NBC-042', joinedAt: 'Feb 2019', duesStatus: 'Paid', dob: '14 Mar 1988', address: '12 Riverbank Rd, Naenae, Lower Hutt 5011', lastActive: '2h ago', eventsAttended: 24, notes: 'Skips Tuesday nights during rugby season.' },
  { id: '2', name: 'Denise Peters', email: 'denise@example.com', phone: '022 555 0202', role: 'Committee', status: 'Active', membership: 'Life member', memberNumber: 'NBC-006', joinedAt: 'Aug 2004', duesStatus: 'Paid', dob: '2 Nov 1958', address: '48 Fergusson Dr, Upper Hutt 5018', lastActive: '3d ago', eventsAttended: 112, notes: 'Committee treasurer since 2019. Handles Xero reconciliations.' },
  { id: '3', name: 'Tama Wong', email: 'tama@example.com', phone: '027 555 0303', role: 'Coach', status: 'Active', membership: 'Playing member', memberNumber: 'NBC-118', joinedAt: 'Jan 2022', duesStatus: 'Due', duesNote: 'Due 30 Sep', dob: '19 Jul 1979', address: '9 Whakatiki St, Trentham 5018', lastActive: '1d ago', eventsAttended: 47, notes: 'Coaches the junior development squad on Saturday mornings.' },
  { id: '4', name: 'Reggie Harris', email: 'reggie@example.com', phone: '021 555 0404', role: 'Player', status: 'Lapsed', membership: 'Playing member', memberNumber: 'NBC-081', joinedAt: 'Sep 2020', duesStatus: 'Overdue', duesNote: 'Overdue since 1 Aug', dob: '5 Feb 1995', address: '203 Waterloo Rd, Lower Hutt 5011', lastActive: '3 weeks ago', eventsAttended: 8 },
  { id: '5', name: 'Jo Kirk', email: 'jo@example.com', phone: '022 555 0505', role: 'Player', status: 'Active', membership: 'Playing member', memberNumber: 'NBC-097', joinedAt: 'Nov 2021', duesStatus: 'Paid', dob: '22 Sep 1990', address: '17 Miromiro St, Waiwhetu 5011', lastActive: '5h ago', eventsAttended: 33 },
  { id: '6', name: 'Ana Kereopa', email: 'ana@example.com', phone: '021 555 0606', role: 'Junior', status: 'Active', membership: 'Junior', memberNumber: 'NBC-142', joinedAt: 'Mar 2024', duesStatus: 'Paid', dob: '11 Apr 2011', address: '5 Petherick Cres, Wainuiomata 5014', lastActive: '2d ago', eventsAttended: 6, notes: 'Under-14. Parent contact: Manaia Kereopa (021 555 0666).' },
  { id: '7', name: 'Sione Vagana', email: 'sione@example.com', phone: '027 555 0707', role: 'Volunteer', status: 'Active', membership: 'Social member', memberNumber: 'NBC-115', joinedAt: 'Jun 2022', duesStatus: 'Paid', dob: '30 Jan 1972', address: '61 High St, Petone 5012', lastActive: '1w ago', eventsAttended: 18, notes: 'Runs the BBQ every match day.' },
  { id: '8', name: 'Priya Kaur', email: 'priya@example.com', phone: '022 555 0808', role: 'Player', status: 'Pending', membership: 'Playing member', memberNumber: '—', joinedAt: 'Aug 2026', duesStatus: 'Due', duesNote: 'Awaiting first payment', dob: '8 Dec 1993', address: '', lastActive: '—', eventsAttended: 0, notes: 'New applicant, referred by Marcus Tuilagi.' },
])

const counts = computed(() => ({
  all: members.value.length,
  Active: members.value.filter((m) => m.status === 'Active').length,
  Pending: members.value.filter((m) => m.status === 'Pending').length,
  Lapsed: members.value.filter((m) => m.status === 'Lapsed').length,
}))

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return members.value.filter((m) => {
    if (statusFilter.value !== 'all' && m.status !== statusFilter.value) return false
    if (!q) return true
    return (
      m.name.toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q) ||
      m.phone.toLowerCase().includes(q) ||
      m.role.toLowerCase().includes(q) ||
      m.membership.toLowerCase().includes(q) ||
      m.memberNumber.toLowerCase().includes(q)
    )
  })
})

function initials(m: Member) {
  return m.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}

const statusTone: Record<MemberStatus, string> = {
  Active: 'ok',
  Pending: 'warn',
  Lapsed: 'danger',
}

const duesTone: Record<DuesStatus, string> = {
  Paid: 'ok',
  Due: 'warn',
  Overdue: 'danger',
}

function membershipBadge(m: Member): { label: string; tone: string } | null {
  if (m.membership === 'Life member') return { label: 'Life', tone: 'violet' }
  if (m.membership === 'Junior' || m.role === 'Junior') return { label: 'Junior', tone: 'sky' }
  return null
}

function roleBadge(m: Member): { label: string; tone: string } | null {
  if (m.role === 'Committee') return { label: 'Committee', tone: 'ink' }
  if (m.role === 'Coach') return { label: 'Coach', tone: 'tangerine' }
  if (m.role === 'Volunteer') return { label: 'Volunteer', tone: 'mute' }
  return null
}

// ── Detail modal ────────────────────────────────────────────────
const detailOpen = ref(false)
const activeMember = ref<Member | null>(null)

function openDetail(m: Member) {
  activeMember.value = m
  detailOpen.value = true
}
function closeDetail() {
  detailOpen.value = false
}
function messageMember() {
  if (!activeMember.value) return
  toast.info(`Message composer for ${activeMember.value.name} coming next session.`)
}
function editMember() {
  if (!activeMember.value) return
  toast.info(`Edit form for ${activeMember.value.name} coming next session.`)
}

// ── Add member modal ───────────────────────────────────────────
const addOpen = ref(false)
const emptyForm = () => ({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  role: 'Player' as MemberRole,
  membership: 'Playing member' as MembershipType,
  sendInvite: true,
  markPending: true,
})
const form = reactive(emptyForm())

function openAdd() {
  Object.assign(form, emptyForm())
  addOpen.value = true
}
function closeAdd() {
  addOpen.value = false
}

const canSubmit = computed(
  () => form.firstName.trim().length > 0 && form.lastName.trim().length > 0 && form.email.trim().length > 0,
)

function submit() {
  if (!canSubmit.value) return
  members.value.unshift({
    id: `m${Date.now()}`,
    name: `${form.firstName.trim()} ${form.lastName.trim()}`,
    email: form.email.trim(),
    phone: form.phone.trim(),
    role: form.role,
    status: form.markPending ? 'Pending' : 'Active',
    membership: form.membership,
    memberNumber: '—',
    joinedAt: 'Just now',
    duesStatus: 'Due',
    duesNote: 'Awaiting first payment',
    lastActive: '—',
    eventsAttended: 0,
  })
  closeAdd()
  toast.success(`${form.firstName.trim()} added to the roster.`)
}
</script>

<template>
  <div class="members">
    <header class="members__header">
      <div>
        <div class="members__eyebrow">Roster</div>
        <h1 class="members__heading">Members</h1>
        <p class="members__sub">{{ counts.all }} total · {{ counts.Active }} active</p>
      </div>
      <div class="members__actions">
        <div class="search">
          <svg class="search__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            v-model="search"
            placeholder="Search name, email, phone, role…"
            class="search__input"
          />
          <button v-if="search" class="search__clear" aria-label="Clear search" @click="search = ''">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <RouterLink to="/crm/members/import" class="members__btn members__btn--outline">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Import CSV
        </RouterLink>
        <button class="members__btn" @click="openAdd">+ Add member</button>
      </div>
    </header>

    <div class="search search--mobile">
      <svg class="search__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <input v-model="search" placeholder="Search members…" class="search__input" />
      <button v-if="search" class="search__clear" aria-label="Clear search" @click="search = ''">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>

    <div class="filters">
      <div class="chips">
        <button
          v-for="tab in (['all', 'Active', 'Pending', 'Lapsed'] as const)"
          :key="tab"
          class="chip"
          :class="{ 'is-active': statusFilter === tab }"
          @click="statusFilter = tab"
        >
          <span class="chip__label">{{ tab === 'all' ? 'All' : tab }}</span>
          <span class="chip__count">{{ counts[tab] }}</span>
        </button>
      </div>
      <div v-if="search || statusFilter !== 'all'" class="filters__result">
        {{ filtered.length }} of {{ counts.all }}
      </div>
    </div>

    <!-- Desktop table -->
    <table class="table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Membership</th>
          <th>Dues</th>
          <th>Status</th>
          <th aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in filtered" :key="m.id" class="row" tabindex="0" @click="openDetail(m)" @keydown.enter="openDetail(m)">
          <td class="row__name">
            <div class="row__name-inner">
              <div class="row__avatar">{{ initials(m) }}</div>
              <div class="row__name-text">
                <div class="row__name-main">
                  {{ m.name }}
                  <span v-if="membershipBadge(m)" class="badge" :class="`badge--${membershipBadge(m)!.tone}`">{{ membershipBadge(m)!.label }}</span>
                  <span v-if="roleBadge(m)" class="badge" :class="`badge--${roleBadge(m)!.tone}`">{{ roleBadge(m)!.label }}</span>
                </div>
                <div class="row__name-sub">{{ m.memberNumber }} · joined {{ m.joinedAt }}</div>
              </div>
            </div>
          </td>
          <td>{{ m.email }}</td>
          <td>{{ m.membership }}</td>
          <td><span class="pill" :class="`pill--${duesTone[m.duesStatus]}`">{{ m.duesStatus }}</span></td>
          <td><span class="pill" :class="`pill--${statusTone[m.status]}`">{{ m.status }}</span></td>
          <td class="row__chev" aria-hidden="true">›</td>
        </tr>
        <tr v-if="!filtered.length"><td colspan="6" class="empty">Nothing matches. Try clearing the search or filter.</td></tr>
      </tbody>
    </table>

    <!-- Mobile card list -->
    <ul class="cards">
      <li v-for="m in filtered" :key="m.id" class="card" tabindex="0" @click="openDetail(m)" @keydown.enter="openDetail(m)">
        <div class="card__avatar">{{ initials(m) }}</div>
        <div class="card__body">
          <div class="card__name-row">
            <div class="card__name">{{ m.name }}</div>
            <span class="pill" :class="`pill--${statusTone[m.status]}`">{{ m.status }}</span>
          </div>
          <div class="card__badges">
            <span v-if="membershipBadge(m)" class="badge" :class="`badge--${membershipBadge(m)!.tone}`">{{ membershipBadge(m)!.label }}</span>
            <span v-if="roleBadge(m)" class="badge" :class="`badge--${roleBadge(m)!.tone}`">{{ roleBadge(m)!.label }}</span>
            <span v-if="m.duesStatus !== 'Paid'" class="badge" :class="`badge--${duesTone[m.duesStatus]}-soft`">{{ m.duesStatus === 'Overdue' ? 'Dues overdue' : 'Dues due' }}</span>
          </div>
          <div class="card__contact">{{ m.email }}</div>
        </div>
      </li>
      <li v-if="!filtered.length" class="empty">Nothing matches. Try clearing the search or filter.</li>
    </ul>

    <button class="fab" @click="openAdd">+ Add member</button>

    <!-- Member detail modal -->
    <CrmModal
      :open="detailOpen"
      eyebrow="Member"
      :title="activeMember?.name ?? ''"
      width="lg"
      @close="closeDetail"
    >
      <template v-if="activeMember">
        <div class="detail">
          <div class="detail__hero" :class="`detail__hero--${statusTone[activeMember.status]}`">
            <div class="detail__avatar">{{ initials(activeMember) }}</div>
            <div class="detail__hero-body">
              <div class="detail__hero-line">{{ activeMember.membership }} · {{ activeMember.role }}</div>
              <div class="detail__hero-meta">{{ activeMember.memberNumber }} · joined {{ activeMember.joinedAt }}</div>
            </div>
            <div class="detail__hero-badges">
              <span class="pill" :class="`pill--${statusTone[activeMember.status]}`">{{ activeMember.status }}</span>
              <span v-if="membershipBadge(activeMember)" class="badge" :class="`badge--${membershipBadge(activeMember)!.tone}`">{{ membershipBadge(activeMember)!.label }}</span>
              <span v-if="roleBadge(activeMember)" class="badge" :class="`badge--${roleBadge(activeMember)!.tone}`">{{ roleBadge(activeMember)!.label }}</span>
            </div>
          </div>

          <div class="detail__stats">
            <div class="stat" :class="`stat--${duesTone[activeMember.duesStatus]}`">
              <div class="stat__value">{{ activeMember.duesStatus }}</div>
              <div class="stat__label">Dues</div>
              <div v-if="activeMember.duesNote" class="stat__hint">{{ activeMember.duesNote }}</div>
            </div>
            <div class="stat">
              <div class="stat__value">{{ activeMember.eventsAttended }}</div>
              <div class="stat__label">Events attended</div>
            </div>
            <div class="stat">
              <div class="stat__value">{{ activeMember.lastActive }}</div>
              <div class="stat__label">Last active</div>
            </div>
          </div>

          <div class="detail__cols">
            <section class="detail__section">
              <div class="detail__section-title">Contact</div>
              <dl class="dl">
                <div class="dl__row"><dt>Email</dt><dd><a class="link" :href="`mailto:${activeMember.email}`">{{ activeMember.email }}</a></dd></div>
                <div class="dl__row"><dt>Phone</dt><dd v-if="activeMember.phone"><a class="link" :href="`tel:${activeMember.phone.replace(/\s+/g, '')}`">{{ activeMember.phone }}</a></dd><dd v-else class="dl__empty">—</dd></div>
                <div class="dl__row"><dt>Date of birth</dt><dd>{{ activeMember.dob ?? '—' }}</dd></div>
                <div class="dl__row"><dt>Address</dt><dd>{{ activeMember.address || '—' }}</dd></div>
              </dl>
            </section>

            <section class="detail__section">
              <div class="detail__section-title">Membership</div>
              <dl class="dl">
                <div class="dl__row"><dt>Type</dt><dd>{{ activeMember.membership }}</dd></div>
                <div class="dl__row"><dt>Member #</dt><dd class="dl__mono">{{ activeMember.memberNumber }}</dd></div>
                <div class="dl__row"><dt>Joined</dt><dd>{{ activeMember.joinedAt }}</dd></div>
                <div class="dl__row"><dt>Role</dt><dd>{{ activeMember.role }}</dd></div>
              </dl>
            </section>
          </div>

          <section v-if="activeMember.notes" class="detail__notes">
            <div class="detail__section-title">Notes</div>
            <p>{{ activeMember.notes }}</p>
          </section>
        </div>
      </template>

      <template #footer>
        <button type="button" class="btn btn--outline" @click="messageMember">Send message</button>
        <button type="button" class="btn btn--primary" @click="editMember">Edit member</button>
      </template>
    </CrmModal>

    <!-- Add member modal -->
    <CrmModal
      :open="addOpen"
      eyebrow="Roster"
      title="Add a member"
      width="md"
      @close="closeAdd"
    >
      <form class="form" @submit.prevent="submit">
        <div class="form__row">
          <label class="field">
            <span class="field__label">First name</span>
            <input v-model="form.firstName" type="text" autofocus />
          </label>
          <label class="field">
            <span class="field__label">Last name</span>
            <input v-model="form.lastName" type="text" />
          </label>
        </div>
        <label class="field">
          <span class="field__label">Email</span>
          <input v-model="form.email" type="email" placeholder="member@example.com" />
        </label>
        <div class="form__row">
          <label class="field">
            <span class="field__label">Phone</span>
            <input v-model="form.phone" type="tel" placeholder="021 555 0000" />
          </label>
          <label class="field">
            <span class="field__label">Role</span>
            <select v-model="form.role">
              <option>Player</option>
              <option>Committee</option>
              <option>Coach</option>
              <option>Junior</option>
              <option>Volunteer</option>
            </select>
          </label>
        </div>
        <label class="field">
          <span class="field__label">Membership</span>
          <select v-model="form.membership">
            <option>Playing member</option>
            <option>Social member</option>
            <option>Life member</option>
            <option>Junior</option>
          </select>
        </label>

        <div class="switch-row">
          <div>
            <div class="switch-row__label">Send an email invite</div>
            <div class="switch-row__hint">Prompts them to set a password and download the Torny app.</div>
          </div>
          <button
            type="button"
            class="switch"
            :class="{ 'is-on': form.sendInvite }"
            @click="form.sendInvite = !form.sendInvite"
          ><span class="switch__knob" /></button>
        </div>
        <div class="switch-row">
          <div>
            <div class="switch-row__label">Mark as pending</div>
            <div class="switch-row__hint">They'll appear as pending until they confirm dues.</div>
          </div>
          <button
            type="button"
            class="switch"
            :class="{ 'is-on': form.markPending }"
            @click="form.markPending = !form.markPending"
          ><span class="switch__knob" /></button>
        </div>
      </form>

      <template #footer>
        <button type="button" class="btn btn--outline" @click="closeAdd">Cancel</button>
        <button
          type="button"
          class="btn btn--primary"
          :disabled="!canSubmit"
          @click="submit"
        >Add member</button>
      </template>
    </CrmModal>
  </div>
</template>

<style scoped>
.members { max-width: 1280px; display: flex; flex-direction: column; gap: 20px; }

.members__header { display: flex; align-items: end; justify-content: space-between; gap: 16px; }
.members__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.members__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.members__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin: 0; }
.members__actions { display: flex; gap: 10px; align-items: center; }
.members__btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; background: var(--color-ink); color: #fff; border: none; border-radius: 10px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; text-decoration: none; }
.members__btn:hover { background: var(--color-graphite); }
.members__btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.members__btn--outline:hover { background: var(--color-surface); }

/* Search field */
.search { position: relative; display: flex; align-items: center; min-width: 320px; }
.search__icon { position: absolute; left: 12px; color: var(--color-fog); pointer-events: none; }
.search__input { width: 100%; padding: 9px 36px 9px 36px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; }
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

/* Table */
.table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; overflow: hidden; }
.table th { text-align: left; padding: 12px 16px; font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.12em; color: var(--color-fog); text-transform: uppercase; background: var(--color-surface); border-bottom: 1px solid var(--color-hairline); }
.table td { padding: 14px 16px; font-family: var(--font-body); font-size: 14px; color: var(--color-ink); border-bottom: 1px solid var(--color-hairline); }
.table tbody tr:last-child td { border-bottom: none; }
.table tbody tr.row { cursor: pointer; transition: background-color 0.12s ease; }
.table tbody tr.row:hover { background: var(--color-surface); }
.table tbody tr.row:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; }

.row__name-inner { display: flex; align-items: center; gap: 12px; }
.row__avatar { width: 36px; height: 36px; border-radius: 999px; background: var(--color-graphite); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-body); font-size: 12px; font-weight: 700; flex-shrink: 0; }
.row__name-text { min-width: 0; }
.row__name-main { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-family: var(--font-display); font-size: 14px; font-weight: 600; color: var(--color-ink); }
.row__name-sub { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 2px; }
.row__chev { text-align: right; color: var(--color-mute); font-size: 18px; padding-right: 20px; width: 24px; }

/* Cards (mobile) */
.cards { display: none; list-style: none; padding: 0; margin: 0; flex-direction: column; gap: 8px; }
.card { display: flex; align-items: center; gap: 14px; padding: 14px 16px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; cursor: pointer; }
.card:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.card__avatar { width: 44px; height: 44px; border-radius: 999px; background: var(--color-graphite); color: #fff; display: flex; align-items: center; justify-content: center; font-family: var(--font-body); font-size: 13px; font-weight: 700; flex-shrink: 0; }
.card__body { flex: 1; min-width: 0; }
.card__name-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.card__name { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--color-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card__badges { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
.card__contact { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Pills — status */
.pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; flex-shrink: 0; }
.pill--ok { background: #DCFCE7; color: #14532D; }
.pill--warn { background: var(--color-accent-soft); color: var(--color-accent); }
.pill--danger { background: #FEE2E2; color: #991B1B; }

/* Badges — role/membership */
.badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; border: 1px solid transparent; }
.badge--ink       { background: var(--color-ink); color: #fff; }
.badge--violet    { background: #F3E8FF; color: var(--color-feature-violet); }
.badge--tangerine { background: #FFEDD5; color: var(--color-feature-tangerine); }
.badge--sky       { background: var(--color-sky-4); color: #0369A1; }
.badge--mute      { background: var(--color-surface); color: var(--color-graphite); border-color: var(--color-hairline); }
.badge--warn-soft { background: #FEF3C7; color: #92400E; }
.badge--danger-soft { background: #FEE2E2; color: #991B1B; }

.empty { padding: 32px; text-align: center; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); background: var(--color-surface); }

.fab { display: none; position: fixed; right: 20px; bottom: 84px; padding: 14px 20px; background: var(--color-ink); color: #fff; border: none; border-radius: 999px; font-family: var(--font-body); font-size: 14px; font-weight: 600; box-shadow: var(--shadow-lg); cursor: pointer; z-index: 10; }

/* Detail modal */
.detail { display: flex; flex-direction: column; gap: 20px; }

/* Hero — avatar, meta on the left; badges on the right */
.detail__hero { position: relative; display: flex; align-items: center; gap: 16px; padding: 20px 22px; border-radius: 14px; background: linear-gradient(135deg, var(--color-surface) 0%, #fff 100%); border: 1px solid var(--color-hairline); overflow: hidden; }
.detail__hero::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--color-graphite); }
.detail__hero--ok::before { background: #16A34A; }
.detail__hero--warn::before { background: var(--color-accent); }
.detail__hero--danger::before { background: var(--color-danger); }

.detail__avatar { width: 60px; height: 60px; border-radius: 999px; background: var(--color-ink); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: -0.01em; flex-shrink: 0; }
.detail__hero-body { flex: 1; min-width: 0; }
.detail__hero-line { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-ink); }
.detail__hero-meta { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; }
.detail__hero-badges { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; flex-shrink: 0; max-width: 220px; }

/* Stat strip */
.detail__stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.stat { background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 2px; }
.stat__value { font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); line-height: 1.15; }
.stat__label { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: var(--color-fog); text-transform: uppercase; margin-top: 4px; }
.stat__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 2px; }
.stat--ok { background: #F0FDF4; border-color: #BBF7D0; }
.stat--ok .stat__value { color: #14532D; }
.stat--warn { background: #FFFBEB; border-color: #FDE68A; }
.stat--warn .stat__value { color: #92400E; }
.stat--danger { background: #FEF2F2; border-color: #FECACA; }
.stat--danger .stat__value { color: #991B1B; }

/* Two-column info */
.detail__cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 4px 4px 0; }
.detail__section-title { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); margin: 0 0 12px; }

.dl { display: flex; flex-direction: column; margin: 0; }
.dl__row { display: grid; grid-template-columns: 96px 1fr; gap: 12px; padding: 10px 0; border-top: 1px solid var(--color-hairline); align-items: baseline; }
.dl__row:first-child { border-top: 0; padding-top: 0; }
.dl__row:last-child { padding-bottom: 0; }
.dl dt { font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); margin: 0; }
.dl dd { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); margin: 0; word-break: break-word; }
.dl__mono { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.02em; }
.dl__empty { color: var(--color-fog); }

.link { color: var(--color-accent); text-decoration: none; }
.link:hover { text-decoration: underline; }

.detail__notes { padding: 16px 18px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 12px; }
.detail__notes p { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); line-height: 1.6; margin: 8px 0 0; font-style: italic; }

/* Modal form */
.form { display: flex; flex-direction: column; gap: 14px; }
.form__row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.field input, .field select { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; }
.field input:focus, .field select:focus { outline: none; border-color: var(--color-ink); }

.switch-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 0; border-top: 1px solid var(--color-hairline); }
.switch-row__label { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.switch-row__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; }
.switch { width: 40px; height: 24px; padding: 3px; border-radius: 999px; background: var(--color-hairline); border: 0; display: flex; cursor: pointer; flex-shrink: 0; }
.switch.is-on { background: var(--color-ink); }
.switch__knob { width: 18px; height: 18px; border-radius: 999px; background: #fff; transition: transform 0.15s ease; }
.switch.is-on .switch__knob { transform: translateX(16px); }

.btn { padding: 9px 16px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: 0; }
.btn--primary { background: var(--color-ink); color: #fff; }
.btn--primary:hover:not(:disabled) { background: var(--color-graphite); }
.btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.btn--outline:hover { background: var(--color-surface); }

@media (max-width: 900px) {
  .detail__cols { grid-template-columns: 1fr; gap: 20px; }
  .detail__hero { flex-wrap: wrap; }
  .detail__hero-badges { justify-content: flex-start; max-width: none; width: 100%; padding-left: 76px; margin-top: -4px; }
}

@media (max-width: 767px) {
  .members__header { align-items: stretch; }
  .members__heading { font-size: 28px; }
  .members__actions { display: none; }
  .search--mobile { display: flex; min-width: 0; }
  .table { display: none; }
  .cards { display: flex; }
  .fab { display: inline-block; }
  .form__row { grid-template-columns: 1fr; }
  .detail__hero { align-items: flex-start; padding: 16px 16px; }
  .detail__avatar { width: 52px; height: 52px; font-size: 18px; }
  .detail__hero-badges { padding-left: 68px; }
  .detail__stats { grid-template-columns: 1fr; }
  .dl__row { grid-template-columns: 88px 1fr; gap: 8px; }
}
</style>
