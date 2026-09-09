import { computed, reactive, shallowRef } from 'vue'
import { DEFAULT_MIN_H, DEFAULT_MIN_W, cascade, clampDescriptor, clampSize, snapRect } from './geometry'
import type {
  Bounds,
  CloseGuard,
  ComponentsMap,
  ControlLabels,
  OpenOptions,
  Rect,
  ResolvedOptions,
  SnapZone,
  Viewport,
  WindowDescriptor,
  WindowEvent,
  WindowEventType,
  WindowHandle,
  WindowProps,
  WindowResult,
  WindowResultOf,
} from './types'

export type { CloseGuard } from './types'

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => a[k] === b[k])
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `w-${Math.random().toString(36).slice(2)}-${Date.now()}`
}

/** Dev-only: the library ships no user-facing strings, and a bug in a guard is for the developer. */
function warn(message: string, err?: unknown): void {
  if (import.meta.env?.DEV) console.warn(`[vue3-dialogs-lib] ${message}`, err)
}

function rectOf(d: WindowDescriptor): Rect {
  return { x: d.x, y: d.y, w: d.w, h: d.h }
}

/**
 * How many owner links a chain may have. A confirm over an editor is one; a confirm over that
 * confirm is already unusual, and the cap is what stops a bug from building a tower of them.
 */
const MAX_OWNER_DEPTH = 3

/** One shared value: a restored window's answer carries no per-window data. */
const RESTORED: WindowResult = Object.freeze({ ok: false, reason: 'restored' })
const CLOSED: WindowResult = Object.freeze({ ok: false, reason: 'closed' })

/** Dev-only, and once per module: the tripwire below is a migration aid, not a running commentary. */
let coercionWarned = false

/**
 * `open()`'s return value. A plain `{ id, result }` object, plus — in dev only — a `toPrimitive`
 * that warns the first time the handle is used where a string was expected, which is exactly what
 * a pre-0.2 call site does. In production it coerces to `[object Object]`, loudly and on purpose:
 * a handle that quietly stringifies to an id is the back-compatible shape this release rejected.
 */
