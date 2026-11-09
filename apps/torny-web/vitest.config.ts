import { defineConfig } from 'vitest/config'

/**
 * Vitest for torny-web. Covers pure logic from the signup wizard
 * composable (slugify, defaultPlanFor) + the api-client contract the
 * wizard calls into. Browser-level integration lives in Playwright
 * (see `playwright.config.ts` + `e2e/`).
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['__tests__/**/*.test.ts'],
  },
})
