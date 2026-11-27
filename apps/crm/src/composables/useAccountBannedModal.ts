/**
 * Global modal state for the `account_banned` block — brief 126 §6.3.
 *
 * Any authenticated request from a banned user's JWT returns:
 *   HTTP 403  { code: "account_banned", message: "..." }
 *
 * Parallel to useAccountSuspendedModal from brief 123 §6.3 — same
 * pattern, different code, different copy. Sign-out button present
 * because the user is still technically signed in; the ban is
 * server-side and they need to know their session is dead.
 */
import { ref, readonly } from 'vue'
import { ApiError } from '@torny/api-client'

interface BannedState {
  visible: boolean
  message: string
}

const state = ref<BannedState>({ visible: false, message: '' })

/** ApiError observer — registered once on app boot. Any error with
 *  `code === 'account_banned'` triggers the modal. */
export function onApiError(err: ApiError): void {
  if (err.code !== 'account_banned') return
  state.value = {
    visible: true,
    message:
      err.message
      || 'Your Torny account has been suspended. Contact support if you believe this is an error.',
  }
}

export function useAccountBannedModal() {
  return {
    state: readonly(state),
  }
}
