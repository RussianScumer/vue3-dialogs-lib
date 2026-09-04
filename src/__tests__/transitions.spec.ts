import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createWindows, useWindows } from '../createWindows'
import WindowHost from '../WindowHost.vue'
import WindowTaskbar from '../WindowTaskbar.vue'

/**
 * The leaving lifecycle. Two things are being pinned here, and the second one matters more than the
 * first: that a frame is retained long enough to animate, and that it is *always* let go of again.
 * A frame that never retires is a leak that looks exactly like a working animation, so the loop and
 * the closeAll cases below are not optional.
 *
 * jsdom has no cascade, so the duration the host reads off the window element is stubbed rather
 * than imported from `style.css`; `transitions.browser.spec.ts` measures the real one.
 */

const unmounted = vi.fn()

const Content = defineComponent({
  props: { windowId: { type: String, default: '' } },
  unmounted,
  render() {
    return h('p', { class: 'content' }, 'content')
  },
})

let wrapper: VueWrapper | null = null

/** The host reads `--vtd-motion-duration` off the frame; jsdom will never resolve it for us. */
function withDuration(value: string) {
  const real = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    const computed = real(el as Element, pseudo as string | undefined)
    return {
      getPropertyValue: (prop: string) =>
        prop === '--vtd-motion-duration' ? value : computed.getPropertyValue(prop),
    } as unknown as CSSStyleDeclaration
  })
}

function app() {
  unmounted.mockClear()
  const plugin = createWindows({ components: { editor: Content }, maxWindows: 100 })
  wrapper = mount(
    defineComponent({
      components: { WindowHost, WindowTaskbar },
      template: `<WindowHost /><WindowTaskbar v-slot="{ all, setTaskbarRect }">
        <button v-for="w in all" :key="w.id" class="tb" :ref="(el) => setTaskbarRect(w.id, el)">{{ w.title }}</button>
      </WindowTaskbar>`,
    }),
    { global: { plugins: [plugin] }, attachTo: document.body },
  )
  return { wrapper: wrapper!, win: useWindows() }
}

/** One animation frame, then the render it caused. */
async function frame() {
  vi.advanceTimersByTime(16)
  await nextTick()
}

