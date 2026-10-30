<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch, watchEffect } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import CrmModal from '@/components/modals/CrmModal.vue'
import CrmEmptyState from '@/components/CrmEmptyState.vue'
import CrmSkeleton from '@/components/CrmSkeleton.vue'
import CrmSpinner from '@/components/CrmSpinner.vue'
import SendEmailModal, { type EmailRecipient } from '@/components/modals/SendEmailModal.vue'
import NewSeasonModal from './NewSeasonModal.vue'
import MemberSummaryStats from './MemberSummaryStats.vue'
import { useToast } from '@/composables/useToast'
import { useMemberSearch } from '@/composables/useMemberSearch'
import { useClubStore } from '@/stores/club'
import { useAuthStore } from '@/stores/auth'
import { members as membersApi, seasons as seasonsApi, ApiError, type PaymentMethod, type PositionGroup, type RosterMember, type MembersSummary, type MembershipTierListItem, type Season } from '@torny/api-client'

const toast = useToast()
const clubStore = useClubStore()
const router = useRouter()
const authStore = useAuthStore()

type MemberStatus = 'Active' | 'Prospect' | 'Visitor' | 'Pending' | 'Lapsed'
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
  /** Raw API role — the UI's `role` collapses owner/admin into Committee for
   *  visual grouping; this preserves the actual value for PATCH round-trips. */
  apiRole?: 'owner' | 'admin' | 'committee' | 'player'
  title?: string | null
  /** What the member should pay per cadence — from `membership.fee` (or the legacy
   *  `annual_fee` alias). Null when no tier is assigned. */
  fee?: number | null
  /** Amount they paid on their most recent payment — from
   *  `membership.last_payment_amount`. Null when never paid. */
  lastPaymentAmount?: number | null
  /** Sum of payments this season — from `membership.total_paid_this_season`. */
  totalPaidThisSeason?: number | null
  /** How much they still owe this period — from `membership.balance_owed`. */
  balanceOwed?: number | null
  /** annual / monthly / season — drives the "$/…" suffix. */
  cadence?: 'annual' | 'monthly' | 'season' | null
  /** Server payment status ('paid' | 'partial' | 'unpaid' | 'overdue' | 'waived'). */
  paymentStatus?: 'paid' | 'unpaid' | 'partial' | 'overdue' | 'waived' | null
  /** YYYY-MM-DD — next payment due, from `membership.payment_due_date`. */
  paymentDueDate?: string | null
  /** ISO 8601 UTC — most recent payment date, from `membership.last_payment_date`. */
  lastPaymentDate?: string | null
  /** ISO 8601 UTC — when the member was revoked (lapsed rows only). */
  revokedAt?: string | null
  /** Public directory grouping — brief 35. */
  positionGroup?: PositionGroup
  /** When false the member is hidden from the public directory + player profile. */
  publicVisible?: boolean
  /** Member-authored bio, shown on the public player profile. */
  bio?: string | null
  /** Where this member came from — enquiry / application / manual / import.
   *  Drives the "from enquiry" subline on the Prospect standing pill. */
  source?: 'enquiry' | 'application' | 'manual' | 'import' | null
  /** The originating enquiry / application id when source is set. */
  sourceRefId?: number | null
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
  // Server-side tier filter so chip + typeahead agree.
  membershipTypeSlug: () => (membershipFilter.value === 'all' ? null : membershipFilter.value),
})

const statusFilter = ref<'all' | MemberStatus>('all')
/** Tier slug (`student-member`), `'none'` (members with no active
 *  membership), or `'all'` (no filter). Backend-side via
 *  `membership_type_slug=` on `/clubs/:id/members`. */
const membershipFilter = ref<'all' | 'none' | string>('all')
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
    prospect: 'Prospect',
    visitor: 'Visitor',
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
    lastActive: formatLastActive(r.last_active_at),
    eventsAttended: 0,
    avatarUrl: r.avatar_url ?? null,
    membershipTypeId: r.membership?.type_id ?? null,
    apiRole: r.club_role,
    title: r.title ?? null,
    dob: r.dob ?? undefined,
    address: r.address ?? undefined,
    notes: r.notes ?? undefined,
    positionGroup: r.position_group,
    publicVisible: r.public_visible,
    bio: r.bio,
    fee: r.membership?.fee ?? r.membership?.annual_fee ?? null,
    lastPaymentAmount: r.membership?.last_payment_amount ?? null,
    totalPaidThisSeason: r.membership?.total_paid_this_season ?? null,
    balanceOwed: r.membership?.balance_owed ?? null,
    cadence: r.membership?.cadence ?? null,
    paymentStatus: (r.membership?.payment_status as Member['paymentStatus']) ?? null,
    paymentDueDate: r.membership?.payment_due_date ?? null,
    lastPaymentDate: r.membership?.last_payment_date ?? null,
    revokedAt: r.revoked_at ?? null,
    source: r.source ?? null,
    sourceRefId: r.source_ref_id ?? null,
  }
}

function formatLastActive(iso: string | null): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  const diffMs = Date.now() - then
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

const members = ref<Member[]>([])
const rosterLoading = ref(false)
const rosterError = ref<string | null>(null)
const rosterCounts = ref<{ total: number; active: number } | null>(null)

// ── Multi-select for bulk actions ──────────────────────────────────
// Selection lives on the view (not on `Member`) so we can keep ticks
// across filter/search changes — admins routinely refine a search to
// confirm a shortlist before firing the email. Cleared only via the
// "Clear" button or after a successful send.
const selectedIds = ref<Set<string>>(new Set())
function isSelected(m: Member): boolean { return selectedIds.value.has(m.id) }
function toggleSelected(m: Member) {
  const next = new Set(selectedIds.value)
  if (next.has(m.id)) next.delete(m.id)
  else next.add(m.id)
  selectedIds.value = next
}
function clearSelection() { selectedIds.value = new Set() }
const sendEmailOpen = ref(false)
function openBulkEmail() { if (selectedCount.value > 0) sendEmailOpen.value = true }
function onBulkEmailSent() {
  clearSelection()
  sendEmailOpen.value = false
}

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
    const slug = membershipFilter.value === 'all' ? null : membershipFilter.value
    const res = await membersApi.listRoster(cid, {
      limit: 200,
      include_invites: false,
      ...(slug ? { membership_type_slug: slug } : {}),
    })
    members.value = res.members.map(rosterToView)
    rosterCounts.value = { total: res.counts.total, active: res.counts.active }
    // Broadcast so the shell's sidebar count refreshes without a duplicate fetch.
    window.dispatchEvent(new CustomEvent('torny:roster-count', { detail: res.counts.total }))
  } catch (err) {
    rosterError.value = err instanceof Error ? err.message : 'Failed to load roster'
    members.value = []
    rosterCounts.value = null
  } finally {
    rosterLoading.value = false
  }
}

