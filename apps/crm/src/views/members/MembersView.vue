<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import CrmModal from '@/components/modals/CrmModal.vue'
import CrmEmptyState from '@/components/CrmEmptyState.vue'
import CrmSkeleton from '@/components/CrmSkeleton.vue'
import CrmSpinner from '@/components/CrmSpinner.vue'
import { useToast } from '@/composables/useToast'
import { useMemberSearch } from '@/composables/useMemberSearch'
import { useClubStore } from '@/stores/club'
import { members as membersApi, ApiError, type RosterMember } from '@torny/api-client'

const toast = useToast()
const clubStore = useClubStore()

type MemberStatus = 'Active' | 'Pending' | 'Lapsed'
type MemberRole = 'Player' | 'Committee' | 'Coach' | 'Junior' | 'Volunteer'
/** Server-provided type_name — kept as a string since clubs can define
 *  their own tiers via the onboarding wizard. */
type MembershipType = string
type DuesStatus = 'Paid' | 'Due' | 'Overdue'
const DUES_STATUSES: DuesStatus[] = ['Paid', 'Due', 'Overdue']

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
  avatarUrl?: string | null
  membershipTypeId?: number | null
}

const {
  query: search,
  results: apiResults,
  loading: searchLoading,
  error: searchError,
} = useMemberSearch(() => clubStore.current?.id ?? null, {
  status: 'all',
  limit: 20,
  includeInvites: false,
})

const statusFilter = ref<'all' | MemberStatus>('all')
const membershipFilter = ref<'all' | MembershipType>('all')
const duesFilter = ref<'all' | DuesStatus>('all')
const MIN_SEARCH_CHARS = 2
const isSearching = computed(() => search.value.trim().length >= MIN_SEARCH_CHARS)

// Skeleton rows stand in for the list when either (a) the initial
// roster is still loading, or (b) a fresh search is in flight with no
// previous results to keep visible. Existing results stay put during
// re-search so the UI doesn't flash.
const showTableSkeleton = computed(() => {
  if (isSearching.value && searchLoading.value && apiResults.value.length === 0) return true
  if (!isSearching.value && rosterLoading.value && members.value.length === 0) return true
  return false
})

const hasActiveFilter = computed(
  () =>
    statusFilter.value !== 'all' ||
    membershipFilter.value !== 'all' ||
    duesFilter.value !== 'all' ||
    search.value.trim().length > 0,
)
function resetFilters() {
  statusFilter.value = 'all'
  membershipFilter.value = 'all'
  duesFilter.value = 'all'
  search.value = ''
}

const emptyTitle = computed(() => {
  if (isSearching.value) return `No matches for "${search.value.trim()}"`
  if (hasActiveFilter.value) return 'No members match those filters'
  return 'No members yet'
})
const emptyDescription = computed(() => {
  if (isSearching.value) return 'Check the spelling, or clear the search to browse the full roster.'
  if (hasActiveFilter.value) return 'Try loosening a filter or hitting reset to see everyone.'
  return "Add your first member or import a CSV to get started."
})

function onSearchRetry() {
  // Nudge the composable — mutating and restoring the same query
  // fires the watcher which schedules a fresh fetch.
  const q = search.value
  search.value = ''
  search.value = q
}

// Server timestamps are ISO 8601 UTC. Roster sub-lines want "Feb 2019".
const MONTH_YEAR_FMT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  year: 'numeric',
})
function formatJoinedAt(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return MONTH_YEAR_FMT.format(d)
}

