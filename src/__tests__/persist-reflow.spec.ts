import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, h, nextTick } from 'vue'
import type { EffectScope } from 'vue'
import { createStore } from '../state'
import { resolveOptions } from '../options'
import { SCHEMA, setupPersist } from '../persist'
import { clampX, clampY, dockRect, snapRect } from '../geometry'
import type { StorageLike, Viewport, WindowDescriptor } from '../types'

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
    id: 'a', name: 'editor', props: { id: 1 }, state: null, title: 'A', minimized: false,
    x: 10, y: 20, w: 640, h: 480, z: 11, meta: {}, ...over,
  } as WindowDescriptor
}

const initial = { w: window.innerWidth, h: window.innerHeight }
function resize(v: Viewport): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: v.w })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: v.h })
}

const big = { w: 1000, h: 800 }
const small = { w: 600, h: 500 }

const scopes: EffectScope[] = []

function boot(seed: unknown, view: Viewport) {
  resize(view)
  const storage = memoryStorage(seed === undefined ? undefined : typeof seed === 'string' ? seed : JSON.stringify(seed))
  const options = resolveOptions({ components: { editor: Stub }, persist: { key: 'k', storage } })
  const store = createStore(options)
  store.attachViewport({ ...view })
  const scope = effectScope()
  scope.run(() => setupPersist(store, options))
  scopes.push(scope)
  return { store, storage, options }
}

const flush = async (): Promise<void> => {
  await nextTick()
  vi.advanceTimersByTime(300)
}
const blob = (s: { data: Map<string, string> }) => JSON.parse(s.data.get('k')!)

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.useRealTimers()
  vi.restoreAllMocks()
  resize(initial)
})

/** Two windows at `big`: a free-floating one and one snapped right. */
function arranged() {
  vi.useFakeTimers()
  const { store, storage, options } = boot(undefined, big)
  const a = store.open('editor', { id: 1 }, { x: 500, y: 100, w: 400, h: 300 }).id
  const b = store.open('editor', { id: 2 }, { x: 120, y: 90, w: 500, h: 400 }).id
  store.snap(b, 'right', big)
  return { store, storage, options, a, b }
}

