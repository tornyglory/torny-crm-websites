<script setup lang="ts">
// Placeholder for torny.co apex. Marketing landing + signed-in app
// dashboard both land here in future — for now, an inviting entry that
// points at sign-in.
useSeoMeta({
  title: 'Torny — the bowls club network',
  description: 'One login for every club you\'re a part of.',
})
</script>

<template>
  <main class="placeholder">
    <div class="placeholder__mark">T</div>
    <h1 class="placeholder__title">Torny</h1>
    <p class="placeholder__sub">The bowls club network.</p>
    <NuxtLink class="placeholder__cta" to="/sign-in">Sign in →</NuxtLink>
  </main>
</template>

<style scoped>
.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  gap: 20px;
  padding: 24px;
  background: var(--color-ground);
  text-align: center;
}
.placeholder__mark {
  width: 64px;
  height: 64px;
  border-radius: 16px;
  background: var(--color-ink);
  color: var(--color-ground);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 32px;
  letter-spacing: -0.03em;
}
.placeholder__title {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 56px;
  letter-spacing: -0.03em;
  line-height: 100%;
  color: var(--color-ink);
  margin: 0;
}
.placeholder__sub {
  font-family: var(--font-body);
  font-size: 16px;
  color: var(--color-fog);
  margin: 0;
}
.placeholder__cta {
  margin-top: 16px;
  padding: 14px 28px;
  background: var(--color-ink);
  color: var(--color-accent-ink);
  border-radius: 999px;
  font-family: var(--font-body);
  font-weight: 600;
  font-size: 14px;
}
</style>
