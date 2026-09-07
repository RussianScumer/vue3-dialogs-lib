import { bench, describe } from 'vitest'
import { h } from 'vue'
import { createStore } from '../state'
import { resolveOptions } from '../options'
import { SCHEMA, setupPersist } from '../persist'
import type { StorageLike } from '../types'

const Stub = { render: () => h('div') }

function memoryStorage(): StorageLike & { last: string | null } {
  return {
    last: null,
    getItem() {
      return this.last
    },
    setItem(_k, v) {
      this.last = v
    },
    removeItem() {
      this.last = null
    },
  }
}

/** `draftBytes` stands in for how much form state a content component parks on its descriptor. */
function snapshot(count: number, draftBytes: number) {
  const note = 'x'.repeat(draftBytes)
  return JSON.stringify({
    schema: SCHEMA,
    topZ: 10 + count,
    stack: Array.from({ length: count }, (_, i) => ({
      id: `w-${i}`,
      name: 'editor',
      props: { id: i },
      state: { name: `draft ${i}`, note },
      title: `Item ${i}`,
      minimized: i % 2 === 0,
      x: 40, y: 40, w: 640, h: 480, z: 10 + i,
      meta: { version: 3 },
    })),
  })
}

function hydrateFrom(blob: string) {
  const storage = memoryStorage()
  storage.last = blob
  const options = resolveOptions({ components: { editor: Stub }, persist: { key: 'k', storage } })
  const store = createStore(options)
  setupPersist(store, options)
  return store
}

describe('hydrate on install', () => {
  const small = snapshot(8, 200)
  const many = snapshot(100, 200)
  const fat = snapshot(8, 100_000)
  const stale = snapshot(100, 200).replace(`"schema":${SCHEMA}`, '"schema":999')

  bench('8 windows, 200B drafts (typical)', () => {
    hydrateFrom(small)
  })

  bench('100 windows, 200B drafts', () => {
    hydrateFrom(many)
  })

  bench('8 windows, 100KB drafts', () => {
    hydrateFrom(fat)
  })

  bench('rejected snapshot (schema mismatch, 100 windows)', () => {
    hydrateFrom(stale)
  })
})

describe('write (one debounced flush)', () => {
  function stack(count: number, draftBytes: number) {
    const store = createStore(resolveOptions({ components: { editor: Stub }, maxWindows: 100000 }))
    const note = 'x'.repeat(draftBytes)
    for (let i = 0; i < count; i++) {
      const id = store.open('editor', { id: i }).id
      store.byId(id)!.state = { name: `draft ${i}`, note }
    }
    return store
  }

  const small = stack(8, 200)
  const many = stack(100, 200)
  const fat = stack(8, 100_000)

  bench('serialize 8 windows, 200B drafts', () => {
    JSON.stringify({ schema: SCHEMA, topZ: small.s.topZ, stack: small.s.stack })
  })

  bench('serialize 100 windows, 200B drafts', () => {
    JSON.stringify({ schema: SCHEMA, topZ: many.s.topZ, stack: many.s.stack })
  })

  bench('serialize 8 windows, 100KB drafts', () => {
    JSON.stringify({ schema: SCHEMA, topZ: fat.s.topZ, stack: fat.s.stack })
  })
})
