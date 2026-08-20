<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { auth as authApi, AuthError } from '@torny/api-client'

const email = ref('')
const submitting = ref(false)
const sent = ref(false)
const error = ref<string | null>(null)

const API_BASE = import.meta.env.VITE_SAM_BASE_URL
const canSubmit = computed(() => /.+@.+\..+/.test(email.value.trim()))

async function submit(e: Event) {
  e.preventDefault()
  if (!canSubmit.value) return
  submitting.value = true
  error.value = null
  try {
    await authApi.requestPasswordReset(email.value.trim(), { baseURL: API_BASE })
    sent.value = true
  } catch (err) {
    // Backend does not leak whether an email exists — we show the same success
    // state on error unless it's a client-side / network failure.
    if (err instanceof AuthError && err.status >= 500) {
      error.value = 'Something went wrong. Please try again.'
    } else {
      sent.value = true
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="fp">
    <div class="fp__card">
      <div class="fp__eyebrow">Recover access</div>
      <h1 class="fp__heading">Reset your password</h1>

      <template v-if="!sent">
        <p class="fp__sub">Enter the email you use with Torny — we'll send you a link to set a new password.</p>
        <form class="form" @submit="submit">
          <label class="field">
            <span class="field__label">Email</span>
            <input v-model="email" type="email" required autocomplete="email" autofocus placeholder="you@club.co.nz" class="field__input" />
          </label>
          <button type="submit" class="submit" :disabled="submitting || !canSubmit">
            {{ submitting ? 'Sending…' : 'Send reset link' }}
          </button>
          <p v-if="error" class="alert">{{ error }}</p>
        </form>
      </template>

      <template v-else>
        <div class="sent">
          <div class="sent__badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h2 class="sent__title">Check your inbox</h2>
          <p class="sent__body">
            If <strong>{{ email }}</strong> is registered with Torny, we've sent a reset link.
            It's good for 24 hours.
          </p>
          <p class="sent__hint">Nothing yet? Check spam, or wait a minute and try again.</p>
        </div>
      </template>

      <div class="fp__foot">
        <RouterLink to="/" class="fp__link">← Back to sign in</RouterLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fp { flex: 1; background: var(--color-surface); padding: 60px 24px; display: flex; justify-content: center; }
.fp__card { width: 100%; max-width: 460px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 20px; box-shadow: var(--shadow-md); padding: 36px; display: flex; flex-direction: column; gap: 14px; height: fit-content; }
.fp__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.fp__heading { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: -4px 0 0; }
.fp__sub { font-family: var(--font-body); font-size: 13px; line-height: 1.55; color: var(--color-graphite); margin: 0; }

.form { display: flex; flex-direction: column; gap: 14px; margin-top: 6px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field__label { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.12em; color: var(--color-fog); text-transform: uppercase; }
.field__input { padding: 11px 14px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 14px; color: var(--color-ink); background: #fff; }
.field__input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }

.submit { padding: 13px 18px; background: var(--color-ink); color: #fff; border: none; border-radius: 12px; font-family: var(--font-body); font-size: 14px; font-weight: 600; cursor: pointer; }
.submit:disabled { opacity: 0.5; cursor: default; }

.alert { padding: 10px 12px; background: #FEE2E2; color: #991B1B; border-radius: 10px; font-family: var(--font-body); font-size: 13px; margin: 0; }

.sent { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 8px 0 0; }
.sent__badge { width: 44px; height: 44px; border-radius: 999px; background: var(--color-feature-mint); color: #fff; display: flex; align-items: center; justify-content: center; }
.sent__title { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--color-ink); margin: 4px 0 0; }
.sent__body { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); margin: 0; line-height: 1.55; }
.sent__body strong { color: var(--color-ink); font-weight: 600; }
.sent__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin: 0; }

.fp__foot { padding-top: 12px; border-top: 1px solid var(--color-hairline); margin-top: 4px; }
.fp__link { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); font-weight: 500; text-decoration: none; }
.fp__link:hover { text-decoration: underline; }
</style>
