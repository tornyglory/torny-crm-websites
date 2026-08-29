import type { AuthUser } from '@torny/api-client'

/**
 * Signed-in Torny member state for the club-sites app.
 *
 * The portal at torny.co owns auth. On successful sign-in the backend sets
 * an HttpOnly cookie scoped to `.torny.co` — that cookie automatically flows
 * to every `<slug>.torny.co` subdomain, so club sites just have to ask "who
 * is this cookie?" via `GET /me` with `credentials: 'include'`.
 *
 * Usage:
 *   const { member, isSignedIn, pending, refresh } = useMember()
 *
 * SSR always returns `null` — the cookie could hit our nitro server on same-
 * origin requests, but for a static-generated / SWR-cached page the SSR pass
 * shouldn't personalise anything. Client hydration flips the state on mount.
 *
 * Cached in `useState` so multiple call sites share one fetch per page load.
 */
export function useMember() {
  const member = useState<AuthUser | null>('member', () => null)
  const pending = useState<boolean>('member-pending', () => false)
  const hydrated = useState<boolean>('member-hydrated', () => false)

  const config = useRuntimeConfig()

  async function refresh() {
    if (import.meta.server) return
    pending.value = true
    try {
      const base = (config.public.apiBaseUrl as string || '').replace(/\/$/, '')
      // If base is empty (backend cookie auth not wired yet) we can't fetch —
      // leave as null (guest). Everyone signs in via the portal until the
      // API lives on `api.torny.co` and CORS/cookies are configured.
      if (!base) {
        member.value = null
        return
      }
      const res = await $fetch<{ status?: string; data?: AuthUser }>(`${base}/me`, {
        credentials: 'include',
        // 401 is the expected "not signed in" state — swallow it.
        ignoreResponseError: true,
      })
      // Envelope shape: { status: 'success', data: AuthUser } on hit,
      // { status: 'error', ... } or missing data on miss.
      if (res && res.status === 'success' && res.data) {
        member.value = res.data
      } else {
        member.value = null
      }
    } catch {
      // Network error, CORS reject, cookie not present — treat as guest.
      member.value = null
    } finally {
      pending.value = false
      hydrated.value = true
    }
  }

  // Auto-hydrate once per page load. Subsequent calls to useMember() reuse
  // the cached state without re-fetching.
  if (import.meta.client && !hydrated.value && !pending.value) {
    // Fire-and-forget — callers can `await refresh()` if they need to gate on it.
    refresh()
  }

  const isSignedIn = computed(() => member.value !== null)
  const displayName = computed(() => member.value?.name ?? member.value?.email ?? null)
  const firstName = computed(() => {
    const n = member.value?.name
    if (!n) return null
    return n.split(/\s+/)[0]
  })

  const portalDashboardHref = computed(() => {
    const portal = (config.public.portalUrl as string || '').replace(/\/$/, '')
    return `${portal}/dashboard`
  })

  return {
    member: readonly(member),
    isSignedIn,
    pending: readonly(pending),
    displayName,
    firstName,
    portalDashboardHref,
    refresh,
  }
}
