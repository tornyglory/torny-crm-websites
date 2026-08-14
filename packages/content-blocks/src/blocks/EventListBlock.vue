<script setup lang="ts">
import type { EventListProps } from '../types'
withDefaults(defineProps<EventListProps>(), { heading: 'Upcoming events', limit: 6, upcomingOnly: true })
</script>

<template>
  <section class="event-list">
    <h2 v-if="heading" class="event-list__heading">{{ heading }}</h2>
    <p class="event-list__placeholder">Event list will hydrate from /events?upcoming={{ upcomingOnly }}&amp;limit={{ limit }}.</p>
  </section>
</template>

<style scoped>
.event-list { padding: 32px 0; }
.event-list__heading { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 16px; color: var(--color-ink); }
.event-list__placeholder { font-family: var(--font-body); color: var(--color-fog); font-size: 14px; }
</style>
