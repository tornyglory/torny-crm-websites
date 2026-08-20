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

const API_BASE = import.meta.env.VITE_API_BASE_URL

onMounted(() => {
  const t = route.query.token
  if (typeof t === 'string') token.value = t
})

const passwordOk = computed(() => password.value.length >= 10 && /[a-zA-Z]/.test(password.value) && /\d/.test(password.value))
const canSubmit = computed(() => token.value.length > 0 && passwordOk.value && password.value === confirm.value)

async function submit(e: Event) {
  e.preventDefault()
  if (!canSubmit.value) return
  submitting.value = true
  error.value = null
  try {
    await authApi.resetPassword(token.value, password.value, { baseURL: API_BASE })
    done.value = true
    setTimeout(() => router.push('/'), 2500)
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
  <div class="rp">
    <div class="rp__card">
      <div class="rp__eyebrow">Recover access</div>
      <h1 class="rp__heading">Set a new password</h1>

      <template v-if="!done">
        <p v-if="!token" class="alert">No reset token in this link. <RouterLink to="/forgot-password" class="rp__link">Request a new one</RouterLink>.</p>

        <form v-else class="form" @submit="submit">
          <label class="field">
            <span class="field__label">New password</span>
            <div class="field__with-icon">
              <input
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                required
                autocomplete="new-password"
                autofocus
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
            <span class="field__hint" :class="{ 'field__hint--ok': passwordOk }">10+ characters, at least one letter and one number.</span>
          </label>

          <label class="field">
            <span class="field__label">Confirm password</span>
            <input v-model="confirm" :type="showPassword ? 'text' : 'password'" required autocomplete="new-password" class="field__input" />
            <span v-if="confirm && confirm !== password" class="field__hint field__hint--warn">Passwords don't match.</span>
          </label>

          <button type="submit" class="submit" :disabled="submitting || !canSubmit">
            {{ submitting ? 'Updating…' : 'Update password' }}
          </button>
          <p v-if="error" class="alert">{{ error }}</p>
        </form>
      </template>

      <template v-else>
        <div class="done">
          <div class="done__badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h2 class="done__title">Password updated</h2>
          <p class="done__body">You'll be redirected to sign in…</p>
        </div>
      </template>

      <div class="rp__foot">
        <RouterLink to="/" class="rp__link">← Back to sign in</RouterLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rp { flex: 1; background: var(--color-surface); padding: 60px 24px; display: flex; justify-content: center; }
.rp__card { width: 100%; max-width: 460px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 20px; box-shadow: var(--shadow-md); padding: 36px; display: flex; flex-direction: column; gap: 14px; height: fit-content; }
.rp__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.rp__heading { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: -4px 0 0; }
.rp__link { color: var(--color-accent); text-decoration: none; font-weight: 600; }
.rp__link:hover { text-decoration: underline; }

.form { display: flex; flex-direction: column; gap: 14px; margin-top: 6px; }
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
.field__hint--warn { color: var(--color-danger); }

.submit { padding: 13px 18px; background: var(--color-ink); color: #fff; border: none; border-radius: 12px; font-family: var(--font-body); font-size: 14px; font-weight: 600; cursor: pointer; }
.submit:disabled { opacity: 0.5; cursor: default; }

.alert { padding: 10px 12px; background: #FEE2E2; color: #991B1B; border-radius: 10px; font-family: var(--font-body); font-size: 13px; margin: 0; }

.done { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 8px 0 0; }
.done__badge { width: 44px; height: 44px; border-radius: 999px; background: var(--color-feature-mint); color: #fff; display: flex; align-items: center; justify-content: center; }
.done__title { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--color-ink); margin: 4px 0 0; }
.done__body { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); margin: 0; }

.rp__foot { padding-top: 12px; border-top: 1px solid var(--color-hairline); margin-top: 4px; }
</style>
