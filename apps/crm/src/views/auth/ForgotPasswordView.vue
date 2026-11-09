<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { auth as authApi, AuthError } from '@torny/api-client'
import CrmSpinner from '@/components/CrmSpinner.vue'

const email = ref('')
const submitting = ref(false)
const resending = ref(false)
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
    // Backend doesn't leak whether the email exists — show the sent state
    // unless we hit a server-side problem.
    if (err instanceof AuthError && err.status >= 500) {
      error.value = 'Something went wrong. Please try again.'
    } else {
      sent.value = true
    }
  } finally {
    submitting.value = false
  }
}

async function resend() {
  resending.value = true
  error.value = null
  try {
    await authApi.requestPasswordReset(email.value.trim(), { baseURL: API_BASE })
  } catch (err) {
    if (err instanceof AuthError && err.status >= 500) {
      error.value = 'Something went wrong. Please try again.'
    }
  } finally {
    resending.value = false
  }
}

function tryAnother() {
  sent.value = false
  error.value = null
}
</script>

<template>
  <div class="auth-page">
    <!-- Request state -->
    <template v-if="!sent">
      <header class="auth-page__header">
        <h1 class="auth-page__title">Reset your password</h1>
        <p class="auth-page__sub">Enter the email you signed up with and we'll ping a reset link.</p>
      </header>

      <form class="auth-page__card" @submit="submit" novalidate>
        <div class="auth-field">
          <label for="forgot-email" class="auth-field__label">Email</label>
          <div class="auth-field__wrap">
            <input
              id="forgot-email"
              v-model="email"
              class="auth-field__input"
              type="email"
              required
              autocomplete="email"
              autofocus
              placeholder="you@yourclub.co.nz"
            />
          </div>
        </div>

        <div v-if="error" class="auth-alert">{{ error }}</div>

        <button type="submit" class="auth-btn" :disabled="submitting || !canSubmit">
          <span>{{ submitting ? 'Sending…' : 'Send reset link' }}</span>
          <CrmSpinner v-if="submitting" size="sm" label="Sending reset link" />
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </button>

        <div class="auth-switch">
          Remembered it? <RouterLink to="/">Sign in →</RouterLink>
        </div>
      </form>
    </template>

    <!-- Sent state -->
    <template v-else>
      <header class="auth-page__header">
        <h1 class="auth-page__title">Check your inbox</h1>
        <p class="auth-page__sub">
          We just sent a reset link to <strong class="fp__email">{{ email }}</strong>. It expires in 30 minutes.
        </p>
      </header>

      <div class="auth-page__card">
        <div class="auth-check">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>

        <div v-if="error" class="auth-alert">{{ error }}</div>

        <button type="button" class="auth-btn auth-btn--ghost" :disabled="resending" @click="resend">
          <span>{{ resending ? 'Resending…' : 'Resend link' }}</span>
          <CrmSpinner v-if="resending" size="sm" label="Resending" />
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </button>

        <div class="auth-switch">
          Wrong email? <button type="button" class="fp__linklike" @click="tryAnother">Try another →</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.fp__email {
  font-family: var(--font-body);
  color: #fff;
  font-weight: 600;
}
.fp__linklike {
  background: transparent;
  border: 0;
  padding: 0;
  font-family: var(--font-body);
  font-size: 13px;
  color: #0A0A0B;
  font-weight: 600;
  cursor: pointer;
}
.fp__linklike:hover { text-decoration: underline; }
</style>
