/**
 * Impersonation session manager — brief 123 §6.1.
 *
 * Owns the 15-minute impersonation lifecycle:
 *   start()  → sets the Bearer token override on api-client,
 *              persists to sessionStorage so a refresh keeps it,
 *              starts the auto-exit timer
 *   stop()   → clears everything; caller navigates away
 *   restore()→ called at app boot; rehydrates from sessionStorage
 *              if an unexpired session exists (e.g. tab refresh)
 *
 * State lives in sessionStorage, not localStorage — tab-scoped and
 * cleared on tab close, which matches the admin's intent (short-lived
 * support session). Module-scoped refs are the single source of
 * truth for the UI (banner + CrmShell gating).
 */
import { ref, computed, readonly } from 'vue'
import { setImpersonationToken, type AdminImpersonateResult } from '@torny/api-client'

const SESSION_KEY = 'torny.impersonation'

interface Persisted {
  jwt: string
  expires_at: string
  account_id: number
  account_name: string
  user_email: string
  /** Where to return the admin after they exit. */
  return_path: string
}

const state = ref<Persisted | null>(null)
let expiryTimer: ReturnType<typeof setTimeout> | null = null

function clearTimer() {
  if (expiryTimer) {
    clearTimeout(expiryTimer)
    expiryTimer = null
  }
}

function scheduleExpiry(expiresAt: string) {
  clearTimer()
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) {
    stop()
    return
  }
  expiryTimer = setTimeout(() => stop(), ms)
}

/** Activate an impersonation session with a freshly-minted JWT. */
export function start(
  result: AdminImpersonateResult,
  context: { account_id: number; account_name: string; return_path: string },
) {
  const persisted: Persisted = {
    jwt: result.impersonation_jwt,
    expires_at: result.expires_at,
    account_id: context.account_id,
    account_name: context.account_name,
    user_email: result.impersonated_user_email,
    return_path: context.return_path,
  }
  state.value = persisted
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(persisted))
  setImpersonationToken(persisted.jwt)
  scheduleExpiry(persisted.expires_at)
}

/** End the impersonation session. Idempotent — safe to call on cleanup. */
export function stop() {
  clearTimer()
  state.value = null
  sessionStorage.removeItem(SESSION_KEY)
  setImpersonationToken(null)
}

/** Rehydrate from sessionStorage at app boot so a mid-session refresh
 *  keeps the impersonation active until the TTL expires. */
export function restore() {
  const raw = sessionStorage.getItem(SESSION_KEY)
  if (!raw) return
  try {
    const persisted = JSON.parse(raw) as Persisted
    const ms = new Date(persisted.expires_at).getTime() - Date.now()
    if (ms <= 0) {
      sessionStorage.removeItem(SESSION_KEY)
      return
    }
    state.value = persisted
    setImpersonationToken(persisted.jwt)
    scheduleExpiry(persisted.expires_at)
  } catch {
    sessionStorage.removeItem(SESSION_KEY)
  }
}

export function useImpersonation() {
  const isActive = computed(() => state.value !== null)
  return {
    state: readonly(state),
    isActive,
    start,
    stop,
  }
}
