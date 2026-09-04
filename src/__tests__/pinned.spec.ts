import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createStore } from '../state'
import { resolveOptions } from '../options'
import { SCHEMA, setupPersist } from '../persist'
import { createWindows, useWindows } from '../createWindows'
import WindowHost from '../WindowHost.vue'
import type { StorageLike } from '../types'

const Stub = { render: () => h('div') }
const view = { w: 1000, h: 800 }

function store() {
  return createStore(resolveOptions({ components: { editor: Stub, viewer: Stub } }))
}

/** vue-test-utils cannot set `button`/`pointerId`, and jsdom has no PointerEvent — build it here. */
function pointer(el: Element, type: string, pointerId: number, clientX: number, clientY: number) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY })
  Object.assign(e, { pointerId })
  el.dispatchEvent(e)
}

function app(components: Record<string, unknown> = { editor: Stub }) {
  const plugin = createWindows({
    components: components as Parameters<typeof createWindows>[0]['components'],
  })
  const wrapper = mount(defineComponent({ components: { WindowHost }, template: '<WindowHost />' }), {
    global: { plugins: [plugin] },
    attachTo: document.body,
  })
  return { wrapper, win: useWindows() }
}

function zOf(el: Element): number {
  return Number((el as HTMLElement).style.zIndex)
}

describe('pinned windows — store', () => {
  it('makes a window pin-capable only when `fixed` was mentioned', () => {
    const win = store()
    const plain = win.open('editor', { id: 1 }).id
    const pinned = win.open('editor', { id: 2 }, { fixed: true }).id
    const capable = win.open('editor', { id: 3 }, { fixed: false }).id

    expect(win.isPinnable(plain)).toBe(false)
    expect(win.isPinned(plain)).toBe(false)
    expect(win.isPinnable(pinned)).toBe(true)
    expect(win.isPinned(pinned)).toBe(true)
    // `fixed: false` is still a mention: the window gets the affordance without starting pinned.
    expect(win.isPinnable(capable)).toBe(true)
    expect(win.isPinned(capable)).toBe(false)
  })

  it('takes `fixed` from the component spec, and lets open() outrank it', () => {
    const win = createStore(
      resolveOptions({ components: { hud: { component: Stub, fixed: true }, editor: Stub } }),
    )
    expect(win.isPinned(win.open('hud').id)).toBe(true)
    expect(win.isPinned(win.open('hud', {}, { fixed: false, dedupe: false }).id)).toBe(false)
  })

  it('never lets `fixed` reach the descriptor', () => {
    const win = store()
    const id = win.open('editor', { id: 1 }, { fixed: true }).id
    expect(win.byId(id)).not.toHaveProperty('fixed')
  })

  it('setPinned toggles, and pinning drops the snap without moving the window', () => {
    const win = store()
    const id = win.open('editor', { id: 1 }, { fixed: false }).id
    win.snap(id, 'left', view)
    const snapped = { ...win.byId(id)! }

    win.setPinned(id, true)
    expect(win.isPinned(id)).toBe(true)
    expect(win.dockZone(id)).toBeNull()
    expect(win.byId(id)).toMatchObject({ x: snapped.x, y: snapped.y, w: snapped.w, h: snapped.h })

    win.setPinned(id, false)
    expect(win.isPinned(id)).toBe(false)
    expect(win.isPinnable(id)).toBe(true)
  })

  it('setPinned makes an ordinary window pin-capable rather than refusing', () => {
    const win = store()
    const id = win.open('editor', { id: 1 }).id
    win.setPinned(id, true)
    expect(win.isPinnable(id)).toBe(true)
    expect(win.isPinned(id)).toBe(true)
    expect(() => win.setPinned('nope', true)).toThrow(/no window/)
  })

  it('refuses to snap a pinned window, however the snap is asked for', () => {
    const win = store()
    const id = win.open('editor', { id: 1 }, { x: 40, y: 50, w: 400, h: 300, fixed: true }).id

    win.snap(id, 'left', view)
    expect(win.dockZone(id)).toBeNull()
    expect(win.byId(id)).toMatchObject({ x: 40, y: 50, w: 400, h: 300 })

    win.setPinned(id, false)
    win.snap(id, 'left', view)
    expect(win.dockZone(id)).toBe('left')
  })

  it('forgets the pin on close, closeAll and hydrate', () => {
    const win = store()
    const a = win.open('editor', { id: 1 }, { fixed: true }).id
    win.close(a)
    expect(win.isPinnable(a)).toBe(false)

    const b = win.open('editor', { id: 2 }, { fixed: true }).id
    win.closeAll()
    expect(win.isPinnable(b)).toBe(false)

    const c = win.open('editor', { id: 3 }, { fixed: true }).id
    win.hydrate([win.byId(c)!], 20)
    expect(win.isPinnable(c)).toBe(false)
    expect(win.isPinned(c)).toBe(false)
  })

  it('keeps the pin out of the persisted blob, and a reload returns the window unpinned', async () => {
    vi.useFakeTimers()
    const data = new Map<string, string>()
    const storage: StorageLike = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    }
    const options = resolveOptions({ components: { editor: Stub }, persist: { key: 'k', storage } })
    const win = createStore(options)
    setupPersist(win, options)

    const id = win.open('editor', { id: 1 }, { fixed: true }).id
    await nextTick()
    vi.advanceTimersByTime(400)
    const blob = data.get('k')!
    expect(blob).not.toMatch(/fixed|pinned/)
    expect(JSON.parse(blob).schema).toBe(SCHEMA)

    // The reload: a second store over the same storage.
    const reloaded = createStore(options)
    setupPersist(reloaded, options)
    expect(reloaded.byId(id)).toBeDefined()
    expect(reloaded.isPinned(id)).toBe(false)
    expect(reloaded.isPinnable(id)).toBe(false)
    vi.useRealTimers()
  })
})

