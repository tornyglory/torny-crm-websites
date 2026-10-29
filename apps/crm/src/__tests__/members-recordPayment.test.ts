/**
 * Unit tests for the api-client's `members.recordPayment()` call site.
 *
 * These sit here (rather than inside packages/api-client) because the
 * CRM app is the one wired up with vitest today — moving them to the
 * api-client package would need its own vitest config.
 *
 * We stub global `fetch` and assert:
 *   - URL + method + body sent are what the backend expects
 *   - Auth header reads from localStorage
 *   - 200 unwraps the envelope.data cleanly
 *   - 400 bad_amount → ApiError with that `code`
 *   - 409 duplicate_payment → ApiError with that `code`
 *   - 500 → ApiError with the body message
 *
 * Hitting the api-client at this level is the right place to catch
 * silent breakages (e.g. body shape drift) because MemberDetailView
 * just calls `members.recordPayment()` and surfaces whatever ApiError
 * code it gets — the shape is the contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { members, ApiError } from '@torny/api-client'

const CRM_BASE = 'https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod'
const CLUB_ID = 5
const USER_ID = 42

const EXPECTED_URL = `${CRM_BASE}/clubs/${CLUB_ID}/members/${USER_ID}/payments`

const SUCCESS_PAYLOAD = {
  payment_id: 999,
  membership_id: 300,
  club_id: CLUB_ID,
  user_id: USER_ID,
  amount: 240,
  payment_date: '2026-10-30',
  payment_method: 'card' as const,
  payment_reference: 'STRP-abc123',
  payment_status: 'paid' as const,
  season_id: 7,
  season_name: '2026/27',
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  // Shadow global fetch for every test; restore in afterEach.
  globalThis.fetch = fetchMock as unknown as typeof fetch
})
afterEach(() => {
  // setup.ts primed the token — keep it in place so other tests don't skip.
  localStorage.setItem('torny.token', 'test-token')
})

function okResponse(data: unknown) {
  return new Response(JSON.stringify({ status: 'success', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
function errResponse(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ status: 'error', code, message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('members.recordPayment — request shape', () => {
  it('POSTs to /clubs/:cid/members/:uid/payments', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(SUCCESS_PAYLOAD))
    await members.recordPayment(CLUB_ID, USER_ID, { amount: 240, payment_method: 'card' })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(EXPECTED_URL)
    expect(init.method).toBe('POST')
  })

  it('sends the amount + method + reference as JSON', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(SUCCESS_PAYLOAD))
    await members.recordPayment(CLUB_ID, USER_ID, {
      amount: 240,
      payment_method: 'card',
      payment_reference: 'STRP-abc123',
      notes: 'EOY receipt',
    })
    const [, init] = fetchMock.mock.calls[0]!
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      amount: 240,
      payment_method: 'card',
      payment_reference: 'STRP-abc123',
      notes: 'EOY receipt',
    })
  })

  it('attaches the bearer token from localStorage', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(SUCCESS_PAYLOAD))
    await members.recordPayment(CLUB_ID, USER_ID, { amount: 100 })
    const [, init] = fetchMock.mock.calls[0]!
    const auth = (init.headers as Record<string, string>)['Authorization']
    expect(auth).toBe('Bearer test-token')
  })

  it('passes season_id through when provided', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(SUCCESS_PAYLOAD))
    await members.recordPayment(CLUB_ID, USER_ID, { amount: 240, season_id: 7 })
    const [, init] = fetchMock.mock.calls[0]!
    const body = JSON.parse(init.body as string)
    expect(body.season_id).toBe(7)
  })
})

describe('members.recordPayment — happy path', () => {
  it('returns the parsed envelope.data', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(SUCCESS_PAYLOAD))
    const result = await members.recordPayment(CLUB_ID, USER_ID, { amount: 240 })
    expect(result).toEqual(SUCCESS_PAYLOAD)
    expect(result.season_id).toBe(7)
    expect(result.season_name).toBe('2026/27')
  })
})

describe('members.recordPayment — error branches', () => {
  it('throws ApiError with code=bad_amount on 400', async () => {
    fetchMock.mockResolvedValueOnce(errResponse(400, 'bad_amount', 'Amount must be > 0'))
    await expect(
      members.recordPayment(CLUB_ID, USER_ID, { amount: -1 }),
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof ApiError && err.code === 'bad_amount' && err.status === 400
    })
  })

  it('throws ApiError with code=duplicate_payment on 409', async () => {
    fetchMock.mockResolvedValueOnce(
      errResponse(409, 'duplicate_payment', 'A payment for this period already exists'),
    )
    await expect(
      members.recordPayment(CLUB_ID, USER_ID, {
        amount: 240,
        payment_reference: 'STRP-abc123',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof ApiError && err.code === 'duplicate_payment' && err.status === 409
    })
  })

  it('surfaces the server message when the server throws without a code', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'error', message: 'Database timeout' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await expect(
      members.recordPayment(CLUB_ID, USER_ID, { amount: 240 }),
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof ApiError && err.status === 500 && err.message === 'Database timeout'
    })
  })

  it('wraps non-JSON responses as "Unexpected response"', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html>service unavailable</html>', {
        status: 503,
        headers: { 'content-type': 'text/html' },
      }),
    )
    await expect(
      members.recordPayment(CLUB_ID, USER_ID, { amount: 240 }),
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof ApiError && /Unexpected response/.test(err.message)
    })
  })
})
