import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      // Only pick up `*.test.ts(x)` files inside src/. The ad-hoc smoke
      // scripts in /tmp/ shouldn't run under CI.
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      setupFiles: ['./src/__tests__/setup.ts'],
    },
  }),
)
