import { defineStore, acceptHMRUpdate } from 'pinia'
import { ref } from 'vue'
import { clubSettings as api, ApiError, type ClubSettings } from '@torny/api-client'

/**
 * Club settings store — one-shot hydrator for the CRM Settings page.
 *
 * Fetches `GET /clubs/:id/settings` on demand and holds the response so the
 * view can read every subsection reactively. Writes still go through the
 * per-section PATCH endpoints (brand-assets, font-pair, navigation, etc);
 * this store just merges the response back in via `patchBrand`, `patchNav`,
 * etc, or you can call `fetch(clubId)` again for a fresh full payload.
 */
export const useClubSettingsStore = defineStore('clubSettings', () => {
  const data = ref<ClubSettings | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** Last clubId we successfully loaded — helps guards decide to refetch. */
  const loadedClubId = ref<number | null>(null)

  async function fetch(clubId: number): Promise<void> {
    loading.value = true
    error.value = null
    try {
      data.value = await api.get(clubId)
      loadedClubId.value = clubId
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : (err as Error).message
    } finally {
      loading.value = false
    }
  }

  /** Merge in an updated brand response after a successful PATCH. */
  function patchBrand(patch: Partial<ClubSettings['brand']>): void {
    if (!data.value) return
    data.value = { ...data.value, brand: { ...data.value.brand, ...patch } }
  }

  function clear(): void {
    data.value = null
    loadedClubId.value = null
    error.value = null
  }

  return {
    data,
    loading,
    error,
    loadedClubId,
    fetch,
    patchBrand,
    clear,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useClubSettingsStore, import.meta.hot))
}
