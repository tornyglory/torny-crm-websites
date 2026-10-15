<script setup lang="ts">
/**
 * Member detail page — replaces the old modal. Follows Paper design 33:
 * sticky sub-header (breadcrumb + prev/next + primary actions), a hero
 * card with avatar + standing + big owing amount on the right, and a
 * two-column body (payments table + communications/notes rail).
 *
 * The tabs land on Payments; Communications / Notes / Settings ship as
 * empty states until their backend briefs land.
 *
 * BEM block: `member-detail`.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  members as membersApi,
  ApiError,
  type RosterMember,
  type MemberRole,
  type MembershipStatus,
  type MembershipTierListItem,
  type PlayingLevel,
  type PositionGroup,
  type PreferredPosition,
  type UpdateMemberPatch,
  type UpdateMemberErrorCode,
} from '@torny/api-client'
import { useClubStore } from '@/stores/club'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import CrmModal from '@/components/modals/CrmModal.vue'
import CrmSkeleton from '@/components/CrmSkeleton.vue'
import CrmEmptyState from '@/components/CrmEmptyState.vue'

const route = useRoute()
const router = useRouter()
const clubStore = useClubStore()
const authStore = useAuthStore()
const toast = useToast()

type Tab = 'payments' | 'communications' | 'notes' | 'settings'
type StandingTone = 'paid' | 'due' | 'overdue' | 'waived' | 'partial' | 'invited' | 'lapsed' | 'none'
interface Standing { tone: StandingTone; label: string; sub: string }

const memberId = computed(() => Number(route.params.id ?? 0))

// ── Data ─────────────────────────────────────────────────────────
const roster = ref<RosterMember[]>([])
const rosterLoading = ref(false)
const rosterError = ref<string | null>(null)
const activeTab = ref<Tab>('payments')

const member = computed<RosterMember | null>(() => {
  const id = memberId.value
  if (!id) return null
  return roster.value.find((m) => m.user_id === id) ?? null
})

const memberIndex = computed(() =>
  member.value ? roster.value.findIndex((m) => m.user_id === member.value!.user_id) : -1,
)
const prevMember = computed<RosterMember | null>(() => {
  if (memberIndex.value <= 0) return null
  return roster.value[memberIndex.value - 1] ?? null
})
const nextMember = computed<RosterMember | null>(() => {
  if (memberIndex.value < 0 || memberIndex.value >= roster.value.length - 1) return null
  return roster.value[memberIndex.value + 1] ?? null
})

async function loadRoster() {
  const cid = clubStore.current?.id
  if (cid == null) return
  rosterLoading.value = true
  rosterError.value = null
  try {
    const res = await membersApi.listRoster(cid, { limit: 200, include_invites: false })
    roster.value = res.members
  } catch (err) {
    rosterError.value = err instanceof Error ? err.message : 'Failed to load member'
  } finally {
    rosterLoading.value = false
  }
}

onMounted(loadRoster)
watch(() => clubStore.current?.id, loadRoster)

// ── Derived member view fields ────────────────────────────────────
const initials = computed(() => {
  const name = member.value?.name ?? ''
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?'
})

const MONTH_YEAR = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' })
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
function fmtShort(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : SHORT_DATE.format(d)
}
function fmtMonthYear(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : MONTH_YEAR.format(d)
}

const CADENCE_SUFFIX: Record<string, string> = { annual: '/yr', monthly: '/mo', season: '/season' }
const feeLabel = computed(() => {
  const m = member.value
  if (!m?.membership?.fee) return ''
  const suffix = m.membership.cadence ? CADENCE_SUFFIX[m.membership.cadence] : ''
  return suffix ? `$${m.membership.fee}${suffix}` : `$${m.membership.fee}`
})

const standing = computed<Standing>(() => {
  const m = member.value
  if (!m) return { tone: 'none', label: 'Unknown', sub: '' }
  if (m.computed_status === 'lapsed') {
    const on = fmtShort(m.revoked_at)
    return { tone: 'lapsed', label: 'Lapsed', sub: on ? `Left ${on}` : 'No active membership' }
  }
  const p = m.membership?.payment_status
  if (m.computed_status === 'pending' && (p == null || p === 'unpaid')) {
    return { tone: 'invited', label: 'Invited', sub: 'Invite sent · not yet accepted' }
  }
  if (p === 'waived') return { tone: 'waived', label: 'Waived', sub: 'Fees waived' }
  if (p === 'overdue') {
    const since = fmtShort(m.membership?.payment_due_date)
    const fee = m.membership?.fee
    return {
      tone: 'overdue',
      label: fee != null ? `Overdue · $${fee}` : 'Overdue',
      sub: since ? `Due ${since} · overdue` : 'Payment overdue',
    }
  }
  if (p === 'partial') {
    const fee = m.membership?.fee ?? 0
    return {
      tone: 'partial',
      label: `Partial · $${fee}`,
      sub: 'Some payment recorded',
    }
  }
  if (p === 'paid') {
    const on = fmtShort(m.membership?.last_payment_date)
    const fee = m.membership?.fee
    return {
      tone: 'paid',
      label: fee != null ? `Paid · $${fee}` : 'Paid',
      sub: on ? `Last paid ${on}` : 'Up to date',
    }
  }
  if (p === 'unpaid') {
    const on = fmtShort(m.membership?.payment_due_date)
    const fee = m.membership?.fee
    return {
      tone: 'due',
      label: fee != null ? `Due · $${fee}` : 'Due',
      sub: on ? `Due ${on}` : 'Payment due',
    }
  }
  return { tone: 'none', label: 'No tier', sub: 'No membership assigned' }
})

const owingAmount = computed<number | null>(() => {
  const m = member.value?.membership
  if (!m) return null
  // Prefer server balance; otherwise infer.
  const status = m.payment_status
  if (status === 'waived' || status === 'paid') return 0
  const fee = m.fee ?? 0
  return fee
})

// ── Navigation ────────────────────────────────────────────────────
function goToMember(id: number) {
  router.push({ name: 'member-detail', params: { id: String(id) } })
}
function goPrev() { if (prevMember.value) goToMember(prevMember.value.user_id) }
function goNext() { if (nextMember.value) goToMember(nextMember.value.user_id) }
function goBack() { router.push({ name: 'members' }) }

// ── Actions ───────────────────────────────────────────────────────
const markingPaid = ref(false)
async function markPaid() {
  const m = member.value
  const cid = clubStore.current?.id
  if (!m || cid == null || !m.membership?.fee) return
  if (m.membership.payment_status === 'paid' || m.membership.payment_status === 'waived') {
    toast.info('Already paid up.')
    return
  }
  markingPaid.value = true
  try {
    await membersApi.recordPayment(cid, m.user_id, {
      amount: m.membership.fee,
      payment_method: 'cash',
    })
    toast.success('Payment recorded.')
    await loadRoster()
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : (err instanceof Error ? err.message : 'Could not record payment.')
    toast.info(msg)
  } finally {
    markingPaid.value = false
  }
}

function sendEmail() {
  const email = member.value?.email
  if (!email) return
  window.location.href = `mailto:${email}`
}
function logNote() {
  toast.info('Logging notes ships with the Communications brief.')
}

// ── Payments history (from what the roster row exposes) ───────────
interface PaymentRow {
  id: string
  date: string
  description: string
  amount: number
  status: 'paid' | 'due' | 'overdue' | 'waived'
  method?: string
}
const paymentHistory = computed<PaymentRow[]>(() => {
  const m = member.value
  if (!m?.membership) return []
  const rows: PaymentRow[] = []
  if (m.membership.last_payment_date && m.membership.last_payment_amount) {
    rows.push({
      id: 'last',
      date: fmtShort(m.membership.last_payment_date),
      description: `${m.membership.type_name ?? 'Membership'} fee`,
      amount: m.membership.last_payment_amount,
      status: 'paid',
    })
  }
  if (
    m.membership.payment_status === 'unpaid' ||
    m.membership.payment_status === 'overdue' ||
    m.membership.payment_status === 'partial'
  ) {
    rows.push({
      id: 'current',
      date: fmtShort(m.membership.payment_due_date) || 'Current period',
      description: `${m.membership.type_name ?? 'Membership'} fee`,
      amount: m.membership.fee ?? 0,
      status: m.membership.payment_status === 'overdue' ? 'overdue' : 'due',
    })
  }
  return rows
})
const totalCollected = computed(() =>
  paymentHistory.value.filter((r) => r.status === 'paid').reduce((sum, r) => sum + r.amount, 0),
)

// ── Auth gating ───────────────────────────────────────────────────
const callerCanEdit = computed(() => {
  const cid = clubStore.current?.id
  if (cid == null) return false
  return authStore.user?.clubs?.some((c) => c.id === cid && (c.role === 'owner' || c.role === 'admin')) ?? false
})

const TABS: { value: Tab; label: string; count?: number }[] = [
  { value: 'payments', label: 'Payments' },
  { value: 'communications', label: 'Communications' },
  { value: 'notes', label: 'Notes' },
  { value: 'settings', label: 'Settings' },
]

// ── Edit modal ────────────────────────────────────────────────────
// One PATCH posts the whole 12-field Member Detail form. Fields split
// into Identity (users), Roster (club_members), Billing (club_memberships).

const editOpen = ref(false)
const editSaving = ref(false)
const editErrorBanner = ref<string | null>(null)
/** Inline per-field errors — surfaced near each input on 400/409. */
const editFieldErrors = reactive<Record<string, string | null>>({
  email: null,
  dob: null,
  joined_date: null,
  payment_due_date: null,
})

