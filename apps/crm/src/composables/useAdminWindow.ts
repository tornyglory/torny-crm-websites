/**
 * URL-driven trailing-window state shared across Dashboard, Accounts,
 * and Billing. Writes propagate via `router.replace()` so the back
 * button restores prior selections. Default is 30d when `?window=` is
 * absent or malformed.
 *
 * Why URL state and not a shared module ref: bookmarkability. An admin
 * saves "Past-due Pro clubs this quarter" (`/admin/accounts?window=90d&
 * filter[plan]=pro`) and the back button restores the previous window
 * on nav. Shared refs silently reset on route change.
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { AdminWindow } from '@torny/api-client'

const VALID_WINDOWS: readonly AdminWindow[] = ['7d', '30d', '90d', 'ytd', 'all'] as const

function coerce(raw: unknown): AdminWindow {
  if (typeof raw === 'string' && (VALID_WINDOWS as readonly string[]).includes(raw)) {
    return raw as AdminWindow
  }
  return '30d'
}

export function useAdminWindow() {
  const route = useRoute()
  const router = useRouter()

  const window = computed<AdminWindow>(() => coerce(route.query.window))

  function setWindow(next: AdminWindow) {
    if (next === window.value) return
    void router.replace({ query: { ...route.query, window: next } })
  }

  return { window, setWindow }
}
