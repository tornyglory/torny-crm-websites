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

function readToken(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(TOKEN_STORAGE_KEY)
}

export interface AuthedFetchInit extends RequestInit {
  /** Optional override — otherwise reads from localStorage. */
  token?: string | null
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
  const { token: overrideToken, headers, ...rest } = init
  const token = overrideToken ?? readToken()

  const res = await fetch(url, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
  })

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
