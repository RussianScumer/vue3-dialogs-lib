import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createStore } from '../state'
import { resolveOptions } from '../options'
import { createWindows, useWindows } from '../createWindows'
import { useWindowContext } from '../useWindowContext'
import { SCHEMA, setupPersist } from '../persist'
import WindowHost from '../WindowHost.vue'
import type { StorageLike, WindowResult, WindowsOptions } from '../types'

/**
 * Window results: `open()` hands back `{ id, result }`, and the promise settles exactly once —
 * with what the content resolved, or with the reason the window went away. jsdom, and deliberately
 * so: every claim here is store bookkeeping plus one binding in `useWindowContext`, and nothing in
 * it is measured against the UA.
 */

const Stub = { render: () => h('div') }

function store(over: Partial<WindowsOptions> = {}) {
  return createStore(resolveOptions({ components: { editor: Stub, confirm: Stub }, ...over }))
}

/** Resolves with the promise's value if it has already settled, and with PENDING if it has not. */
const PENDING = Symbol('pending')

function settled<T>(p: Promise<T>): Promise<T | typeof PENDING> {
  return Promise.race([p, new Promise<typeof PENDING>((r) => setTimeout(() => r(PENDING), 0))])
}

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

let wrapper: VueWrapper | null = null

/** Content that answers on command, so the resolve path runs where a consumer would run it. */
const Answerer = defineComponent({
  props: { windowId: { type: String, default: '' } },
  setup() {
    const { resolve, dismiss } = useWindowContext<{ saved: number }>()
    return () => h('div', [
      h('button', { class: 'ok', onClick: () => resolve({ saved: 42 }) }),
      h('button', { class: 'no', onClick: () => dismiss() }),
    ])
  },
})

function app() {
  const plugin = createWindows({ components: { editor: Answerer } })
  wrapper = mount(defineComponent({ components: { WindowHost }, template: '<WindowHost />' }), {
    global: { plugins: [plugin] },
    attachTo: document.body,
  })
  return { wrapper, win: useWindows() }
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.restoreAllMocks()
})

