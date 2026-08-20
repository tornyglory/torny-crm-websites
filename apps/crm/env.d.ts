/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SAM_BASE_URL: string
  readonly VITE_CRM_BASE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
