<script setup lang="ts">
/**
 * Reusable image picker. Handles the full Cloudflare direct-upload dance:
 * request URL → POST file to CF → confirm → emit final CDN URL.
 *
 * v-model'd on the URL string. Empty string / null / undefined = no image.
 * Aspect prop controls the preview shape (e.g. `16 / 9` for hero, `1` for
 * square logo, `4 / 3` for gallery thumbnails).
 */
import { ref, computed } from 'vue'
import { media, ApiError, type MediaContentType } from '@torny/api-client'
import { useClubStore } from '@/stores/club'

const props = withDefaults(defineProps<{
  modelValue: string | null | undefined
  /** Cloudflare content_type slot — `banner` for hero, `gallery` for photos, `media` for anything else. */
  contentType?: MediaContentType
  /** CSS aspect-ratio for the preview area. */
  aspect?: string
  /** Max file size in MB (rejected client-side before upload). */
  maxSizeMb?: number
  /** Optional label rendered above the picker. */
  label?: string
  /** Free-text hint under the label. */
  hint?: string
}>(), {
  contentType: 'media',
  aspect: '16 / 9',
  maxSizeMb: 10,
  label: '',
  hint: '',
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const clubStore = useClubStore()
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const error = ref<string | null>(null)
const localPreview = ref<string | null>(null)

// Prefer a fresh local preview (from URL.createObjectURL) while uploading —
// falls back to the confirmed CDN URL after the upload lands.
const previewUrl = computed(() => localPreview.value ?? props.modelValue ?? null)

const ACCEPTED = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml'
const ACCEPTED_MIME = new Set(ACCEPTED.split(','))

function openPicker() {
  if (uploading.value) return
  fileInput.value?.click()
}

async function onFile(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  // Reset the input so the same file can be re-picked after an error.
  target.value = ''
  if (!file) return

  error.value = null

  if (!ACCEPTED_MIME.has(file.type)) {
    error.value = 'Please pick a PNG, JPG, GIF, WebP, or SVG.'
    return
  }
  if (file.size > props.maxSizeMb * 1024 * 1024) {
    error.value = `Keep it under ${props.maxSizeMb} MB.`
    return
  }

  const clubId = clubStore.current?.id
  if (clubId == null || typeof clubId !== 'number') {
    error.value = 'No active club — refresh and try again.'
    return
  }

  // Swap in the local object-URL preview immediately for perceived responsiveness.
  if (localPreview.value) URL.revokeObjectURL(localPreview.value)
  localPreview.value = URL.createObjectURL(file)
  uploading.value = true

  try {
    const confirmed = await media.uploadClubImage(clubId, file, {
      contentType: props.contentType,
    })
    // Prefer public_url; the confirmed shape also exposes thumbnail_url / avatar_url.
    emit('update:modelValue', confirmed.public_url)
  } catch (err) {
    if (err instanceof ApiError) {
      error.value = err.status === 403
        ? "You don't have permission to upload images for this club."
        : (err.message || 'Upload failed')
    } else {
      error.value = err instanceof Error ? err.message : 'Upload failed'
    }
    // Roll the preview back to whatever was previously stored (may be null).
    if (localPreview.value) URL.revokeObjectURL(localPreview.value)
    localPreview.value = null
  } finally {
    uploading.value = false
  }
}

function remove() {
  if (uploading.value) return
  if (localPreview.value) URL.revokeObjectURL(localPreview.value)
  localPreview.value = null
  error.value = null
  emit('update:modelValue', '')
}
</script>

<template>
  <div class="picker">
    <div v-if="label" class="picker__label">{{ label }}</div>

    <button
      type="button"
      class="picker__frame"
      :class="{ 'picker__frame--empty': !previewUrl, 'picker__frame--busy': uploading }"
      :style="{ aspectRatio: aspect } as any"
      :disabled="uploading"
      @click="openPicker"
    >
      <img v-if="previewUrl" :src="previewUrl" alt="" class="picker__img" />
      <div v-else class="picker__prompt">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span>Add image</span>
      </div>
      <span v-if="uploading" class="picker__spinner" aria-label="Uploading" />
    </button>

    <input ref="fileInput" type="file" :accept="ACCEPTED" hidden @change="onFile" />

    <div class="picker__actions">
      <button type="button" class="picker__btn" :disabled="uploading" @click="openPicker">
        {{ uploading ? 'Uploading…' : previewUrl ? 'Replace' : 'Choose file' }}
      </button>
      <button v-if="previewUrl && !uploading" type="button" class="picker__remove" @click="remove">Remove</button>
    </div>

    <div v-if="hint && !error" class="picker__hint">{{ hint }}</div>
    <div v-if="error" class="picker__error" role="alert">{{ error }}</div>
  </div>
</template>

<style scoped>
.picker { display: flex; flex-direction: column; gap: 8px; }
.picker__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-fog); }

.picker__frame { position: relative; width: 100%; padding: 0; background: var(--color-surface); border: 1px dashed var(--color-hairline); border-radius: 10px; overflow: hidden; cursor: pointer; color: var(--color-fog); transition: border-color 0.12s ease, background-color 0.12s ease; }
.picker__frame:hover:not(:disabled) { border-color: var(--color-accent); color: var(--color-accent); background: color-mix(in oklab, var(--color-accent) 6%, var(--color-surface)); }
.picker__frame--empty { border-style: dashed; }
.picker__frame:not(.picker__frame--empty) { border-style: solid; }
.picker__frame--busy { cursor: wait; }
.picker__img { width: 100%; height: 100%; object-fit: cover; display: block; }
.picker__prompt { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; width: 100%; height: 100%; font-family: var(--font-body); font-size: 12px; }
.picker__spinner { position: absolute; top: 8px; right: 8px; width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff; border-radius: 999px; animation: pkr-spin 0.8s linear infinite; background: rgba(0,0,0,0.35); box-sizing: border-box; }
@keyframes pkr-spin { to { transform: rotate(360deg); } }

.picker__actions { display: flex; align-items: center; gap: 10px; }
.picker__btn { padding: 7px 12px; background: var(--color-ink); color: #fff; border: 0; border-radius: 8px; font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; }
.picker__btn:hover:not(:disabled) { background: var(--color-graphite); }
.picker__btn:disabled { opacity: 0.5; cursor: not-allowed; }
.picker__remove { background: transparent; border: 0; padding: 0; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-danger); cursor: pointer; }
.picker__remove:hover { text-decoration: underline; }

.picker__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }
.picker__error { padding: 8px 10px; background: #FEE2E2; color: #991B1B; border-radius: 8px; font-family: var(--font-body); font-size: 12px; }
</style>
