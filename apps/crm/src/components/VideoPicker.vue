<script setup lang="ts">
/**
 * Block-scoped video picker (brief 58). Mirrors `ImagePicker.vue`'s shape
 * but goes through the block-videos API: upload-url → CF Stream POST →
 * confirm → poll `GET /video` until the state flips to `'ready'`.
 *
 * v-modelled on the video URL string (same pattern as ImagePicker). Also
 * emits `update:thumbnailUrl` so the parent can auto-fill a poster image
 * when there isn't one — the backend's auto-generated thumbnail from
 * Stream is usually a reasonable default.
 *
 * The admin can still paste a hosted URL manually by binding the model
 * value elsewhere — this component owns the upload path only. Removing
 * via Remove calls `DELETE /video` and emits an empty string.
 */
import { ref, computed, onBeforeUnmount, onMounted, watch } from 'vue'
import {
  blockVideos,
  ApiError,
  type BlockVideo,
  type PageSlug,
} from '@torny/api-client'
import { useClubStore } from '@/stores/club'

const props = withDefaults(defineProps<{
  /** Video URL (mp4 preferred; HLS fallback written while mp4 is still
   *  rendering). Empty / null / undefined = no video. */
  modelValue: string | null | undefined
  pageSlug: PageSlug
  blockId: string
  label?: string
  hint?: string
}>(), {
  label: '',
  hint: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  /** Fired when the backend returns a Stream auto-thumbnail. Parent decides
   *  whether to use it as the block's poster image. */
  'update:thumbnailUrl': [value: string]
}>()

const clubStore = useClubStore()
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const error = ref<string | null>(null)
/** Local state transitions through: idle → uploading → processing → ready.
 *  'idle' with a modelValue set = already uploaded (restored from draft). */
type UiState = 'idle' | 'uploading' | 'processing' | 'ready' | 'error'
const uiState = ref<UiState>('idle')
const current = ref<BlockVideo | null>(null)
/** Human-readable filename of the file the admin just picked — not stored
 *  server-side, lost on reload. Shown in the filled state. */
const localFilename = ref<string | null>(null)

/** Poll handle so we can clear on unmount / state change. */
let pollTimer: ReturnType<typeof setTimeout> | null = null
/** Poll start time — we give up after 2 min to avoid a stuck chip if
 *  Stream silently errors. */
let pollStartMs = 0
const POLL_TIMEOUT_MS = 2 * 60 * 1000

const ACCEPTED = 'video/mp4,video/webm,video/quicktime'
const ACCEPTED_MIME = new Set(ACCEPTED.split(','))
const MAX_BYTES_DEFAULT = 50 * 1024 * 1024
const MAX_DURATION_DEFAULT = 60

/** Format bytes as "18 MB" / "900 KB" — rough but readable. */
function fmtBytes(n: number | null | undefined): string {
  if (!n) return ''
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}
function fmtDuration(n: number | null | undefined): string {
  if (!n) return ''
  return `${Math.round(n)}s`
}
function fmtResolution(w: number | null | undefined, h: number | null | undefined): string {
  if (!w || !h) return ''
  if (h >= 2000) return '4K'
  if (h >= 1080) return '1080p'
  if (h >= 720) return '720p'
  if (h >= 480) return '480p'
  return `${w}×${h}`
}

const summary = computed(() => {
  if (!current.value && !localFilename.value && !props.modelValue) return null
  const bits: string[] = []
  if (localFilename.value) bits.push(localFilename.value)
  if (current.value) {
    if (current.value.bytes) bits.push(fmtBytes(current.value.bytes))
    if (current.value.durationSeconds) bits.push(fmtDuration(current.value.durationSeconds))
    const res = fmtResolution(current.value.widthPx, current.value.heightPx)
    if (res) bits.push(res)
  }
  return bits.join(' · ') || 'Video attached'
})

/** On mount, if the block already has a videoUrl, GET /video to resolve
 *  the full metadata. Silently falls back to showing the URL alone if the
 *  GET 404s (admin pasted an external URL instead of uploading). */
onMounted(() => {
  if (props.modelValue && !current.value) {
    void refreshFromServer({ silent: true })
  }
})

watch(
  () => props.blockId,
  () => {
    // Block ID can shift when the admin reorders blocks — reset local
    // state so we don't show the wrong metadata.
    stopPolling()
    current.value = null
    localFilename.value = null
    error.value = null
    uiState.value = props.modelValue ? 'ready' : 'idle'
  },
)

onBeforeUnmount(() => stopPolling())

async function refreshFromServer(opts: { silent?: boolean } = {}): Promise<void> {
  const clubId = clubStore.current?.id
  if (typeof clubId !== 'number') return
  try {
    const video = await blockVideos.get(clubId, props.pageSlug, props.blockId)
    applyVideo(video)
  } catch (err) {
    if (opts.silent) return
    if (err instanceof ApiError && err.status === 404) {
      // No server-side row — admin probably pasted an external URL.
      uiState.value = props.modelValue ? 'ready' : 'idle'
      return
    }
    error.value = err instanceof Error ? err.message : 'Failed to load video.'
  }
}

function applyVideo(video: BlockVideo) {
  current.value = video
  if (video.state === 'ready') {
    uiState.value = 'ready'
    stopPolling()
    const url = video.mp4Url || video.hlsUrl
    if (url && url !== props.modelValue) emit('update:modelValue', url)
    if (video.thumbnailUrl) emit('update:thumbnailUrl', video.thumbnailUrl)
  } else if (video.state === 'processing') {
    uiState.value = 'processing'
    scheduleNextPoll()
    // Still emit the HLS URL immediately so a parent that supports HLS can
    // start showing something; the MP4 URL will replace it on next poll.
    if (video.hlsUrl && video.hlsUrl !== props.modelValue) {
      emit('update:modelValue', video.hlsUrl)
    }
    if (video.thumbnailUrl) emit('update:thumbnailUrl', video.thumbnailUrl)
  } else {
    uiState.value = 'error'
    stopPolling()
    error.value = 'Stream reported an error on this video. Try uploading again.'
  }
}

function scheduleNextPoll() {
  stopPolling()
  if (Date.now() - pollStartMs > POLL_TIMEOUT_MS) {
    uiState.value = 'error'
    error.value = "Transcoding is taking longer than expected. Try again, or refresh in a minute."
    return
  }
  pollTimer = setTimeout(() => {
    void refreshFromServer({ silent: true }).then(() => {
      // refreshFromServer calls applyVideo which schedules the next tick
      // if still processing.
    })
  }, 3000)
}
function stopPolling() {
  if (pollTimer != null) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

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
    error.value = 'Please pick an .mp4, .webm, or .mov file.'
    return
  }
  if (file.size > MAX_BYTES_DEFAULT) {
    error.value = `Keep it under ${Math.round(MAX_BYTES_DEFAULT / 1024 / 1024)} MB (yours is ${fmtBytes(file.size)}).`
    return
  }

  const clubId = clubStore.current?.id
  if (typeof clubId !== 'number') {
    error.value = 'No active club — refresh and try again.'
    return
  }

  uploading.value = true
  uiState.value = 'uploading'
  localFilename.value = file.name
  pollStartMs = Date.now()

  try {
    const video = await blockVideos.upload(clubId, props.pageSlug, props.blockId, file)
    applyVideo(video)
  } catch (err) {
    uiState.value = 'error'
    localFilename.value = null
    if (err instanceof ApiError) {
      switch (err.code) {
        case 'file_too_large':
          error.value = `Video is over the ${Math.round(MAX_BYTES_DEFAULT / 1024 / 1024)} MB limit.`
          break
        case 'duration_too_long':
          error.value = `Video is longer than ${MAX_DURATION_DEFAULT} seconds. Trim it and try again.`
          break
        case 'stream_not_found':
          error.value = 'Upload didn\'t register — try again in a moment.'
          break
        case 'unknown_page_slug':
          error.value = 'This page isn\'t set up yet. Save the page first.'
          break
        default:
          error.value = err.message || 'Upload failed.'
      }
    } else {
      error.value = err instanceof Error ? err.message : 'Upload failed.'
    }
  } finally {
    uploading.value = false
  }
}

