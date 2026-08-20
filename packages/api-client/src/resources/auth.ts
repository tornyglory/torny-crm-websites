// Auth endpoints — shared by CRM and mobile. See docs/backend-briefs/03-frontend-auth-m1.md.
//
// Uses plain fetch rather than the shared TornyClient because login/register run
// before we have an auth token. Once signed in, other resources use useApi() /
// createTornyClient() which attaches the token from the auth store.

export type Role = 'platform' | 'owner' | 'admin' | 'committee' | 'player'

export interface UserClub {
  id: string
  role: Exclude<Role, 'platform' | 'player'>
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
  // The endpoint on prod (as of 2026-08-20) also accepts a combined `name`
  // field alongside firstName/lastName — sending both maximises compatibility
  // while the backend team confirms the canonical shape. See brief 03 §2.
  const name = `${input.firstName.trim()} ${input.lastName.trim()}`.trim()
  const res = await fetch(`${opts.baseURL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, name, account_type: 'player' }),
    signal: opts.signal,
  })
  const json = await readJson<AuthErrorBody & { userId?: number }>(res)
  if (!res.ok || json.status === 'error') {
    // 409 = duplicate email today; M2 will make this a generic 201. Treat the
    // same as success from the UI's perspective (see brief 03 §Errors) so the
    // move to M2 doesn't require a client change.
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
