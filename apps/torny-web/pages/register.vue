<script setup lang="ts">
/**
 * torny.co/register — legacy claim-your-club path. Redirects to the
 * new signup wizard (brief 88). The `/register` URL is kept alive for
 * old inbound links; content lives at `/signup` now.
 */
if (process.server) {
  await navigateTo('/signup', { redirectCode: 301 })
} else {
  await navigateTo('/signup')
}
</script>

<template>
  <div />
</template>
