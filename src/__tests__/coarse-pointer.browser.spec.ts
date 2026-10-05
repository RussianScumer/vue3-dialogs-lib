import { afterEach, describe, expect, it } from 'vitest'
import { cdp } from 'vitest/browser'
import { defineComponent, h, nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createWindows, useWindows } from '../createWindows'
import WindowHost from '../WindowHost.vue'

/**
 * What the jsdom spec fakes: whether Chromium with touch really reports `(pointer: coarse)`, and
 * whether a finger 15px inside the edge — nowhere near the old 4px grip — lands on a grip and
 * resizes the window.
 */

const Content = defineComponent({
  props: { windowId: { type: String, default: '' } },
  render: () => h('p', 'content'),
})

let wrapper: VueWrapper | null = null

async function touch(on: boolean) {
  await cdp().send('Emulation.setTouchEmulationEnabled', on ? { enabled: true, maxTouchPoints: 5 } : { enabled: false })
}

function app() {
  wrapper = mount(defineComponent({ render: () => h(WindowHost) }), {
    global: { plugins: [createWindows({ components: { editor: Content }, mobileBreakpoint: 0 })] },
    attachTo: document.body,
  })
  return useWindows()
}

/**
 * The spec runs inside Vitest's iframe, where CDP input coordinates do not line up with the page's,
 * so the gesture is dispatched on whatever the hit test found. The hit test is the claim under test;
 * pointer id 1 is the one Chromium keeps active, which `setPointerCapture` insists on.
 */
function gesture(target: Element, type: string, x: number, y: number) {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: x, clientY: y }),
  )
}

afterEach(async () => {
  wrapper?.unmount()
  wrapper = null
  await touch(false)
})

describe('grips under a real coarse pointer', () => {
  it('Chromium with touch emulation matches (pointer: coarse), and the grips widen', async () => {
    await touch(true)
    expect(matchMedia('(pointer: coarse)').matches).toBe(true)

    app().open('editor', {}, { x: 40, y: 40, w: 320, h: 240 })
    await nextTick()
    const east = document.querySelector<HTMLElement>('[data-vw-grip="e"]')!
    expect(east.getBoundingClientRect().width).toBe(20)
  })

  it('a point 15px inside the east edge hits the grip, and a touch drag from it resizes', async () => {
    await touch(true)
    const win = app()
    const id = win.open('editor', {}, { x: 40, y: 40, w: 320, h: 240 }).id
    await nextTick()

    const frame = document.querySelector<HTMLElement>('dialog.vw')!.getBoundingClientRect()
    const x = frame.right - 15
    const y = frame.top + frame.height / 2
    const hit = document.elementFromPoint(x, y)!
    expect(hit.getAttribute('data-vw-grip')).toBe('e')

    // A short drag: the east edge is clamped to the viewport, and the test iframe is narrow.
    gesture(hit, 'pointerdown', x, y)
    gesture(hit, 'pointermove', x + 20, y)
    gesture(hit, 'pointermove', x + 40, y)
    gesture(hit, 'pointerup', x + 40, y)
    await nextTick()

    expect(win.byId(id)!.w).toBe(360)
    expect(win.byId(id)!.x).toBe(40)
  })

  it('a mouse keeps the 4px grip, so the same point is content', async () => {
    expect(matchMedia('(pointer: coarse)').matches).toBe(false)
    app().open('editor', {}, { x: 40, y: 40, w: 320, h: 240 })
    await nextTick()

    const frame = document.querySelector<HTMLElement>('dialog.vw')!.getBoundingClientRect()
    const hit = document.elementFromPoint(frame.right - 15, frame.top + frame.height / 2)
    expect(hit?.hasAttribute('data-vw-grip')).toBe(false)
  })
})
