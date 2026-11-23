/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SAM_BASE_URL: string
  readonly VITE_CRM_BASE_URL: string
  // Sentry (optional — unset = no error tracking)
  readonly VITE_SENTRY_DSN?: string
  readonly VITE_SENTRY_ENVIRONMENT?: string
  readonly VITE_SENTRY_RELEASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
