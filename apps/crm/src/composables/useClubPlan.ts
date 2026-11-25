/**
 * Shared plan / add-on state for the current club.
 *
 * Fetched from `GET /clubs/:cid/plan` — same endpoint SettingsView
 * calls on its Billing tab (brief 88). Cached in a module-scoped ref
 * so the block picker, Settings → Billing, and any other view that
 * needs entitlement context read from one source rather than firing
 * their own fetches.
 *
 * Brief 122 uses this as the input to `isBlockEntitled` — plan tier
 * gates Pro blocks today; `addons` scaffolds the per-entitlement flow
 * for when the first paid add-on block ships.
 *
 * Invalidation: Stripe redirects land on `/crm/settings/billing` which
 * polls + refreshes. If plan state needs to invalidate from elsewhere
 * (e.g. the eventual upsell modal completing checkout), call
 * `refresh()` explicitly.
 */
import { ref, computed, type Ref } from 'vue'
import {
  billing as billingApi,
  ApiError,
  type PlanState,
  type PlanKey,
} from '@torny/api-client'
import { useClubStore } from '@/stores/club'

const state: Ref<PlanState | null> = ref(null)
const loading = ref(false)
const error = ref<string | null>(null)
/** Cache keyed by club id — switching clubs in the CRM should repull. */
let loadedForClubId: number | null = null

async function fetchFor(clubId: number) {
  loading.value = true
  error.value = null
  try {
    state.value = await billingApi.get(clubId)
    loadedForClubId = clubId
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not load plan.'
  } finally {
    loading.value = false
  }
}

export function useClubPlan() {
  const clubStore = useClubStore()

  /** Lazily fetch the plan for the current club. No-op if already
   *  loaded for this club. Callers can safely call this on mount. */
  async function ensure() {
    const clubId = clubStore.current?.id
    if (typeof clubId !== 'number') return
    if (loadedForClubId === clubId && state.value) return
    await fetchFor(clubId)
  }

  /** Force a re-fetch — call this after any action that could change
   *  the plan (Stripe checkout success, portal return). */
  async function refresh() {
    const clubId = clubStore.current?.id
    if (typeof clubId !== 'number') return
    await fetchFor(clubId)
  }

  /** Plan key (`'starter' | 'pro'`) or undefined until loaded. Pass this
   *  to `isBlockEntitled` from @torny/content-blocks. */
  const plan = computed<PlanKey | undefined>(() => state.value?.plan)

  /** Active add-on entitlement ids. Empty array when loaded + no
   *  add-ons; empty array when backend predates brief 122. */
  const addons = computed<readonly string[]>(() => state.value?.addons ?? [])

  return {
    state,
    plan,
    addons,
    loading,
    error,
    ensure,
    refresh,
  }
}
