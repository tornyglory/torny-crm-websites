/**
 * Impersonation session manager — brief 123 §6.1.
 *
 * Owns the 15-minute impersonation lifecycle AND the auth / club state
 * swap so the CRM behaves naturally during the session:
 *
 *   start(result, context):
 *     1. Snapshot the admin's current auth (token + user + current club)
 *        into sessionStorage so stop() can restore
 *     2. Swap the api-client Bearer override to the impersonation JWT
 *     3. Call /me with the new token → get the impersonated user's data
 *     4. auth.setSession(jwt, newUser) → overwrites the admin's identity
 *        in localStorage (router guards now see a non-admin owner and
 *        permit /crm navigation)
 *     5. club.syncFromUserClubs → ensures CrmShell has a current club
 *
 *   stop():
 *     1. Read the snapshot, auth.setSession back to the admin's values
 *     2. Restore the admin's current club
 *     3. Clear the Bearer override + the impersonation record
 *
 *   restore():
 *     Called at app boot. The impersonated user's data is ALREADY in
 *     localStorage (from the setSession during start), so the auth
 *     store self-rehydrates to them. All we need to do here is
 *     rearm the sessionStorage-backed Bearer override + expiry timer.
 *
 * Why a snapshot instead of a /me re-fetch on stop: if the backend call
 * fails mid-stop (network blip, impersonation JWT already expired), we
 * must still restore the admin's session. Snapshot makes that a
 * synchronous local operation.
 */
import { ref, computed, readonly } from 'vue'
import {
  claims as claimsApi,
  setImpersonationToken,
  TOKEN_STORAGE_KEY,
  type AdminImpersonateResult,
} from '@torny/api-client'
import { useAuthStore, fromApiUser, type AuthUser } from '@/stores/auth'
import { useClubStore } from '@/stores/club'

const SESSION_KEY = 'torny.impersonation'
const SNAPSHOT_KEY = 'torny.impersonation.admin_snapshot'
const USER_STORAGE_KEY = 'torny.user'
const CLUB_STORAGE_KEY = 'torny.currentClub'

interface Persisted {
  jwt: string
  expires_at: string
  account_id: number
  account_name: string
  user_email: string
  /** Where to return the admin after they exit. */
  return_path: string
}

interface AdminSnapshot {
  token: string
  user: AuthUser
  current_club_raw: string | null
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
    void stop()
    return
  }
  expiryTimer = setTimeout(() => void stop(), ms)
}

/** Activate an impersonation session with a freshly-minted JWT. */
export async function start(
  result: AdminImpersonateResult,
  context: { account_id: number; account_name: string; return_path: string },
): Promise<void> {
  const auth = useAuthStore()
  const club = useClubStore()

  // 1. Snapshot the admin's current identity BEFORE touching anything.
  //    All three reads are from localStorage directly so we don't depend
  //    on the store's in-memory values (which may differ post-hot-reload).
  const adminToken = localStorage.getItem(TOKEN_STORAGE_KEY)
  const adminUserRaw = localStorage.getItem(USER_STORAGE_KEY)
  if (!adminToken || !adminUserRaw) {
    throw new Error('Cannot impersonate — no active admin session to snapshot.')
  }
  const snapshot: AdminSnapshot = {
    token: adminToken,
    user: JSON.parse(adminUserRaw) as AuthUser,
    current_club_raw: localStorage.getItem(CLUB_STORAGE_KEY),
  }
  sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot))

  // 2. Swap the Bearer override so subsequent calls run as the target.
  setImpersonationToken(result.impersonation_jwt)

  // 3. Fetch the impersonated user via /me with the new token. The
  //    api-client returns its own AuthUser shape; convert via the
  //    store's `fromApiUser` to match the CRM's local AuthUser.
  const apiUser = await claimsApi.me()
  const newUser = fromApiUser(apiUser)

  // 4. Overwrite auth state with the target. setSession also writes
  //    localStorage, so a refresh mid-session rehydrates to the target.
  auth.setSession(result.impersonation_jwt, newUser)

  // 5. Sync the club store from the target's clubs. Prefers highest-tier
  //    membership (owner > admin > member); for a typical impersonation
  //    that'll be the account the admin picked.
  club.syncFromUserClubs(newUser.clubs)

  // 6. Persist the impersonation record so a refresh keeps the session
  //    and so the banner / exit button know what to show.
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
  scheduleExpiry(persisted.expires_at)
}

/** End the impersonation session. Idempotent — safe to call on cleanup. */
export async function stop(): Promise<void> {
  clearTimer()

  // Restore the admin's identity from the snapshot BEFORE clearing any
  // other state — if restore fails, we'd rather be stuck as impersonated
  // than signed out entirely.
  const snapshotRaw = sessionStorage.getItem(SNAPSHOT_KEY)
  if (snapshotRaw) {
    try {
      const snapshot = JSON.parse(snapshotRaw) as AdminSnapshot
      const auth = useAuthStore()
      const club = useClubStore()
      auth.setSession(snapshot.token, snapshot.user)
      if (snapshot.current_club_raw) {
        // Writing back to localStorage directly — the club store reads
        // it on next access + reactive consumers pick up the change via
        // setCurrent below.
        localStorage.setItem(CLUB_STORAGE_KEY, snapshot.current_club_raw)
        club.syncFromUserClubs(snapshot.user.clubs)
      } else {
        club.clear()
      }
    } catch {
      // Snapshot corrupted — leave localStorage alone, user will need
      // to sign in again. Still clear the impersonation record so the
      // banner goes away.
    }
  }

  state.value = null
  sessionStorage.removeItem(SESSION_KEY)
  sessionStorage.removeItem(SNAPSHOT_KEY)
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
      // Expired — clean everything up including the admin-snapshot so a
      // stale snapshot doesn't resurface on the next impersonation.
      sessionStorage.removeItem(SESSION_KEY)
      sessionStorage.removeItem(SNAPSHOT_KEY)
      return
    }
    state.value = persisted
    setImpersonationToken(persisted.jwt)
    scheduleExpiry(persisted.expires_at)
    // No auth / club swap here — localStorage already has the
    // impersonated user's data from the setSession during start().
  } catch {
    sessionStorage.removeItem(SESSION_KEY)
    sessionStorage.removeItem(SNAPSHOT_KEY)
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
