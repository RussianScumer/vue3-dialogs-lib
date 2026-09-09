import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createStore } from '../state'
import { resolveOptions } from '../options'
import { SCHEMA, setupPersist } from '../persist'
import { createWindows, useWindows } from '../createWindows'
import WindowHost from '../WindowHost.vue'
import type { StorageLike } from '../types'

/**
 * What a modal is in the store and in the rendered z-index. `inert` and hit testing are the UA's,
 * and jsdom implements neither, so everything the scrim and the sweep actually promise is measured
 * in `modal.browser.spec.ts` instead.
 */

const Stub = { render: () => h('div') }
const view = { w: 1000, h: 800 }

function store(over: Record<string, unknown> = {}) {
  return createStore(
    resolveOptions({ components: { editor: Stub, confirm: Stub }, ...over } as Parameters<
      typeof resolveOptions
    >[0]),
  )
}

function app(over: Record<string, unknown> = {}) {
  const plugin = createWindows({
    components: { editor: Stub, confirm: Stub },
    ...over,
  } as Parameters<typeof createWindows>[0])
  const wrapper = mount(defineComponent({ components: { WindowHost }, template: '<WindowHost />' }), {
    global: { plugins: [plugin] },
    attachTo: document.body,
  })
  return { wrapper, win: useWindows() }
}

function zOf(el: Element): number {
  return Number((el as HTMLElement).style.zIndex)
}

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

describe('modal windows — store', () => {
  it('never lets `modal` reach the descriptor, and is independent of the pin', () => {
    const win = store()
    const id = win.open('editor', { id: 1 }, { modal: true }).id

    expect(win.byId(id)).not.toHaveProperty('modal')
    expect(win.isModal(id)).toBe(true)
    expect(win.isPinned(id)).toBe(false)
    expect(win.isPinnable(id)).toBe(false)
    // A modal cannot be minimized away from its own scrim, the same forcing an owned window gets.
    expect(win.byId(id)!.minimizable).toBe(false)
  })

  it('takes `modal` from the component spec as well as from open()', () => {
    const win = store({ components: { editor: Stub, confirm: { component: Stub, modal: true } } })
    expect(win.isModal(win.open('confirm').id)).toBe(true)
    expect(win.isModal(win.open('editor').id)).toBe(false)
  })

  it('blocks every other window, and nothing at all when no modal is open', () => {
    const win = store()
    const plain = win.open('editor', { id: 1 }).id
    expect(win.topModalId()).toBeNull()
    expect(win.isBlockedByModal(plain)).toBe(false)

    const modal = win.open('editor', { id: 2 }, { modal: true }).id
    const sheet = win.open('confirm', {}, { owner: modal }).id

    expect(win.topModalId()).toBe(modal)
    expect(win.isBlockedByModal(plain)).toBe(true)
    expect(win.isBlockedByModal(modal)).toBe(false)
    // The modal's own question is not blocked by it.
    expect(win.isBlockedByModal(sheet)).toBe(false)

    win.close(modal)
    expect(win.topModalId()).toBeNull()
    expect(win.isBlockedByModal(plain)).toBe(false)
  })

  it('blocks the lower of two stacked modals', () => {
    const win = store()
    const low = win.open('editor', { id: 1 }, { modal: true }).id
    const high = win.open('editor', { id: 2 }, { modal: true }).id

    expect(win.topModalId()).toBe(high)
    expect(win.isBlockedByModal(low)).toBe(true)
    expect(win.isBlockedByModal(high)).toBe(false)
  })

  it('forgets the modal on close, closeAll and hydrate', () => {
    const win = store()
    const a = win.open('editor', { id: 1 }, { modal: true }).id
    win.close(a)
    expect(win.isModal(a)).toBe(false)

    const b = win.open('editor', { id: 2 }, { modal: true }).id
    win.closeAll()
    expect(win.isModal(b)).toBe(false)

    const c = win.open('editor', { id: 3 }, { modal: true }).id
    win.hydrate([{ ...win.byId(c)! }], 12)
    expect(win.isModal(c)).toBe(false)
    expect(win.topModalId()).toBeNull()
  })
})

describe('modal windows — placement and presets', () => {
  it('centres a `placement: center` window and lets an explicit coordinate win', () => {
    const win = store()
    win.attachViewport(view)

    const centred = win.open('editor', { id: 1 }, { placement: 'center', w: 400, h: 300 }).id
    expect(win.byId(centred)).toMatchObject({ x: (view.w - 400) / 2, y: (view.h - 300) / 2 })

    // One axis at a time: a call that pins only `y` keeps the centred `x`.
    const pinnedY = win.open('editor', { id: 2 }, { placement: 'center', w: 400, h: 300, y: 12 }).id
    expect(win.byId(pinnedY)).toMatchObject({ x: (view.w - 400) / 2, y: 12 })
  })

  it('still cascades by default', () => {
    const win = store()
    win.attachViewport(view)
    expect(win.byId(win.open('editor', { id: 1 }).id)).toMatchObject({ x: 40, y: 40 })
    expect(win.byId(win.open('editor', { id: 2 }).id)).toMatchObject({ x: 68, y: 68 })
  })

  it('puts a preset between the open() call and the component spec', () => {
    const win = store({
      components: { editor: { component: Stub, w: 200, h: 100, title: 'spec' }, confirm: Stub },
      presets: { dialog: { modal: true, placement: 'center', w: 420, h: 200, title: 'preset' } },
    })
    win.attachViewport(view)

    const id = win.open('editor', { id: 1 }, { preset: 'dialog' }).id
    // The preset outranks the component's own spec…
    expect(win.byId(id)).toMatchObject({ w: 420, h: 200, title: 'preset' })
    expect(win.isModal(id)).toBe(true)
    expect(win.byId(id)!.x).toBe((view.w - 420) / 2)

    // …and loses to the explicit options of the call that named it.
    const own = win.open('editor', { id: 2 }, { preset: 'dialog', w: 300, title: 'call' }).id
    expect(win.byId(own)).toMatchObject({ w: 300, title: 'call' })
  })

  it('throws on a preset nobody registered, before anything is opened', () => {
    const win = store({ presets: { dialog: { modal: true } } })
    expect(() => win.open('editor', {}, { preset: 'nope' })).toThrow(/preset/)
    expect(win.s.stack).toHaveLength(0)
  })
})

