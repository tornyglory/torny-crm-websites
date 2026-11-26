// Shared http helper for the CRM's resource modules. Uses fetch (not the
// axios TornyClient) because it's simpler for the small, per-endpoint calls
// the CRM needs. Reads the bearer token from localStorage under `torny.token`.
//
// Every non-500 error carries a machine-readable `code` field per brief 08
// §Error shape — surfaced on ApiError so callers can switch on it.

export const TOKEN_STORAGE_KEY = 'torny.token'

export interface ApiErrorBody {
  status?: string
  code?: string
  message?: string
  [k: string]: unknown
}

export class ApiError extends Error {
  status: number
  code?: string
  body?: ApiErrorBody
  constructor(status: number, message: string, code?: string, body?: ApiErrorBody) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.body = body
  }
}

// ── Global ApiError observers ──────────────────────────────────────
// Lets the host app (CRM, club-sites) register a handler that fires
// on every ApiError throw — useful for cross-cutting concerns like
// the `account_suspended` modal (brief 123 Phase 2) which has to
// surface on any write anywhere in the CRM, not per-view.
//
// Observers DO NOT swallow the error — the throw still happens and
// caller-side catch handlers still run. Treat observers as a tee.
type ApiErrorObserver = (error: ApiError) => void
const apiErrorObservers = new Set<ApiErrorObserver>()

/** Register a handler called on every ApiError throw. Returns an
 *  unsubscribe function. Call at app boot; observers survive hot-reload
 *  only if the module is preserved (set is module-scoped). */
export function registerApiErrorObserver(fn: ApiErrorObserver): () => void {
  apiErrorObservers.add(fn)
  return () => { apiErrorObservers.delete(fn) }
}

function notifyApiErrorObservers(err: ApiError): void {
  // Isolate observer failures so one broken handler doesn't break
  // the others, and doesn't swallow the original throw.
  for (const obs of apiErrorObservers) {
    try { obs(err) } catch { /* intentionally quiet */ }
  }
}

function readToken(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(TOKEN_STORAGE_KEY)
}

// ── Short-lived token override (impersonation) ─────────────────────
// Set by the platform-admin impersonation flow (brief 123 §6.1). When
// non-null, authedFetch uses this JWT instead of the one in
// localStorage. Clearing it (setImpersonationToken(null)) restores the
// normal flow — the admin's cookie session is untouched throughout.
//
// Not persisted here — the CRM stashes it in sessionStorage separately
// so a refresh mid-session keeps the override; this module stays
// stateless to simplify testing.
let impersonationToken: string | null = null

/** Set / clear the temporary auth override. Pass null to restore the
 *  localStorage-backed session token. */
export function setImpersonationToken(token: string | null): void {
  impersonationToken = token
}

export interface AuthedFetchInit extends RequestInit {
  /** Optional override — otherwise reads from localStorage. */
  token?: string | null
  /** When true, skip the impersonation token override and read
   *  straight from localStorage. Admin endpoints must run as the
   *  platform admin, never as the impersonated user — otherwise a
   *  mid-impersonation admin action gets 403 not_platform_owner from
   *  its own Bearer JWT (the impersonation JWT has isPlatformAdmin:
   *  false by design — brief 123 §6.1). */
  bypassImpersonation?: boolean
}

/**
 * Authenticated fetch that unwraps the `{ status, data, ... }` envelope our
 * CRM API uses. Returns the parsed body directly (T = the full envelope,
 * caller reads .data if present). Throws ApiError on non-2xx or on
 * `{ status: "error" }` bodies.
 */
export async function authedFetch<T = unknown>(
  url: string,
  init: AuthedFetchInit = {},
): Promise<T> {
  const { token: overrideToken, bypassImpersonation, headers, ...rest } = init
  // Priority: per-call `token` arg → impersonation override (unless
  // bypassed) → localStorage.
  const token = overrideToken
    ?? (bypassImpersonation ? null : impersonationToken)
    ?? readToken()

  return doFetch<T>(url, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
  })
}

/**
 * Unauthenticated fetch with the same envelope handling. Used for the
 * subdomain check (brief 11 §4) where auth isn't required.
 */
export async function publicFetch<T = unknown>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const { headers, ...rest } = init
  return doFetch<T>(url, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    },
  })
}

async function doFetch<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init)

  let body: ApiErrorBody = {}
  const text = await res.text()
  if (text) {
    try {
      body = JSON.parse(text) as ApiErrorBody
    } catch {
      throw new ApiError(res.status, `Unexpected response (${res.status})`)
    }
  }

  if (!res.ok || body.status === 'error') {
    const err = new ApiError(
      res.status,
      body.message ?? `Request failed (${res.status})`,
      body.code,
      body,
    )
    notifyApiErrorObservers(err)
    throw err
  }

  return body as T
}
