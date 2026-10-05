import { describe, expect, it } from 'vitest'
import { h, nextTick } from 'vue'
import { createStore } from '../state'
import { resolveOptions } from '../options'
import type { WindowEvent, WindowEventMap, WindowEventType } from '../types'

/**
 * The payload each event carries. `{ type, id }` is the base every listener already relies on and
 * `state.spec.ts` keeps covering it; this file covers what rides beside it.
 */

const Stub = { render: () => h('div') }
const view = { w: 1000, h: 800 }

function store(over: Record<string, unknown> = {}) {
  return createStore(
    resolveOptions({ components: { editor: Stub }, ...over }),
  )
}

/** Every event of one type, in order. */
function record<T extends WindowEventType>(win: ReturnType<typeof store>, type: T): WindowEventMap[T][] {
  const seen: WindowEventMap[T][] = []
  win.on(type, (e) => seen.push(e))
  return seen
}

describe('event payloads', () => {
  it('geometry carries the rect it settled on', () => {
    const win = store()
    const id = win.open('editor', {}, { x: 10, y: 20, w: 300, h: 200 }).id
    const seen = record(win, 'geometry')

    win.setGeometry(id, { x: 50, w: 400 })
    expect(seen).toEqual([{ type: 'geometry', id, rect: { x: 50, y: 20, w: 400, h: 200 } }])
  })

  it('close carries the reason, the result and the descriptor the stack has already let go of', () => {
    const win = store()
    const id = win.open('editor', { id: 1 }, { title: 'Item 1' }).id
    const seen = record(win, 'close')

    win.close(id)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ type: 'close', id, reason: 'closed', result: { ok: false, reason: 'closed' } })
    expect(seen[0]!.descriptor).toMatchObject({ id, name: 'editor', title: 'Item 1', props: { id: 1 } })
    expect(win.byId(id)).toBeUndefined()
  })

  it('close after resolve() reports `resolved` and the data', async () => {
    const win = store()
    const handle = win.open('editor', {})
    const seen = record(win, 'close')

    win.resolve(handle.id, { saved: 1 })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ reason: 'resolved', result: { ok: true, data: { saved: 1 } } })
    expect(await handle.result).toEqual(seen[0]!.result)
  })

  it('close from a guarded requestClose reports `dismissed`, and a veto reports nothing', async () => {
    const win = store()
    const id = win.open('editor', {}).id
    const seen = record(win, 'close')

    const off = win.onBeforeClose(id, () => false)
    expect(await win.requestClose(id)).toBe(false)
    expect(seen).toHaveLength(0)

    off()
    expect(await win.requestClose(id)).toBe(true)
    expect(seen.map((e) => e.reason)).toEqual(['dismissed'])
  })

  it('close from eviction reports `evicted`, guarded or not', async () => {
    const win = store({ maxWindows: 2 })
    const a = win.open('editor', { id: 1 }).id
    const b = win.open('editor', { id: 2 }).id
    const seen = record(win, 'close')

    win.open('editor', { id: 3 })
    expect(seen.map((e) => [e.id, e.reason])).toEqual([[a, 'evicted']])

    win.onBeforeClose(b, () => true)
    win.open('editor', { id: 4 })
    await Promise.resolve()
    await Promise.resolve()
    expect(seen.map((e) => [e.id, e.reason])).toEqual([
      [a, 'evicted'],
      [b, 'evicted'],
    ])
  })

  it('an owner takes its children with it, and they report `closed`', () => {
    const win = store()
    const owner = win.open('editor', {}).id
    const child = win.open('editor', {}, { owner }).id
    const seen = record(win, 'close')

    win.resolve(owner, 'done')
    expect(seen.map((e) => [e.id, e.reason])).toEqual([
      [child, 'closed'],
      [owner, 'resolved'],
    ])
  })

  it('closeAll reports `closed` for every window, and hydration reports `restored`', () => {
    const win = store()
    const a = win.open('editor', { id: 1 }).id
    const b = win.open('editor', { id: 2 }).id
    const seen = record(win, 'close')

    const kept = { ...win.byId(b)! }
    win.hydrate([kept], 12)
    expect(seen.map((e) => [e.id, e.reason])).toEqual([[a, 'restored']])
    expect(seen[0]!.descriptor.id).toBe(a)

    win.closeAll()
    // A hydrated window's result was settled at hydration, and that is what it reports.
    expect(seen.slice(1).map((e) => [e.id, e.reason, e.result])).toEqual([
      [b, 'closed', { ok: false, reason: 'restored' }],
    ])
  })

  it('pin fires on a change only', () => {
    const win = store()
    const id = win.open('editor', {}).id
    const seen = record(win, 'pin')

    win.setPinned(id, false) // pin-capable now, still unpinned
    win.setPinned(id, true)
    win.setPinned(id, true)
    win.setPinned(id, false)
    expect(seen).toEqual([
      { type: 'pin', id, pinned: true },
      { type: 'pin', id, pinned: false },
    ])
  })

  it('snap reports the zone, and null whichever way the snap is dropped', () => {
    const win = store()
    const id = win.open('editor', {}).id
    const seen = record(win, 'snap')
    const zones = () => seen.map((e) => e.zone)

    win.snap(id, 'left', view)
    win.snap(id, 'left', view) // same zone: geometry only
    win.snap(id, 'right', view)
    win.snap(id, 'none', view)
    win.snap(id, 'none', view) // not snapped: nothing
    expect(zones()).toEqual(['left', 'right', null])

    win.snap(id, 'max', view)
    win.undock(id)
    win.undock(id)
    win.snap(id, 'left', view)
    win.undockForDrag(id, 100)
    win.snap(id, 'right', view)
    win.setPinned(id, true)
    expect(zones()).toEqual(['left', 'right', null, 'max', null, 'left', null, 'right', null])
    expect(seen.every((e) => e.id === id)).toBe(true)
  })

  it('active fires once per settled change, with the previous window', async () => {
    const win = store()
    const a = win.open('editor', { id: 1 }).id
    await nextTick()
    const seen = record(win, 'active')

    const b = win.open('editor', { id: 2 }).id
    // Re-stacking a group moves several z values; one event, not one per intermediate top.
    const sheet = win.open('editor', {}, { owner: a })
    await nextTick()
    expect(seen).toEqual([{ type: 'active', id: sheet.id, previous: a }])

    win.focus(b)
    await nextTick()
    win.close(b)
    await nextTick()
    expect(seen.slice(1)).toEqual([
      { type: 'active', id: b, previous: sheet.id },
      { type: 'active', id: sheet.id, previous: b },
    ])

    // The last window going leaves nothing active, and `id` is always a window: no event.
    win.closeAll()
    await nextTick()
    expect(seen).toHaveLength(3)
  })

  it('props and meta carry the new value', () => {
    const win = store()
    const id = win.open('editor', { id: 1 }).id
    const seen: WindowEvent[] = []
    win.on('*', (e) => {
      if (e.type === 'props' || e.type === 'meta') seen.push(e)
    })

    win.updateProps(id, { id: 2 })
    win.setMeta(id, { version: 7 })
    expect(seen).toEqual([
      { type: 'props', id, props: { id: 2 } },
      { type: 'meta', id, meta: { version: 7 } },
    ])
  })

  it('restoring a window already on top emits restore and no focus', () => {
    const win = store()
    const id = win.open('editor', {}).id
    win.minimize(id)
    const seen: string[] = []
    win.on('*', (e) => seen.push(e.type))

    win.restore(id)
    expect(seen).toEqual(['restore'])
  })

  it('narrows on `type` and refuses a payload field on the bare union', () => {
    const win = store()
    const id = win.open('editor', {}).id
    const rects: unknown[] = []
    win.on('*', (e) => {
      if (e.type === 'geometry') rects.push(e.rect)
    })
    // @ts-expect-error `rect` exists on `geometry` only, so the union does not have it
    const bare = (e: WindowEvent) => e.rect
    void bare

    win.setGeometry(id, { w: 500 })
    expect(rects).toHaveLength(1)
  })
})
