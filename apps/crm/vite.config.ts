import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { fileURLToPath, URL } from 'node:url'

// The Sentry Vite plugin uploads sourcemaps + tags the release when
// SENTRY_AUTH_TOKEN, SENTRY_ORG, and SENTRY_PROJECT are all present.
// Any of those absent (dev, preview build, forks without secrets) =
// the plugin is skipped entirely — no build-time noise.
const sentryEnabled = !!(
  process.env.SENTRY_AUTH_TOKEN
  && process.env.SENTRY_ORG
  && process.env.SENTRY_PROJECT
)

export default defineConfig({
  plugins: [
    vue(),
    ...(sentryEnabled
      ? [
        sentryVitePlugin({
          authToken: process.env.SENTRY_AUTH_TOKEN,
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          release: {
            name: process.env.VITE_SENTRY_RELEASE,
          },
          sourcemaps: {
            // Upload all emitted maps, then delete them locally so
            // they don't ship in the deploy artefact.
            filesToDeleteAfterUpload: ['./dist/**/*.map'],
          },
        }),
      ]
      : []),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5174,
  },
  build: {
    // Needed for Sentry to link stack frames back to source. The
    // vite-plugin above deletes the .map files after upload so they
    // don't end up in the deploy.
    sourcemap: sentryEnabled,
  },
})
