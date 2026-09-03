import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createWindows, useWindows } from '../createWindows'
import WindowHost from '../WindowHost.vue'
import '../style.css'

/**
 * What jsdom cannot answer: whether the duration the host waits for is really the one the
 * stylesheet declares. jsdom has no cascade, so `transitions.spec.ts` stubs the computed value and
 * pins the machine around it; here the baseline sheet is imported and Chromium resolves
 * `--vtd-motion-duration` — through inheritance from `:root`, on an element the library only ever
 * reads it from — exactly as a consumer's own override would be resolved.
 */

const Content = defineComponent({
  props: { windowId: { type: String, default: '' } },
  render() {
    return h('p', { class: 'content' }, 'content')
  },
})

let wrapper: VueWrapper | null = null

function app() {
  // The test browser is narrower than the default breakpoint, and a fullscreen mobile window has no
  // centre of its own to fly from.
  const plugin = createWindows({ components: { editor: Content }, mobileBreakpoint: 0 })
  wrapper = mount(defineComponent({ render: () => h(WindowHost) }), {
    global: { plugins: [plugin] },
    attachTo: document.body,
  })
  return { win: useWindows() }
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

const dialogs = () => document.querySelectorAll('dialog.vw')
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('motion, measured', () => {
  it('retains a closing frame for the duration the stylesheet declares', async () => {
    const { win } = app()
    const id = win.open('editor', {}, { x: 40, y: 40, w: 320, h: 240 })
    await nextTick()

    const dialog = dialogs()[0] as HTMLElement
    const declared = getComputedStyle(dialog).getPropertyValue('--vtd-motion-duration').trim()
    expect(declared).toBe('180ms')

    win.close(id)
    await nextTick()
    expect(win.byId(id)).toBeUndefined()
    expect(dialog.getAttribute('data-vw-state')).toBe('leaving')
    expect(dialog.isConnected).toBe(true)
    // Really animating, not just labelled: the transition is under way.
    expect(Number(getComputedStyle(dialog).opacity)).toBeLessThan(1)

    await wait(90)
    expect(dialogs()).toHaveLength(1)
    await wait(150)
    expect(dialogs()).toHaveLength(0)
    expect(dialog.isConnected).toBe(false)
  })

  it('resolves the fly-to properties on a minimizing frame', async () => {
    const { win } = app()
    const id = win.open('editor', {}, { x: 40, y: 40, w: 320, h: 240 })
    await nextTick()
    win.setTaskbarRect(id, { x: 500, y: 600, w: 80, h: 20 })

    const dialog = dialogs()[0] as HTMLElement
    win.minimize(id)
    await nextTick()

    const computed = getComputedStyle(dialog)
    expect(computed.getPropertyValue('--vtd-min-x').trim()).toBe('340px')
    expect(computed.getPropertyValue('--vtd-min-y').trim()).toBe('450px')
    expect(computed.getPropertyValue('--vtd-min-scale').trim()).toBe('0.25')

    // The frame's position is an inline `transform`; the sheet animates `translate` and `scale`, so
    // the fly does not overwrite where the window is.
    expect(computed.transform).toBe('matrix(1, 0, 0, 1, 40, 40)')
    expect(computed.translate).not.toBe('none')

    await wait(240)
    expect(dialogs()).toHaveLength(0)
  })

  it('paints an arriving window in the entering state, then releases it', async () => {
    const { win } = app()
    win.open('editor', {}, { x: 40, y: 40, w: 320, h: 240 })
    await nextTick()

    const dialog = dialogs()[0] as HTMLElement
    expect(dialog.getAttribute('data-vw-state')).toBe('entering')
    expect(Number(getComputedStyle(dialog).opacity)).toBeLessThan(1)

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    await nextTick()
    expect(dialog.getAttribute('data-vw-state')).toBe('open')
    await wait(240)
    expect(Number(getComputedStyle(dialog).opacity)).toBe(1)
  })
})