const PREFERRED_POSITIONS: PreferredPosition[] = ['Lead', 'Second', 'Third', 'Skip', 'Singles']
const PLAYING_LEVELS: PlayingLevel[] = ['A', 'B', 'C']
const POSITION_GROUPS: PositionGroup[] = ['board', 'staff', 'committee', 'member']
const MEMBERSHIP_STATUSES: MembershipStatus[] = ['active', 'inactive', 'suspended', 'expired', 'pending_payment']

const tiers = ref<MembershipTierListItem[]>([])
async function loadTiers() {
  const cid = clubStore.current?.id
  if (cid == null) { tiers.value = []; return }
  try {
    const res = await membersApi.listTiers(cid)
    tiers.value = res.tiers
  } catch {
    tiers.value = []
  }
}

interface EditForm {
  name: string
  email: string
  phone: string
  address: string
  dob: string
  role: MemberRole
  title: string
  position_group: PositionGroup
  public_visible: boolean
  bio: string
  preferred_position: PreferredPosition | ''
  playing_level: PlayingLevel | ''
  membership_type_id: number | null
  status: MembershipStatus | ''
  joined_date: string
  payment_due_date: string
}

const editForm = reactive<EditForm>({
  name: '', email: '', phone: '', address: '', dob: '',
  role: 'player', title: '', position_group: 'member', public_visible: true, bio: '',
  preferred_position: '', playing_level: '',
  membership_type_id: null, status: '', joined_date: '', payment_due_date: '',
})

