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

const API_BASE = import.meta.env.VITE_API_BASE_URL

const passwordOk = computed(() => password.value.length >= 10 && /[a-zA-Z]/.test(password.value) && /\d/.test(password.value))
const canSubmit = computed(
  () => firstName.value.trim().length > 0 && lastName.value.trim().length > 0 && /.+@.+\..+/.test(email.value) && passwordOk.value,
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
    // Register does not return a session token today (brief 03 §2). Log in
    // immediately so the user lands on /claim authenticated.
    const { token, user: apiUser } = await authApi.login(email.value.trim(), password.value, {
      baseURL: API_BASE,
    })
    const user = fromApiUser(apiUser)
    auth.setSession(token, user)
    club.clear()

    const redirect = (route.query.redirect as string | undefined) ?? '/claim'
    await router.push(redirect)
  } catch (err) {
    if (err instanceof AuthError) {
      error.value = err.message
    } else {
      error.value = (err as Error).message
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="register">
    <!-- Left: editorial pitch -->
    <section class="pitch">
      <div class="pitch__inner">
        <div class="pitch__eyebrow">Register your club on Torny</div>
        <h1 class="pitch__heading">
          Two minutes.<br />
          Then you're running it.
        </h1>
        <p class="pitch__body">
          Create your Torny account. Next, pick your club from the New Zealand
          bowls directory and tell us a bit about your role — we'll verify and
          hand over the keys, usually within a working day.
        </p>

        <ol class="pitch__steps">
          <li><span class="pitch__num">1</span> Create your account</li>
          <li><span class="pitch__num">2</span> Find your club in the directory</li>
          <li><span class="pitch__num">3</span> Prove your role — evidence</li>
          <li><span class="pitch__num">4</span> Torny admin verifies you</li>
        </ol>
      </div>
    </section>

    <!-- Right: register card -->
    <section class="pane">
      <form class="card" @submit="submit">
        <div class="card__eyebrow">01 — Create account</div>
        <h2 class="card__heading">Get started.</h2>
        <p class="card__sub">Uses the same Torny login as the player app. Already have one? <RouterLink to="/" class="card__inline-link">Sign in instead</RouterLink>.</p>

        <div class="form__row">
          <label class="field">
            <span class="field__label">First name</span>
            <input v-model="firstName" type="text" required autocomplete="given-name" autofocus class="field__input" />
          </label>
          <label class="field">
            <span class="field__label">Last name</span>
            <input v-model="lastName" type="text" required autocomplete="family-name" class="field__input" />
          </label>
        </div>

        <label class="field">
          <span class="field__label">Email</span>
          <input v-model="email" type="email" required autocomplete="email" placeholder="you@club.co.nz" class="field__input" />
        </label>

        <label class="field">
          <span class="field__label">Password</span>
          <div class="field__with-icon">
            <input
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              required
              autocomplete="new-password"
              class="field__input"
            />
            <button
              type="button"
              class="field__icon-btn"
              :aria-label="showPassword ? 'Hide password' : 'Show password'"
              @click="showPassword = !showPassword"
            >
              <svg v-if="!showPassword" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                <line x1="2" x2="22" y1="2" y2="22" />
              </svg>
            </button>
          </div>
          <span class="field__hint" :class="{ 'field__hint--ok': passwordOk }">
            10+ characters, at least one letter and one number.
          </span>
        </label>

        <button type="submit" class="submit" :disabled="submitting || !canSubmit">
          <span>{{ submitting ? 'Creating your account…' : 'Create account & continue' }}</span>
          <svg v-if="!submitting" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </button>

        <p v-if="error" class="alert">{{ error }}</p>

        <p class="card__terms">
          By continuing you agree to Torny's <a href="https://torny.club/terms" class="card__link">terms</a> and <a href="https://torny.club/privacy" class="card__link">privacy notice</a>.
        </p>
      </form>
    </section>
  </div>
</template>

<style scoped>
.register {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-height: calc(100vh - 68px);
}

.pitch { padding: 40px 64px 64px; background: #fff; display: flex; align-items: flex-start; }
.pitch__inner { max-width: 560px; width: 100%; display: flex; flex-direction: column; gap: 24px; margin-top: 24px; }
.pitch__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.pitch__heading { font-family: var(--font-display); font-size: clamp(48px, 6.5vw, 88px); font-weight: 700; line-height: 0.98; letter-spacing: -0.03em; color: var(--color-accent); margin: 0; }
.pitch__body { font-family: var(--font-body); font-size: 15px; line-height: 1.65; color: var(--color-graphite); margin: 0; max-width: 460px; }

.pitch__steps { list-style: none; padding: 0; margin: 8px 0 0; display: flex; flex-direction: column; gap: 10px; }
.pitch__steps li { display: flex; align-items: center; gap: 12px; font-family: var(--font-body); font-size: 14px; font-weight: 500; color: var(--color-ink); }
.pitch__num { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 999px; background: var(--color-surface); border: 1px solid var(--color-hairline); font-family: var(--font-body); font-size: 11px; font-weight: 700; color: var(--color-fog); flex-shrink: 0; }

.pane { background: var(--color-surface); padding: 48px 64px; display: flex; align-items: flex-start; justify-content: center; }
.card { width: 100%; max-width: 420px; padding: 32px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 20px; box-shadow: var(--shadow-md); display: flex; flex-direction: column; gap: 14px; margin-top: 40px; }
.card__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.card__heading { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: -4px 0 0; }
.card__sub { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); margin: 0; line-height: 1.5; }
.card__inline-link { color: var(--color-accent); text-decoration: none; font-weight: 600; }
.card__inline-link:hover { text-decoration: underline; }
.card__terms { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin: 4px 0 0; line-height: 1.5; }
.card__link { color: var(--color-graphite); text-decoration: underline; }

.form__row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field__label { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.12em; color: var(--color-fog); text-transform: uppercase; }
.field__input { width: 100%; padding: 11px 14px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 14px; color: var(--color-ink); background: #fff; }
.field__input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.field__with-icon { position: relative; display: flex; align-items: center; }
.field__with-icon .field__input { padding-right: 40px; }
.field__icon-btn { position: absolute; right: 8px; background: transparent; border: none; color: var(--color-fog); cursor: pointer; padding: 6px; display: flex; align-items: center; }
.field__icon-btn:hover { color: var(--color-ink); }
.field__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 4px; }
.field__hint--ok { color: var(--color-feature-mint); }

.submit { margin-top: 6px; padding: 13px 18px; background: var(--color-ink); color: #fff; border: none; border-radius: 12px; font-family: var(--font-body); font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; }
.submit:disabled { opacity: 0.5; cursor: default; }

.alert { padding: 10px 12px; background: #FEE2E2; color: #991B1B; border-radius: 10px; font-family: var(--font-body); font-size: 13px; margin: 0; }

@media (max-width: 960px) {
  .register { grid-template-columns: 1fr; }
  .pitch { padding: 32px 24px; }
  .pane { padding: 32px 24px 48px; }
  .card { margin-top: 0; }
}
</style>
