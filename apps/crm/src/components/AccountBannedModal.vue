<script setup lang="ts">
/**
 * Blocking modal shown when any API call returns `account_banned`
 * (brief 126 §6.3). Mounted once at the CrmShell root alongside
 * AccountSuspendedModal so every route inherits it.
 *
 * Deliberately only shows a "Contact support" + "Sign out" pair. The
 * user is signed out of all practical functionality server-side; we
 * make the local state match.
 */
import { useAccountBannedModal } from '@/composables/useAccountBannedModal'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'

const { state } = useAccountBannedModal()
const auth = useAuthStore()
const router = useRouter()

function signOut() {
  auth.clearSession()
  void router.push({ name: 'sign-in' })
}
</script>

<template>
  <Teleport to="body">
    <div v-if="state.visible" class="banned-overlay" role="alertdialog" aria-labelledby="banned-title" aria-modal="true">
      <div class="banned-modal">
        <div class="banned-modal__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="28" height="28">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
        </div>
        <h2 id="banned-title" class="banned-modal__title">Account suspended</h2>
        <p class="banned-modal__body">{{ state.message }}</p>
        <p class="banned-modal__detail">
          Every Torny action requires an active account. Contact Torny support if you believe this is an error.
        </p>
        <div class="banned-modal__actions">
          <a href="mailto:hello@torny.pro?subject=Banned%20account" class="banned-modal__btn banned-modal__btn--primary">
            Contact support
          </a>
          <button type="button" class="banned-modal__btn" @click="signOut">
            Sign out
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.banned-overlay {
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

.banned-modal {
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

.banned-modal__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: color-mix(in oklab, var(--color-danger) 12%, #fff);
  color: var(--color-danger);
}

.banned-modal__title {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--color-ink);
  margin: 4px 0 0;
}

.banned-modal__body { font-family: var(--font-body); font-size: 15px; color: var(--color-graphite); line-height: 1.5; margin: 0; }
.banned-modal__detail { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); line-height: 1.5; margin: 0; }

.banned-modal__actions {
  display: flex;
  gap: 10px;
  margin-top: 12px;
  flex-wrap: wrap;
  justify-content: center;
}

.banned-modal__btn {
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
.banned-modal__btn:hover { background: var(--color-hairline); }
.banned-modal__btn--primary { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.banned-modal__btn--primary:hover { background: #000; }
</style>
