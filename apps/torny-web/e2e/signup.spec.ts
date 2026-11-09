/**
 * End-to-end signup wizard walkthrough in Chromium.
 *
 * Mocks the two backend endpoints the wizard calls:
 *   - GET /subdomains/check?value=…       (slug availability)
 *   - POST /public/signup                 (atomic signup + Stripe)
 *
 * Also intercepts the Stripe Checkout redirect at the browser level so
 * we can assert the admin got there with the right `checkout_url` —
 * without actually hitting Stripe's live hosts.
 *
 * Three flavours walked:
 *   - Sports & recreation  → preselects Pro
 *   - Hospitality          → preselects Starter
 *   - Holiday accommodation → preselects Pro
 */
import { test, expect, type Page } from '@playwright/test'

const CRM = 'https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod'
const VENUE = 'https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod'

// Wire the mocks so the dev server's api-client calls land on us.
async function mockBackend(page: Page, options: {
  slugAvailable?: boolean
  signupStatus?: number
  signupError?: { code: string; message: string; data?: unknown }
} = {}) {
  const slugAvailable = options.slugAvailable ?? true

  await page.route(`${CRM}/subdomains/check**`, async (route) => {
    const url = new URL(route.request().url())
    const value = url.searchParams.get('value') ?? ''
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'success',
        data: slugAvailable
          ? { available: true, value }
          : { available: false, reason: 'taken', value },
      }),
    })
  })

  await page.route(`${VENUE}/public/signup`, async (route) => {
    if (options.signupStatus && options.signupStatus >= 400) {
      await route.fulfill({
        status: options.signupStatus,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'error',
          code: options.signupError?.code,
          message: options.signupError?.message,
          data: options.signupError?.data,
        }),
      })
      return
    }

    const body = JSON.parse(route.request().postData() ?? '{}')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'success',
        data: {
          user: { id: 1, name: body.user.name, email: body.user.email },
          organisation: {
            id: 1,
            slug: body.organisation.slug,
            name: body.organisation.name,
          },
          auth_token: 'test-token-' + body.organisation.slug,
          // Point at a sentinel URL so the test can assert the admin was
          // redirected here without actually loading Stripe.
          checkout_url: `https://e2e-fake-stripe.test/cs_${body.plan}_${body.organisation.slug}`,
          public_site: `https://${body.organisation.slug}.torny.co`,
        },
      }),
    })
  })

  // When the wizard window.location.href's to the fake Stripe URL, intercept
  // it with a static page so the test can inspect the URL it was taken to.
  await page.route('https://e2e-fake-stripe.test/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<html><body data-testid="fake-stripe" data-url="${route.request().url()}">Stripe placeholder</body></html>`,
    })
  })
}

async function waitForHydration(page: Page) {
  // Nuxt SSRs the markup but Vue's event listeners aren't attached until
  // hydration finishes on the client. If we type before that happens the
  // `input` events fire into the void — the form never sees them. Wait
  // for Nuxt to signal its payload is set before interacting.
  await page.waitForFunction(() => {
    const w = window as unknown as { __NUXT__?: unknown; useNuxtApp?: unknown }
    return Boolean(w.__NUXT__) || Boolean(w.useNuxtApp)
  }, undefined, { timeout: 15_000 })
}

async function fillStep1(page: Page) {
  await waitForHydration(page)

  const nameInput = page.getByPlaceholder('Sarah Whittaker')
  const emailInput = page.getByPlaceholder('sarah@yourclub.co.nz')
  const passwordInput = page.getByPlaceholder('At least 12 characters')

  await expect(nameInput).toBeVisible()
  await nameInput.pressSequentially('Sarah Whittaker', { delay: 10 })
  await emailInput.pressSequentially('sarah@test.co.nz', { delay: 10 })
  await passwordInput.pressSequentially('a-long-good-password', { delay: 10 })
  // Blur so `v-model.trim` on step 1 commits the final value.
  await passwordInput.press('Tab')

  const continueBtn = page.getByRole('button', { name: /Continue · Step 2 of 4/ })
  await expect(continueBtn).toBeEnabled({ timeout: 10_000 })
  await continueBtn.click()
}