// Map the server roster shape to the local view Member so the table /
// card / detail templates keep working unchanged. Fields not present on
// the roster payload fall back to safe defaults.
function rosterToView(r: RosterMember): Member {
  const roleMap: Record<string, MemberRole> = {
    player: 'Player',
    committee: 'Committee',
    admin: 'Committee',
    owner: 'Committee',
  }
  const statusMap: Record<string, MemberStatus> = {
    active: 'Active',
    pending: 'Pending',
    lapsed: 'Lapsed',
  }
  const paymentToDues: Record<string, DuesStatus> = {
    paid: 'Paid',
    waived: 'Paid',
    unpaid: 'Due',
    partial: 'Due',
    overdue: 'Overdue',
  }
  const membership = r.membership?.type_name ?? 'Playing member'
  return {
    id: String(r.user_id),
    name: r.name,
    email: r.email ?? '',
    phone: r.phone ?? '',
    role: roleMap[r.club_role] ?? 'Player',
    status: statusMap[r.computed_status] ?? 'Active',
    membership,
    memberNumber: r.member_number != null ? `#${r.member_number}` : '—',
    joinedAt: formatJoinedAt(r.joined_at),
    duesStatus: paymentToDues[r.membership?.payment_status ?? ''] ?? 'Paid',
    lastActive: '—',
    eventsAttended: 0,
    avatarUrl: r.avatar_url ?? null,
    membershipTypeId: r.membership?.type_id ?? null,
  }
}

const members = ref<Member[]>([])
const rosterLoading = ref(false)
const rosterError = ref<string | null>(null)
const rosterCounts = ref<{ total: number; active: number } | null>(null)

// Prefer the server's authoritative counts for the hero line so the "N
// total · N active" number stays put while the user is searching.
const heroCounts = computed(() =>
  rosterCounts.value ?? {
    total: members.value.length,
    active: members.value.filter((m) => m.status === 'Active').length,
  },
)

async function loadRoster() {
  const cid = clubStore.current?.id
  if (cid == null) {
    members.value = []
    rosterCounts.value = null
    return
  }
  rosterLoading.value = true
  rosterError.value = null
  try {
    const res = await membersApi.listRoster(cid, {
      limit: 200,
      include_invites: false,
    })
    members.value = res.members.map(rosterToView)
    rosterCounts.value = { total: res.counts.total, active: res.counts.active }
  } catch (err) {
    rosterError.value = err instanceof Error ? err.message : 'Failed to load roster'
    members.value = []
    rosterCounts.value = null
  } finally {
    rosterLoading.value = false
  }
}

onMounted(loadRoster)
// Reload when the active club changes (e.g. via the club switcher).
watch(() => clubStore.current?.id, loadRoster)

const visibleSource = computed<Member[]>(() =>
  isSearching.value ? apiResults.value.map(rosterToView) : members.value,
)

const counts = computed(() => ({
  all: visibleSource.value.length,
  Active: visibleSource.value.filter((m) => m.status === 'Active').length,
  Pending: visibleSource.value.filter((m) => m.status === 'Pending').length,
  Lapsed: visibleSource.value.filter((m) => m.status === 'Lapsed').length,
}))

const filtered = computed(() =>
  visibleSource.value.filter((m) => {
    if (statusFilter.value !== 'all' && m.status !== statusFilter.value) return false
    if (membershipFilter.value !== 'all' && m.membership !== membershipFilter.value) return false
    if (duesFilter.value !== 'all' && m.duesStatus !== duesFilter.value) return false
    return true
  }),
)

/** Union of membership types across the roster + any current search
 *  results, so the dropdown offers every value the user might see. */
const membershipOptions = computed<MembershipType[]>(() => {
  const set = new Set<MembershipType>()
  for (const m of members.value) if (m.membership) set.add(m.membership)
  if (isSearching.value) {
    for (const r of apiResults.value) {
      const t = r.membership?.type_name
      if (t) set.add(t)
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b))
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

async function removeActiveMember() {
  const m = activeMember.value
  const cid = clubStore.current?.id
  if (!m || cid == null) return
  const ok = confirm(`Remove ${m.name} from the club? They'll appear under Lapsed and can be re-linked later.`)
  if (!ok) return
  try {
    await membersApi.remove(cid, Number(m.id))
    toast.success(`${m.name} removed.`)
    detailOpen.value = false
    await loadRoster()
  } catch (err) {
    toast.error(removeErrorCopy(err))
  }
}

function removeErrorCopy(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'owner_immutable':    return "You can't remove the club owner. Transfer ownership first."
      case 'cannot_remove_self': return "You can't remove yourself. Use the leave-club flow (coming soon)."
      case 'already_revoked':    return 'They\'ve already been removed. Refreshing the roster.'
      case 'forbidden':          return "You don't have permission to remove this member."
      default:                   return err.message
    }
  }
  return (err as Error).message
}

