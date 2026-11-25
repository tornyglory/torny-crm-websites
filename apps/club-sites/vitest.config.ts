import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // jsdom covers the small surface area we're testing today — pure
    // helpers exported from server/utils. Expand to @nuxt/test-utils
    // when we start covering composables or server handlers that need
    // the full Nuxt runtime.
    environment: 'jsdom',
    globals: true,
    include: ['server/**/__tests__/**/*.test.ts', 'utils/**/__tests__/**/*.test.ts'],
  },
})
