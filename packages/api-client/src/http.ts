// Shared http helper for the CRM's resource modules. Uses fetch (not the
// axios TornyClient) because it's simpler for the small, per-endpoint
// calls the CRM needs.
//
// Phase B of brief 119 (HttpOnly session cookies): authedFetch sends
// `credentials: 'include'` on every call so the browser attaches the
// `torny_sid` session cookie the backend set on /login. We no longer
// read a bearer token from localStorage — the cookie carries the
// session and JavaScript can't read it (that's the whole point).
//
// Callers who still need to pass a Bearer token explicitly (invite
// accept, signup — both set a token server-side via endpoints that
// don't set the cookie yet, pending brief 119 Phase B.1) can still do
// so via the `token` override on AuthedFetchInit. That path stays
// supported until the backend adds cookie-setting to /accept-invite
// and /signup.
//
// Every non-500 error carries a machine-readable `code` field per
// brief 08 §Error shape — surfaced on ApiError so callers can switch
// on it.

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

export interface AuthedFetchInit extends RequestInit {
  /** Optional explicit Bearer token. Only needed for legacy endpoints
   *  (invite accept, signup) that return an auth_token and don't set a
   *  session cookie yet. Normal CRM traffic doesn't pass this — the
   *  browser sends the HttpOnly cookie automatically. */
  token?: string | null
}

/**
 * Authenticated fetch that unwraps the `{ status, data, ... }` envelope
 * our CRM API uses. Returns the parsed body directly (T = the full
 * envelope, caller reads .data if present). Throws ApiError on non-2xx
 * or on `{ status: "error" }` bodies.
 *
 * Attaches `credentials: 'include'` so the browser sends the HttpOnly
 * session cookie. Optional explicit `token` option exists for the two
 * legacy flows still on Bearer (see module comment).
 */
export async function authedFetch<T = unknown>(
  url: string,
  init: AuthedFetchInit = {},
): Promise<T> {
  const { token: overrideToken, headers, ...rest } = init

  return doFetch<T>(url, {
    ...rest,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(overrideToken ? { Authorization: `Bearer ${overrideToken}` } : {}),
      ...(headers ?? {}),
    },
  })
}

/**
 * Unauthenticated fetch with the same envelope handling. Used for the
 * subdomain check (brief 11 §4) where auth isn't required. Still sends
 * `credentials: 'include'` so a session cookie — if present — reaches
 * the server; the public endpoints just ignore it.
 */
export async function publicFetch<T = unknown>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const { headers, ...rest } = init
  return doFetch<T>(url, {
    ...rest,
    credentials: 'include',
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
    throw new ApiError(
      res.status,
      body.message ?? `Request failed (${res.status})`,
      body.code,
      body,
    )
  }

  return body as T
}