// ── Add member modal ───────────────────────────────────────────
const addOpen = ref(false)
const addSubmitting = ref(false)
const addError = ref<string | null>(null)
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
  addError.value = null
  addOpen.value = true
}
function closeAdd() {
  addOpen.value = false
}

const canSubmit = computed(
  () => form.firstName.trim().length > 0 && form.lastName.trim().length > 0 && /.+@.+\..+/.test(form.email.trim()),
)

// Map the UI role picker (Player / Committee / Coach / Junior / Volunteer)
// to the API's smaller role vocabulary. Coach / Junior / Volunteer are
// player-tier for permissions; use `title` to preserve the flavour.
function toApiRole(role: MemberRole): 'committee' | 'player' {
  return role === 'Committee' ? 'committee' : 'player'
}

// Pluck a tier id off the current roster for the picked membership type.
// The onboarding wizard's Step 4 owns the canonical id list — but until
// we have a dedicated /membership-tiers endpoint this is the cheapest
// lookup that works.
function tierIdForMembership(name: MembershipType): number | undefined {
  const hit = members.value.find((m) => m.membership === name && m.membershipTypeId != null)
  return hit?.membershipTypeId ?? undefined
}

async function submit() {
  if (!canSubmit.value) return
  const cid = clubStore.current?.id
  if (cid == null) {
    addError.value = 'No active club — refresh and try again.'
    return
  }
  addSubmitting.value = true
  addError.value = null
  try {
    const result = await membersApi.add(cid, {
      email: form.email.trim(),
      first_name: form.firstName.trim(),
      last_name: form.lastName.trim(),
      phone: form.phone.trim() || undefined,
      role: toApiRole(form.role),
      title: form.role === 'Coach' || form.role === 'Junior' || form.role === 'Volunteer' ? form.role : undefined,
      membership_type_id: tierIdForMembership(form.membership),
      membership_type: form.membership,
      send_invite: form.sendInvite,
    })
    const name = `${form.firstName.trim()} ${form.lastName.trim()}`
    switch (result.resolution) {
      case 'linked':       toast.success(`${name} linked from an existing Torny user.`); break
      case 'relinked':     toast.success(`${name} was previously removed — re-linked with their old member number.`); break
      case 'invited':      toast.success(`Invite emailed to ${form.email.trim()}.`); break
      case 'stub_created': toast.success(`${name} added.`); break
    }
    closeAdd()
    await loadRoster()
  } catch (err) {
    if (err instanceof ApiError) {
      switch (err.code) {
        case 'already_member': addError.value = 'That email is already an active member.'; break
        case 'invite_exists':  addError.value = 'A pending invite already exists for that email.'; break
        case 'invalid_email':  addError.value = 'That email isn\'t valid.'; break
        case 'unknown_type':   addError.value = 'That membership tier isn\'t on this club yet — finish onboarding first.'; break
        default:               addError.value = err.message
      }
    } else {
      addError.value = (err as Error).message
    }
  } finally {
    addSubmitting.value = false
  }
}
</script>

