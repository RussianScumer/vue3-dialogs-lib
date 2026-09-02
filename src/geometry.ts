import type {
  Bounds,
  OpenOptions,
  Rect,
  ResolvedSnap,
  SizeLimits,
  SnapInsets,
  SnapZone,
  Viewport,
  WindowDescriptor,
} from './types'

export const DEFAULT_W = 640
export const DEFAULT_H = 480
export const DEFAULT_MIN_W = 160
export const DEFAULT_MIN_H = 80

const CASCADE_STEP = 28
const CASCADE_WRAP = 8

export function cascade(index: number, opts: OpenOptions) {
  const offset = (index % CASCADE_WRAP) * CASCADE_STEP
  return {
    x: opts.x ?? 40 + offset,
    y: opts.y ?? 40 + offset,
    w: opts.w ?? DEFAULT_W,
    h: opts.h ?? DEFAULT_H,
  }
}

/** The one place size limits are applied, so pointer, keyboard and snap all agree. */
export function clampSize(w: number, h: number, l: SizeLimits): { w: number; h: number } {
  return {
    w: Math.min(Math.max(w, l.minW), l.maxW ?? Infinity),
    h: Math.min(Math.max(h, l.minH), l.maxH ?? Infinity),
  }
}

export function clampX(x: number, w: number, view: Viewport, bounds: Bounds): number {
  const min = bounds.minVisible - w
  const max = Math.max(min, view.w - bounds.minVisible)
  return Math.min(Math.max(x, min), max)
}

export function clampY(y: number, _h: number, view: Viewport, bounds: Bounds): number {
  const max = Math.max(0, view.h - bounds.minVisible)
  return Math.min(Math.max(y, 0), max)
}

/** Mutates the descriptor back into reach; returns true when anything moved. */
export function clampDescriptor(d: WindowDescriptor, view: Viewport, bounds: Bounds): boolean {
  const x = clampX(d.x, d.w, view, bounds)
  const y = clampY(d.y, d.h, view, bounds)
  if (x === d.x && y === d.y) return false
  d.x = x
  d.y = y
  return true
}

/** The rectangle snapping works in: the viewport minus the configured insets. */
export function snapArea(view: Viewport, insets: SnapInsets): Rect {
  return {
    x: insets.left,
    y: insets.top,
    w: Math.max(0, view.w - insets.left - insets.right),
    h: Math.max(0, view.h - insets.top - insets.bottom),
  }
}

/** Geometry a window takes when snapped to `zone`. Halves round down, the far side takes the rest. */
export function snapRect(zone: SnapZone, view: Viewport, insets: SnapInsets): Rect {
  const a = snapArea(view, insets)
  const halfW = Math.round(a.w / 2)
  const halfH = Math.round(a.h / 2)
  const right = a.x + a.w - halfW
  const bottom = a.y + a.h - halfH

  switch (zone) {
    case 'max':
      return a
    case 'left':
      return { x: a.x, y: a.y, w: halfW, h: a.h }
    case 'right':
      return { x: right, y: a.y, w: halfW, h: a.h }
    case 'top-left':
      return { x: a.x, y: a.y, w: halfW, h: halfH }
    case 'top-right':
      return { x: right, y: a.y, w: halfW, h: halfH }
    case 'bottom-left':
      return { x: a.x, y: bottom, w: halfW, h: halfH }
    case 'bottom-right':
      return { x: right, y: bottom, w: halfW, h: halfH }
  }
}

/**
 * The zone a drop at (px, py) would snap to, or null. A corner wins over an edge, which is what
 * makes quarters reachable at all: the corner band is wide, the edge band is a few px.
 * The bottom edge on its own does nothing — Windows leaves it free too.
 */
export function zoneFromPointer(px: number, py: number, view: Viewport, snap: ResolvedSnap): SnapZone | null {
  const a = snapArea(view, snap.insets)
  if (a.w <= 0 || a.h <= 0) return null

  // Distances can go negative when the pointer leaves the area; the comparisons still hold.
  const left = px - a.x
  const right = a.x + a.w - px
  const top = py - a.y
  const bottom = a.y + a.h - py

  const nearLeft = left <= snap.edge
  const nearRight = right <= snap.edge
  const nearTop = top <= snap.edge
  const nearBottom = bottom <= snap.edge
  if (!nearLeft && !nearRight && !nearTop && !nearBottom) return null

  const side = left <= snap.corner ? 'left' : right <= snap.corner ? 'right' : null
  const half = top <= snap.corner ? 'top' : bottom <= snap.corner ? 'bottom' : null
  if (side && half) return `${half}-${side}` as SnapZone

  if (nearTop) return 'max'
  if (nearLeft) return 'left'
  if (nearRight) return 'right'
  return null
}
