<script setup lang="ts">
/**
 * CrmModal — reusable modal shell.
 *
 * Every create/edit modal in the CRM composes this: overlay, centred
 * card, header (eyebrow + title + close), scrollable body, sticky
 * footer for actions. Dismisses on backdrop click and Escape. Emits
 * `close` — never dismisses itself, so parents can gate on
 * unsaved-work confirmation.
 */
import { onBeforeUnmount, onMounted, watch } from 'vue'

const props = defineProps<{
  open: boolean
  eyebrow?: string
  title: string
  width?: 'sm' | 'md' | 'lg' | 'xl'
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

function onKey(e: KeyboardEvent) {
  if (!props.open) return
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}

function lockScroll(locked: boolean) {
  if (typeof document === 'undefined') return
  document.documentElement.style.overflow = locked ? 'hidden' : ''
  document.body.style.overflow = locked ? 'hidden' : ''
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  lockScroll(false)
})
watch(() => props.open, (v) => lockScroll(v))
</script>

<template>
  <transition name="crm-modal-fade">
    <div
      v-if="open"
      class="crm-modal__overlay"
      role="dialog"
      aria-modal="true"
      @click.self="emit('close')"
    >
      <transition name="crm-modal-slide" appear>
        <div
          v-if="open"
          class="crm-modal__card"
          :class="`crm-modal__card--${width ?? 'md'}`"
          @click.stop
        >
          <header class="crm-modal__head">
            <div class="crm-modal__head-text">
              <div v-if="eyebrow" class="crm-modal__eyebrow">{{ eyebrow }}</div>
              <h2 class="crm-modal__title">{{ title }}</h2>
            </div>
            <button
              type="button"
              class="crm-modal__close"
              aria-label="Close"
              @click="emit('close')"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
          </header>

          <div class="crm-modal__body">
            <slot />
          </div>

          <footer v-if="$slots.footer" class="crm-modal__foot">
            <slot name="footer" />
          </footer>
        </div>
      </transition>
    </div>
  </transition>
</template>

<style scoped>
.crm-modal__overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(10, 10, 11, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 60px 20px 40px;
  overflow-y: auto;
}
.crm-modal__card {
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 24px 60px -20px rgba(15, 23, 42, 0.28);
  width: 100%;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 100px);
}
.crm-modal__card--sm { max-width: 400px; }
.crm-modal__card--md { max-width: 560px; }
.crm-modal__card--lg { max-width: 780px; }
.crm-modal__card--xl { max-width: 1200px; }

.crm-modal__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--color-hairline);
}
.crm-modal__head-text { flex: 1; min-width: 0; }
.crm-modal__eyebrow {
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.crm-modal__title {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--color-ink);
  margin: 4px 0 0;
}
.crm-modal__close {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  background: var(--color-surface);
  border: 0;
  color: var(--color-graphite);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.crm-modal__close:hover { background: var(--color-hairline); color: var(--color-ink); }

.crm-modal__body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}
.crm-modal__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 24px;
  border-top: 1px solid var(--color-hairline);
  background: var(--color-surface);
  border-bottom-left-radius: 16px;
  border-bottom-right-radius: 16px;
}

.crm-modal-fade-enter-active, .crm-modal-fade-leave-active {
  transition: opacity 0.15s ease;
}
.crm-modal-fade-enter-from, .crm-modal-fade-leave-to { opacity: 0; }

.crm-modal-slide-enter-active, .crm-modal-slide-leave-active {
  transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.32, 0.72, 0, 1);
}
.crm-modal-slide-enter-from, .crm-modal-slide-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.98);
}

@media (max-width: 767px) {
  .crm-modal__overlay { padding: 20px 12px calc(20px + var(--safe-bottom, 0px)); align-items: flex-end; }
  .crm-modal__card { max-height: 92vh; }
}
</style>