<template>
  <div class="members">
    <header class="members__header">
      <div>
        <div class="members__eyebrow">Roster</div>
        <h1 class="members__heading">Members</h1>
        <p class="members__sub">{{ heroCounts.total }} total · {{ heroCounts.active }} active</p>
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
            :aria-busy="searchLoading || undefined"
          />
          <span v-if="isSearching && searchLoading" class="search__spinner">
            <CrmSpinner size="sm" label="Searching" />
          </span>
          <button v-else-if="search" class="search__clear" aria-label="Clear search" @click="search = ''">
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
      <input
        v-model="search"
        placeholder="Search members…"
        class="search__input"
        :aria-busy="searchLoading || undefined"
      />
      <span v-if="isSearching && searchLoading" class="search__spinner">
        <CrmSpinner size="sm" label="Searching" />
      </span>
      <button v-else-if="search" class="search__clear" aria-label="Clear search" @click="search = ''">
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
      <div class="filters__selects">
        <label class="filter-select">
          <span class="filter-select__label">Membership</span>
          <select v-model="membershipFilter">
            <option value="all">All</option>
            <option v-for="opt in membershipOptions" :key="opt" :value="opt">{{ opt }}</option>
          </select>
        </label>
        <label class="filter-select">
          <span class="filter-select__label">Dues</span>
          <select v-model="duesFilter">
            <option value="all">All</option>
            <option v-for="opt in DUES_STATUSES" :key="opt" :value="opt">{{ opt }}</option>
          </select>
        </label>
      </div>
      <div v-if="hasActiveFilter" class="filters__result">
        {{ filtered.length }} of {{ counts.all }}
        <button type="button" class="filters__reset" @click="resetFilters">Reset</button>
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
              <div class="row__avatar" :class="{ 'row__avatar--image': m.avatarUrl }">
                <img v-if="m.avatarUrl" :src="m.avatarUrl" :alt="m.name" />
                <template v-else>{{ initials(m) }}</template>
              </div>
              <div class="row__name-text">
                <div class="row__name-main">
                  {{ m.name }}
                  <span v-if="membershipBadge(m)" class="badge" :class="`badge--${membershipBadge(m)!.tone}`">{{ membershipBadge(m)!.label }}</span>
                  <span v-if="roleBadge(m)" class="badge" :class="`badge--${roleBadge(m)!.tone}`">{{ roleBadge(m)!.label }}</span>
                </div>
                <div class="row__name-sub">
                  {{ m.memberNumber }}<template v-if="m.joinedAt !== '—'"> · joined {{ m.joinedAt }}</template>
                </div>
              </div>
            </div>
          </td>
          <td>{{ m.email }}</td>
          <td>{{ m.membership }}</td>
          <td><span class="pill" :class="`pill--${duesTone[m.duesStatus]}`">{{ m.duesStatus }}</span></td>
          <td><span class="pill" :class="`pill--${statusTone[m.status]}`">{{ m.status }}</span></td>
          <td class="row__chev" aria-hidden="true">›</td>
        </tr>
        <template v-if="showTableSkeleton">
          <tr
            v-for="i in 5"
            :key="`sk-${i}`"
            class="row row--skeleton"
            aria-busy="true"
          >
            <td class="row__name">
              <div class="row__name-inner">
                <CrmSkeleton shape="circle" width="36px" height="36px" />
                <div class="row__name-text row__name-text--sk">
                  <CrmSkeleton shape="text" width="60%" />
                  <CrmSkeleton shape="text" width="40%" />
                </div>
              </div>
            </td>
            <td><CrmSkeleton shape="text" width="70%" /></td>
            <td><CrmSkeleton shape="text" width="55%" /></td>
            <td><CrmSkeleton width="48px" height="18px" radius="999px" /></td>
            <td><CrmSkeleton width="52px" height="18px" radius="999px" /></td>
            <td aria-hidden="true" />
          </tr>
        </template>
        <tr v-else-if="isSearching && searchError && !filtered.length">
          <td colspan="6" class="empty">
            <CrmEmptyState
              variant="error"
              title="We couldn't run that search"
              :description="searchError"
              action-label="Try again"
              @action="onSearchRetry"
            />
          </td>
        </tr>
        <tr v-else-if="!isSearching && rosterError && !filtered.length">
          <td colspan="6" class="empty">
            <CrmEmptyState
              variant="error"
              title="We couldn't load the roster"
              :description="rosterError"
              action-label="Try again"
              @action="loadRoster"
            />
          </td>
        </tr>
        <tr v-else-if="!filtered.length">
          <td colspan="6" class="empty">
            <CrmEmptyState
              variant="empty"
              :title="emptyTitle"
              :description="emptyDescription"
              :action-label="hasActiveFilter ? 'Reset filters' : null"
              @action="resetFilters"
            />
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Mobile card list -->
    <ul class="cards">
      <li v-for="m in filtered" :key="m.id" class="card" tabindex="0" @click="openDetail(m)" @keydown.enter="openDetail(m)">
        <div class="card__avatar" :class="{ 'card__avatar--image': m.avatarUrl }">
          <img v-if="m.avatarUrl" :src="m.avatarUrl" :alt="m.name" />
          <template v-else>{{ initials(m) }}</template>
        </div>
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
      <template v-if="showTableSkeleton">
        <li
          v-for="i in 4"
          :key="`sk-${i}`"
          class="card card--skeleton"
          aria-busy="true"
        >
          <CrmSkeleton shape="circle" width="44px" height="44px" />
          <div class="card__body card__body--sk">
            <CrmSkeleton shape="text" width="55%" />
            <CrmSkeleton shape="text" width="35%" />
            <CrmSkeleton shape="text" width="70%" />
          </div>
        </li>
      </template>
      <li v-else-if="isSearching && searchError && !filtered.length" class="empty">
        <CrmEmptyState
          variant="error"
          title="We couldn't run that search"
          :description="searchError"
          action-label="Try again"
          @action="onSearchRetry"
        />
      </li>
      <li v-else-if="!isSearching && rosterError && !filtered.length" class="empty">
        <CrmEmptyState
          variant="error"
          title="We couldn't load the roster"
          :description="rosterError"
          action-label="Try again"
          @action="loadRoster"
        />
      </li>
      <li v-else-if="!filtered.length" class="empty">
        <CrmEmptyState
          variant="empty"
          :title="emptyTitle"
          :description="emptyDescription"
          :action-label="hasActiveFilter ? 'Reset filters' : null"
          @action="resetFilters"
        />
      </li>
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
            <div class="detail__avatar" :class="{ 'detail__avatar--image': activeMember.avatarUrl }">
              <img v-if="activeMember.avatarUrl" :src="activeMember.avatarUrl" :alt="activeMember.name" />
              <template v-else>{{ initials(activeMember) }}</template>
            </div>
            <div class="detail__hero-body">
              <div class="detail__hero-line">{{ activeMember.membership }} · {{ activeMember.role }}</div>
              <div class="detail__hero-meta">
                {{ activeMember.memberNumber }}<template v-if="activeMember.joinedAt !== '—'"> · joined {{ activeMember.joinedAt }}</template>
              </div>
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
        <button type="button" class="btn btn--danger-outline" @click="removeActiveMember">Remove</button>
        <div class="modal__foot-spacer" />
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

        <p v-if="addError" class="add-error">{{ addError }}</p>
      </form>

      <template #footer>
        <button type="button" class="btn btn--outline" @click="closeAdd" :disabled="addSubmitting">Cancel</button>
        <button
          type="button"
          class="btn btn--primary"
          :disabled="!canSubmit || addSubmitting"
          @click="submit"
        >{{ addSubmitting ? 'Adding…' : 'Add member' }}</button>
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
.search__spinner { position: absolute; right: 12px; display: inline-flex; align-items: center; color: var(--color-accent); pointer-events: none; }
.search--mobile { display: none; }

