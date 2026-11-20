import { describe, expect, it, vi } from 'vitest'
import { h, nextTick } from 'vue'
import { createStore } from '../state'
import { resolveOptions } from '../options'
import { SCHEMA, setupPersist } from '../persist'
import type { StorageLike, WindowDescriptor } from '../types'
import type { WindowsApi } from '../state'

const Stub = { render: () => h('div') }

// The memoryStorage/descriptor/setup pattern of src/__tests__/persist.spec.ts:10–37, copied:
// the helpers there are file-local, and specs in this repo are self-contained (cf. the
// duplicated memoryStorage in src/__tests__/owned.spec.ts:52–61).
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

/** Global constraint 1 (amended): z is exactly a permutation of 1..n; topZ is the high-water
 *  stack size since hydrate, so topZ >= n and never shrinks between hydrates. */
function expectRankOrder(win: WindowsApi): void {
  const n = win.s.stack.length
  expect(win.s.topZ).toBeGreaterThanOrEqual(n)
  expect(win.s.stack.map((w) => w.z).sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i + 1))
}

/** Ids from bottom to top — the relative order compaction must never change. */
function orderByZ(win: WindowsApi): string[] {
  return [...win.s.stack].sort((a, b) => a.z - b.z).map((w) => w.id)
}

/**
 * The largest z-index any library element could render right now, mirroring the four
 * read-only formulas: frame bands 0/1/3 (src/BaseWindow.vue:337 — checking all three is an
 * upper bound for whichever one a frame renders in), context menu (src/BaseWindow.vue:513),
 * modal scrim (src/WindowHost.vue:241) and snap ghost (src/WindowHost.vue:317).
 */
function maxRenderedZ(win: WindowsApi, base: number): number {
  const topZ = win.s.topZ
  let max = base + 2 * topZ + 1
  max = Math.max(max, base + 4 * topZ + 1)
  for (const w of win.s.stack) {
    for (const band of [0, 1, 3]) max = Math.max(max, base + band * topZ + w.z)
    if (win.isModal(w.id)) max = Math.max(max, base + 3 * topZ + w.z - 1)
  }
  return max
}