/** Snapshot of the form at modal-open — used to compute the PATCH diff. */
let editOriginal: EditForm | null = null

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return ''
  // Backend returns full ISO ("1988-04-12T00:00:00.000Z") or `YYYY-MM-DD`.
  return iso.slice(0, 10)
}

function openEdit() {
  const m = member.value
  if (!m) return
  Object.assign(editForm, {
    name:               m.name,
    email:              m.email ?? '',
    phone:              m.phone ?? '',
    address:            m.address ?? '',
    dob:                toDateInput(m.dob),
    role:               m.club_role === 'owner' ? 'owner' : m.club_role,
    title:              m.title ?? '',
    position_group:     m.position_group ?? 'member',
    public_visible:     m.public_visible ?? true,
    bio:                m.bio ?? '',
    preferred_position: '',   // not currently on RosterMember — admin fills fresh
    playing_level:      '',   // same
    membership_type_id: m.membership?.type_id ?? null,
    status:             m.membership?.status ?? '',
    joined_date:        toDateInput(m.joined_at),
    payment_due_date:   toDateInput(m.membership?.payment_due_date),
  })
  editOriginal = { ...editForm }
  editErrorBanner.value = null
  Object.keys(editFieldErrors).forEach((k) => { editFieldErrors[k] = null })
  if (tiers.value.length === 0) void loadTiers()
  editOpen.value = true
}

function closeEdit() {
  editOpen.value = false
}

/** Diff + null-handling. Only sends fields the admin actually changed. */
function buildPatchDiff(): UpdateMemberPatch {
  if (!editOriginal) return {}
  const patch: UpdateMemberPatch = {}
  const o = editOriginal
  const f = editForm
  // Identity — empty string clears nullable fields; `name` + `email` can't be null
  if (f.name !== o.name) patch.name = f.name.trim()
  if (f.email !== o.email) patch.email = f.email.trim()
  if (f.phone !== o.phone) patch.phone = f.phone.trim() === '' ? null : f.phone.trim()
  if (f.address !== o.address) patch.address = f.address.trim() === '' ? null : f.address.trim()
  if (f.dob !== o.dob) patch.dob = f.dob === '' ? null : f.dob
  // Roster
  if (f.role !== o.role) patch.role = f.role
  if (f.title !== o.title) patch.title = f.title.trim() === '' ? null : f.title.trim()
  if (f.position_group !== o.position_group) patch.position_group = f.position_group
  if (f.public_visible !== o.public_visible) patch.public_visible = f.public_visible
  if (f.bio !== o.bio) patch.bio = f.bio.trim() === '' ? null : f.bio.trim()
  if (f.preferred_position !== o.preferred_position) {
    patch.preferred_position = f.preferred_position === '' ? null : f.preferred_position
  }
  if (f.playing_level !== o.playing_level) {
    patch.playing_level = f.playing_level === '' ? null : f.playing_level
  }
  // Billing
  if (f.membership_type_id !== o.membership_type_id) patch.membership_type_id = f.membership_type_id
  if (f.status !== o.status && f.status !== '') patch.status = f.status
  if (f.joined_date !== o.joined_date) patch.joined_date = f.joined_date === '' ? null : f.joined_date
  if (f.payment_due_date !== o.payment_due_date) patch.payment_due_date = f.payment_due_date === '' ? null : f.payment_due_date
  return patch
}

/** `no_membership_row` fires if we touch billing fields without an existing
 *  row and no `membership_type_id` to create one. Backfill the tier id if
 *  the user set it earlier via the dropdown but didn't change it this time. */
function ensureBillingHasTier(patch: UpdateMemberPatch) {
  const touchesBilling =
    patch.status !== undefined ||
    patch.joined_date !== undefined ||
    patch.payment_due_date !== undefined
  if (!touchesBilling) return
  const hasRow = member.value?.membership != null
  if (hasRow) return
  if (patch.membership_type_id == null && editForm.membership_type_id != null) {
    patch.membership_type_id = editForm.membership_type_id
  }
}

async function submitEdit() {
  const cid = clubStore.current?.id
  const uid = member.value?.user_id
  if (cid == null || uid == null) return
  const patch = buildPatchDiff()
  if (Object.keys(patch).length === 0) {
    closeEdit()
    return
  }
  ensureBillingHasTier(patch)
  editErrorBanner.value = null
  Object.keys(editFieldErrors).forEach((k) => { editFieldErrors[k] = null })
  editSaving.value = true
  try {
    const res = await membersApi.patchMember(cid, uid, patch)
    // Merge the full echoed state back onto the local roster entry so
    // the page re-renders without a round-trip. The backend returns a
    // flat UpdateMemberResponse that lines up with RosterMember on the
    // fields that overlap — the ones that don't (handle, avatar, etc.)
    // weren't touched by the PATCH.
    const idx = roster.value.findIndex((m) => m.user_id === uid)
    if (idx >= 0) {
      roster.value[idx] = {
        ...roster.value[idx]!,
        name:             res.name,
        email:            res.email,
        phone:            res.phone,
        address:          res.address,
        dob:              res.dob,
        club_role:        res.role,
        title:            res.title,
        position_group:   res.position_group,
        public_visible:   res.public_visible,
        bio:              res.bio,
        membership:       res.membership,
      }
    }
    toast.success('Member updated.')
    closeEdit()
  } catch (err) {
    const code = err instanceof ApiError ? (err.code as UpdateMemberErrorCode | undefined) : undefined
    switch (code) {
      case 'email_in_use':
        editFieldErrors.email = 'That email is already in use.'
        break
      case 'invalid_email':
        editFieldErrors.email = 'That email format is invalid.'
        break
      case 'invalid_dob':
        editFieldErrors.dob = 'Date of birth must be a valid date.'
        break
      case 'invalid_joined_date':
        editFieldErrors.joined_date = 'Joined date must be a valid date.'
        break
      case 'invalid_payment_due_date':
        editFieldErrors.payment_due_date = 'Payment due date must be a valid date.'
        break
      case 'no_membership_row':
        editErrorBanner.value = 'Pick a membership tier before setting status, join date, or payment due date.'
        break
      case 'owner_immutable':
        editErrorBanner.value = "The club owner's role can only be changed via Transfer ownership."
        break
      case 'member_revoked':
        editErrorBanner.value = 'This member has been removed from the club.'
        break
      default:
        editErrorBanner.value = err instanceof Error ? err.message : 'Could not save changes.'
    }
  } finally {
    editSaving.value = false
  }
}
</script>

