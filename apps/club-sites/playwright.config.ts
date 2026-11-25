import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for the club-sites smoke suite.
 *
 * No webServer — the suite hits the live deployed site (CF Pages).
 * This is a post-deploy health check, not a PR gate. It's the backstop
 * we didn't have when brief 01b's isomorphic-dompurify swap silently
 * 500'd every public page on prod for ~2 weeks (fixed in commit
 * a10ced3). A green smoke run proves the deployed worker boots, every
 * page in the nav renders, and no console/page errors fire in the
 * browser after hydration.
 *
 * Override `SMOKE_SITE_URL` to point at a different tenant or a
 * preview deployment; defaults to the Naenae club because that's the
 * tenant we have most history with.
 */
const baseURL = process.env.SMOKE_SITE_URL ?? 'https://naenae-bowling-club.torny.pro'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
})
