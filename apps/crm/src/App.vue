<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useClubStore } from '@/stores/club'

const auth = useAuthStore()
const club = useClubStore()

// On app boot: if we have a persisted user with clubs but no current club set,
// pick their highest-tier club. Covers refresh-the-page and sessions that
// pre-date this hydration.
onMounted(() => {
  if (auth.user?.clubs?.length) {
    club.syncFromUserClubs(auth.user.clubs)
  }
})
</script>

<template>
  <RouterView />
</template>
