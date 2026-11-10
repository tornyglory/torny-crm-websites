<script setup lang="ts">
/**
 * Accept invite — public landing for the magic link in team.invited emails.
 *
 * Route: /accept-invite/:token
 *
 * Three invitee states (brief 95-live §Accept flow):
 *
 * 1. Existing user with a real password → empty-body POST succeeds (200).
 *    Store token, route to dashboard. Common for people with active Torny
 *    accounts who've been granted CRM access on a new club.
 *
 * 2. Existing user with NULL password → auto-promoted stub user (admin
 *    added them to the roster via POST /clubs/{id}/members, no password
 *    was ever set). Backend returns 400 `bad_password`. FE shows a
 *    password-only form; POST with { password }, backend hashes it in
 *    place. This is the common case for the auto-promote invite path.
 *
 * 3. Brand new account → email doesn't exist in `users` yet. Backend
 *    returns 400 `bad_name`. FE shows name + password form; POST with
 *    both, backend creates the user atomically.
 *
 * On success (any path): store auth_token, bootstrap the club store, land
 * the user on /crm/dashboard. /me refresh happens on mount of the shell.
 *
 * Error cases:
 * - invite_not_found → invalid or already consumed link
 * - invite_expired   → ask the club to resend
 * - invite_revoked   → club revoked the invite
 * - invite_already_accepted → prompt to sign in with their existing account
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ApiError,
  invites as invitesApi,
  claims as claimsApi,
  type AcceptInviteErrorCode,
} from '@torny/api-client'
import { useAuthStore, fromApiUser } from '@/stores/auth'
import { useClubStore } from '@/stores/club'
import CrmSpinner from '@/components/CrmSpinner.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const club = useClubStore()

const token = String(route.params.token ?? '')

type Phase = 'probing' | 'needs-password' | 'needs-signup' | 'submitting' | 'error' | 'done'
const phase = ref<Phase>('probing')
const errorMessage = ref<string | null>(null)
const errorCode = ref<AcceptInviteErrorCode | null>(null)

const signupForm = reactive({
  name: '',
  password: '',
  passwordConfirm: '',
})

async function attempt(input: { name?: string; password?: string } = {}) {
  try {
    const result = await invitesApi.acceptInvite(token, input)

    // Signed in — stash token, rehydrate user from /me (richer shape than
    // what accept returns), then land in the CRM for the invited club.
    localStorage.setItem('torny.token', result.auth_token)
    try {
      const apiUser = await claimsApi.me()
      auth.setSession(result.auth_token, fromApiUser(apiUser))
    } catch {
      // /me failed (network blip, cold lambda) — fall back to the thin accept
      // payload so the user still lands signed-in; auth.refresh() on next load
      // will backfill the full user.
      auth.setSession(result.auth_token, fromApiUser({
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        user_type: null,
        role: 'member',
        clubs: [{ id: result.club.id, name: result.club.name, role: 'member' }],
        is_platform_admin: false,
        avatar_url: null,
        profile_completed: null,
        created: null,
        updated: null,
      }))
    }

    club.setCurrent({
      id: result.club.id,
      name: result.club.name,
      slug: result.club.slug,
      domain: null,
      brandPrimary: null,
      logoUrl: null,
    })

    phase.value = 'done'
    await router.replace({ name: 'dashboard' })
  } catch (err) {
    handleError(err, input.name !== undefined)
  }
}

function handleError(err: unknown, afterSubmit: boolean) {
  if (!(err instanceof ApiError)) {
    phase.value = 'error'
    errorMessage.value = (err as Error).message
    return
  }
  const code = err.code as AcceptInviteErrorCode | undefined
  errorCode.value = code ?? null

  // First probe — no body was submitted. Branch based on which field the
  // backend demanded. `bad_name` → fully new account (need name + password).
  // `bad_password` → existing stub user (need password only).
  if (!afterSubmit) {
    if (code === 'bad_name') {
      phase.value = 'needs-signup'
      errorMessage.value = null
      return
    }
    if (code === 'bad_password') {
      phase.value = 'needs-password'
      errorMessage.value = null
      return
    }
  }

  // Submit attempt failed with a field error — stay on the form and surface
  // the message inline so the user can retry without losing context.
  if (afterSubmit && code === 'bad_password') {
    errorMessage.value = 'Password must be at least 12 characters.'
    return
  }
  if (afterSubmit && code === 'bad_name') {
    errorMessage.value = 'Please enter your full name.'
    return
  }

  phase.value = 'error'
  switch (code) {
    case 'invite_not_found':
      errorMessage.value = 'This invite link is invalid or no longer exists.'
      break
    case 'invite_expired':
      errorMessage.value = 'This invite has expired. Ask the club to send a new one.'
      break
    case 'invite_revoked':
      errorMessage.value = 'This invite was revoked by the club.'
      break
    case 'invite_already_accepted':
      errorMessage.value = 'This invite has already been accepted — sign in with your existing account.'
      break
    default:
      errorMessage.value = err.message || 'Something went wrong — please try again.'
  }
}

const passwordsMatch = computed(
  () => signupForm.password.length === 0 || signupForm.password === signupForm.passwordConfirm,
)

function validatePassword(): string | null {
  if (signupForm.password.length < 12) return 'Password must be at least 12 characters.'
  if (!passwordsMatch.value) return 'Passwords don\'t match.'
  return null
}

async function submitPassword() {
  const err = validatePassword()
  if (err) { errorMessage.value = err; return }
  errorMessage.value = null
  const prev = phase.value
  phase.value = 'submitting'
  await attempt({ password: signupForm.password })
  // If the attempt errored, `handleError` pulled us back to needs-password or
  // needs-signup. Nothing to do here; the inline error renders below the form.
  if (phase.value === 'submitting') phase.value = prev
}

async function submitSignup() {
  if (!signupForm.name.trim()) { errorMessage.value = 'Please enter your full name.'; return }
  const err = validatePassword()
  if (err) { errorMessage.value = err; return }
  errorMessage.value = null
  const prev = phase.value
  phase.value = 'submitting'
  await attempt({ name: signupForm.name.trim(), password: signupForm.password })
  if (phase.value === 'submitting') phase.value = prev
}

onMounted(() => {
  if (!token) {
    phase.value = 'error'
    errorMessage.value = 'This invite link is missing its token.'
    return
  }
  void attempt()
})
</script>

<template>
  <div class="accept">
    <div class="accept__card">
      <div class="accept__eyebrow">Team invite</div>
      <h1 class="accept__title">Join the club on Torny</h1>

      <div v-if="phase === 'probing'" class="accept__state">
        <CrmSpinner size="sm" label="Checking invite" />
        <span>Checking your invite…</span>
      </div>

      <div v-else-if="phase === 'needs-password'" class="accept__signup">
        <p class="accept__lede">
          Your club already added you to the roster. Set a password so you can sign in and manage the CRM.
        </p>
        <form @submit.prevent="submitPassword">
          <label class="field">
            <span class="field__label">Password</span>
            <input v-model="signupForm.password" type="password" autocomplete="new-password" minlength="12" required />
            <span class="field__hint">At least 12 characters.</span>
          </label>
          <label class="field">
            <span class="field__label">Confirm password</span>
            <input v-model="signupForm.passwordConfirm" type="password" autocomplete="new-password" required />
          </label>
          <div v-if="errorMessage" class="accept__error">{{ errorMessage }}</div>
          <button type="submit" class="btn btn--primary">Accept &amp; sign in</button>
        </form>
      </div>

      <div v-else-if="phase === 'needs-signup'" class="accept__signup">
        <p class="accept__lede">Looks like you're new to Torny. Set up your account to accept the invite.</p>
        <form @submit.prevent="submitSignup">
          <label class="field">
            <span class="field__label">Your full name</span>
            <input v-model="signupForm.name" type="text" autocomplete="name" required />
          </label>
          <label class="field">
            <span class="field__label">Password</span>
            <input v-model="signupForm.password" type="password" autocomplete="new-password" minlength="12" required />
            <span class="field__hint">At least 12 characters.</span>
          </label>
          <label class="field">
            <span class="field__label">Confirm password</span>
            <input v-model="signupForm.passwordConfirm" type="password" autocomplete="new-password" required />
          </label>
          <div v-if="errorMessage" class="accept__error">{{ errorMessage }}</div>
          <button type="submit" class="btn btn--primary">Accept invite &amp; sign in</button>
        </form>
      </div>

      <div v-else-if="phase === 'submitting'" class="accept__state">
        <CrmSpinner size="sm" label="Setting up your account" />
        <span>Setting up your account…</span>
      </div>

      <div v-else-if="phase === 'error'" class="accept__error-state">
        <p class="accept__error">{{ errorMessage }}</p>
        <RouterLink v-if="errorCode === 'invite_already_accepted'" to="/" class="btn btn--primary">Sign in</RouterLink>
      </div>

      <div v-else-if="phase === 'done'" class="accept__state">
        <CrmSpinner size="sm" label="Taking you in" />
        <span>Taking you to the dashboard…</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.accept {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bone);
  padding: 32px 20px;
}
.accept__card {
  max-width: 440px;
  width: 100%;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 14px;
  padding: 32px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}
.accept__eyebrow {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.accept__title {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 8px 0 20px;
  color: var(--color-ink);
}
.accept__state {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 0;
  color: var(--color-graphite);
  font-family: var(--font-body);
  font-size: 14px;
}
.accept__lede {
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--color-graphite);
  margin: 0 0 16px;
  line-height: 1.5;
}
.accept__signup form { display: flex; flex-direction: column; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field__label {
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--color-ink);
}
.field__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-graphite); }
.field input {
  padding: 10px 12px;
  border: 1px solid var(--color-divider);
  border-radius: 8px;
  font-family: var(--font-body);
  font-size: 14px;
  background: #fff;
}
.accept__error { color: var(--color-danger); font-family: var(--font-body); font-size: 13px; }
.accept__error-state { display: flex; flex-direction: column; gap: 16px; }
.btn {
  padding: 10px 20px;
  border-radius: 999px;
  border: none;
  cursor: pointer;
  font-family: var(--font-heading);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  text-align: center;
  display: inline-block;
}
.btn--primary { background: var(--color-ink); color: #fff; }
.btn--primary:hover { opacity: 0.9; }
</style>
