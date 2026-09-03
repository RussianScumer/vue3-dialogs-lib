import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createWindows, useWindows } from '../createWindows'
import WindowHost from '../WindowHost.vue'
import WindowTaskbar from '../WindowTaskbar.vue'
import type { WindowsApi } from '../state'

/** Nothing tabbable, so the header is what takes focus — the case the chain is about. */
const Content = defineComponent({
  props: { id: { type: Number, default: 0 }, windowId: { type: String, default: '' } },
  render() {
    return h('p', { class: 'content' }, `item ${this.id}`)
  },
})

/**
 * The store comes from the mounted app rather than `useWindows()`'s module-level fallback: this
 * file mounts an app per test and the fallback only ever points at one of them.
 *
 * `taskbar: true` opts the taskbar in as a focus destination, which is what a consumer does with
 * `:ref="registerFocusTarget"`.
 */
function app(taskbar: boolean) {
  const plugin = createWindows({ components: { editor: Content } })
  const wrapper = mount(
    defineComponent({
      components: { WindowHost, WindowTaskbar },
      setup: () => ({ win: useWindows() }),
      template: taskbar
        ? `<WindowHost /><WindowTaskbar v-slot="{ all, registerFocusTarget }">
             <div class="bar" tabindex="-1" :ref="registerFocusTarget">{{ all.length }}</div>
           </WindowTaskbar>`
        : '<WindowHost />',
    }),
    { global: { plugins: [plugin] }, attachTo: document.body },
  )
  return { wrapper, win: (wrapper.vm as unknown as { win: WindowsApi }).win }
}

/** An element outside every window, standing in for whatever opened them. */
function outside() {
  const el = document.createElement('button')
  document.body.appendChild(el)
  el.focus()
  return el
}

describe('focus destinations', () => {
  it('moves focus to the next window on minimize', async () => {
    const opener = outside()
    const { wrapper, win } = app(true)
    win.open('editor', { id: 1 })
    const b = win.open('editor', { id: 2 })
    await nextTick()

    const [headA, headB] = wrapper.findAll('.vw__head').map((w) => w.element)
    expect(document.activeElement).toBe(headB)

    win.minimize(b)
    await nextTick()

    // The window on top wins over the registered taskbar, which is step 2.
    expect(document.activeElement).toBe(headA)
    wrapper.unmount()
    opener.remove()
  })

  it('falls through to the taskbar when the last window is minimized', async () => {
    const opener = outside()
    const { wrapper, win } = app(true)
    const id = win.open('editor', { id: 1 })
    await nextTick()

    win.minimize(id)
    await nextTick()

    expect(document.activeElement).toBe(wrapper.find('.bar').element)
    expect(document.activeElement).not.toBe(document.body)
    wrapper.unmount()
    opener.remove()
  })

  it('skips the taskbar on close — the button it would focus is gone', async () => {
    const opener = outside()
    const { wrapper, win } = app(true)
    const id = win.open('editor', { id: 1 })
    await nextTick()

    win.close(id)
    await nextTick()

    expect(document.activeElement).toBe(opener)
    wrapper.unmount()
    opener.remove()
  })

  it('moves focus to the next window on close', async () => {
    const opener = outside()
    const { wrapper, win } = app(true)
    win.open('editor', { id: 1 })
    const b = win.open('editor', { id: 2 })
    await nextTick()

    const headA = wrapper.findAll('.vw__head')[0]!.element
    win.close(b)
    await nextTick()

    expect(document.activeElement).toBe(headA)
    wrapper.unmount()
    opener.remove()
  })

  it('leaves focus where the user put it', async () => {
    const { wrapper, win } = app(true)
    const a = win.open('editor', { id: 1 })
    win.open('editor', { id: 2 })
    await nextTick()

    // Focus is neither in the window being minimized nor in any window at all.
    const elsewhere = outside()
    win.minimize(a)
    await nextTick()

    expect(document.activeElement).toBe(elsewhere)
    wrapper.unmount()
    elsewhere.remove()
  })

  it('does nothing when the chain is exhausted', async () => {
    const { wrapper, win } = app(false)
    const id = win.open('editor', { id: 1 })
    await nextTick()

    // No other window, no taskbar target, and the opener was <body> — every step is empty.
    win.minimize(id)
    await nextTick()

    expect(document.activeElement).toBe(document.body)
    wrapper.unmount()
  })
})