async function fillStep2(page: Page, orgName: string, categoryLabel: string) {
  // Wait for step 2 to become interactive.
  const orgInput = page.getByPlaceholder('Thorndon Bowling Club')
  await expect(orgInput).toBeVisible()

  await orgInput.pressSequentially(orgName, { delay: 10 })
  await orgInput.press('Tab')

  // Wait for the debounced slug check (220ms) to resolve.
  await expect(page.getByText('✓ Available')).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: new RegExp(categoryLabel) }).click()

  const continueBtn = page.getByRole('button', { name: /Continue · Step 3 of 4/ })
  await expect(continueBtn).toBeEnabled({ timeout: 10_000 })
  await continueBtn.click()
}

test.describe('Signup wizard — Chromium walkthrough', () => {
  test('Sports & recreation → Pro preselected → signup sends plan: pro', async ({ page }) => {
    await mockBackend(page)
    await page.goto('/signup')

    await fillStep1(page)
    await fillStep2(page, 'Thorndon Bowling Club', 'Sports & recreation')

    // Step 3 — Pro card shows "Recommended for you" and the Pro CTA is the
    // primary action (Continue with Pro · Step 4).
    await expect(page.getByText('● Recommended for you')).toBeVisible()
    await page.getByRole('button', { name: /Continue with Pro · Step 4/ }).click()

    // Step 4 — assert the order summary reflects the picked plan.
    await expect(page.getByText('Torny OS · Pro')).toBeVisible()

    // Click the primary CTA. Capture the POST body then intercept the redirect.
    const signupPromise = page.waitForRequest((req) => req.url().endsWith('/public/signup'))
    await page.getByRole('button', { name: /Save card · Start trial/ }).click()
    const signupReq = await signupPromise
    const signupBody = JSON.parse(signupReq.postData() ?? '{}')

    expect(signupBody.plan).toBe('pro')
    expect(signupBody.organisation.org_type).toBe('sports_and_recreation')
    expect(signupBody.organisation.name).toBe('Thorndon Bowling Club')
    expect(signupBody.organisation.slug).toBe('thorndon-bowling-club')
    expect(signupBody.user.email).toBe('sarah@test.co.nz')
    expect(signupBody.organisation.country).toBe('NZ')
    expect(signupBody.organisation.timezone).toBe('Pacific/Auckland')

    // Verify the admin landed on the (mocked) Stripe URL — the signup
    // code should have set window.location.href after the 200.
    // (localStorage can't be asserted here — it's origin-scoped and the
    // page has already navigated to e2e-fake-stripe.test by this point.
    // Token-storage behavior is covered in the vitest api-client suite.)
    await expect(page.locator('[data-testid="fake-stripe"]')).toBeVisible()
    const stripeUrl = await page.locator('[data-testid="fake-stripe"]').getAttribute('data-url')
    expect(stripeUrl).toBe('https://e2e-fake-stripe.test/cs_pro_thorndon-bowling-club')
  })

  test('Hospitality → Starter preselected → signup sends plan: starter', async ({ page }) => {
    await mockBackend(page)
    await page.goto('/signup')

    await fillStep1(page)
    await fillStep2(page, 'The Backbench Pub', 'Hospitality')

    // Pro card should NOT show "Recommended for you" on step 3 for this type.
    await expect(page.getByText('● Recommended for you')).not.toBeVisible()
    // Admin still explicitly chooses — click Pick Starter.
    await page.getByRole('button', { name: /^Pick Starter$/ }).click()

    await expect(page.getByText('Torny OS · Starter')).toBeVisible()

    const signupPromise = page.waitForRequest((req) => req.url().endsWith('/public/signup'))
    await page.getByRole('button', { name: /Save card · Start trial/ }).click()
    const signupReq = await signupPromise
    const body = JSON.parse(signupReq.postData() ?? '{}')

    expect(body.plan).toBe('starter')
    expect(body.organisation.org_type).toBe('hospitality')
    expect(body.organisation.slug).toBe('the-backbench-pub')

    await expect(page.locator('[data-testid="fake-stripe"]')).toBeVisible()
    const stripeUrl = await page.locator('[data-testid="fake-stripe"]').getAttribute('data-url')
    expect(stripeUrl).toBe('https://e2e-fake-stripe.test/cs_starter_the-backbench-pub')
  })

  test('Holiday accommodation → Pro preselected (venue bookings are the business)', async ({ page }) => {
    await mockBackend(page)
    await page.goto('/signup')

    await fillStep1(page)
    await fillStep2(page, 'Seacrest Lodge', 'Holiday accommodation')

    await expect(page.getByText('● Recommended for you')).toBeVisible()
    await page.getByRole('button', { name: /Continue with Pro · Step 4/ }).click()

    await expect(page.getByText('Torny OS · Pro')).toBeVisible()

    const signupPromise = page.waitForRequest((req) => req.url().endsWith('/public/signup'))
    await page.getByRole('button', { name: /Save card · Start trial/ }).click()
    const signupReq = await signupPromise
    const body = JSON.parse(signupReq.postData() ?? '{}')

    expect(body.plan).toBe('pro')
    expect(body.organisation.org_type).toBe('holiday_accommodation')
  })

  test('step guards: can\'t skip directly to step 3 without a valid step 1', async ({ page }) => {
    await mockBackend(page)
    await page.goto('/signup?step=3')
    // The guard bounces back to step 1.
    await expect(page.getByRole('heading', { name: "Let's start with you." })).toBeVisible()
  })

  test('taken slug blocks the "Continue" button on step 2', async ({ page }) => {
    await mockBackend(page, { slugAvailable: false })
    await page.goto('/signup')

    await fillStep1(page)

    await expect(page.getByRole('button', { name: /Continue · Step 3 of 4/ })).toBeVisible()
    await page.getByPlaceholder('Thorndon Bowling Club').fill('Thorndon Bowling Club')
    await expect(page.getByText(/Taken/)).toBeVisible()
    // Category still clickable, but the button stays disabled.
    await page.getByRole('button', { name: /Sports & recreation/ }).click()
    const continueBtn = page.getByRole('button', { name: /Continue · Step 3 of 4/ })
    await expect(continueBtn).toBeDisabled()
  })

  // ── Step 1 validation gates ───────────────────────────────────

  test('step 1: Continue stays disabled until all three fields are valid', async ({ page }) => {
    await mockBackend(page)
    await page.goto('/signup')
    await waitForHydration(page)

    const nameInput = page.getByPlaceholder('Sarah Whittaker')
    const emailInput = page.getByPlaceholder('sarah@yourclub.co.nz')
    const passwordInput = page.getByPlaceholder('At least 12 characters')
    const continueBtn = page.getByRole('button', { name: /Continue · Step 2 of 4/ })

    // Fresh load — all empty.
    await expect(continueBtn).toBeDisabled()

    // Name only → still disabled.
    await nameInput.pressSequentially('Sarah', { delay: 5 })
    await expect(continueBtn).toBeDisabled()

    // + email only → still disabled.
    await emailInput.pressSequentially('sarah@test.co.nz', { delay: 5 })
    await expect(continueBtn).toBeDisabled()

    // + short password → still disabled.
    await passwordInput.pressSequentially('short', { delay: 5 })
    await expect(continueBtn).toBeDisabled()

    // Finish the password (needs 12 chars total).
    await passwordInput.pressSequentially('-password', { delay: 5 })
    await passwordInput.press('Tab')
    await expect(continueBtn).toBeEnabled()
  })

  test('step 1: invalid email format keeps Continue disabled', async ({ page }) => {
    await mockBackend(page)
    await page.goto('/signup')
    await waitForHydration(page)

    await page.getByPlaceholder('Sarah Whittaker').pressSequentially('Sarah Whittaker', { delay: 5 })
    await page.getByPlaceholder('At least 12 characters').pressSequentially('a-long-good-password', { delay: 5 })
    const emailInput = page.getByPlaceholder('sarah@yourclub.co.nz')
    const continueBtn = page.getByRole('button', { name: /Continue · Step 2 of 4/ })

    // No @.
    await emailInput.pressSequentially('notanemail', { delay: 5 })
    await expect(continueBtn).toBeDisabled()

    // Has @ but no TLD.
    await emailInput.fill('')
    await emailInput.pressSequentially('sarah@local', { delay: 5 })
    await expect(continueBtn).toBeDisabled()

    // Trailing space / spaces are fine — the wizard trims.
    await emailInput.fill('')
    await emailInput.pressSequentially('sarah@test.co.nz', { delay: 5 })
    await emailInput.press('Tab')
    await expect(continueBtn).toBeEnabled()
  })

  test('step 1: password shorter than 12 chars keeps Continue disabled', async ({ page }) => {
    await mockBackend(page)
    await page.goto('/signup')
    await waitForHydration(page)

    await page.getByPlaceholder('Sarah Whittaker').pressSequentially('Sarah Whittaker', { delay: 5 })
    await page.getByPlaceholder('sarah@yourclub.co.nz').pressSequentially('sarah@test.co.nz', { delay: 5 })
    const passwordInput = page.getByPlaceholder('At least 12 characters')
    const continueBtn = page.getByRole('button', { name: /Continue · Step 2 of 4/ })

    // 11 chars — one under.
    await passwordInput.pressSequentially('elevenchars', { delay: 5 })
    await expect(continueBtn).toBeDisabled()

    // 12 chars — right on the edge.
    await passwordInput.pressSequentially('X', { delay: 5 })
    await passwordInput.press('Tab')
    await expect(continueBtn).toBeEnabled()
  })

  // ── Step 2 validation gates ───────────────────────────────────

  test('step 2: Continue stays disabled without an org name', async ({ page }) => {
    await mockBackend(page)
    await page.goto('/signup')
    await fillStep1(page)

    // Step 2 loaded with no org name typed.
    const continueBtn = page.getByRole('button', { name: /Continue · Step 3 of 4/ })
    await expect(continueBtn).toBeDisabled()

    // Picking a category alone doesn't help — still need an available slug.
    await page.getByRole('button', { name: /Sports & recreation/ }).click()
    await expect(continueBtn).toBeDisabled()
  })

  test('step 2: Continue stays disabled without a category picked', async ({ page }) => {
    await mockBackend(page)
    await page.goto('/signup')
    await fillStep1(page)

    const orgInput = page.getByPlaceholder('Thorndon Bowling Club')
    await orgInput.pressSequentially('Thorndon Bowling Club', { delay: 5 })
    await orgInput.press('Tab')
    await expect(page.getByText('✓ Available')).toBeVisible({ timeout: 10_000 })

    // Slug is available, name is filled, but no category — still disabled.
    const continueBtn = page.getByRole('button', { name: /Continue · Step 3 of 4/ })
    await expect(continueBtn).toBeDisabled()

    await page.getByRole('button', { name: /Sports & recreation/ }).click()
    await expect(continueBtn).toBeEnabled()
  })

  test('step 2: slug marked Reserved blocks Continue', async ({ page }) => {
    // Mock the slug check to return `reason: 'reserved'` for any value.
    await page.route(`${CRM}/subdomains/check**`, async (route) => {
      const url = new URL(route.request().url())
      const value = url.searchParams.get('value') ?? ''
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          data: { available: false, reason: 'reserved', value },
        }),
      })
    })

    await page.goto('/signup')
    await fillStep1(page)

    const orgInput = page.getByPlaceholder('Thorndon Bowling Club')
    await orgInput.pressSequentially('Admin Panel', { delay: 5 })
    await orgInput.press('Tab')

    await expect(page.getByText('Reserved')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /Sports & recreation/ }).click()
    await expect(page.getByRole('button', { name: /Continue · Step 3 of 4/ })).toBeDisabled()
  })

  test('step 2: slug marked Invalid (bad chars / too short) blocks Continue', async ({ page }) => {
    // Mock the slug check to return `reason: 'invalid'` for any value.
    await page.route(`${CRM}/subdomains/check**`, async (route) => {
      const url = new URL(route.request().url())
      const value = url.searchParams.get('value') ?? ''
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          data: { available: false, reason: 'invalid', value },
        }),
      })
    })

    await page.goto('/signup')
    await fillStep1(page)

    const orgInput = page.getByPlaceholder('Thorndon Bowling Club')
    // Needs to be long enough to trigger the server call (≥3 chars),
    // the mock always returns reason: 'invalid'.
    await orgInput.pressSequentially('Odd Name', { delay: 5 })
    await orgInput.press('Tab')

    await expect(page.getByText(/Invalid/)).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /Sports & recreation/ }).click()
    await expect(page.getByRole('button', { name: /Continue · Step 3 of 4/ })).toBeDisabled()
  })

  // ── Server-side error path (already-registered email) ─────────

  test('email already registered surfaces a friendly message', async ({ page }) => {
    await mockBackend(page, {
      signupStatus: 409,
      signupError: { code: 'email_in_use', message: 'That email is already registered' },
    })
    await page.goto('/signup')

    await fillStep1(page)
    await fillStep2(page, 'Thorndon Bowling Club', 'Sports & recreation')
    await page.getByRole('button', { name: /Continue with Pro · Step 4/ }).click()
    await page.getByRole('button', { name: /Save card · Start trial/ }).click()

    await expect(page.getByText(/already registered/)).toBeVisible()
    // Admin stayed on step 4 — not bounced to Stripe.
    await expect(page.locator('[data-testid="fake-stripe"]')).not.toBeVisible()
  })
})
