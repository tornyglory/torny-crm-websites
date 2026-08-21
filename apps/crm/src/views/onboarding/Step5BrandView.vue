<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useOnboardingStore } from '@/stores/onboarding'
import { useClubStore } from '@/stores/club'
import { media } from '@torny/api-client'
import WizardHeader from '@/components/onboarding/WizardHeader.vue'
import WizardFooter from '@/components/onboarding/WizardFooter.vue'

const onboarding = useOnboardingStore()
const clubStore = useClubStore()
const router = useRouter()
const fileInput = ref<HTMLInputElement | null>(null)

const swatches = ['#2563EB', '#DC2626', '#16A34A', '#EA580C', '#7C3AED', '#0F766E', '#0A0A0B']

const canContinue = computed(() => onboarding.data.tagline.trim().length > 0)

const wordmark = computed(() => {
  const name = onboarding.data.clubName || 'Your club'
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'YC'
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 12)
  return parts.map(p => p.charAt(0)).slice(0, 4).join('').toUpperCase()
})

onMounted(() => {
  onboarding.setStep(5)
})

// ── Logo upload ───────────────────────────────────────────────────
type UploadState = 'idle' | 'uploading' | 'error'
const uploadState = ref<UploadState>('idle')
const uploadError = ref<string | null>(null)
// Local object-URL preview so the thumbnail shows the picked file even
// before the confirmed Cloudflare URL is ready.
const localPreview = ref<string | null>(null)

const MAX_LOGO_BYTES = 10 * 1024 * 1024   // Cloudflare Images default
const ACCEPTED_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

const logoPreviewUrl = computed(() => localPreview.value ?? onboarding.data.logoUrl ?? null)

function openPicker() {
  fileInput.value?.click()
}

async function onFile(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  // Reset the input so the same file can be reselected after an error.
  target.value = ''
  if (!file) return

  if (!ACCEPTED_MIME.has(file.type)) {
    uploadError.value = 'Please pick a PNG, JPG, GIF, or WebP file.'
    uploadState.value = 'error'
    return
  }
  if (file.size > MAX_LOGO_BYTES) {
    uploadError.value = 'That file is over 10 MB — try a smaller one.'
    uploadState.value = 'error'
    return
  }

  const clubId = clubStore.current?.id
  if (clubId == null) {
    uploadError.value = 'No club is active — refresh and try again.'
    uploadState.value = 'error'
    return
  }

  // Swap in a local preview immediately so the UI feels responsive.
  if (localPreview.value) URL.revokeObjectURL(localPreview.value)
  localPreview.value = URL.createObjectURL(file)
  uploadState.value = 'uploading'
  uploadError.value = null
  onboarding.data.logoName = file.name

  try {
    const confirmed = await media.uploadClubLogo(clubId, file)
    // Store's deep watcher picks this up and PATCHes on the next tick.
    onboarding.data.logoUrl = confirmed.avatar_url
    uploadState.value = 'idle'
  } catch (err) {
    uploadState.value = 'error'
    uploadError.value = err instanceof Error ? err.message : 'Upload failed'
    // Roll the preview back to whatever the server had (if anything).
    if (localPreview.value) {
      URL.revokeObjectURL(localPreview.value)
      localPreview.value = null
    }
  }
}

function goNext() {
  router.push({ name: 'onboarding-step-6' })
}
</script>

<template>
  <div class="page">
    <WizardHeader
      :step="5"
      title="Brand"
      description="A logo, one accent colour, and a short tagline. This is what members see across your CRM, your public site, and Torny apps."
    />

    <form class="form" @submit.prevent="goNext">
      <div class="brand-row">
        <div class="card">
          <div class="field__label">Logo</div>
          <div class="logo">
            <div
              class="logo__drop"
              :class="{ 'logo__drop--has-image': !!logoPreviewUrl }"
              @click="openPicker"
              role="button"
              tabindex="0"
            >
              <img v-if="logoPreviewUrl" :src="logoPreviewUrl" alt="Club logo preview" />
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M12 5v14M5 12h14" /></svg>
              <span v-if="uploadState === 'uploading'" class="logo__spinner" aria-hidden="true" />
            </div>
            <div class="logo__body">
              <div class="logo__title">{{ onboarding.data.logoName ? 'Change logo' : 'Upload logo' }}</div>
              <div class="logo__hint">{{ onboarding.data.logoName || 'PNG, JPG, GIF, or WebP · square works best · at least 400×400 · ≤ 10 MB' }}</div>
              <div class="logo__actions">
                <button
                  type="button"
                  class="logo__btn"
                  :disabled="uploadState === 'uploading'"
                  @click="openPicker"
                >
                  {{ uploadState === 'uploading' ? 'Uploading…' : 'Choose file' }}
                </button>
                <span v-if="uploadState === 'uploading'" class="logo__status">Uploading to Cloudflare…</span>
                <span v-else-if="onboarding.data.logoUrl && uploadState === 'idle'" class="logo__status logo__status--ok">Saved</span>
              </div>
              <div v-if="uploadState === 'error' && uploadError" class="logo__error" role="alert">
                {{ uploadError }}
              </div>
              <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden @change="onFile" />
            </div>
          </div>
        </div>
        <div class="card card--preview">
          <div class="field__label">Preview</div>
          <div class="preview" :style="{ background: onboarding.data.accentColour + '14', borderColor: onboarding.data.accentColour + '33' }">
            <span class="preview__mark" :style="{ background: onboarding.data.accentColour }">
              <span class="preview__mark-dot" />
            </span>
            <span class="preview__wordmark">{{ wordmark }}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="accent-head">
          <div>
            <div class="field__label">Accent colour</div>
            <div class="accent-sub">Used on buttons, links, and highlights across your site.</div>
          </div>
          <div class="hex">
            <span class="hex__swatch" :style="{ background: onboarding.data.accentColour }" />
            <span class="hex__code">{{ onboarding.data.accentColour.toUpperCase() }}</span>
          </div>
        </div>
        <div class="swatches">
          <button
            v-for="c in swatches"
            :key="c"
            type="button"
            class="swatch"
            :class="{ 'is-on': onboarding.data.accentColour.toLowerCase() === c.toLowerCase() }"
            :style="{ background: c, '--ring': c }"
            @click="onboarding.data.accentColour = c"
          />
          <label class="swatch swatch--custom">
            <span>#</span>
            <input type="color" v-model="onboarding.data.accentColour" />
          </label>
        </div>
      </div>

      <label class="field">
        <div class="field-head">
          <span class="field__label">Tagline</span>
          <span class="field__count">{{ onboarding.data.tagline.length }} / 80</span>
        </div>
        <input v-model="onboarding.data.tagline" maxlength="80" class="tagline" placeholder="Wellington's home for social bowls since 1898." />
        <span class="field__hint">One short line. Appears under your club name on the site.</span>
      </label>
    </form>

    <WizardFooter
      backTo="onboarding-step-4"
      skipTo="onboarding-step-6"
      :disabled="!canContinue"
      @continue="goNext"
    />
  </div>
