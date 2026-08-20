// Debounced member search — reads the club roster endpoint via the
// api-client. See `packages/api-client/src/resources/members.ts` and
// docs/backend-briefs/member-search-brief.md for the contract.
//
// Owns four bits of state:
//   query    — v-model target for the input
//   results  — the last fetched members[] array (empty when idle)
//   loading  — true while a debounced fetch is pending or in flight
//   error    — last error message, or null
//
// The composable requires ≥2 characters, debounces 300ms, and aborts
// the previous request whenever a newer query arrives so callers never
// see stale results.

import { ref, watch, type Ref } from 'vue'
import { members as membersApi, type RosterMember } from '@torny/api-client'

export interface UseMemberSearchOptions {
  /** Filter to a specific lifecycle bucket. Default: `all`. */
  status?: 'all' | 'active' | 'pending' | 'lapsed'
  /** Filter to a CRM role. */
  role?: 'owner' | 'admin' | 'committee' | 'player'
  /** Max results per request. Default: 10 for typeahead, raise for full-page. */
  limit?: number
  /** Debounce window in ms. Default: 300. */
  debounceMs?: number
  /** Minimum query length before firing. Default: 2. */
  minChars?: number
  /**
   * Include the pending-invites block in the response. The roster
   * endpoint always returns `members[]`, so this only affects consumers
   * that read `pending_invites`. Default: false (typeahead usage).
   */
  includeInvites?: boolean
}

export interface UseMemberSearch {
  query: Ref<string>
  results: Ref<RosterMember[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  /** Force-refetch with the current query. Rare — use for retry buttons. */
  refresh: () => void
  /** Clear the query and any pending fetch. */
  reset: () => void
}

export function useMemberSearch(
  clubId: Ref<number | null> | (() => number | null),
  options: UseMemberSearchOptions = {},
): UseMemberSearch {
  const {
    status = 'all',
    role,
    limit = 10,
    debounceMs = 300,
    minChars = 2,
    includeInvites = false,
  } = options

  const query = ref('')
  const results = ref<RosterMember[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  let timer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null

  function resolveClubId(): number | null {
    return typeof clubId === 'function' ? clubId() : clubId.value
  }

  async function fire(q: string) {
    const cid = resolveClubId()
    if (cid == null) {
      loading.value = false
      return
    }
    // Newer query supersedes any in-flight request.
    if (controller) controller.abort()
    controller = new AbortController()
    error.value = null
    loading.value = true
    try {
      const res = await membersApi.listRoster(
        cid,
        {
          search: q,
          limit,
          status,
          role,
          include_invites: includeInvites,
        },
        { signal: controller.signal },
      )
      results.value = res.members
    } catch (err) {
      // Ignore aborts — they only fire when a newer query landed.
      if (err instanceof DOMException && err.name === 'AbortError') return
      results.value = []
      error.value = err instanceof Error ? err.message : 'Search failed'
    } finally {
      loading.value = false
    }
  }

  function schedule(q: string) {
    if (timer) clearTimeout(timer)
    if (q.trim().length < minChars) {
      // Stop pending work and clear results — the caller usually falls
      // back to a roster view when the query is short.
      if (controller) controller.abort()
      results.value = []
      loading.value = false
      error.value = null
      return
    }
    loading.value = true
    timer = setTimeout(() => {
      void fire(q.trim())
    }, debounceMs)
  }

  watch(query, (next) => {
    schedule(next)
  })

  return {
    query,
    results,
    loading,
    error,
    refresh: () => {
      if (query.value.trim().length >= minChars) {
        void fire(query.value.trim())
      }
    },
    reset: () => {
      if (timer) clearTimeout(timer)
      if (controller) controller.abort()
      query.value = ''
      results.value = []
      loading.value = false
      error.value = null
    },
  }
}
