import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for the CRM.
 *
 * Boots the Vite dev server on port 5174 automatically. Tests live in
 * `e2e/` so they're kept apart from the vitest unit suite under `src/`.
 * Keep the viewport desktop-sized so the top-bar + sidebar render — the
 * CRM collapses to a mobile shell under ~900px.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  // Keep traces + screenshots on first retry so a failing CI run is
  // debuggable without re-running locally.
  use: {
    baseURL: 'http://localhost:5174',
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
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
