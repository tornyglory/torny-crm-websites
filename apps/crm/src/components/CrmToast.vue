<script setup lang="ts">
/**
 * CrmToast — singleton toast reader. Mounts once at CrmShell level;
 * any view calls `useToast().success(...)` to surface a message.
 * Kind picks the icon + accent; tap the pill to dismiss immediately.
 */
import { computed } from 'vue'
import { useToast } from '@/composables/useToast'

const { toast, dismiss } = useToast()
const active = computed(() => toast.value)
</script>

<template>
  <transition name="crm-toast">
    <div
      v-if="active"
      :key="active.id"
      class="crm-toast"
      :class="`crm-toast--${active.kind}`"
      role="status"
      aria-live="polite"
      @click="dismiss"
    >
      <span class="crm-toast__icon" aria-hidden="true">
        <svg v-if="active.kind === 'success'" width="16" height="16" viewBox="0 0 20 20" fill="none">
          <path d="M4 10.5L8 14.5L16 6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <svg v-else-if="active.kind === 'error'" width="16" height="16" viewBox="0 0 20 20" fill="none">
          <path d="M6 6L14 14M14 6L6 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <svg v-else width="16" height="16" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.8" fill="none"/>
          <path d="M10 6.5v4M10 13.5h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </span>
      <span class="crm-toast__msg">{{ active.message }}</span>
    </div>
  </transition>
</template>

<style scoped>
.crm-toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  z-index: 250;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  max-width: min(420px, calc(100vw - 32px));
  padding: 12px 16px;
  border-radius: 999px;
  background: var(--color-ink);
  color: #fff;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: -0.005em;
  box-shadow: 0 12px 32px rgba(10, 10, 11, 0.24);
  cursor: pointer;
}
.crm-toast--success { background: #16A34A; }
.crm-toast--error   { background: var(--color-danger); }
.crm-toast__icon { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.crm-toast__msg { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.crm-toast-enter-active,
.crm-toast-leave-active {
  transition: opacity 0.2s ease, transform 0.25s cubic-bezier(0.32, 0.72, 0, 1);
}
.crm-toast-enter-from,
.crm-toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}
</style>
