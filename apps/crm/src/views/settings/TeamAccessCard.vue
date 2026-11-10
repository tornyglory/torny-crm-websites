<script setup lang="ts">
/**
 * Settings → Team access card. Owner + admin only (hard-coded per brief 94
 * — settings:manage_team isn't in the grantable permission allowlist).
 *
 * Reads current team from the roster endpoint (filtered to role != 'player')
 * and pending invites from the new VENUE-hosted invites endpoint. Provides
 * invite + edit-permissions drawers, revoke action for pending invites, and
 * an owner-only Promote-to-Admin affordance on member rows.
 *
 * Drawers reuse TeamPermissionEditor for the checkbox grid.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  ApiError,
  members as membersApi,
  invites as invitesApi,
  SECTIONS,
  SETTINGS_PERMISSIONS,
  permissionsToToggleState,
  toggleStateToPermissions,
  matchPreset,
  type ClubInvite,
  type CreateInviteErrorCode,
  type RosterMember,
  type SectionToggleMap,
  type SettingsSectionDef,
  type UpdateMemberErrorCode,
} from '@torny/api-client'
import CrmModal from '@/components/modals/CrmModal.vue'
import CrmSpinner from '@/components/CrmSpinner.vue'
import TornySelect from '@/components/TornySelect.vue'
import TeamPermissionEditor, { type EditorState } from '@/components/TeamPermissionEditor.vue'
import { useClubStore } from '@/stores/club'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { usePermissions } from '@/composables/usePermissions'

const clubStore = useClubStore()
const authStore = useAuthStore()
const toast = useToast()
const { plan, isOwner, canManageTeam } = usePermissions()

const loading = ref(false)
const teamMembers = ref<RosterMember[]>([])
const pendingInvites = ref<ClubInvite[]>([])
const loadError = ref<string | null>(null)

async function load() {
  const cid = clubStore.current?.id
  if (cid == null) return
  loading.value = true
  loadError.value = null
  try {
    const [roster, inviteList] = await Promise.all([
      membersApi.listRoster(cid, { limit: 200, include_invites: false }),
      invitesApi.listInvites(cid),
    ])
    // Hide revoked rows — the roster endpoint returns lapsed memberships
    // too, and a soft-removed team member keeps their non-player
    // `club_role` (member/admin) alongside a set `revoked_at` until the
    // row is cleaned up. Without this filter they'd still appear in the
    // team list after being removed.
    teamMembers.value = roster.members
      .filter((m) => m.club_role !== 'player' && m.revoked_at == null)
      .sort((a, b) => roleRank(a.club_role) - roleRank(b.club_role))
    pendingInvites.value = inviteList
      .filter((i) => i.status === 'pending')
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.message : 'Could not load the team.'
  } finally {
    loading.value = false
  }
}

function roleRank(role: string): number {
  if (role === 'owner') return 0
  if (role === 'admin') return 1
  return 2
}

onMounted(load)
watch(() => clubStore.current?.id, load)

// ── Permission summaries ─────────────────────────────────────────

/** Short badge label — the row's "Access" cell shows the summary instead,
 *  so the badge stays punchy ("Owner", "Admin", "Team member"). */
function roleLabel(role: string): string {
  if (role === 'owner') return 'Owner'
  if (role === 'admin') return 'Admin'
  return 'Team member'
}

