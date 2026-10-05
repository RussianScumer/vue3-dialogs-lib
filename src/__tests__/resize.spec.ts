import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { RESIZE_DIRS, RESIZE_STYLES, useWindowResize, type ResizeDir } from '../useWindowResize'
import type { Bounds, Viewport, WindowDescriptor } from '../types'

/**
 * `useWindowResize` on its own, against a descriptor and a viewport it is handed directly. The DOM
 * path through `BaseWindow` is covered in `host.spec.ts`; this pins the geometry of every grip.
 */

const view: Viewport = { w: 1000, h: 800 }
const bounds: Bounds = { minVisible: 80 }

function descriptor(over: Partial<WindowDescriptor> = {}): WindowDescriptor {
  return reactive({
    id: 'a', name: 'editor', props: {}, state: null, title: 'A', minimized: false,
    x: 200, y: 200, w: 300, h: 200, z: 1, meta: {},
    minW: 100, minH: 80, maxW: 500, maxH: 400, ...over,
  } as WindowDescriptor)
}

function target() {
  const captured = new Set<number>()
  return {
    captured,
    setPointerCapture: vi.fn((id: number) => void captured.add(id)),
    releasePointerCapture: vi.fn((id: number) => void captured.delete(id)),
    hasPointerCapture: (id: number) => captured.has(id),
  }
}

type Target = ReturnType<typeof target>

function pointer(currentTarget: Target, clientX: number, clientY: number, over: Record<string, unknown> = {}) {
  return {
    button: 0, pointerId: 1, clientX, clientY, currentTarget,
    preventDefault: vi.fn(), stopPropagation: vi.fn(), ...over,
  } as unknown as PointerEvent
}

function setup(d: WindowDescriptor, enabled = true) {
  const onStart = vi.fn()
  const onEnd = vi.fn()
  const r = useWindowResize(d, { view, bounds, enabled: () => enabled, onStart, onEnd })
  const el = target()
  return {
    onStart,
    onEnd,
    el,
    drag(dir: ResizeDir, dx: number, dy: number) {
      r.onDown(pointer(el, 500, 500), dir)
      r.onMove(pointer(el, 500 + dx, 500 + dy))
      r.onUp(pointer(el, 500 + dx, 500 + dy))
    },
    ...r,
  }
}

const rect = (d: WindowDescriptor) => ({ x: d.x, y: d.y, w: d.w, h: d.h })

describe('RESIZE_DIRS / RESIZE_STYLES', () => {
  it('lists the eight grips, edges first so the corners paint over them', () => {
    expect(RESIZE_DIRS).toEqual(['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'])
  })

  it('has one inline style per grip, each with a resize cursor and a position', () => {
    expect(Object.keys(RESIZE_STYLES).sort()).toEqual([...RESIZE_DIRS].sort())
    for (const dir of RESIZE_DIRS) {
      const style = RESIZE_STYLES[dir]
      expect(style.cursor).toMatch(/-resize$/)
      // Every grip is pinned to the edges its name says.
      if (dir.includes('n')) expect(style.top).toBe('0')
      if (dir.includes('s')) expect(style.bottom).toBe('0')
      if (dir.includes('e')) expect(style.right).toBe('0')
      if (dir.includes('w')) expect(style.left).toBe('0')
    }
  })
})

describe('useWindowResize — the eight grips', () => {
  // dx = +50, dy = +30 from a 300×200 window at (200, 200). A west or north grip moves the leading
  // edge and keeps the opposite one where it was.
  const cases: [ResizeDir, { x: number; y: number; w: number; h: number }][] = [
    ['n', { x: 200, y: 230, w: 300, h: 170 }],
    ['s', { x: 200, y: 200, w: 300, h: 230 }],
    ['e', { x: 200, y: 200, w: 350, h: 200 }],
    ['w', { x: 250, y: 200, w: 250, h: 200 }],
    ['nw', { x: 250, y: 230, w: 250, h: 170 }],
    ['ne', { x: 200, y: 230, w: 350, h: 170 }],
    ['sw', { x: 250, y: 200, w: 250, h: 230 }],
    ['se', { x: 200, y: 200, w: 350, h: 230 }],
  ]

  it.each(cases)('%s grip', (dir, expected) => {
    const d = descriptor()
    setup(d).drag(dir, 50, 30)
    expect(rect(d)).toEqual(expected)
  })
})

describe('useWindowResize — limits', () => {
  it('stops at minW / minH, with the anchored edge staying put', () => {
    const d = descriptor()
    const r = setup(d)
    r.drag('nw', 500, 500)
    expect(rect(d)).toEqual({ x: 400, y: 320, w: 100, h: 80 })
    // The east and south edges never moved.
    expect(d.x + d.w).toBe(500)
    expect(d.y + d.h).toBe(400)
  })

  it('stops at maxW / maxH', () => {
    const d = descriptor()
    setup(d).drag('se', 900, 900)
    expect(rect(d)).toEqual({ x: 200, y: 200, w: 500, h: 400 })
  })

  it('a north grip stops growing at the top of the viewport instead of pushing the window down', () => {
    const d = descriptor({ maxH: null })
    setup(d).drag('n', 0, -500)
    expect(rect(d)).toEqual({ x: 200, y: 0, w: 300, h: 400 })
  })
})

describe('useWindowResize — the pointer lifecycle', () => {
  it('captures on down, releases on up, and calls onStart / onEnd once each', () => {
    const d = descriptor()
    const r = setup(d)
    const down = pointer(r.el, 500, 500)
    r.onDown(down, 'se')
    expect(down.preventDefault).toHaveBeenCalled()
    expect(down.stopPropagation).toHaveBeenCalled()
    expect(r.el.captured.has(1)).toBe(true)
    expect(r.onStart).toHaveBeenCalledTimes(1)

    r.onUp(pointer(r.el, 500, 500))
    expect(r.el.captured.has(1)).toBe(false)
    expect(r.onEnd).toHaveBeenCalledTimes(1)

    // A stray up after the gesture ended is nothing.
    r.onUp(pointer(r.el, 500, 500))
    expect(r.onEnd).toHaveBeenCalledTimes(1)
  })

  it('does nothing while disabled', () => {
    const d = descriptor()
    const r = setup(d, false)
    r.drag('se', 50, 50)
    expect(rect(d)).toEqual({ x: 200, y: 200, w: 300, h: 200 })
    expect(r.onStart).not.toHaveBeenCalled()
    expect(r.el.setPointerCapture).not.toHaveBeenCalled()
  })

  it('ignores a non-primary button', () => {
    const d = descriptor()
    const r = setup(d)
    r.onDown(pointer(r.el, 500, 500, { button: 2 }), 'se')
    r.onMove(pointer(r.el, 600, 600))
    expect(rect(d)).toEqual({ x: 200, y: 200, w: 300, h: 200 })
    expect(r.onStart).not.toHaveBeenCalled()
  })

  it('ignores moves from another pointer', () => {
    const d = descriptor()
    const r = setup(d)
    r.onDown(pointer(r.el, 500, 500), 'se')
    r.onMove(pointer(r.el, 600, 600, { pointerId: 2 }))
    expect(rect(d)).toEqual({ x: 200, y: 200, w: 300, h: 200 })
  })

  it('ignores a move with no gesture under way', () => {
    const d = descriptor()
    const r = setup(d)
    r.onMove(pointer(r.el, 600, 600))
    expect(rect(d)).toEqual({ x: 200, y: 200, w: 300, h: 200 })
  })
})
