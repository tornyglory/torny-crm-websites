/**
 * Global modal state for the `account_suspended` block — brief 123 §6.3.
 *
 * Any mutating CRM handler hitting a suspended club returns:
 *   HTTP 409  { code: "account_suspended", message: "..." }
 *
 * On app boot, `registerApiErrorObserver(onApiError)` (see `main.ts`)
 * routes those errors here. The AccountSuspendedModal component watches
 * `visible` and renders a blocking overlay with a "Contact support" CTA.
 *
 * Module-scoped ref is deliberate — one modal per app, not per component
 * instance. The modal and the suspension-trigger site must share state.
 */
import { ref, readonly } from 'vue'
import { ApiError } from '@torny/api-client'

interface SuspendedState {
  visible: boolean
  /** Server-provided message — usually "This account is suspended.
   *  Contact Torny support for assistance." but render as-is in case
   *  the backend starts adding per-club context (e.g. a case number). */
  message: string
}

const state = ref<SuspendedState>({ visible: false, message: '' })

/** ApiError observer — registered once on app boot. Any error with
 *  `code === 'account_suspended'` triggers the modal. */
export function onApiError(err: ApiError): void {
  if (err.code !== 'account_suspended') return
  state.value = {
    visible: true,
    message: err.message || 'This account is suspended. Contact Torny support for assistance.',
  }
}

export function useAccountSuspendedModal() {
  function close() {
    state.value = { visible: false, message: '' }
  }
  return {
    state: readonly(state),
    close,
  }
}
