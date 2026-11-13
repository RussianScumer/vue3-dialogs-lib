import { getCurrentScope, onScopeDispose, watch } from 'vue'
import { DEFAULT_MIN_H, DEFAULT_MIN_W, clampSize } from './geometry'
import type { WindowsApi } from './state'
import type { AxisMode, AxisModes, ResolvedOptions, SnapZone, WindowDescriptor } from './types'
import { warn } from './warn'

/** Bump whenever the descriptor shape changes: a stale blob in new code is the sharpest bug here. */
export const SCHEMA = 2

/** Schemas old enough to still be readable, newest first. Anything else is dropped. */
const MIGRATABLE = new Set([1])

const DEBOUNCE_MS = 300

interface Snapshot {
  schema: number
  topZ: number
  stack: WindowDescriptor[]
  /**
   * Which tab wrote this blob. Not part of the descriptor and not part of the schema contract: old
   * code ignores the key and old blobs simply have none, so `SCHEMA` does not move for it.
   */
  writer?: string
  /**
   * Zone per docked window id. Like `writer`, old code ignores the key and its absence marks a
   * legacy blob, so `SCHEMA` does not move for it.
   */
  docks?: Record<string, SnapZone>
  /** Axis modes per window id that has a geometry record; same compatibility story as `docks`. */
  modes?: Record<string, AxisModes>
}

const ZONES = new Set<string>(
  ['left', 'right', 'max', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] satisfies SnapZone[],
)
const MODES = new Set<string>(['fit', 'free', 'centre'] satisfies AxisMode[])

