<script setup lang="ts">
/**
 * Reusable image picker.
 *
 * Two modes, chosen at prop level:
 *
 *   1. Block-scoped (page builder) — pass `pageSlug` + `blockId`. Uploads
 *      go through the block-images API (brief 18): upload-url → CF POST
 *      → confirm. Emits both `update:modelValue` (public URL) and
 *      `update:imageId` (row id) so the parent can track ownership for
 *      later PATCH/DELETE.
 *
 *   2. Legacy club-scoped — omit `pageSlug` and `blockId`. Uploads use
 *      the old `media.uploadClubImage()` flow. Used by the club logo /
 *      avatar picker and anywhere that isn't a block prop yet.
 *
 * v-modelled on the URL string. `v-model:imageId` gets you the row id
 * for block-scoped mode. Empty string / null / undefined = no image.
 */
import { ref, computed } from 'vue'
import {
  blockImages,
  media,
  ApiError,
  type MediaContentType,
  type PageSlug,
} from '@torny/api-client'
import { useClubStore } from '@/stores/club'

const props = withDefaults(defineProps<{
  modelValue: string | null | undefined
  /** Row id from the block-images API. Optional; only set in block-scoped mode. */
  imageId?: number | null
  /** Passing pageSlug + blockId switches on block-scoped upload. */
  pageSlug?: PageSlug
  blockId?: string
  /** Alt text saved with the image on `confirm`. Only applied in block-scoped mode. */
  alt?: string
  caption?: string
  /** Cloudflare content_type slot for the legacy club-scoped flow. */
  contentType?: MediaContentType
  aspect?: string
  maxSizeMb?: number
  label?: string
  hint?: string
}>(), {
  imageId: null,
  contentType: 'media',
  aspect: '16 / 9',
  maxSizeMb: 10,
  label: '',
  hint: '',
  alt: '',
  caption: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:imageId': [value: number | null]
}>()

const clubStore = useClubStore()
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const error = ref<string | null>(null)
const localPreview = ref<string | null>(null)

const previewUrl = computed(() => localPreview.value ?? props.modelValue ?? null)

const isBlockScoped = computed(() => Boolean(props.pageSlug && props.blockId))

const ACCEPTED = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml'
const ACCEPTED_MIME = new Set(ACCEPTED.split(','))

function openPicker() {
  if (uploading.value) return
  fileInput.value?.click()
}

async function onFile(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
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

  if (localPreview.value) URL.revokeObjectURL(localPreview.value)
  localPreview.value = URL.createObjectURL(file)
  uploading.value = true

  try {
    if (isBlockScoped.value) {
      // Replace-on-upload: soft-delete the previous image so the block
      // doesn't leave orphans hanging around before publish reconciles.
      const prevId = props.imageId
      const confirmed = await blockImages.upload(clubId, props.pageSlug!, props.blockId!, file, {
        alt: props.alt,
        caption: props.caption,
      })
      if (prevId != null) {
        // Fire-and-forget — a failed delete here isn't user-facing.
        blockImages
          .remove(clubId, props.pageSlug!, props.blockId!, prevId)
          .catch(() => { /* ignore */ })
      }
      emit('update:modelValue', confirmed.public_url)
      emit('update:imageId', confirmed.id)
    } else {
      const confirmed = await media.uploadClubImage(clubId, file, {
        contentType: props.contentType,
      })
      emit('update:modelValue', confirmed.public_url)
    }
  } catch (err) {
    if (err instanceof ApiError) {
      error.value = err.code === 'too_many_images'
        ? 'This block already has 20 images — remove one first.'
        : err.status === 403
          ? "You don't have permission to upload images for this club."
          : (err.message || 'Upload failed')
    } else {
      error.value = err instanceof Error ? err.message : 'Upload failed'
    }
    if (localPreview.value) URL.revokeObjectURL(localPreview.value)
    localPreview.value = null
  } finally {
    uploading.value = false
  }
}

async function remove() {
  if (uploading.value) return
  const clubId = clubStore.current?.id
  const prevId = props.imageId

  if (localPreview.value) URL.revokeObjectURL(localPreview.value)
  localPreview.value = null
  error.value = null

  emit('update:modelValue', '')
  emit('update:imageId', null)

  // Best-effort clean up server-side. Publish reconciliation would catch
  // this eventually — this just makes it immediate.
  if (isBlockScoped.value && typeof clubId === 'number' && prevId != null) {
    try {
      await blockImages.remove(clubId, props.pageSlug!, props.blockId!, prevId)
    } catch { /* ignore */ }
  }
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
