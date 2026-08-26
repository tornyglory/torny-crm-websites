import { defineStore, acceptHMRUpdate } from 'pinia'
import { computed, ref } from 'vue'
import {
  notifications as notificationsApi,
  ApiError,
  type Notification,
  type NotificationKind,
  type NotificationSettings,
  type NotificationSettingsPatch,
  type ListNotificationsParams,
} from '@torny/api-client'

/**
 * Notifications — backs the bell dropdown in the CRM top bar. Reads brief
 * 40's endpoints via the api-client resource.
 *
 * Polling model: we only poll the cheap `unread-count` endpoint (once per
 * 60s while the tab is visible). The rich list refetches when the user
 * opens the dropdown or switches tab. Mutations (markRead, markAllRead)
 * update local state optimistically and reconcile with the response.
 */
export const useNotificationsStore = defineStore('notifications', () => {
  // ── State ──────────────────────────────────────────────────────
  const rows = ref<Notification[]>([])
  const unreadCount = ref(0)
  const hasMore = ref(false)
  const activeTab = ref<'all' | 'unread'>('all')
  const loading = ref(false)
  const loadedClubId = ref<number | null>(null)
  const settings = ref<NotificationSettings | null>(null)
  const settingsLoading = ref(false)
  const settingsSaving = ref(false)

  // Poll timer + Page Visibility handling.
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let visibilityHandler: (() => void) | null = null
  const POLL_INTERVAL_MS = 60_000

  // Abort controllers so we don't leak requests when the club flips.
  let listAbort: AbortController | null = null
  let countAbort: AbortController | null = null

  const filteredRows = computed<Notification[]>(() =>
    activeTab.value === 'unread' ? rows.value.filter((r) => r.unread) : rows.value,
  )

  // ── Fetching ───────────────────────────────────────────────────
  async function fetchList(clubId: number, params: ListNotificationsParams = {}): Promise<void> {
    if (listAbort) listAbort.abort()
    listAbort = new AbortController()
    loading.value = true
    try {
      const res = await notificationsApi.list(
        clubId,
        { tab: activeTab.value, limit: 25, ...params },
        { signal: listAbort.signal },
      )
      rows.value = res.notifications
      unreadCount.value = res.unread_count
      hasMore.value = res.has_more
      loadedClubId.value = clubId
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchUnreadCount(clubId: number): Promise<void> {
    if (countAbort) countAbort.abort()
    countAbort = new AbortController()
    try {
      const res = await notificationsApi.unreadCount(clubId, { signal: countAbort.signal })
      unreadCount.value = res.unread_count
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      // Rate-limit: brief 40 §11 says it's disabled for now but be defensive.
      if (err instanceof ApiError && err.status === 429) return
      // Silent — bell polling should never toast.
    }
  }

  // ── Mutations ─────────────────────────────────────────────────
  async function markRead(clubId: number, id: number): Promise<void> {
    // Optimistic — flip the row immediately.
    const row = rows.value.find((r) => r.id === id)
    if (row && row.unread) {
      row.unread = false
      unreadCount.value = Math.max(0, unreadCount.value - 1)
    }
    try {
      const res = await notificationsApi.markRead(clubId, id)
      unreadCount.value = res.unread_count
    } catch (err) {
      // Rollback on failure.
      if (row) row.unread = true
      throw err
    }
  }

  async function markAllRead(clubId: number, kinds?: NotificationKind[]): Promise<number> {
    const res = await notificationsApi.markAllRead(clubId, kinds && kinds.length > 0 ? { kinds } : {})
    // Local state — flip everything (or the subset).
    for (const r of rows.value) {
      if (kinds && kinds.length > 0) {
        if (kinds.includes(r.kind)) r.unread = false
      } else {
        r.unread = false
      }
    }
    unreadCount.value = res.unread_count
    return res.marked
  }

  function setTab(next: 'all' | 'unread') {
    if (activeTab.value === next) return
    activeTab.value = next
    // Refetch under the new filter — cheap and keeps things simple.
    if (loadedClubId.value != null) void fetchList(loadedClubId.value)
  }

  // ── Settings ──────────────────────────────────────────────────
  async function fetchSettings(): Promise<void> {
    if (settingsLoading.value) return
    settingsLoading.value = true
    try {
      settings.value = await notificationsApi.getSettings()
    } finally {
      settingsLoading.value = false
    }
  }

  async function saveSettings(patch: NotificationSettingsPatch): Promise<void> {
    settingsSaving.value = true
    try {
      settings.value = await notificationsApi.updateSettings(patch)
    } finally {
      settingsSaving.value = false
    }
  }

  // ── Polling ───────────────────────────────────────────────────
  function startPolling(clubId: number): void {
    stopPolling()
    // Fire once immediately so the badge is populated ASAP.
    void fetchUnreadCount(clubId)

    pollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void fetchUnreadCount(clubId)
    }, POLL_INTERVAL_MS)

    // When the tab returns from background, refresh immediately rather than
    // waiting for the next interval tick.
    if (typeof document !== 'undefined') {
      visibilityHandler = () => {
        if (document.visibilityState === 'visible') void fetchUnreadCount(clubId)
      }
      document.addEventListener('visibilitychange', visibilityHandler)
    }
  }

  function stopPolling(): void {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    if (visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
    }
  }

  function clear(): void {
    stopPolling()
    if (listAbort) listAbort.abort()
    if (countAbort) countAbort.abort()
    rows.value = []
    unreadCount.value = 0
    hasMore.value = false
    activeTab.value = 'all'
    loadedClubId.value = null
  }

  return {
    rows,
    filteredRows,
    unreadCount,
    hasMore,
    activeTab,
    loading,
    loadedClubId,
    settings,
    settingsLoading,
    settingsSaving,
    fetchList,
    fetchUnreadCount,
    markRead,
    markAllRead,
    setTab,
    fetchSettings,
    saveSettings,
    startPolling,
    stopPolling,
    clear,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useNotificationsStore, import.meta.hot))
}
