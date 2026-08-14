<script setup lang="ts">
const club = useClub()
useSeoMeta({ title: () => `Events — ${club.value?.name ?? 'Torny'}` })
</script>

<template>
  <div>
    <h1 class="page__heading">Events</h1>
    <p class="page__stub">Event list hydrates from the Torny API scoped to this club.</p>
  </div>
</template>

<style scoped>
.page__heading { font-family: var(--font-display); font-size: 36px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 12px; }
.page__stub { font-family: var(--font-body); color: var(--color-fog); }
</style>
