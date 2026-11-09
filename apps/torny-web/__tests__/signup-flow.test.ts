/**
 * Signup flow contract tests — exercise `auth.signup()` with mocked fetch
 * across three representative org types so we're confident the payload
 * going on the wire matches what the wizard produces for each.
 *
 * Mirror of the admin walking through the wizard end-to-end:
 *   - Sports & recreation → default Pro
 *   - Hospitality → default Starter
 *   - Holiday accommodation → default Pro
 *
 * Does NOT boot Nuxt — just the api-client binding. Browser-level step
 * walking lives in Playwright (e2e/signup.spec.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { auth, AuthError, type SignupInput } from '@torny/api-client'
import { defaultPlanFor } from '../composables/useSignupWizard'

const VENUE_BASE = 'https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod'

// Make a "the admin filled in all 4 steps" payload for a given org type.
// Mirrors exactly what pages/signup/index.vue's submitSignup() constructs.
function wizardPayloadFor(orgType: SignupInput['organisation']['org_type']): SignupInput {
  return {
    user: {
      name: 'Sarah Whittaker',
      email: 'sarah@test.co.nz',
      password: 'a-long-good-password',
    },
    organisation: {
      name: 'Test Organisation',
      slug: 'test-organisation',
      org_type: orgType,
      country: 'NZ',
      timezone: 'Pacific/Auckland',
    },
    plan: defaultPlanFor(orgType),
    success_url: 'https://torny.co/signup/welcome?org=test-organisation',
    cancel_url: 'https://torny.co/signup?step=4',
  }
}

// Response the backend returns on a happy-path signup (brief 88 §2).
function okResponse(orgSlug: string) {
  return {
    status: 'success',
    data: {
      user: { id: 4821, name: 'Sarah Whittaker', email: 'sarah@test.co.nz' },
      organisation: { id: 319, slug: orgSlug, name: 'Test Organisation' },
      auth_token: 'eyJfakeJWT',
      checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_xyz',
      public_site: `https://${orgSlug}.torny.co`,
    },
  }
}

describe('POST /public/signup — different packages', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('Sports & recreation picks Pro and posts the full wizard shape', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(okResponse('thorndon-bowls')), { status: 200 }),
    )

    const payload = wizardPayloadFor('sports_and_recreation')
    expect(payload.plan).toBe('pro')

    const result = await auth.signup(payload, { idempotencyKey: 'sess-sports-1' })

    expect(result.checkout_url).toContain('checkout.stripe.com')
    expect(result.auth_token).toBe('eyJfakeJWT')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${VENUE_BASE}/public/signup`)
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['Idempotency-Key']).toBe('sess-sports-1')

    const body = JSON.parse(init.body as string)
    expect(body.plan).toBe('pro')
    expect(body.organisation.org_type).toBe('sports_and_recreation')
    expect(body.organisation.country).toBe('NZ')
    expect(body.organisation.timezone).toBe('Pacific/Auckland')
    expect(body.user.email).toBe('sarah@test.co.nz')
    expect(body.success_url).toContain('/signup/welcome')
    expect(body.cancel_url).toContain('/signup?step=4')
  })

  it('Hospitality picks Starter by default', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(okResponse('the-ferret')), { status: 200 }),
    )
    const payload = wizardPayloadFor('hospitality')
    expect(payload.plan).toBe('starter')

    const result = await auth.signup(payload, { idempotencyKey: 'sess-pub-1' })
    expect(result.checkout_url).toContain('checkout.stripe.com')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.plan).toBe('starter')
    expect(body.organisation.org_type).toBe('hospitality')
  })

  it('Holiday accommodation picks Pro — venue bookings are the business', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(okResponse('seacrest-lodge')), { status: 200 }),
    )
    const payload = wizardPayloadFor('holiday_accommodation')
    expect(payload.plan).toBe('pro')

    const result = await auth.signup(payload, { idempotencyKey: 'sess-lodge-1' })
    expect(result.public_site).toBe('https://seacrest-lodge.torny.co')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.plan).toBe('pro')
    expect(body.organisation.org_type).toBe('holiday_accommodation')
  })

  it('Community & civic picks Pro (town halls rent out space)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(okResponse('carterton-hall')), { status: 200 }),
    )
    const payload = wizardPayloadFor('community_and_civic')
    expect(payload.plan).toBe('pro')
    await auth.signup(payload, { idempotencyKey: 'sess-hall-1' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.plan).toBe('pro')
  })

  it('Non-profit picks Starter — the lightweight CRM is enough', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(okResponse('sunrise-trust')), { status: 200 }),
    )
    const payload = wizardPayloadFor('non_profit')
    expect(payload.plan).toBe('starter')
    await auth.signup(payload, { idempotencyKey: 'sess-np-1' })
  })
})

describe('POST /public/signup — error paths', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('409 email_in_use throws an AuthError with the code', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'error',
          code: 'email_in_use',
          message: 'That email is already registered',
        }),
        { status: 409 },
      ),
    )

    await expect(
      auth.signup(wizardPayloadFor('sports_and_recreation')),
    ).rejects.toSatisfy(
      (err) => err instanceof AuthError && err.code === 'email_in_use' && err.status === 409,
    )
  })

  it('400 slug_unavailable carries the server data block on the error', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'error',
          code: 'slug_unavailable',
          message: 'slug is not available',
          data: { available: false, reason: 'taken', slug: 'test-organisation' },
        }),
        { status: 400 },
      ),
    )

    try {
      await auth.signup(wizardPayloadFor('sports_and_recreation'))
      expect.fail('expected signup to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError)
      const authErr = err as AuthError
      expect(authErr.code).toBe('slug_unavailable')
      expect(authErr.status).toBe(400)
      expect(authErr.data).toEqual({ available: false, reason: 'taken', slug: 'test-organisation' })
    }
  })

  it('400 bad_password surfaces cleanly', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'error',
          code: 'bad_password',
          message: 'Password must be at least 12 characters',
        }),
        { status: 400 },
      ),
    )
    await expect(
      auth.signup({
        ...wizardPayloadFor('sports_and_recreation'),
        user: { name: 'S', email: 's@t.co', password: 'short' },
      }),
    ).rejects.toSatisfy((err) => err instanceof AuthError && err.code === 'bad_password')
  })

  it('502 stripe_checkout_create_failed is retryable by the FE', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'error',
          code: 'stripe_checkout_create_failed',
          message: 'Stripe rejected the session create',
        }),
        { status: 502 },
      ),
    )
    await expect(auth.signup(wizardPayloadFor('sports_and_recreation')))
      .rejects.toSatisfy((err) => err instanceof AuthError && err.status === 502)
  })
})

describe('POST /public/signup — idempotency', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does NOT send Idempotency-Key when none is provided', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(okResponse('x')), { status: 200 }),
    )
    await auth.signup(wizardPayloadFor('sports_and_recreation'))
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['Idempotency-Key']).toBeUndefined()
  })

  it('sends the same Idempotency-Key when the FE retries a submit', async () => {
    const key = 'sess-abc-123'
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(okResponse('x')), { status: 200 }),
    )
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(okResponse('x')), { status: 200 }),
    )
    await auth.signup(wizardPayloadFor('sports_and_recreation'), { idempotencyKey: key })
    await auth.signup(wizardPayloadFor('sports_and_recreation'), { idempotencyKey: key })

    const [, init1] = fetchMock.mock.calls[0] as [string, RequestInit]
    const [, init2] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect((init1.headers as Record<string, string>)['Idempotency-Key']).toBe(key)
    expect((init2.headers as Record<string, string>)['Idempotency-Key']).toBe(key)
  })
})
