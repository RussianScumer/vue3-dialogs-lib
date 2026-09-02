import { describe, expect, it } from 'vitest'
import { clampSize, snapArea, snapRect, zoneFromPointer } from '../geometry'
import { resolveOptions } from '../options'
import type { SnapInsets } from '../types'

const view = { w: 1000, h: 800 }
const none: SnapInsets = { top: 0, right: 0, bottom: 0, left: 0 }
const bar: SnapInsets = { top: 0, right: 0, bottom: 40, left: 0 }

function snapOptions(over: Parameters<typeof resolveOptions>[0]['snap'] = {}) {
  return resolveOptions({ components: {}, snap: over }).snap
}

describe('snapArea', () => {
  it('is the viewport minus the insets', () => {
    expect(snapArea(view, none)).toEqual({ x: 0, y: 0, w: 1000, h: 800 })
    expect(snapArea(view, { top: 10, right: 20, bottom: 40, left: 30 })).toEqual({
      x: 30, y: 10, w: 950, h: 750,
    })
  })

  it('never goes negative when the insets exceed the viewport', () => {
    expect(snapArea({ w: 100, h: 100 }, { top: 0, right: 200, bottom: 0, left: 200 }).w).toBe(0)
  })
})

describe('snapRect', () => {
  it('covers the area when maximized', () => {
    expect(snapRect('max', view, none)).toEqual({ x: 0, y: 0, w: 1000, h: 800 })
  })

  it('halves fill the full height', () => {
    expect(snapRect('left', view, none)).toEqual({ x: 0, y: 0, w: 500, h: 800 })
    expect(snapRect('right', view, none)).toEqual({ x: 500, y: 0, w: 500, h: 800 })
  })

  it('quarters tile the area without gaps or overlap', () => {
    expect(snapRect('top-left', view, none)).toEqual({ x: 0, y: 0, w: 500, h: 400 })
    expect(snapRect('top-right', view, none)).toEqual({ x: 500, y: 0, w: 500, h: 400 })
    expect(snapRect('bottom-left', view, none)).toEqual({ x: 0, y: 400, w: 500, h: 400 })
    expect(snapRect('bottom-right', view, none)).toEqual({ x: 500, y: 400, w: 500, h: 400 })
  })

  it('keeps out of the insets — a fixed taskbar is not covered', () => {
    expect(snapRect('max', view, bar)).toEqual({ x: 0, y: 0, w: 1000, h: 760 })
    expect(snapRect('bottom-right', view, bar)).toEqual({ x: 500, y: 380, w: 500, h: 380 })
  })

  it('odd sizes leave no gap: the far side takes the remainder', () => {
    const odd = { w: 999, h: 801 }
    const left = snapRect('left', odd, none)
    const right = snapRect('right', odd, none)
    expect(left.w + right.w).toBeGreaterThanOrEqual(odd.w)
    expect(right.x + right.w).toBe(odd.w)
  })
})

describe('zoneFromPointer', () => {
  const snap = snapOptions()

  it('is null away from every edge', () => {
    expect(zoneFromPointer(500, 400, view, snap)).toBeNull()
  })

  it('arms halves and maximize from the edges', () => {
    expect(zoneFromPointer(2, 400, view, snap)).toBe('left')
    expect(zoneFromPointer(998, 400, view, snap)).toBe('right')
    expect(zoneFromPointer(500, 2, view, snap)).toBe('max')
  })

  it('leaves the bottom edge free', () => {
    expect(zoneFromPointer(500, 799, view, snap)).toBeNull()
  })

  it('a corner wins over the edge it sits on', () => {
    expect(zoneFromPointer(2, 30, view, snap)).toBe('top-left')
    expect(zoneFromPointer(998, 30, view, snap)).toBe('top-right')
    expect(zoneFromPointer(2, 770, view, snap)).toBe('bottom-left')
    expect(zoneFromPointer(998, 770, view, snap)).toBe('bottom-right')
    expect(zoneFromPointer(30, 2, view, snap)).toBe('top-left')
  })

  it('needs the pointer within `edge` of an edge, not merely within `corner`', () => {
    expect(zoneFromPointer(50, 50, view, snap)).toBeNull()
    expect(zoneFromPointer(snap.edge, 400, view, snap)).toBe('left')
    expect(zoneFromPointer(snap.edge + 1, 400, view, snap)).toBeNull()
  })

  it('insets move the trigger lines inward', () => {
    const inset = snapOptions({ insets: { bottom: 40 } })
    expect(zoneFromPointer(2, 790, view, inset)).toBe('bottom-left')
    expect(zoneFromPointer(2, 762, view, inset)).toBe('bottom-left')
    expect(zoneFromPointer(500, 762, view, inset)).toBeNull()
  })

  it('is null when the insets leave no area', () => {
    const gone = snapOptions({ insets: { left: 600, right: 600 } })
    expect(zoneFromPointer(0, 0, view, gone)).toBeNull()
  })
})

describe('clampSize', () => {
  const limits = { minW: 200, minH: 100, maxW: 800, maxH: 600 }

  it('holds a size inside the limits unchanged', () => {
    expect(clampSize(400, 300, limits)).toEqual({ w: 400, h: 300 })
  })

  it('lifts a size up to the minimum', () => {
    expect(clampSize(10, 10, limits)).toEqual({ w: 200, h: 100 })
  })

  it('holds a size down to the maximum', () => {
    expect(clampSize(9999, 9999, limits)).toEqual({ w: 800, h: 600 })
  })

  it('treats a null maximum as unbounded', () => {
    expect(clampSize(9999, 9999, { ...limits, maxW: null, maxH: null })).toEqual({ w: 9999, h: 9999 })
  })
})
