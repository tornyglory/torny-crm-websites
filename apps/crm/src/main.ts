import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { initSentry } from './utils/sentry'

import '@torny/design-tokens/fonts.css'
import '@torny/design-tokens/tokens.css'
import './styles/base.css'

const app = createApp(App)
// Sentry before plugins so it can wrap the Vue error handler + the
// router. No-op when VITE_SENTRY_DSN is unset.
initSentry(app, router)
app.use(createPinia())
app.use(router)
app.mount('#app')
