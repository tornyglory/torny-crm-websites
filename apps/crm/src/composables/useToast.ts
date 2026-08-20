/**
 * useToast — global singleton toast state.
 * Kept outside Pinia because it doesn't share the async / caching
 * concerns of the other stores; a plain ref + timer is enough. The
 * CrmToast component (mounted in CrmShell) reads this.
 */
import { ref } from 'vue'

export type ToastKind = 'success' | 'info' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

const current = ref<Toast | null>(null)
let counter = 0
let timer: number | null = null

function show(message: string, kind: ToastKind = 'success', duration = 2600): void {
  if (timer != null) window.clearTimeout(timer)
  counter += 1
  current.value = { id: counter, kind, message }
  timer = window.setTimeout(() => {
    current.value = null
    timer = null
  }, duration)
}

function dismiss(): void {
  if (timer != null) window.clearTimeout(timer)
  timer = null
  current.value = null
}

export function useToast() {
  return {
    toast: current,
    show,
    success: (msg: string) => show(msg, 'success'),
    info: (msg: string) => show(msg, 'info'),
    error: (msg: string) => show(msg, 'error'),
    dismiss,
  }
}
