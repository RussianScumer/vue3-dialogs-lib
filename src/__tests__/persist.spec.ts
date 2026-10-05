import { describe, expect, it, vi } from 'vitest'
import { h, nextTick } from 'vue'
import { createStore } from '../state'
import { resolveOptions } from '../options'
import { SCHEMA, setupPersist } from '../persist'
import type { StorageLike, WindowDescriptor } from '../types'

const Stub = { render: () => h('div') }

function memoryStorage(seed?: string): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  if (seed) data.set('k', seed)
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

function descriptor(over: Partial<WindowDescriptor> = {}): WindowDescriptor {
  return {
    id: 'a', name: 'editor', props: { id: 1 }, state: null, title: 'A', minimized: true,
    x: 10, y: 20, w: 640, h: 480, z: 11, meta: {}, ...over,
  } as WindowDescriptor
}

function setup(seed?: unknown, components: Record<string, unknown> = { editor: Stub }) {
  const storage = memoryStorage(seed === undefined ? undefined : JSON.stringify(seed))
  const options = resolveOptions({
    components: components as Parameters<typeof resolveOptions>[0]['components'],
    persist: { key: 'k', storage },
  })
  const store = createStore(options)
  setupPersist(store, options)
  return { store, storage }
}

describe('persist', () => {
  it('hydrates a valid snapshot and marks the windows restored', () => {
    const { store } = setup({ schema: SCHEMA, topZ: 11, stack: [descriptor()] })
    expect(store.s.stack).toHaveLength(1)
    expect(store.minimized.value).toHaveLength(1)
    expect(store.isRestored('a')).toBe(true)
  })

  it('drops a snapshot from a schema it cannot read', () => {
    const { store } = setup({ schema: SCHEMA + 1, topZ: 11, stack: [descriptor()] })
    expect(store.s.stack).toHaveLength(0)
  })

  it('migrates a schema-1 blob instead of throwing the windows away', () => {
    // A v1 descriptor predates every capability field.
    const v1 = { id: 'a', name: 'editor', props: { id: 1 }, state: { note: 'draft' }, title: 'A',
      minimized: false, x: 10, y: 20, w: 640, h: 480, z: 11, meta: {} }
    const { store } = setup({ schema: 1, topZ: 11, stack: [v1] })

    expect(store.s.stack).toHaveLength(1)
    expect(store.byId('a')!.state).toEqual({ note: 'draft' }) // the point: the draft survives
    expect(store.byId('a')).toMatchObject({
      closable: true, minimizable: true, draggable: true, resizable: true,
      minW: 160, minH: 80, maxW: null, maxH: null,
    })
  })

  it('fills a migrated descriptor from its component spec, not just the library defaults', () => {
    const v1 = { id: 'a', name: 'editor', props: {}, state: null, title: 'A',
      minimized: false, x: 10, y: 20, w: 640, h: 480, z: 11, meta: {} }
    const { store } = setup({ schema: 1, topZ: 11, stack: [v1] }, {
      editor: { component: Stub, closable: false, minW: 400 },
    })

    expect(store.byId('a')).toMatchObject({ closable: false, minW: 400 })
  })

  it('repairs a descriptor whose capability fields are junk', () => {
    const { store } = setup({
      schema: SCHEMA, topZ: 11,
      stack: [{ ...descriptor(), closable: 'yes', minW: 'wide', maxW: 'none', meta: null }],
    })
    expect(store.byId('a')).toMatchObject({ closable: true, minW: 160, maxW: null, meta: {} })
  })

  it('drops descriptors whose name is no longer registered', () => {
    const { store } = setup({ schema: SCHEMA, topZ: 11, stack: [descriptor({ name: 'gone' }), descriptor({ id: 'b' })] })
    expect(store.s.stack.map((w) => w.id)).toEqual(['b'])
  })

  it('survives malformed storage content', () => {
    const storage = memoryStorage('{not json')
    const options = resolveOptions({ components: { editor: Stub }, persist: { key: 'k', storage } })
    const store = createStore(options)
    expect(() => setupPersist(store, options)).not.toThrow()
    expect(store.s.stack).toHaveLength(0)
  })

  it('clamps hydrated geometry into the current viewport', () => {
    const { store } = setup({ schema: SCHEMA, topZ: 11, stack: [descriptor({ x: 99999, y: 99999 })] })
    expect(store.byId('a')!.x).toBe(window.innerWidth - 80)
  })

  it('clamps a hydrated size up to the minimum it declares', () => {
    // A blob written before the component raised its floor, or edited by hand: without the clamp
    // it renders under the minimum until the first resize.
    const { store } = setup({ schema: SCHEMA, topZ: 11, stack: [descriptor({ w: 10, h: 5 })] })
    expect(store.byId('a')).toMatchObject({ w: 160, h: 80 })
  })

  it('writes a debounced snapshot including draft state', async () => {
    vi.useFakeTimers()
    const { store, storage } = setup()
    const id = store.open('editor', { id: 7 }).id
    store.byId(id)!.state = { name: 'draft' }
    await nextTick()
    expect(storage.data.get('k')).toBeUndefined()

    vi.advanceTimersByTime(300)
    const written = JSON.parse(storage.data.get('k')!)
    expect(written.schema).toBe(SCHEMA)
    expect(written.stack[0].state).toEqual({ name: 'draft' })
    vi.useRealTimers()
  })

  it('flushes the pending write when the page goes away', async () => {
    vi.useFakeTimers()
    const { store, storage } = setup()
    const id = store.open('editor', { id: 7 }).id
    store.byId(id)!.state = { name: 'unsaved' }
    await nextTick()
    expect(storage.data.get('k')).toBeUndefined()

    // A reload a keystroke after the last edit: the debounce never gets to fire.
    window.dispatchEvent(new Event('pagehide'))
    expect(JSON.parse(storage.data.get('k')!).stack[0].state).toEqual({ name: 'unsaved' })

    // And the flushed timer does not fire a second time afterwards.
    storage.data.delete('k')
    vi.advanceTimersByTime(300)
    expect(storage.data.get('k')).toBeUndefined()
    vi.useRealTimers()
  })

  it('hydrates a non-finite topZ as 10 so windows can still be raised', () => {
    // `1e999` parses to `Infinity`; `Math.max(Infinity, …)` would then poison every later `++topZ`.
    const storage = memoryStorage(`{"schema":${SCHEMA},"topZ":1e999,"stack":[${JSON.stringify(descriptor())}]}`)
    const options = resolveOptions({ components: { editor: Stub }, persist: { key: 'k', storage } })
    const store = createStore(options)
    setupPersist(store, options)

    expect(store.s.topZ).toBe(11) // the finite z of the one hydrated window
    const id = store.open('editor').id
    expect(Number.isFinite(store.byId(id)!.z)).toBe(true)
    expect(store.byId(id)!.z).toBeGreaterThan(11)
  })

  it('hydrates a topZ that is not a number as 10', () => {
    const { store } = setup({ schema: SCHEMA, topZ: 'top', stack: [] })
    expect(store.s.topZ).toBe(10)
  })

  it('keeps the first of two descriptors that share an id', () => {
    const { store } = setup({
      schema: SCHEMA, topZ: 12,
      stack: [descriptor({ title: 'first' }), descriptor({ title: 'second', z: 12 })],
    })
    expect(store.s.stack).toHaveLength(1)
    expect(store.byId('a')!.title).toBe('first')
  })

  it('keeps at most maxWindows descriptors, the most recently used ones, in stack order', () => {
    const stack = Array.from({ length: 20 }, (_, i) => descriptor({ id: `w${i}`, z: 100 - i }))
    const storage = memoryStorage(JSON.stringify({ schema: SCHEMA, topZ: 100, stack }))
    const options = resolveOptions({ components: { editor: Stub }, persist: { key: 'k', storage } })
    const store = createStore(options)
    setupPersist(store, options)

    // Default limit is 8; the eight highest `z` are w0…w7, and they keep their original order.
    expect(store.s.stack.map((w) => w.id)).toEqual(['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'])
  })

  it('replaces a draft state that is not an object with null', () => {
    const { store } = setup({
      schema: SCHEMA, topZ: 11,
      stack: [descriptor({ state: 'draft' as unknown as null }), descriptor({ id: 'b', state: { ok: 1 } })],
    })
    expect(store.byId('a')!.state).toBeNull()
    expect(store.byId('b')!.state).toEqual({ ok: 1 })
  })
})