function isPlain(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function docksOf(v: unknown, ids: Set<string>): Record<string, SnapZone> {
  const out: Record<string, SnapZone> = {}
  if (!isPlain(v)) return out
  for (const [id, zone] of Object.entries(v)) {
    if (ids.has(id) && typeof zone === 'string' && ZONES.has(zone)) out[id] = zone as SnapZone
  }
  return out
}

function modesOf(v: unknown, ids: Set<string>): Record<string, AxisModes> {
  const out: Record<string, AxisModes> = {}
  if (!isPlain(v)) return out
  for (const [id, m] of Object.entries(v)) {
    if (!ids.has(id) || !isPlain(m)) continue
    const { x, y } = m
    if (typeof x === 'string' && typeof y === 'string' && MODES.has(x) && MODES.has(y)) {
      out[id] = { x: x as AxisMode, y: y as AxisMode }
    }
  }
  return out
}

/** One per `setupPersist` call, so a tab can tell its own writes from everyone else's. */
function newToken(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined
  return c?.randomUUID ? c.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isDescriptor(v: unknown, options: ResolvedOptions): v is WindowDescriptor {
  if (!v || typeof v !== 'object') return false
  const d = v as Record<string, unknown>
  return (
    typeof d.id === 'string' &&
    typeof d.name === 'string' &&
    // Owned windows are runtime-only and are never written; a blob claiming one is hand-crafted or
    // from a shape this code does not know, and a confirm must never come back from storage.
    d.owner == null &&
    typeof d.minimized === 'boolean' &&
    ['x', 'y', 'w', 'h', 'z'].every((k) => typeof d[k] === 'number' && Number.isFinite(d[k])) &&
    // A descriptor whose window type no longer exists can never be rendered.
    Boolean(options.components[d.name])
  )
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function size(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function limit(v: unknown, fallback: number | null): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/**
 * Fills in whatever a descriptor is missing from the component's own defaults. This is both the
 * schema-1 migration and the repair path for a hand-edited blob — one code path, so a field added
 * to the descriptor only ever needs a line here.
 */
function normalize(v: WindowDescriptor, options: ResolvedOptions): WindowDescriptor {
  const d = v as WindowDescriptor & Record<string, unknown>
  const defs = options.defaultsFor(d.name)
  d.title = typeof d.title === 'string' ? d.title : ''
  d.props = d.props && typeof d.props === 'object' ? d.props : {}
  d.meta = d.meta && typeof d.meta === 'object' ? d.meta : {}
  // A draft is whatever `useWindowState` handed the content: an object, or nothing yet. Anything
  // else in the blob is a hand edit, and a content component would trip over it on first read.
  d.state = typeof d.state === 'object' ? d.state : null
  d.closable = bool(d.closable, defs.closable ?? true)
  d.minimizable = bool(d.minimizable, defs.minimizable ?? true)
  d.draggable = bool(d.draggable, defs.draggable ?? true)
  d.resizable = bool(d.resizable, defs.resizable ?? true)
  d.minW = size(d.minW, defs.minW ?? DEFAULT_MIN_W)
  d.minH = size(d.minH, defs.minH ?? DEFAULT_MIN_H)
  d.maxW = limit(d.maxW, defs.maxW ?? null)
  d.maxH = limit(d.maxH, defs.maxH ?? null)
  // Once the limits are known, the size has to obey them: a blob written before a component raised
  // its `minW`, or edited by hand, would otherwise render under the minimum until the first resize.
  Object.assign(d, clampSize(d.w, d.h, d))
  return d
}

/**
 * `openWindow` evicts past `maxWindows` one open at a time; a blob longer than the limit would sit
 * over it until the next `open()`. The highest `z` are the most recently used, so those survive,
 * in their original stack order. A blob never carries owned windows, so every entry is a root.
 */
function trim(stack: WindowDescriptor[], maxWindows: number): WindowDescriptor[] {
  const limit = Math.max(1, maxWindows)
  if (stack.length <= limit) return stack
  const keep = new Set([...stack].sort((a, b) => b.z - a.z).slice(0, limit).map((d) => d.id))
  return stack.filter((d) => keep.has(d.id))
}

function read(options: ResolvedOptions): Snapshot | null {
  const p = options.persist
  if (!p) return null
  let raw: string | null = null
  try {
    raw = p.storage.getItem(p.key)
  } catch (err) {
    // Private mode, quota, blocked storage — persistence is never load-bearing.
    warn(`could not read "${p.key}" from storage; starting with an empty desktop`, err)
    return null
  }
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<Snapshot>
    if (!parsed || !Array.isArray(parsed.stack)) return null
    // Dropping a readable blob would throw away every open window on upgrade; migrate instead.
    if (parsed.schema !== SCHEMA && !MIGRATABLE.has(parsed.schema as number)) return null
    const seen = new Set<string>()
    const stack: WindowDescriptor[] = []
    for (const d of parsed.stack) {
      // Two descriptors with one id would collide in `byId` and in the frame `v-for`; the first wins.
      if (!isDescriptor(d, options) || seen.has(d.id)) continue
      seen.add(d.id)
      stack.push(normalize(d, options))
    }
    // `Infinity` parses fine (`1e999`) and would make every later `++topZ` a no-op, so no window
    // could ever be raised again. `size()` asks the same finite question the descriptors get.
    const kept = trim(stack, options.maxWindows)
    const ids = new Set(kept.map((d) => d.id))
    return {
      schema: SCHEMA,
      topZ: size(parsed.topZ, 10),
      stack: kept,
      docks: docksOf(parsed.docks, ids),
      modes: modesOf(parsed.modes, ids),
    }
  } catch (err) {
    warn(`the blob under "${p.key}" is not valid JSON; it is ignored`, err)
    return null
  }
}

/** Hydrates the store and keeps storage in sync. No-op without `persist` or a DOM. */
export function setupPersist(store: WindowsApi, options: ResolvedOptions): void {
  const p = options.persist
  if (!p || typeof window === 'undefined') return

  const token = newToken()
  let timer: ReturnType<typeof setTimeout> | undefined
  /** The last blob written or hydrated; `write()` never writes a string equal to it. */
  let last: string | undefined

  // Owned and modal windows are dropped on the way out, not filtered on the way in: both links
  // live in a runtime map, so a persisted child would come back as an ordinary window with no
  // owner and no way to be answered, and a persisted modal as a question with nobody asking it —
  // dimming the page on load over an answer that was given yesterday.
  const serialize = (): string => {
    const kept = store.s.stack.filter((w) => !store.ownerOf(w.id) && !store.isModal(w.id))
    const docks: Record<string, SnapZone> = {}
    const modes: Record<string, AxisModes> = {}
    // The blob stores intent, so a reflow that only fits the on-screen rect produces the same string.
    const stack = kept.map((w) => {
      const zone = store.dockZone(w.id)
      if (zone) docks[w.id] = zone
      const m = store.axisModesOf(w.id)
      if (m) modes[w.id] = m
      return { ...w, ...store.intentOf(w.id)! }
    })
    const data: Snapshot = { schema: SCHEMA, topZ: store.s.topZ, stack, docks, modes, writer: token }
    return JSON.stringify(data)
  }

  function hydrateFromStorage(): void {
    const snapshot = read(options)
    if (!snapshot) {
      last = undefined
      return
    }
    store.hydrate(snapshot.stack, snapshot.topZ, { docks: snapshot.docks, modes: snapshot.modes })
    store.clampAll({ w: window.innerWidth, h: window.innerHeight }, options.bounds)
    // Replacing the stack wakes the deep watcher like any edit, and the write it schedules would
    // put the same data back under this tab's token: a foreign write to every other tab, which
    // stops them all, and a loop between two tabs that both `resume()`. The blob just hydrated
    // cannot have a cycle, so this cannot throw. `write()` skips a string equal to `last`.
    last = serialize()
  }

  hydrateFromStorage()

  // Set by a foreign write and never cleared on its own: a tab that resumed writing because it
  // regained focus is exactly how one session eats another. Only `resume()` clears it.
  let stopped = false

  const write = (): void => {
    if (stopped) return
    try {
      const raw = serialize()
      // A reflow changes the screen, not the intent, so it writes nothing and other tabs see no
      // `storage` event. An edit that changes the blob goes through as usual.
      if (raw === last) return
      p.storage.setItem(p.key, raw)
      last = raw
    } catch (err) {
      // Storage full or unavailable: drop the write, keep the app alive.
      warn(`could not write "${p.key}" to storage; this change is not persisted`, err)
    }
  }

  // Deep, and it has to stay deep: `useWindowState` hands the content its draft object to mutate
  // directly, and the drag writes x/y straight onto the descriptor. Neither goes through a store
  // method, so no event-based scheme could see them.
  const schedule = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      write()
    }, DEBOUNCE_MS)
  }
  watch(() => store.s, schedule, { deep: true })
  // Dock state lives outside `s`, and a snap into a zone that equals the current rect moves nothing
  // the deep watcher sees.
  watch(() => store.s.stack.map((w) => `${w.id}:${store.dockZone(w.id) ?? ''}`).join('|'), schedule)

  /**
   * The debounce is the whole reason a draft can be lost: a reload a keystroke after the last edit
   * would otherwise take the pending write with it. `pagehide` rather than `beforeunload` — it also
   * fires for a bfcache freeze and for a mobile tab discard, and it does not block unload.
   */
  const onPageHide = (): void => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
    write() // a stopped tab writes nothing; `write()` asks that question itself
  }

  /**
   * A blob is this tab's only if it says so. A removed key, unparseable text and a blob from a
   * version that wrote no token are all foreign — none of them came from this tab's last write,
   * which is the only question being asked.
   */
  const isForeign = (raw: string | null): boolean => {
    if (raw == null) return true
    try {
      const parsed = JSON.parse(raw) as Partial<Snapshot>
      return parsed?.writer !== token
    } catch {
      return true
    }
  }

  const onStorage = (e: StorageEvent): void => {
    // `key` is null when the whole store was cleared, which is a foreign write to this key too.
    if (e.key !== null && e.key !== p.key) return
    // `sessionStorage` and `localStorage` can share a key name, and a write to the other one is
    // not a write to ours. An event with no area (a synthetic one) is judged by its key alone.
    if (e.storageArea && e.storageArea !== p.storage) return
    const raw = e.key === null ? null : e.newValue
    if (!isForeign(raw)) return

    // Stop before reporting, and drop whatever the debounce was still holding: a write scheduled
    // before the foreign one must not land after it.
    stopped = true
    clearTimeout(timer)
    timer = undefined

    try {
      p.onExternalChange?.({
        key: p.key,
        newValue: raw,
        resume() {
          hydrateFromStorage()
          stopped = false
        },
      })
    } catch (err) {
      // A throwing consumer must not take the listener down with it.
      warn('onExternalChange threw', err)
    }
  }

  window.addEventListener('storage', onStorage)
  window.addEventListener('pagehide', onPageHide)
  // The plugin installs inside its own scope; a bare `setupPersist()` call (the specs do this) has
  // none, and asking for teardown there would only warn.
  if (getCurrentScope()) {
    onScopeDispose(() => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('pagehide', onPageHide)
    })
  }
}
