<script setup lang="ts">
/**
 * Site-wide SEO defaults. Individual pages override via their own
 * useSeoMeta calls; these are the fallbacks every page inherits plus
 * the Organization JSON-LD that lives in <head> on every page (helps
 * Google's knowledge graph tie brand mentions back to torny.pro).
 */
useSeoMeta({
  titleTemplate: (titleChunk) => (titleChunk ? `${titleChunk} — Torny` : 'Torny — The Bowls Club Network'),
  description: 'Software to run your bowls club — membership, communications, events, website. Signup takes two minutes; first bookings go live in two weeks.',
  ogType: 'website',
  ogSiteName: 'Torny',
  ogImage: 'https://torny.pro/og-default.png',
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogImageAlt: 'Torny — The Bowls Club Network',
  twitterCard: 'summary_large_image',
  twitterSite: '@torny',
  themeColor: '#0A0A0B',
})

useHead({
  htmlAttrs: { lang: 'en-NZ' },
  link: [
    { rel: 'canonical', href: 'https://torny.pro/' },
  ],
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'Torny',
        url: 'https://torny.pro',
        logo: 'https://torny.pro/logo.png',
        description: 'SaaS for sports clubs — membership, communications, events, public website.',
        foundingDate: '2026',
        areaServed: { '@type': 'Country', name: 'New Zealand' },
        sameAs: [],
      }),
    },
  ],
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