async function loadAll() {
  // Reset season selection when the active club changes so the summary
  // defaults to the new club's current season rather than a stale id.
  selectedSeasonId.value = null
  await Promise.all([loadRoster(), loadSummary(), loadTiers(), loadSeasons()])
}

onMounted(loadAll)
// Reload when the active club changes (e.g. via the club switcher).
watch(() => clubStore.current?.id, loadAll)
// Server-side tier filter: refetch roster when the chip changes so the
// backend returns the pre-filtered list (counts stay on the client view).
watch(membershipFilter, () => { void loadRoster() })

const visibleSource = computed<Member[]>(() =>
  isSearching.value ? apiResults.value.map(rosterToView) : members.value,
)

const counts = computed(() => ({
  all: visibleSource.value.length,
  Active: visibleSource.value.filter((m) => m.status === 'Active').length,
  Prospect: visibleSource.value.filter((m) => m.status === 'Prospect').length,
  Visitor: visibleSource.value.filter((m) => m.status === 'Visitor').length,
  Pending: visibleSource.value.filter((m) => m.status === 'Pending').length,
  Lapsed: visibleSource.value.filter((m) => m.status === 'Lapsed').length,
}))

// Tier filter happens server-side via `membership_type_slug=` — no client
// branch needed. Status + dues stay client-side (lightweight, no refetch).
const filtered = computed(() =>
  visibleSource.value.filter((m) => {
    if (statusFilter.value !== 'all' && m.status !== statusFilter.value) return false
    if (duesFilter.value !== 'all' && m.duesStatus !== duesFilter.value) return false
    return true
  }),
)

const selectedCount = computed(() => selectedIds.value.size)
/** True when every visible row is selected — drives the header "all"
 *  checkbox. We check against the currently-filtered list so toggling
 *  the header respects whatever chip/filter the admin has applied. */
const allVisibleSelected = computed(
  () => filtered.value.length > 0 && filtered.value.every((m) => selectedIds.value.has(m.id)),
)
const someVisibleSelected = computed(
  () => filtered.value.some((m) => selectedIds.value.has(m.id)) && !allVisibleSelected.value,
)
function toggleAllVisible() {
  const next = new Set(selectedIds.value)
  if (allVisibleSelected.value) {
    for (const m of filtered.value) next.delete(m.id)
  } else {
    for (const m of filtered.value) next.add(m.id)
  }
  selectedIds.value = next
}
/** `indeterminate` isn't reflected by `v-model`, so we poke the DOM
 *  whenever the derived "some but not all" state flips. */
const selectAllEl = ref<HTMLInputElement | null>(null)
watchEffect(() => {
  if (selectAllEl.value) selectAllEl.value.indeterminate = someVisibleSelected.value
})

/** Build the recipient list from the global roster + any current search
 *  results, so admins who tick rows while refining a search still see
 *  every selection in the modal (not just the ones still visible). */
const selectedRecipients = computed<EmailRecipient[]>(() => {
  const byId = new Map<string, EmailRecipient>()
  const push = (m: Member) => {
    if (!byId.has(m.id)) {
      byId.set(m.id, {
        user_id: Number(m.id),
        name: m.name,
        email: m.email || null,
      })
    }
  }
  for (const m of members.value) if (selectedIds.value.has(m.id)) push(m)
  for (const m of apiResults.value) {
    const id = String(m.user_id)
    if (selectedIds.value.has(id) && !byId.has(id)) {
      byId.set(id, { user_id: m.user_id, name: m.name, email: m.email ?? null })
    }
  }
  return Array.from(byId.values())
})
const selectedWithoutEmail = computed(
  () => selectedRecipients.value.filter((r) => !r.email).length,
)

/** Tier dropdown — sourced from the club's current tier list (one fetch
 *  on mount via `loadTiers`), not the roster. Each option carries the
 *  slug used for the backend filter and the display name. Includes a
 *  `none` sentinel so admins can isolate members with no active tier. */
const membershipOptions = computed<Array<{ slug: string; label: string }>>(() => {
  const opts: Array<{ slug: string; label: string }> = availableTiers.value
    .filter((t) => t.slug != null)
    .map((t) => ({ slug: t.slug as string, label: t.type_name }))
    .sort((a, b) => a.label.localeCompare(b.label))
  opts.push({ slug: 'none', label: 'No tier assigned' })
  return opts
})

function initials(m: Member) {
  return m.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}

/**
 * True when the member has an actual uploaded avatar. Cloudflare Images
 * hosts our uploads on `imagedelivery.net`; anything else the server
 * hands back (gravatar-style URLs, generic silhouettes) is a default
 * we'd rather replace with initials.
 */
/** Cloudflare Images URLs look like
 *    https://imagedelivery.net/{account_hash}/{image_id}/{variant}
 *  — pull out the stable `image_id` so a logo served as `/public` matches
 *  an avatar served as `/thumbnail` of the same asset. */
