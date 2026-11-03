<script setup lang="ts">
import { RouterView, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useClubStore } from '@/stores/club'

const auth = useAuthStore()
const club = useClubStore()
const router = useRouter()

async function signOut() {
  auth.clearSession()
  club.clear()
  await router.push('/')
}
</script>

<template>
  <div class="auth-shell">
    <header class="auth-shell__top">
      <div class="auth-shell__brand">
        <span class="auth-shell__dot" aria-hidden="true" />
        <span class="auth-shell__wordmark">Torny</span>
        <span class="auth-shell__tag">OS</span>
      </div>
      <nav class="auth-shell__utility">
        <button v-if="auth.user" type="button" class="auth-shell__help" @click="signOut">
          Sign out
        </button>
        <a v-else href="mailto:hello@torny.co" class="auth-shell__help">
          Need help?
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M4 2.5h5.5V8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M9.5 2.5 3 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
        </a>
      </nav>
    </header>

    <main class="auth-shell__main">
      <RouterView />
    </main>

    <footer class="auth-shell__legal">
      By continuing you agree to our
      <a href="https://torny.co/terms" class="auth-shell__legal-link">terms</a>
      &amp;
      <a href="https://torny.co/privacy" class="auth-shell__legal-link">privacy notice</a>.
    </footer>
  </div>
</template>

<style scoped>
.auth-shell {
  min-height: 100vh;
  background: radial-gradient(ellipse at 85% -10%, #121a2b 0%, #080b14 55%, #050709 100%);
  display: flex;
  flex-direction: column;
  color: #fff;
}

.auth-shell__top {
  padding: 28px 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.auth-shell__brand { display: inline-flex; align-items: center; gap: 10px; }
.auth-shell__dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #2563EB;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.1);
}
.auth-shell__wordmark {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  color: #fff;
  letter-spacing: -0.02em;
}
.auth-shell__tag {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.45);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  margin-left: 2px;
}

.auth-shell__utility { display: inline-flex; align-items: center; gap: 12px; }
.auth-shell__help {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #fff;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
}
.auth-shell__help:hover { background: rgba(255, 255, 255, 0.08); }

.auth-shell__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 20px 40px;
}

.auth-shell__legal {
  padding: 20px 20px 32px;
  text-align: center;
  font-family: var(--font-body);
  font-size: 12px;
  color: rgba(255, 255, 255, 0.42);
}
.auth-shell__legal-link {
  color: rgba(255, 255, 255, 0.78);
  text-decoration: none;
  font-weight: 500;
}
.auth-shell__legal-link:hover { color: #fff; }

@media (max-width: 640px) {
  .auth-shell__top { padding: 20px 20px; }
  .auth-shell__wordmark { font-size: 18px; }
  .auth-shell__main { padding: 24px 16px 32px; }
}
</style>

<!-- Shared classes used across SignIn / Register / ForgotPassword / ResetPassword -->
<style>
.auth-page {
  width: 100%;
  max-width: 440px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 24px;
}
.auth-page__header {
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.auth-page__title {
  font-family: var(--font-display);
  font-size: 44px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.05;
  color: #fff;
  margin: 0;
}
.auth-page__sub {
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.55);
  margin: 0;
}
.auth-page__card {
  background: #fff;
  border-radius: 20px;
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  box-shadow: 0 20px 50px -20px rgba(0, 0, 0, 0.5);
}
.auth-page__foot {
  text-align: center;
  font-family: var(--font-body);
  font-size: 13px;
  color: rgba(0, 0, 0, 0.5);
}
.auth-page__foot a {
  color: #0A0A0B;
  font-weight: 600;
  text-decoration: none;
}
.auth-page__foot a:hover { text-decoration: underline; }

/* Form primitives */
.auth-field { display: flex; flex-direction: column; gap: 8px; }
.auth-field__labelrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.auth-field__label {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #6B6B72;
}
.auth-field__link {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #0A0A0B;
  text-decoration: none;
}
.auth-field__link:hover { text-decoration: underline; }

.auth-field__wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.auth-field__input {
  width: 100%;
  box-sizing: border-box;
  height: 50px;
  padding: 0 16px;
  border-radius: 12px;
  border: 1.5px solid #E7E7E1;
  background: #fff;
  font-family: var(--font-body);
  font-size: 15px;
  color: #0A0A0B;
  outline: none;
  transition: border-color 0.12s, box-shadow 0.12s;
}
.auth-field__input::placeholder { color: #A3A39B; }
.auth-field__input:focus {
  border-color: #2563EB;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}
.auth-field__input--eye { padding-right: 44px; }
.auth-field__input--check { padding-right: 100px; }
.auth-field__eye {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: 0;
  padding: 4px;
  color: #6B6B72;
  cursor: pointer;
}
.auth-field__eye:hover { color: #0A0A0B; }
.auth-field__inline-ok {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #16A34A;
}
.auth-field__inline-bad {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #DC2F3B;
}

/* Primary CTA */
.auth-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 54px;
  padding: 0 20px;
  border-radius: 14px;
  border: 0;
  background: #0A0A0B;
  color: #fff;
  font-family: var(--font-body);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s;
}
.auth-btn:hover:not(:disabled) { background: #2E2E33; }
.auth-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.auth-btn--ghost {
  background: #fff;
  color: #0A0A0B;
  border: 1.5px solid #E7E7E1;
}
.auth-btn--ghost:hover:not(:disabled) { background: #F5F5F2; border-color: #0A0A0B; }

/* OR divider */
.auth-or {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #6B6B72;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.auth-or::before,
.auth-or::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #E7E7E1;
}

/* SSO row */
.auth-sso { display: flex; align-items: center; gap: 10px; }
.auth-sso-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 50px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1.5px solid #E7E7E1;
  background: #fff;
  color: #0A0A0B;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.12s;
}
.auth-sso-btn:hover { border-color: #0A0A0B; }

/* Switch row below the OR + SSO */
.auth-switch {
  text-align: center;
  font-family: var(--font-body);
  font-size: 13px;
  color: #6B6B72;
}
.auth-switch a {
  color: #0A0A0B;
  font-weight: 600;
  text-decoration: none;
}
.auth-switch a:hover { text-decoration: underline; }

/* Error alert */
.auth-alert {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  background: #FEE2E2;
  color: #991B1B;
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.4;
}

/* Password strength meter */
.auth-strength {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: -4px;
}
.auth-strength__bars {
  flex: 1;
  display: flex;
  gap: 4px;
}
.auth-strength__bar {
  flex: 1;
  height: 4px;
  border-radius: 999px;
  background: #E7E7E1;
}
.auth-strength__bar--on { background: #16A34A; }
.auth-strength__bar--weak { background: #EA580C; }
.auth-strength__bar--mid { background: #F59E0B; }
.auth-strength__label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #16A34A;
}
.auth-strength__label--weak { color: #EA580C; }
.auth-strength__label--mid { color: #F59E0B; }
.auth-strength__label--none { color: #A3A39B; }

/* Success check for the "check your inbox" state */
.auth-check {
  width: 72px;
  height: 72px;
  border-radius: 999px;
  background: #DCFCE7;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto;
}

@media (max-width: 640px) {
  .auth-page__title { font-size: 32px; }
  .auth-page__card { padding: 22px; }
  .auth-field__input { height: 48px; }
  .auth-btn { height: 50px; }
}
</style>
