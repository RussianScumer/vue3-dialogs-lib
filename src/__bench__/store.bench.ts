import { bench, describe } from 'vitest'
import { h, nextTick } from 'vue'
import { createStore } from '../state'
import { resolveOptions } from '../options'

const Stub = { render: () => h('div') }

function storeWith(count: number, maxWindows = 100000) {
  const store = createStore(resolveOptions({ components: { editor: Stub }, maxWindows }))
  for (let i = 0; i < count; i++) store.open('editor', { id: i })
  return store
}

describe('open (steady state — the store is built once, outside the measurement)', () => {
  // maxWindows == the pre-filled count, so every open evicts the oldest and the
  // stack stays exactly this size for the whole run.
  const at8 = storeWith(8, 8)
  const at100 = storeWith(100, 100)
  const dedupe = storeWith(100)
  let i = 0

  bench('open at stack size 8 (dedupe scan + eviction)', () => {
    at8.open('editor', { id: 1_000_000 + i++ })
  })

  bench('open at stack size 100 (dedupe scan + eviction)', () => {
    at100.open('editor', { id: 2_000_000 + i++ })
  })

  bench('open a duplicate at stack size 100 (dedupe hit: restore + focus, no new window)', () => {
    dedupe.open('editor', { id: i++ % 100 })
  })

  bench('cold start: create a store and open 100 windows', () => {
    storeWith(100)
  })
})

describe('mutations at stack size 100', () => {
  const store = storeWith(100)
  const ids = store.s.stack.map((w) => w.id)
  let i = 0

  bench('focus', () => {
    store.focus(ids[i++ % ids.length]!)
  })

  bench('minimize + restore round trip', () => {
    const id = ids[i++ % ids.length]!
    store.minimize(id)
    store.restore(id)
  })

  bench('byId lookup', () => {
    store.byId(ids[i++ % ids.length]!)
  })

  bench('setGeometry (what a drag frame writes)', () => {
    store.setGeometry(ids[i++ % ids.length]!, { x: i % 500, y: i % 400 })
  })

  bench('clampAll (runs once per viewport resize)', () => {
    store.clampAll({ w: 1280, h: 800 })
  })
})

describe('close', () => {
  const pool = storeWith(100)
  let i = 0

  bench('open + close pair at stack size 100 (close re-filters the stack)', () => {
    const id = pool.open('editor', { id: 3_000_000 + i++ }).id
    pool.close(id)
  })

  bench('closeAll on 100 windows (includes building them)', () => {
    storeWith(100).closeAll()
  })
})

describe('reactivity', () => {
  bench('visible/minimized recompute after one drag write (100 windows)', async () => {
    const store = storeWith(100)
    void store.visible.value
    void store.minimized.value
    store.s.stack[0]!.x += 1
    void store.visible.value
    void store.minimized.value
    await nextTick()
  })
})
