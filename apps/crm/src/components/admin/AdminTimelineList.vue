<script setup lang="ts">
/**
 * Chronological timeline for the account detail page. Renders known
 * `kind` values with specific icons + copy; unknown kinds fall back
 * to a generic chip with the raw `detail` JSON so new server-side
 * event kinds don't need an FE release (brief 123 §3).
 */
import { computed } from 'vue'
import type { AdminTimelineEvent } from '@torny/api-client'

const props = defineProps<{ events: AdminTimelineEvent[] }>()

// Sort newest first regardless of what the server returned.
const sorted = computed(() =>
  [...props.events].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
)

interface KnownKind { label: string; tone: 'default' | 'accent' | 'warn' | 'danger' }
const KNOWN: Record<string, KnownKind> = {
  signup:              { label: 'Signed up', tone: 'default' },
  plan_change:         { label: 'Plan changed', tone: 'accent' },
  addon_added:         { label: 'Add-on activated', tone: 'accent' },
  addon_removed:       { label: 'Add-on removed', tone: 'default' },
  payment_succeeded:   { label: 'Payment succeeded', tone: 'default' },
  payment_failed:      { label: 'Payment failed', tone: 'warn' },
  payment_recovered:   { label: 'Payment recovered', tone: 'accent' },
  subscription_canceled:{ label: 'Subscription canceled', tone: 'warn' },
  impersonated:        { label: 'Impersonated', tone: 'accent' },
  comped:              { label: 'Plan comped', tone: 'accent' },
  suspended:           { label: 'Suspended', tone: 'danger' },
  unsuspended:         { label: 'Reinstated', tone: 'default' },
  support_flagged:     { label: 'Flagged for review', tone: 'warn' },
}

function labelOf(kind: string): string {
  return KNOWN[kind]?.label ?? kind
}
function toneOf(kind: string): KnownKind['tone'] {
  return KNOWN[kind]?.tone ?? 'default'
}

function relative(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diff = now - then
  const mins = Math.round(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-NZ')
}

function detailSummary(kind: string, detail: unknown): string {
  if (detail == null) return ''
  if (typeof detail === 'string') return detail
  if (typeof detail === 'object') {
    // Common shapes — try to extract something human-readable.
    const d = detail as Record<string, unknown>
    if (typeof d.reason === 'string') return d.reason
    if (kind === 'plan_change' && typeof d.to === 'string') return `→ ${d.to}`
  }
  return ''
}
</script>

<template>
  <ol class="timeline">
    <li
      v-for="event in sorted"
      :key="`${event.at}-${event.kind}`"
      class="timeline__item"
      :class="`timeline__item--${toneOf(event.kind)}`"
    >
      <div class="timeline__dot" aria-hidden="true" />
      <div class="timeline__body">
        <div class="timeline__head">
          <span class="timeline__label">{{ labelOf(event.kind) }}</span>
          <span v-if="!KNOWN[event.kind]" class="timeline__raw-tag" title="Unknown event kind — rendering raw">{{ event.kind }}</span>
          <span class="timeline__time">{{ relative(event.at) }}</span>
        </div>
        <div v-if="detailSummary(event.kind, event.detail)" class="timeline__detail">
          {{ detailSummary(event.kind, event.detail) }}
        </div>
        <details v-if="!KNOWN[event.kind] && event.detail" class="timeline__raw">
          <summary>Raw payload</summary>
          <pre>{{ JSON.stringify(event.detail, null, 2) }}</pre>
        </details>
      </div>
    </li>
    <li v-if="sorted.length === 0" class="timeline__empty">
      No events yet.
    </li>
  </ol>
</template>

<style scoped>
.timeline { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 14px; position: relative; }
.timeline::before { content: ''; position: absolute; left: 6px; top: 6px; bottom: 6px; width: 1px; background: var(--color-hairline); }

.timeline__item { position: relative; padding-left: 28px; display: flex; flex-direction: column; gap: 4px; }
.timeline__dot { position: absolute; left: 0; top: 4px; width: 13px; height: 13px; border-radius: 999px; background: var(--color-ground); border: 2px solid var(--color-hairline); }
.timeline__item--accent .timeline__dot { border-color: var(--color-accent); }
.timeline__item--warn .timeline__dot { border-color: var(--color-feature-tangerine); }
.timeline__item--danger .timeline__dot { border-color: var(--color-danger); }

.timeline__head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.timeline__label { font-family: var(--font-body); font-size: 14px; font-weight: 600; color: var(--color-ink); }
.timeline__time { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); }
.timeline__raw-tag { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.04em; color: var(--color-fog); padding: 1px 6px; background: var(--color-surface); border-radius: 4px; }

.timeline__detail { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); }

.timeline__raw { font-family: var(--font-mono); font-size: 11px; color: var(--color-graphite); margin-top: 4px; }
.timeline__raw summary { cursor: pointer; color: var(--color-fog); }
.timeline__raw pre { background: var(--color-surface); padding: 10px; border-radius: 6px; overflow-x: auto; margin: 6px 0 0; }

.timeline__empty { padding-left: 28px; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); font-style: italic; }
</style>
