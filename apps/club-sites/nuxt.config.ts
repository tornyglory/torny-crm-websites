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
      portalUrl: process.env.NUXT_PUBLIC_PORTAL_URL ?? 'http://localhost:3002',
      // Public API base for browser-side calls (/me, /public/*). MUST live on
      // the same registrable domain as the site (`.torny.co`) so the HttpOnly
      // session cookie set by the portal flows on cross-subdomain calls with
      // `credentials: 'include'`. e.g. `https://api.torny.co`.
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL ?? '',
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
        '/events/**': { swr: 60 },
        '/honour-board/**': { swr: 3600 },
        '/membership': { swr: 300 },
        '/contact': { swr: 3600 },
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
