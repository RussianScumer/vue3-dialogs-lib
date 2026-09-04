import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createWindows, useWindows } from '../createWindows'
import WindowHost from '../WindowHost.vue'
import WindowTaskbar from '../WindowTaskbar.vue'

/**
 * The destination chain against a real UA. `focus.spec.ts` proves the chain's logic in jsdom; this
 * proves it survives the two things jsdom fakes. First, `dialog.show()` there is a shim that sets
 * an attribute, so the UA's dialog focusing steps never run and cannot compete with ours. Second,
 * jsdom's `focus()` is unconditional, while a real browser refuses it on an element it does not
 * consider focusable — which is what the taskbar step depends on.
 */

/** Nothing tabbable inside, so the header is what focus lands on. */
const Content = defineComponent({
  props: { windowId: { type: String, default: '' }, tag: { type: String, default: '' } },
  render() {
    return h('p', { class: 'content' }, this.tag)
  },
})

let wrapper: VueWrapper | null = null

/** A render function, not a `template`: the browser build of Vue is runtime-only. */
function app() {
  const plugin = createWindows({ components: { editor: Content } })
  wrapper = mount(
    defineComponent({
      render: () => [
        h(WindowHost),
        h(WindowTaskbar, null, {
          default: ({ registerFocusTarget }: { registerFocusTarget: (el: Element | null) => void }) =>
            h('div', { class: 'bar', tabindex: '-1', ref: registerFocusTarget }, 'taskbar'),
        }),
      ],
    }),
    { global: { plugins: [plugin] }, attachTo: document.body },
  )
  return { wrapper, win: useWindows() }
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.querySelectorAll('.opener').forEach((el) => el.remove())
})

function heads(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.vw__head')]
}

/** Stands in for whatever opened the windows, and holds focus before they exist. */
function opener(): HTMLElement {
  const el = document.createElement('button')
  el.className = 'opener'
  document.body.appendChild(el)
  el.focus()
  return el
}

describe('focus destinations in a real browser', () => {
  it('hands focus to the window underneath on minimize', async () => {
    opener()
    const { win } = app()
    win.open('editor', { tag: 'a' })
    const b = win.open('editor', { tag: 'b' }).id
    await nextTick()

    const [headA, headB] = heads()
    // The UA ran its own focusing steps inside show(); ours is what survived them.
    expect(document.activeElement).toBe(headB)

    win.minimize(b)
    await nextTick()

    expect(document.activeElement).toBe(headA)
  })

  it('hands focus to the taskbar when the last window is minimized', async () => {
    opener()
    const { win } = app()
    const id = win.open('editor', { tag: 'a' }).id
    await nextTick()

    win.minimize(id)
    await nextTick()

    // Chromium only accepts focus() on an element it considers focusable, so this also proves the
    // documented `tabindex="-1"` on the registered target is load-bearing rather than decorative.
    expect(document.activeElement).toBe(document.querySelector('.bar'))
    expect(document.activeElement).not.toBe(document.body)
  })

  it('skips the taskbar on close and falls through to the opener', async () => {
    const button = opener()
    const { win } = app()
    const id = win.open('editor', { tag: 'a' }).id
    await nextTick()

    win.close(id)
    await nextTick()

    expect(document.activeElement).toBe(button)
  })

  it('leaves focus where the user put it', async () => {
    const { win } = app()
    const a = win.open('editor', { tag: 'a' }).id
    win.open('editor', { tag: 'b' })
    await nextTick()

    const elsewhere = opener() // focuses it, out of every window
    win.minimize(a)
    await nextTick()

    expect(document.activeElement).toBe(elsewhere)
  })
})
