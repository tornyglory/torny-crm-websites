// Auth endpoints — shared by CRM and mobile. See docs/backend-briefs/03-frontend-auth-m1.md.
//
// Uses plain fetch rather than the shared TornyClient because login/register run
// before we have an auth token. Once signed in, other resources use useApi() /
// createTornyClient() which attaches the token from the auth store.

export type Role = 'platform' | 'owner' | 'admin' | 'committee' | 'player'

export interface UserClub {
  /** Integer club id (per brief 08 §Timezones + IDs). */
  id: number
  /** Enriched club name (from /me + /login responses). */
  name?: string
  role: Exclude<Role, 'platform' | 'player'>
  /** Optional freeform title (e.g. "Secretary"). */
  title?: string | null
}

export interface AuthUser {
  id: number
  email: string
  name: string | null
  user_type: string | null
  role: Role
  clubs: UserClub[]
  is_platform_admin: boolean
  avatar_url: string | null
  profile_completed: number | null
  created: string | null
  updated: string | null
}

export interface LoginResponse {
  token: string
  user: AuthUser
}

interface AuthErrorBody {
  status?: string
  message?: string
  code?: string
}

export class AuthError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'AuthError'
    this.status = status
    this.code = code
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new AuthError(res.status, `Unexpected response (${res.status})`)
  }
}

async function throwOnError(res: Response): Promise<AuthErrorBody> {
  const body = await readJson<AuthErrorBody>(res)
  const message = body.message ?? `Request failed (${res.status})`
  throw new AuthError(res.status, message, body.code)
}

export async function login(
  email: string,
  password: string,
  opts: { baseURL: string; signal?: AbortSignal },
): Promise<LoginResponse> {
  const res = await fetch(`${opts.baseURL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: opts.signal,
  })
  const json = await readJson<AuthErrorBody & { token?: string; user?: AuthUser }>(res)
  if (!res.ok || json.status !== 'success' || !json.token || !json.user) {
    throw new AuthError(res.status, json.message ?? 'Invalid credentials', json.code)
  }
  return { token: json.token, user: json.user }
}

export interface RegisterInput {
  firstName: string
  lastName: string
  email: string
  password: string
}

export async function register(
  input: RegisterInput,
  opts: { baseURL: string; signal?: AbortSignal },
): Promise<{ userId?: number }> {
  const res = await fetch(`${opts.baseURL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: opts.signal,
  })
  const json = await readJson<AuthErrorBody & { userId?: number }>(res)
  if (!res.ok || json.status === 'error') {
    // 409 = duplicate email today; M2 will make this a generic 201. Treat the
    // same as success from the UI's perspective (see brief 08 §What's still
    // coming) so the M2 move requires no client change.
    if (res.status === 409) return {}
    throw new AuthError(res.status, json.message ?? 'Registration failed', json.code)
  }
  return { userId: json.userId }
}

export async function requestPasswordReset(
  email: string,
  opts: { baseURL: string; signal?: AbortSignal },
): Promise<void> {
  const res = await fetch(`${opts.baseURL}/request-password-reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
    signal: opts.signal,
  })
  if (!res.ok) await throwOnError(res)
}

export async function resetPassword(
  token: string,
  newPassword: string,
  opts: { baseURL: string; signal?: AbortSignal },
): Promise<void> {
  const res = await fetch(`${opts.baseURL}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, newPassword }),
    signal: opts.signal,
  })
  if (!res.ok) await throwOnError(res)
}

// ── Account self-service — backend brief 71 ───────────────────────
// Signed-in user editing their own account. All endpoints under /me on
// SAM_BASE. Until brief 71 ships these will 404 — callers catch and
// surface a "coming soon" message.

import { SAM_BASE } from '../config'
import { authedFetch } from '../http'

interface SuccessEnvelope<T> {
  status: 'success'
  data: T
}

export interface UpdateMeInput {
  /** Full display name. Trimmed, 1–120 chars. */
  name?: string
  /** Media host URL, or `null` to clear. */
  avatar_url?: string | null
}

/** PATCH /me — change name + avatar. */
export async function patchMe(
  input: UpdateMeInput,
  opts: { signal?: AbortSignal } = {},
): Promise<AuthUser> {
  const res = await authedFetch<SuccessEnvelope<{ user: AuthUser }>>(
    `${SAM_BASE}/me`,
    { method: 'PATCH', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data.user
}

export interface EmailChangeRequestResult {
  pending_email: string
  expires_at: string
  notice_sent_to_old: boolean
}

/** POST /me/email-change — kick off a double-opt-in email change. */
export async function requestEmailChange(
  newEmail: string,
  opts: { signal?: AbortSignal } = {},
): Promise<EmailChangeRequestResult> {
  const res = await authedFetch<SuccessEnvelope<EmailChangeRequestResult>>(
    `${SAM_BASE}/me/email-change`,
    { method: 'POST', body: JSON.stringify({ new_email: newEmail }), signal: opts.signal },
  )
  return res.data
}

/** POST /me/email-change/confirm — public, no auth. */
export async function confirmEmailChange(
  token: string,
  opts: { signal?: AbortSignal } = {},
): Promise<{ email: string; confirmed_at: string }> {
  const res = await fetch(`${SAM_BASE}/me/email-change/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
    signal: opts.signal,
  })
  const body = await readJson<AuthErrorBody & { data?: { email: string; confirmed_at: string } }>(res)
  if (!res.ok || body.status === 'error' || !body.data) {
    throw new AuthError(res.status, body.message ?? 'Confirmation failed', body.code)
  }
  return body.data
}

/** POST /me/email-change/cancel — abort pending change. */
export async function cancelEmailChange(
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  await authedFetch<SuccessEnvelope<{ cancelled: boolean }>>(
    `${SAM_BASE}/me/email-change/cancel`,
    { method: 'POST', signal: opts.signal },
  )
}

export interface PasswordChangeInput {
  current_password: string
  new_password: string
}

export interface PasswordChangeResult {
  changed_at: string
  other_sessions_revoked: number
}

/** POST /me/password-change — rotate password while signed in. */
export async function changePassword(
  input: PasswordChangeInput,
  opts: { signal?: AbortSignal } = {},
): Promise<PasswordChangeResult> {
  const res = await authedFetch<SuccessEnvelope<PasswordChangeResult>>(
    `${SAM_BASE}/me/password-change`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}