</template>

<style scoped>
.page { max-width: 720px; margin: 0 auto; }
.form { display: flex; flex-direction: column; gap: 20px; }
.field__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }

.brand-row { display: grid; grid-template-columns: 1fr 260px; gap: 20px; }
.card { padding: 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }
.card--preview { display: flex; flex-direction: column; gap: 12px; }

.logo { display: flex; align-items: center; gap: 16px; margin-top: 12px; }
.logo__drop { position: relative; width: 84px; height: 84px; border-radius: 16px; background: var(--color-surface); border: 1px dashed var(--color-hairline); display: inline-flex; align-items: center; justify-content: center; color: var(--color-mute); cursor: pointer; flex-shrink: 0; overflow: hidden; }
.logo__drop:hover { border-color: var(--color-accent); color: var(--color-accent); }
.logo__drop--has-image { border-style: solid; background: #fff; }
.logo__drop img { width: 100%; height: 100%; object-fit: contain; }
.logo__spinner { position: absolute; inset: 0; background: rgba(255,255,255,0.72); display: flex; align-items: center; justify-content: center; }
.logo__spinner::after { content: ''; width: 22px; height: 22px; border-radius: 999px; border: 2px solid var(--color-hairline); border-top-color: var(--color-accent); animation: logo-spin 0.9s linear infinite; }
@keyframes logo-spin { to { transform: rotate(360deg); } }
.logo__body { flex: 1; min-width: 0; }
.logo__title { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--color-ink); }
.logo__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 4px; }
.logo__actions { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
.logo__btn { padding: 8px 14px; background: var(--color-ink); color: #fff; border: 0; border-radius: 8px; font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; }
.logo__btn:disabled { opacity: 0.6; cursor: not-allowed; }
.logo__status { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.logo__status--ok { color: #16A34A; font-weight: 600; }
.logo__error { margin-top: 8px; padding: 8px 10px; background: #FEE2E2; border: 1px solid #FCA5A5; border-radius: 8px; font-family: var(--font-body); font-size: 12px; color: #991B1B; }

.preview { height: 84px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; width: 100%; gap: 10px; border: 1px solid; }
.preview__mark { width: 28px; height: 28px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; }
.preview__mark-dot { width: 8px; height: 8px; border-radius: 999px; background: rgba(255,255,255,0.6); }
.preview__wordmark { font-family: var(--font-display); font-size: 17px; font-weight: 700; color: var(--color-ink); }

.accent-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 14px; }
.accent-sub { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 4px; }
.hex { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--color-surface); border-radius: 10px; flex-shrink: 0; }
.hex__swatch { width: 16px; height: 16px; border-radius: 4px; border: 1px solid rgba(0,0,0,0.06); }
.hex__code { font-family: var(--font-mono); font-size: 12px; color: var(--color-ink); font-weight: 600; }

.swatches { display: flex; gap: 10px; flex-wrap: wrap; }
.swatch { width: 42px; height: 42px; border-radius: 10px; border: 0; padding: 0; cursor: pointer; position: relative; transition: transform 0.1s ease; }
.swatch:hover { transform: scale(1.05); }
.swatch.is-on { box-shadow: 0 0 0 3px #fff, 0 0 0 5px var(--ring, var(--color-ink)); }
.swatch--custom { background: transparent; border: 1px dashed var(--color-hairline); display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 12px; color: var(--color-fog); position: relative; overflow: hidden; }
.swatch--custom input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }

.field { display: flex; flex-direction: column; gap: 8px; }
.field-head { display: flex; justify-content: space-between; align-items: baseline; }
.field__count { font-family: var(--font-mono); font-size: 10px; color: var(--color-mute); }
.tagline { padding: 14px 16px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; font-family: var(--font-display); font-size: 17px; color: var(--color-ink); font-weight: 500; }
.tagline:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.field__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-mute); }

@media (max-width: 900px) {
  .brand-row { grid-template-columns: 1fr; }
}

@media (max-width: 640px) {
  .card { padding: 16px; }
  .logo { flex-direction: column; align-items: stretch; gap: 12px; }
  .logo__drop { width: 100%; height: 120px; }
  .swatches { gap: 8px; }
  .swatch { width: 36px; height: 36px; }
  .accent-head { flex-direction: column; align-items: stretch; gap: 12px; }
  .hex { align-self: flex-start; }
  .preview { height: 70px; }
}
</style>
