<script setup lang="ts">
import { RouterView, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useClubStore } from '@/stores/club'

const auth = useAuthStore()
const club = useClubStore()
const router = useRouter()

function signOut() {
  auth.clearSession()
  club.clear()
  router.push('/')
}
</script>

<template>
  <div class="auth-shell">
    <header class="auth-shell__header">
      <div class="auth-shell__brand">
        <span class="auth-shell__dot" />
        <span class="auth-shell__wordmark">Torny</span>
        <span class="auth-shell__tag">CRM</span>
        <span v-if="auth.user" class="auth-shell__signed-in">
          Signed in as <strong>{{ auth.user.email }}</strong>
        </span>
      </div>
      <nav class="auth-shell__utility">
        <a href="mailto:hello@torny.club" class="auth-shell__link">Need help?</a>
        <a v-if="!auth.user" href="https://torny.club" class="auth-shell__link auth-shell__link--strong">
          Player app
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12">
            <path d="M7 17 17 7" /><path d="M7 7h10v10" />
          </svg>
        </a>
        <button v-else class="auth-shell__signout" @click="signOut">Sign out</button>
      </nav>
    </header>
    <RouterView />
  </div>
</template>

<style scoped>
.auth-shell { min-height: 100vh; background: #fff; display: flex; flex-direction: column; }

.auth-shell__header {
  position: sticky; top: 0; z-index: 10;
  padding: 20px 32px;
  display: flex; align-items: center; justify-content: space-between;
  background: #fff;
  border-bottom: 1px solid var(--color-hairline);
}
.auth-shell__brand { display: flex; align-items: baseline; gap: 10px; }
.auth-shell__dot { width: 10px; height: 10px; border-radius: 999px; background: var(--color-accent); }
.auth-shell__wordmark { font-family: var(--font-display); font-size: 18px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); }
.auth-shell__tag { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; margin-left: 4px; }
.auth-shell__signed-in { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); margin-left: 12px; }
.auth-shell__signed-in strong { color: var(--color-ink); font-weight: 600; }

.auth-shell__utility { display: flex; gap: 20px; align-items: center; }
.auth-shell__link { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); text-decoration: none; }
.auth-shell__link--strong { color: var(--color-ink); font-weight: 600; }
.auth-shell__signout { background: transparent; border: none; padding: 0; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); font-weight: 600; cursor: pointer; }
</style>
