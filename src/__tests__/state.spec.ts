import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { createStore } from '../state'
import { resolveOptions } from '../options'
import type { WindowDescriptor } from '../types'

const Stub = { render: () => h('div') }
const view = { w: 1000, h: 800 }

function store(maxWindows = 8) {
  return createStore(resolveOptions({ components: { editor: Stub, viewer: Stub }, maxWindows }))
}

describe('store', () => {
  it('opens a window with cascading geometry and rising z', () => {
    const win = store()
    const a = win.open('editor', { id: 1 }).id
    const b = win.open('editor', { id: 2 }).id
    const wa = win.byId(a)!
    const wb = win.byId(b)!

    expect(win.s.stack).toHaveLength(2)
    expect(wb.x).toBeGreaterThan(wa.x)
    expect(wb.z).toBeGreaterThan(wa.z)
    expect(wa.w).toBe(640)
  })

  it('rejects an unknown name', () => {
    expect(() => store().open('nope')).toThrow(/unknown window/)
  })

  it('dedupes on identical name + props and raises the existing window', () => {
    const win = store()
    const a = win.open('editor', { id: 1 }).id
    win.open('viewer', {})
    const again = win.open('editor', { id: 1 }).id

    expect(again).toBe(a)
    expect(win.s.stack).toHaveLength(2)
    expect(win.byId(a)!.z).toBe(win.s.topZ)
  })

  it('treats different props as different windows', () => {
    const win = store()
    win.open('editor', { id: 1 })
    win.open('editor', { id: 2 })
    expect(win.s.stack).toHaveLength(2)
  })

  it('restores a minimized duplicate instead of opening a second one', () => {
    const win = store()
    const a = win.open('editor', { id: 1 }).id
    win.minimize(a)
    expect(win.minimized.value).toHaveLength(1)

    expect(win.open('editor', { id: 1 }).id).toBe(a)
    expect(win.byId(a)!.minimized).toBe(false)
    expect(win.visible.value).toHaveLength(1)
  })

  it('evicts the oldest window past maxWindows', () => {
    const win = store(2)
    const a = win.open('editor', { id: 1 }).id
    win.open('editor', { id: 2 })
    win.open('editor', { id: 3 })

    expect(win.s.stack).toHaveLength(2)
    expect(win.byId(a)).toBeUndefined()
  })

  it('focus bumps z monotonically', () => {
    const win = store()
    const a = win.open('editor', { id: 1 }).id
    const b = win.open('editor', { id: 2 }).id
    win.focus(a)
    expect(win.byId(a)!.z).toBeGreaterThan(win.byId(b)!.z)
  })

  it('minimize keeps the descriptor but drops it from the rendered set', () => {
    const win = store()
    const a = win.open('editor', { id: 1 }).id
    win.minimize(a)
    expect(win.visible.value).toHaveLength(0)
    expect(win.s.stack).toHaveLength(1)
  })

  it('close removes, closeAll empties', () => {
    const win = store()
    const a = win.open('editor', { id: 1 }).id
    win.open('editor', { id: 2 })
    win.close(a)
    expect(win.s.stack).toHaveLength(1)
    win.closeAll()
    expect(win.s.stack).toHaveLength(0)
  })

  it('clampAll pulls windows back into a shrunken viewport', () => {
    const win = store()
    const a = win.open('editor', { id: 1 }, { x: 5000, y: 5000 }).id
    win.clampAll({ w: 1000, h: 800 })
    const w = win.byId(a)!
    expect(w.x).toBe(1000 - 80)
    expect(w.y).toBe(800 - 80)
  })

  it('snap assigns the zone geometry and gives it back on undock', () => {
    const win = store()
    const a = win.open('editor', { id: 1 }, { x: 120, y: 90, w: 400, h: 300 }).id

    win.snap(a, 'left', view)
    expect(win.byId(a)).toMatchObject({ x: 0, y: 0, w: 500, h: 800 })
    expect(win.dockZone(a)).toBe('left')
    expect(win.byId(a)!.z).toBe(win.s.topZ)

    win.snap(a, 'none', view)
    expect(win.byId(a)).toMatchObject({ x: 120, y: 90, w: 400, h: 300 })
    expect(win.dockZone(a)).toBeNull()
  })

  it('re-snapping keeps the original pre-snap geometry', () => {
    const win = store()
    const a = win.open('editor', { id: 1 }, { x: 120, y: 90, w: 400, h: 300 }).id

    win.snap(a, 'left', view)
    win.snap(a, 'max', view)
    expect(win.byId(a)).toMatchObject({ x: 0, y: 0, w: 1000, h: 800 })

    win.snap(a, 'none', view)
    expect(win.byId(a)).toMatchObject({ x: 120, y: 90, w: 400, h: 300 })
  })

  it('undock keeps the snapped geometry — a manual resize outranks the zone', () => {
    const win = store()
    const a = win.open('editor', { id: 1 }, { x: 120, y: 90, w: 400, h: 300 }).id

    win.snap(a, 'left', view)
    win.undock(a)
    expect(win.dockZone(a)).toBeNull()
    expect(win.byId(a)).toMatchObject({ x: 0, y: 0, w: 500, h: 800 })
  })

  it('undockForDrag restores the floating size under the pointer', () => {
    const win = store()
    const a = win.open('editor', { id: 1 }, { x: 120, y: 90, w: 400, h: 300 }).id

    win.snap(a, 'left', view)
    win.undockForDrag(a, 250) // pointer half way along the snapped width
    expect(win.dockZone(a)).toBeNull()
    expect(win.byId(a)).toMatchObject({ w: 400, h: 300, x: 50 }) // still half way along
  })

  it('undockForDrag does nothing to a floating window', () => {
    const win = store()
    const a = win.open('editor', { id: 1 }, { x: 120, y: 90, w: 400, h: 300 }).id
    win.undockForDrag(a, 250)
    expect(win.byId(a)).toMatchObject({ x: 120, y: 90, w: 400, h: 300 })
  })

  it('clampAll re-snaps docked windows and only clamps floating ones', () => {
    const win = store()
    const docked = win.open('editor', { id: 1 }).id
    const floating = win.open('editor', { id: 2 }, { x: 900, y: 700 }).id
    win.snap(docked, 'right', view)

    win.clampAll({ w: 600, h: 400 })
    expect(win.byId(docked)).toMatchObject({ x: 300, y: 0, w: 300, h: 400 })
    expect(win.byId(floating)).toMatchObject({ x: 520, y: 320 })
  })

  it('drops dock state with the window', () => {
    const win = store()
    const a = win.open('editor', { id: 1 }).id
    win.snap(a, 'left', view)
    win.close(a)

    const b = win.open('editor', { id: 1 }).id
    expect(win.dockZone(b)).toBeNull()
  })

  it('preview holds the armed drop rectangle and clears on null', () => {
    const win = store()
    win.setPreview('top-right', view)
    expect(win.preview.value).toEqual({ zone: 'top-right', x: 500, y: 0, w: 500, h: 400 })
    win.setPreview(null, view)
    expect(win.preview.value).toBeNull()
  })

  it('marks hydrated windows as restored and fresh ones as not', () => {
    const win = store()
    const hydrated: WindowDescriptor = {
      id: 'x', name: 'editor', props: {}, state: null, title: '', minimized: true,
      x: 0, y: 0, w: 640, h: 480, z: 12, meta: {},
      closable: true, minimizable: true, draggable: true, resizable: true,
      minW: 160, minH: 80, maxW: null, maxH: null,
    }
    win.hydrate([hydrated], 12)

    expect(win.isRestored('x')).toBe(true)
    expect(win.s.topZ).toBe(12)
    expect(win.isRestored(win.open('editor', { id: 9 }).id)).toBe(false)
  })

  it('focus does not write when the window is already on top', () => {
    const win = store()
    const a = win.open('editor', { id: 1 }).id
    win.open('editor', { id: 2 })
    const seen: string[] = []
    win.on('focus', (e) => seen.push(e.id))

    win.focus(a)
    expect(seen).toEqual([a]) // was second, so it really moved
    win.focus(a)
    expect(seen).toEqual([a]) // already top: no event, and no store write behind it
  })

  it('restore still raises a window whose z already equalled topZ', () => {
    const win = store()
    const a = win.open('editor', { id: 1 }).id
    win.minimize(a)
    const b = win.open('editor', { id: 2 }).id

    win.restore(a)
    expect(win.byId(a)!.z).toBeGreaterThan(win.byId(b)!.z)
    expect(win.activeId.value).toBe(a)
  })

  it('activeId follows the top non-minimized window', () => {
    const win = store()
    const a = win.open('editor', { id: 1 }).id
    const b = win.open('editor', { id: 2 }).id
    expect(win.activeId.value).toBe(b)

    win.minimize(b)
    expect(win.activeId.value).toBe(a)
    win.close(a)
    expect(win.activeId.value).toBeNull()
  })

  it('emits one event per transition', () => {
    const win = store()
    const seen: { type: string; id: string }[] = []
    win.on('*', (e) => seen.push({ type: e.type, id: e.id }))
    const id = win.open('editor', { id: 1 }).id

    win.minimize(id)
    win.minimize(id) // already minimized
    win.restore(id)
    win.setTitle(id, 'x')
    win.setTitle(id, 'x') // unchanged
    win.close(id)

    // No `focus` after `restore`: it is the only window, so its z already was topZ.
    expect(seen.map((e) => e.type)).toEqual(['open', 'minimize', 'restore', 'title', 'close'])
    expect(seen.every((e) => e.id === id)).toBe(true)
  })

  it('does not emit for a draft mutation — persistence cannot ride on events', () => {
    const win = store()
    const id = win.open('editor', { id: 1 }).id
    const seen: string[] = []
    win.on('*', (e) => seen.push(e.type))

    win.byId(id)!.state = { name: 'draft' }
    win.byId(id)!.x = 500

    expect(seen).toEqual([])
  })

  it('honours the capability flags', () => {
    const win = store()
    const id = win.open('editor', { id: 1 }, { minimizable: false }).id

    win.minimize(id)
    expect(win.byId(id)!.minimized).toBe(false)

    // `closable: false` is a UI affordance; the programmatic escape hatch still works.
    const other = win.open('editor', { id: 2 }, { closable: false }).id
    win.close(other)
    expect(win.byId(other)).toBeUndefined()
  })

  it('clamps geometry to the window size limits', () => {
    const win = store()
    const id = win.open('editor', { id: 1 }, { w: 100, h: 50, minW: 300, minH: 200, maxW: 900, maxH: 700 }).id
    expect(win.byId(id)).toMatchObject({ w: 300, h: 200 })

    win.setGeometry(id, { w: 9999, h: 9999 })
    expect(win.byId(id)).toMatchObject({ w: 900, h: 700 })
  })

  it('takes defaults from the component spec, and lets open() outrank them', () => {
    const win = createStore(
      resolveOptions({
        components: { editor: { component: Stub, w: 300, h: 200, closable: false, minW: 250 } },
      }),
    )
    const a = win.open('editor', { id: 1 }).id
    expect(win.byId(a)).toMatchObject({ w: 300, h: 200, closable: false, minW: 250 })

    const b = win.open('editor', { id: 2 }, { w: 800, closable: true }).id
    expect(win.byId(b)).toMatchObject({ w: 800, h: 200, closable: true })
  })

  it('dedupe: false opens a second window with identical props', () => {
    const win = store()
    const a = win.open('editor', { id: 1 }).id
    const b = win.open('editor', { id: 1 }, { dedupe: false }).id

    expect(b).not.toBe(a)
    expect(win.s.stack).toHaveLength(2)
  })

  it('updateProps and setMeta replace their field in place', () => {
    const win = store()
    const id = win.open('editor', { id: 1 }).id

    win.updateProps(id, { id: 2 })
    win.setMeta(id, { version: 7 })
    expect(win.byId(id)!.props).toEqual({ id: 2 })
    expect(win.byId(id)!.meta).toEqual({ version: 7 })
  })
})

