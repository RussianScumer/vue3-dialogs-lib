import { watch } from 'vue'
import { DEFAULT_MIN_H, DEFAULT_MIN_W, clampDescriptor } from './geometry'
import type { WindowsApi } from './state'
import type { ResolvedOptions, WindowDescriptor } from './types'

/** Bump whenever the descriptor shape changes: a stale blob in new code is the sharpest bug here. */
export const SCHEMA = 2

/** Schemas old enough to still be readable, newest first. Anything else is dropped. */
const MIGRATABLE = new Set([1])

const DEBOUNCE_MS = 300

interface Snapshot {
  schema: number
  topZ: number
  stack: WindowDescriptor[]
}

function isDescriptor(v: unknown, options: ResolvedOptions): v is WindowDescriptor {
  if (!v || typeof v !== 'object') return false
  const d = v as Record<string, unknown>
  return (
    typeof d.id === 'string' &&
    typeof d.name === 'string' &&
    typeof d.minimized === 'boolean' &&
    ['x', 'y', 'w', 'h', 'z'].every((k) => typeof d[k] === 'number' && Number.isFinite(d[k])) &&
    // A descriptor whose window type no longer exists can never be rendered.
    Boolean(options.components[d.name as string])
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
  d.state = d.state ?? null
  d.closable = bool(d.closable, defs.closable ?? true)
  d.minimizable = bool(d.minimizable, defs.minimizable ?? true)
  d.draggable = bool(d.draggable, defs.draggable ?? true)
  d.resizable = bool(d.resizable, defs.resizable ?? true)
  d.minW = size(d.minW, defs.minW ?? DEFAULT_MIN_W)
  d.minH = size(d.minH, defs.minH ?? DEFAULT_MIN_H)
  d.maxW = limit(d.maxW, defs.maxW ?? null)
  d.maxH = limit(d.maxH, defs.maxH ?? null)
  return d
}

function read(options: ResolvedOptions): Snapshot | null {
  const p = options.persist
  if (!p) return null
  let raw: string | null = null
  try {
    raw = p.storage.getItem(p.key)
  } catch {
    return null // private mode, quota, blocked storage — persistence is never load-bearing
  }
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<Snapshot>
    if (!parsed || !Array.isArray(parsed.stack)) return null
    // Dropping a readable blob would throw away every open window on upgrade; migrate instead.
    if (parsed.schema !== SCHEMA && !MIGRATABLE.has(parsed.schema as number)) return null
    const stack = parsed.stack.filter((d) => isDescriptor(d, options)).map((d) => normalize(d, options))
    return { schema: SCHEMA, topZ: typeof parsed.topZ === 'number' ? parsed.topZ : 10, stack }
  } catch {
    return null
  }
}

/** Hydrates the store and keeps storage in sync. No-op without `persist` or a DOM. */
export function setupPersist(store: WindowsApi, options: ResolvedOptions): void {
  const p = options.persist
  if (!p || typeof window === 'undefined') return

  const snapshot = read(options)
  if (snapshot) {
    const view = { w: window.innerWidth, h: window.innerHeight }
    for (const d of snapshot.stack) clampDescriptor(d, view, options.bounds)
    store.hydrate(snapshot.stack, snapshot.topZ)
  }

  // Deep, and it has to stay deep: `useWindowState` hands the content its draft object to mutate
  // directly, and the drag writes x/y straight onto the descriptor. Neither goes through a store
  // method, so no event-based scheme could see them.
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(
    () => store.s,
    () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const data: Snapshot = { schema: SCHEMA, topZ: store.s.topZ, stack: store.s.stack }
        try {
          p.storage.setItem(p.key, JSON.stringify(data))
        } catch {
          /* storage full or unavailable — drop the write, keep the app alive */
        }
      }, DEBOUNCE_MS)
    },
    { deep: true },
  )
}