function summariseSections(perms: readonly string[] | undefined): string {
  if (!perms || perms.includes('*')) return 'Full access'
  const sectionLabels: string[] = []
  for (const section of SECTIONS) {
    if (perms.includes(section.access) || perms.includes(section.edit)) {
      sectionLabels.push(section.label)
    }
  }
  const settingsCount = SETTINGS_PERMISSIONS.filter((s) => perms.includes(s.permission)).length
  if (!sectionLabels.length && !settingsCount) return 'Dashboard only'
  const head = sectionLabels.slice(0, 3).join(', ')
  const extra = sectionLabels.length - 3
  const extras: string[] = []
  if (extra > 0) extras.push(`+${extra}`)
  if (settingsCount > 0) extras.push(`${settingsCount} settings`)
  return extras.length ? `${head} · ${extras.join(' · ')}` : head
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase()
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'Never'
  const seconds = Math.max(1, Math.floor((Date.now() - then) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function expiresIn(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return 'Expired'
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
  return days === 1 ? 'Expires tomorrow' : `Expires in ${days} days`
}

// ── Invite drawer ────────────────────────────────────────────────

const inviteOpen = ref(false)
const inviteSubmitting = ref(false)
const inviteError = ref<string | null>(null)
const inviteForm = reactive({
  email: '',
  role: 'member' as 'admin' | 'member',
  message: '',
})
const inviteEditorState = ref<EditorState>(blankEditorState())

function blankEditorState(): EditorState {
  const sections = {} as SectionToggleMap
  for (const s of SECTIONS) {
    sections[s.key] = { access: false, edit: false, ...(s.key === 'members' ? { pii: false } : {}) }
  }
  const settings = {} as Record<SettingsSectionDef['key'], boolean>
  for (const s of SETTINGS_PERMISSIONS) settings[s.key] = false
  return { preset: 'custom', sections, settings }
}

function openInvite() {
  inviteForm.email = ''
  inviteForm.role = 'member'
  inviteForm.message = ''
  inviteEditorState.value = blankEditorState()
  inviteError.value = null
  inviteOpen.value = true
}

function closeInvite() {
  inviteOpen.value = false
}

const canSendInvite = computed(() => {
  if (!/.+@.+\..+/.test(inviteForm.email.trim())) return false
  if (inviteForm.role === 'admin' && !isOwner.value) return false
  return true
})

const roleOptions = computed<Array<{ value: 'admin' | 'member'; label: string; hint?: string }>>(() => {
  const opts: Array<{ value: 'admin' | 'member'; label: string; hint?: string }> = [
    { value: 'member', label: 'Team member', hint: 'Custom access per section.' },
  ]
  if (isOwner.value) {
    opts.push({ value: 'admin', label: 'Admin', hint: 'Full CRM access except billing and ownership.' })
  }
  return opts
})

/** Live count for the invite footer — "N permissions selected". Counts the
 *  final permissions[] the editor would send (excluding the always-granted
 *  `dashboard:view`), so the admin sees real-time feedback as they tick. */
const invitePermCount = computed(() => {
  const perms = toggleStateToPermissions(
    inviteEditorState.value.sections,
    inviteEditorState.value.settings,
  )
  return perms.filter((p) => p !== 'dashboard:view').length
})

async function sendInvite() {
  if (!canSendInvite.value || inviteSubmitting.value) return
  const cid = clubStore.current?.id
  if (cid == null) return
  inviteSubmitting.value = true
  inviteError.value = null
  try {
    const perms =
      inviteForm.role === 'admin'
        ? undefined
        : toggleStateToPermissions(inviteEditorState.value.sections, inviteEditorState.value.settings)
    const result = await invitesApi.createInvite(cid, {
      email: inviteForm.email.trim(),
      role: inviteForm.role,
      ...(perms ? { permissions: perms } : {}),
      ...(inviteForm.message.trim() ? { message: inviteForm.message.trim() } : {}),
    })
    // Brief 95-live — two success paths. Auto-promote branch doesn't mint
    // an invite token; the existing player row is upgraded in place and
    // becomes visible in the team members list on the next `load()`.
    if (result.promoted_existing_member) {
      toast.success(`${result.email} now has CRM access.`)
    } else {
      toast.success(`Invite sent to ${result.email}.`)
    }
    inviteOpen.value = false
    await load()
  } catch (err) {
    inviteError.value = inviteErrorMessage(err)
  } finally {
    inviteSubmitting.value = false
  }
}

function inviteErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return (err as Error).message
  // Brief 95-live — canonical code is `already_team_member`; backend still
  // returns `legacy_code: 'already_member'` for one release while callers
  // migrate. Accept either for the "has CRM access" case.
  const code = err.code as CreateInviteErrorCode | undefined
  const legacy = (err.body?.legacy_code ?? undefined) as string | undefined
  const existingRole = (err.body?.role ?? undefined) as string | undefined
  if (code === 'already_team_member' || code === 'already_member' || legacy === 'already_member') {
    const who = inviteForm.email.trim()
    if (existingRole === 'owner') return `${who} is the club owner — they already have full access.`
    if (existingRole === 'admin') return `${who} is already an admin.`
    return `${who} already has CRM access.`
  }
  switch (code) {
    case 'invalid_email': return "That email isn't valid."
    case 'bad_role': return 'Role must be Admin or Team member.'
    case 'bad_permissions': return 'Pick at least one section before sending.'
    case 'forbidden': return "You can't invite someone at this role — only the owner can invite admins."
    case 'invite_pending_exists': return 'An invite is already pending for that email. Revoke it before sending a new one.'
    case 'invalid_permission': return 'One of the permissions is invalid — refresh and try again.'
    case 'permission_not_grantable': return 'Billing / Danger / Team access can\'t be granted here — they\'re owner-only.'
    case 'permission_requires_plan': return 'This club is on Starter — upgrade to Pro to grant that section.'
    default: return err.message
  }
}

// ── Confirm modal ────────────────────────────────────────────────
// Lightweight on-brand replacement for window.confirm() — the native
// dialog ignored our tokens and looked tacked on. Promise-based so
// existing call sites keep their `if (!await askConfirm(...)) return`
// control flow.

type ConfirmVariant = 'primary' | 'danger'
const confirmState = reactive({
  open: false,
  eyebrow: 'Team access',
  title: '',
  message: '',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  variant: 'primary' as ConfirmVariant,
})
let confirmResolve: ((value: boolean) => void) | null = null

function askConfirm(opts: {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: ConfirmVariant
  eyebrow?: string
}): Promise<boolean> {
  confirmState.open = true
  confirmState.eyebrow = opts.eyebrow ?? 'Team access'
  confirmState.title = opts.title
  confirmState.message = opts.message
  confirmState.confirmLabel = opts.confirmLabel ?? 'Confirm'
  confirmState.cancelLabel = opts.cancelLabel ?? 'Cancel'
  confirmState.variant = opts.variant ?? 'primary'
  return new Promise<boolean>((resolve) => {
    confirmResolve = resolve
  })
}

function resolveConfirm(ok: boolean) {
  confirmState.open = false
  const r = confirmResolve
  confirmResolve = null
  r?.(ok)
}

// ── Revoke invite ────────────────────────────────────────────────

const revokingId = ref<number | null>(null)
async function revoke(invite: ClubInvite) {
  const cid = clubStore.current?.id
  if (cid == null) return
  const ok = await askConfirm({
    title: 'Revoke this invite?',
    message: `${invite.email} will lose the pending invite link. You can send a new one anytime.`,
    confirmLabel: 'Revoke invite',
    variant: 'danger',
  })
  if (!ok) return
  revokingId.value = invite.id
  try {
    await invitesApi.revokeInvite(cid, invite.id)
    toast.info(`Invite to ${invite.email} revoked.`)
    await load()
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not revoke the invite.')
  } finally {
    revokingId.value = null
  }
}

// ── Edit permissions drawer ──────────────────────────────────────

const editOpen = ref(false)
const editSubmitting = ref(false)
const editError = ref<string | null>(null)
const editingMember = ref<RosterMember | null>(null)
const editorState = ref<EditorState>(blankEditorState())
const editExpectedUpdatedAt = ref<string | null>(null)

function openEdit(member: RosterMember) {
  editingMember.value = member
  const current = findMembershipPermissions(member.user_id) ?? []
  const state = permissionsToToggleState(current)
  editorState.value = {
    preset: matchPreset(current),
    sections: state.sections,
    settings: state.settings,
  }
  // Roster's `updated_at` isn't currently surfaced on RosterMember; the member
  // detail endpoint carries it. Skipping the concurrency guard for v1 — the
  // backend accepts the field being omitted as "last write wins."
  editExpectedUpdatedAt.value = null
  editError.value = null
  editOpen.value = true
}

function findMembershipPermissions(userId: number): string[] | undefined {
  // When editing *yourself*, use the live auth-store bundle; it's always up
  // to date vs. the roster list which doesn't currently echo permissions back.
  if (authStore.user?.id === userId) {
    const activeClubId = clubStore.current?.id
    return authStore.user.clubs.find((c) => c.id === activeClubId)?.permissions
  }
  // Other members — the roster endpoint doesn't carry the bundle today, so
  // we start the editor with "nothing ticked" and let the admin rebuild.
  // When the roster endpoint learns to return permissions, drop this branch.
  return undefined
}

function closeEdit() {
  editOpen.value = false
}

async function saveEdit() {
  if (!editingMember.value || editSubmitting.value) return
  const cid = clubStore.current?.id
  if (cid == null) return
  const userId = editingMember.value.user_id
  editSubmitting.value = true
  editError.value = null
  try {
    const perms = toggleStateToPermissions(editorState.value.sections, editorState.value.settings)
    await membersApi.patchMember(cid, userId, {
      permissions: perms,
      ...(editExpectedUpdatedAt.value ? { expected_updated_at: editExpectedUpdatedAt.value } : {}),
    })
    toast.success(`${editingMember.value.name}'s access updated.`)
    editOpen.value = false
    await load()
  } catch (err) {
    editError.value = editErrorMessage(err)
    if (err instanceof ApiError && err.code === 'stale_state') {
      const current = (err.body?.current_updated_at as string | undefined) ?? null
      editExpectedUpdatedAt.value = current
    }
  } finally {
    editSubmitting.value = false
  }
}

function editErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return (err as Error).message
  const code = err.code as UpdateMemberErrorCode | undefined
  switch (code) {
    case 'owner_immutable': return "The owner's access can't be changed from here — use ownership transfer."
    case 'stale_state': return 'This member was updated by someone else — reload and retry.'
    case 'permissions_only_on_member': return 'This member has an owner / admin / player role — change role first.'
    case 'invalid_permission': return 'One of the permissions is invalid — refresh and try again.'
    case 'permission_not_grantable': return 'Billing / Danger / Team access can\'t be granted here.'
    case 'permission_requires_plan': return 'This club is on Starter — the Pro-only sections can\'t be granted.'
    case 'forbidden_permission': return "You don't have permission to change this member's access."
    default: return err.message
  }
}

// ── Promote to admin (owner only) ───────────────────────────────

async function promoteToAdmin(member: RosterMember) {
  if (!isOwner.value) return
  const cid = clubStore.current?.id
  if (cid == null) return
  const ok = await askConfirm({
    title: `Promote ${member.name} to Admin?`,
    message: `They'll gain full CRM access — everything except billing, the danger zone, and inviting other admins.`,
    confirmLabel: 'Promote to admin',
    variant: 'primary',
  })
  if (!ok) return
  try {
    await membersApi.patchMember(cid, member.user_id, { role: 'admin' })
    toast.success(`${member.name} is now an Admin.`)
    await load()
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not promote.')
  }
}

// ── Remove member (admin+) ──────────────────────────────────────

async function removeMember(member: RosterMember) {
  if (member.club_role === 'owner') {
    toast.info('The owner can\'t be removed — transfer ownership first.')
    return
  }
  if (!canManageTeam.value) return
  const cid = clubStore.current?.id
  if (cid == null) return
  const ok = await askConfirm({
    title: `Remove ${member.name} from the team?`,
    message: `They'll lose CRM access immediately. Their player record stays — you can invite them again later.`,
    confirmLabel: 'Remove from team',
    variant: 'danger',
  })
  if (!ok) return
  try {
    await membersApi.remove(cid, member.user_id)
    toast.info(`${member.name} removed from the team.`)
    await load()
  } catch (err) {
    // `already_revoked` → the row is already soft-removed server-side,
    // so our refresh (combined with the revoked_at filter above) will
    // drop them. Idempotent-success from the user's point of view.
    if (err instanceof ApiError && err.code === 'already_revoked') {
      toast.info(`${member.name} was already removed.`)
      await load()
      return
    }
    toast.error(err instanceof ApiError ? err.message : 'Could not remove.')
  }
}

function canEditRow(member: RosterMember): boolean {
  if (member.club_role === 'owner') return false
  if (member.club_role === 'admin') return isOwner.value
  return canManageTeam.value
}
</script>

<template>
  <div class="ta">
    <!-- Page header matching the v2 Settings pattern: eyebrow, large display
         title, one-line explainer, primary action top-right. -->
    <header class="ta__head">
      <div>
        <div class="ta__eyebrow">CRM access · {{ teamMembers.length }} {{ teamMembers.length === 1 ? 'person' : 'people' }}</div>
        <h2 class="ta__title">Team members</h2>
        <p class="ta__sub">Invite people, pick what they can do, revoke access anytime. Only the owner and admins can change team membership.</p>
      </div>
      <button v-if="canManageTeam" class="ta__cta" @click="openInvite">
        <span class="ta__cta-plus" aria-hidden="true">+</span>
        Invite member
      </button>
    </header>

    <div v-if="loading" class="ta__state">
      <CrmSpinner size="sm" label="Loading team" />
      <span>Loading team…</span>
    </div>

    <div v-else-if="loadError" class="ta__state ta__state--error">{{ loadError }}</div>

    <template v-else>
      <!-- Section 01 — Team members. Numbered to match the v2 Settings
           pattern (see "Membership & fees"). -->
      <section class="ta__section">
        <div class="ta__section-head">
          <div class="ta__section-title">
            <span class="ta__section-no">01</span>
            <span class="ta__section-label">Team members</span>
          </div>
          <span class="ta__section-meta">{{ teamMembers.length }} with CRM access</span>
        </div>

        <div class="ta__table" role="table">
          <div class="ta__thead" role="row">
            <span role="columnheader">Person</span>
            <span role="columnheader">Role</span>
            <span role="columnheader">Access</span>
            <span role="columnheader">Last active</span>
            <span role="columnheader" class="ta__col-actions">Manage</span>
          </div>

          <div
            v-for="m in teamMembers"
            :key="m.user_id"
            class="ta__row"
            :class="{ 'ta__row--owner': m.club_role === 'owner' }"
            role="row"
          >
            <span class="ta__person" role="cell">
              <span class="ta__avatar" :class="`ta__avatar--${m.club_role}`">{{ initials(m.name) }}</span>
              <span class="ta__person-text">
                <span class="ta__person-name">{{ m.name }}</span>
                <span class="ta__person-email">{{ m.email ?? 'Email hidden' }}</span>
              </span>
            </span>

            <span class="ta__role" role="cell">
              <span class="ta__badge" :class="`ta__badge--${m.club_role}`">{{ roleLabel(m.club_role) }}</span>
            </span>

            <span class="ta__access" role="cell">
              {{ m.club_role === 'owner' || m.club_role === 'admin' ? 'Full access' : summariseSections(undefined) }}
            </span>

            <span class="ta__last" role="cell">{{ relativeTime(m.last_active_at) }}</span>

            <span class="ta__actions" role="cell">
              <button
                v-if="canEditRow(m)"
                class="ta__icon-btn"
                type="button"
                :title="`Edit ${m.name}'s access`"
                :aria-label="`Edit ${m.name}'s access`"
                @click="openEdit(m)"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M11 2L14 5L5.5 13.5L2 14L2.5 10.5L11 2Z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <button
                v-if="isOwner && m.club_role === 'member'"
                class="ta__icon-btn"
                type="button"
                :title="`Promote ${m.name} to admin`"
                :aria-label="`Promote ${m.name} to admin`"
                @click="promoteToAdmin(m)"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/>
                  <path d="M5.5 7.5L8 5L10.5 7.5M8 5V11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <button
                v-if="canEditRow(m)"
                class="ta__icon-btn ta__icon-btn--danger"
                type="button"
                :title="`Remove ${m.name} from the team`"
                :aria-label="`Remove ${m.name} from the team`"
                @click="removeMember(m)"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M3 4h10M6.5 4V2.75a1 1 0 011-1h1a1 1 0 011 1V4M4.5 4l.667 9a1 1 0 001 .917h3.666a1 1 0 001-.917L11.5 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <span v-if="!canEditRow(m)" class="ta__none">—</span>
            </span>
          </div>
        </div>
      </section>

      <!-- Section 02 — Pending invites. Hidden entirely when empty so the
           page doesn't carry a visible "0 pending" scaffold. -->
      <section v-if="pendingInvites.length" class="ta__section ta__section--invites">
        <div class="ta__section-head">
          <div class="ta__section-title">
            <span class="ta__section-no">02</span>
            <span class="ta__section-label">Pending invites</span>
          </div>
          <span class="ta__section-meta">{{ pendingInvites.length }} awaiting acceptance</span>
        </div>

        <div class="ta__table ta__table--muted" role="table">
          <div class="ta__thead" role="row">
            <span role="columnheader">Email</span>
            <span role="columnheader">Role</span>
            <span role="columnheader">Access</span>
            <span role="columnheader">Expires</span>
            <span role="columnheader" class="ta__col-actions">Manage</span>
          </div>

          <div v-for="inv in pendingInvites" :key="inv.id" class="ta__row ta__row--invite" role="row">
            <span class="ta__person" role="cell">
              <span class="ta__avatar ta__avatar--pending">{{ initials(inv.email) }}</span>
              <span class="ta__person-text">
                <span class="ta__person-name">{{ inv.email }}</span>
                <span class="ta__person-email">
                  Invited {{ relativeTime(inv.created_at) }}<template v-if="inv.invited_by"> · {{ inv.invited_by.name }}</template>
                </span>
              </span>
            </span>

            <span class="ta__role" role="cell">
              <span class="ta__badge" :class="`ta__badge--${inv.role}`">{{ inv.role === 'admin' ? 'Admin' : 'Team member' }}</span>
            </span>

            <span class="ta__access" role="cell">{{ inv.role === 'admin' ? 'Full access' : summariseSections(inv.permissions) }}</span>

            <span class="ta__last" role="cell">{{ expiresIn(inv.expires_at) }}</span>

            <span class="ta__actions" role="cell">
              <button
                class="ta__icon-btn ta__icon-btn--danger"
                type="button"
                :title="`Revoke invite to ${inv.email}`"
                :aria-label="`Revoke invite to ${inv.email}`"
                :disabled="revokingId === inv.id"
                @click="revoke(inv)"
              >
                <svg v-if="revokingId !== inv.id" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
                <span v-else class="ta__icon-btn-spin" aria-hidden="true" />
              </button>
            </span>
          </div>
        </div>
      </section>
    </template>
  </div>

  <!-- Invite modal -->
  <CrmModal :open="inviteOpen" eyebrow="Team access" title="Invite a team member" width="xl" @close="closeInvite">
    <form class="iv" @submit.prevent="sendInvite">
      <!-- Who: identity + role ─────────────────────────────── -->
      <div class="iv__row">
        <label class="iv__field">
          <span class="iv__label">Email address</span>
          <input
            v-model="inviteForm.email"
            type="email"
            class="iv__input"
            placeholder="teammate@club.co.nz"
            autofocus
          />
        </label>
        <div class="iv__field">
          <span class="iv__label">Role</span>
          <TornySelect
            v-model="inviteForm.role"
            :options="roleOptions"
          />
        </div>
      </div>

      <!-- What they can do: picker lives inside the editor component. -->
      <section class="iv__section">
        <header class="iv__section-head">
          <span class="iv__section-no">01</span>
          <span class="iv__section-title">What they can access</span>
        </header>
        <TeamPermissionEditor v-model="inviteEditorState" :plan="plan" :role="inviteForm.role" />
      </section>

      <!-- Personal message: optional, intentionally muted. -->
      <section class="iv__section iv__section--muted">
        <header class="iv__section-head">
          <span class="iv__section-no">02</span>
          <span class="iv__section-title">Personal message <span class="iv__optional">optional</span></span>
        </header>
        <label class="iv__field">
          <textarea
            v-model="inviteForm.message"
            rows="3"
            class="iv__input"
            placeholder="Kia ora — you'll have CRM access for membership and comms. Let me know if anything's missing."
          />
        </label>
      </section>

      <div v-if="inviteError" class="iv__error">{{ inviteError }}</div>
    </form>

    <template #footer>
      <div class="iv__foot">
        <div class="iv__foot-summary">
          <template v-if="inviteForm.role === 'admin'">
            <strong>Full admin access</strong>
            <span>· everything except billing and ownership</span>
          </template>
          <template v-else>
            <strong>{{ invitePermCount }}</strong>
            <span>{{ invitePermCount === 1 ? 'permission' : 'permissions' }} selected</span>
          </template>
        </div>
        <div class="iv__foot-actions">
          <button type="button" class="iv__btn iv__btn--outline" @click="closeInvite">Cancel</button>
          <button
            type="button"
            class="iv__btn iv__btn--primary"
            :disabled="!canSendInvite || inviteSubmitting"
            @click="sendInvite"
          >{{ inviteSubmitting ? 'Sending…' : 'Send invite' }}</button>
        </div>
      </div>
    </template>
  </CrmModal>

  <!-- Edit permissions drawer -->
  <CrmModal
    :open="editOpen"
    eyebrow="Team access"
    :title="editingMember ? `Edit ${editingMember.name}'s access` : 'Edit access'"
    width="xl"
    @close="closeEdit"
  >
    <template v-if="editingMember">
      <div v-if="editingMember.club_role === 'admin'" class="editor__admin-note">
        This person is an Admin — they already have the full CRM bundle. To
        restrict their access, demote them to Team member first (via the role
        change on the member detail page).
      </div>
      <TeamPermissionEditor
        v-else
        v-model="editorState"
        :plan="plan"
        role="member"
      />
      <div v-if="editError" class="form__error">{{ editError }}</div>
    </template>
    <template #footer>
      <button type="button" class="iv__btn iv__btn--outline" @click="closeEdit">Cancel</button>
      <button
        type="button"
        class="iv__btn iv__btn--primary"
        :disabled="editSubmitting || editingMember?.club_role === 'admin'"
        @click="saveEdit"
      >{{ editSubmitting ? 'Saving…' : 'Save' }}</button>
    </template>
  </CrmModal>

  <!-- Confirm modal — on-brand replacement for window.confirm. Used
       for revoke-invite, promote-to-admin, and remove-member. -->
  <CrmModal
    :open="confirmState.open"
    :eyebrow="confirmState.eyebrow"
    :title="confirmState.title"
    width="sm"
    @close="resolveConfirm(false)"
  >
    <p class="confirm__message">{{ confirmState.message }}</p>
    <template #footer>
      <button type="button" class="confirm__btn confirm__btn--outline" @click="resolveConfirm(false)">
        {{ confirmState.cancelLabel }}
      </button>
      <button
        type="button"
        class="confirm__btn"
        :class="confirmState.variant === 'danger' ? 'confirm__btn--danger' : 'confirm__btn--primary'"
        @click="resolveConfirm(true)"
      >{{ confirmState.confirmLabel }}</button>
    </template>
  </CrmModal>
</template>

<style scoped>
/* ── Container ─────────────────────────────────────────────── */
/* `min-width: 0` so the card respects its CSS-grid parent width instead of
   growing to min-content (which was pushing the table + CTA off-screen when
   the Settings pane was ≤1000px). */
.ta { display: flex; flex-direction: column; gap: 32px; min-width: 0; }

/* ── Header ────────────────────────────────────────────────── */
.ta__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--color-hairline);
  /* So the title block shrinks before the CTA does (CTA has flex-shrink: 0). */
  min-width: 0;
}
.ta__head > div:first-child { min-width: 0; }
.ta__eyebrow {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.ta__title {
  margin: 8px 0 6px;
  font-family: var(--font-display);
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
  color: var(--color-ink);
}
.ta__sub {
  margin: 0;
  max-width: 560px;
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.55;
  color: var(--color-fog);
}

/* Primary CTA — ink pill, visually distinct so it stops reading as a
   secondary outline button. */
.ta__cta {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 11px 20px 11px 16px;
  border: 0;
  border-radius: 999px;
  background: var(--color-ink);
  color: #fff;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 120ms ease, transform 120ms ease;
}
.ta__cta:hover { background: var(--color-graphite); transform: translateY(-1px); }
.ta__cta-plus { font-size: 15px; font-weight: 400; line-height: 1; }

/* ── Loading / error ──────────────────────────────────────── */
.ta__state {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 24px 0;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-fog);
}
.ta__state--error { color: var(--color-danger); }

