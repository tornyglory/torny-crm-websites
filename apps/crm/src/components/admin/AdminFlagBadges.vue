<script setup lang="ts">
/**
 * Compact pill row for the `flags` object on AdminAccountRow. Only
 * renders non-false flags so quiet accounts render nothing (no empty
 * visual anchor). `comped_until` is visible when non-null regardless
 * of other flags — it's the strongest signal a human needs on a row.
 */
import { computed } from 'vue'
import type { AdminAccountRow } from '@torny/api-client'

const props = defineProps<{ flags: AdminAccountRow['flags'] }>()

interface Badge { label: string; tone: 'warn' | 'danger' | 'accent' | 'muted'; title?: string }

const badges = computed<Badge[]>(() => {
  const out: Badge[] = []
  if (props.flags.suspended) out.push({ label: 'SUSPENDED', tone: 'danger', title: 'Account is suspended — admin CRM access blocked' })
  if (props.flags.past_due) out.push({ label: 'PAST DUE', tone: 'warn', title: 'Stripe reports past-due payment' })
  if (props.flags.high_bounce_rate) out.push({ label: 'HIGH BOUNCE', tone: 'warn', title: 'SES bounce rate above threshold' })
  if (props.flags.comped_until) {
    const until = new Date(props.flags.comped_until).toLocaleDateString('en-NZ')
    out.push({ label: `COMPED · ${until}`, tone: 'accent', title: `Manual plan override active until ${until}` })
  }
  return out
})
</script>

<template>
  <div v-if="badges.length" class="flag-badges">
    <span
      v-for="b in badges"
      :key="b.label"
      class="flag-badge"
      :class="`flag-badge--${b.tone}`"
      :title="b.title"
    >{{ b.label }}</span>
  </div>
</template>

<style scoped>
.flag-badges { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.flag-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  border-radius: 999px;
  white-space: nowrap;
}
.flag-badge--danger { background: color-mix(in oklab, var(--color-danger) 15%, #fff); color: var(--color-danger); }
.flag-badge--warn { background: color-mix(in oklab, var(--color-feature-tangerine) 15%, #fff); color: var(--color-feature-tangerine); }
.flag-badge--accent { background: color-mix(in oklab, var(--color-accent) 15%, #fff); color: var(--color-accent); }
.flag-badge--muted { background: var(--color-surface); color: var(--color-fog); }
</style>