describe('modal windows — render', () => {
  it('draws a modal above a pinned window and above one focused after it', async () => {
    const { wrapper, win } = app({ zIndexBase: 1000 })
    win.open('editor', { id: 1 }, { fixed: true })
    win.open('editor', { id: 2 }, { modal: true })
    const other = win.open('editor', { id: 3 }).id
    await nextTick()

    const [pinnedEl, modalEl, otherEl] = wrapper.findAll('dialog.vw').map((w) => w.element)
    expect(zOf(modalEl!)).toBeGreaterThan(zOf(pinnedEl!))
    expect(zOf(modalEl!)).toBeGreaterThan(zOf(otherEl!))

    win.focus(other)
    await nextTick()
    expect(zOf(modalEl!)).toBeGreaterThan(zOf(otherEl!))
  })

  it('draws a pinned modal in the modal band, not the pinned one', async () => {
    const { wrapper, win } = app()
    win.open('editor', { id: 1 }, { fixed: true })
    win.open('editor', { id: 2 }, { modal: true, fixed: true })
    await nextTick()

    const [pinnedEl, both] = wrapper.findAll('dialog.vw').map((w) => w.element)
    expect(zOf(both!)).toBeGreaterThan(zOf(pinnedEl!))
  })

  it('draws one scrim, one below the top modal, and none without one', async () => {
    const { wrapper, win } = app({ zIndexBase: 1000 })
    win.open('editor', { id: 1 })
    await nextTick()
    expect(wrapper.findAll('.vw-scrim')).toHaveLength(0)

    win.open('editor', { id: 2 }, { modal: true })
    const top = win.open('editor', { id: 3 }, { modal: true }).id
    await nextTick()

    const scrims = wrapper.findAll('.vw-scrim')
    expect(scrims).toHaveLength(1)
    const topEl = wrapper.findAll('dialog.vw')[2]!.element
    expect(zOf(scrims[0]!.element)).toBe(zOf(topEl) - 1)

    win.close(top)
    await nextTick()
    // The lower modal is still open, so the page stays dimmed — under it now.
    expect(wrapper.findAll('.vw-scrim')).toHaveLength(1)

    win.closeAll()
    await nextTick()
    expect(wrapper.findAll('.vw-scrim')).toHaveLength(0)
  })

  it('keeps a sheet owned by the modal above the scrim', async () => {
    const { wrapper, win } = app()
    const modal = win.open('editor', { id: 1 }, { modal: true }).id
    win.open('confirm', {}, { owner: modal })
    await nextTick()

    const sheetEl = wrapper.findAll('dialog.vw')[1]!.element
    expect(zOf(sheetEl)).toBeGreaterThan(zOf(wrapper.find('.vw-scrim').element))
  })

  it('dismisses a modal on ESC instead of minimizing it, guard and all', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 }, { modal: true }).id
    const guard = vi.fn(() => true)
    win.onBeforeClose(id, guard)
    await nextTick()

    await wrapper.find('dialog.vw').trigger('keydown.escape')
    await nextTick()

    expect(guard).toHaveBeenCalledTimes(1)
    expect(win.byId(id)).toBeUndefined()
  })

  it('leaves ESC on an ordinary window alone while no modal is open', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 }).id
    await nextTick()

    await wrapper.find('dialog.vw').trigger('keydown.escape')
    expect(win.byId(id)!.minimized).toBe(true)
  })
})

describe('modal windows — persistence', () => {
  it('never writes a modal, and a reload comes back without it', async () => {
    const storage = memoryStorage()
    const options = resolveOptions({
      components: { editor: Stub },
      persist: { key: 'k', storage },
    })
    const win = createStore(options)
    setupPersist(win, options)

    const plain = win.open('editor', { id: 1 }).id
    const modal = win.open('editor', { id: 2 }, { modal: true }).id

    vi.useFakeTimers()
    win.setTitle(plain, 'touched') // wakes the debounced watcher
    await nextTick()
    vi.advanceTimersByTime(300)
    vi.useRealTimers()

    const raw = storage.data.get('k')!
    expect(raw).not.toMatch(/modal|scrim/)
    expect(raw).not.toContain(modal)
    expect(JSON.parse(raw)).toMatchObject({ schema: SCHEMA })
    expect(JSON.parse(raw).stack).toHaveLength(1)
  })
})
