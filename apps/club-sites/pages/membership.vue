<script setup lang="ts">
const club = useClub()
useSeoMeta({ title: () => `Membership — ${club.value?.name ?? 'Torny'}` })
</script>

<template>
  <div>
    <h1 class="page__heading">Membership</h1>
    <p class="page__stub">Membership form posts to /api/applications and lands in the CRM.</p>
  </div>
</template>

<style scoped>
.page__heading { font-family: var(--font-display); font-size: 36px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 12px; }
.page__stub { font-family: var(--font-body); color: var(--color-fog); }
</style>