/* Filter chips */
.filters { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.chips { display: flex; gap: 6px; padding: 4px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; width: fit-content; }
.chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border: 0; background: transparent; border-radius: 999px; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); cursor: pointer; }
.chip.is-active { background: #fff; color: var(--color-ink); font-weight: 600; box-shadow: var(--shadow-sm); }
.chip__count { font-family: var(--font-mono); font-size: 10px; padding: 1px 7px; background: var(--color-hairline); color: var(--color-graphite); border-radius: 999px; }
.chip.is-active .chip__count { background: var(--color-accent-soft); color: var(--color-accent); }
.filters__result { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); display: inline-flex; align-items: center; gap: 10px; }
.filters__reset { background: none; border: 0; padding: 0; font-family: var(--font-body); font-size: 12px; font-weight: 600; color: var(--color-accent); cursor: pointer; }
.filters__reset:hover { text-decoration: underline; }
.filters__selects { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.filter-select { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px 4px 12px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-body); font-size: 12px; color: var(--color-ink); }
.filter-select__label { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.filter-select select { border: 0; outline: 0; background: transparent; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-ink); padding: 2px 4px; cursor: pointer; }
.filter-select:focus-within { border-color: var(--color-ink); }

/* Table */
.table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; overflow: hidden; }
.table th { text-align: left; padding: 12px 16px; font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.12em; color: var(--color-fog); text-transform: uppercase; background: var(--color-surface); border-bottom: 1px solid var(--color-hairline); }
.table td { padding: 14px 16px; font-family: var(--font-body); font-size: 14px; color: var(--color-ink); border-bottom: 1px solid var(--color-hairline); }
.table tbody tr:last-child td { border-bottom: none; }
.table tbody tr.row { cursor: pointer; transition: background-color 0.12s ease; }
.table tbody tr.row:hover { background: var(--color-surface); }
.table tbody tr.row:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; }