<template>
  <div class="member-detail">
    <!-- Sub-header: breadcrumb + prev/next + primary actions. Sticky so
         it stays on top while the body scrolls. -->
    <header class="member-detail__topbar">
      <div class="member-detail__crumbs">
        <button type="button" class="member-detail__crumb-back" @click="goBack">Members</button>
        <span class="member-detail__crumb-divider" aria-hidden="true">/</span>
        <span class="member-detail__crumb-current">{{ member?.name ?? '…' }}</span>
      </div>
      <div class="member-detail__nav">
        <button
          type="button"
          class="member-detail__nav-btn"
          :disabled="!prevMember"
          aria-label="Previous member"
          @click="goPrev"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
            <path d="M10 4l-4 4 4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button
          type="button"
          class="member-detail__nav-btn"
          :disabled="!nextMember"
          aria-label="Next member"
          @click="goNext"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
            <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <span v-if="memberIndex >= 0 && roster.length > 0" class="member-detail__nav-pos">
          {{ memberIndex + 1 }} of {{ roster.length }}
        </span>
      </div>
      <div class="member-detail__actions">
        <button type="button" class="btn btn--ghost" @click="logNote">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 3h7l3 3v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 3v3h3" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
          Log note
        </button>
        <button type="button" class="btn btn--outline" :disabled="!member?.email" @click="sendEmail">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="3.5" width="12" height="9" rx="1.5" stroke="currentColor" stroke-width="1.6"/><path d="M2.5 4.5 8 9l5.5-4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Send email
        </button>
        <button
          v-if="callerCanEdit"
          type="button"
          class="btn btn--outline"
          :disabled="!member"
          @click="openEdit"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M11 2.5l2.5 2.5-8 8-3 .5.5-3 8-8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
          Edit
        </button>
        <button
          v-if="callerCanEdit"
          type="button"
          class="btn btn--primary"
          :disabled="markingPaid || !member?.membership?.fee"
          @click="markPaid"
        >
          {{ markingPaid ? 'Recording…' : 'Mark paid' }}
        </button>
      </div>
    </header>

    <!-- Body: hero + two-column layout -->
    <div class="member-detail__body">
      <!-- Skeleton while loading -->
      <div v-if="rosterLoading && !member" class="member-detail__hero member-detail__hero--sk" aria-busy="true">
        <CrmSkeleton shape="circle" width="88px" height="88px" />
        <div class="member-detail__hero-body-sk">
          <CrmSkeleton shape="text" width="240px" height="26px" />
          <CrmSkeleton shape="text" width="60%" height="14px" />
          <CrmSkeleton shape="text" width="45%" height="14px" />
        </div>
      </div>

      <!-- Not found -->
      <CrmEmptyState
        v-else-if="!rosterLoading && !member"
        class="member-detail__nomatch"
        variant="empty"
        title="Member not found"
        :description="rosterError ?? 'They may have been removed or you have no access. Head back to the roster to try again.'"
        action-label="Back to members"
        @action="goBack"
      />

      <template v-else-if="member">
        <!-- Hero card -->
        <section class="member-detail__hero">
          <div class="member-detail__avatar" :class="{ 'member-detail__avatar--image': member.avatar_url }">
            <img v-if="member.avatar_url" :src="member.avatar_url" :alt="member.name" />
            <template v-else>{{ initials }}</template>
          </div>
          <div class="member-detail__hero-body">
            <div class="member-detail__hero-line">
              <h1 class="member-detail__name">{{ member.name }}</h1>
              <span class="standing-pill" :class="`standing-pill--${standing.tone}`">{{ standing.label }}</span>
            </div>
            <div class="member-detail__hero-contact">
              <span v-if="member.email" class="member-detail__contact-item">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="3.5" width="12" height="9" rx="1.5" stroke="currentColor" stroke-width="1.6"/><path d="M2.5 4.5 8 9l5.5-4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                <a :href="`mailto:${member.email}`">{{ member.email }}</a>
              </span>
              <span v-if="member.phone" class="member-detail__contact-item">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 2.5h2.5l1 3.5-1.5 1a8 8 0 0 0 3.5 3.5l1-1.5 3.5 1V13a1 1 0 0 1-1 1A11 11 0 0 1 2.5 3.5a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
                <a :href="`tel:${member.phone.replace(/\s+/g, '')}`">{{ member.phone }}</a>
              </span>
            </div>
            <div class="member-detail__hero-meta">
              <span v-if="member.membership?.type_name" class="member-detail__tier">{{ member.membership.type_name }}</span>
              <span v-if="feeLabel" class="member-detail__meta-dot">·</span>
              <span v-if="feeLabel" class="member-detail__fee">{{ feeLabel }}</span>
              <span v-if="member.joined_at" class="member-detail__meta-dot">·</span>
              <span v-if="member.joined_at">Joined {{ fmtMonthYear(member.joined_at) }}</span>
              <span v-if="member.member_number != null" class="member-detail__meta-dot">·</span>
              <span v-if="member.member_number != null" class="member-detail__member-no">#{{ member.member_number }}</span>
            </div>
          </div>
          <div class="member-detail__owing" v-if="owingAmount != null">
            <div class="member-detail__owing-label">
              {{ owingAmount > 0 ? 'Owing' : 'Balance' }}
            </div>
            <div class="member-detail__owing-value" :class="{ 'member-detail__owing-value--danger': owingAmount > 0 && standing.tone === 'overdue' }">
              ${{ owingAmount }}
            </div>
            <div class="member-detail__owing-sub">{{ standing.sub }}</div>
          </div>
        </section>

        <!-- Two-column: main + rail -->
        <div class="member-detail__cols">
          <section class="member-detail__main">
            <nav class="member-detail__tabs" role="tablist">
              <button
                v-for="t in TABS"
                :key="t.value"
                role="tab"
                class="member-detail__tab"
                :class="{ 'is-active': activeTab === t.value }"
                :aria-selected="activeTab === t.value"
                @click="activeTab = t.value"
              >
                {{ t.label }}
              </button>
            </nav>

            <!-- Payments -->
            <article v-if="activeTab === 'payments'" class="member-detail__card">
              <header class="member-detail__card-head">
                <div class="member-detail__card-label">Payment history</div>
                <button type="button" class="btn btn--outline btn--sm" disabled>+ Send invoice</button>
              </header>

              <div v-if="paymentHistory.length === 0" class="member-detail__card-empty">
                <CrmEmptyState
                  variant="empty"
                  title="No payments yet"
                  description="Once a payment is recorded it'll land here with the date, amount, and method."
                  :action-label="callerCanEdit && member.membership?.fee ? 'Record a payment' : null"
                  @action="markPaid"
                />
              </div>

              <table v-else class="pay-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th class="pay-table__amount">Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in paymentHistory" :key="p.id" class="pay-table__row">
                    <td class="pay-table__date">{{ p.date }}</td>
                    <td>{{ p.description }}</td>
                    <td class="pay-table__amount">${{ p.amount.toFixed(2) }}</td>
                    <td>
                      <span v-if="p.status === 'paid'" class="pay-pill pay-pill--paid">Paid<template v-if="p.method"> · {{ p.method }}</template></span>
                      <span v-else-if="p.status === 'overdue'" class="pay-pill pay-pill--overdue">Overdue</span>
                      <span v-else-if="p.status === 'waived'" class="pay-pill pay-pill--waived">Waived</span>
                      <span v-else class="pay-pill pay-pill--due">Due</span>
                    </td>
                  </tr>
                </tbody>
                <tfoot v-if="totalCollected > 0">
                  <tr class="pay-table__foot-row">
                    <td colspan="4" class="pay-table__foot-cell">
                      <span class="pay-table__foot-label">Total collected</span>
                      <span class="pay-table__foot-total">${{ totalCollected.toFixed(2) }}</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </article>

            <!-- Communications -->
            <article v-else-if="activeTab === 'communications'" class="member-detail__card">
              <CrmEmptyState
                variant="empty"
                title="No communications yet"
                description="Emails, calls, and notes to this member will appear here once the Communications brief lands."
              />
            </article>

            <!-- Notes -->
            <article v-else-if="activeTab === 'notes'" class="member-detail__card">
              <CrmEmptyState
                variant="empty"
                title="No notes yet"
                description="Log a call, meeting, or context so the next admin doesn't have to guess."
                :action-label="callerCanEdit ? 'Log a note' : null"
                @action="logNote"
              />
            </article>

            <!-- Settings -->
            <article v-else-if="activeTab === 'settings'" class="member-detail__card">
              <CrmEmptyState
                variant="empty"
                title="Settings coming next"
                description="Role, title, and tier changes ship with the Communications sprint."
              />
            </article>
          </section>

          <!-- Right rail -->
          <aside class="member-detail__rail">
            <article class="member-detail__card">
              <header class="member-detail__card-head">
                <div class="member-detail__card-label">Communications</div>
                <button type="button" class="member-detail__view-all" disabled>View all →</button>
              </header>
              <div class="member-detail__rail-empty">
                <div class="member-detail__rail-empty-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2.5 4a1.5 1.5 0 0 1 1.5-1.5h10a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H7l-3.5 3v-3H4A1.5 1.5 0 0 1 2.5 11V4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
                </div>
                <div class="member-detail__rail-empty-title">Nothing yet</div>
                <div class="member-detail__rail-empty-sub">Sent emails, calls, and notes will show here.</div>
              </div>
            </article>

            <article class="member-detail__card">
              <header class="member-detail__card-head">
                <div class="member-detail__card-label">Admin notes</div>
                <span class="member-detail__card-hint">Private</span>
              </header>
              <div class="member-detail__notes-empty">
                <div class="member-detail__notes-empty-body">
                  Add context, quirks, or history other admins should know.
                </div>
                <button type="button" class="member-detail__add-note" :disabled="!callerCanEdit" @click="logNote">+ Add note</button>
              </div>
            </article>
          </aside>
        </div>
      </template>
    </div>

    <CrmModal
      :open="editOpen"
      eyebrow="Edit member"
      :title="member?.name ?? 'Member'"
      width="lg"
      @close="closeEdit"
    >
      <div v-if="editErrorBanner" class="edit-banner">{{ editErrorBanner }}</div>

      <section class="edit-section">
        <div class="edit-section__eyebrow">IDENTITY</div>
        <div class="edit-section__grid">
          <label class="edit-field">
            <span class="edit-field__label">Full name</span>
            <input v-model="editForm.name" type="text" class="edit-field__input" placeholder="Lisa Bentham" />
          </label>
          <label class="edit-field">
            <span class="edit-field__label">Email</span>
            <input
              v-model="editForm.email"
              type="email"
              class="edit-field__input"
              :class="{ 'edit-field__input--error': editFieldErrors.email }"
              placeholder="lisa@example.com"
            />
            <div v-if="editFieldErrors.email" class="edit-field__error">{{ editFieldErrors.email }}</div>
          </label>
          <label class="edit-field">
            <span class="edit-field__label">Phone</span>
            <input v-model="editForm.phone" type="tel" class="edit-field__input" placeholder="+64 21 …" />
          </label>
          <label class="edit-field">
            <span class="edit-field__label">Date of birth</span>
            <input
              v-model="editForm.dob"
              type="date"
              class="edit-field__input"
              :class="{ 'edit-field__input--error': editFieldErrors.dob }"
            />
            <div v-if="editFieldErrors.dob" class="edit-field__error">{{ editFieldErrors.dob }}</div>
          </label>
          <label class="edit-field edit-field--full">
            <span class="edit-field__label">Address</span>
            <input v-model="editForm.address" type="text" class="edit-field__input" placeholder="12 Main St, Wellington" />
          </label>
        </div>
      </section>

      <section class="edit-section">
        <div class="edit-section__eyebrow">ROSTER</div>
        <div class="edit-section__grid">
          <label class="edit-field">
            <span class="edit-field__label">Role</span>
            <select v-model="editForm.role" class="edit-field__input">
              <option value="player">Player</option>
              <option value="committee">Committee</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label class="edit-field">
            <span class="edit-field__label">Title</span>
            <input v-model="editForm.title" type="text" class="edit-field__input" placeholder="Secretary" />
          </label>
          <label class="edit-field">
            <span class="edit-field__label">Position group</span>
            <select v-model="editForm.position_group" class="edit-field__input">
              <option v-for="g in POSITION_GROUPS" :key="g" :value="g">{{ g }}</option>
            </select>
          </label>
          <label class="edit-field">
            <span class="edit-field__label">Playing level</span>
            <select v-model="editForm.playing_level" class="edit-field__input">
              <option value="">—</option>
              <option v-for="l in PLAYING_LEVELS" :key="l" :value="l">{{ l }}</option>
            </select>
          </label>
          <label class="edit-field">
            <span class="edit-field__label">Preferred position</span>
            <select v-model="editForm.preferred_position" class="edit-field__input">
              <option value="">—</option>
              <option v-for="p in PREFERRED_POSITIONS" :key="p" :value="p">{{ p }}</option>
            </select>
          </label>
          <label class="edit-field edit-check">
            <input v-model="editForm.public_visible" type="checkbox" />
            <span>Show on the public directory</span>
          </label>
          <label class="edit-field edit-field--full">
            <span class="edit-field__label">Bio</span>
            <textarea v-model="editForm.bio" class="edit-field__input edit-field__textarea" rows="3" maxlength="500" placeholder="Public bio shown on the player profile." />
          </label>
        </div>
      </section>

      <section class="edit-section">
        <div class="edit-section__eyebrow">BILLING</div>
        <div class="edit-section__grid">
          <label class="edit-field">
            <span class="edit-field__label">Membership tier</span>
            <select v-model.number="editForm.membership_type_id" class="edit-field__input">
              <option :value="null">No tier assigned</option>
              <option v-for="t in tiers" :key="t.id" :value="t.id">{{ t.type_name }}</option>
            </select>
          </label>
          <label class="edit-field">
            <span class="edit-field__label">Status</span>
            <select v-model="editForm.status" class="edit-field__input">
              <option value="">—</option>
              <option v-for="s in MEMBERSHIP_STATUSES" :key="s" :value="s">{{ s }}</option>
            </select>
          </label>
          <label class="edit-field">
            <span class="edit-field__label">Joined date</span>
            <input
              v-model="editForm.joined_date"
              type="date"
              class="edit-field__input"
              :class="{ 'edit-field__input--error': editFieldErrors.joined_date }"
            />
            <div v-if="editFieldErrors.joined_date" class="edit-field__error">{{ editFieldErrors.joined_date }}</div>
          </label>
          <label class="edit-field">
            <span class="edit-field__label">Payment due date</span>
            <input
              v-model="editForm.payment_due_date"
              type="date"
              class="edit-field__input"
              :class="{ 'edit-field__input--error': editFieldErrors.payment_due_date }"
            />
            <div v-if="editFieldErrors.payment_due_date" class="edit-field__error">{{ editFieldErrors.payment_due_date }}</div>
          </label>
        </div>
      </section>

      <template #footer>
        <button type="button" class="btn btn--outline" :disabled="editSaving" @click="closeEdit">Cancel</button>
        <button type="button" class="btn btn--primary" :disabled="editSaving" @click="submitEdit">
          {{ editSaving ? 'Saving…' : 'Save changes' }}
        </button>
      </template>
    </CrmModal>
  </div>
