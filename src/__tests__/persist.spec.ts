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
  }
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
})
