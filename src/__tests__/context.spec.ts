import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createWindows, useWindowOptions, useWindows } from '../createWindows'
import { provideWindowContext, useWindowContext } from '../useWindowContext'
import type { WindowContext } from '../injection'
import type { ResolvedOptions } from '../types'

const Stub = defineComponent({ render: () => h('div') })

/**
 * `provideWindowContext` is what `BaseWindow` calls for each window; a consumer replacing the frame
 * calls it too. This mounts it by hand, outside any frame, so the round trip is the only thing
 * under test.
 */
function setup(id: () => string) {
  let provided: WindowContext | null = null
  let injected: WindowContext<string> | null = null
  let options: ResolvedOptions | null = null

  const Child = defineComponent({
    setup() {
      injected = useWindowContext<string>()
      options = useWindowOptions()
      return () => h('div')
    },
  })
  const Frame = defineComponent({
    setup() {
      provided = provideWindowContext(useWindows().byId(id())!)
      return () => h(Child)
    },
  })

  const plugin = createWindows({ components: { editor: Stub }, mobileBreakpoint: 123, maxWindows: 3 })
  return {
    plugin,
    mount: () => mount(Frame, { global: { plugins: [plugin] } }),
    get provided() { return provided! },
    get injected() { return injected! },
    get options() { return options! },
  }
}

describe('provideWindowContext / useWindowContext', () => {
  it('the content injects exactly the context the frame provided', () => {
    let id = ''
    const s = setup(() => id)
    // Install first, so the store exists to open into.
    const wrapper = mount(Stub, { global: { plugins: [s.plugin] } })
    id = useWindows().open('editor', {}).id
    const frame = s.mount()

    expect(s.injected).toBe(s.provided)
    expect(s.injected.descriptor).toBe(useWindows().byId(id))
    expect(s.injected.isRestored).toBe(false)
    frame.unmount()
    wrapper.unmount()
  })

  it('routes every action to the store, for this window only', async () => {
    let id = ''
    const s = setup(() => id)
    const wrapper = mount(Stub, { global: { plugins: [s.plugin] } })
    const win = useWindows()
    const other = win.open('editor', { n: 2 }).id
    const handle = win.open('editor', { n: 1 })
    id = handle.id
    const frame = s.mount()

    s.injected.setTitle('renamed')
    expect(win.byId(id)!.title).toBe('renamed')
    expect(win.byId(other)!.title).not.toBe('renamed')

    s.injected.minimize()
    await nextTick()
    expect(win.byId(id)!.minimized).toBe(true)
    expect(win.byId(other)!.minimized).toBe(false)

    s.injected.resolve('saved')
    await expect(handle.result).resolves.toEqual({ ok: true, data: 'saved' })
    expect(win.byId(id)).toBeUndefined()
    expect(win.byId(other)).toBeDefined()
    frame.unmount()
    wrapper.unmount()
  })

  it('throws outside a window', () => {
    const Probe = defineComponent({
      setup() {
        useWindowContext()
        return () => h('div')
      },
    })
    expect(() => mount(Probe)).toThrow(/outside a window/)
  })
})

describe('useWindowOptions', () => {
  it('returns the resolved options inside a component and outside one after install', () => {
    let id = ''
    const s = setup(() => id)
    const wrapper = mount(Stub, { global: { plugins: [s.plugin] } })
    id = useWindows().open('editor', {}).id
    const frame = s.mount()

    expect(s.options.mobileBreakpoint).toBe(123)
    expect(s.options.maxWindows).toBe(3)
    expect(useWindowOptions()).toBe(s.options)
    frame.unmount()
    wrapper.unmount()
  })
})
