<script setup lang="ts">
/**
 * Public email-change confirmation page.
 *
 * The user clicks the link in the confirmation email → lands here with
 * the signed token in the URL. We POST it to brief 71 §3's public
 * `/me/email-change/confirm` endpoint (no auth required — the token
 * itself proves identity).
 *
 * Confirming invalidates every live session for the user (token_version
 * bump), including whichever one may have requested the change. If the
 * current browser happens to be signed in to that account, we clear the
 * local session too so the next action redirects to sign-in cleanly.
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { auth as authApi, AuthError } from '@torny/api-client'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

type ViewState = 'confirming' | 'success' | 'error'
const state = ref<ViewState>('confirming')
const confirmedEmail = ref<string | null>(null)
const confirmedAt = ref<string | null>(null)
const errorCode = ref<string | null>(null)
const errorMessage = ref<string | null>(null)

const token = computed(() => String(route.params.token ?? ''))

const errorHeadline = computed(() => {
  switch (errorCode.value) {
    case 'token_expired':    return 'This link expired'
    case 'token_superseded': return 'This link was replaced'
    case 'token_invalid':    return 'This link isn\'t valid'
    case 'email_in_use':     return 'That email is now taken'
    case 'user_not_found':   return 'Account not found'
    default:                 return 'We couldn\'t confirm this change'
  }
})

const errorBody = computed(() => {
  switch (errorCode.value) {
    case 'token_expired':
      return 'Confirmation links expire after 7 days. Start a new email change from your account page.'
    case 'token_superseded':
      return 'A newer confirmation link was issued after this one. Check your inbox for the most recent email.'
    case 'token_invalid':
      return 'The link may have been truncated. Try clicking it again from your email, or request a new change.'
    case 'email_in_use':
      return 'Someone else claimed this address while your change was pending. Request a new change to a different address.'
    case 'user_not_found':
      return 'The account tied to this link no longer exists.'
    default:
      return errorMessage.value || 'Try the link again from your email, or request a new change from your account.'
  }
})

async function confirm() {
  if (!token.value) {
    state.value = 'error'
    errorCode.value = 'token_invalid'
    return
  }
  state.value = 'confirming'
  try {
    const res = await authApi.confirmEmailChange(token.value)
    confirmedEmail.value = res.email
    confirmedAt.value = res.confirmed_at
    state.value = 'success'
    // Current session's JWT dies inside the ~5 min authorizer cache window.
    // If we're the signed-in user, kill local state now so the next
    // guarded navigation lands cleanly on sign-in.
    if (authStore.user?.email && authStore.user.email !== res.email) {
      // Not the same user — safe to leave the local session alone.
    } else {
      authStore.clearSession()
    }
  } catch (err) {
    state.value = 'error'
    if (err instanceof AuthError) {
      errorCode.value = err.code ?? null
      errorMessage.value = err.message
    } else {
      errorCode.value = null
      errorMessage.value = err instanceof Error ? err.message : 'Something went wrong.'
    }
  }
}

onMounted(() => { void confirm() })

function goSignIn() { router.push({ name: 'sign-in' }) }
function goAccount() { router.push({ name: 'account' }) }
</script>

<template>
  <div class="confirm">
    <div class="confirm__card">
      <!-- Confirming -->
      <template v-if="state === 'confirming'">
        <div class="confirm__spinner" aria-hidden="true">
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="14" stroke="rgba(10,10,11,0.1)" stroke-width="3"/>
            <path d="M18 4a14 14 0 0 1 14 14" stroke="var(--color-ink)" stroke-width="3" stroke-linecap="round"/>
          </svg>
        </div>
        <h1 class="confirm__title">Confirming your email…</h1>
        <p class="confirm__sub">Just a moment while we switch your account over.</p>
      </template>

      <!-- Success -->
      <template v-else-if="state === 'success'">
        <div class="confirm__check" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="18" fill="#DCFCE7"/>
            <path d="M13 20l5 5 10-10" stroke="#166534" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h1 class="confirm__title">Email confirmed</h1>
        <p class="confirm__sub">
          Your Torny account now uses <strong class="confirm__email">{{ confirmedEmail }}</strong>.
          Any other devices signed in to this account were signed out — use the new email to sign back in.
        </p>
        <button type="button" class="confirm__btn confirm__btn--ink" @click="goSignIn">Sign in</button>
      </template>

      <!-- Error -->
      <template v-else>
        <div class="confirm__cross" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="18" fill="#FEE2E2"/>
            <path d="M14 14l12 12M26 14L14 26" stroke="#DC2F3B" stroke-width="2.5" stroke-linecap="round"/>
          </svg>
        </div>
        <h1 class="confirm__title">{{ errorHeadline }}</h1>
        <p class="confirm__sub">{{ errorBody }}</p>
        <div class="confirm__actions">
          <button type="button" class="confirm__btn confirm__btn--ghost" @click="goSignIn">Sign in</button>
          <button type="button" class="confirm__btn confirm__btn--ink" @click="goAccount">Go to account</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.confirm {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 20px;
  background: var(--color-surface);
}
.confirm__card {
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 20px;
  padding: 48px 40px;
  max-width: 460px;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  text-align: center;
}
.confirm__spinner { animation: confirm__spin 0.8s linear infinite; display: inline-flex; }
@keyframes confirm__spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
.confirm__check,
.confirm__cross { display: inline-flex; }
.confirm__title {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--color-ink);
  margin: 0;
  line-height: 1.15;
}
.confirm__sub {
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-fog);
  margin: 0;
  max-width: 380px;
}
.confirm__sub strong { color: var(--color-ink); }
.confirm__email { font-family: var(--font-mono); font-size: 13px; }
.confirm__actions { display: flex; gap: 10px; margin-top: 8px; flex-wrap: wrap; justify-content: center; }
.confirm__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 140px;
  height: 40px;
  padding: 0 20px;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--color-hairline);
  background: #fff;
  color: var(--color-ink);
  margin-top: 8px;
}
.confirm__btn--ghost:hover { background: var(--color-surface); }
.confirm__btn--ink {
  background: var(--color-ink);
  color: #fff;
  border-color: var(--color-ink);
}
.confirm__btn--ink:hover { background: var(--color-graphite); }
</style>
