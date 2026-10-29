/**
 * useClickOutside — fire a callback when a click lands outside a
 * target element (and anywhere else that should be considered "inside",
 * via `include`). Replaces the ad-hoc `document.addEventListener('click', …)`
 * pattern that was duplicated across menus, dropdowns, and overflow actions.
 *
 * Usage:
 *
 *   const menuRef = ref<HTMLElement | null>(null)
 *   const open = ref(false)
 *   useClickOutside(menuRef, () => (open.value = false))
 *
 *   <template>
 *     <div ref="menuRef">…</div>
 *   </template>
 *
 * Pass additional selectors via `include` for things like a trigger
 * button rendered outside the menu's own ref — clicks landing on those
 * are also treated as "inside" so they don't fire the callback.
 */
import { onBeforeUnmount, onMounted, type Ref } from 'vue'

export interface UseClickOutsideOptions {
  /** Extra selectors treated as "inside" (e.g. a toggle button). */
  include?: string[]
  /** Which event to listen on. Default `'click'`. */
  event?: 'click' | 'mousedown' | 'pointerdown'
}

export function useClickOutside(
  target: Ref<HTMLElement | null | undefined>,
  onOutside: (e: MouseEvent) => void,
  opts: UseClickOutsideOptions = {},
): void {
  const event = opts.event ?? 'click'
  const include = opts.include ?? []

  function onDocClick(e: MouseEvent) {
    const el = target.value
    if (!el) return
    const node = e.target as Node | null
    if (!node) return
    // Direct containment check first — cheap.
    if (el.contains(node)) return
    // Fall through to selector-based "inside" matches.
    if (include.length) {
      const htmlNode = node as HTMLElement
      for (const sel of include) {
        if (htmlNode.closest?.(sel)) return
      }
    }
    onOutside(e)
  }

  onMounted(() => {
    document.addEventListener(event, onDocClick)
  })
  onBeforeUnmount(() => {
    document.removeEventListener(event, onDocClick)
  })
}
