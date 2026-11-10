import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createWindows, useWindows } from '../createWindows'
import { createStore } from '../state'
import { resolveOptions } from '../options'
import WindowHost from '../WindowHost.vue'
import type { WindowsOptions } from '../types'
import type { WindowsApi } from '../state'

const Stub = { render: () => h('div') }
const small = { w: 600, h: 500 }
const big = { w: 1000, h: 800 }

function store(extra: Partial<WindowsOptions> = {}) {
  return createStore(resolveOptions({ components: { editor: Stub }, ...extra }))
}

describe('mobileMode, store', () => {
  it('defaults to overflow and keeps always', () => {
    expect(resolveOptions({ components: {} }).mobileMode).toBe('overflow')
    expect(resolveOptions({ components: {}, mobileMode: 'always' }).mobileMode).toBe('always')
  })

  it('is never fullscreen at or above the breakpoint', () => {
    const win = store()
    win.attachViewport({ ...big })
    const id = win.open('editor', {}, { x: 0, y: 0, w: 1100, h: 300 }).id
    expect(win.isFullscreen(id)).toBe(false)
  })

  it('under overflow, is fullscreen only when the intent exceeds the viewport', () => {
    const win = store()
    win.attachViewport({ ...small })
    const fits = win.open('editor', { n: 1 }, { x: 0, y: 0, w: 400, h: 300 }).id
    const wide = win.open('editor', { n: 2 }, { x: 0, y: 0, w: 700, h: 300 }).id
    const tall = win.open('editor', { n: 3 }, { x: 0, y: 0, w: 400, h: 600 }).id
    expect(win.isFullscreen(fits)).toBe(false)
    expect(win.isFullscreen(wide)).toBe(true)
    expect(win.isFullscreen(tall)).toBe(true)
  })

  it('reads the intent, not the fitted rect', () => {
    const win = store()
    win.attachViewport({ ...small })
    const id = win.open('editor', {}, { w: 700, h: 300 }).id
    expect(win.byId(id)!.w).toBe(600)
    expect(win.isFullscreen(id)).toBe(true)
    win.clampAll(small)
    win.clampAll(small)
    expect(win.isFullscreen(id)).toBe(true)
  })

  it('answers for the view it is given', () => {
    const win = store()
    win.attachViewport({ ...big })
    const id = win.open('editor', {}, { x: 0, y: 0, w: 700, h: 300 }).id
    expect(win.isFullscreen(id)).toBe(false)
    expect(win.isFullscreen(id, small)).toBe(true)
  })

  it('under always, is fullscreen below the breakpoint only', () => {
    const win = store({ mobileMode: 'always' })
    win.attachViewport({ ...small })
    const id = win.open('editor', {}, { x: 0, y: 0, w: 400, h: 300 }).id
    expect(win.isFullscreen(id)).toBe(true)
    expect(win.isFullscreen(id, big)).toBe(false)
  })

  it('uses the fallback for an id the store dropped', () => {
    const win = store()
    expect(win.isFullscreen('nope', small)).toBe(false)
    expect(win.isFullscreen('nope', small, { w: 700, h: 300 })).toBe(true)
    expect(store({ mobileMode: 'always' }).isFullscreen('nope', small)).toBe(true)
  })

  it('reads the pre-snap rect of a docked window', () => {
    const win = store()
    win.attachViewport({ ...small })
    const id = win.open('editor', {}, { x: 0, y: 0, w: 700, h: 300 }).id
    win.snap(id, 'left', small)
    expect(win.isFullscreen(id)).toBe(true)
  })

  it('arranges only windows that are not fullscreen', () => {
    for (const [mode, expected] of [['overflow', 1], ['always', 0]] as const) {
      const win = store({ mobileMode: mode })
      win.attachViewport({ ...small })
      const fits = win.open('editor', {}, { x: 10, y: 10, w: 300, h: 200 }).id
      win.open('editor', { n: 2 }, { x: 0, y: 0, w: 700, h: 300 })
      const moved = win.tileAll(small)
      expect(moved).toEqual(expected ? [fits] : [])
    }
  })
})

let wrapper: VueWrapper | null = null

function app(options: Partial<WindowsOptions> = {}) {
  const plugin = createWindows({ components: { editor: Stub }, mobileBreakpoint: window.innerWidth + 1, ...options })
  wrapper = mount(
    defineComponent({
      components: { WindowHost },
      setup: () => ({ win: useWindows() }),
      template: '<WindowHost />',
    }),
    { global: { plugins: [plugin] }, attachTo: document.body },
  )
  return { wrapper, win: (wrapper.vm as unknown as { win: WindowsApi }).win }
}

