import type { Component } from 'vue'

/** A window as it lives in the store: JSON-serializable, no component references. */
export interface WindowDescriptor {
  id: string
  /** Key into the components map, not a component. */
  name: string
  /** Ids and primitives only — a window outlives the view that opened it. */
  props: Record<string, unknown>
  /** Draft state owned by the content component, see useWindowState. */
  state: unknown | null
  title: string
  minimized: boolean
  x: number
  y: number
  w: number
  h: number
  z: number
  /** Consumer bookkeeping, e.g. an entity version used to detect staleness. */
  meta: Record<string, unknown>
  /** Capabilities. Serializable like everything else, so they survive a reload. */
  closable: boolean
  minimizable: boolean
  draggable: boolean
  resizable: boolean
  minW: number
  minH: number
  /** null means unbounded. */
  maxW: number | null
  maxH: number | null
}

/** Everything a window can be configured with, whether per open() call or per component. */
export interface WindowDefaults {
  title?: string
  w?: number
  h?: number
  closable?: boolean
  minimizable?: boolean
  draggable?: boolean
  resizable?: boolean
  minW?: number
  minH?: number
  maxW?: number | null
  maxH?: number | null
}

export interface OpenOptions extends WindowDefaults {
  x?: number
  y?: number
  meta?: Record<string, unknown>
  /** false opens a second window even when one with the same name and props is already open. */
  dedupe?: boolean
}

export interface Viewport {
  w: number
  h: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Bounds {
  /** Px of the window kept reachable inside the viewport. */
  minVisible: number
}

/** The size limits a descriptor carries; `clampSize` works on anything with this shape. */
export interface SizeLimits {
  minW: number
  minH: number
  maxW: number | null
  maxH: number | null
}

/** Where a snapped window sits. Halves, quarters and maximize — the Windows set. */
export type SnapZone =
  | 'left'
  | 'right'
  | 'max'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

/** Px of the viewport excluded from the snap area, e.g. a fixed taskbar. */
export interface SnapInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface SnapOptions {
  enabled?: boolean
  /** Distance from an edge that arms a half or maximize. */
  edge?: number
  /** Distance from two edges that arms a quarter; must exceed `edge` to be reachable. */
  corner?: number
  insets?: Partial<SnapInsets>
}

export interface ResolvedSnap {
  enabled: boolean
  edge: number
  corner: number
  insets: SnapInsets
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface PersistOptions {
  key: string
  storage: StorageLike
}

/** A component, or a loader function returning one (`() => import('./X.vue')`). */
export type WindowComponent = Component | (() => Promise<Component | { default: Component }>)

/** A component plus the defaults every window of that type should open with. */
export interface WindowSpec extends WindowDefaults {
  component: WindowComponent
}

export type WindowEntry = WindowComponent | WindowSpec

export type ComponentsMap = Record<string, WindowEntry>

/**
 * Prop extraction for the typed `open()`. Direct component references are the exact case; an async
 * loader is unwrapped through its promise, and anything unrecognisable (a plain object component,
 * a loader whose module type cannot be seen) degrades to `Record<string, unknown>` rather than
 * becoming a type error — a library that cannot type your window must not refuse to open it.
 */
type UnwrapModule<M> = M extends { default: infer D } ? D : M

type EntryComponent<E> = E extends WindowSpec ? E['component'] : E

type ResolvedComponent<E> =
  EntryComponent<E> extends infer S ? (S extends () => Promise<infer M> ? UnwrapModule<M> : S) : never

type ExtractProps<C> = C extends abstract new (...args: never[]) => { $props: infer P }
  ? P
  : C extends (props: infer P, ...args: never[]) => unknown
    ? P
    : Record<string, unknown>

/** `windowId` is supplied by WindowHost, never by the caller. */
export type WindowProps<E> = Omit<ExtractProps<ResolvedComponent<E>>, 'windowId'>

/** Store transitions a consumer can subscribe to with `on()`. */
export type WindowEventType = 'open' | 'close' | 'focus' | 'minimize' | 'restore' | 'geometry' | 'title'

export interface WindowEvent {
  type: WindowEventType
  id: string
}

/** Returning false keeps the window open. Only consulted by `requestClose()`. */
export type BeforeCloseGuard = (d: WindowDescriptor) => boolean | Promise<boolean>

export interface WindowsOptions {
  components: Record<string, WindowEntry>
  persist?: PersistOptions
  maxWindows?: number
  bounds?: Partial<Bounds>
  snap?: SnapOptions
  mobileBreakpoint?: number
  /** Added to every window's `z` at render time, to clear an app's own stacking contexts. */
  zIndexBase?: number
  /** Consulted by `requestClose()` for every window, including minimized ones. */
  beforeClose?: BeforeCloseGuard
}

export interface ResolvedOptions {
  components: Record<string, WindowEntry>
  persist: PersistOptions | null
  maxWindows: number
  bounds: Bounds
  snap: ResolvedSnap
  mobileBreakpoint: number
  zIndexBase: number
  beforeClose: BeforeCloseGuard | null
  /** Memoized component resolution; loader functions become async components. */
  resolve(name: string): Component
  /** The `WindowSpec` defaults for a name, or an empty object. */
  defaultsFor(name: string): WindowDefaults
}
