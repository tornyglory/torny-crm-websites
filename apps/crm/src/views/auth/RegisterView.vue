<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import { auth as authApi, AuthError } from '@torny/api-client'
import { useAuthStore, fromApiUser } from '@/stores/auth'
import { useClubStore } from '@/stores/club'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const club = useClubStore()

const firstName = ref('')
const lastName = ref('')
const email = ref('')
const password = ref('')
const showPassword = ref(false)
const submitting = ref(false)
const error = ref<string | null>(null)

const API_BASE = import.meta.env.VITE_SAM_BASE_URL

const emailOk = computed(() => /.+@.+\..+/.test(email.value.trim()))
const passwordOk = computed(
  () => password.value.length >= 10 && /[a-zA-Z]/.test(password.value) && /\d/.test(password.value),
)
const canSubmit = computed(
  () =>
    firstName.value.trim().length > 0 &&
    lastName.value.trim().length > 0 &&
    emailOk.value &&
    passwordOk.value,
)

async function submit(e: Event) {
  e.preventDefault()
  if (!canSubmit.value) return
  submitting.value = true
  error.value = null
  try {
    await authApi.register(
      {
        firstName: firstName.value.trim(),
        lastName: lastName.value.trim(),
        email: email.value.trim(),
        password: password.value,
      },
      { baseURL: API_BASE },
    )
    // Register doesn't return a session token today (brief 03 §2) — log in
    // immediately so the user lands on /claim authenticated.
    const { token, user: apiUser } = await authApi.login(
      email.value.trim(),
      password.value,
      { baseURL: API_BASE },
    )
    const user = fromApiUser(apiUser)
    auth.setSession(token, user)
    club.syncFromUserClubs(user.clubs)

    const redirect = (route.query.redirect as string | undefined) ?? '/claim'
    await router.push(redirect)
  } catch (err) {
    error.value = err instanceof AuthError ? err.message : (err as Error).message
  } finally {
    submitting.value = false
  }
}

function ssoNotice(provider: string) {
  error.value = `${provider} sign-up isn't wired up yet — use email instead.`
}
</script>

<template>
  <div class="auth-page">
    <header class="auth-page__header">
      <h1 class="auth-page__title">Start your 30-day trial</h1>
      <p class="auth-page__sub">No card, no setup fee. Live site + first bookings within two weeks.</p>
    </header>

    <form class="auth-page__card" @submit="submit" novalidate>
      <!-- First + last name -->
      <div class="register__names">
        <div class="auth-field">
          <label for="register-first" class="auth-field__label">First name</label>
          <div class="auth-field__wrap">
            <input
              id="register-first"
              v-model="firstName"
              class="auth-field__input"
              type="text"
              required
              autocomplete="given-name"
              autofocus
            />
          </div>
        </div>
        <div class="auth-field">
          <label for="register-last" class="auth-field__label">Last name</label>
          <div class="auth-field__wrap">
            <input
              id="register-last"
              v-model="lastName"
              class="auth-field__input"
              type="text"
              required
              autocomplete="family-name"
            />
          </div>
        </div>
      </div>

      <!-- Email -->
      <div class="auth-field">
        <label for="register-email" class="auth-field__label">Email</label>
        <div class="auth-field__wrap">
          <input
            id="register-email"
            v-model="email"
            class="auth-field__input"
            type="email"
            required
            autocomplete="email"
            placeholder="you@yourclub.co.nz"
          />
        </div>
      </div>

      <!-- Password -->
      <div class="auth-field">
        <label for="register-password" class="auth-field__label">Password</label>
        <div class="auth-field__wrap">
          <input
            id="register-password"
            v-model="password"
            class="auth-field__input auth-field__input--eye"
            :type="showPassword ? 'text' : 'password'"
            required
            autocomplete="new-password"
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
        <p class="register__hint">10+ characters with at least one letter and one number.</p>
      </div>

      <div v-if="error" class="auth-alert">{{ error }}</div>

      <button type="submit" class="auth-btn" :disabled="!canSubmit || submitting">
        <span>{{ submitting ? 'Creating account…' : 'Create account' }}</span>
        <svg v-if="!submitting" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      </button>

      <!-- OR divider -->
      <div class="auth-or">OR</div>

      <!-- SSO row -->
      <div class="auth-sso">
        <button type="button" class="auth-sso-btn" aria-label="Sign up with Google" @click="ssoNotice('Google')">
          <svg width="20" height="20" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <path d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C33.9 6.1 29.2 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.3-.4-3.5z" fill="#FFC107"/>
            <path d="m6.3 14.1 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C33.9 6.1 29.2 4 24 4 16.3 4 9.7 8.3 6.3 14.1z" fill="#FF3D00"/>
            <path d="M24 44c5.1 0 9.8-2 13.3-5.2l-6.1-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.3 0-9.7-3.4-11.3-8.1l-6.5 5C9.6 39.6 16.2 44 24 44z" fill="#4CAF50"/>
            <path d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.1 4.1-3.9 5.5l6.1 5.2C40.6 36 44 30.5 44 24c0-1.3-.1-2.3-.4-3.5z" fill="#1976D2"/>
          </svg>
        </button>
        <button type="button" class="auth-sso-btn" aria-label="Sign up with Apple" @click="ssoNotice('Apple')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#000" aria-hidden="true">
            <path d="M17.05 20.28c-.98.95-2.05.86-3.08.43-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.43C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
          </svg>
        </button>
        <button type="button" class="auth-sso-btn" aria-label="Sign up with Microsoft" @click="ssoNotice('Microsoft')">
          <svg width="20" height="20" viewBox="0 0 23 23" aria-hidden="true">
            <path fill="#F25022" d="M1 1h10v10H1z"/>
            <path fill="#7FBA00" d="M12 1h10v10H12z"/>
            <path fill="#00A4EF" d="M1 12h10v10H1z"/>
            <path fill="#FFB900" d="M12 12h10v10H12z"/>
          </svg>
        </button>
      </div>

      <div class="auth-switch">
        Already have an account? <RouterLink to="/">Sign in →</RouterLink>
      </div>
    </form>
  </div>
</template>

<style scoped>
.register__names {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.register__hint {
  font-family: var(--font-body);
  font-size: 11px;
  color: #6B6B72;
  margin: 2px 0 0;
}
@media (max-width: 480px) {
  .register__names { grid-template-columns: 1fr; }
}
</style>
