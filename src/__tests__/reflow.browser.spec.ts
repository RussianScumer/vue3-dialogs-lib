import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { page } from 'vitest/browser'
import { createWindows, useWindows } from '../createWindows'
import { dockRect } from '../geometry'
import type { WindowsOptions } from '../types'
import WindowHost from '../WindowHost.vue'

/**
 * A real viewport resize and the rendered frames are what jsdom cannot show: `window` never
 * resizes there and nothing is laid out. Here the iframe is resized through `page.viewport` and the
 * `<dialog>` frames are measured. No stylesheet is imported; the frame's inline structure is what
 * moves. The reflow runs one animation frame after the resize, so every check polls.
 */

const initial = { w: window.innerWidth, h: window.innerHeight }

const Content = defineComponent({
  props: { windowId: { type: String, default: '' } },
  render() {
    return h('div', { class: 'content', 'data-win': this.windowId })
  },
})

let wrapper: VueWrapper | null = null

function app(extra: Partial<WindowsOptions>) {
  const plugin = createWindows({ components: { doc: Content }, ...extra })
  wrapper = mount(defineComponent({ render: () => h(WindowHost) }), {
    global: { plugins: [plugin] },
    attachTo: document.body,
  })
  return useWindows()
}

const frame = (id: string) =>
  document.querySelector(`[data-win="${id}"]`)!.closest<HTMLElement>('dialog.vw')!

const box = (id: string) => {
  const r = frame(id).getBoundingClientRect()
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
}

const view = () => ({ w: window.innerWidth, h: window.innerHeight })

async function resize(w: number, h: number) {
  await page.viewport(w, h)
  await expect.poll(() => [window.innerWidth, window.innerHeight], { timeout: 5000 }).toEqual([w, h])
}

afterEach(async () => {
  wrapper?.unmount()
  wrapper = null
  await resize(initial.w, initial.h)
})

describe('reflow in a real viewport', () => {
  it('gives a window its rect back when the viewport shrinks and grows again', async () => {
    await resize(1200, 800)
    const win = app({ mobileBreakpoint: 0 })
    const id = win.open('doc', {}, { x: 600, y: 100, w: 500, h: 300 }).id
    const rect = { x: 600, y: 100, w: 500, h: 300 }
    await expect.poll(() => box(id), { timeout: 5000 }).toEqual(rect)

    await resize(700, 600)
    await expect.poll(() => box(id), { timeout: 5000 }).toEqual({ x: 200, y: 100, w: 500, h: 300 })

    await resize(400, 600)
    await expect.poll(() => box(id), { timeout: 5000 }).toEqual({ x: 0, y: 100, w: 400, h: 300 })

    await resize(1200, 800)
    await expect.poll(() => box(id), { timeout: 5000 }).toEqual(rect)
    expect(win.byId(id)).toMatchObject(rect)
  })

  it('keeps a centred non-draggable modal centred at every size it fits', async () => {
    await resize(1200, 800)
    const win = app({ mobileBreakpoint: 0 })
    const id = win.open('doc', {}, {
      w: 400,
      h: 300,
      placement: 'center',
      draggable: false,
      modal: true,
    }).id
    for (const [vw, vh] of [
      [1200, 800],
      [900, 600],
      [500, 700],
      [1000, 900],
    ] as const) {
      await resize(vw, vh)
      await expect
        .poll(() => box(id), { timeout: 5000 })
        .toEqual({ x: Math.round((vw - 400) / 2), y: Math.round((vh - 300) / 2), w: 400, h: 300 })
    }
  })

  it('renders only the window that cannot fit fullscreen below the breakpoint', async () => {
    await resize(1000, 800)
    const win = app({ mobileBreakpoint: 768 })
    const small = win.open('doc', {}, { x: 20, y: 20, w: 300, h: 200, dedupe: false }).id
    const large = win.open('doc', {}, { x: 40, y: 40, w: 700, h: 300, dedupe: false }).id
    await expect.poll(() => frame(small).style.width, { timeout: 5000 }).toBe('300px')
    await expect.poll(() => frame(large).style.width, { timeout: 5000 }).toBe('700px')

    await resize(600, 800)
    await expect.poll(() => frame(large).style.width, { timeout: 5000 }).toBe('100vw')
    expect(frame(large).style.transform).toBe('none')
    expect(box(large).w).toBe(600)
    expect(box(large).x).toBe(0)
    expect(frame(small).style.width).toBe('300px')
    expect(box(small)).toEqual({ x: 20, y: 20, w: 300, h: 200 })
    expect(win.isFullscreen(large)).toBe(true)
    expect(win.isFullscreen(small)).toBe(false)

    await resize(1000, 800)
    await expect.poll(() => frame(large).style.width, { timeout: 5000 }).toBe('700px')
    await expect.poll(() => box(large), { timeout: 5000 }).toEqual({ x: 40, y: 40, w: 700, h: 300 })
  })

  it('keeps docked windows inside the viewport as it changes', async () => {
    await resize(1200, 800)
    const win = app({ mobileBreakpoint: 0 })
    const side = win.open('doc', {}, { x: 100, y: 100, w: 500, h: 300, minW: 500, dedupe: false }).id
    const full = win.open('doc', {}, { x: 50, y: 50, w: 400, h: 300, dedupe: false }).id
    win.snap(side, 'right', view())
    win.snap(full, 'max', view())
    const expected = (id: string, zone: 'right' | 'max') => {
      const w = win.byId(id)!
      const r = dockRect(zone, w, view(), win.options.snap.insets)
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }
    }
    for (const [vw, vh] of [
      [1200, 800],
      [800, 800],
      [600, 700],
      [1200, 800],
    ] as const) {
      await resize(vw, vh)
      await expect.poll(() => box(side), { timeout: 5000 }).toEqual(expected(side, 'right'))
      await expect.poll(() => box(full), { timeout: 5000 }).toEqual(expected(full, 'max'))
      for (const id of [side, full]) {
        const b = box(id)
        expect(b.x).toBeGreaterThanOrEqual(0)
        expect(b.x + b.w).toBeLessThanOrEqual(window.innerWidth)
        expect(b.y + b.h).toBeLessThanOrEqual(window.innerHeight)
      }
      if (vw === 800) {
        const b = box(side)
        expect(b.x).toBe(300)
        expect(b.w).toBe(500)
      }
    }
    expect(win.dockZone(side)).toBe('right')
    expect(win.dockZone(full)).toBe('max')
  })
})
