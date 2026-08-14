<script setup lang="ts">
const club = useClub()
useTheme()
</script>

<template>
  <div class="site">
    <header class="site__header">
      <div class="site__brand">
        <img v-if="club?.logoUrl" :src="club.logoUrl" :alt="club.name" class="site__logo" />
        <span v-else class="site__wordmark">{{ club?.name ?? 'Torny' }}</span>
      </div>
      <nav class="site__nav">
        <NuxtLink to="/">Home</NuxtLink>
        <NuxtLink to="/events">Events</NuxtLink>
        <NuxtLink to="/honour-board">Honour board</NuxtLink>
        <NuxtLink to="/membership">Membership</NuxtLink>
        <NuxtLink to="/contact">Contact</NuxtLink>
      </nav>
    </header>

    <main class="site__main">
      <slot />
    </main>

    <footer class="site__footer">
      <div>© {{ new Date().getFullYear() }} {{ club?.name }}</div>
      <div class="site__powered">Powered by Torny</div>
    </footer>
  </div>
</template>

<style scoped>
.site { min-height: 100vh; display: flex; flex-direction: column; }

.site__header { display: flex; align-items: center; justify-content: space-between; padding: 20px 32px; border-bottom: 1px solid var(--color-hairline); background: #fff; }
.site__brand { display: flex; align-items: center; gap: 12px; }
.site__logo { height: 36px; width: auto; }
.site__wordmark { font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); }
.site__nav { display: flex; gap: 24px; }
.site__nav a { font-family: var(--font-body); font-size: 14px; font-weight: 500; color: var(--color-ink); }
.site__nav a.router-link-active { color: var(--color-accent); font-weight: 600; }

.site__main { flex: 1; padding: 48px 32px; max-width: 1200px; margin: 0 auto; width: 100%; }

.site__footer { display: flex; justify-content: space-between; align-items: center; padding: 24px 32px; border-top: 1px solid var(--color-hairline); font-family: var(--font-body); font-size: 12px; color: var(--color-fog); background: var(--color-surface); }
.site__powered { font-family: var(--font-mono); font-size: 11px; }
</style>