.row__name-inner { display: flex; align-items: center; gap: 12px; }
.row__avatar { width: 36px; height: 36px; border-radius: 999px; background: var(--color-graphite); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-body); font-size: 12px; font-weight: 700; flex-shrink: 0; overflow: hidden; }
.row__avatar--image { background: var(--color-surface); }
.row__avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.row__name-text { min-width: 0; }
.row__name-main { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-family: var(--font-display); font-size: 14px; font-weight: 600; color: var(--color-ink); }
.row__name-sub { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 2px; }
.row__chev { text-align: right; color: var(--color-mute); font-size: 18px; padding-right: 20px; width: 24px; }
.row--skeleton { cursor: default; }
.row--skeleton:hover { background: transparent; }
.row__name-text--sk { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
.row__name-text--sk .crm-skeleton { display: block; }

/* Cards (mobile) */
.cards { display: none; list-style: none; padding: 0; margin: 0; flex-direction: column; gap: 8px; }
.card { display: flex; align-items: center; gap: 14px; padding: 14px 16px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; cursor: pointer; }
.card:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.card__avatar { width: 44px; height: 44px; border-radius: 999px; background: var(--color-graphite); color: #fff; display: flex; align-items: center; justify-content: center; font-family: var(--font-body); font-size: 13px; font-weight: 700; flex-shrink: 0; overflow: hidden; }
.card__avatar--image { background: var(--color-surface); }
.card__avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.card__body { flex: 1; min-width: 0; }
.card__name-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.card__name { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--color-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card__badges { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
.card__contact { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card--skeleton { cursor: default; }
.card__body--sk { display: flex; flex-direction: column; gap: 8px; }
.card__body--sk .crm-skeleton { display: block; }

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

.empty { padding: 0; background: transparent; }
.table .empty { border-bottom: 0; }
.cards > .empty { list-style: none; }

.fab { display: none; position: fixed; right: 20px; bottom: 84px; padding: 14px 20px; background: var(--color-ink); color: #fff; border: none; border-radius: 999px; font-family: var(--font-body); font-size: 14px; font-weight: 600; box-shadow: var(--shadow-lg); cursor: pointer; z-index: 10; }

/* Detail modal */
.detail { display: flex; flex-direction: column; gap: 20px; }

/* Hero — avatar, meta on the left; badges on the right */
.detail__hero { position: relative; display: flex; align-items: center; gap: 16px; padding: 20px 22px; border-radius: 14px; background: linear-gradient(135deg, var(--color-surface) 0%, #fff 100%); border: 1px solid var(--color-hairline); overflow: hidden; }
.detail__hero::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--color-graphite); }
.detail__hero--ok::before { background: #16A34A; }
.detail__hero--warn::before { background: var(--color-accent); }
.detail__hero--danger::before { background: var(--color-danger); }

.detail__avatar { width: 60px; height: 60px; border-radius: 999px; background: var(--color-ink); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: -0.01em; flex-shrink: 0; overflow: hidden; }
.detail__avatar--image { background: var(--color-surface); }
.detail__avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
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
.btn--outline:hover:not(:disabled) { background: var(--color-surface); }
.btn--outline:disabled { opacity: 0.5; cursor: not-allowed; }
.btn--danger-outline { background: transparent; color: var(--color-danger); border: 1px solid var(--color-hairline); padding: 9px 16px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; }
.btn--danger-outline:hover { background: #FEE2E2; border-color: var(--color-danger); }

.modal__foot-spacer { flex: 1; }

.add-error { padding: 10px 12px; background: #FEE2E2; color: #991B1B; border-radius: 10px; font-family: var(--font-body); font-size: 13px; margin: 0; }

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
