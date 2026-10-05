import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { cascadeRects, tileRects } from '../geometry'
import { createStore } from '../state'
import { resolveOptions } from '../options'
import type { Rect, SnapInsets } from '../types'

const Stub = { render: () => h('div') }
const view = { w: 1000, h: 800 }
const none: SnapInsets = { top: 0, right: 0, bottom: 0, left: 0 }
const bar: SnapInsets = { top: 0, right: 0, bottom: 40, left: 0 }

function store(snap: Parameters<typeof resolveOptions>[0]['snap'] = {}) {
  return createStore(resolveOptions({ components: { editor: Stub }, snap }))
}

function rectOf(win: ReturnType<typeof store>, id: string): Rect {
  const d = win.byId(id)!
  return { x: d.x, y: d.y, w: d.w, h: d.h }
}

function area(rects: Rect[]): number {
  return rects.reduce((sum, r) => sum + r.w * r.h, 0)
}

describe('tileRects', () => {
  it('is empty for no windows and the whole area for one', () => {
    expect(tileRects(0, view, none)).toEqual([])
    expect(tileRects(1, view, none)).toEqual([{ x: 0, y: 0, w: 1000, h: 800 }])
  })

  it('gives two windows the left and right halves', () => {
    expect(tileRects(2, view, none)).toEqual([
      { x: 0, y: 0, w: 500, h: 800 },
      { x: 500, y: 0, w: 500, h: 800 },
    ])
  })

  it('stretches a short last row across the full width', () => {
    expect(tileRects(3, view, none)).toEqual([
      { x: 0, y: 0, w: 500, h: 400 },
      { x: 500, y: 0, w: 500, h: 400 },
      { x: 0, y: 400, w: 1000, h: 400 },
    ])
  })

  it('covers the area exactly, without gaps or overlap, for awkward sizes', () => {
    const odd = { w: 1001, h: 799 }
    for (let n = 1; n <= 12; n++) {
      const rects = tileRects(n, odd, none)
      expect(rects).toHaveLength(n)
      expect(area(rects)).toBe(1001 * 799)
      for (const r of rects) {
        expect(Number.isInteger(r.x) && Number.isInteger(r.w)).toBe(true)
        expect(r.x + r.w).toBeLessThanOrEqual(1001)
        expect(r.y + r.h).toBeLessThanOrEqual(799)
      }
    }
  })

  it('keeps clear of the insets', () => {
    expect(tileRects(1, view, bar)).toEqual([{ x: 0, y: 0, w: 1000, h: 760 }])
  })
})

describe('cascadeRects', () => {
  it('steps from the area corner and keeps each size', () => {
    const insets = { top: 10, right: 0, bottom: 0, left: 20 }
    expect(cascadeRects([{ w: 300, h: 200 }, { w: 400, h: 100 }], view, insets)).toEqual([
      { x: 20, y: 10, w: 300, h: 200 },
      { x: 48, y: 38, w: 400, h: 100 },
    ])
  })

  it('wraps back to the corner the way placement does', () => {
    const rects = cascadeRects(Array.from({ length: 9 }, () => ({ w: 100, h: 100 })), view, none)
    expect(rects[7]).toMatchObject({ x: 196, y: 196 })
    expect(rects[8]).toMatchObject({ x: 0, y: 0 })
  })
})

describe('tileAll / cascadeAll', () => {
  it('tiles the visible stack bottom-first, so the active window takes the last cell', () => {
    const win = store()
    const a = win.open('editor', {}, { dedupe: false }).id
    const b = win.open('editor', {}, { dedupe: false }).id
    win.focus(a)

    expect(win.tileAll(view)).toEqual([b, a])
    expect(rectOf(win, b)).toEqual({ x: 0, y: 0, w: 500, h: 800 })
    expect(rectOf(win, a)).toEqual({ x: 500, y: 0, w: 500, h: 800 })
    expect(win.activeId.value).toBe(a)
  })

  it('tiles inside the snap insets', () => {
    const win = store({ insets: { bottom: 40 } })
    const a = win.open('editor').id
    win.tileAll(view)
    expect(rectOf(win, a)).toEqual({ x: 0, y: 0, w: 1000, h: 760 })
  })

  it('reports one geometry event per window moved', () => {
    const win = store()
    const ids = [1, 2, 3].map(() => win.open('editor', {}, { dedupe: false }).id)
    const seen: string[] = []
    win.on('geometry', (e) => seen.push(e.id))
    win.cascadeAll(view)
    expect(seen.sort()).toEqual([...ids].sort())
  })

  it('cascades from the corner and leaves every size alone', () => {
    const win = store()
    const a = win.open('editor', {}, { dedupe: false, x: 300, y: 300, w: 320, h: 200 }).id
    const b = win.open('editor', {}, { dedupe: false, x: 10, y: 500, w: 400, h: 260 }).id
    win.cascadeAll(view)
    expect(rectOf(win, a)).toEqual({ x: 0, y: 0, w: 320, h: 200 })
    expect(rectOf(win, b)).toEqual({ x: 28, y: 28, w: 400, h: 260 })
  })

  it('undocks a snapped window rather than leaving it snapped', () => {
    const win = store()
    const a = win.open('editor').id
    win.snap(a, 'left', view)
    win.tileAll(view)
    expect(win.dockZone(a)).toBeNull()
    expect(rectOf(win, a)).toEqual({ x: 0, y: 0, w: 1000, h: 800 })
  })

  it('applies size limits to a cell too small for the window', () => {
    const win = store()
    win.open('editor', {}, { dedupe: false })
    const b = win.open('editor', {}, { dedupe: false, minW: 700 }).id
    win.tileAll(view)
    expect(rectOf(win, b)).toMatchObject({ x: 500, w: 700 })
  })

  it('skips minimized, pinned and modal windows, and the flags that forbid moving', () => {
    const win = store()
    const plain = win.open('editor', {}, { dedupe: false }).id
    const min = win.open('editor', {}, { dedupe: false }).id
    win.minimize(min)
    win.open('editor', {}, { dedupe: false, fixed: true })
    const stuck = win.open('editor', {}, { dedupe: false, draggable: false }).id
    const rigid = win.open('editor', {}, { dedupe: false, resizable: false }).id
    win.open('editor', {}, { dedupe: false, modal: true })

    expect(win.tileAll(view)).toEqual([plain])
    expect(rectOf(win, plain)).toEqual({ x: 0, y: 0, w: 1000, h: 800 })
    // Cascading only moves, so a fixed-size window takes part.
    const before = rectOf(win, stuck)
    expect(win.cascadeAll(view)).toEqual([plain, rigid])
    expect(rectOf(win, stuck)).toEqual(before)
  })

  it('does nothing below the mobile breakpoint', () => {
    const win = store()
    const a = win.open('editor', {}, { x: 300, y: 300 }).id
    const before = rectOf(win, a)
    expect(win.tileAll({ w: 500, h: 800 })).toEqual([])
    expect(win.cascadeAll({ w: 500, h: 800 })).toEqual([])
    expect(rectOf(win, a)).toEqual(before)
  })

  it('falls back to the attached viewport', () => {
    const win = store()
    const a = win.open('editor').id
    win.attachViewport({ w: 1200, h: 900 })
    win.tileAll()
    expect(rectOf(win, a)).toEqual({ x: 0, y: 0, w: 1200, h: 900 })
  })
})
