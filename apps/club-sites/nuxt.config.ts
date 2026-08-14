export default defineNuxtConfig({
  compatibilityDate: '2024-10-01',
  devtools: { enabled: true },

  css: [
    '@torny/design-tokens/fonts.css',
    '@torny/design-tokens/tokens.css',
    '~/assets/styles/base.css',
  ],

  runtimeConfig: {
    tornyApiBaseUrl: process.env.NUXT_TORNY_API_BASE_URL ?? 'http://localhost:3000',
    revalidateSecret: process.env.NUXT_REVALIDATE_SECRET ?? 'dev-secret-change-me',
    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL ?? 'http://localhost:3001',
    },
  },

  nitro: {
    preset: 'cloudflare-pages',
    prerender: {
      crawlLinks: false,
    },
  },

  routeRules: {
    '/': { swr: 300 },
    '/events/**': { swr: 60 },
    '/honour-board/**': { swr: 3600 },
    '/membership': { swr: 300 },
    '/contact': { swr: 3600 },
    '/api/**': { cache: false },
  },

  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
    },
  },

  typescript: {
    strict: true,
  },
})
