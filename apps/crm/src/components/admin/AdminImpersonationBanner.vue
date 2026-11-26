<script setup lang="ts">
/**
 * Impersonation banner — brief 123 §6.1.
 *
 * Mounts at the top of CrmShell when an impersonation session is
 * active. Shows who you're acting as + remaining TTL + an exit
 * button that stops the session and navigates back to the admin
 * account detail where the session started.
 *
 * Deliberately styled with the Torny danger palette so it's
 * unmistakable at every page — this is a privileged state and
 * the admin should never forget they're in it.
 */
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useImpersonation } from '@/composables/useImpersonation'

const { state, isActive, stop } = useImpersonation()
const router = useRouter()

// Tick every second so the "14:32" countdown updates live.
const now = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => { tickTimer = setInterval(() => { now.value = Date.now() }, 1000) })
onBeforeUnmount(() => { if (tickTimer) clearInterval(tickTimer) })

const remaining = computed(() => {
  if (!state.value) return ''
  const ms = new Date(state.value.expires_at).getTime() - now.value
  if (ms <= 0) return '0:00'
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
})

async function exit() {
  const path = state.value?.return_path ?? '/admin/accounts'
  await stop()
  void router.push(path)
}
</script>

<template>
  <div v-if="isActive && state" class="imp-banner" role="status">
    <div class="imp-banner__inner">
      <span class="imp-banner__badge">IMPERSONATING</span>
      <span class="imp-banner__text">
        You're acting as <strong>{{ state.user_email }}</strong>
        at <strong>{{ state.account_name }}</strong>.
      </span>
      <span class="imp-banner__timer" :title="`Session expires at ${new Date(state.expires_at).toLocaleTimeString()}`">
        {{ remaining }}
      </span>
      <button type="button" class="imp-banner__exit" @click="exit">
        Return to admin
      </button>
    </div>
  </div>
</template>

<style scoped>
.imp-banner {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--color-feature-violet);
  color: #fff;
  padding: 10px 16px;
  box-shadow: 0 2px 8px -4px rgba(0, 0, 0, 0.2);
}
.imp-banner__inner {
  display: flex;
  align-items: center;
  gap: 16px;
  max-width: 1480px;
  margin: 0 auto;
  flex-wrap: wrap;
  font-family: var(--font-body);
  font-size: 13px;
}
.imp-banner__badge {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 3px 10px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 999px;
}
.imp-banner__text { flex: 1; min-width: 200px; }
.imp-banner__text strong { font-weight: 600; }
.imp-banner__timer {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  padding: 3px 10px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
}
.imp-banner__exit {
  padding: 6px 14px;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-feature-violet);
  background: #fff;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
}
.imp-banner__exit:hover { background: rgba(255, 255, 255, 0.9); }
</style>
