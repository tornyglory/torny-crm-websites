/**
 * useClickOutside — unit tests. Mounts a tiny host component so Vue's
 * lifecycle hooks (`onMounted`/`onBeforeUnmount`) actually fire.
 */
import { describe, it, expect, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useClickOutside } from './useClickOutside'

const Host = defineComponent({
  props: {
    onOutside: { type: Function, required: true },
    include: { type: Array as () => string[], default: () => [] },
  },
  setup(props) {
    const target = ref<HTMLElement | null>(null)
    useClickOutside(target, (e) => props.onOutside!(e), { include: props.include })
    return () =>
      h('div', [
        h('div', { ref: target, class: 'target' }, [
          h('span', { class: 'inside' }, 'inside'),
        ]),
        h('div', { class: 'outside' }, 'outside'),
        h('button', { class: 'trigger' }, 'trigger'),
      ])
  },
})

describe('useClickOutside', () => {
  it('does not fire when the click lands inside the target', () => {
    const cb = vi.fn()
    const w = mount(Host, { props: { onOutside: cb }, attachTo: document.body })
    w.find('.inside').element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(cb).not.toHaveBeenCalled()
    w.unmount()
  })

  it('fires when the click lands outside the target', () => {
    const cb = vi.fn()
    const w = mount(Host, { props: { onOutside: cb }, attachTo: document.body })
    w.find('.outside').element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(cb).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('treats "include" selectors as inside', () => {
    const cb = vi.fn()
    const w = mount(Host, {
      props: { onOutside: cb, include: ['.trigger'] },
      attachTo: document.body,
    })
    w.find('.trigger').element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(cb).not.toHaveBeenCalled()
    w.unmount()
  })

  it('removes the listener on unmount — no further fires', () => {
    const cb = vi.fn()
    const w = mount(Host, { props: { onOutside: cb }, attachTo: document.body })
    w.unmount()
    // After unmount, outside clicks should not re-trigger the callback.
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(cb).not.toHaveBeenCalled()
  })
})