describe('requestClose', () => {
  it('closes when nothing objects', async () => {
    const win = store()
    const id = win.open('editor', { id: 1 }).id
    await expect(win.requestClose(id)).resolves.toBe(true)
    expect(win.byId(id)).toBeUndefined()
  })

  it("is vetoed by the window's own guard", async () => {
    const win = store()
    const id = win.open('editor', { id: 1 }).id
    win.onBeforeClose(id, () => false)

    await expect(win.requestClose(id)).resolves.toBe(false)
    expect(win.byId(id)).toBeDefined()
  })

  it('is vetoed by the app-wide guard, which a minimized window also gets', async () => {
    const win = createStore(
      resolveOptions({ components: { editor: Stub }, beforeClose: async (d) => d.minimized === false }),
    )
    const id = win.open('editor', { id: 1 }).id
    win.minimize(id)

    await expect(win.requestClose(id)).resolves.toBe(false)
    expect(win.byId(id)).toBeDefined()
  })

  it('stops consulting guards once one has released them', async () => {
    const win = store()
    const id = win.open('editor', { id: 1 }).id
    const off = win.onBeforeClose(id, () => false)
    off()

    await expect(win.requestClose(id)).resolves.toBe(true)
  })

  it('close, closeAll and maxWindows eviction all ignore guards', async () => {
    const win = store(2)
    const a = win.open('editor', { id: 1 }).id
    win.onBeforeClose(a, () => false)

    win.open('editor', { id: 2 })
    win.open('editor', { id: 3 }) // evicts `a` past maxWindows, guard or no guard
    expect(win.byId(a)).toBeUndefined()

    const b = win.open('editor', { id: 4 }).id
    win.onBeforeClose(b, () => false)
    win.close(b)
    expect(win.byId(b)).toBeUndefined()

    const c = win.open('editor', { id: 5 }).id
    win.onBeforeClose(c, () => false)
    win.closeAll()
    expect(win.s.stack).toHaveLength(0)
  })

  it('resolves true for a window that is already gone', async () => {
    const win = store()
    await expect(win.requestClose('nope')).resolves.toBe(true)
  })
})
