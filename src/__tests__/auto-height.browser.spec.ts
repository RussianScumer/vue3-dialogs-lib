import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createWindows, useWindows } from '../createWindows'
import type { WindowsOptions } from '../types'
import WindowHost from '../WindowHost.vue'

/**
 * Growing to fit is a layout claim — `scrollHeight` and `clientHeight` are zero in jsdom — so it is
 * measured here. No stylesheet, as in the layout spec: the frame's inline structure is what grows.
 */

/** How many 40px lines the content renders; shared so a test can add lines after mount. */
const lines = ref(0)

const Content = defineComponent({
  props: { windowId: { type: String, default: '' } },
  render() {
    return h(
      'div',
      { class: 'content' },
      Array.from({ length: lines.value }, (_, i) => h('p', { style: 'margin:0;height:40px' }, `line ${i}`)),
    )
  },
})

let wrapper: VueWrapper | null = null

function app(extra: Partial<WindowsOptions> = {}) {
  const plugin = createWindows({ components: { doc: Content }, mobileBreakpoint: 0, ...extra })
  wrapper = mount(defineComponent({ render: () => h(WindowHost) }), {
    global: { plugins: [plugin] },
    attachTo: document.body,
  })
  return useWindows()
}

/** Two frames: one for the observer to fire, one for the store's write to reach the element. */
async function settle() {
  for (let i = 0; i < 3; i++) {
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    await nextTick()
  }
}

const body = () => document.querySelector<HTMLElement>('.vw__body')!

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  lines.value = 0
})

describe('auto height', () => {
  it('grows a window with no height of its own until its content fits', async () => {
    // Taller than the default 480 but well inside the test viewport.
    lines.value = Math.floor((window.innerHeight - 100) / 40)
    const win = app()
    const id = win.open('doc', {}, { y: 0 }).id
    await settle()

    expect(win.byId(id)!.h).toBeGreaterThan(480)
    expect(body().scrollHeight).toBe(body().clientHeight)
  })

  it('stops at the viewport, where the body scrolls instead', async () => {
    lines.value = Math.ceil(window.innerHeight / 40) + 10
    const win = app()
    const id = win.open('doc', {}, { y: 40 }).id
    await settle()

    expect(win.byId(id)!.h).toBe(window.innerHeight)
    expect(win.byId(id)!.y).toBe(0)
    expect(body().scrollHeight).toBeGreaterThan(body().clientHeight)
  })

  it('stops above a bottom inset, so a fixed taskbar stays visible', async () => {
    lines.value = Math.ceil(window.innerHeight / 40) + 10
    const win = app({ snap: { insets: { bottom: 36 } } })
    const id = win.open('doc', {}, { y: 40 }).id
    await settle()

    expect(win.byId(id)!.y).toBe(0)
    expect(win.byId(id)!.h).toBe(window.innerHeight - 36)
    expect(body().scrollHeight).toBeGreaterThan(body().clientHeight)
  })

  it('keeps growing as content arrives after mount', async () => {
    lines.value = 2
    const win = app()
    const id = win.open('doc', {}, { y: 0 }).id
    await settle()
    expect(win.byId(id)!.h).toBe(480)

    lines.value = Math.floor((window.innerHeight - 100) / 40)
    await settle()

    expect(win.byId(id)!.h).toBeGreaterThan(480)
    expect(body().scrollHeight).toBe(body().clientHeight)
  })

  it('leaves a window alone once the user has resized it', async () => {
    lines.value = 2
    const win = app()
    const id = win.open('doc', {}, { x: 40, y: 0 }).id
    await settle()

    const grip = document.querySelector<HTMLElement>('[data-vw-grip="s"]')!
    const r = grip.getBoundingClientRect()
    const at = (type: string, dy: number) =>
      grip.dispatchEvent(
        new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0, clientX: r.left + 20, clientY: r.top + dy }),
      )
    at('pointerdown', 0)
    at('pointermove', -40)
    at('pointerup', -40)
    await settle()
    expect(win.byId(id)!.h).toBe(440)

    lines.value = Math.floor((window.innerHeight - 100) / 40)
    await settle()

    expect(win.byId(id)!.h).toBe(440)
  })

  it('does not grow a window opened with an explicit height', async () => {
    lines.value = Math.floor((window.innerHeight - 100) / 40)
    const win = app()
    const id = win.open('doc', {}, { y: 0, h: 300 }).id
    await settle()

    expect(win.byId(id)!.h).toBe(300)
  })
})