describe('z/topZ rank-order compaction', () => {
  it('keeps rank order and the z-index band through 2000 focus alternations and opens', () => {
    // logistic's configuration: zIndexBase 1000, maxWindows 8 → band [1000, 1033],
    // permanently below Element Plus's 2000 (Global constraint 5).
    const win = createStore(resolveOptions({
      components: { editor: Stub, confirm: Stub },
      zIndexBase: 1000,
      maxWindows: 8,
    }))
    const owner = win.open('editor', { id: 1 }).id
    const child = win.open('confirm', {}, { owner }).id
    const other = win.open('editor', { id: 2 }).id
    const bandMax = 1000 + 4 * 8 + 1

    let churn: string | null = null
    for (let i = 0; i < 2000; i++) {
      // Alternate between two DIFFERENT groups. Focusing owner↔child within one group would
      // early-exit on the topmost guard (src/state.ts:365) after the first raise; alternating
      // the child's group with an outside window renumbers the whole owner chain every step —
      // the growth path that pushed 0.6.3's counters past the collision point.
      win.focus(i % 2 === 0 ? other : child)
      expectRankOrder(win)
      expect(win.byId(child)!.z).toBe(win.byId(owner)!.z + 1)
      expect(maxRenderedZ(win, 1000)).toBeLessThanOrEqual(bandMax)

      // Membership churn: one plain window in, the previous one out. Roots stay at 3 and the
      // whole stack at 4 ≤ maxWindows, so the band bound above is the documented one.
      if (i % 100 === 99) {
        if (churn !== null) {
          win.close(churn)
          // Amended invariant: the close shrinks the stack to 3, but topZ must hold the
          // high-water peak (4) — a leaving frame still renders against it. This is the
          // state the original test never sampled (it asserts only after the reopen).
          expect(win.s.stack).toHaveLength(3)
          expect(win.s.topZ).toBe(4)
        }
        churn = win.open('editor', { id: 1000 + i }).id
        expectRankOrder(win)
        expect(maxRenderedZ(win, 1000)).toBeLessThanOrEqual(bandMax)
      }
    }
    // 0.6.3 would be at topZ ≈ 3000 here; the compacted store never left 4.
    expect(win.s.stack).toHaveLength(4)
    expect(win.s.topZ).toBe(4)
  })

  it('preserves focus order, alt-tab cycling and the topmost no-event guard', () => {
    const win = createStore(resolveOptions({ components: { editor: Stub }, zIndexBase: 1000 }))
    const a = win.open('editor', { id: 1 }).id
    const b = win.open('editor', { id: 2 }).id
    const c = win.open('editor', { id: 3 }).id
    expect(orderByZ(win)).toEqual([a, b, c])
    expect(win.activeId.value).toBe(c)

    // Focus order: each raise moves exactly one window to the top, the rest keep their order.
    win.focus(a)
    expect(orderByZ(win)).toEqual([b, c, a])
    expect(win.activeId.value).toBe(a)
    expectRankOrder(win)
    win.focus(b)
    expect(orderByZ(win)).toEqual([c, a, b])
    expectRankOrder(win)
    win.focus(c)
    expect(orderByZ(win)).toEqual([a, b, c])
    expectRankOrder(win)

    // Alt-tab: focusNext wraps from the top to the bottom and walks the whole stack.
    const nexts = [win.focusNext(), win.focusNext(), win.focusNext(), win.focusNext()]
    expect(nexts).toEqual([a, b, c, a])
    expect(orderByZ(win)).toEqual([b, c, a])
    expectRankOrder(win)

    // focusPrev from the top picks the one directly below — the window just left — and
    // raising it makes it the top, so repeated prev alternates the top two. Pre-existing
    // behaviour (src/__tests__/keymap.spec.ts:249–253), unchanged by compaction.
    const prevs = [win.focusPrev(), win.focusPrev(), win.focusPrev()]
    expect(prevs).toEqual([c, a, c])
    expect(win.activeId.value).toBe(c)
    expect(orderByZ(win)).toEqual([b, a, c])
    expectRankOrder(win)

    // Already topmost → no focus event and no store write at all. Synchronous assertions:
    // the default-flush `active` watcher has not run yet, exactly as in
    // src/__tests__/state.spec.ts:251–266 — do not add `await nextTick()` here without
    // updating the expected event list.
    const events: string[] = []
    win.on('*', (e) => events.push(e.type))
    const before = win.s.stack.map((w) => [w.id, w.z])
    win.focus(c)
    win.focus(c)
    expect(events).toEqual([])
    expect(win.s.stack.map((w) => [w.id, w.z])).toEqual(before)
    expect(win.s.topZ).toBe(3)
    win.focus(b)
    expect(events).toEqual(['focus'])
    expect(win.activeId.value).toBe(b)
  })

  it('heals a poisoned topZ on hydrate and writes small counters on the next save', async () => {
    vi.useFakeTimers()
    const { store, storage } = setup({
      schema: SCHEMA,
      topZ: 100000,
      stack: [
        descriptor({ id: 'a', z: 99999, minimized: false }),
        descriptor({ id: 'b', z: 100000, minimized: false }),
      ],
    })

    // Compacted on hydrate: the persisted counter is ignored, order by z survives.
    expectRankOrder(store)
    expect(store.s.topZ).toBe(2)
    expect(store.byId('a')!.z).toBe(1)
    expect(store.byId('b')!.z).toBe(2)

    // The blob in storage is still the poisoned one: hydrateFromStorage absorbs the healed
    // string into `last` (src/persist.ts:217–223), so the debounced write is skipped as
    // identical. A real mutation is what triggers the healed save — do not assert earlier.
    expect((JSON.parse(storage.data.get('k')!) as { topZ: number }).topZ).toBe(100000)

    store.focus('a')
    await nextTick()
    vi.advanceTimersByTime(300)
    const written = JSON.parse(storage.data.get('k')!) as { schema: number, topZ: number, stack: WindowDescriptor[] }
    expect(written.schema).toBe(SCHEMA)
    expect(written.topZ).toBe(2)
    for (const w of written.stack) expect(w.z).toBeLessThanOrEqual(8)
    expect([...written.stack].sort((x, y) => x.z - y.z).map((w) => w.id)).toEqual(['b', 'a'])
    vi.useRealTimers()
  })

  it('round-trips the stack ordering through save and hydrate', async () => {
    vi.useFakeTimers()
    const { store, storage } = setup()
    const a = store.open('editor', { id: 1 }).id
    const b = store.open('editor', { id: 2 }).id
    const c = store.open('editor', { id: 3 }).id
    store.focus(a) // z-order now differs from creation order
    await nextTick()
    vi.advanceTimersByTime(300)
    const saved = JSON.parse(storage.data.get('k')!) as { stack: WindowDescriptor[] }
    const orderBefore = orderByZ(store)
    expect(orderBefore).toEqual([b, c, a])

    // A second store over the same storage is a reload.
    const options2 = resolveOptions({ components: { editor: Stub }, persist: { key: 'k', storage } })
    const store2 = createStore(options2)
    setupPersist(store2, options2)

    expect(store2.s.stack.map((w) => w.id)).toEqual([a, b, c]) // the array keeps creation order
    expect(orderByZ(store2)).toEqual(orderBefore)
    expectRankOrder(store2)
    expect(store2.s.topZ).toBe(3) // hydrate reset the high-water to the incoming stack size
    for (const id of [a, b, c]) {
      expect(store2.byId(id)!.z).toBe(store.byId(id)!.z)
      expect(store2.isRestored(id)).toBe(true)
    }
    expect([...saved.stack].sort((x, y) => x.z - y.z).map((w) => w.id)).toEqual(orderBefore)
    vi.useRealTimers()
  })
})
