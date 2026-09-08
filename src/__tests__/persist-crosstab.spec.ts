import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, effectScope, h, nextTick, type EffectScope } from 'vue'
import { createWindows, useWindows } from '../createWindows'
import { createStore } from '../state'
import { resolveOptions } from '../options'
import { SCHEMA, setupPersist } from '../persist'
import type { ExternalChangeInfo, StorageLike } from '../types'

const Stub = { render: () => h('div') }

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

/** A blob some other tab wrote: a valid snapshot carrying a writer token that is not ours. */
function foreignBlob(id = 'x'): string {
  return JSON.stringify({
    schema: SCHEMA, topZ: 12, writer: 'another-tab',
    stack: [{
      id, name: 'editor', props: {}, state: null, title: '', minimized: false,
      x: 10, y: 20, w: 640, h: 480, z: 12, meta: {},
    }],
  })
}

function fire(key: string | null, newValue: string | null): void {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }))
}

let scope: EffectScope | undefined

/** The plugin runs `setupPersist` inside its own scope; a spec has to supply one to match. */
function setup(onExternalChange?: (info: ExternalChangeInfo) => void) {
  const storage = memoryStorage()
  const options = resolveOptions({
    components: { editor: Stub },
    persist: { key: 'k', storage, onExternalChange },
  })
  const store = createStore(options)
  scope = effectScope(true)
  scope.run(() => setupPersist(store, options))
  return { store, storage }
}

afterEach(() => {
  scope?.stop()
  scope = undefined
  vi.useRealTimers()
})

describe('cross-tab persistence', () => {
  it('stops persisting and reports once when another tab writes the key', async () => {
    vi.useFakeTimers()
    const seen: ExternalChangeInfo[] = []
    const { store, storage } = setup((info) => void seen.push(info))

    store.open('editor')
    await nextTick()
    fire('k', foreignBlob())

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ key: 'k', newValue: foreignBlob() })

    // The write scheduled before the foreign one must not land after it.
    vi.advanceTimersByTime(300)
    expect(storage.data.get('k')).toBeUndefined()
  })

  it('ignores this tab’s own writes across a burst and across two flushes', async () => {
    vi.useFakeTimers()
    const onExternalChange = vi.fn()
    const { store, storage } = setup(onExternalChange)

    const id = store.open('editor').id
    store.byId(id)!.state = { note: 'a' }
    store.setGeometry(id, { x: 40, y: 40 })
    await nextTick()
    vi.advanceTimersByTime(300)
    fire('k', storage.data.get('k')!) // as if the adapter echoed our own write back

    store.setGeometry(id, { x: 80, y: 80 })
    await nextTick()
    vi.advanceTimersByTime(300)
    fire('k', storage.data.get('k')!)

    expect(onExternalChange).not.toHaveBeenCalled()
    expect(JSON.parse(storage.data.get('k')!).stack[0]).toMatchObject({ x: 80, y: 80 })
  })

  it('writes nothing after it has stopped', async () => {
    vi.useFakeTimers()
    const { store, storage } = setup()
    const id = store.open('editor').id
    await nextTick()
    vi.advanceTimersByTime(300)
    const before = storage.data.get('k')!

    fire('k', foreignBlob())
    store.setGeometry(id, { x: 300, y: 300 })
    store.close(id)
    await nextTick()
    vi.advanceTimersByTime(1000)

    expect(storage.data.get('k')).toBe(before)
  })

  it('flushes nothing on pagehide once another tab has taken over', async () => {
    vi.useFakeTimers()
    const { store, storage } = setup()
    store.open('editor')
    await nextTick()

    fire('k', foreignBlob())
    window.dispatchEvent(new Event('pagehide'))

    expect(storage.data.get('k')).toBeUndefined()
  })

  it('treats a cleared storage and an unreadable value as foreign', () => {
    const cleared = vi.fn()
    setup(cleared)
    fire(null, null) // storage.clear() in another tab
    expect(cleared).toHaveBeenCalledTimes(1)

    scope?.stop()
    const junk = vi.fn()
    setup(junk)
    fire('k', '{not json')
    expect(junk).toHaveBeenCalledTimes(1)
  })

  it('ignores a write to a different key', () => {
    const onExternalChange = vi.fn()
    setup(onExternalChange)
    fire('other', foreignBlob())
    expect(onExternalChange).not.toHaveBeenCalled()
  })

  it('resume() adopts the other tab’s blob and starts writing again', async () => {
    vi.useFakeTimers()
    const { store, storage } = setup((info) => {
      storage.data.set('k', info.newValue!) // the adapter is this tab's own map in the spec
      info.resume()
    })
    store.open('editor')

    fire('k', foreignBlob('from-b'))
    await nextTick()

    expect(store.s.stack.map((w) => w.id)).toEqual(['from-b'])
    expect(store.isRestored('from-b')).toBe(true)

    store.setGeometry('from-b', { x: 55, y: 55 })
    await nextTick()
    vi.advanceTimersByTime(300)
    const written = JSON.parse(storage.data.get('k')!)
    expect(written.stack[0]).toMatchObject({ id: 'from-b', x: 55, y: 55 })
    expect(written.writer).not.toBe('another-tab') // ours now
  })

  it('stays stopped when the consumer ignores the report, and survives one that throws', async () => {
    vi.useFakeTimers()
    const { store, storage } = setup(() => {
      throw new Error('consumer blew up')
    })
    store.open('editor')

    expect(() => fire('k', foreignBlob())).not.toThrow()
    store.open('editor')
    await nextTick()
    vi.advanceTimersByTime(300)
    expect(storage.data.get('k')).toBeUndefined()
  })

  it('a plain in-memory adapter behaves exactly as before, with no warning', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { store, storage } = setup()

    store.open('editor')
    await nextTick()
    vi.advanceTimersByTime(300)

    expect(JSON.parse(storage.data.get('k')!).stack).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('takes its listener with it when the app unmounts', () => {
    const storage = memoryStorage()
    const onExternalChange = vi.fn()
    const app = createApp({ setup: () => () => h('div') })
    app.use(createWindows({
      components: { editor: Stub },
      persist: { key: 'k', storage, onExternalChange },
    }))
    const el = document.createElement('div')
    app.mount(el)
    useWindows() // proves the plugin installed

    app.unmount()
    fire('k', foreignBlob())
    expect(onExternalChange).not.toHaveBeenCalled()
  })
})
