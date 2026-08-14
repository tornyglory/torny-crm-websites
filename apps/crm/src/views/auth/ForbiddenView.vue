<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
const auth = useAuthStore()
</script>

<template>
  <div class="forbidden">
    <div class="forbidden__eyebrow">403</div>
    <h1 class="forbidden__heading">You don't have access to this workspace.</h1>
    <p class="forbidden__sub">Signed in as {{ auth.user?.email }} — this account isn't an owner or admin of any club.</p>
    <button class="forbidden__btn" @click="auth.clearSession(); $router.push('/')">Sign out</button>
  </div>
</template>

<style scoped>
.forbidden { max-width: 480px; text-align: center; }
.forbidden__eyebrow { font-family: var(--font-mono); font-size: 12px; color: var(--color-fog); }
.forbidden__heading { font-family: var(--font-display); font-size: 24px; font-weight: 700; letter-spacing: -0.02em; margin: 8px 0; color: var(--color-ink); }
.forbidden__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0 0 20px; }
.forbidden__btn { padding: 10px 18px; background: var(--color-ink); color: #fff; border: none; border-radius: 10px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; }
</style>