async function remove() {
  if (uploading.value) return
  const clubId = clubStore.current?.id

  stopPolling()
  current.value = null
  localFilename.value = null
  error.value = null
  uiState.value = 'idle'
  emit('update:modelValue', '')

  // Best-effort cleanup on the backend. If this fails (e.g. network blip),
  // the sweeper eventually catches orphans — we don't surface the error.
  if (typeof clubId === 'number') {
    try {
      await blockVideos.remove(clubId, props.pageSlug, props.blockId)
    } catch {
      /* ignore */
    }
  }
}

const showEmpty    = computed(() => uiState.value === 'idle' && !props.modelValue)
const showBusy     = computed(() => uiState.value === 'uploading' || uiState.value === 'processing')
const showReady    = computed(() => uiState.value === 'ready' || (uiState.value === 'idle' && !!props.modelValue))
</script>

<template>
  <div class="vpk">
    <div v-if="label" class="vpk__label">{{ label }}</div>

    <!-- Empty state — invites a file pick -->
    <button
      v-if="showEmpty"
      type="button"
      class="vpk__frame vpk__frame--empty"
      @click="openPicker"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
      <div class="vpk__prompt">
        <div class="vpk__prompt-title">Upload background video</div>
        <div class="vpk__prompt-sub">.mp4 · .webm · .mov · up to 50 MB · 60s</div>
      </div>
    </button>

    <!-- Busy state — uploading or processing on Stream -->
    <div v-else-if="showBusy" class="vpk__frame vpk__frame--busy">
      <span class="vpk__spinner" aria-hidden="true" />
      <div class="vpk__prompt">
        <div class="vpk__prompt-title">
          {{ uiState === 'uploading' ? 'Uploading…' : 'Processing — ready in ~20s' }}
        </div>
        <div v-if="localFilename" class="vpk__prompt-sub">{{ localFilename }}</div>
      </div>
    </div>

    <!-- Filled state — mp4Url (or hls fallback) in modelValue -->
    <div v-else-if="showReady" class="vpk__frame vpk__frame--filled">
      <div class="vpk__icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <polygon points="5,3 5,13 13,8" fill="currentColor" />
        </svg>
      </div>
      <div class="vpk__prompt">
        <div class="vpk__prompt-title">{{ summary ?? 'Video attached' }}</div>
        <div v-if="current && !localFilename" class="vpk__prompt-sub">Stream · {{ current.cloudflareVideoId.slice(0, 8) }}…</div>
      </div>
      <div class="vpk__frame-actions">
        <button type="button" class="vpk__chip" @click="openPicker">Change</button>
        <button type="button" class="vpk__chip vpk__chip--danger" @click="remove">Remove</button>
      </div>
    </div>

    <!-- Error state — picker inert, admin can retry -->
    <div v-else-if="uiState === 'error'" class="vpk__frame vpk__frame--error">
      <div class="vpk__prompt">
        <div class="vpk__prompt-title">Something went wrong</div>
        <div class="vpk__prompt-sub">{{ error ?? 'Try again.' }}</div>
      </div>
      <div class="vpk__frame-actions">
        <button type="button" class="vpk__chip" @click="openPicker">Try again</button>
      </div>
    </div>

    <input ref="fileInput" type="file" :accept="ACCEPTED" hidden @change="onFile" />

    <div v-if="hint && !error" class="vpk__hint">{{ hint }}</div>
    <div v-if="error && uiState !== 'error'" class="vpk__error" role="alert">{{ error }}</div>
  </div>