function makeHandle<T>(id: string, result: Promise<WindowResult<T>>): WindowHandle<T> {
  const handle: WindowHandle<T> = { id, result }
  if (import.meta.env?.DEV) {
    Object.defineProperty(handle, Symbol.toPrimitive, {
      value: () => {
        if (!coercionWarned) {
          coercionWarned = true
          warn('open() returns { id, result } — read `.id` where a window id is expected')
        }
        return id
      },
    })
  }
  return handle
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
   * Where each window's taskbar button is, when the consumer chose to tell us — the only thing a
   * minimize animation needs that the library cannot know, since the taskbar is the consumer's own
   * markup. Runtime-only for the same reason as `docks`: a measured rect is stale the moment the
   * page reflows, so it must never reach storage. Reactive because the button is usually measured
   * after the window has already started leaving.
   */
  const taskbarRects = reactive(new Map<string, Rect>())
  /**
   * Child id → owner id. Runtime-only like `docks`, and for a sharper reason: an owned window is
   * the question a close guard is asking, and a question must never survive a reload. Reactive,
   * because the owner's frame goes inert the moment a child appears and interactive again the
   * moment it is answered.
   */
  const owners = reactive(new Map<string, string>())
  /**
   * Pin state: **an entry means the window is pin-capable, the value means it is currently
   * pinned.** Runtime-only beside `docks`, and for the reason that decided the shape — pinning is
   * toggleable from the header, so it is not a capability the descriptor could carry without the
   * schema moving. The cost is explicit: a pinned window comes back unpinned after a reload,
   * exactly as a snapped one comes back undocked. Reactive, because the pin drives the render band.
   *
   * A window that never mentioned `fixed` has no entry at all, is not pin-capable, and renders
   * exactly as it did before this existed — no extra control, no second z band.
   */
  const pins = reactive(new Map<string, boolean>())
  /**
   * Per-window accessible names for the default controls, merged over the app-wide `labels` option
   * by `labelsFor`. Runtime-only beside `pins`, and for a reason of its own: a label belongs to the
   * locale of the app that is running, not to the window — persisting one would restore last
   * month's translation into a page that has since been re-installed with a new one. Reactive
   * because a window opened with labels renders its header in the same tick.
   */
  const controlLabels = reactive(new Map<string, ControlLabels>())
  /**
   * Functions, so they can never be persisted — same placement rationale as `docks`. Guards come
   * from mounted content and die with it.
   */
  const closeGuards = new Map<string, CloseGuard>()
  /**
   * The windows whose guards are still deciding. Runtime-only like `docks` and reactive so a
   * consumer can render a pending state, but a Set rather than a descriptor field: a reload during
   * a pending guard must bring back an ordinary window, not one stuck mid-close.
   */
  const closing = reactive(new Set<string>())
  /**
   * The in-flight `requestClose` per id, so a second call joins the first instead of asking the
   * user twice. Promises, so — like `closeGuards` — this can never be persisted.
   */
  const pending = new Map<string, Promise<boolean>>()
  /**
   * What each window will settle with, per id. Promises again, so — like `closeGuards` and
   * `pending` — this can never be written to storage, which is also the rule: a result belongs to
   * the call that opened the window, and that call belongs to one page load.
   */
  const results = new Map<string, { promise: Promise<WindowResult>; settle: (r: WindowResult) => void }>()
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
    if (!w) throw new Error(`[vue3-dialogs-lib] no window "${id}"`)
    return w
  }

  /** The window this one is a child of, or null. Runtime-only, so it is never on the descriptor. */
  function ownerOf(id: string): string | null {
    return owners.get(id) ?? null
  }

  /** Live children of a window, in stack order. */
  function childrenOf(id: string): string[] {
    const out: string[] = []
    for (const w of s.stack) if (owners.get(w.id) === id) out.push(w.id)
    return out
  }

  /** True while this window owns a child — the condition that makes its frame inert. */
  function hasChild(id: string): boolean {
    for (const owner of owners.values()) if (owner === id) return true
    return false
  }

  /**
   * The owner chain above a window, nearest first. The `seen` set makes a cycle an error rather
   * than a hang; nothing in the public API can build one, since `open()` is the only way to add a
   * link and the window it links is brand new, but a walk that can loop forever is not a thing to
   * leave in a library.
   */
  function ancestorsOf(id: string): string[] {
    const chain: string[] = []
    const seen = new Set<string>([id])
    let cur = owners.get(id)
    while (cur) {
      if (seen.has(cur)) throw new Error(`[vue3-dialogs-lib] owner cycle at "${cur}"`)
      seen.add(cur)
      chain.push(cur)
      cur = owners.get(cur)
    }
    return chain
  }

  /** A window and everything below it, owners before their children — the order they stack in. */
  function groupOf(id: string): WindowDescriptor[] {
    const chain = ancestorsOf(id)
    const out: WindowDescriptor[] = []
    const walk = (wid: string) => {
      const w = byId(wid)
      if (w) out.push(w)
      for (const child of childrenOf(wid)) walk(child)
    }
    walk(chain[chain.length - 1] ?? id)
    return out
  }

  /** Re-stacks a whole group in one go, which is what keeps a child at exactly `owner.z + 1`. */
  function raiseGroup(group: WindowDescriptor[]): void {
    for (const w of group) w.z = ++s.topZ
  }

  /**
   * Raising an already-top window would be a pointless store write on every pointerdown, and the
   * deep persistence watcher would wake for it. `restore()` clears `minimized` before calling in,
   * so a window coming back from the taskbar still lands on top.
   *
   * An owner and its children move as one: focusing either raises the whole group, in chain order,
   * so their relative stacking never changes and a sheet can never end up under its own owner.
   */
  function focus(id: string): string {
    const w = require(id)
    const group = groupOf(id)
    if (group[group.length - 1]!.z === s.topZ && !w.minimized) return id
    raiseGroup(group)
    emit('focus', id)
    return id
  }

  /**
   * Move focus to the next window by `z`, wrapping — the keyboard's answer to clicking a window.
   * Shipped whether or not the keymap is on: a consumer building their own shortcuts needs it.
   *
   * Minimized windows are skipped because they have no frame to focus, and so is a window that
   * owns a child: its own frame is inert, and the child sitting directly above it is the reachable
   * half of that pair. Focusing raises the window, so repeated `focusNext()` walks the whole stack
   * rather than bouncing between the top two.
   */
  function cycleFocus(step: 1 | -1): string | null {
    const order = s.stack.filter((w) => !w.minimized && !hasChild(w.id)).sort((a, b) => a.z - b.z)
    if (order.length === 0) return null
    const from = order.findIndex((w) => w.id === activeId.value)
    // No active window in the ring — an inert owner is on top — so start from the end.
    const at = from === -1 ? order.length - 1 : from
    const next = order[(at + step + order.length) % order.length]!
    focus(next.id)
    headers.get(next.id)?.focus?.()
    return next.id
  }

  function focusNext(): string | null {
    return cycleFocus(1)
  }

  function focusPrev(): string | null {
    return cycleFocus(-1)
  }

  function minimize(id: string): string {
    const w = require(id)
    if (!w.minimizable || w.minimized) return id
    // Minimizing would unmount the owner while its own question is still on screen, leaving a
    // sheet with nothing behind it.
    if (hasChild(id)) {
      warn(`"${id}" owns an open child window and cannot be minimized until the child is closed`)
      return id
    }
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
    // Children first, and unconditionally: an owned window is the owner's question and must never
    // outlive it — the alternative is a sheet floating over nothing.
    for (const child of childrenOf(id)) close(child)
    s.stack = s.stack.filter((w) => w.id !== id)
    owners.delete(id)
    restoredIds.delete(id)
    docks.delete(id)
    pins.delete(id)
    controlLabels.delete(id)
    taskbarRects.delete(id)
    closeGuards.delete(id)
    closing.delete(id)
    pending.delete(id)
    // Before the event, so a listener that awaits the result is not waiting on a microtask that
    // has not been queued yet.
    settleResult(id, CLOSED)
    emit('close', id)
  }

  function closeAll(): void {
    const ids = s.stack.map((w) => w.id)
    s.stack = []
    restoredIds.clear()
    owners.clear()
    docks.clear()
    pins.clear()
    controlLabels.clear()
    taskbarRects.clear()
    closeGuards.clear()
    closing.clear()
    pending.clear()
    // Every outstanding result settles here: logging out must not leave a caller awaiting a window
    // that no longer exists. `settleResult` empties the map as it goes.
    for (const id of [...results.keys()]) settleResult(id, CLOSED)
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

  /**
   * Records where a window's taskbar button is, so a minimizing window can be animated towards it.
   * Opt-in, out of `WindowTaskbar`'s slot; a `DOMRect` is accepted as-is because that is what
   * `getBoundingClientRect()` hands back. `null` forgets the button.
   */
  function setTaskbarRect(id: string, rect: DOMRectReadOnly | Rect | null): void {
    if (!rect) {
      taskbarRects.delete(id)
      return
    }
    const r = 'width' in rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : rect
    const prev = taskbarRects.get(id)
    // Consumers measure from a ref callback, which re-runs on every taskbar render: writing an
    // unchanged rect would wake every effect reading it, several times per drag.
    if (prev && prev.x === r.x && prev.y === r.y && prev.w === r.w && prev.h === r.h) return
    taskbarRects.set(id, r)
  }

  function taskbarRect(id: string): Rect | null {
    return taskbarRects.get(id) ?? null
  }

  /** A fresh window's unsettled result, recorded so every close path can settle it. */
  function deferResult(id: string): Promise<WindowResult> {
    let settle!: (r: WindowResult) => void
    const promise = new Promise<WindowResult>((res) => {
      settle = res
    })
    results.set(id, { promise, settle })
    return promise
  }

  /**
   * Settles a window's result, once. Every path that takes a window away goes through here, which
   * is what makes "a result promise never hangs" true rather than aspirational; settling an id
   * that has already been answered — `resolve()` and then the `close()` it performs — is a no-op,
   * since a settled promise ignores a second answer.
   */
  function settleResult(id: string, r: WindowResult): void {
    const entry = results.get(id)
    if (!entry) return
    results.delete(id)
    entry.settle(r)
  }

  /**
   * The result promise for a window that is already open — what `open()` handed back, and the only
   * way to reach a restored window's. An id the store has never heard of, or one whose window has
   * already gone, settles `closed`: asking after the fact is not a reason to hang.
   */
  function resultOf(id: string): Promise<WindowResult> {
    return results.get(id)?.promise ?? Promise.resolve(CLOSED)
  }

  /**
   * Settle with a value, then close — the "editor saved the entity" path. Unconditional, like
   * `close()`: the content has just decided, so asking its own guard whether it meant it would ask
   * about a draft that no longer exists.
   */
  function resolveResult(id: string, data: unknown): void {
    settleResult(id, { ok: true, data })
    close(id)
  }

  /** Registered by mounted content; only consulted while that content is alive. */
  function onBeforeClose(id: string, guard: CloseGuard): () => void {
    closeGuards.set(id, guard)
    return () => {
      if (closeGuards.get(id) === guard) closeGuards.delete(id)
    }
  }

  /** True while this window's guards are still deciding — the pending state of a `requestClose`. */
  function isClosing(id: string): boolean {
    return closing.has(id)
  }

  /**
   * Runs the window's own guard, then the app-wide one — which is the only one a minimized window
   * has, its content being unmounted. A guard that throws is a veto: an unanswered question is not
   * permission, and closing the window would be the destructive reading of a bug.
   */
  async function runGuards(id: string, w: WindowDescriptor): Promise<boolean> {
    let ok = true
    try {
      const own = closeGuards.get(id)
      if (own && !(await own())) ok = false
      else if (options.beforeClose && !(await options.beforeClose(w))) ok = false
    } catch (err) {
      warn(`a close guard for "${id}" threw; the window stays open`, err)
      ok = false
    } finally {
      closing.delete(id)
      pending.delete(id)
    }
    if (ok) close(id)
    return ok
  }

  /**
   * The guarded close. Resolves false when either guard vetoes, and the window is `closing` for as
   * long as they take, so the consumer can disable its own close affordance.
   *
   * Re-entrant by joining, not by refusing: a second call for the same id — an impatient second
   * click, a taskbar button and the ✕ racing — gets the promise the first one is already awaiting.
   * Running the guard twice would mean asking the user twice, and a `confirm` would appear again
   * behind the one still on screen.
   */
  function requestClose(id: string): Promise<boolean> {
    const inFlight = pending.get(id)
    if (inFlight) return inFlight

    const w = byId(id)
    if (!w) return Promise.resolve(true)

    // The child *is* the question. Answering the owner's close over the top of it would dismiss a
    // question the user has not answered, so the request is refused outright rather than queued.
    if (hasChild(id)) {
      warn(`"${id}" owns an open child window; answer the child before closing the owner`)
      return Promise.resolve(false)
    }

    closing.add(id)
    const p = runGuards(id, w)
    // A window with no guards at all never suspends: `runGuards` ran to its end, and its `finally`
    // has already cleared the flag by the time this line is reached. Recording the promise then
    // would leave an entry nothing will ever remove, so the flag is what says whether there is
    // still something to join.
    if (closing.has(id)) pending.set(id, p)
    return p
  }

  /**
   * Opens a window and hands back `{ id, result }` — not an id. The result is the window's own
   * answer: `resolve(data)` from inside it settles `{ ok: true, data }`, and every path that takes
   * the window away without one settles `{ ok: false, reason: 'closed' }`.
   */
  function openWindow(
    name: string,
    props: Record<string, unknown> = {},
    opts: OpenOptions = {},
  ): WindowHandle {
    if (!options.components[name]) throw new Error(`[vue3-dialogs-lib] unknown window "${name}"`)

    const owner = opts.owner ?? null
    if (owner !== null) {
      // Unknown owner throws at call time, exactly as an unknown name does: both are the caller
      // asking for something that does not exist.
      if (!byId(owner)) throw new Error(`[vue3-dialogs-lib] unknown owner window "${owner}"`)
      // `ancestorsOf` throws on a cycle; the cap is what keeps a confirm-on-a-confirm finite.
      if (ancestorsOf(owner).length + 1 > MAX_OWNER_DEPTH) {
        throw new Error(`[vue3-dialogs-lib] owner chain deeper than ${MAX_OWNER_DEPTH} windows`)
      }
      // A sheet with no owner on screen is orphaned UI, so the owner comes back with it.
      if (require(owner).minimized) restore(owner)
    }

    // One window per entity: same name + same props means the same thing. An owned window is not
    // an entity, it is a question about one — two of them can be open at once and must be.
    if (owner === null && opts.dedupe !== false) {
      const dup = s.stack.find((w) => w.name === name && shallowEqual(w.props, props))
      // The deduped caller joins the window that is already open, result included: there is one
      // window for the entity, so there is one answer, and both callers are waiting for it.
      if (dup) return makeHandle(restore(dup.id), resultOf(dup.id))
    }

    // Owned windows are not the user's windows: they neither count towards the limit nor are ever
    // the thing evicted to make room for it. A confirm must not close a real window to appear.
    if (owner === null) {
      let roots = s.stack.filter((w) => !owners.has(w.id))
      while (roots.length >= options.maxWindows && roots[0]) {
        close(roots[0].id)
        roots = s.stack.filter((w) => !owners.has(w.id))
      }
    }

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
      // Forced for an owned window, not defaulted: a sheet the user cannot dismiss is a trap, and a
      // minimized sheet is a question with nothing left to answer it about.
      closable: owner !== null ? true : (opts.closable ?? defs.closable ?? true),
      minimizable: owner !== null ? false : (opts.minimizable ?? defs.minimizable ?? true),
      draggable: opts.draggable ?? defs.draggable ?? true,
      resizable: opts.resizable ?? defs.resizable ?? true,
      minW: opts.minW ?? defs.minW ?? DEFAULT_MIN_W,
      minH: opts.minH ?? defs.minH ?? DEFAULT_MIN_H,
      maxW: opts.maxW ?? defs.maxW ?? null,
      maxH: opts.maxH ?? defs.maxH ?? null,
    }
    Object.assign(d, clampSize(d.w, d.h, d))
    s.stack.push(d)
    // Not on the descriptor, so not in `d` above: mentioning `fixed` at all is what makes the
    // window pin-capable, and the resolved value is whether it starts pinned.
    const fixed = opts.fixed ?? defs.fixed
    if (fixed !== undefined) pins.set(d.id, fixed)
    // Merged rather than replaced, and only stored when there is something to store: a window that
    // names one control keeps the app-wide names for the rest.
    const labels = { ...defs.labels, ...opts.labels }
    if (Object.keys(labels).length > 0) controlLabels.set(d.id, labels)
    if (owner !== null) {
      owners.set(d.id, owner)
      // Not `focus()`: the fresh window is already at topZ, so the early return would leave its
      // owner wherever it was. The whole group is re-stacked, which is what puts the child at
      // exactly `owner.z + 1` however deep the chain goes.
      raiseGroup(groupOf(d.id))
    }
    // Before the event: an `on('open')` listener may ask for the result, and by then it exists.
    const result = deferResult(d.id)
    emit('open', d.id)
    return makeHandle(d.id, result)
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

  /** True while this window renders in the pinned band, above every unpinned one. */
  function isPinned(id: string): boolean {
    return pins.get(id) === true
  }

  /** True when this window has a pin to toggle — the condition the header control renders on. */
  function isPinnable(id: string): boolean {
    return pins.has(id)
  }

  /**
   * Pins or unpins a window, and makes it pin-capable if it was not already: a consumer calling
   * this is asking for the affordance as much as for the state, and refusing would leave them with
   * a pinned window the user cannot let go of.
   *
   * Pinning drops any snap, the same reasoning the resize grip already uses: an explicit choice
   * about where the window sits outranks the zone that put it there. The geometry is kept — a
   * pinned window stays exactly where it was, it simply stops being treated as docked.
   */
  function setPinned(id: string, pinned: boolean): void {
    require(id)
    pins.set(id, pinned)
    if (pinned) undock(id)
  }

  /**
   * The effective names for a window's default controls: the app-wide option, with whatever the
   * window itself named laid over it key by key. The precedence lives here rather than in the
   * template so every consumer of it — the frame, and anyone rendering their own `controls` slot —
   * reads the same answer.
   */
  function labelsFor(id: string): ControlLabels {
    const own = controlLabels.get(id)
    return own ? { ...options.labels, ...own } : options.labels
  }

  /**
   * Snaps a window to `zone`, or `'none'` to give back the geometry it had before the first snap.
   * Re-snapping keeps the original `prev`, so left → max → none lands where the window started.
   */
  function snap(id: string, zone: SnapZone | 'none', view: Viewport): string {
    const w = require(id)
    // A pinned window is inert to geometry, whichever path asks: the pointer and the arrow keys go
    // through `BaseWindow`'s one `interactive` predicate, but the keymap listener is on the
    // document and reaches the active window directly. One refusal here covers both.
    if (isPinned(id)) return id
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
    owners.clear()
    docks.clear()
    pins.clear()
    controlLabels.clear()
    taskbarRects.clear()
    closeGuards.clear()
    closing.clear()
    pending.clear()
    for (const id of [...results.keys()]) settleResult(id, CLOSED)
    for (const w of stack) {
      restoredIds.add(w.id)
      // A restored descriptor has no live opener — the call that opened it belongs to a previous
      // page load, possibly a previous day. Its result is settled before anyone can ask, so
      // `resultOf()` is synchronous truth rather than a promise nobody will ever settle.
      results.set(w.id, { promise: Promise.resolve(RESTORED), settle: () => {} })
    }
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
    isClosing,
    resultOf,
    resolve: resolveResult,
    ownerOf,
    childrenOf,
    hasChild,
    onBeforeClose,
    registerHeader,
    headerOf,
    registerFocusTarget,
    taskbarTarget,
    setTaskbarRect,
    taskbarRect,
    minimize,
    restore,
    focus,
    focusNext,
    focusPrev,
    setTitle,
    setGeometry,
    updateProps,
    setMeta,
    snap,
    undock,
    undockForDrag,
    dockZone,
    isPinned,
    isPinnable,
    setPinned,
    labelsFor,
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
  ): WindowHandle<WindowResultOf<C[K]>>
}