function cfImageId(url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(/imagedelivery\.net\/[^/]+\/([^/?#]+)/)
  return m?.[1] ?? null
}
/** CF Image IDs known to be baked-in defaults from the backend (pre-brief-53).
 *  Reject these as "not a real avatar" until the brief 53 backfill runs. */
const TORNY_DEFAULT_AVATAR_IDS = new Set<string>([
  'e6f09767-ae0b-49cd-825e-3e387f4d8600', // generic Torny placeholder
])
// Treat uploads on our Cloudflare Images CDN as real avatars, EXCEPT the
// stock Torny placeholder or the active club's own logo — both of which
// the backend used to bake in as a default before migration 119. Once the
// brief 53 backfill runs, this guard can collapse back to the single
// `.includes('imagedelivery.net')` check.
function hasRealAvatar(m: Member): boolean {
  const url = m.avatarUrl
  if (!url) return false
  if (!url.includes('imagedelivery.net')) return false
  const avatarId = cfImageId(url)
  if (avatarId && TORNY_DEFAULT_AVATAR_IDS.has(avatarId)) return false
  const logoId = cfImageId(clubStore.current?.logoUrl)
  if (avatarId && logoId && avatarId === logoId) return false
  return true
}

const _statusTone: Record<MemberStatus, string> = {
  Active: 'ok',
  Prospect: 'mute',
  Visitor: 'warn',
  Pending: 'warn',
  Lapsed: 'danger',
}

// ── Fee display helpers ─────────────────────────────────────────
const CADENCE_SUFFIX: Record<NonNullable<Member['cadence']>, string> = {
  annual: '/yr',
  monthly: '/mo',
  season: '/season',
}

/** "$240/yr" or "$240" (when cadence is unknown). Empty string if fee is null. */
function feeLabel(m: Member): string {
  if (m.fee == null) return ''
  const suffix = m.cadence ? CADENCE_SUFFIX[m.cadence] : ''
  return suffix ? `$${m.fee}${suffix}` : `$${m.fee}`
}

/**
 * Amount summary — what to show under the dues pill. Follows punch-list §6:
 * - Paid / waived:   "Paid"
 * - Some paid:       "$120 / $240"
 * - Nothing paid:    "Owes $240"
 * - No tier:         "" (nothing to show)
 */
function _duesAmountLabel(m: Member): string {
  if (m.fee == null) return ''
  const status = m.paymentStatus
  if (status === 'paid' || status === 'waived') return 'Paid'
  const paid = m.totalPaidThisSeason ?? 0
  if (paid > 0) return `$${paid} / $${m.fee}`
  const owed = m.balanceOwed ?? m.fee
  return `Owes $${owed}`
}

const _duesTone: Record<DuesStatus, string> = {
  Paid: 'ok',
  Due: 'warn',
  Overdue: 'danger',
}

/**
 * Unified "Standing" — the single pill that replaces the redundant
 * Dues + Status pair. One tone, one label, plus a natural-language
 * sub-line telling the story (last payment, next due, etc.).
 *
 * Precedence (financial-first — the Standing column is for billing, not
 * invite state; a pending invite still falls through to its tier/payment
 * story so admins see "Due · $260" instead of "Invited"):
 *   1. Lapsed          → "No active membership"
 *   2. Waived fees     → "Fees waived"
 *   3. Overdue         → "Overdue since {date}"
 *   4. Partial payment → "$X of $Y paid"
 *   5. Due soon        → "Due {date}"
 *   6. Paid up         → "Last paid {date}"
 *   7. No tier         → "No membership"
 */
type StandingTone = 'paid' | 'due' | 'overdue' | 'waived' | 'partial' | 'invited' | 'lapsed' | 'prospect' | 'visitor' | 'none'
interface Standing {
  tone: StandingTone
  label: string
  sub: string
}
const SHORT_DATE_FMT = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return SHORT_DATE_FMT.format(d)
}
function standing(m: Member): Standing {
  // Prospects + visitors (brief 56) have no billing — short-circuit before
  // the payment-status fall-through so we never claim they owe anything.
  if (m.status === 'Prospect') {
    const sub = m.source === 'enquiry'
      ? (m.sourceRefId != null ? `From enquiry #${m.sourceRefId}` : 'From enquiry')
      : 'Lead · no fees owing'
    return { tone: 'prospect', label: 'Prospect', sub }
  }
  if (m.status === 'Visitor') {
    return { tone: 'visitor', label: 'Visitor', sub: 'Guest · no fees owing' }
  }
  if (m.status === 'Lapsed') {
    const on = formatShortDate(m.revokedAt)
    return { tone: 'lapsed', label: 'Lapsed', sub: on ? `Left ${on}` : 'No active membership' }
  }
  if (m.paymentStatus === 'waived') {
    return { tone: 'waived', label: 'Waived', sub: 'Fees waived' }
  }
  if (m.paymentStatus === 'overdue') {
    const since = formatShortDate(m.paymentDueDate)
    return {
      tone: 'overdue',
      label: m.fee != null ? `Overdue · $${m.fee}` : 'Overdue',
      sub: since ? `Overdue since ${since}` : 'Payment overdue',
    }
  }
  if (m.paymentStatus === 'partial') {
    const paid = m.totalPaidThisSeason ?? 0
    return {
      tone: 'partial',
      label: m.fee != null ? `Part · $${paid}/$${m.fee}` : 'Partial',
      sub: m.balanceOwed != null
        ? `$${m.balanceOwed} outstanding${m.paymentDueDate ? ` · Due ${formatShortDate(m.paymentDueDate)}` : ''}`
        : 'Partial payment',
    }
  }
  if (m.paymentStatus === 'paid') {
    const on = formatShortDate(m.lastPaymentDate)
    return {
      tone: 'paid',
      label: m.fee != null ? `Paid · $${m.fee}` : 'Paid',
      sub: on ? `Last paid ${on}` : 'Up to date',
    }
  }
  if (m.paymentStatus === 'unpaid' || m.duesStatus === 'Due') {
    const on = formatShortDate(m.paymentDueDate)
    return {
      tone: 'due',
      label: m.fee != null ? `Due · $${m.fee}` : 'Due',
      sub: on ? `Due ${on}` : 'Payment due',
    }
  }
  if (m.fee == null) {
    return { tone: 'none', label: 'No tier', sub: 'No membership assigned' }
  }
  return { tone: 'paid', label: 'Up to date', sub: 'No outstanding balance' }
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

// ── Server-side roster summary + tier list ────────────────────
// Replaces the old client-side sums (which used last_payment_amount and
// undercounted by design). Summary and tier list are fetched once per club
// change; summary is also refetched after any payment or add/remove.
const summary = ref<MembersSummary | null>(null)
const summaryLoading = ref(false)
const availableTiers = ref<MembershipTierListItem[]>([])
const tiersLoading = ref(false)

// Seasons list + which one drives the summary. `null` = server's current
// season (its own choice); numeric id = view a past / future season without
// changing which is current on the club.
const seasonsList = ref<Season[]>([])
const selectedSeasonId = ref<number | null>(null)

async function loadSummary() {
  const cid = clubStore.current?.id
  if (cid == null) { summary.value = null; return }
  summaryLoading.value = true
  try {
    summary.value = await membersApi.summary(
      cid,
      selectedSeasonId.value != null ? { season_id: selectedSeasonId.value } : {},
    )
    // Server tells us which season it actually returned — track it so the
    // picker's selection stays in sync when we default to "current".
    if (selectedSeasonId.value == null && summary.value?.season_id != null) {
      selectedSeasonId.value = summary.value.season_id
    }
  } catch {
    summary.value = null
  } finally {
    summaryLoading.value = false
  }
}

async function loadSeasons() {
  const cid = clubStore.current?.id
  if (cid == null) { seasonsList.value = []; return }
  try {
    seasonsList.value = await seasonsApi.list(cid)
  } catch {
    seasonsList.value = []
  }
}

function onSeasonChange() {
  void loadSummary()
}

async function loadTiers() {
  const cid = clubStore.current?.id
  if (cid == null) { availableTiers.value = []; return }
  tiersLoading.value = true
  try {
    const res = await membersApi.listTiers(cid)
    availableTiers.value = res.tiers
  } catch {
    availableTiers.value = []
  } finally {
    tiersLoading.value = false
  }
}


// ── Navigation to detail page ───────────────────────────────────
// The detail modal was replaced by MemberDetailView (design 33).
// `activeMember` + `detailOpen` + `closeDetail` are kept as stubs so
// the follow-on Edit / Payment / Remove modals (which read them) still
// compile — they'll be re-triggered from the detail page in a follow-up.
const activeMember = ref<Member | null>(null)
const detailOpen = ref(false)
function _closeDetail() { detailOpen.value = false }
function openDetail(m: Member) {
  router.push({ name: 'member-detail', params: { id: m.id } })
}

// ── Edit member modal ──────────────────────────────────────────
// Owner-only can promote to admin. Everyone else picks from committee/player.
const callerIsOwner = computed(() => {
  const cid = clubStore.current?.id
  if (cid == null) return false
  return authStore.user?.clubs?.some((c) => c.id === cid && c.role === 'owner') ?? false
})

/** Owner OR admin — the two roles the server accepts on season create /
 *  set-current endpoints. Non-admins see the picker but not "New season". */
const callerCanManageSeasons = computed(() => {
  const cid = clubStore.current?.id
  if (cid == null) return false
  return (
    authStore.user?.clubs?.some(
      (c) => c.id === cid && (c.role === 'owner' || c.role === 'admin'),
    ) ?? false
  )
})

// ── New season modal ───────────────────────────────────────────
// Full modal state + submit lives in NewSeasonModal.vue. The parent
// just toggles `open` and reacts to `@created` so the roster view can
// reload seasons + flip the picker to the new one.
const newSeasonOpen = ref(false)
function openNewSeason() { newSeasonOpen.value = true }

async function onSeasonCreated(created: Season) {
  await loadSeasons()
  selectedSeasonId.value = created.season_id
  await loadSummary()
}

const editOpen = ref(false)
const editSubmitting = ref(false)
const editError = ref<string | null>(null)
const editForm = reactive({
  role: 'player' as 'admin' | 'committee' | 'player',
  title: '' as string,
  typeId: null as number | null,
  positionGroup: 'member' as PositionGroup,
  publicVisible: true,
  bio: '' as string,
})

const POSITION_GROUPS: Array<{ value: PositionGroup; label: string; hint: string }> = [
  { value: 'board', label: 'Board', hint: 'President, Secretary, Treasurer, Committee chairs.' },
  { value: 'staff', label: 'Staff', hint: 'General Manager, CEO, Greenkeeper, Bar Manager.' },
  { value: 'committee', label: 'Committee', hint: 'Voting members of a sub-committee.' },
  { value: 'member', label: 'Member', hint: 'Regular playing member — the default.' },
]


function _openEditMember() {
  if (!activeMember.value) return
  const m = activeMember.value
  // Owner can't be edited via this endpoint (backend returns 409 owner_immutable).
  if (m.apiRole === 'owner') {
    toast.info("The club owner can't be edited here — use ownership transfer.")
    return
  }
  editForm.role = (m.apiRole === 'admin' || m.apiRole === 'committee' || m.apiRole === 'player') ? m.apiRole : 'player'
  editForm.title = m.title ?? ''
  editForm.typeId = m.membershipTypeId ?? null
  editForm.positionGroup = m.positionGroup ?? 'member'
  editForm.publicVisible = m.publicVisible ?? true
  editForm.bio = m.bio ?? ''
  editError.value = null
  editOpen.value = true
}

function closeEdit() {
  editOpen.value = false
}

async function submitEdit() {
  const m = activeMember.value
  const cid = clubStore.current?.id
  if (!m || cid == null) return
  editSubmitting.value = true
  editError.value = null
  try {
    await membersApi.patchMember(cid, Number(m.id), {
      role: editForm.role,
      title: editForm.title.trim() || null,
      membership_type_id: editForm.typeId,
      position_group: editForm.positionGroup,
      public_visible: editForm.publicVisible,
      bio: editForm.bio.trim() || null,
    })
    toast.success(`Updated ${m.name}.`)
    editOpen.value = false
    detailOpen.value = false
    await Promise.all([loadRoster(), loadSummary()])
  } catch (err) {
    if (err instanceof ApiError) {
      switch (err.code) {
        case 'owner_immutable':   editError.value = "You can't edit the club owner via this form."; break
        case 'owner_via_transfer': editError.value = "Can't set role to owner here — use ownership transfer."; break
        case 'member_revoked':    editError.value = "This member was removed — re-add them first."; break
        case 'unknown_type':      editError.value = 'That membership tier isn\'t on this club.'; break
        case 'forbidden':         editError.value = "You don't have permission to change to admin."; break
        default:                  editError.value = err.message
      }
    } else {
      editError.value = (err as Error).message
    }
  } finally {
    editSubmitting.value = false
  }
}

// ── Record payment modal ───────────────────────────────────────
const paymentOpen = ref(false)
const paymentSubmitting = ref(false)
const paymentError = ref<string | null>(null)
const paymentForm = reactive({
  amount: 0,
  date: new Date().toISOString().slice(0, 10),
  method: 'bank_transfer' as PaymentMethod,
  reference: '',
  notes: '',
  waived: false,
  // Season the payment attaches to. Defaults to the page's picker so what
  // the admin sees in the summary cards is what the payment feeds — can be
  // overridden in-modal for a back-dated or pre-paid entry.
  seasonId: null as number | null,
})

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function _openPayment() {
  if (!activeMember.value) return
  const m = activeMember.value
  if (m.apiRole && m.membershipTypeId == null) {
    toast.info(`${m.name} has no membership tier yet — assign one via Edit first.`)
    return
  }
  // Try to pre-fill the fee from any roster row on the same tier.
  const same = members.value.find((x) => x.membershipTypeId === m.membershipTypeId && x !== m)
  paymentForm.amount = 0
  paymentForm.date = todayIso()
  paymentForm.method = 'bank_transfer'
  paymentForm.reference = ''
  paymentForm.notes = ''
  paymentForm.waived = false
  paymentForm.seasonId = selectedSeasonId.value
  paymentError.value = null
  // membershipFee isn't stored on the local Member view; fall back to 0 for the input
  void same
  paymentOpen.value = true
}

function closePayment() {
  paymentOpen.value = false
}

function toggleWaived() {
  paymentForm.waived = !paymentForm.waived
  if (paymentForm.waived) {
    paymentForm.method = 'waived'
    paymentForm.amount = 0
  } else {
    paymentForm.method = 'bank_transfer'
  }
}

const canSubmitPayment = computed(() => {
  if (paymentForm.waived) return true
  return paymentForm.amount >= 0 && paymentForm.date.length === 10
})

async function submitPayment() {
  const m = activeMember.value
  const cid = clubStore.current?.id
  if (!m || cid == null || !canSubmitPayment.value) return
  paymentSubmitting.value = true
  paymentError.value = null
  try {
    const result = await membersApi.recordPayment(cid, Number(m.id), {
      amount: paymentForm.waived ? 0 : Number(paymentForm.amount),
      payment_date: paymentForm.date,
      payment_method: paymentForm.method,
      payment_reference: paymentForm.reference.trim() || undefined,
      notes: paymentForm.notes.trim() || undefined,
      season_id: paymentForm.seasonId ?? undefined,
    })
    const verb = paymentForm.waived
      ? 'Fees waived'
      : result.payment_status === 'paid'
        ? 'Marked as paid'
        : result.payment_status === 'partial'
          ? 'Partial payment recorded'
          : 'Payment recorded'
    const seasonSuffix = result.season_name ? ` · ${result.season_name}` : ''
    toast.success(`${verb} for ${m.name}${seasonSuffix}.`)
    paymentOpen.value = false
    detailOpen.value = false
    await Promise.all([loadRoster(), loadSummary()])
  } catch (err) {
    if (err instanceof ApiError) {
      switch (err.code) {
        case 'invalid_amount': paymentError.value = 'Amount needs to be zero or higher.'; break
        case 'invalid_method': paymentError.value = 'Payment method isn\'t valid.'; break
        case 'invalid_date':   paymentError.value = 'Date needs to be YYYY-MM-DD.'; break
        case 'forbidden':      paymentError.value = "You don't have permission to record payments."; break
        default:               paymentError.value = err.status === 404
          ? "This member has no membership tier yet — assign one via Edit first."
          : err.message
      }
    } else {
      paymentError.value = (err as Error).message
    }
  } finally {
    paymentSubmitting.value = false
  }
}

async function _removeActiveMember() {
  const m = activeMember.value
  const cid = clubStore.current?.id
  if (!m || cid == null) return
  const ok = confirm(`Remove ${m.name} from the club? They'll appear under Lapsed and can be re-linked later.`)
  if (!ok) return
  try {
    await membersApi.remove(cid, Number(m.id))
    toast.success(`${m.name} removed.`)
    detailOpen.value = false
    await Promise.all([loadRoster(), loadSummary()])
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
type AddType = 'member' | 'prospect' | 'visitor'
const emptyForm = () => ({
  type: 'member' as AddType,
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
const ADD_TYPES: { value: AddType; label: string; hint: string }[] = [
  { value: 'member',   label: 'Member',   hint: 'Paying — resolves a tier, optional invite.' },
  { value: 'prospect', label: 'Prospect', hint: 'Lead — no tier, no invite, no subs.' },
  { value: 'visitor',  label: 'Visitor',  hint: 'Casual guest — no tier, no invite, no subs.' },
]

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

// Resolve tier name → id via the dedicated /membership-tiers endpoint.
function tierIdForMembership(name: MembershipType): number | undefined {
  const hit = availableTiers.value.find((t) => t.type_name === name)
  return hit?.id
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
  const isPaying = form.type === 'member'
  try {
    const result = await membersApi.add(cid, {
      email: form.email.trim(),
      first_name: form.firstName.trim(),
      last_name: form.lastName.trim(),
      phone: form.phone.trim() || undefined,
      role: toApiRole(form.role),
      title: form.role === 'Coach' || form.role === 'Junior' || form.role === 'Volunteer' ? form.role : undefined,
      // Tier + invite are only wired for paying members. Server ignores
      // them for prospect/visitor anyway (see brief 56 §2), but omitting
      // keeps the payload honest.
      membership_type_id: isPaying ? tierIdForMembership(form.membership) : undefined,
      membership_type: isPaying ? form.membership : undefined,
      send_invite: isPaying ? form.sendInvite : false,
      member_status: form.type,
    })
    const name = `${form.firstName.trim()} ${form.lastName.trim()}`
    const typeLabel = form.type === 'prospect' ? 'as prospect' : form.type === 'visitor' ? 'as visitor' : ''
    switch (result.resolution) {
      case 'linked':       toast.success(`${name} linked from an existing Torny user${typeLabel ? ' ' + typeLabel : ''}.`); break
      case 'relinked':     toast.success(`${name} was previously removed — re-linked${typeLabel ? ' ' + typeLabel : ''}.`); break
      case 'invited':      toast.success(`Invite emailed to ${form.email.trim()}.`); break
      case 'stub_created': toast.success(`${name} added${typeLabel ? ' ' + typeLabel : ''}.`); break
    }
    closeAdd()
    await Promise.all([loadRoster(), loadSummary()])
  } catch (err) {
    if (err instanceof ApiError) {
      switch (err.code) {
        case 'already_member':         addError.value = 'That email is already an active member.'; break
        case 'invite_exists':          addError.value = 'A pending invite already exists for that email.'; break
        case 'invalid_email':          addError.value = 'That email isn\'t valid.'; break
        case 'unknown_type':           addError.value = 'That membership tier isn\'t on this club yet — finish onboarding first.'; break
        case 'invalid_member_status':  addError.value = 'That member type isn\'t supported.'; break
        default:                       addError.value = err.message
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
        <label v-if="seasonsList.length > 0" class="season-picker">
          <span class="season-picker__label">Season</span>
          <select
            v-model="selectedSeasonId"
            class="season-picker__select"
            @change="onSeasonChange"
          >
            <option
              v-for="s in seasonsList"
              :key="s.season_id"
              :value="s.season_id"
            >
              {{ s.season_name }}{{ s.is_current_season ? ' · current' : '' }}
            </option>
          </select>
          <svg class="season-picker__chev" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </label>
        <button
          v-if="callerCanManageSeasons"
          type="button"
          class="members__btn members__btn--outline"
          @click="openNewSeason"
        >
          + New season
        </button>
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

    <!-- Roster stat panels — server-side summary (brief 13).
         Extracted to MemberSummaryStats.vue; parent still fetches the data. -->
    <MemberSummaryStats :summary="summary" />

    <div class="filters">
      <div class="chips">
        <button
          v-for="tab in (['all', 'Active', 'Prospect', 'Visitor', 'Pending', 'Lapsed'] as const)"
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
            <option v-for="opt in membershipOptions" :key="opt.slug" :value="opt.slug">{{ opt.label }}</option>
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

    <!-- Bulk actions bar — appears once anything is ticked. Lives
         inline above the table so the primary action stays near the
         rows the admin just selected. -->
    <div v-if="selectedCount > 0" class="selection-bar" role="status" aria-live="polite">
      <div class="selection-bar__count">
        <strong>{{ selectedCount }}</strong> selected
        <span v-if="selectedWithoutEmail > 0" class="selection-bar__warn">
          · {{ selectedWithoutEmail }} without email
        </span>
      </div>
      <div class="selection-bar__actions">
        <button
          type="button"
          class="selection-bar__btn selection-bar__btn--primary"
          :disabled="selectedCount === selectedWithoutEmail"
          @click="openBulkEmail"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
          Send email
        </button>
        <button type="button" class="selection-bar__btn selection-bar__btn--ghost" @click="clearSelection">
          Clear
        </button>
      </div>
    </div>

    <!-- Desktop table -->
    <table class="table">
      <thead>
        <tr>
          <th class="table__check">
            <input
              ref="selectAllEl"
              type="checkbox"
              :checked="allVisibleSelected"
              :aria-label="allVisibleSelected ? 'Deselect all visible members' : 'Select all visible members'"
              @change="toggleAllVisible"
            />
          </th>
          <th>Name</th>
          <th>Email</th>
          <th>Membership</th>
          <th>Standing</th>
          <th aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in filtered" :key="m.id" class="row" :class="{ 'row--lapsed': m.status === 'Lapsed', 'row--selected': isSelected(m) }" tabindex="0" @click="openDetail(m)" @keydown.enter="openDetail(m)">
          <td class="row__check" @click.stop>
            <input
              type="checkbox"
              :checked="isSelected(m)"
              :aria-label="`Select ${m.name}`"
              @change="toggleSelected(m)"
              @click.stop
            />
          </td>
          <td class="row__name">
            <div class="row__name-inner">
              <div
                class="row__avatar"
                :class="{ 'row__avatar--image': hasRealAvatar(m), 'row__avatar--invited': m.status === 'Pending' }"
              >
                <img v-if="hasRealAvatar(m)" :src="m.avatarUrl!" :alt="m.name" />
                <template v-else>{{ initials(m) }}</template>
              </div>
              <div class="row__name-text">
                <div class="row__name-main">
                  {{ m.name }}
                  <span v-if="membershipBadge(m)" class="badge" :class="`badge--${membershipBadge(m)!.tone}`">{{ membershipBadge(m)!.label }}</span>
                  <span v-if="roleBadge(m)" class="badge" :class="`badge--${roleBadge(m)!.tone}`">{{ roleBadge(m)!.label }}</span>
                </div>
                <div class="row__name-sub">
                  <template v-if="m.memberNumber !== '—'">{{ m.memberNumber }}</template>
                  <template v-if="m.joinedAt !== '—'"><template v-if="m.memberNumber !== '—'"> · </template>Joined {{ m.joinedAt }}</template>
                  <template v-if="m.phone"><template v-if="m.memberNumber !== '—' || m.joinedAt !== '—'"> · </template>{{ m.phone }}</template>
                </div>
              </div>
            </div>
          </td>
          <td>{{ m.email }}</td>
          <td>
            <div>{{ m.membership }}</div>
            <div v-if="feeLabel(m)" class="row__fee">{{ feeLabel(m) }}</div>
          </td>
          <td>
            <span class="standing-pill" :class="`standing-pill--${standing(m).tone}`">{{ standing(m).label }}</span>
            <div class="row__standing-sub" :class="{ 'row__standing-sub--danger': standing(m).tone === 'overdue' }">{{ standing(m).sub }}</div>
          </td>
          <td class="row__chev" aria-hidden="true">›</td>
        </tr>
        <template v-if="showTableSkeleton">
          <tr
            v-for="i in 5"
            :key="`sk-${i}`"
            class="row row--skeleton"
            aria-busy="true"
          >
            <td class="row__check" aria-hidden="true" />
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
            <td>
              <CrmSkeleton shape="text" width="55%" />
              <CrmSkeleton shape="text" width="35%" />
            </td>
            <td>
              <CrmSkeleton width="86px" height="18px" radius="999px" />
              <CrmSkeleton shape="text" width="60%" />
            </td>
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
      <li v-for="m in filtered" :key="m.id" class="card" :class="{ 'card--lapsed': m.status === 'Lapsed', 'card--selected': isSelected(m) }" tabindex="0" @click="openDetail(m)" @keydown.enter="openDetail(m)">
        <label class="card__check" @click.stop>
          <input
            type="checkbox"
            :checked="isSelected(m)"
            :aria-label="`Select ${m.name}`"
            @change="toggleSelected(m)"
            @click.stop
          />
        </label>
        <div
          class="card__avatar"
          :class="{ 'card__avatar--image': hasRealAvatar(m), 'card__avatar--invited': m.status === 'Pending' }"
        >
          <img v-if="hasRealAvatar(m)" :src="m.avatarUrl!" :alt="m.name" />
          <template v-else>{{ initials(m) }}</template>
        </div>
        <div class="card__body">
          <div class="card__name-row">
            <div class="card__name">{{ m.name }}</div>
            <span class="standing-pill" :class="`standing-pill--${standing(m).tone}`">{{ standing(m).label }}</span>
          </div>
          <div class="card__badges">
            <span v-if="membershipBadge(m)" class="badge" :class="`badge--${membershipBadge(m)!.tone}`">{{ membershipBadge(m)!.label }}</span>
            <span v-if="roleBadge(m)" class="badge" :class="`badge--${roleBadge(m)!.tone}`">{{ roleBadge(m)!.label }}</span>
          </div>
          <div class="card__meta">
            <span>{{ m.membership }}</span>
            <template v-if="feeLabel(m)"><span class="card__meta-sep">·</span><span class="card__meta-mono">{{ feeLabel(m) }}</span></template>
          </div>
          <div class="card__standing-sub" :class="{ 'card__standing-sub--danger': standing(m).tone === 'overdue' }">{{ standing(m).sub }}</div>
          <div class="card__contact">{{ m.email }}<template v-if="m.phone"> · {{ m.phone }}</template></div>
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

    <!-- Detail modal replaced by MemberDetailView (design 33). -->

    <!-- Edit member modal -->
    <CrmModal
      :open="editOpen"
      eyebrow="Roster"
      :title="activeMember ? `Edit ${activeMember.name}` : 'Edit member'"
      width="md"
      @close="closeEdit"
    >
      <form class="form" @submit.prevent="submitEdit">
        <label class="field">
          <span class="field__label">Role</span>
          <select v-model="editForm.role">
            <option value="player">Player</option>
            <option value="committee">Committee</option>
            <option v-if="callerIsOwner" value="admin">Admin</option>
          </select>
          <span v-if="!callerIsOwner" class="field__hint">Only the club owner can promote to Admin.</span>
        </label>

        <label class="field">
          <span class="field__label">Title (optional)</span>
          <input v-model="editForm.title" type="text" maxlength="80" placeholder="e.g. Secretary, Head Coach, Life Member" />
        </label>

        <label class="field">
          <span class="field__label">Membership tier</span>
          <select v-model.number="editForm.typeId">
            <option :value="null">— No tier —</option>
            <option v-for="t in availableTiers" :key="t.id" :value="t.id">{{ t.type_name }}</option>
          </select>
          <span v-if="availableTiers.length === 0" class="field__hint">Finish onboarding (Step 4) to define membership tiers.</span>
        </label>

        <label class="field">
          <span class="field__label">Position group</span>
          <select v-model="editForm.positionGroup">
            <option v-for="g in POSITION_GROUPS" :key="g.value" :value="g.value">{{ g.label }}</option>
          </select>
          <span class="field__hint">
            {{ POSITION_GROUPS.find((g) => g.value === editForm.positionGroup)?.hint }}
          </span>
        </label>

        <label class="field field--switch">
          <span class="field__switch-copy">
            <span class="field__label">Show on the public directory</span>
            <span class="field__hint">Uncheck to hide this member from the meet-the-club block and their public player profile.</span>
          </span>
          <button
            type="button"
            class="edit-switch"
            :class="{ 'is-on': editForm.publicVisible }"
            @click="editForm.publicVisible = !editForm.publicVisible"
            :aria-pressed="editForm.publicVisible"
          >
            <span class="edit-switch__knob" />
          </button>
        </label>

        <label class="field">
          <span class="field__label">Public bio</span>
          <textarea v-model="editForm.bio" rows="4" maxlength="1000" placeholder="A short intro shown on this member's public player profile." />
          <span class="field__hint">Visible to anyone on the public site. Max 1000 characters.</span>
        </label>

        <p v-if="editError" class="add-error">{{ editError }}</p>
      </form>

      <template #footer>
        <button type="button" class="btn btn--outline" @click="closeEdit" :disabled="editSubmitting">Cancel</button>
        <button
          type="button"
          class="btn btn--primary"
          :disabled="editSubmitting"
          @click="submitEdit"
        >{{ editSubmitting ? 'Saving…' : 'Save changes' }}</button>
      </template>
    </CrmModal>

    <!-- Record payment modal -->
    <CrmModal
      :open="paymentOpen"
      eyebrow="Roster"
      :title="activeMember ? `Record payment — ${activeMember.name}` : 'Record payment'"
      width="md"
      @close="closePayment"
    >
      <form class="form" @submit.prevent="submitPayment">
        <div class="switch-row">
          <div>
            <div class="switch-row__label">Waive fees</div>
            <div class="switch-row__hint">For life members or complimentary access. Amount is set to $0.</div>
          </div>
          <button
            type="button"
            class="switch"
            :class="{ 'is-on': paymentForm.waived }"
            @click="toggleWaived"
          ><span class="switch__knob" /></button>
        </div>

        <div class="form__row" v-if="!paymentForm.waived">
          <label class="field">
            <span class="field__label">Amount ($)</span>
            <input v-model.number="paymentForm.amount" type="number" min="0" step="1" />
          </label>
          <label class="field">
            <span class="field__label">Payment date</span>
            <input v-model="paymentForm.date" type="date" />
          </label>
        </div>

        <label class="field" v-if="!paymentForm.waived">
          <span class="field__label">Method</span>
          <select v-model="paymentForm.method">
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="cheque">Cheque</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label class="field" v-if="seasonsList.length > 0">
          <span class="field__label">Season</span>
          <select v-model.number="paymentForm.seasonId">
            <option
              v-for="s in seasonsList"
              :key="s.season_id"
              :value="s.season_id"
            >
              {{ s.season_name }}{{ s.is_current_season ? ' · current' : '' }}
            </option>
          </select>
          <span class="field__hint">Payment attaches to this season's totals. Defaults to what's showing above.</span>
        </label>

        <label class="field">
          <span class="field__label">Reference (optional)</span>
          <input v-model="paymentForm.reference" type="text" maxlength="100" placeholder="e.g. ANZ-12345, receipt #A234" />
        </label>

        <label class="field">
          <span class="field__label">Notes (optional)</span>
          <input v-model="paymentForm.notes" type="text" placeholder="e.g. Cleared July invoice" />
        </label>

        <p v-if="paymentError" class="add-error">{{ paymentError }}</p>
      </form>

      <template #footer>
        <button type="button" class="btn btn--outline" @click="closePayment" :disabled="paymentSubmitting">Cancel</button>
        <button
          type="button"
          class="btn btn--primary"
          :disabled="!canSubmitPayment || paymentSubmitting"
          @click="submitPayment"
        >{{ paymentSubmitting ? 'Recording…' : (paymentForm.waived ? 'Waive fees' : 'Record payment') }}</button>
      </template>
    </CrmModal>

    <!-- New season modal (owner / admin only) — extracted to NewSeasonModal.vue. -->
    <NewSeasonModal
      :open="newSeasonOpen"
      :club-id="clubStore.current?.id ?? null"
      @close="newSeasonOpen = false"
      @created="onSeasonCreated"
    />

    <!-- Add member modal -->
    <CrmModal
      :open="addOpen"
      eyebrow="Roster"
      title="Add a member"
      width="md"
      @close="closeAdd"
    >
      <form class="form" @submit.prevent="submit">
        <!-- Type picker: paying member vs prospect/visitor (brief 56).
             Non-member types hide tier + invite + pending switches. -->
        <div class="type-picker" role="radiogroup" aria-label="Member type">
          <button
            v-for="t in ADD_TYPES"
            :key="t.value"
            type="button"
            class="type-picker__option"
            :class="{ 'type-picker__option--active': form.type === t.value }"
            role="radio"
            :aria-checked="form.type === t.value"
            @click="form.type = t.value"
          >
            <span class="type-picker__label">{{ t.label }}</span>
            <span class="type-picker__hint">{{ t.hint }}</span>
          </button>
        </div>

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
        <div class="form__row" v-if="form.type !== 'visitor'">
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
        <label v-else class="field">
          <span class="field__label">Phone</span>
          <input v-model="form.phone" type="tel" placeholder="021 555 0000" />
        </label>
        <label v-if="form.type === 'member'" class="field">
          <span class="field__label">Membership</span>
          <select v-model="form.membership">
            <option>Playing member</option>
            <option>Social member</option>
            <option>Life member</option>
            <option>Junior</option>
          </select>
        </label>

        <template v-if="form.type === 'member'">
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
        </template>

        <p v-else class="form__hint">
          {{ form.type === 'prospect'
            ? 'Prospects don\'t get a tier, invite, or subs invoice. Promote them later from Member Detail.'
            : 'Visitors are tracked for the roster + roll-ups. No tier, no invite, no subs.' }}
        </p>

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

    <SendEmailModal
      :open="sendEmailOpen"
      :club-id="clubStore.current?.id ?? null"
      :members="selectedRecipients"
      @close="sendEmailOpen = false"
      @sent="onBulkEmailSent"
    />
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
.row__fee { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); margin-top: 3px; }
.row__dues-amount { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); margin-top: 4px; }
.row__standing-sub { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 4px; }
.row__standing-sub--danger { color: #991B1B; }
.row--lapsed .row__name-inner,
.row--lapsed td:nth-child(2),
.row--lapsed td:nth-child(3) { opacity: 0.7; }
.row__avatar--invited { background: var(--color-surface); color: var(--color-mute); border: 1px dashed var(--color-hairline); }

.standing-pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; }
.standing-pill--paid     { background: #DCFCE7; color: #14532D; }
.standing-pill--due      { background: #FEF3C7; color: #92400E; }
.standing-pill--overdue  { background: #FEE2E2; color: #991B1B; }
.standing-pill--waived   { background: var(--color-surface); color: var(--color-graphite); border: 1px solid var(--color-hairline); }
.standing-pill--partial  { background: #FFEDD5; color: var(--color-feature-tangerine); }
.standing-pill--invited  { background: var(--color-accent-soft); color: var(--color-accent); }
.standing-pill--lapsed   { background: var(--color-surface); color: var(--color-fog); border: 1px solid var(--color-hairline); }
.standing-pill--none     { background: var(--color-surface); color: var(--color-mute); border: 1px dashed var(--color-hairline); }
.standing-pill--prospect { background: var(--color-surface); color: var(--color-graphite); border: 1px dashed var(--color-fog); }
.standing-pill--visitor  { background: #FEF3C7; color: #78350F; }
.row__chev { text-align: right; color: var(--color-mute); font-size: 18px; padding-right: 20px; width: 24px; }
.row--skeleton { cursor: default; }
.row--skeleton:hover { background: transparent; }
.row__name-text--sk { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
.row__name-text--sk .crm-skeleton { display: block; }

/* Selection checkbox column */
.table__check,
.row__check {
  width: 36px;
  padding-left: 16px;
  padding-right: 0;
  text-align: center;
}
.table__check input,
.row__check input,
.card__check input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--color-ink);
  cursor: pointer;
}
.table tbody tr.row--selected { background: var(--color-accent-soft); }
.table tbody tr.row--selected:hover { background: color-mix(in srgb, var(--color-accent-soft) 80%, var(--color-accent) 20%); }

/* Bulk action bar — matches the pill-shaped controls used elsewhere.
   Lives inline so there's no fixed-position overlay to collide with
   the sidebar / mobile nav. */
.selection-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: var(--color-ink);
  color: #fff;
  border-radius: 12px;
  flex-wrap: wrap;
}
.selection-bar__count { font-family: var(--font-body); font-size: 13px; color: rgba(255, 255, 255, 0.85); }
.selection-bar__count strong { color: #fff; font-weight: 700; margin-right: 4px; }
.selection-bar__warn { color: #FDE68A; margin-left: 2px; }
.selection-bar__actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.selection-bar__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s ease;
}
.selection-bar__btn--primary { background: #fff; color: var(--color-ink); }
.selection-bar__btn--primary:hover:not(:disabled) { background: var(--color-surface); }
.selection-bar__btn--primary:disabled { background: rgba(255, 255, 255, 0.4); color: rgba(0, 0, 0, 0.4); cursor: not-allowed; }
.selection-bar__btn--ghost { background: transparent; color: #fff; border: 1px solid rgba(255, 255, 255, 0.3); }
.selection-bar__btn--ghost:hover { background: rgba(255, 255, 255, 0.1); }

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
.card__meta { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-family: var(--font-body); font-size: 12px; color: var(--color-ink); }
.card__meta-sep { color: var(--color-hairline); }
.card__meta-mono { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); }
.card__standing-sub { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 4px; }
.card__standing-sub--danger { color: #991B1B; }
.card__avatar--invited { background: var(--color-surface); color: var(--color-mute); border: 1px dashed var(--color-hairline); }
.card--lapsed .card__avatar,
.card--lapsed .card__meta,
.card--lapsed .card__contact { opacity: 0.7; }
.card__check { display: inline-flex; align-items: center; justify-content: center; width: 20px; margin-right: -4px; flex-shrink: 0; }
.card--selected { background: var(--color-accent-soft); border-color: var(--color-accent); }
.card__fee { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); margin-top: 6px; flex-wrap: wrap; }
.card__fee-sep { opacity: 0.5; }
.card__fee-ok { color: var(--color-graphite); }
.card__fee-warn { color: #92400E; font-weight: 600; }
.card__fee-danger { color: #991B1B; font-weight: 600; }
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
.field__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; }
.field input, .field select, .field textarea { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; resize: vertical; }
.field input:focus, .field select:focus, .field textarea:focus { outline: none; border-color: var(--color-ink); }

.field--switch { flex-direction: row; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid var(--color-hairline); border-bottom: 1px solid var(--color-hairline); }
.field__switch-copy { display: flex; flex-direction: column; gap: 4px; }
.edit-switch { width: 40px; height: 24px; padding: 3px; border-radius: 999px; background: var(--color-hairline); border: 0; display: flex; cursor: pointer; flex-shrink: 0; }
.edit-switch.is-on { background: var(--color-ink); }
.edit-switch__knob { width: 18px; height: 18px; border-radius: 999px; background: #fff; transition: transform 0.15s ease; }
.edit-switch.is-on .edit-switch__knob { transform: translateX(16px); }

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

/* Type picker (brief 56): segmented control at top of Add Member modal.
 * Non-member types trim the form down to identity + role. */
.type-picker { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 4px; border-radius: 12px; background: var(--color-surface); margin-bottom: 4px; }
.type-picker__option { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 10px 12px; border: 0; border-radius: 9px; background: transparent; cursor: pointer; text-align: left; transition: background 0.1s ease; }
.type-picker__option:hover:not(.type-picker__option--active) { background: color-mix(in srgb, var(--color-hairline) 50%, transparent); }
.type-picker__option--active { background: var(--color-ink); }
.type-picker__option--active .type-picker__label { color: #fff; }
.type-picker__option--active .type-picker__hint { color: rgba(255, 255, 255, 0.72); }
.type-picker__label { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.type-picker__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); line-height: 1.4; }
.form__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); line-height: 1.5; margin: 0; padding: 10px 12px; background: var(--color-surface); border-radius: 8px; }

.season-picker { position: relative; display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 32px 0 14px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; cursor: pointer; }
.season-picker:hover { border-color: var(--color-mute); }
.season-picker:focus-within { border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.season-picker__label { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.season-picker__select { appearance: none; -webkit-appearance: none; border: 0; outline: 0; background: transparent; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-ink); padding: 0; cursor: pointer; }
.season-picker__chev { position: absolute; right: 12px; color: var(--color-fog); pointer-events: none; }
.stat-panel__label-season { font-family: var(--font-body); font-size: 10px; font-weight: 500; color: var(--color-fog); letter-spacing: 0.04em; text-transform: none; margin-left: 2px; }

.field__error { font-family: var(--font-body); font-size: 12px; color: var(--color-danger); margin-top: 4px; }
.form__error { padding: 10px 12px; background: #FEE2E2; color: #991B1B; border-radius: 10px; font-family: var(--font-body); font-size: 13px; margin-top: 4px; }

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
