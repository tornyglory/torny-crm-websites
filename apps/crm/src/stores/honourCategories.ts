import { defineStore, acceptHMRUpdate } from 'pinia'
import { computed, ref } from 'vue'
import { honourBoard, type HonourCategory } from '@torny/api-client'

/**
 * Honour-board categories — shared reactive state so the CRM sidebar
 * badge, the honour-board view, and any future consumer all see the
 * same list. Fetches lazily per club id and caches the result.
 */
export const useHonourCategoriesStore = defineStore('honourCategories', () => {
  const items = ref<HonourCategory[]>([])
  const loadedClubId = ref<number | null>(null)
  const loading = ref(false)

  const count = computed(() => items.value.length)

  async function fetch(clubId: number, opts: { force?: boolean } = {}): Promise<HonourCategory[]> {
    if (!opts.force && loadedClubId.value === clubId) return items.value
    loading.value = true
    try {
      items.value = await honourBoard.listCategories(clubId)
      loadedClubId.value = clubId
      return items.value
    } catch {
      items.value = []
      loadedClubId.value = null
      return items.value
    } finally {
      loading.value = false
    }
  }

  function replaceAll(next: HonourCategory[]): void {
    items.value = [...next]
  }

  function upsert(c: HonourCategory): void {
    const idx = items.value.findIndex((x) => x.category_id === c.category_id)
    if (idx >= 0) items.value.splice(idx, 1, c)
    else items.value.push(c)
  }

  function remove(categoryId: number): void {
    items.value = items.value.filter((c) => c.category_id !== categoryId)
  }

  function clear(): void {
    items.value = []
    loadedClubId.value = null
  }

  return { items, count, loading, loadedClubId, fetch, replaceAll, upsert, remove, clear }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useHonourCategoriesStore, import.meta.hot))
}