describe('window results', () => {
  it('settles { ok: true, data } and closes the window when the content resolves', async () => {
    const { wrapper, win } = app()
    const handle = win.open('editor', {})
    await nextTick()

    await wrapper.find('button.ok').trigger('click')
    await expect(handle.result).resolves.toEqual({ ok: true, data: { saved: 42 } })
    expect(win.byId(handle.id)).toBeUndefined()
  })

  it('settles closed when the content dismisses', async () => {
    const { wrapper, win } = app()
    const handle = win.open('editor', {})
    await nextTick()

    await wrapper.find('button.no').trigger('click')
    await expect(handle.result).resolves.toEqual({ ok: false, reason: 'closed' })
    expect(win.byId(handle.id)).toBeUndefined()
  })

  it('stays pending while the window is open, and settles closed on close()', async () => {
    const win = store()
    const handle = win.open('editor', { id: 1 })
    await expect(settled(handle.result)).resolves.toBe(PENDING)

    win.close(handle.id)
    await expect(handle.result).resolves.toEqual({ ok: false, reason: 'closed' })
  })

  it('settles closed through requestClose, and stays pending when a guard refuses', async () => {
    const win = store()
    const handle = win.open('editor', { id: 1 })
    win.onBeforeClose(handle.id, () => false)

    await expect(win.requestClose(handle.id)).resolves.toBe(false)
    // The window is still open, so the question it was opened to answer is still open too.
    await expect(settled(handle.result)).resolves.toBe(PENDING)

    win.onBeforeClose(handle.id, () => true)
    await expect(win.requestClose(handle.id)).resolves.toBe(true)
    await expect(handle.result).resolves.toEqual({ ok: false, reason: 'closed' })
  })

  it('leaves nothing pending after closeAll()', async () => {
    const win = store()
    const handles = Array.from({ length: 5 }, (_, i) => win.open('editor', { id: i }))

    win.closeAll()
    // Every one of them, not just the ones a test remembered to await: a caller left hanging by a
    // logout is the failure this whole rule exists to prevent.
    const answers = await Promise.all(handles.map((h) => settled(h.result)))
    expect(answers).toEqual(handles.map(() => ({ ok: false, reason: 'closed' })))
  })

  it('settles the window maxWindows evicts', async () => {
    const win = store({ maxWindows: 2 })
    const first = win.open('editor', { id: 1 })
    win.open('editor', { id: 2 })
    win.open('editor', { id: 3 })

    expect(win.byId(first.id)).toBeUndefined()
    await expect(first.result).resolves.toEqual({ ok: false, reason: 'closed' })
  })

  it('settles a child when its owner closes', async () => {
    const win = store()
    const owner = win.open('editor', { id: 1 })
    const child = win.open('confirm', {}, { owner: owner.id })

    win.close(owner.id)
    await expect(child.result).resolves.toEqual({ ok: false, reason: 'closed' })
    await expect(owner.result).resolves.toEqual({ ok: false, reason: 'closed' })
  })

  it('hands a deduped caller the same window and the same answer', async () => {
    const win = store()
    const first = win.open('editor', { id: 1 })
    const again = win.open('editor', { id: 1 })

    expect(again.id).toBe(first.id)
    win.resolve(first.id, 'saved')
    await expect(again.result).resolves.toEqual({ ok: true, data: 'saved' })
  })

  it('answers only once — the close that resolve() performs cannot overwrite the value', async () => {
    const win = store()
    const handle = win.open('editor', { id: 1 })

    win.resolve(handle.id, 7)
    win.close(handle.id)
    await expect(handle.result).resolves.toEqual({ ok: true, data: 7 })
  })

  it('settles a restored window as restored, before anyone can ask', async () => {
    const storage = memoryStorage(
      JSON.stringify({
        schema: SCHEMA,
        topZ: 11,
        stack: [{ id: 'a', name: 'editor', props: {}, minimized: false, x: 10, y: 10, w: 300, h: 200, z: 11 }],
      }),
    )
    const options = resolveOptions({ components: { editor: Stub }, persist: { key: 'k', storage } })
    const win = createStore(options)
    setupPersist(win, options)

    expect(win.isRestored('a')).toBe(true)
    // Already settled, not settled-on-await: the opener belongs to a page load that is over.
    await expect(settled(win.resultOf('a'))).resolves.toEqual({ ok: false, reason: 'restored' })
  })

  it('answers closed for an id the store no longer has', async () => {
    const win = store()
    const handle = win.open('editor', { id: 1 })
    win.close(handle.id)

    await expect(settled(win.resultOf(handle.id))).resolves.toEqual({ ok: false, reason: 'closed' })
    await expect(settled(win.resultOf('never-existed'))).resolves.toEqual({ ok: false, reason: 'closed' })
  })

  it('keeps the result out of the persisted blob and out of the descriptor', async () => {
    vi.useFakeTimers()
    const storage = memoryStorage()
    const options = resolveOptions({
      components: { editor: { component: Stub, w: 320, result: null as unknown as { saved: number } } },
      persist: { key: 'k', storage },
    })
    const win = createStore(options)
    setupPersist(win, options)

    // The `result` marker is type-only: it reaches neither the spec defaults nor the window.
    expect(options.defaultsFor('editor')).toEqual({ w: 320 })
    const handle = win.open('editor', { id: 1 })
    expect(Object.keys(win.byId(handle.id)!)).not.toContain('result')

    await nextTick()
    vi.advanceTimersByTime(300)
    expect(storage.data.get('k')!).not.toContain('result')
    vi.useRealTimers()
  })

  it('warns once in dev when the handle is used where a string was expected', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const win = store()
    const handle = win.open('editor', { id: 1 })

    expect(String(handle)).toBe(handle.id)
    expect(`${win.open('editor', { id: 2 })}`).toBeTypeOf('string')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/returns \{ id, result \}/)
  })

  it('reaches a subscriber that was waiting before the answer arrived', async () => {
    const seen: WindowResult[] = []
    const { wrapper, win } = app()
    const handle = win.open('editor', {})
    void handle.result.then((r) => seen.push(r))
    await nextTick()

    await wrapper.find('button.ok').trigger('click')
    await handle.result
    expect(seen).toEqual([{ ok: true, data: { saved: 42 } }])
  })
})