describe('persist intent', () => {
  it('writes intent rects, docks and modes with the live descriptor keys', async () => {
    const { store, storage, a, b } = arranged()
    await flush()
    const data = blob(storage)
    expect(data.schema).toBe(SCHEMA)
    expect(Object.keys(data)).toEqual(['schema', 'topZ', 'stack', 'docks', 'modes', 'writer'])
    expect(data.docks).toEqual({ [b]: 'right' })
    expect(Object.keys(data.modes)).toEqual([a])
    const sb = data.stack.find((d: WindowDescriptor) => d.id === b)
    expect(sb).toMatchObject({ x: 120, y: 90, w: 500, h: 400 })
    for (const d of data.stack as WindowDescriptor[]) {
      expect(Object.keys(d).sort()).toEqual(Object.keys(store.byId(d.id)!).sort())
    }
  })

  it('writes nothing for a viewport-only reflow (I2)', async () => {
    const { store, storage } = arranged()
    store.open('editor', { id: 3 }, { placement: 'center', w: 400, h: 300 })
    await flush()
    const setItem = vi.spyOn(storage, 'setItem')
    setItem.mockClear()
    const a = store.s.stack[0]!
    const x = a.x
    store.clampAll(small)
    expect(a.x).not.toBe(x)
    await flush()
    store.clampAll(big)
    await flush()
    expect(setItem).not.toHaveBeenCalled()
  })

  it('writes nothing for the first reflow after an un-snap (I2)', async () => {
    vi.useFakeTimers()
    const { store, storage } = boot(undefined, big)
    const id = store.open('editor', { id: 1 }, { x: 500, y: 100, w: 400, h: 300 }).id
    store.snap(id, 'right', big)
    await flush()
    const setItem = vi.spyOn(storage, 'setItem')
    setItem.mockClear()
    store.snap(id, 'none', big)
    await flush()
    expect(setItem).toHaveBeenCalledTimes(1)
    const data = blob(storage)
    expect(data.docks).toEqual({})
    expect(Object.keys(data.modes)).toEqual([id])
    setItem.mockClear()
    const x = store.byId(id)!.x
    store.clampAll(small)
    expect(store.byId(id)!.x).not.toBe(x)
    await flush()
    store.clampAll(big)
    await flush()
    expect(setItem).not.toHaveBeenCalled()
  })

  it('skips an equal edit and writes a changed one', async () => {
    const { store, storage, a } = arranged()
    await flush()
    const setItem = vi.spyOn(storage, 'setItem')
    setItem.mockClear()
    store.setGeometry(a, { x: 510 })
    await nextTick()
    store.setGeometry(a, { x: 500 })
    await flush()
    expect(setItem).not.toHaveBeenCalled()
    store.setGeometry(a, { x: 510 })
    await flush()
    expect(setItem).toHaveBeenCalledTimes(1)
  })

  it('writes a dock-only change', async () => {
    vi.useFakeTimers()
    const { store, storage, options } = boot(undefined, big)
    const r = snapRect('left', big, options.snap.insets)
    const id = store.open('editor', { id: 1 }, { ...r }).id
    await flush()
    const setItem = vi.spyOn(storage, 'setItem')
    setItem.mockClear()
    const before = JSON.stringify(store.s)
    store.snap(id, 'left', big)
    expect(JSON.stringify(store.s)).toBe(before)
    await flush()
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(blob(storage).docks).toEqual({ [id]: 'left' })
  })

  it('restores a dock after reload and un-snaps to the pre-snap rect (I5)', async () => {
    const { storage, b } = arranged()
    await flush()
    const { store, options } = boot(storage.data.get('k')!, small)
    const insets = options.snap.insets
    expect(store.dockZone(b)).toBe('right')
    const w = store.byId(b)!
    expect({ x: w.x, y: w.y, w: w.w, h: w.h }).toEqual(dockRect('right', w, small, insets))
    expect(w.x + w.w).toBeLessThanOrEqual(small.w)
    expect(store.intentOf(b)).toEqual({ x: 120, y: 90, w: 500, h: 400 })
    store.clampAll(big)
    expect({ x: w.x, y: w.y, w: w.w, h: w.h }).toEqual(dockRect('right', w, big, insets))
    store.attachViewport({ ...big })
    store.snap(b, 'none', big)
    expect({ x: w.x, y: w.y, w: w.w, h: w.h }).toEqual({ x: 120, y: 90, w: 500, h: 400 })
  })

  it('restores the arrangement when widening after a narrow reload (I6)', async () => {
    vi.useFakeTimers()
    const first = boot(undefined, big)
    const a = first.store.open('editor', { id: 1 }, { x: 500, y: 100, w: 400, h: 300 }).id
    const c = first.store.open('editor', { id: 2 }, { placement: 'center', w: 400, h: 300 }).id
    await flush()
    const { store, storage } = boot(first.storage.data.get('k')!, small)
    expect(store.byId(a)).toMatchObject({ x: 200 })
    expect(store.byId(c)).toMatchObject({ x: 100, y: 100 })
    const setItem = vi.spyOn(storage, 'setItem')
    await flush()
    expect(setItem).not.toHaveBeenCalled()
    store.clampAll(big)
    await flush()
    expect(setItem).not.toHaveBeenCalled()
    expect(store.byId(a)).toMatchObject({ x: 500, y: 100, w: 400, h: 300 })
    expect(store.byId(c)).toMatchObject({ x: 300, y: 250 })
    expect(store.axisModesOf(c)).toEqual({ x: 'centre', y: 'centre' })
  })

  it('hydrates a legacy blob to the reach-clamped rects', () => {
    const stack = [
      descriptor({ id: 'p', x: 99999, y: 99999 }),
      descriptor({ id: 'q', x: 10, y: 20 }),
      descriptor({ id: 'r', x: 500, y: 400, w: 640, h: 480 }),
    ]
    const copy = JSON.parse(JSON.stringify(stack)) as WindowDescriptor[]
    const { store } = boot({ schema: SCHEMA, topZ: 11, stack }, small)
    const bounds = store.options.bounds
    for (const d of copy) {
      expect(store.byId(d.id)).toMatchObject({
        x: clampX(d.x, d.w, small, bounds), y: clampY(d.y, d.h, small, bounds), w: d.w, h: d.h,
      })
      expect(store.dockZone(d.id)).toBeNull()
    }
  })

  it('drops invalid docks and modes silently', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
    const seed = {
      schema: SCHEMA, topZ: 11, future: 1,
      stack: [descriptor({ id: 'a' }), descriptor({ id: 'b', x: 700, y: 50 })],
      docks: { a: 'diagonal', b: 'left', ghost: 'max' },
      modes: { a: { x: 'center', y: 'fit' }, b: 'x', ghost: { x: 'fit', y: 'fit' } },
    }
    const { store, storage } = boot(seed, big)
    expect(store.s.stack).toHaveLength(2)
    expect(store.dockZone('a')).toBeNull()
    expect(store.dockZone('b')).toBe('left')
    expect(store.axisModesOf('a')).toEqual({ x: 'fit', y: 'fit' })
    expect(warn).not.toHaveBeenCalled()
    store.setGeometry('a', { x: 30 })
    await flush()
    const data = blob(storage)
    expect(data.docks).toEqual({ b: 'left' })
    expect(Object.keys(data.modes)).toEqual(['a'])
    expect(JSON.stringify(data)).not.toContain('diagonal')
    expect(JSON.stringify(data)).not.toContain('ghost')

    for (const bad of [null, []]) {
      const { store: s2 } = boot({ ...seed, docks: bad, modes: bad }, big)
      expect(s2.dockZone('b')).toBeNull()
      expect(s2.axisModesOf('b')).not.toBeNull()
    }
  })

  it('keeps docks across resume() without writing back', async () => {
    vi.useFakeTimers()
    const foreign = (id: string) => JSON.stringify({
      schema: SCHEMA, topZ: 11, writer: 'another-tab', stack: [descriptor({ id })], docks: { [id]: 'max' }, modes: {},
    })
    resize(big)
    const storage = memoryStorage()
    let resume: () => void = () => {}
    const options = resolveOptions({
      components: { editor: Stub },
      persist: { key: 'k', storage, onExternalChange: (info) => { resume = info.resume } },
    })
    const store = createStore(options)
    store.attachViewport({ ...big })
    const scope = effectScope()
    scope.run(() => setupPersist(store, options))
    const setItem = vi.spyOn(storage, 'setItem')
    const raw = foreign('f')
    storage.data.set('k', raw)
    window.dispatchEvent(new StorageEvent('storage', { key: 'k', newValue: raw }))
    resume()
    expect(store.dockZone('f')).toBe('max')
    await nextTick()
    vi.advanceTimersByTime(400)
    expect(setItem).not.toHaveBeenCalled()
    scope.stop()
  })
})
