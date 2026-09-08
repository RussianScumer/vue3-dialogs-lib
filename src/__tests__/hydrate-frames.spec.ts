import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createWindows, useWindows } from '../createWindows'
import { useWindowState } from '../useWindowState'
import WindowHost from '../WindowHost.vue'
import { SCHEMA } from '../persist'
import type { ExternalChangeInfo, StorageLike, WindowDescriptor } from '../types'

/** Reads its draft the way a consumer does, so a stale descriptor shows up as stale text. */
const Content = defineComponent({
  props: { windowId: { type: String, default: '' } },
  setup(props) {
    const draft = useWindowState(props.windowId, () => ({ text: 'fresh' }))
    return () => h('p', { class: 'draft' }, draft.text)
  },
})

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

function descriptor(over: Partial<WindowDescriptor> = {}): WindowDescriptor {
  return {
    id: 'a', name: 'editor', props: {}, state: null, title: '', minimized: false,
    x: 10, y: 10, w: 640, h: 480, z: 12, meta: {},
    ...over,
  } as WindowDescriptor
}

/** A blob another tab wrote: same id, moved, with a draft of its own. */
function foreignBlob(stack: WindowDescriptor[]): string {
  return JSON.stringify({ schema: SCHEMA, topZ: 12, writer: 'another-tab', stack })
}

function app(persist?: { key: string; storage: StorageLike; onExternalChange?: (i: ExternalChangeInfo) => void }) {
  const plugin = createWindows({ components: { editor: Content }, persist })
  const wrapper = mount(WindowHost, { global: { plugins: [plugin] }, attachTo: document.body })
  return { wrapper, win: useWindows() }
}

let unmount: (() => void) | undefined

afterEach(() => {
  unmount?.()
  unmount = undefined
})

describe('a frame adopts a re-hydrated descriptor', () => {
  it('renders the descriptor hydrate() put in the store, in one frame', async () => {
    const { wrapper, win } = app()
    unmount = () => wrapper.unmount()
    const id = win.open('editor').id
    await nextTick()
    expect(wrapper.find('.draft').text()).toBe('fresh')

    win.hydrate([descriptor({ id, x: 300, state: { text: 'from the other tab' } })], 12)
    await nextTick()

    const dialogs = wrapper.findAll('dialog.vw')
    expect(dialogs).toHaveLength(1)
    expect((dialogs[0]!.element as HTMLElement).style.transform).toContain('300px')
    expect(wrapper.find('.draft').text()).toBe('from the other tab')
  })

  it('persists a drag made after the adoption', async () => {
    const { wrapper, win } = app()
    unmount = () => wrapper.unmount()
    const id = win.open('editor').id
    await nextTick()

    win.hydrate([descriptor({ id, x: 300 })], 12)
    await nextTick()

    // What a drag ends up doing: mutate the descriptor the frame is rendering.
    win.setGeometry(id, { x: 420 })
    await nextTick()
    expect(win.byId(id)!.x).toBe(420)
    expect((wrapper.find('dialog.vw').element as HTMLElement).style.transform).toContain('420px')
  })

  it('adopts through the plugin when resume() re-reads a foreign write', async () => {
    const storage = memoryStorage()
    let info: ExternalChangeInfo | undefined
    const { wrapper, win } = app({ key: 'k', storage, onExternalChange: (i) => void (info = i) })
    unmount = () => wrapper.unmount()
    const id = win.open('editor').id
    await nextTick()

    const blob = foreignBlob([descriptor({ id, x: 300, state: { text: 'from the other tab' } })])
    storage.data.set('k', blob)
    window.dispatchEvent(new StorageEvent('storage', { key: 'k', newValue: blob }))
    expect(info).toBeDefined()

    info!.resume()
    await nextTick()

    expect(wrapper.findAll('dialog.vw')).toHaveLength(1)
    expect((wrapper.find('dialog.vw').element as HTMLElement).style.transform).toContain('300px')
    expect(wrapper.find('.draft').text()).toBe('from the other tab')
  })

  it('lets a window the new blob drops depart through the leaving path', async () => {
    const { wrapper, win } = app()
    unmount = () => wrapper.unmount()
    const kept = win.open('editor').id
    // Same name and props would dedupe into the window already open.
    const dropped = win.open('editor', {}, { dedupe: false }).id
    await nextTick()
    expect(wrapper.findAll('dialog.vw')).toHaveLength(2)

    win.hydrate([descriptor({ id: kept, x: 300 })], 12)
    await nextTick()

    expect(wrapper.findAll('dialog.vw')).toHaveLength(1)
    expect(win.byId(dropped)).toBeUndefined()
  })

  it('leaves an untouched frame alone — no remount when the objects are the same', async () => {
    const mountedSpy = vi.fn()
    const Counted = defineComponent({
      props: { windowId: { type: String, default: '' } },
      mounted: mountedSpy,
      render: () => h('p'),
    })
    const plugin = createWindows({ components: { editor: Counted } })
    const wrapper = mount(WindowHost, { global: { plugins: [plugin] }, attachTo: document.body })
    unmount = () => wrapper.unmount()
    const win = useWindows()
    const a = win.open('editor').id
    win.open('editor', {}, { dedupe: false })
    await nextTick()
    expect(mountedSpy).toHaveBeenCalledTimes(2)

    win.focus(a)
    win.setGeometry(a, { x: 200 })
    await nextTick()
    expect(mountedSpy).toHaveBeenCalledTimes(2)
  })
})
