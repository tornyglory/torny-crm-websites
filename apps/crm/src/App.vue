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
onMounted(async () => {
  if (auth.user?.clubs?.length) {
    club.syncFromUserClubs(auth.user.clubs)
  }
  // Backfill slug + logo + brand off /clubs/:id — the /me `clubs[]` stub
  // doesn't carry them. Needed for the Website editor's Preview button
  // and any other CRM → public-site link.
  await club.hydrateFull()
})
</script>

<template>
  <RouterView />
</template>
