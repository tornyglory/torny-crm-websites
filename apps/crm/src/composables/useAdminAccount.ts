/**
 * Single-account detail state — brief 123 §3. Wraps
 * `admin.getAccount(id)` and exposes `refresh()` so action modals can
 * re-pull after mutating the row.
 */
import { ref, watch, type Ref } from 'vue'
import {
  admin,
  ApiError,
  type AdminAccountDetail,
  type AdminWindow,
} from '@torny/api-client'

export function useAdminAccount(id: Ref<number>, window: Ref<AdminWindow>) {
  const data = ref<AdminAccountDetail | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let inFlight: AbortController | null = null

  async function load() {
    inFlight?.abort()
    const ctrl = new AbortController()
    inFlight = ctrl
    loading.value = true
    error.value = null
    try {
      const res = await admin.getAccount(id.value, { window: window.value, signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      data.value = res
    } catch (err) {
      if (ctrl.signal.aborted) return
      error.value = err instanceof ApiError ? err.message : 'Could not load account.'
    } finally {
      if (!ctrl.signal.aborted) loading.value = false
    }
  }

  watch([id, window], () => void load(), { immediate: true })

  return { data, loading, error, refresh: load }
}
