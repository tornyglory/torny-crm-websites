/**
 * Pages store — sidebar list for the website editor.
 *
 * One list per active club. Every mutation (create / rename / reslug /
 * reorder / delete) refetches so ordering + `is_published` +
 * `has_unpublished_changes` stay authoritative.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { pages as pagesApi, ApiError, type Page } from '@torny/api-client'
import { useClubStore } from './club'

export const usePagesStore = defineStore('pages', () => {
  const club = useClubStore()

  const pages = ref<Page[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** Which club the current `pages[]` was loaded for — so we can guard
   *  against showing another club's list after a switch. */
  const loadedClubId = ref<number | null>(null)

  const systemPages = computed(() => pages.value.filter((p) => p.is_system))
  const customPages = computed(() => pages.value.filter((p) => !p.is_system))
  const byPosition = computed(() =>
    [...pages.value].sort((a, b) => a.position - b.position || a.id - b.id),
  )

  async function load(): Promise<void> {
    const cid = club.current?.id
    if (cid == null) {
      pages.value = []
      loadedClubId.value = null
      return
    }
    loading.value = true
    error.value = null
    try {
      pages.value = await pagesApi.list(cid)
      loadedClubId.value = cid
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load pages'
      pages.value = []
      loadedClubId.value = null
    } finally {
      loading.value = false
    }
  }

  async function create(input: { slug: string; title: string }): Promise<Page> {
    const cid = club.current?.id
    if (cid == null) throw new Error('No active club')
    const created = await pagesApi.create(cid, input)
    await load()
    return created
  }

  async function rename(slug: string, patch: { title?: string; slug?: string; position?: number }): Promise<{ slug: string; warnings?: string[] }> {
    const cid = club.current?.id
    if (cid == null) throw new Error('No active club')
    const res = await pagesApi.updatePage(cid, slug, patch)
    await load()
    return { slug: res.pageSlug, warnings: res.warnings }
  }

  async function remove(slug: string): Promise<void> {
    const cid = club.current?.id
    if (cid == null) throw new Error('No active club')
    await pagesApi.remove(cid, slug)
    await load()
  }

  /** Look up a page by slug — reads from the cache; no fetch. */
  function findBySlug(slug: string): Page | null {
    return pages.value.find((p) => p.slug === slug) ?? null
  }

  /** Human-friendly message for the create/rename error codes. */
  function messageForError(err: unknown, context: 'create' | 'rename' = 'create'): string {
    if (err instanceof ApiError && err.code) {
      switch (err.code) {
        case 'bad_slug':
          return 'That slug isn\'t valid — use lowercase letters, digits, and hyphens only.'
        case 'reserved_slug':
          return 'That slug is reserved for the platform. Pick another.'
        case 'slug_conflict':
          return 'Another page on this club already uses that slug.'
        case 'bad_title':
          return 'Titles need to be 1–80 characters.'
        case 'system_slug_locked':
          return 'This is a system page — you can rename it, but the URL slug is locked.'
        case 'too_many_pages':
          return 'You\'ve hit the 50-page cap. Delete an unused page first.'
        case 'not_found':
          return 'That page no longer exists.'
      }
    }
    return err instanceof Error ? err.message : `Couldn\'t ${context} the page.`
  }

  return {
    pages,
    loading,
    error,
    loadedClubId,
    systemPages,
    customPages,
    byPosition,
    load,
    create,
    rename,
    remove,
    findBySlug,
    messageForError,
  }
})
