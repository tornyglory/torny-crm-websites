<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import { auth as authApi, AuthError } from '@torny/api-client'

const router = useRouter()
const route = useRoute()

const token = ref('')
const password = ref('')
const confirm = ref('')
const showPassword = ref(false)
const submitting = ref(false)
const done = ref(false)
const error = ref<string | null>(null)

const API_BASE = import.meta.env.VITE_SAM_BASE_URL

onMounted(() => {
  const t = route.query.token
  if (typeof t === 'string') token.value = t
})

const hasMinLength = computed(() => password.value.length >= 10)
const hasLetter = computed(() => /[a-zA-Z]/.test(password.value))
const hasNumber = computed(() => /\d/.test(password.value))
const passwordOk = computed(() => hasMinLength.value && hasLetter.value && hasNumber.value)

type Strength = 'none' | 'weak' | 'mid' | 'strong'
const strength = computed<Strength>(() => {
  if (password.value.length === 0) return 'none'
  const checks = [hasMinLength.value, hasLetter.value, hasNumber.value, password.value.length >= 14]
  const score = checks.filter(Boolean).length
  if (score <= 1) return 'weak'
  if (score === 2) return 'mid'
  return 'strong'
})
const strengthLabel = computed(() => {
  switch (strength.value) {
    case 'strong': return 'Strong'
    case 'mid':    return 'Decent'
    case 'weak':   return 'Weak'
    default:       return 'Too short'
  }
})
const strengthBars = computed(() => {
  switch (strength.value) {
    case 'strong': return [true, true, true, true]
    case 'mid':    return [true, true, true, false]
    case 'weak':   return [true, true, false, false]
    default:       return [false, false, false, false]
  }
})

const confirmMatches = computed(
  () => confirm.value.length > 0 && confirm.value === password.value,
)
const confirmMismatch = computed(
  () => confirm.value.length > 0 && confirm.value !== password.value,
)

const canSubmit = computed(
  () => token.value.length > 0 && passwordOk.value && confirmMatches.value,
)

async function submit(e: Event) {
  e.preventDefault()
  if (!canSubmit.value) return
  submitting.value = true
  error.value = null
  try {
    await authApi.resetPassword(token.value, password.value, { baseURL: API_BASE })
    done.value = true
    setTimeout(() => router.push('/'), 2000)
  } catch (err) {
    if (err instanceof AuthError) {
      error.value = err.status === 400 || err.status === 401
        ? 'This reset link is invalid or has expired. Request a new one.'
        : err.message
    } else {
      error.value = (err as Error).message
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <header class="auth-page__header">
      <h1 class="auth-page__title">Set a fresh password</h1>
      <p class="auth-page__sub">Pick something strong — 10+ characters, with a letter and a number.</p>
    </header>

    <!-- Done state -->
    <div v-if="done" class="auth-page__card">
      <div class="auth-check">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>
      <p class="rp__done">Password updated — redirecting to sign-in…</p>
    </div>

    <!-- Missing token -->
    <div v-else-if="!token" class="auth-page__card">
      <div class="auth-alert">
        No reset token in this link.
        <RouterLink to="/forgot-password" class="rp__alert-link">Request a new one →</RouterLink>
      </div>
    </div>

    <!-- Form -->
    <form v-else class="auth-page__card" @submit="submit" novalidate>
      <!-- New password -->
      <div class="auth-field">
        <label for="reset-password" class="auth-field__label">New password</label>
        <div class="auth-field__wrap">
          <input
            id="reset-password"
            v-model="password"
            class="auth-field__input auth-field__input--eye"
            :type="showPassword ? 'text' : 'password'"
            required
            autocomplete="new-password"
            autofocus
          />
          <button
            type="button"
            class="auth-field__eye"
            :aria-label="showPassword ? 'Hide password' : 'Show password'"
            @click="showPassword = !showPassword"
          >
            <svg v-if="!showPassword" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
              <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
              <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
              <line x1="2" x2="22" y1="2" y2="22" />
            </svg>
          </button>
        </div>

        <!-- Strength meter -->
        <div class="auth-strength">
          <div class="auth-strength__bars">
            <div
              v-for="(on, i) in strengthBars"
              :key="i"
              class="auth-strength__bar"
              :class="on ? {
                'auth-strength__bar--on': strength === 'strong',
                'auth-strength__bar--mid': strength === 'mid',
                'auth-strength__bar--weak': strength === 'weak',
              } : {}"
            />
          </div>
          <span
            class="auth-strength__label"
            :class="{
              'auth-strength__label--weak': strength === 'weak',
              'auth-strength__label--mid': strength === 'mid',
              'auth-strength__label--none': strength === 'none',
            }"
          >{{ strengthLabel }}</span>
        </div>
      </div>

      <!-- Confirm password -->
      <div class="auth-field">
        <label for="reset-confirm" class="auth-field__label">Confirm password</label>
        <div class="auth-field__wrap">
          <input
            id="reset-confirm"
            v-model="confirm"
            class="auth-field__input"
            :class="{ 'auth-field__input--check': confirmMatches || confirmMismatch }"
            :type="showPassword ? 'text' : 'password'"
            required
            autocomplete="new-password"
          />
          <span v-if="confirmMatches" class="auth-field__inline-ok">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            Matches
          </span>
          <span v-else-if="confirmMismatch" class="auth-field__inline-bad">No match</span>
        </div>
      </div>

      <div v-if="error" class="auth-alert">{{ error }}</div>

      <button type="submit" class="auth-btn" :disabled="submitting || !canSubmit">
        <span>{{ submitting ? 'Saving…' : 'Save & sign in' }}</span>
        <svg v-if="!submitting" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      </button>

      <div class="auth-switch">
        Changed your mind? <RouterLink to="/">Back to sign in →</RouterLink>
      </div>
    </form>
  </div>
</template>

<style scoped>
.rp__done {
  font-family: var(--font-body);
  font-size: 14px;
  text-align: center;
  color: #0A0A0B;
  margin: 0;
}
.rp__alert-link {
  color: #991B1B;
  font-weight: 600;
  text-decoration: underline;
}
</style>
