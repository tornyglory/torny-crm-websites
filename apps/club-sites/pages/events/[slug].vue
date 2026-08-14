<script setup lang="ts">
const route = useRoute()
const club = useClub()
useSeoMeta({ title: () => `Event — ${club.value?.name ?? 'Torny'}` })
</script>

<template>
  <article>
    <h1 class="page__heading">Event: {{ route.params.slug }}</h1>
    <p class="page__stub">Event detail fetches from /events/{{ route.params.slug }}.</p>
  </article>
</template>

<style scoped>
.page__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 12px; }
.page__stub { font-family: var(--font-body); color: var(--color-fog); }
</style>
