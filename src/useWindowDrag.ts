import { onScopeDispose, watch, type Ref } from 'vue'
import { clampSize, clampX, clampY, zoneFromPointer } from './geometry'
import type { Bounds, ResolvedSnap, SnapZone, Viewport, WindowDescriptor } from './types'

interface DragOptions {
  view: Viewport
  bounds: Bounds
  enabled: () => boolean
  onStart?: () => void
  snap?: ResolvedSnap
  /** Called when the window is snapped and a drag begins: it must go back to its floating size. */
  onUndock?: (pointerX: number) => void
  /** The drop target under the pointer, or null. Fires only when it changes. */
  onArm?: (zone: SnapZone | null) => void
  /** A drag released over an armed zone. */
  onDrop?: (zone: SnapZone) => void
}

/**
 * Pointer Events with capture: one code path for mouse, touch and pen, and no
 * window-level listeners to leak. Elements marked [data-vw-nodrag] never drag.
 */
export function useWindowDrag(handleRef: Ref<HTMLElement | null>, d: WindowDescriptor, options: DragOptions) {
  let start: { px: number; py: number; x: number; y: number; pointerId: number } | null = null
  let armed: SnapZone | null = null

  function snapping(): boolean {
    return Boolean(options.snap?.enabled) && options.enabled()
  }

  function arm(zone: SnapZone | null) {
    if (zone === armed) return
    armed = zone
    options.onArm?.(zone)
  }

  function onDown(e: PointerEvent) {
    if (!options.enabled() || e.button !== 0) return
    if ((e.target as Element | null)?.closest('[data-vw-nodrag]')) return
    e.preventDefault()
    options.onStart?.()
    options.onUndock?.(e.clientX)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    start = { px: e.clientX, py: e.clientY, x: d.x, y: d.y, pointerId: e.pointerId }
  }

  function onMove(e: PointerEvent) {
    if (!start || e.pointerId !== start.pointerId) return
    d.x = clampX(start.x + e.clientX - start.px, d.w, options.view, options.bounds)
    d.y = clampY(start.y + e.clientY - start.py, d.h, options.view, options.bounds)
    if (snapping()) arm(zoneFromPointer(e.clientX, e.clientY, options.view, options.snap!))
  }

  function onUp(e: PointerEvent) {
    if (!start) return
    const el = e.currentTarget as HTMLElement
    if (el.hasPointerCapture(start.pointerId)) el.releasePointerCapture(start.pointerId)
    start = null
    const zone = armed
    arm(null) // a ghost left behind by a cancelled drag would never go away
    if (zone && e.type !== 'pointercancel') options.onDrop?.(zone)
  }

  function bind(el: HTMLElement) {
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  function unbind(el: HTMLElement) {
    el.removeEventListener('pointerdown', onDown)
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onUp)
  }

  const stop = watch(
    handleRef,
    (el, prev) => {
      if (prev) unbind(prev)
      if (el) bind(el)
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    stop()
    arm(null)
    if (handleRef.value) unbind(handleRef.value)
  })
}

const STEP = 10

/**
 * Arrow keys move the window, shift+arrows resize it — pointer-only would strand keyboard users.
 * Both respect the window's own flags and limits, so the keyboard can do neither more nor less
 * than the pointer. A modified arrow is the keymap's, not this path's.
 */
export function onWindowKeydown(e: KeyboardEvent, d: WindowDescriptor, options: DragOptions): void {
  if (!options.enabled()) return
  // Shift is the resize modifier and belongs here; the rest belong to the keymap, which reads the
  // same arrows on the way up. Nudging by 10px first would leave a snap recording the nudged rect
  // as the geometry to give back.
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const delta = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] }[e.key]
  if (!delta) return
  const [dx, dy] = delta as [number, number]

  if (e.shiftKey) {
    if (!d.resizable) return
    e.preventDefault()
    Object.assign(d, clampSize(d.w + dx, d.h + dy, d))
    return
  }
  if (!d.draggable) return
  e.preventDefault()
  d.x = clampX(d.x + dx, d.w, options.view, options.bounds)
  d.y = clampY(d.y + dy, d.h, options.view, options.bounds)
}
