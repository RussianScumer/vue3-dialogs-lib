import { describe, expect, it } from 'vitest'
import { clampX, dockRect, fitRect, snapRect } from '../geometry'
import type { AxisModes, Rect, SizeLimits, SnapInsets, SnapZone } from '../types'

const view = { w: 1000, h: 800 }
const bounds = { minVisible: 80 }
const limits: SizeLimits = { minW: 200, minH: 100, maxW: null, maxH: null }
const none: SnapInsets = { top: 0, right: 0, bottom: 0, left: 0 }
const bar: SnapInsets = { top: 0, right: 0, bottom: 40, left: 0 }
const fit: AxisModes = { x: 'fit', y: 'fit' }
const free: AxisModes = { x: 'free', y: 'free' }
const centre: AxisModes = { x: 'centre', y: 'centre' }

function rect(over: Partial<Rect>): Rect {
  return { x: 100, y: 100, w: 400, h: 300, ...over }
}

describe('fitRect', () => {
  it('returns a fresh equal rect for a fitting intent and does not mutate it', () => {
    const intent = Object.freeze(rect({}))
    const out = fitRect(intent, fit, limits, view, bounds)
    expect(out).toEqual({ x: 100, y: 100, w: 400, h: 300 })
    expect(out).not.toBe(intent)
  })

  it('fit moves an x overflow back before shrinking', () => {
    expect(fitRect(rect({ x: 600, w: 600 }), fit, limits, view, bounds)).toEqual(rect({ x: 400, w: 600 }))
  })

  it('fit shrinks an intent wider than the view', () => {
    expect(fitRect(rect({ x: 100, w: 1200 }), fit, limits, view, bounds)).toEqual(rect({ x: 0, w: 1000 }))
  })

  it('fit floors the size at the minimum', () => {
    const small = { w: 150, h: 800 }
    const out = fitRect(rect({ x: 0, w: 300 }), fit, limits, small, bounds)
    expect(out.w).toBe(200)
    expect(out.x).toBe(clampX(0, 200, small, bounds))
  })

  it('fit mirrors on the y axis', () => {
    expect(fitRect(rect({ y: 500, h: 400 }), fit, limits, view, bounds)).toEqual(rect({ y: 400, h: 400 }))
    expect(fitRect(rect({ y: 0, h: 1000 }), fit, limits, view, bounds)).toEqual(rect({ y: 0, h: 800 }))
  })

  it('free leaves position and size, only the reach rule applies', () => {
    expect(fitRect(rect({ x: -50, w: 300 }), free, limits, view, bounds)).toEqual(rect({ x: -50, w: 300 }))
    expect(fitRect(rect({ x: 990, w: 300 }), free, limits, view, bounds)).toEqual(rect({ x: 920, w: 300 }))
  })

  it('centre centres a fitting size and keeps it', () => {
    expect(fitRect(rect({ x: 0, w: 400 }), centre, limits, view, bounds).x).toBe(300)
    expect(fitRect(rect({ x: 0, w: 400 }), centre, limits, { w: 600, h: 800 }, bounds)).toMatchObject({ x: 100, w: 400 })
    expect(fitRect(rect({ y: 0, h: 300 }), centre, limits, view, bounds)).toMatchObject({ y: 250, h: 300 })
  })

  it('centre on an oversized intent floors at 0 and fits', () => {
    expect(fitRect(rect({ w: 1200 }), centre, limits, view, bounds)).toMatchObject({ x: 0, w: 1000 })
    expect(fitRect(rect({ h: 1000 }), centre, limits, view, bounds)).toMatchObject({ y: 0, h: 800 })
  })

  it('acts per axis for mixed modes', () => {
    const out = fitRect(rect({ x: -50, w: 1200, y: 500, h: 400 }), { x: 'free', y: 'fit' }, limits, view, bounds)
    expect(out).toEqual({ x: -50, w: 1200, y: 400, h: 400 })
  })

  it('shrinks in a small view and grows back in the big one', () => {
    const intent = rect({ x: 500, w: 400 })
    expect(fitRect(intent, fit, limits, { w: 600, h: 800 }, bounds)).toEqual(rect({ x: 200, w: 400 }))
    expect(fitRect(intent, fit, limits, { w: 300, h: 800 }, bounds)).toMatchObject({ x: 0, w: 300 })
    expect(fitRect(intent, fit, limits, view, bounds)).toEqual(intent)
  })

  it('is idempotent', () => {
    const cases: [Rect, AxisModes, { w: number; h: number }][] = [
      [rect({ x: 600, w: 600 }), fit, view],
      [rect({ x: 700, y: 700, w: 600, h: 400 }), fit, view],
      [rect({ w: 1200, h: 1000 }), fit, view],
      [rect({ w: 1200, h: 1000 }), centre, view],
      [rect({ w: 400 }), centre, { w: 600, h: 500 }],
      [rect({ x: -50, y: 790 }), free, view],
      [rect({ x: 0, w: 300 }), fit, { w: 150, h: 800 }],
      [rect({ x: 300, y: 600, w: 500, h: 500 }), { x: 'free', y: 'centre' }, view],
      [rect({ x: 900, w: 300 }), { x: 'centre', y: 'fit' }, { w: 250, h: 100 }],
    ]
    for (const [i, m, v] of cases) {
      const once = fitRect(i, m, limits, v, bounds)
      expect(fitRect(once, m, limits, v, bounds)).toEqual(once)
    }
  })
})

describe('dockRect', () => {
  const zones: SnapZone[] = ['left', 'right', 'max', 'top-left', 'top-right', 'bottom-left', 'bottom-right']

  it('equals snapRect when the zone fits', () => {
    for (const insets of [none, bar]) {
      for (const zone of zones) expect(dockRect(zone, limits, view, insets)).toEqual(snapRect(zone, view, insets))
    }
  })

  it('shrinks to maxW at the zone origin', () => {
    expect(dockRect('right', { ...limits, maxW: 300 }, view, none)).toMatchObject({ x: 500, w: 300 })
  })

  it('pulls a too-wide zone back from the far edge', () => {
    expect(dockRect('right', { ...limits, minW: 600 }, view, none)).toMatchObject({ x: 400, w: 600 })
    expect(dockRect('bottom-right', { ...limits, minH: 500 }, view, bar)).toMatchObject({ y: 260, h: 500 })
    expect(dockRect('right', { ...limits, minW: 1200 }, view, none)).toMatchObject({ x: 0, w: 1200 })
  })
})
