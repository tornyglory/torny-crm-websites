// Team-access invites — brief 94 phase 3.
//
// Lives on VENUE_BASE (not CRM_BASE) — the CrmStack hit the CFN 500-resource
// cap so the invite router landed on the venue stack. Members, members
// PATCH, and roster are still on CRM; only these four invite routes are on
// VENUE.

import { VENUE_BASE } from '../config'
import { authedFetch, publicFetch } from '../http'

interface Envelope<T> { status: string; data: T }

// ── Types ────────────────────────────────────────────────────────

export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked'
export type InviteRole = 'admin' | 'member'

export interface InviteInvitedBy {
  id: number
  name: string
}

export interface ClubInvite {
  id: number
  email: string
  role: InviteRole
  status: InviteStatus
  /** Present on listed invites; the backend returns the live bundle it
   *  stored for the invitee. Admin invites get the standard admin bundle;
   *  members get what the admin picked at invite time. */
  permissions?: string[]
  invited_by?: InviteInvitedBy
  created_at: string
  expires_at: string
  accepted_at: string | null
}

// ── Create invite ────────────────────────────────────────────────

export interface CreateInviteInput {
  email: string
  role: InviteRole
  /** Required when `role === 'member'`; ignored by the backend when
   *  `role === 'admin'` (admin bundle is fixed). */
  permissions?: string[]
  message?: string
}

/** Narrow response — `POST /clubs/:cid/invites`. Brief 95-live branches on
 *  the invited email's current roster state, but both paths mint a magic-link
 *  invite now:
 *
 *  - Net-new email → fresh invite + email to `/accept-invite/{token}`.
 *    `promoted_existing_member: false`, `user_id` omitted.
 *
 *  - Existing player → row is auto-promoted in place (role=member, permissions
 *    written), AND an invite row is minted so the invitee can set a password
 *    on their stub account (admin-added roster rows start with
 *    `passwordHash = NULL`). `promoted_existing_member: true`, `user_id` is
 *    the promoted member's user id. The accept flow handles the password step.
 */
export interface CreateInviteResult {
  id: number
  email: string
  role: InviteRole
  expires_at: string
  email_sent: boolean
  /** Brief 95-live — always present on every 201. `true` when the backend
   *  upgraded an existing `role: 'player'` row in place rather than creating
   *  a brand-new invite. Drives FE toast copy + routing. */
  promoted_existing_member: boolean
  /** Brief 95-live — only present on the auto-promote branch. The promoted
   *  member's user id, so the FE can offer a "View member" affordance. */
  user_id?: number
}

export type CreateInviteErrorCode =
  | 'invalid_email'
  | 'bad_role'
  | 'bad_permissions'
  | 'forbidden'
  /** Brief 95-live — canonical replacement for `already_member`. The invitee
   *  is already on the roster as owner / admin / member with CRM access. */
  | 'already_team_member'
  /** Brief 95-live — transitional alias; still returned alongside
   *  `already_team_member` for one release. Prefer the canonical code. */
  | 'already_member'
  | 'invite_pending_exists'
  | 'invalid_permission'
  | 'permission_not_grantable'
  | 'permission_requires_plan'

export async function createInvite(
  clubId: number,
  input: CreateInviteInput,
  opts: { signal?: AbortSignal } = {},
): Promise<CreateInviteResult> {
  const res = await authedFetch<Envelope<{ invite: CreateInviteResult }>>(
    `${VENUE_BASE}/clubs/${clubId}/invites`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data.invite
}

// ── List + revoke ────────────────────────────────────────────────

export async function listInvites(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<ClubInvite[]> {
  const res = await authedFetch<Envelope<{ invites: ClubInvite[] }>>(
    `${VENUE_BASE}/clubs/${clubId}/invites`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data.invites
}

export type RevokeInviteErrorCode = 'invite_not_found' | 'invite_already_accepted'

export async function revokeInvite(
  clubId: number,
  inviteId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<ClubInvite> {
  const res = await authedFetch<Envelope<{ invite: ClubInvite }>>(
    `${VENUE_BASE}/clubs/${clubId}/invites/${inviteId}`,
    { method: 'DELETE', signal: opts.signal },
  )
  return res.data.invite
}

// ── Public accept ───────────────────────────────────────────────

/** Required only when the invited email doesn't yet have a Torny account —
 *  backend uses `new_account` on the response to tell the FE which path it
 *  took. Password must be ≥ 12 chars (same policy as /register). */
export interface AcceptInviteInput {
  name?: string
  password?: string
}

export interface AcceptInviteResult {
  user: {
    id: number
    name: string
    email: string
    /** `true` for brand-new accounts (email didn't exist in `users` before
     *  accept). `false` for everyone else — including auto-promoted stub
     *  users whose row already existed. */
    new_account: boolean
    /** Brief 95-live — `true` when this POST hashed + wrote a password to
     *  `users.passwordHash`. Fires for both new accounts and stub users
     *  (admin-added roster rows with NULL password). */
    password_was_set: boolean
  }
  club: {
    id: number
    name: string
    slug: string
  }
  auth_token: string
}

export type AcceptInviteErrorCode =
  | 'invite_not_found'
  | 'invite_expired'
  | 'invite_revoked'
  | 'invite_already_accepted'
  | 'already_member'
  | 'bad_name'
  | 'bad_password'

export async function acceptInvite(
  token: string,
  input: AcceptInviteInput = {},
  opts: { signal?: AbortSignal } = {},
): Promise<AcceptInviteResult> {
  const res = await publicFetch<Envelope<AcceptInviteResult>>(
    `${VENUE_BASE}/invites/${encodeURIComponent(token)}/accept`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}