const dialogs = () => document.querySelectorAll('dialog.vw')
const stateOf = () => dialogs()[0]?.getAttribute('data-vw-state')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('the leaving lifecycle', () => {
  it('marks a new window entering, then open on the next frame', async () => {
    withDuration('300ms')
    const { win } = app()
    win.open('editor')
    await nextTick()

    expect(stateOf()).toBe('entering')
    await frame()
    expect(stateOf()).toBe('open')
  })

  it('opens a window straight into `open` while the tab is hidden', async () => {
    withDuration('300ms')
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    const { win } = app()
    win.open('editor')
    await nextTick()

    // A hidden tab delivers no animation frame, so a frame parked in `entering` would still be
    // parked — invisible, under the baseline sheet — when the tab is looked at again.
    expect(stateOf()).toBe('open')
    hidden.mockRestore()
  })

  it('keeps a closing window in the tree for the duration, then unmounts it', async () => {
    withDuration('300ms')
    const { win } = app()
    const id = win.open('editor').id
    await nextTick()
    await frame()

    win.close(id)
    await nextTick()

    // The store let go immediately; the frame did not, and it fades out with its content.
    expect(win.byId(id)).toBeUndefined()
    expect(dialogs()).toHaveLength(1)
    expect(stateOf()).toBe('leaving')
    expect(document.querySelector('.content')).not.toBeNull()
    expect(unmounted).not.toHaveBeenCalled()

    vi.advanceTimersByTime(299)
    await nextTick()
    expect(dialogs()).toHaveLength(1)

    vi.advanceTimersByTime(1)
    await nextTick()
    expect(dialogs()).toHaveLength(0)
    expect(unmounted).toHaveBeenCalledTimes(1)
  })

  it('unmounts a minimized window content at once and retains only its frame', async () => {
    withDuration('300ms')
    const { win } = app()
    const id = win.open('editor').id
    await nextTick()
    await frame()

    win.minimize(id)
    await nextTick()

    // The headline claim survives the animation: the frame lingers, the content does not.
    expect(dialogs()).toHaveLength(1)
    expect(stateOf()).toBe('leaving')
    expect(document.querySelector('.content')).toBeNull()
    expect(unmounted).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(300)
    await nextTick()
    expect(dialogs()).toHaveLength(0)
  })

  it('makes a leaving frame inert rather than letting it reach a store that forgot it', async () => {
    withDuration('300ms')
    const { wrapper, win } = app()
    const id = win.open('editor').id
    await nextTick()
    await frame()
    win.close(id)
    await nextTick()

    const dialog = wrapper.find('dialog.vw')
    expect((dialog.element as HTMLElement).style.pointerEvents).toBe('none')
    // pointer-events is what really prevents this; the guard is for synthesized events.
    await dialog.trigger('pointerdown')
    await wrapper.find('.vw__head').trigger('keydown', { key: 'ArrowRight' })
    expect(dialogs()).toHaveLength(1)
  })

  it('retires every frame of 50 opened and closed windows', async () => {
    withDuration('300ms')
    const { win } = app()

    for (let i = 0; i < 50; i++) {
      const id = win.open('editor', { i }).id
      await nextTick()
      win.close(id)
      await nextTick()
    }

    expect(dialogs().length).toBeGreaterThan(0) // they really were retained
    vi.advanceTimersByTime(300)
    await nextTick()
    expect(dialogs()).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves nothing behind when closeAll lands mid-transition', async () => {
    withDuration('300ms')
    const { win } = app()
    const ids = [win.open('editor', { i: 1 }).id, win.open('editor', { i: 2 }).id, win.open('editor', { i: 3 }).id]
    await nextTick()
    await frame()

    win.close(ids[0]!)
    await nextTick()
    expect(dialogs()).toHaveLength(3)

    win.closeAll()
    await nextTick()
    vi.advanceTimersByTime(300)
    await nextTick()

    expect(dialogs()).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('removes a closed window in the same tick when no duration is readable', async () => {
    const { win } = app() // no stylesheet, no stub: the pre-VW-05 behaviour
    const id = win.open('editor').id
    await nextTick()

    win.close(id)
    await nextTick()
    expect(dialogs()).toHaveLength(0)
    expect(unmounted).toHaveBeenCalledTimes(1)
    await frame() // the entering frame is the only thing that was ever queued
    expect(vi.getTimerCount()).toBe(0)
  })

  it('adopts the same frame back when a window is restored mid-leave', async () => {
    withDuration('300ms')
    const { win } = app()
    const id = win.open('editor').id
    await nextTick()
    await frame()

    win.minimize(id)
    await nextTick()
    win.restore(id)
    await nextTick()

    expect(dialogs()).toHaveLength(1) // adopted, not duplicated
    expect(stateOf()).toBe('open')
    expect(document.querySelector('.content')).not.toBeNull()

    vi.advanceTimersByTime(300)
    await nextTick()
    expect(dialogs()).toHaveLength(1) // and the cancelled retirement did not fire
  })

  it('retires a frame at once when the window is closed while already leaving', async () => {
    withDuration('300ms')
    const { win } = app()
    const id = win.open('editor').id
    await nextTick()
    await frame()

    win.minimize(id)
    await nextTick()
    win.close(id)
    await nextTick()

    expect(dialogs()).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('drops every retained frame and timer when the host unmounts', async () => {
    withDuration('300ms')
    const { wrapper, win } = app()
    win.open('editor', { i: 1 })
    win.open('editor', { i: 2 })
    await nextTick()
    await frame()
    win.closeAll()
    await nextTick()
    expect(dialogs()).toHaveLength(2)

    wrapper.unmount()
    expect(dialogs()).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('the minimize target', () => {
  it('turns a registered taskbar rect into fly-to properties on the leaving frame', async () => {
    withDuration('300ms')
    const { wrapper, win } = app()
    const id = win.open('editor', {}, { x: 100, y: 100, w: 400, h: 300 }).id
    await nextTick()
    await frame()

    // The consumer's own button, measured out of its ref callback. jsdom has no layout, so the
    // rect is stubbed onto the element the taskbar already handed the store.
    const button = wrapper.find('.tb').element
    button.getBoundingClientRect = () => ({ x: 700, y: 900, width: 80, height: 20 }) as DOMRect
    win.setTaskbarRect(id, button.getBoundingClientRect())

    win.minimize(id)
    await nextTick()

    const style = (wrapper.find('dialog.vw').element as HTMLElement).style
    // Centre of the window is 300,250; centre of the button is 740,910.
    expect(style.getPropertyValue('--vtd-min-x')).toBe('440px')
    expect(style.getPropertyValue('--vtd-min-y')).toBe('660px')
    expect(style.getPropertyValue('--vtd-min-scale')).toBe('0.2')
  })

  it('gives a closing window no fly-to properties — it has no button to fly to', async () => {
    withDuration('300ms')
    const { wrapper, win } = app()
    const id = win.open('editor', {}, { x: 100, y: 100, w: 400, h: 300 }).id
    await nextTick()
    await frame()
    win.setTaskbarRect(id, { x: 700, y: 900, w: 80, h: 20 })

    win.close(id)
    await nextTick()

    const style = (wrapper.find('dialog.vw').element as HTMLElement).style
    expect(style.getPropertyValue('--vtd-min-x')).toBe('')
    expect(style.getPropertyValue('--vtd-min-scale')).toBe('')
  })

  it('forgets a rect with its window, and hydrate clears the lot', async () => {
    const { win } = app()
    const id = win.open('editor').id
    win.setTaskbarRect(id, { x: 0, y: 0, w: 10, h: 10 })
    expect(win.taskbarRect(id)).toEqual({ x: 0, y: 0, w: 10, h: 10 })

    win.close(id)
    expect(win.taskbarRect(id)).toBeNull()

    const other = win.open('editor', { i: 2 }).id
    win.setTaskbarRect(other, { x: 0, y: 0, w: 10, h: 10 })
    win.hydrate([], 10)
    expect(win.taskbarRect(other)).toBeNull()
  })
})
