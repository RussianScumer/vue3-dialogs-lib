import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, effectScope, h } from 'vue'
import { mount } from '@vue/test-utils'
import { createWindows } from '../createWindows'
import { createViewport, useViewport } from '../useViewport'
import type { Viewport } from '../types'

const resizeCalls = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter(([type]) => type === 'resize')

function setSize(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h })
}

const initial = { w: window.innerWidth, h: window.innerHeight }

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  setSize(initial.w, initial.h)
})

describe('createViewport', () => {
  it('falls back to 1024×768 with no window, and attaches nothing', () => {
    vi.stubGlobal('window', undefined)
    const scope = effectScope()
    const view = scope.run(createViewport)!
    expect({ ...view }).toEqual({ w: 1024, h: 768 })
    scope.stop()
  })

  it('reads the window size and follows resize', () => {
    setSize(900, 700)
    const scope = effectScope()
    const view = scope.run(createViewport)!
    expect({ ...view }).toEqual({ w: 900, h: 700 })

    setSize(640, 480)
    window.dispatchEvent(new Event('resize'))
    expect({ ...view }).toEqual({ w: 640, h: 480 })
    scope.stop()
  })

  it('attaches one resize listener per scope and removes that same one on dispose', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const scope = effectScope()
    const view = scope.run(createViewport)!

    expect(resizeCalls(add)).toHaveLength(1)
    expect(resizeCalls(remove)).toHaveLength(0)

    scope.stop()
    expect(resizeCalls(remove)).toHaveLength(1)
    expect(resizeCalls(remove)[0]?.[1]).toBe(resizeCalls(add)[0]?.[1])

    // Detached for real: the tracker no longer moves.
    setSize(300, 200)
    window.dispatchEvent(new Event('resize'))
    expect(view.w).not.toBe(300)
  })
})

describe('useViewport', () => {
  it('throws outside an app that installed the plugin', () => {
    const Probe = defineComponent({
      setup() {
        useViewport()
        return () => h('div')
      },
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => mount(Probe)).toThrow(/plugin not installed/)
  })

  it('hands every component in the app the one tracker, behind one listener', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const seen: Viewport[] = []
    const Probe = defineComponent({
      setup() {
        seen.push(useViewport())
        return () => h('div')
      },
    })
    const wrapper = mount(defineComponent({ render: () => [h(Probe), h(Probe), h(Probe)] }), {
      global: { plugins: [createWindows({ components: {} })] },
    })

    expect(seen).toHaveLength(3)
    expect(seen[1]).toBe(seen[0])
    expect(seen[2]).toBe(seen[0])
    expect(resizeCalls(add)).toHaveLength(1)
    wrapper.unmount()
  })
})
