<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import { auth as authApi, AuthError } from '@torny/api-client'
import { useAuthStore, fromApiUser } from '@/stores/auth'
import { useClubStore } from '@/stores/club'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const club = useClubStore()

const email = ref('')
const password = ref('')
const keepSignedIn = ref(true)
const showPassword = ref(false)
const submitting = ref(false)
const error = ref<string | null>(null)

const API_BASE = import.meta.env.VITE_SAM_BASE_URL

function landingFor(user: ReturnType<typeof fromApiUser>): string {
  if (user.isPlatformAdmin) return '/admin'
  switch (user.role) {
    case 'owner':
    case 'admin':
    case 'committee':
      return '/crm/dashboard'
    case 'player':
    default:
      // No CRM access yet — send them to the claim flow. Will become the
      // majority case for CRM sign-ins until M3 populates clubs[].
      return '/claim'
  }
}

async function submit(e: Event) {
  e.preventDefault()
  submitting.value = true
  error.value = null
  try {
    const { token, user: apiUser } = await authApi.login(email.value.trim(), password.value, {
      baseURL: API_BASE,
    })
    const user = fromApiUser(apiUser)
    auth.setSession(token, user)
    // Hydrate the current club from the login response's clubs[] so the
    // sidebar badge shows the right club immediately. No-op for platform
    // admins or players with no clubs.
    club.syncFromUserClubs(user.clubs)

    const redirect = (route.query.redirect as string | undefined) ?? landingFor(user)
    await router.push(redirect)
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) {
      error.value = 'Email or password is incorrect.'
    } else if (err instanceof AuthError) {
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
  <div class="signin">
    <!-- Left: editorial pitch -->
    <section class="pitch">
      <div class="pitch__inner">
        <div class="pitch__eyebrow">For club owners, admins &amp; organisers</div>
        <h1 class="pitch__heading">
          Run your club.<br />
          Not the admin.
        </h1>
        <p class="pitch__body">
          Membership, applications, event calendars, team selections,
          honour boards, website — one workspace for everything a bowls
          club does that isn't playing bowls.
        </p>

        <div class="pitch__stats">
          <div class="stat">
            <div class="stat__value">142</div>
            <div class="stat__label">Clubs on Torny</div>
          </div>
          <div class="stat">
            <div class="stat__value">18,204</div>
            <div class="stat__label">Members managed</div>
          </div>
          <div class="stat">
            <div class="stat__value">est. '25</div>
            <div class="stat__label">Wellington · NZ</div>
          </div>
        </div>
      </div>
    </section>

    <!-- Right: sign in card -->
    <section class="pane">
      <form class="card" @submit="submit">
        <div class="card__eyebrow">01 — Sign in</div>
        <h2 class="card__heading">Welcome back.</h2>
        <p class="card__sub">Use your Torny credentials — same login as the player app.</p>

        <label class="field">
          <span class="field__label">Email</span>
          <input
            v-model="email"
            type="email"
            required
            autocomplete="email"
            placeholder="grace@naenaebowling.org.nz"
            class="field__input"
          />
        </label>

        <label class="field">
          <div class="field__row">
            <span class="field__label">Password</span>
            <RouterLink to="/forgot-password" class="field__link">Forgot password</RouterLink>
          </div>
          <div class="field__with-icon">
            <input
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              required
              autocomplete="current-password"
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
        </label>

        <label class="check">
          <input v-model="keepSignedIn" type="checkbox" />
          <span>Keep me signed in on this device</span>
        </label>

        <button type="submit" class="submit" :disabled="submitting">
          <span>{{ submitting ? 'Signing in…' : 'Sign in to Torny CRM' }}</span>
          <svg v-if="!submitting" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </button>

        <p v-if="error" class="alert">{{ error }}</p>

        <div class="card__foot">
          <span class="card__foot-muted">No account yet?</span>
          <RouterLink to="/register" class="card__foot-link">
            Register your club
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12">
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </RouterLink>
        </div>
      </form>
    </section>
  </div>
</template>

<style scoped>
.signin {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-height: calc(100vh - 68px);
}

/* Left pitch column */
.pitch {
  padding: 40px 64px 64px;
  background: #fff;
  display: flex;
  align-items: flex-start;
}
.pitch__inner {
  max-width: 560px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin-top: 24px;
}
.pitch__eyebrow {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.16em;
  color: var(--color-fog);
  text-transform: uppercase;
}
.pitch__heading {
  font-family: var(--font-display);
  font-size: clamp(48px, 6.5vw, 88px);
  font-weight: 700;
  line-height: 0.98;
  letter-spacing: -0.03em;
  color: var(--color-accent);
  margin: 0;
}
.pitch__body {
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 1.65;
  color: var(--color-graphite);
  margin: 0;
  max-width: 400px;
}

.pitch__stats {
  display: flex;
  gap: 40px;
  padding-top: 28px;
  border-top: 1px solid var(--color-hairline);
  margin-top: auto;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.stat__value {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--color-ink);
}
.stat__label {
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: var(--color-fog);
  text-transform: uppercase;
}

/* Right sign-in pane */
.pane {
  background: var(--color-surface);
  padding: 48px 64px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}
.card {
  width: 100%;
  max-width: 400px;
  padding: 32px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 20px;
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 40px;
}
.card__eyebrow {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.16em;
  color: var(--color-fog);
  text-transform: uppercase;
}
.card__heading {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--color-ink);
  margin: -4px 0 0;
}
.card__sub {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-graphite);
  margin: 0;
  line-height: 1.5;
}

.field { display: flex; flex-direction: column; gap: 8px; }
.field__row { display: flex; align-items: baseline; justify-content: space-between; }
.field__label {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: var(--color-fog);
  text-transform: uppercase;
}
.field__link {
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--color-accent);
  text-decoration: none;
  font-weight: 600;
}
.field__input {
  width: 100%;
  padding: 11px 14px;
  border: 1px solid var(--color-hairline);
  border-radius: 10px;
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--color-ink);
  background: #fff;
}
.field__input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}
.field__with-icon { position: relative; display: flex; align-items: center; }
.field__with-icon .field__input { padding-right: 40px; }
.field__icon-btn {
  position: absolute;
  right: 8px;
  background: transparent;
  border: none;
  color: var(--color-fog);
  cursor: pointer;
  padding: 6px;
  display: flex;
  align-items: center;
}
.field__icon-btn:hover { color: var(--color-ink); }

.check {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-graphite);
  margin-top: 2px;
}
.check input { accent-color: var(--color-ink); width: 15px; height: 15px; }

.submit {
  margin-top: 4px;
  padding: 13px 18px;
  background: var(--color-ink);
  color: #fff;
  border: none;
  border-radius: 12px;
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.submit:disabled { opacity: 0.6; cursor: default; }

.alert {
  padding: 10px 12px;
  background: #FEE2E2;
  color: #991B1B;
  border-radius: 10px;
  font-family: var(--font-body);
  font-size: 13px;
  margin: 0;
}

.card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 16px;
  border-top: 1px solid var(--color-hairline);
  margin-top: 4px;
}
.card__foot-muted {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-fog);
}
.card__foot-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-ink);
  font-weight: 600;
  text-decoration: none;
}

@media (max-width: 960px) {
  .signin { grid-template-columns: 1fr; }
  .pitch { padding: 32px 24px; }
  .pane { padding: 32px 24px 48px; }
  .card { margin-top: 0; }
  .pitch__stats { gap: 24px; }
}
</style>
