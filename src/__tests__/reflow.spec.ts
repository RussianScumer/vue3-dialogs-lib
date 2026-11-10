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
