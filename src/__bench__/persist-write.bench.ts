import { bench, describe } from 'vitest'
import { h, nextTick } from 'vue'
import { createStore } from '../state'
import { resolveOptions } from '../options'
import { setupPersist } from '../persist'
import type { StorageLike } from '../types'

const Stub = { render: () => h('div') }

function memoryStorage(): StorageLike & { last: string | null; writes: number } {
  return {
    last: null,
    writes: 0,
    getItem() {
      return this.last
    },
    setItem(_k, v) {
      this.last = v
      this.writes++
    },
    removeItem() {
      this.last = null
    },
  }
}

function persisted(count: number) {
  const storage = memoryStorage()
  const options = resolveOptions({ components: { editor: Stub }, persist: { key: 'k', storage }, maxWindows: 100000 })
  const store = createStore(options)
  setupPersist(store, options)
  for (let i = 0; i < count; i++) store.open('editor', { id: i })
  return { store, storage }
}

/**
 * The deep watcher schedules on Vue's queue; `pagehide` then runs the pending debounced write
 * synchronously, so a bench need not wait out the 300ms timer.
 */
const flush = async (): Promise<void> => {
  await nextTick()
  window.dispatchEvent(new Event('pagehide'))
}

describe('write path (setupPersist, flushed by pagehide)', () => {
  for (const count of [8, 100]) {
    const { store, storage } = persisted(count)
    const first = store.s.stack[0]!
    let before = 0
    let flip = 0
    bench(
      `write after one edit, ${count} windows`,
      async () => {
        first.x = 40 + (flip++ % 2)
        await flush()
      },
      {
        setup: async () => {
          await flush()
          before = storage.writes
        },
        teardown: () => {
          if (storage.writes <= before) throw new Error('the edit wrote nothing')
        },
      },
    )
  }

  {
    const { store, storage } = persisted(8)
    let before = 0
    let flip = 0
    bench(
      'viewport-only reflow, 8 windows (serialize, no setItem)',
      async () => {
        store.clampAll(flip++ % 2 ? { w: 1280, h: 800 } : { w: 480, h: 360 })
        await flush()
      },
      {
        setup: async () => {
          await flush()
          before = storage.writes
        },
        teardown: () => {
          if (storage.writes !== before) throw new Error('a viewport-only reflow wrote to storage')
        },
      },
    )
  }
})
