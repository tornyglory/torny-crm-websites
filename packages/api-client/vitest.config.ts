import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // jsdom so http.ts's localStorage.getItem() works. api-client is
    // otherwise pure TS — no Vue, no DOM manipulation elsewhere.
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/__tests__/setup.ts'],
  },
})
