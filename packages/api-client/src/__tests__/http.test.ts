/**
 * Contract tests for the shared http helpers. These cover every
 * resource module indirectly — if `authedFetch` changes its header
 * shape or envelope handling, the behaviour of every `members.*`,
 * `events.*`, `communications.*` call changes with it. Pin the shape
 * here so a refactor can't silently drift.
 *
 * Brief 119 Phase B: the CRM moved off bearer-token-in-localStorage
 * onto an HttpOnly session cookie. `authedFetch` now sends
 * `credentials: 'include'` and does NOT read a token from storage.
 * An explicit `token` override is still honoured for the legacy
 * Bearer flows (accept-invite, torny-web signup) that haven't been
 * migrated to cookie-setting on the backend yet.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { authedFetch, publicFetch, ApiError } from '../http'

// Captures the last call so individual tests can assert URL / init.
let lastCall: { url: string; init: RequestInit } | null = null

function mockFetch(responseInit: {
  status?: number
  body?: unknown
  text?: string
}): void {
  const { status = 200, body, text } = responseInit
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    lastCall = { url: String(url), init }
    const payload = text ?? (body === undefined ? '' : JSON.stringify(body))
    return new Response(payload, { status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  lastCall = null
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ApiError', () => {
  it('carries status / code / body / message', () => {
    const err = new ApiError(404, 'not found', 'member_not_found', { code: 'member_not_found', extra: 1 })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ApiError')
    expect(err.status).toBe(404)
    expect(err.code).toBe('member_not_found')
    expect(err.message).toBe('not found')
    expect(err.body).toEqual({ code: 'member_not_found', extra: 1 })
  })

  it('code and body are optional', () => {
    const err = new ApiError(500, 'oops')
    expect(err.code).toBeUndefined()
    expect(err.body).toBeUndefined()
  })
})

describe('authedFetch', () => {
  it('sends credentials: include so the browser attaches the session cookie', async () => {
    mockFetch({ body: { status: 'ok' } })

    await authedFetch('https://api.example/path')

    expect(lastCall).not.toBeNull()
    expect(lastCall!.init.credentials).toBe('include')
  })

  it('does not add Authorization when no explicit token is passed', async () => {
    mockFetch({ body: { status: 'ok' } })
    await authedFetch('https://api.example/path')
    const headers = lastCall!.init.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('attaches Authorization: Bearer when a token is explicitly passed', async () => {
    mockFetch({ body: { status: 'ok' } })

    await authedFetch('https://api.example/path', { token: 'legacy-bearer' })

    const headers = lastCall!.init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer legacy-bearer')
    // Still sends credentials — explicit token doesn't opt out of the cookie.
    expect(lastCall!.init.credentials).toBe('include')
  })

  it('token=null opts out of the Bearer header even if truthy strings are the usual input', async () => {
    mockFetch({ body: { status: 'ok' } })
    await authedFetch('https://api.example/path', { token: null })
    const headers = lastCall!.init.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  it('caller-supplied headers merge without clobbering Content-Type', async () => {
    mockFetch({ body: { status: 'ok' } })

    await authedFetch('https://api.example/path', {
      method: 'POST',
      headers: { 'X-Torny-Club': '42' },
    })

    const headers = lastCall!.init.headers as Record<string, string>
    expect(headers['X-Torny-Club']).toBe('42')
    expect(headers['Content-Type']).toBe('application/json')
    expect(lastCall!.init.method).toBe('POST')
  })

  it('returns parsed JSON on 2xx', async () => {
    mockFetch({ body: { status: 'ok', data: { answer: 42 } } })
    const out = await authedFetch<{ data: { answer: number } }>('https://api.example/path')
    expect(out.data.answer).toBe(42)
  })

  it('returns an empty object when response body is empty', async () => {
    mockFetch({ text: '' })
    const out = await authedFetch('https://api.example/path')
    expect(out).toEqual({})
  })

  it('throws ApiError on non-2xx status', async () => {
    mockFetch({ status: 404, body: { status: 'error', code: 'member_not_found', message: 'nope' } })
    await expect(authedFetch('https://api.example/path')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      code: 'member_not_found',
      message: 'nope',
    })
  })

  it('throws ApiError on 2xx with { status: "error" } envelope', async () => {
    mockFetch({ status: 200, body: { status: 'error', code: 'validation_failed', message: 'bad input' } })
    await expect(authedFetch('https://api.example/path')).rejects.toMatchObject({
      name: 'ApiError',
      status: 200,
      code: 'validation_failed',
      message: 'bad input',
    })
  })

  it('throws ApiError with fallback message when non-2xx has no message', async () => {
    mockFetch({ status: 500, body: {} })
    await expect(authedFetch('https://api.example/path')).rejects.toMatchObject({
      status: 500,
      message: 'Request failed (500)',
    })
  })

  it('throws ApiError with a clear message when the body is unparseable', async () => {
    mockFetch({ status: 502, text: '<html>Bad Gateway</html>' })
    await expect(authedFetch('https://api.example/path')).rejects.toMatchObject({
      status: 502,
      message: 'Unexpected response (502)',
    })
  })
})

describe('publicFetch', () => {
  it('sends credentials: include so a session cookie — if any — reaches the server', async () => {
    mockFetch({ body: { status: 'ok' } })
    await publicFetch('https://api.example/public')
    expect(lastCall!.init.credentials).toBe('include')
  })

  it('never attaches Authorization — publicFetch has no token path', async () => {
    mockFetch({ body: { status: 'ok' } })
    await publicFetch('https://api.example/public')
    const headers = lastCall!.init.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('uses the same envelope error handling as authedFetch', async () => {
    mockFetch({ status: 429, body: { status: 'error', code: 'rate_limited', message: 'slow down' } })
    await expect(publicFetch('https://api.example/public')).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
    })
  })
})
