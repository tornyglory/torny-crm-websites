<script setup lang="ts">
import { HeroBlock, EventListBlock, MembershipCtaBlock } from '@torny/content-blocks'

const club = useClub()

useSeoMeta({
  title: () => (club.value ? `${club.value.name} — Lawn Bowls` : 'Torny'),
  description: () => `Welcome to ${club.value?.name ?? 'our'} — join, play, and follow the club.`,
})
</script>

<template>
  <div class="home">
    <HeroBlock
      :heading="club?.name ?? 'Welcome'"
      subheading="A friendly bowls club. New members always welcome."
      :primary-cta="{ label: 'Join the club', href: '/membership' }"
      :secondary-cta="{ label: 'View events', href: '/events' }"
    />

    <EventListBlock heading="What's on" :limit="4" />

    <MembershipCtaBlock
      heading="Play with us this season"
      body="Whether you're a first-time bowler or a seasoned skip, there's a spot for you."
    />
  </div>
</template>

<style scoped>
.home { display: flex; flex-direction: column; gap: 48px; }
</style>
