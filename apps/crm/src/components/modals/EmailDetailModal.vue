<script setup lang="ts">
/**
 * EmailDetailModal — one email, re-read.
 *
 * Fetches GET /communications/{batch_id}?user_id={uid}&limit=1 and renders
 * the batch metadata + the specific recipient's delivery timeline + the
 * fully-rendered email in a sandboxed iframe. Falls back to a "body not
 * retained" panel for historical rows (batch_id ≤ 4 pre-mig-128, or
 * transactional sends that never got a batch row).
 */
import { ref, watch } from 'vue'
import {
  communications as communicationsApi,
  ApiError,
  type BatchDetail,
  type BatchRecipient,
  type EmailStatus,
} from '@torny/api-client'
import CrmModal from '@/components/modals/CrmModal.vue'
import CrmSkeleton from '@/components/CrmSkeleton.vue'

const props = defineProps<{
  open: boolean
  clubId: number | null
  userId: number | null
  batchId: number | null
  /** Fallback metadata from the per-member feed row — used to render the
   *  timeline strip even when `batch_not_found` hits (historical sends). */
  fallback?: {
    subject: string | null
    sent_at: string | null
    sent_by_name: string | null
    status: string | null
    failure_reason: string | null
    delivered_at: string | null
    opened_at: string | null
    open_count: number | null
    bounced_at: string | null
    complained_at: string | null
  } | null
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const detail = ref<BatchDetail | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
/** True when the batch endpoint returned 404 — historical / transactional
 *  sends don't persist bodies, but we can still show the timeline from the
 *  per-member feed row the parent handed down as `fallback`. */
const bodyMissing = ref(false)
const sourceMode = ref<'preview' | 'source'>('preview')

async function load() {
  const cid = props.clubId
  const uid = props.userId
  const bid = props.batchId
  detail.value = null
  error.value = null
  bodyMissing.value = false
  sourceMode.value = 'preview'
  if (cid == null || uid == null || bid == null) return
  loading.value = true
  try {
    detail.value = await communicationsApi.getBatch(cid, bid, { user_id: uid, limit: 1 })
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      bodyMissing.value = true
    } else {
      error.value = err instanceof Error ? err.message : 'Could not load the email.'
    }
  } finally {
    loading.value = false
  }
}

watch(() => props.open, (isOpen) => { if (isOpen) void load() })
watch(() => props.batchId, () => { if (props.open) void load() })

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  day: 'numeric', month: 'short', year: 'numeric',
})
const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric', minute: '2-digit',
})
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : DATE_FMT.format(d)
}
function fmtTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : TIME_FMT.format(d)
}

interface TimelineChip {
  key: string
  label: string
  time: string
  tone: 'ok' | 'engaged' | 'fail' | 'pending'
  suffix?: string
}

function buildTimeline(row: BatchRecipient | null, fallback: typeof props.fallback): TimelineChip[] {
  const r = row ?? fallback
  if (!r) return []
  const status = (row?.status ?? fallback?.status) as EmailStatus | string | null
  const chips: TimelineChip[] = []
  if (r.sent_at) {
    chips.push({ key: 'sent', label: 'Sent', time: fmtTime(r.sent_at), tone: 'ok' })
  }
  if (r.delivered_at) {
    chips.push({ key: 'delivered', label: 'Delivered', time: fmtTime(r.delivered_at), tone: 'ok' })
  }
  if (r.opened_at) {
    const count = (row?.open_count ?? fallback?.open_count ?? 0) as number
    chips.push({
      key: 'opened',
      label: 'Opened',
      time: fmtTime(r.opened_at),
      tone: 'engaged',
      suffix: count > 1 ? `${count}×` : undefined,
    })
  }
  if (r.bounced_at || status === 'bounced') {
    chips.push({
      key: 'bounced',
      label: 'Bounced',
      time: fmtTime(r.bounced_at ?? null),
      tone: 'fail',
      suffix: (row?.status_reason ?? fallback?.failure_reason) || undefined,
    })
  }
  if (r.complained_at || status === 'complained') {
    chips.push({
      key: 'complained',
      label: 'Complained',
      time: fmtTime(r.complained_at ?? null),
      tone: 'fail',
    })
  }
  if (chips.length === 0 && status) {
    chips.push({ key: 'status', label: String(status), time: '', tone: 'pending' })
  }
  return chips
}
</script>

