import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createWindows, useWindows } from '../createWindows'
import WindowHost from '../WindowHost.vue'
import '../style.css'

/**
 * `--vtd-head-bg-active` / `--vtd-head-fg-active` recolour the focused window's header. They are
 * opt-in: unset, both headers resolve to the same `--vtd-head-*` values, so the baseline is
 * unchanged. Needs a real cascade, hence the browser project.
 */

const Content = defineComponent({
  render: () => h('p', 'content'),
})

let wrapper: VueWrapper | null = null
let override: HTMLStyleElement | null = null

function style(css: string) {
  override = document.createElement('style')
  // No motion, so the computed colour is the end state and not a transition frame.
  override.textContent = `:root { --vtd-motion-duration: 0ms; ${css} }`
  document.head.append(override)
}

async function twoWindows() {
  const plugin = createWindows({ components: { editor: Content }, mobileBreakpoint: 0 })
  wrapper = mount(defineComponent({ render: () => h(WindowHost) }), {
    global: { plugins: [plugin] },
    attachTo: document.body,
  })
  const win = useWindows()
  const a = win.open('editor', {}, { x: 40, y: 40, w: 320, h: 240 })
  win.open('editor', {}, { x: 400, y: 40, w: 320, h: 240, dedupe: false })
  await nextTick()
  return { win, a: a.id }
}

function heads() {
  const [first, second] = [...document.querySelectorAll<HTMLElement>('dialog.vw')]
  return { first: first!, second: second! }
}

const headOf = (dialog: HTMLElement) => getComputedStyle(dialog.querySelector('.vw__head')!)

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  override?.remove()
  override = null
})

describe('active window header', () => {
  it('looks the same on every window when the tokens are unset', async () => {
    style('')
    await twoWindows()
    const { first, second } = heads()

    expect(second.hasAttribute('data-vw-active')).toBe(true)
    expect(headOf(second).backgroundColor).toBe(headOf(first).backgroundColor)
    expect(headOf(second).color).toBe(headOf(first).color)
  })

  it('recolours only the focused window and follows focus', async () => {
    style('--vtd-head-bg: rgb(10, 10, 10); --vtd-head-fg: rgb(20, 20, 20); '
      + '--vtd-head-bg-active: rgb(1, 2, 3); --vtd-head-fg-active: rgb(4, 5, 6);')
    const { win, a } = await twoWindows()
    const { first, second } = heads()

    expect(headOf(second).backgroundColor).toBe('rgb(1, 2, 3)')
    expect(headOf(second).color).toBe('rgb(4, 5, 6)')
    expect(headOf(first).backgroundColor).toBe('rgb(10, 10, 10)')
    expect(headOf(first).color).toBe('rgb(20, 20, 20)')

    win.focus(a)
    await nextTick()

    expect(first.hasAttribute('data-vw-active')).toBe(true)
    expect(headOf(first).backgroundColor).toBe('rgb(1, 2, 3)')
    expect(headOf(second).backgroundColor).toBe('rgb(10, 10, 10)')
  })
})