describe('pinned windows — frame', () => {
  it('renders above a window focused after it, and stays there', async () => {
    const { wrapper, win } = app()
    const top = win.open('editor', { id: 1 }, { fixed: true }).id
    const other = win.open('editor', { id: 2 }).id
    await nextTick()

    const dialogs = () => wrapper.findAll('dialog.vw')
    expect(zOf(dialogs()[0]!.element)).toBeGreaterThan(zOf(dialogs()[1]!.element))

    win.focus(other)
    await nextTick()
    expect(win.activeId.value).toBe(other)
    expect(zOf(dialogs()[0]!.element)).toBeGreaterThan(zOf(dialogs()[1]!.element))

    // Unpinning drops it back into the normal band, below the window that now holds focus.
    win.setPinned(top, false)
    await nextTick()
    expect(zOf(dialogs()[0]!.element)).toBeLessThan(zOf(dialogs()[1]!.element))
  })

  it('does not drag, resize, snap or nudge while pinned', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 }, { x: 100, y: 100, w: 400, h: 300, fixed: true }).id
    await nextTick()

    expect(wrapper.findAll('.vw__grip')).toHaveLength(0)

    const head = wrapper.find('.vw__head')
    pointer(head.element, 'pointerdown', 1, 150, 110)
    pointer(head.element, 'pointermove', 1, 400, 300)
    pointer(head.element, 'pointerup', 1, 400, 300)
    await head.trigger('keydown', { key: 'ArrowRight' })
    await head.trigger('keydown', { key: 'ArrowDown', shiftKey: true })
    await head.trigger('dblclick')

    expect(win.byId(id)).toMatchObject({ x: 100, y: 100, w: 400, h: 300 })
    expect(win.dockZone(id)).toBeNull()
    expect((head.element as HTMLElement).style.cursor).toBe('default')
  })

  it('still closes and minimizes while pinned', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 }, { fixed: true }).id
    await nextTick()

    const buttons = () => wrapper.findAll('.vw__btn')
    await buttons()[0]!.trigger('click')
    expect(win.byId(id)!.minimized).toBe(true)

    win.restore(id)
    await nextTick()
    await buttons()[1]!.trigger('click')
    await nextTick()
    expect(win.byId(id)).toBeUndefined()
  })

  it('appends the pin toggle after close, and renders none without `fixed`', async () => {
    const { wrapper, win } = app()
    win.open('editor', { id: 1 })
    await nextTick()
    // The control order is public: a plain window's button count must not move.
    expect(wrapper.findAll('.vw__btn')).toHaveLength(2)

    win.closeAll()
    const id = win.open('editor', { id: 2 }, { fixed: true }).id
    await nextTick()
    const buttons = wrapper.findAll('.vw__btn')
    expect(buttons).toHaveLength(3)
    expect(buttons[2]!.attributes('data-vw-pinned')).toBe('true')
    expect(buttons[2]!.attributes('data-vw-nodrag')).toBeDefined()

    await buttons[2]!.trigger('click')
    expect(win.isPinned(id)).toBe(false)
    await nextTick()
    expect(wrapper.findAll('.vw__btn')[2]!.attributes('data-vw-pinned')).toBeUndefined()
  })

  it('the pin button gives drag, resize and snap back', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 }, { x: 100, y: 100, w: 400, h: 300, fixed: true }).id
    await nextTick()

    await wrapper.findAll('.vw__btn')[2]!.trigger('click')
    await nextTick()
    expect(wrapper.findAll('.vw__grip')).toHaveLength(8)

    const head = wrapper.find('.vw__head')
    await head.trigger('keydown', { key: 'ArrowRight' })
    expect(win.byId(id)!.x).toBe(110)

    await head.trigger('dblclick')
    expect(win.dockZone(id)).toBe('max')

    // Pinning again drops that snap, and the window goes inert once more.
    await wrapper.findAll('.vw__btn')[2]!.trigger('click')
    await nextTick()
    expect(win.dockZone(id)).toBeNull()
    expect(wrapper.findAll('.vw__grip')).toHaveLength(0)
  })
})
