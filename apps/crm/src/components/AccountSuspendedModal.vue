<script setup lang="ts">
/**
 * Blocking modal that appears whenever a CRM write hits a suspended
 * club — brief 123 §6.3. Mounted once at the CrmShell root so every
 * route inherits it.
 *
 * The modal is deliberately non-dismissable via the usual escape
 * hatches (no close X, no overlay click to close). The admin's only
 * options are: contact support (opens mailto:) or sign out (restores
 * the landing shell). Reason: letting the admin dismiss and keep
 * working creates the illusion of control they don't have — every
 * subsequent write will 409 anyway.
 */
import { useAccountSuspendedModal } from '@/composables/useAccountSuspendedModal'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'

const { state } = useAccountSuspendedModal()
const auth = useAuthStore()
const router = useRouter()

function signOut() {
  auth.clearSession()
  void router.push({ name: 'sign-in' })
}
</script>

<template>
  <Teleport to="body">
    <div v-if="state.visible" class="suspended-overlay" role="alertdialog" aria-labelledby="suspended-title" aria-modal="true">
      <div class="suspended-modal">
        <div class="suspended-modal__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="28" height="28">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h2 id="suspended-title" class="suspended-modal__title">Account suspended</h2>
        <p class="suspended-modal__body">{{ state.message }}</p>
        <p class="suspended-modal__detail">
          Read-only access to Settings is still available. Any changes you try to save will be rejected until Torny support reinstates the account.
        </p>
        <div class="suspended-modal__actions">
          <a href="mailto:hello@torny.pro?subject=Suspended%20account" class="suspended-modal__btn suspended-modal__btn--primary">
            Contact support
          </a>
          <button type="button" class="suspended-modal__btn" @click="signOut">
            Sign out
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.suspended-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(10, 10, 11, 0.6);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.suspended-modal {
  width: 100%;
  max-width: 440px;
  padding: 32px;
  background: var(--color-ground);
  border: 1px solid var(--color-hairline);
  border-radius: 16px;
  box-shadow: 0 20px 60px -20px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
}

.suspended-modal__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: color-mix(in oklab, var(--color-danger) 12%, #fff);
  color: var(--color-danger);
}

.suspended-modal__title {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--color-ink);
  margin: 4px 0 0;
}

.suspended-modal__body {
  font-family: var(--font-body);
  font-size: 15px;
  color: var(--color-graphite);
  line-height: 1.5;
  margin: 0;
}

.suspended-modal__detail {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-fog);
  line-height: 1.5;
  margin: 0;
}

.suspended-modal__actions {
  display: flex;
  gap: 10px;
  margin-top: 12px;
  flex-wrap: wrap;
  justify-content: center;
}

.suspended-modal__btn {
  padding: 10px 18px;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  background: var(--color-surface);
  color: var(--color-ink);
  border: 1px solid var(--color-hairline);
  border-radius: 999px;
  cursor: pointer;
  text-decoration: none;
}
.suspended-modal__btn:hover { background: var(--color-hairline); }
.suspended-modal__btn--primary {
  background: var(--color-ink);
  color: #fff;
  border-color: var(--color-ink);
}
.suspended-modal__btn--primary:hover { background: #000; }
</style>
