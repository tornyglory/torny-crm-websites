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
    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL ?? 'http://localhost:3002',
    },
  },

  nitro: {
    preset: 'cloudflare-pages',
    prerender: {
      crawlLinks: false,
    },
  },

  routeRules: process.env.NODE_ENV === 'production'
    ? {
        '/': { swr: 300 },
        '/sign-in': { swr: 300 },
        '/api/**': { cache: false },
      }
    : {
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