<template>
  <CrmModal
    :open="open"
    eyebrow="Email"
    :title="(detail?.subject ?? fallback?.subject) || 'Email detail'"
    width="xl"
    @close="emit('close')"
  >
    <div v-if="loading" class="email-detail__loading">
      <CrmSkeleton shape="text" width="60%" height="14px" />
      <CrmSkeleton shape="text" width="80%" height="14px" />
      <CrmSkeleton shape="text" width="40%" height="14px" />
      <CrmSkeleton width="100%" height="320px" radius="12px" />
    </div>

    <div v-else-if="error" class="email-detail__panel email-detail__panel--error">
      <div class="email-detail__panel-title">Couldn't load this email</div>
      <p class="email-detail__panel-body">{{ error }}</p>
    </div>

    <template v-else>
      <!-- Meta line: sender + sent timestamp -->
      <div class="email-detail__meta">
        <template v-if="detail?.sender?.name || fallback?.sent_by_name">
          <span class="email-detail__meta-label">From</span>
          <span class="email-detail__meta-value">{{ detail?.sender?.name ?? fallback?.sent_by_name }}</span>
          <span v-if="detail?.sender?.label" class="email-detail__meta-aside">· via {{ detail.sender.label }}</span>
        </template>
        <span class="email-detail__meta-sep">·</span>
        <span class="email-detail__meta-value">
          Sent {{ fmtDate(detail?.created_at ?? fallback?.sent_at) }}<template v-if="(detail?.created_at ?? fallback?.sent_at)">, {{ fmtTime(detail?.created_at ?? fallback?.sent_at) }}</template>
        </span>
        <span v-if="detail?.your_row?.email" class="email-detail__meta-pill">To {{ detail.your_row.name ?? '—' }} · {{ detail.your_row.email }}</span>
      </div>

      <!-- Timeline strip -->
      <div class="email-detail__timeline">
        <template v-for="chip in buildTimeline(detail?.your_row ?? null, fallback ?? null)" :key="chip.key">
          <div class="email-detail__chip" :class="`email-detail__chip--${chip.tone}`">
            <svg v-if="chip.tone === 'ok'" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M13 4L6 11l-3-3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <svg v-else-if="chip.tone === 'engaged'" width="14" height="12" viewBox="0 0 16 12" fill="none" aria-hidden="true">
              <path d="M1 6s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.6"/>
              <circle cx="8" cy="6" r="2" fill="currentColor"/>
            </svg>
            <svg v-else-if="chip.tone === 'fail'" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
            </svg>
            <span>{{ chip.label }}</span>
            <span v-if="chip.time" class="email-detail__chip-time">{{ chip.time }}</span>
            <span v-if="chip.suffix" class="email-detail__chip-suffix">· {{ chip.suffix }}</span>
          </div>
        </template>
      </div>

      <!-- Body or missing panel -->
      <div v-if="bodyMissing" class="email-detail__panel email-detail__panel--muted">
        <div class="email-detail__panel-title">Email body not retained</div>
        <p class="email-detail__panel-body">
          This message was sent before 30 Oct 2026 or through a transactional send path (welcome, invite, enquiry
          reply) that doesn't persist the body. The timeline above still reflects what SES reported.
        </p>
      </div>

      <template v-else-if="detail">
        <div class="email-detail__source-toggle">
          <button
            type="button"
            class="email-detail__toggle"
            :class="{ 'is-active': sourceMode === 'preview' }"
            @click="sourceMode = 'preview'"
          >Rendered</button>
          <button
            type="button"
            class="email-detail__toggle"
            :class="{ 'is-active': sourceMode === 'source' }"
            @click="sourceMode = 'source'"
          >Source</button>
        </div>
        <div class="email-detail__frame-wrap">
          <iframe
            v-if="sourceMode === 'preview'"
            class="email-detail__frame"
            sandbox="allow-same-origin"
            :srcdoc="detail.preview_html"
            title="Rendered email preview"
          />
          <pre v-else class="email-detail__source">{{ detail.body_html }}</pre>
        </div>
      </template>
    </template>
  </CrmModal>
</template>

<style scoped>
.email-detail__loading { display: flex; flex-direction: column; gap: 10px; }

.email-detail__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
  padding: 4px 0 16px;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-fog);
}
.email-detail__meta-label {
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-mute);
}
.email-detail__meta-value { color: var(--color-ink); font-weight: 500; }
.email-detail__meta-aside { color: var(--color-fog); }
.email-detail__meta-sep { color: var(--color-mute); }
.email-detail__meta-pill {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-ink);
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 500;
}

.email-detail__timeline {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 14px 16px;
  margin-bottom: 20px;
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  background: var(--color-surface);
}
.email-detail__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink);
}
.email-detail__chip--ok      { color: #14532D; }
.email-detail__chip--engaged { color: #1E40AF; }
.email-detail__chip--fail    { color: #991B1B; background: #FEE2E2; border-color: transparent; }
.email-detail__chip--pending { color: var(--color-fog); }
.email-detail__chip-time { font-family: var(--font-mono); font-weight: 500; letter-spacing: 0.02em; }
.email-detail__chip-suffix { color: var(--color-fog); font-weight: 500; }

.email-detail__panel {
  padding: 14px 16px;
  border-radius: 12px;
  font-family: var(--font-body);
}
.email-detail__panel--muted {
  background: var(--color-surface);
  border: 1px dashed var(--color-hairline);
}
.email-detail__panel--error {
  background: #FEE2E2;
  color: #991B1B;
}
.email-detail__panel-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-ink);
  margin-bottom: 4px;
}
.email-detail__panel--error .email-detail__panel-title { color: inherit; }
.email-detail__panel-body { margin: 0; font-size: 13px; line-height: 1.5; color: var(--color-fog); }
.email-detail__panel--error .email-detail__panel-body { color: inherit; }

.email-detail__source-toggle {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  margin-bottom: 10px;
  border-radius: 999px;
  background: var(--color-surface);
  border: 1px solid var(--color-hairline);
}
.email-detail__toggle {
  padding: 4px 12px;
  border: 0;
  background: transparent;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-fog);
  cursor: pointer;
}
.email-detail__toggle.is-active { background: #fff; color: var(--color-ink); }

.email-detail__frame-wrap {
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
}
.email-detail__frame {
  display: block;
  width: 100%;
  height: 480px;
  border: 0;
  background: #fff;
}
.email-detail__source {
  margin: 0;
  padding: 14px 16px;
  max-height: 480px;
  overflow: auto;
  background: #0A0A0B;
  color: #E5E7EB;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-wrap: break-word;
}
</style>
