import { computed, reactive, shallowRef } from 'vue'
import { DEFAULT_MIN_H, DEFAULT_MIN_W, cascade, clampDescriptor, clampSize, snapRect } from './geometry'
import type {
  Bounds,
  ComponentsMap,
  OpenOptions,
  Rect,
  ResolvedOptions,
  SnapZone,
  Viewport,
  WindowDescriptor,
  WindowEvent,
  WindowEventType,
  WindowProps,
} from './types'

/** A guard registered by a mounted window's content; see requestClose. */
export type CloseGuard = () => boolean | Promise<boolean>

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => a[k] === b[k])
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `w-${Math.random().toString(36).slice(2)}-${Date.now()}`
}

function rectOf(d: WindowDescriptor): Rect {
  return { x: d.x, y: d.y, w: d.w, h: d.h }
}

export function createStore(options: ResolvedOptions) {
  const s = reactive({ stack: [] as WindowDescriptor[], topZ: 10 })
  /** Ids that arrived from storage rather than from a fresh open(). */
  const restoredIds = new Set<string>()
  /**
   * Snap state, deliberately outside `s`: it is runtime-only, so the descriptor stays exactly as
   * persisted and the schema does not move — but reactive, so a consumer can render the zone.
   * `prev` is the geometry to give back on undock.
   */
  const docks = reactive(new Map<string, { zone: SnapZone; prev: Rect }>())
  /** The drop target armed by the current drag, rendered as a ghost by WindowHost. */
  const preview = shallowRef<({ zone: SnapZone } & Rect) | null>(null)
  /**
   * Functions, so they can never be persisted — same placement rationale as `docks`. Guards come
   * from mounted content and die with it.
   */
  const closeGuards = new Map<string, CloseGuard>()
  /**
   * Header elements of the mounted frames, and the consumer's opt-in taskbar destination. Elements,
   * so like `closeGuards` they can never reach storage, and outside `s` so registering one cannot
   * wake the persistence watcher. This is the only DOM the store holds, and it holds it for one
   * reason: a window whose frame unmounts has to hand focus to another window, which is a question
   * about `z` and `minimized` that only the store can answer.
   */
  const headers = new Map<string, HTMLElement>()
  let focusTarget: HTMLElement | null = null
  const listeners = new Map<string, Set<(e: WindowEvent) => void>>()

  /** Non-minimized windows, in creation order — the set WindowHost renders. */
  const visible = computed(() => s.stack.filter((w) => !w.minimized))
  const minimized = computed(() => s.stack.filter((w) => w.minimized))
  /** Derived rather than stored: an activeId kept by hand could desync from `z`. */
  const activeId = computed(() => {
    let top: WindowDescriptor | null = null
    for (const w of s.stack) if (!w.minimized && (!top || w.z > top.z)) top = w
    return top?.id ?? null
  })

  function emit(type: WindowEventType, id: string): void {
    const e: WindowEvent = { type, id }
    for (const cb of listeners.get(type) ?? []) cb(e)
    for (const cb of listeners.get('*') ?? []) cb(e)
  }

  /** Subscribe to a transition, or to `'*'` for all of them. Returns the unsubscribe. */
  function on(type: WindowEventType | '*', cb: (e: WindowEvent) => void): () => void {
    const set = listeners.get(type) ?? new Set()
    listeners.set(type, set)
    set.add(cb)
    return () => set.delete(cb)
  }

  function byId(id: string): WindowDescriptor | undefined {
    return s.stack.find((w) => w.id === id)
  }

  function require(id: string): WindowDescriptor {
    const w = byId(id)
    if (!w) throw new Error(`[vue-windows] no window "${id}"`)
    return w
  }

  /**
   * Raising an already-top window would be a pointless store write on every pointerdown, and the
   * deep persistence watcher would wake for it. `restore()` clears `minimized` before calling in,
   * so a window coming back from the taskbar still lands on top.
   */
  function focus(id: string): string {
    const w = require(id)
    if (w.z === s.topZ && !w.minimized) return id
    w.z = ++s.topZ
    emit('focus', id)
    return id
  }

  function minimize(id: string): string {
    const w = require(id)
    if (!w.minimizable || w.minimized) return id
    w.minimized = true
    emit('minimize', id)
    return id
  }

  function restore(id: string): string {
    const w = require(id)
    if (w.minimized) {
      w.minimized = false
      emit('restore', id)
    }
    return focus(id)
  }

  /** Unconditional: guards belong to `requestClose`, so `closeAll()` on logout can never block. */
  function close(id: string): void {
    if (!byId(id)) return
    s.stack = s.stack.filter((w) => w.id !== id)
    restoredIds.delete(id)
    docks.delete(id)
    closeGuards.delete(id)
    emit('close', id)
  }

  function closeAll(): void {
    const ids = s.stack.map((w) => w.id)
    s.stack = []
    restoredIds.clear()
    docks.clear()
    closeGuards.clear()
    for (const id of ids) emit('close', id)
  }

  /** Registered by a mounted `BaseWindow`, so a leaving window can hand focus to this one. */
  function registerHeader(id: string, el: HTMLElement): () => void {
    headers.set(id, el)
    return () => {
      if (headers.get(id) === el) headers.delete(id)
    }
  }

  function headerOf(id: string): HTMLElement | null {
    return headers.get(id) ?? null
  }

  /**
   * Where focus goes when the last window is minimized: the consumer's taskbar, which is where the
   * window's button now is. Opt-in, passed as a ref callback out of `WindowTaskbar`'s slot, so
   * `null` arrives on unmount.
   */
  function registerFocusTarget(el: HTMLElement | null): void {
    focusTarget = el
  }

  function taskbarTarget(): HTMLElement | null {
    return focusTarget
  }

  /** Registered by mounted content; only consulted while that content is alive. */
  function onBeforeClose(id: string, guard: CloseGuard): () => void {
    closeGuards.set(id, guard)
    return () => {
      if (closeGuards.get(id) === guard) closeGuards.delete(id)
    }
  }

  /**
   * The guarded close. Runs the window's own guard, then the app-wide one — which is the only one
   * a minimized window has, its content being unmounted. Resolves false when either vetoes.
   */
  async function requestClose(id: string): Promise<boolean> {
    const w = byId(id)
    if (!w) return true

    const own = closeGuards.get(id)
    if (own && !(await own())) return false
    if (options.beforeClose && !(await options.beforeClose(w))) return false

    close(id)
    return true
  }

  function openWindow(name: string, props: Record<string, unknown> = {}, opts: OpenOptions = {}): string {
    if (!options.components[name]) throw new Error(`[vue-windows] unknown window "${name}"`)

    // One window per entity: same name + same props means the same thing.
    if (opts.dedupe !== false) {
      const dup = s.stack.find((w) => w.name === name && shallowEqual(w.props, props))
      if (dup) return restore(dup.id)
    }

    while (s.stack.length >= options.maxWindows && s.stack[0]) close(s.stack[0].id)

    // Precedence: the open() call, then the component's spec, then the library default.
    const defs = options.defaultsFor(name)
    const d: WindowDescriptor = {
      id: newId(),
      name,
      props,
      state: null,
      title: opts.title ?? defs.title ?? '',
      minimized: false,
      ...cascade(s.stack.length, { x: opts.x, y: opts.y, w: opts.w ?? defs.w, h: opts.h ?? defs.h }),
      z: ++s.topZ,
      meta: opts.meta ?? {},
      closable: opts.closable ?? defs.closable ?? true,
      minimizable: opts.minimizable ?? defs.minimizable ?? true,
      draggable: opts.draggable ?? defs.draggable ?? true,
      resizable: opts.resizable ?? defs.resizable ?? true,
      minW: opts.minW ?? defs.minW ?? DEFAULT_MIN_W,
      minH: opts.minH ?? defs.minH ?? DEFAULT_MIN_H,
      maxW: opts.maxW ?? defs.maxW ?? null,
      maxH: opts.maxH ?? defs.maxH ?? null,
    }
    Object.assign(d, clampSize(d.w, d.h, d))
    s.stack.push(d)
    emit('open', d.id)
    return d.id
  }

  function setTitle(id: string, title: string): void {
    const w = require(id)
    if (w.title === title) return
    w.title = title
    emit('title', id)
  }

  function setGeometry(id: string, geom: Partial<Pick<WindowDescriptor, 'x' | 'y' | 'w' | 'h'>>): void {
    const w = require(id)
    Object.assign(w, geom)
    Object.assign(w, clampSize(w.w, w.h, w))
    emit('geometry', id)
  }

  /** Props are ids and primitives; replacing them re-renders the content in place. */
  function updateProps(id: string, props: Record<string, unknown>): void {
    require(id).props = props
  }

  function setMeta(id: string, meta: Record<string, unknown>): void {
    require(id).meta = meta
  }

  function dockZone(id: string): SnapZone | null {
    return docks.get(id)?.zone ?? null
  }

  /**
   * Snaps a window to `zone`, or `'none'` to give back the geometry it had before the first snap.
   * Re-snapping keeps the original `prev`, so left → max → none lands where the window started.
   */
  function snap(id: string, zone: SnapZone | 'none', view: Viewport): string {
    const w = require(id)
    const current = docks.get(id)

    if (zone === 'none') {
      if (current) {
        Object.assign(w, current.prev)
        docks.delete(id)
        emit('geometry', id)
      }
      return id
    }

    docks.set(id, { zone, prev: current?.prev ?? rectOf(w) })
    const rect = snapRect(zone, view, options.snap.insets)
    Object.assign(w, rect, clampSize(rect.w, rect.h, w))
    emit('geometry', id)
    return focus(id)
  }

  /** Forgets the snap and keeps the current geometry — what a manual resize means. */
  function undock(id: string): void {
    docks.delete(id)
  }

  /**
   * Undock at the start of a drag: the window gets its pre-snap size back and is placed so the
   * pointer keeps the same relative position along the header, as it does on Windows.
   */
  function undockForDrag(id: string, pointerX: number): void {
    const dock = docks.get(id)
    if (!dock) return
    const w = require(id)
    const ratio = w.w > 0 ? (pointerX - w.x) / w.w : 0.5
    w.w = dock.prev.w
    w.h = dock.prev.h
    w.x = Math.round(pointerX - dock.prev.w * ratio)
    docks.delete(id)
  }

  /** Arms (or clears) the drop preview. Cheap to call on every pointermove. */
  function setPreview(zone: SnapZone | null, view: Viewport): void {
    if (!zone) {
      if (preview.value) preview.value = null
      return
    }
    if (preview.value?.zone === zone) return
    preview.value = { zone, ...snapRect(zone, view, options.snap.insets) }
  }

  /**
   * Re-clamp every window; a shrinking viewport must not strand one off-screen. A snapped window
   * is re-snapped instead: it follows the new viewport rather than being dragged back by minVisible.
   */
  function clampAll(view: Viewport, bounds: Bounds = options.bounds): void {
    for (const w of s.stack) {
      const dock = docks.get(w.id)
      if (dock) {
        const rect = snapRect(dock.zone, view, options.snap.insets)
        Object.assign(w, rect, clampSize(rect.w, rect.h, w))
      } else clampDescriptor(w, view, bounds)
    }
  }

  function isRestored(id: string): boolean {
    return restoredIds.has(id)
  }

  /** Replaces the stack with a hydrated one; every id counts as restored. */
  function hydrate(stack: WindowDescriptor[], topZ: number): void {
    s.stack = stack
    s.topZ = Math.max(topZ, ...stack.map((w) => w.z), 10)
    restoredIds.clear()
    docks.clear()
    closeGuards.clear()
    for (const w of stack) restoredIds.add(w.id)
  }

  return {
    s,
    options,
    visible,
    minimized,
    activeId,
    preview,
    on,
    byId,
    open: openWindow,
    close,
    closeAll,
    requestClose,
    onBeforeClose,
    registerHeader,
    headerOf,
    registerFocusTarget,
    taskbarTarget,
    minimize,
    restore,
    focus,
    setTitle,
    setGeometry,
    updateProps,
    setMeta,
    snap,
    undock,
    undockForDrag,
    dockZone,
    setPreview,
    clampAll,
    isRestored,
    hydrate,
  }
}

export type WindowsApi = ReturnType<typeof createStore>

/**
 * The store as seen through a known components map: `open()` checks the name against the map and
 * the props against that component. Types only — the runtime store is the same object.
 */
export interface TypedWindowsApi<C extends ComponentsMap> extends Omit<WindowsApi, 'open'> {
  open<K extends keyof C & string>(
    name: K,
    // Props stay required when the component requires them, optional when it does not.
    ...args: object extends WindowProps<C[K]>
      ? [props?: WindowProps<C[K]>, opts?: OpenOptions]
      : [props: WindowProps<C[K]>, opts?: OpenOptions]
  ): string
}
