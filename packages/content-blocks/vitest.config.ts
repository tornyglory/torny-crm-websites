import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // jsdom so isomorphic-dompurify picks the browser path during tests
    // (same code path that runs in the CRM editor preview + Nuxt client
    // hydration). Server path is exercised in the apps/club-sites build.
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
})