/* ── Numbered section ─────────────────────────────────────── */
.ta__section { display: flex; flex-direction: column; gap: 16px; }
.ta__section-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 24px;
}
.ta__section-title { display: inline-flex; align-items: baseline; gap: 10px; }
.ta__section-no {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-mute);
  font-weight: 500;
}
.ta__section-label {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--color-ink);
}
.ta__section-meta {
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
}

/* ── Table ────────────────────────────────────────────────── */
.ta__table {
  border: 1px solid var(--color-hairline);
  border-radius: 14px;
  background: #fff;
  overflow: hidden;
}
.ta__table--muted { background: var(--color-surface, #FAFAF7); }

/* Shared grid template — both thead and rows use the same deterministic
   column widths so they align column-by-column. `auto` was the trap: each
   sibling grid resolved it to whatever its own cell content needed, which
   was different for the header ("MANAGE") vs the row (3 icon buttons). */
.ta__thead,
.ta__row {
  display: grid;
  grid-template-columns: minmax(0, 2.2fr) 110px minmax(0, 1.6fr) 100px 108px;
  gap: 16px;
  align-items: center;
  padding-left: 20px;
  padding-right: 20px;
}

.ta__thead {
  padding-top: 12px;
  padding-bottom: 12px;
  background: color-mix(in srgb, var(--color-hairline) 40%, transparent);
  border-bottom: 1px solid var(--color-hairline);
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.ta__col-actions { text-align: right; }

.ta__row {
  position: relative;
  padding-top: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--color-hairline);
  transition: background 120ms ease;
}
.ta__row:last-child { border-bottom: 0; }
.ta__row:hover { background: color-mix(in srgb, var(--color-hairline) 24%, transparent); }
.ta__row--invite { opacity: 0.88; }

/* Ochre edge on the owner row — anchors who owns the club without
   needing extra chrome. */
.ta__row--owner::before {
  content: "";
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: var(--color-accent, #EA580C);
}

/* ── Person cell ──────────────────────────────────────────── */
.ta__person {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.ta__avatar {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  flex-shrink: 0;
  background: var(--color-accent-soft);
  color: var(--color-accent-strong);
}
.ta__avatar--owner { background: #FFF1E7; color: #C2410C; }
.ta__avatar--admin { background: #DCFCE7; color: #166534; }
.ta__avatar--member { background: #EDE9FE; color: #5B21B6; }
.ta__avatar--pending {
  background: transparent;
  color: var(--color-fog);
  border: 1px dashed var(--color-hairline);
}
.ta__person-text { display: flex; flex-direction: column; min-width: 0; }
.ta__person-name {
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 600;
  color: var(--color-ink);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ta__person-email {
  margin-top: 2px;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Badge ────────────────────────────────────────────────── */
.ta__badge {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.ta__badge--owner { background: #FFF1E7; color: #C2410C; }
.ta__badge--admin { background: #DCFCE7; color: #166534; }
.ta__badge--member { background: #EDE9FE; color: #5B21B6; }

/* ── Access / last-active cells ───────────────────────────── */
.ta__access {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ta__last {
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
  white-space: nowrap;
}

/* ── Action lane ──────────────────────────────────────────── */
.ta__actions {
  display: inline-flex;
  justify-content: flex-end;
  gap: 4px;
}
.ta__none { color: var(--color-mute); font-size: 13px; }
/* Icon-only action button — compact 30px square, hover tints the ground
   with the button's ink/danger colour. Title + aria-label provide the
   accessible name since the visible label is removed. */
.ta__icon-btn {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: none;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--color-fog);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.ta__icon-btn:hover {
  background: color-mix(in srgb, var(--color-ink) 7%, transparent);
  color: var(--color-ink);
  border-color: var(--color-hairline);
}
.ta__icon-btn--danger {
  color: color-mix(in srgb, var(--color-danger) 70%, var(--color-fog));
}
.ta__icon-btn--danger:hover {
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  color: var(--color-danger);
  border-color: color-mix(in srgb, var(--color-danger) 30%, transparent);
}
.ta__icon-btn:disabled { opacity: 0.5; cursor: not-allowed; background: transparent; border-color: transparent; }

/* Tiny inline spinner for the Revoke "working…" state. Replaces the X
   icon in place so the button doesn't resize. */
.ta__icon-btn-spin {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 1.5px solid color-mix(in srgb, currentColor 30%, transparent);
  border-top-color: currentColor;
  animation: ta-spin 700ms linear infinite;
}
@keyframes ta-spin {
  to { transform: rotate(360deg); }
}

/* ── Invite modal ─────────────────────────────────────────── */
.iv { display: flex; flex-direction: column; gap: 32px; }

/* Who row — email + role, stacked labels for consistency with the
   project-wide .field pattern. */
.iv__row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
.iv__field { display: flex; flex-direction: column; gap: 6px; }
.iv__label {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.iv__input {
  padding: 11px 13px;
  border: 1px solid var(--color-hairline);
  border-radius: 10px;
  background: #fff;
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--color-ink);
  resize: vertical;
}
.iv__input:focus { outline: none; border-color: var(--color-ink); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-ink) 8%, transparent); }

/* Numbered section — matches the Team access page grammar so the modal
   feels like a focused extension of the parent screen. */
.iv__section { display: flex; flex-direction: column; gap: 14px; }
.iv__section--muted { opacity: 0.92; }
.iv__section-head { display: inline-flex; align-items: baseline; gap: 10px; }
.iv__section-no {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-mute);
  font-weight: 500;
}
.iv__section-title {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--color-ink);
}
.iv__optional {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-fog);
  margin-left: 4px;
}

.iv__error {
  color: var(--color-danger);
  font-family: var(--font-body);
  font-size: 13px;
  padding: 10px 14px;
  background: color-mix(in srgb, var(--color-danger) 8%, transparent);
  border-radius: 10px;
}

/* Footer: left-aligned live summary, right-aligned CTA pair matching the
   Team access page's ink pill treatment. */
.iv__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  width: 100%;
}
.iv__foot-summary {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-fog);
  display: inline-flex;
  gap: 6px;
}
.iv__foot-summary strong { color: var(--color-ink); font-weight: 600; }
.iv__foot-actions { display: inline-flex; gap: 10px; }
.iv__btn {
  padding: 11px 20px;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 0;
  transition: background 120ms ease, transform 120ms ease, border-color 120ms ease;
}
.iv__btn--outline {
  background: transparent;
  color: var(--color-ink);
  border: 1px solid var(--color-hairline);
}
.iv__btn--outline:hover { border-color: var(--color-ink); }
.iv__btn--primary {
  background: var(--color-ink);
  color: #fff;
}
.iv__btn--primary:hover:not(:disabled) { background: var(--color-graphite); transform: translateY(-1px); }
.iv__btn--primary:disabled { opacity: 0.45; cursor: not-allowed; }

/* ── Confirm modal ────────────────────────────────────────── */
.confirm__message {
  margin: 0;
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.55;
  color: var(--color-ink);
}
.confirm__btn {
  padding: 10px 18px;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 0;
  transition: background 120ms ease, transform 120ms ease, border-color 120ms ease;
}
.confirm__btn--outline {
  background: transparent;
  color: var(--color-ink);
  border: 1px solid var(--color-hairline);
}
.confirm__btn--outline:hover { border-color: var(--color-ink); }
.confirm__btn--primary {
  background: var(--color-ink);
  color: #fff;
}
.confirm__btn--primary:hover { background: var(--color-graphite); transform: translateY(-1px); }
.confirm__btn--danger {
  background: var(--color-danger);
  color: #fff;
}
.confirm__btn--danger:hover { background: color-mix(in srgb, var(--color-danger) 85%, #000); transform: translateY(-1px); }

.editor__admin-note {
  background: var(--color-accent-soft);
  color: var(--color-ink);
  padding: 16px 18px;
  border-radius: 12px;
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.55;
}

@media (max-width: 760px) {
  .iv__row { grid-template-columns: 1fr; }
  .iv__foot { flex-direction: column; align-items: stretch; gap: 14px; }
  .iv__foot-actions { justify-content: flex-end; }
}

/* ── Responsive ────────────────────────────────────────────── */
@media (max-width: 1100px) {
  /* Drop the "Last active" column first — nice-to-have but not essential.
     Four columns, all deterministic widths so the header + rows still align. */
  .ta__thead,
  .ta__row {
    grid-template-columns: minmax(0, 2.4fr) 100px minmax(0, 1.6fr) 108px;
    gap: 12px;
    padding-left: 16px;
    padding-right: 16px;
  }
  .ta__thead > :nth-child(4),
  .ta__row > .ta__last { display: none; }
}
@media (max-width: 760px) {
  .ta__head { flex-direction: column; align-items: stretch; }
  .ta__table { border: 0; background: transparent; }
  .ta__thead { display: none; }
  .ta__row {
    display: grid;
    grid-template-columns: 1fr auto;
    row-gap: 10px;
    padding: 18px 16px;
    border: 1px solid var(--color-hairline);
    border-radius: 12px;
    background: #fff;
    margin-bottom: 10px;
  }
  .ta__row:last-child { border-bottom: 1px solid var(--color-hairline); }
  .ta__person { grid-column: 1 / -1; }
  .ta__role { grid-column: 1 / -1; }
  .ta__access, .ta__last { grid-column: 1 / -1; }
  .ta__actions { grid-column: 1 / -1; justify-content: flex-start; flex-wrap: wrap; }
}
</style>
