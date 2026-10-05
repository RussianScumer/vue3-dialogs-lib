import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, effectScope, h, nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createWindows, useWindows } from '../createWindows'
import { createCoarsePointer } from '../useViewport'
import WindowHost from '../WindowHost.vue'

/**
 * jsdom has no `matchMedia`, so each case installs one it controls: a single `(pointer: coarse)`
 * list whose `matches` the test flips, dispatching `change` the way a browser does when a tablet
 * loses its trackpad.
 */
function fakeMedia(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  const list = {
    media: '(pointer: coarse)',
    matches,
    addEventListener: vi.fn((_: string, fn: (e: MediaQueryListEvent) => void) => void listeners.add(fn)),
    removeEventListener: vi.fn((_: string, fn: (e: MediaQueryListEvent) => void) => void listeners.delete(fn)),
  }
  const matchMedia = vi.fn((query: string) => {
    expect(query).toBe('(pointer: coarse)')
    return list
  })
  vi.stubGlobal('matchMedia', matchMedia)
  return {
    list,
    listeners,
    matchMedia,
    set(next: boolean) {
      list.matches = next
      for (const fn of listeners) fn({ matches: next } as MediaQueryListEvent)
    },
  }
}

const Content = defineComponent({
  props: { windowId: { type: String, default: '' } },
  render: () => h('p', 'content'),
})

let wrapper: VueWrapper | null = null

function app() {
  wrapper = mount(defineComponent({ render: () => h(WindowHost) }), {
    global: { plugins: [createWindows({ components: { editor: Content }, mobileBreakpoint: 0 })] },
    attachTo: document.body,
  })
  return useWindows()
}

const grip = (dir: string) => document.querySelector<HTMLElement>(`[data-vw-grip="${dir}"]`)!

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.unstubAllGlobals()
})

describe('createCoarsePointer', () => {
  it('is false with no matchMedia, and attaches nothing', () => {
    expect(typeof window.matchMedia).toBe('undefined')
    const scope = effectScope()
    expect(scope.run(createCoarsePointer)!.value).toBe(false)
    scope.stop()
  })

  it('is false with no window at all', () => {
    vi.stubGlobal('window', undefined)
    const scope = effectScope()
    expect(scope.run(createCoarsePointer)!.value).toBe(false)
    scope.stop()
  })

  it('follows the media query, and removes its one listener on dispose', () => {
    const media = fakeMedia(true)
    const scope = effectScope()
    const coarse = scope.run(createCoarsePointer)!
    expect(coarse.value).toBe(true)
    expect(media.listeners.size).toBe(1)

    media.set(false)
    expect(coarse.value).toBe(false)

    scope.stop()
    expect(media.listeners.size).toBe(0)
  })

  it('the plugin queries once per app, however many windows are open', async () => {
    const media = fakeMedia(false)
    const win = app()
    win.open('editor', { n: 1 })
    win.open('editor', { n: 2 })
    win.open('editor', { n: 3 })
    await nextTick()
    expect(media.matchMedia).toHaveBeenCalledTimes(1)
    expect(media.listeners.size).toBe(1)

    wrapper!.unmount()
    wrapper = null
    expect(media.listeners.size).toBe(0)
  })
})

describe('grips under (pointer: coarse)', () => {
  it('keeps the 4px edges and 12px corners for a mouse', async () => {
    fakeMedia(false)
    app().open('editor', {})
    await nextTick()
    expect(grip('e').style.width).toBe('4px')
    expect(grip('n').style.height).toBe('4px')
    expect(grip('se').style.width).toBe('12px')
    expect(grip('se').style.height).toBe('12px')
  })

  it('widens edges to 20px and corners to 28px for a finger', async () => {
    fakeMedia(true)
    app().open('editor', {})
    await nextTick()
    expect(grip('e').style.width).toBe('20px')
    expect(grip('w').style.width).toBe('20px')
    expect(grip('n').style.height).toBe('20px')
    expect(grip('s').style.height).toBe('20px')
    for (const dir of ['nw', 'ne', 'sw', 'se']) {
      expect(grip(dir).style.width).toBe('28px')
      expect(grip(dir).style.height).toBe('28px')
    }
    // Still pinned to the frame's own edges: inward, never outside the clipping <dialog>.
    expect(grip('e').style.right).toBe('0px')
    expect(grip('se').style.bottom).toBe('0px')
  })

  it('switches live when the primary pointer changes', async () => {
    const media = fakeMedia(false)
    app().open('editor', {})
    await nextTick()
    expect(grip('e').style.width).toBe('4px')

    media.set(true)
    await nextTick()
    expect(grip('e').style.width).toBe('20px')

    media.set(false)
    await nextTick()
    expect(grip('e').style.width).toBe('4px')
  })
})