</template>

<style scoped>
.member-detail { display: flex; flex-direction: column; max-width: 1280px; }

/* Sub-header — sticky under the app shell topbar. */
.member-detail__topbar {
  position: sticky; top: 0; z-index: 4;
  display: flex; align-items: center; gap: 20px;
  padding: 14px 4px;
  border-bottom: 1px solid var(--color-hairline);
  background: var(--color-surface);
}
.member-detail__crumbs { display: flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; flex-shrink: 0; }
.member-detail__crumb-back { background: none; border: 0; color: var(--color-fog); cursor: pointer; font: inherit; letter-spacing: inherit; text-transform: inherit; padding: 0; }
.member-detail__crumb-back:hover { color: var(--color-ink); }
.member-detail__crumb-divider { color: var(--color-hairline); }
.member-detail__crumb-current { color: var(--color-ink); }

.member-detail__nav { display: flex; align-items: center; gap: 6px; }
.member-detail__nav-btn { width: 32px; height: 32px; border-radius: 8px; background: #fff; border: 1px solid var(--color-hairline); color: var(--color-ink); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
.member-detail__nav-btn:hover:not(:disabled) { background: var(--color-surface); }
.member-detail__nav-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.member-detail__nav-pos { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-left: 6px; }

.member-detail__actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 10px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: 0; white-space: nowrap; }
.btn--sm { padding: 6px 12px; font-size: 12px; }
.btn--ghost { background: #fff; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.btn--ghost:hover:not(:disabled) { background: var(--color-surface); }
.btn--outline { background: #fff; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.btn--outline:hover:not(:disabled) { background: var(--color-surface); }
.btn--outline:disabled { opacity: 0.5; cursor: not-allowed; }
.btn--primary { background: #16A34A; color: #fff; padding: 8px 16px; }
.btn--primary:hover:not(:disabled) { background: #15803D; }
.btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }

/* Body layout */
.member-detail__body { padding-top: 20px; display: flex; flex-direction: column; gap: 20px; }

/* Hero */
.member-detail__hero {
  display: flex; gap: 24px; align-items: flex-start;
  padding: 24px 28px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 16px;
}
.member-detail__avatar {
  width: 88px; height: 88px; border-radius: 999px;
  background: var(--color-graphite); color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.01em;
  flex-shrink: 0; overflow: hidden;
}
.member-detail__avatar--image { background: var(--color-surface); }
.member-detail__avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }

.member-detail__hero-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.member-detail__hero-line { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.member-detail__name { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: 0; line-height: 1.05; }

.member-detail__hero-contact { display: flex; gap: 20px; flex-wrap: wrap; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); }
.member-detail__contact-item { display: inline-flex; align-items: center; gap: 6px; color: var(--color-fog); }
.member-detail__contact-item a { color: var(--color-ink); text-decoration: none; }
.member-detail__contact-item a:hover { text-decoration: underline; }

.member-detail__hero-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.member-detail__tier { padding: 3px 10px; border-radius: 999px; background: var(--color-accent-soft); color: var(--color-accent); font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.04em; }
.member-detail__meta-dot { opacity: 0.5; }
.member-detail__fee { font-family: var(--font-mono); font-size: 11px; }
.member-detail__member-no { font-family: var(--font-mono); font-size: 11px; }

.member-detail__owing { text-align: right; flex-shrink: 0; min-width: 140px; padding-left: 12px; border-left: 1px solid var(--color-hairline); align-self: stretch; display: flex; flex-direction: column; justify-content: center; gap: 4px; }
.member-detail__owing-label { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.member-detail__owing-value { font-family: var(--font-display); font-size: 40px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); line-height: 1; }
.member-detail__owing-value--danger { color: var(--color-danger); }
.member-detail__owing-sub { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }

/* Standing pill (re-uses tokens from MembersView) */
.standing-pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; }
.standing-pill--paid    { background: #DCFCE7; color: #14532D; }
.standing-pill--due     { background: #FEF3C7; color: #92400E; }
.standing-pill--overdue { background: #FEE2E2; color: #991B1B; }
.standing-pill--waived  { background: var(--color-surface); color: var(--color-graphite); border: 1px solid var(--color-hairline); }
.standing-pill--partial { background: #FFEDD5; color: var(--color-feature-tangerine); }
.standing-pill--invited { background: var(--color-accent-soft); color: var(--color-accent); }
.standing-pill--lapsed  { background: var(--color-surface); color: var(--color-fog); border: 1px solid var(--color-hairline); }
.standing-pill--none    { background: var(--color-surface); color: var(--color-mute); border: 1px dashed var(--color-hairline); }

/* Body columns */
.member-detail__cols { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; align-items: flex-start; }
.member-detail__main { display: flex; flex-direction: column; gap: 16px; }
.member-detail__rail { display: flex; flex-direction: column; gap: 16px; position: sticky; top: 96px; }

/* Tabs */
.member-detail__tabs { display: inline-flex; align-items: center; gap: 2px; border-bottom: 1px solid var(--color-hairline); padding: 0 4px; }
.member-detail__tab { background: none; border: 0; padding: 12px 4px; margin-right: 20px; font-family: var(--font-body); font-size: 14px; font-weight: 500; color: var(--color-fog); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.member-detail__tab:hover { color: var(--color-ink); }
.member-detail__tab.is-active { color: var(--color-ink); font-weight: 600; border-bottom-color: var(--color-ink); }

/* Card */
.member-detail__card { background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; padding: 20px 22px; }
.member-detail__card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.member-detail__card-label { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.member-detail__card-hint { font-family: var(--font-body); font-size: 11px; color: var(--color-mute); font-style: italic; }
.member-detail__view-all { background: none; border: 0; color: var(--color-accent); font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; padding: 0; }
.member-detail__view-all:disabled { opacity: 0.5; cursor: not-allowed; }

.member-detail__card-empty { padding: 8px 0; }

/* Payment table */
.pay-table { width: 100%; border-collapse: collapse; font-family: var(--font-body); font-size: 13px; }
.pay-table th { text-align: left; padding: 10px 12px; font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); border-bottom: 1px solid var(--color-hairline); background: var(--color-surface); }
.pay-table td { padding: 12px; border-bottom: 1px solid var(--color-hairline); color: var(--color-ink); }
.pay-table__row:last-child td { border-bottom: 0; }
.pay-table__date { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); letter-spacing: 0.02em; }
.pay-table__amount { text-align: right; font-family: var(--font-mono); font-weight: 600; }
.pay-table__foot-cell { border-bottom: 0; padding: 14px 12px; }
.pay-table__foot-label { color: var(--color-fog); font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; margin-right: 14px; }
.pay-table__foot-total { color: var(--color-ink); font-family: var(--font-mono); font-size: 16px; font-weight: 700; }
.pay-pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; }
.pay-pill--paid { background: #DCFCE7; color: #14532D; }
.pay-pill--due { background: #FEF3C7; color: #92400E; }
.pay-pill--overdue { background: #FEE2E2; color: #991B1B; }
.pay-pill--waived { background: var(--color-surface); color: var(--color-graphite); border: 1px solid var(--color-hairline); }

/* Rail cards */
.member-detail__rail-empty { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; padding: 6px 0 4px; }
.member-detail__rail-empty-icon { width: 36px; height: 36px; border-radius: 999px; background: var(--color-surface); color: var(--color-fog); display: inline-flex; align-items: center; justify-content: center; }
.member-detail__rail-empty-title { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); margin-top: 2px; }
.member-detail__rail-empty-sub { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }

.member-detail__notes-empty { display: flex; flex-direction: column; gap: 12px; }
.member-detail__notes-empty-body { padding: 12px 14px; background: var(--color-surface); border: 1px dashed var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); line-height: 1.5; }
.member-detail__add-note { align-self: flex-end; background: none; border: 0; color: var(--color-accent); font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; padding: 0; }
.member-detail__add-note:disabled { opacity: 0.5; cursor: not-allowed; }

/* Skeleton hero */
.member-detail__hero--sk { align-items: center; }
.member-detail__hero-body-sk { flex: 1; display: flex; flex-direction: column; gap: 10px; }
.member-detail__hero-body-sk .crm-skeleton { display: block; }

.member-detail__nomatch { max-width: 480px; }

/* Responsive */
@media (max-width: 1023px) {
  .member-detail__cols { grid-template-columns: 1fr; }
  .member-detail__rail { position: static; top: auto; }
}
@media (max-width: 767px) {
  .member-detail__topbar { flex-wrap: wrap; gap: 12px; padding: 12px 4px; }
  .member-detail__actions { width: 100%; }
  .btn { flex: 1; justify-content: center; }
  .member-detail__hero { flex-direction: column; padding: 20px; }
  .member-detail__owing { border-left: 0; padding-left: 0; padding-top: 16px; border-top: 1px solid var(--color-hairline); width: 100%; text-align: left; align-items: flex-start; }
  .member-detail__owing-value { font-size: 32px; }
  .member-detail__hero-line { flex-direction: column; align-items: flex-start; gap: 8px; }
  .member-detail__name { font-size: 24px; }
  .pay-table th:nth-child(2), .pay-table td:nth-child(2) { display: none; }
}

/* ── Edit modal ──────────────────────────────────────────────── */
.edit-banner {
  margin: 0 0 16px;
  padding: 12px 16px;
  background: #FEF2F2;
  border: 1px solid #FEE2E2;
  border-radius: 10px;
  font-family: var(--font-body);
  font-size: 13px;
  color: #991B1B;
}
.edit-section { display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px; }
.edit-section:last-of-type { margin-bottom: 0; }
.edit-section__eyebrow {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--color-fog);
  text-transform: uppercase;
}
.edit-section__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
}
.edit-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.edit-field--full { grid-column: span 2; }
.edit-field__label {
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink);
}
.edit-field__input {
  padding: 10px 12px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 10px;
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--color-ink);
  outline: none;
  width: 100%;
  box-sizing: border-box;
}
.edit-field__input:focus { border-color: var(--color-ink); }
.edit-field__input--error { border-color: var(--color-danger, #DC2F3B); }
.edit-field__textarea {
  resize: vertical;
  min-height: 72px;
  line-height: 150%;
  font-size: 13px;
}
.edit-field__error {
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-danger, #DC2F3B);
}
.edit-check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  grid-column: span 2;
}
.edit-check input { width: 16px; height: 16px; }
.edit-check span {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-ink);
}

@media (max-width: 640px) {
  .edit-section__grid { grid-template-columns: 1fr; }
  .edit-field--full { grid-column: auto; }
  .edit-check { grid-column: auto; }
}
</style>
