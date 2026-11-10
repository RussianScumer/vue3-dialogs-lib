import { describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { createStore } from '../state'
import { resolveOptions } from '../options'
import { clampX, dockRect } from '../geometry'

const Stub = { render: () => h('div') }
const big = { w: 1000, h: 800 }
const small = { w: 600, h: 500 }

function store(maxWindows = 8) {
  return createStore(resolveOptions({ components: { editor: Stub }, maxWindows }))
}

type Win = ReturnType<typeof store>

function rect(win: Win, id: string) {
  const w = win.byId(id)!
  return { x: w.x, y: w.y, w: w.w, h: w.h }
}

function setup() {
  const win = store()
  win.attachViewport({ ...big })
  return win
}

describe('reflow', () => {
  it('gives a window back its rect when the viewport grows again (I1)', () => {
    const win = setup()
    const ids = [
      win.open('editor', { id: 1 }, { x: 100, y: 100, w: 400, h: 300 }).id,
      win.open('editor', { id: 2 }, { x: 500, y: 400, w: 450, h: 350 }).id,
      win.open('editor', { id: 3 }, { x: 900, y: 700, w: 640, h: 480 }).id,
    ]
    win.clampAll(big)
    const snapshot = ids.map((id) => rect(win, id))
    win.clampAll(small)
    expect(rect(win, ids[1]!)).not.toEqual(snapshot[1])
    win.clampAll(big)
    expect(ids.map((id) => rect(win, id))).toEqual(snapshot)
  })

  it('is idempotent (I3)', () => {
    const win = setup()
    const ids = [
      win.open('editor', { id: 1 }, { x: 100, y: 100, w: 400, h: 300 }).id,
      win.open('editor', { id: 2 }, { x: 500, y: 400, w: 450, h: 350 }).id,
    ]
    win.clampAll(big)
    win.clampAll(small)
    const once = ids.map((id) => [rect(win, id), win.axisModesOf(id)])
    win.clampAll(small)
    expect(ids.map((id) => [rect(win, id), win.axisModesOf(id)])).toEqual(once)
  })

  it('changes size silently', () => {
    const win = setup()
    const spy = vi.fn()
    win.on('geometry', spy)
    const id = win.open('editor', { id: 1 }, { x: 0, y: 0, w: 800, h: 300 }).id
    win.clampAll(big)
    win.clampAll(small)
    expect(win.byId(id)!.w).toBe(600)
    expect(spy).not.toHaveBeenCalled()
  })

  it('keeps auto height across reflows', () => {
    const win = setup()
    const id = win.open('editor', { id: 1 }, { x: 10, y: 10, w: 400 }).id
    expect(win.isAutoHeight(id)).toBe(true)
    win.clampAll(small)
    expect(win.isAutoHeight(id)).toBe(true)
    win.clampAll(big)
    expect(win.isAutoHeight(id)).toBe(true)
  })

  it('measures drift against the previous viewport', () => {
    const win = setup()
    const a = win.open('editor', { id: 1 }, { x: 100, y: 100, w: 400, h: 300 }).id
    const b = win.open('editor', { id: 2 }, { x: 100, y: 100, w: 400, h: 300 }).id
    win.clampAll(big)
    win.setGeometry(a, { x: 700 })
    win.setGeometry(b, { x: 500 })
    win.clampAll(small)
    expect(win.axisModesOf(a)!.x).toBe('free')
    expect(win.byId(a)!.x).toBe(clampX(700, 400, small, { minVisible: 80 }))
    expect(win.axisModesOf(b)!.x).toBe('fit')
    expect(win.byId(b)!.x).toBe(200)
  })

  it('judges drift per axis and reports it before any reflow (P4, P5)', () => {
    const win = setup()
    const id = win.open('editor', { id: 1 }, { x: 100, y: 100, w: 400, h: 300 }).id
    win.clampAll(big)
    win.setGeometry(id, { h: 350 })
    expect(win.intentOf(id)).toEqual({ x: 100, y: 100, w: 400, h: 350 })
    expect(win.axisModesOf(id)).toEqual({ x: 'fit', y: 'fit' })
  })

  it('keeps the intent of a shrunk window', () => {
    const win = setup()
    const id = win.open('editor', { id: 1 }, { x: 500, y: 100, w: 400, h: 300 }).id
    win.clampAll(big)
    win.clampAll(small)
    expect(win.byId(id)!.x).toBe(200)
    expect(win.intentOf(id)).toEqual({ x: 500, y: 100, w: 400, h: 300 })
  })

  it('re-docks a snapped window and keeps its pre-snap intent', () => {
    const win = setup()
    const id = win.open('editor', { id: 1 }, { x: 100, y: 100, w: 400, h: 300 }).id
    win.snap(id, 'right', big)
    win.clampAll(small)
    const w = win.byId(id)!
    expect(rect(win, id)).toEqual(dockRect('right', w, small, win.options.snap.insets))
    expect(rect(win, id)).toEqual({ x: 300, y: 0, w: 300, h: 500 })
    expect(win.axisModesOf(id)).toBeNull()
    expect(win.intentOf(id)).toEqual({ x: 100, y: 100, w: 400, h: 300 })
  })

  it('answers null for an unknown id', () => {
    const win = setup()
    expect(win.intentOf('nope')).toBeNull()
    expect(win.axisModesOf('nope')).toBeNull()
  })

  it('forgets records on close, eviction and closeAll', () => {
    const win = setup()
    const a = win.open('editor', { id: 1 }, { x: 100, y: 100, w: 400, h: 300 }).id
    win.clampAll(big)
    expect(win.axisModesOf(a)).not.toBeNull()
    win.close(a)
    expect(win.axisModesOf(a)).toBeNull()

    const one = store(1)
    one.attachViewport({ ...big })
    const first = one.open('editor', { id: 1 }, { x: 100, y: 100, w: 400, h: 300 }).id
    one.clampAll(big)
    expect(one.axisModesOf(first)).not.toBeNull()
    one.open('editor', { id: 2 }, { x: 100, y: 100, w: 400, h: 300 })
    expect(one.axisModesOf(first)).toBeNull()

    const c = setup()
    const id = c.open('editor', { id: 1 }, { x: 100, y: 100, w: 400, h: 300 }).id
    c.clampAll(big)
    c.closeAll()
    expect(c.axisModesOf(id)).toBeNull()
  })
})

describe('open and snap', () => {
  it('fits self-placed axes at open and keeps the intent', () => {
    const win = store()
    win.attachViewport({ ...small })
    const id = win.open('editor', { id: 1 }).id
    expect(rect(win, id)).toEqual({ x: 0, y: 20, w: 600, h: 480 })
    expect(win.intentOf(id)).toEqual({ x: 40, y: 40, w: 640, h: 480 })
    expect(win.axisModesOf(id)).toEqual({ x: 'fit', y: 'fit' })
    win.clampAll(big)
    expect(rect(win, id)).toEqual({ x: 40, y: 40, w: 640, h: 480 })
  })

  it('leaves explicit axes where the caller put them', () => {
    const win = setup()
    const a = win.open('editor', { id: 1 }, { x: 900, y: 700 }).id
    expect(rect(win, a)).toMatchObject({ x: 900, y: 700 })
    expect(win.axisModesOf(a)).toEqual({ x: 'free', y: 'free' })
    const b = win.open('editor', { id: 2 }, { x: 100, y: 100, w: 400, h: 300 }).id
    expect(win.axisModesOf(b)).toEqual({ x: 'fit', y: 'fit' })
  })

  it('keeps a centred window centred at every size (I4)', () => {
    for (const extra of [{}, { modal: true, draggable: false }]) {
      const win = setup()
      const id = win.open('editor', { id: 1 }, { placement: 'center', w: 400, h: 300, ...extra }).id
      expect(rect(win, id)).toMatchObject({ x: 300, y: 250 })
      expect(win.axisModesOf(id)).toEqual({ x: 'centre', y: 'centre' })
      win.clampAll(small)
      expect(rect(win, id)).toMatchObject({ x: 100, y: 100 })
      win.clampAll({ w: 1400, h: 900 })
      expect(rect(win, id)).toMatchObject({ x: 500, y: 300 })
    }
  })

  it('centres one axis when the other is explicit', () => {
    const win = setup()
    const id = win.open('editor', { id: 1 }, { placement: 'center', w: 400, h: 300, y: 12 }).id
    expect(win.axisModesOf(id)).toEqual({ x: 'centre', y: 'fit' })
  })

  it('keeps x centred when auto-height growth changes y and h (P4)', () => {
    const win = setup()
    const id = win.open('editor', { id: 1 }, { placement: 'center', w: 400 }).id
    win.growToFit(id, 100, big)
    win.clampAll(small)
    expect(rect(win, id).x).toBe(100)
    expect(win.axisModesOf(id)!.x).toBe('centre')
    expect(win.axisModesOf(id)!.y).not.toBe('centre')
  })

  it('drops centre once the window is moved', () => {
    const win = setup()
    const id = win.open('editor', { id: 1 }, { placement: 'center', w: 400, h: 300 }).id
    win.setGeometry(id, { x: 50 })
    win.clampAll(small)
    expect(win.axisModesOf(id)!.x).toBe('fit')
    expect(rect(win, id).x).toBe(50)
  })

  it('docks through dockRect', () => {
    const win = setup()
    const id = win.open('editor', { id: 1 }, { x: 100, y: 100, w: 600, h: 300, minW: 600 }).id
    win.snap(id, 'right', big)
    expect(rect(win, id)).toMatchObject({ x: 400, w: 600 })
    expect(win.axisModesOf(id)).toBeNull()
  })

  it('stores the intent, not the fitted rect, as prev', () => {
    const win = store()
    win.attachViewport({ ...small })
    const id = win.open('editor', { id: 1 }).id
    win.snap(id, 'left', small)
    win.attachViewport({ ...big })
    win.snap(id, 'none', big)
    expect(rect(win, id)).toEqual({ x: 40, y: 40, w: 640, h: 480 })
  })

  it("fits prev on snap('none')", () => {
    const win = setup()
    const id = win.open('editor', { id: 1 }, { x: 120, y: 90, w: 800, h: 600 }).id
    win.snap(id, 'max', big)
    win.attachViewport({ ...small })
    win.snap(id, 'none', small)
    expect(rect(win, id)).toEqual({ x: 0, y: 0, w: 600, h: 500 })
  })

  it('fits prev on undockForDrag', () => {
    const win = setup()
    const id = win.open('editor', { id: 1 }, { x: 120, y: 90, w: 800, h: 600 }).id
    win.snap(id, 'max', big)
    win.attachViewport({ ...small })
    win.undockForDrag(id, 300)
    expect(rect(win, id)).toMatchObject({ w: 600, h: 500, x: 120 })
  })
})