const labels = { minimize: 'Minimize', close: 'Close', maximize: 'Maximize', restore: 'Restore' }
const dialog = () => document.querySelector('dialog.vw') as HTMLElement

async function frame() {
  vi.advanceTimersByTime(16)
  await nextTick()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.restoreAllMocks()
  vi.useRealTimers()
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
  window.dispatchEvent(new Event('resize'))
})

describe('mobileMode, frame', () => {
  it('keeps a fitting window floating and draggable', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', {}, { x: 100, y: 100, w: 400, h: 300 }).id
    await nextTick()
    expect(dialog().style.width).toBe('400px')
    expect(dialog().style.transform).toContain('translate(')
    await wrapper.find('.vw__head').trigger('keydown', { key: 'ArrowRight' })
    expect(win.byId(id)!.x).not.toBe(100)
  })

  it('makes an oversized window fullscreen and inert', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', {}, { x: 0, y: 0, w: 1100, h: 300 }).id
    await nextTick()
    expect(dialog().style.width).toBe('100vw')
    expect(dialog().style.transform).toBe('none')
    await wrapper.find('.vw__head').trigger('keydown', { key: 'ArrowRight' })
    expect(win.byId(id)!.x).toBe(0)
  })

  it('offers maximize to a fitting window only', async () => {
    const { win } = app({ labels })
    win.open('editor', {}, { x: 100, y: 100, w: 400, h: 300, maximizable: true })
    await nextTick()
    expect(document.querySelector('[data-vw-maximize]')).not.toBeNull()
    wrapper!.unmount()
    wrapper = null

    const second = app({ labels })
    second.win.open('editor', {}, { x: 0, y: 0, w: 1100, h: 300, maximizable: true })
    await nextTick()
    expect(document.querySelector('[data-vw-maximize]')).toBeNull()
  })

  it('snaps a fitting window by keyboard and not an oversized one', async () => {
    const { wrapper, win } = app()
    const fits = win.open('editor', {}, { x: 100, y: 100, w: 400, h: 300 }).id
    await nextTick()
    await wrapper.find('dialog.vw').trigger('keydown', { key: 'ArrowLeft', metaKey: true })
    expect(win.dockZone(fits)).toBe('left')

    win.closeAll()
    await vi.advanceTimersByTimeAsync(2000)
    const wide = win.open('editor', {}, { x: 0, y: 0, w: 1100, h: 300 }).id
    await nextTick()
    await wrapper.find('dialog.vw').trigger('keydown', { key: 'ArrowLeft', metaKey: true })
    expect(win.dockZone(wide)).toBeNull()
  })

  it('keeps a leaving frame fullscreen, and a fitting one floating', async () => {
    const real = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      const computed = real(el, pseudo)
      return {
        getPropertyValue: (prop: string) =>
          prop === '--vtd-motion-duration' ? '300ms' : computed.getPropertyValue(prop),
      } as unknown as CSSStyleDeclaration
    })
    const { win } = app()
    const wide = win.open('editor', {}, { w: 1100, h: 300 }).id
    await nextTick()
    vi.advanceTimersByTime(16)
    await nextTick()
    win.close(wide)
    await nextTick()
    expect(dialog().getAttribute('data-vw-state')).toBe('leaving')
    expect(dialog().style.width).toBe('100vw')

    await vi.advanceTimersByTimeAsync(2000)
    const fits = win.open('editor', {}, { x: 100, y: 100, w: 400, h: 300 }).id
    await nextTick()
    vi.advanceTimersByTime(16)
    await nextTick()
    win.close(fits)
    await nextTick()
    expect(dialog().getAttribute('data-vw-state')).toBe('leaving')
    expect(dialog().style.width).toBe('400px')
  })

  it.each([
    ['always', 900],
    ['overflow', 720],
  ] as const)('host reflow under %s below the breakpoint leaves x at %i', async (mode, x) => {
    const { win } = app({ mobileBreakpoint: 2000, mobileMode: mode })
    const id = win.open('editor', {}, { x: 900, y: 100, w: 400, h: 300 }).id
    await nextTick()
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
    window.dispatchEvent(new Event('resize'))
    await frame()
    await frame()
    expect(win.byId(id)!.x).toBe(x)
  })
})
