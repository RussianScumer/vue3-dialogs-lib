import { clampSize } from './geometry'
import type { WindowDescriptor } from './types'

/** The eight grips, edges first so the corners paint over them. */
export const RESIZE_DIRS = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'] as const
export type ResizeDir = (typeof RESIZE_DIRS)[number]

const EDGE = '4px'
const CORNER = '12px'

/** Inline so a window resizes with no stylesheet imported, like the rest of the geometry. */
export const RESIZE_STYLES: Record<ResizeDir, Record<string, string>> = {
  n: { top: '0', left: '0', right: '0', height: EDGE, cursor: 'ns-resize' },
  s: { bottom: '0', left: '0', right: '0', height: EDGE, cursor: 'ns-resize' },
  e: { top: '0', right: '0', bottom: '0', width: EDGE, cursor: 'ew-resize' },
  w: { top: '0', left: '0', bottom: '0', width: EDGE, cursor: 'ew-resize' },
  nw: { top: '0', left: '0', width: CORNER, height: CORNER, cursor: 'nwse-resize' },
  ne: { top: '0', right: '0', width: CORNER, height: CORNER, cursor: 'nesw-resize' },
  sw: { bottom: '0', left: '0', width: CORNER, height: CORNER, cursor: 'nesw-resize' },
  se: { bottom: '0', right: '0', width: CORNER, height: CORNER, cursor: 'nwse-resize' },
}

interface ResizeOptions {
  enabled: () => boolean
  /** Raise the window, as a drag does. */
  onStart?: () => void
  /** A deliberate size is an explicit choice that outranks any snap. */
  onEnd?: () => void
}

interface ResizeStart {
  px: number
  py: number
  x: number
  y: number
  w: number
  h: number
  dir: ResizeDir
  pointerId: number
}

/**
 * Pointer-driven resize from any of the eight grips. Replaces CSS `resize: both`, which only ever
 * offered one corner, could not honour min/max, and could not move x/y — a west or north grip has
 * to, since the opposite edge is what stays put.
 */
export function useWindowResize(d: WindowDescriptor, options: ResizeOptions) {
  let start: ResizeStart | null = null

  function onDown(e: PointerEvent, dir: ResizeDir) {
    if (!options.enabled() || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    options.onStart?.()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    start = { px: e.clientX, py: e.clientY, x: d.x, y: d.y, w: d.w, h: d.h, dir, pointerId: e.pointerId }
  }

  function onMove(e: PointerEvent) {
    if (!start || e.pointerId !== start.pointerId) return
    const dx = e.clientX - start.px
    const dy = e.clientY - start.py
    const east = start.dir.includes('e')
    const west = start.dir.includes('w')
    const south = start.dir.includes('s')
    const north = start.dir.includes('n')

    const wanted = {
      w: east ? start.w + dx : west ? start.w - dx : start.w,
      h: south ? start.h + dy : north ? start.h - dy : start.h,
    }
    const size = clampSize(wanted.w, wanted.h, d)

    // The anchored edge is the one without a grip: growing west moves x by whatever width was
    // actually granted, so the east edge stays exactly where it was even at the min-width stop.
    d.w = size.w
    d.h = size.h
    if (west) d.x = start.x + (start.w - size.w)
    if (north) d.y = start.y + (start.h - size.h)
  }

  function onUp(e: PointerEvent) {
    if (!start) return
    const el = e.currentTarget as HTMLElement
    if (el.hasPointerCapture(start.pointerId)) el.releasePointerCapture(start.pointerId)
    start = null
    options.onEnd?.()
  }

  return { onDown, onMove, onUp }
}