</template>

<style scoped>
.vpk { display: flex; flex-direction: column; gap: 8px; }
.vpk__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-fog); }

.vpk__frame {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 14px 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-hairline);
  border-radius: 10px;
  color: var(--color-ink);
  text-align: left;
  font-family: var(--font-body);
  transition: border-color 0.12s ease, background-color 0.12s ease;
}

.vpk__frame--empty {
  cursor: pointer;
  border-style: dashed;
  color: var(--color-fog);
}
.vpk__frame--empty:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: color-mix(in oklab, var(--color-accent) 6%, var(--color-surface));
}

.vpk__frame--busy { cursor: wait; }
.vpk__frame--filled { background: #fff; }
.vpk__frame--error {
  background: #FEF2F2;
  border-color: #FCA5A5;
}
.vpk__frame--error .vpk__prompt-title { color: #991B1B; }

.vpk__prompt { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.vpk__prompt-title {
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vpk__prompt-sub {
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--color-fog);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vpk__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  background: var(--color-ink);
  color: #fff;
  flex-shrink: 0;
}

.vpk__spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--color-hairline);
  border-top-color: var(--color-ink);
  border-radius: 999px;
  animation: vpk-spin 0.8s linear infinite;
  flex-shrink: 0;
}
@keyframes vpk-spin { to { transform: rotate(360deg); } }

.vpk__frame-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.vpk__chip {
  padding: 6px 10px;
  border: 1px solid var(--color-hairline);
  background: #fff;
  color: var(--color-ink);
  border-radius: 6px;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.vpk__chip:hover { background: var(--color-surface); }
.vpk__chip--danger { color: var(--color-danger); border-color: var(--color-danger); }
.vpk__chip--danger:hover { background: #FEF2F2; }

.vpk__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }
.vpk__error { padding: 8px 10px; background: #FEE2E2; color: #991B1B; border-radius: 8px; font-family: var(--font-body); font-size: 12px; }
</style>
