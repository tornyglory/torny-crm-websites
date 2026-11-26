import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { registerApiErrorObserver } from '@torny/api-client'
import App from './App.vue'
import { router } from './router'
import { initSentry } from './utils/sentry'
import { installPreloadErrorRecovery } from './utils/preloadErrorRecovery'
import { onApiError as onApiErrorSuspension } from './composables/useAccountSuspendedModal'

import '@torny/design-tokens/fonts.css'
import '@torny/design-tokens/tokens.css'
import './styles/base.css'

// Reload once on vite:preloadError so stale-tab users pick up the
// new build instead of seeing a broken navigation.
installPreloadErrorRecovery()

// Brief 123 §6.3 — every mutating CRM handler for a suspended club
// returns `409 account_suspended`. Globally intercept those errors
// at the api-client level and trigger the blocking modal; no per-view
// catch wiring required.
registerApiErrorObserver(onApiErrorSuspension)

const app = createApp(App)
// Sentry before plugins so it can wrap the Vue error handler + the
// router. No-op when VITE_SENTRY_DSN is unset.
initSentry(app, router)
app.use(createPinia())
app.use(router)
app.mount('#app')
