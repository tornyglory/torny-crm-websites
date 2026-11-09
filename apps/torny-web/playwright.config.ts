import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for torny-web.
 *
 * Boots the Nuxt dev server on port 3002 automatically (reuses an
 * existing one if it's already running — handy during local dev).
 * Tests live in `e2e/` alongside the signup-wizard spec.
 */
export default defineConfig({
  testDir: './e2e',
  // Running one test at a time — the Nuxt dev server has limited capacity
  // and parallel wizard walks caused occasional hydration races.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3002',
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
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3002',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
