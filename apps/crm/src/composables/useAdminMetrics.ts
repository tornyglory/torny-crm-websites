/**
 * Thin wrapper around `admin.metricsOverview` / `admin.metricsBilling`
 * that refetches on window change and surfaces loading / error state
 * for the Dashboard + Billing views.
 *
 * Phase 1 shape: trend arrays are empty server-side. FE renders the
 * MetricCards without sparklines until Phase 2 fills them.
 */
import { ref, watch, type Ref } from 'vue'
import {
  admin,
  ApiError,
  type AdminMetricsOverview,
  type AdminMetricsBilling,
  type AdminWindow,
} from '@torny/api-client'

type Which = 'overview' | 'billing'

export function useAdminMetrics<W extends Which>(
  which: W,
  window: Ref<AdminWindow>,
) {
  type Data = W extends 'overview' ? AdminMetricsOverview : AdminMetricsBilling

  const data = ref<Data | null>(null) as Ref<Data | null>
  const loading = ref(false)
  const error = ref<string | null>(null)
  let inFlight: AbortController | null = null

  async function load() {
    // Cancel any in-flight fetch so a rapid window flip doesn't resolve
    // out-of-order and clobber the latest selection.
    inFlight?.abort()
    const ctrl = new AbortController()
    inFlight = ctrl

    loading.value = true
    error.value = null
    try {
      const res = which === 'overview'
        ? await admin.metricsOverview({ window: window.value, signal: ctrl.signal })
        : await admin.metricsBilling({ window: window.value, signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      data.value = res as Data
    } catch (err) {
      if (ctrl.signal.aborted) return
      error.value = err instanceof ApiError ? err.message : 'Could not load metrics.'
    } finally {
      if (!ctrl.signal.aborted) loading.value = false
    }
  }

  watch(window, () => void load(), { immediate: true })

  return { data, loading, error, refresh: load }
}
