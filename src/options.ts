import { defineAsyncComponent, type Component } from 'vue'
import type {
  AsyncWindowOptions,
  KeyChord,
  KeymapAction,
  KeymapOptions,
  ResolvedKeymap,
  ResolvedOptions,
  SnapZone,
  WindowDefaults,
  WindowEntry,
  WindowSpec,
  WindowsOptions,
} from './types'

const NO_DEFAULTS: WindowDefaults = Object.freeze({})

/** Keys of `AsyncWindowOptions`: they configure loading, not the window, so they are split off. */
const ASYNC_KEYS = ['loadingComponent', 'errorComponent', 'delay', 'timeout'] as const

/** A spec is the only entry shape that is an object carrying a `component`. */
function isSpec(entry: WindowEntry): entry is WindowSpec {
  return typeof entry === 'object' && entry !== null && 'component' in entry
}

/**
 * The default bindings, as documented. `Meta+Arrow` is what Windows itself uses for snapping, and
 * `Alt+\`` is the second half of the platform's window switcher — both are the shortcuts a user
 * already has in their fingers, which is why they are the defaults despite colliding with some OS
 * window managers. Every one of them is rebindable, and `keymap: { enabled: false }` removes them.
 *
 * The quarters are the four corners walked clockwise from the top-left, where the arrow names the
 * edge you travel along to reach the next one: up to the top-left, right to the top-right, down to
 * the bottom-right, left to the bottom-left.
 */
const DEFAULT_BINDINGS: Record<KeymapAction, string> = {
  snapLeft: 'Meta+ArrowLeft',
  snapRight: 'Meta+ArrowRight',
  snapMax: 'Meta+ArrowUp',
  snapNone: 'Meta+ArrowDown',
  snapTopLeft: 'Meta+Shift+ArrowUp',
  snapTopRight: 'Meta+Shift+ArrowRight',
  snapBottomRight: 'Meta+Shift+ArrowDown',
  snapBottomLeft: 'Meta+Shift+ArrowLeft',
  focusNext: 'Alt+Backquote',
  focusPrev: 'Alt+Shift+Backquote',
}

/** The zone each snap action asks for. `snapNone` gives the window its pre-snap geometry back. */
export const KEYMAP_ZONES: Record<SnapAction, SnapZone | 'none'> = {
  snapLeft: 'left',
  snapRight: 'right',
  snapMax: 'max',
  snapNone: 'none',
  snapTopLeft: 'top-left',
  snapTopRight: 'top-right',
  snapBottomLeft: 'bottom-left',
  snapBottomRight: 'bottom-right',
}

const KEYMAP_ACTIONS = Object.keys(DEFAULT_BINDINGS) as KeymapAction[]

/** The half of the keymap that asks the store to snap; the rest switches windows. */
export type SnapAction = Exclude<KeymapAction, 'focusNext' | 'focusPrev'>

export function isSnapAction(action: KeymapAction): action is SnapAction {
  return action !== 'focusNext' && action !== 'focusPrev'
}

/** `'Meta+Shift+ArrowUp'` → the chord. Modifier order and case are both free. */
function parseChord(chord: string): KeyChord | null {
  const parts = chord
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  const key = parts.pop()
  if (!key) return null
  const out: KeyChord = { key: key.toLowerCase(), meta: false, ctrl: false, alt: false, shift: false }
  for (const part of parts) {
    switch (part.toLowerCase()) {
      case 'meta':
      case 'cmd':
      case 'super':
      case 'win':
        out.meta = true
        break
      case 'ctrl':
      case 'control':
        out.ctrl = true
        break
      case 'alt':
      case 'option':
        out.alt = true
        break
      case 'shift':
        out.shift = true
        break
      default:
        return null
    }
  }
  return out
}

function chordsFor(value: string | string[] | null | undefined, fallback: string): KeyChord[] {
  if (value === null) return []
  const list = value === undefined ? [fallback] : Array.isArray(value) ? value : [value]
  const out: KeyChord[] = []
  for (const chord of list) {
    const parsed = parseChord(chord)
    if (parsed) out.push(parsed)
    else if (import.meta.env?.DEV) console.warn(`[vue-windows] unreadable key binding "${chord}"`)
  }
  return out
}

export function resolveKeymap(keymap: KeymapOptions | undefined): ResolvedKeymap {
  const bindings = {} as Record<KeymapAction, KeyChord[]>
  for (const action of KEYMAP_ACTIONS) {
    bindings[action] = chordsFor(keymap?.bindings?.[action], DEFAULT_BINDINGS[action])
  }
  return { enabled: keymap?.enabled ?? true, bindings }
}

/**
 * The action a keystroke asks for, or null. Modifiers must match exactly, so an unbound
 * `Meta+Shift+ArrowLeft` never falls through to the `Meta+ArrowLeft` binding, and `event.code` is
 * accepted alongside `event.key` so a chord survives a layout where Alt produces a dead key.
 */
export function matchKeymap(e: KeyboardEvent, keymap: ResolvedKeymap): KeymapAction | null {
  if (!keymap.enabled) return null
  const key = e.key?.toLowerCase()
  const code = e.code?.toLowerCase()
  for (const action of KEYMAP_ACTIONS) {
    for (const c of keymap.bindings[action]) {
      if (c.key !== key && c.key !== code) continue
      if (c.meta === e.metaKey && c.ctrl === e.ctrlKey && c.alt === e.altKey && c.shift === e.shiftKey) {
        return action
      }
    }
  }
  return null
}

export function resolveOptions(options: WindowsOptions): ResolvedOptions {
  const components = options.components ?? {}
  const cache = new Map<string, Component>()
  const insets = options.snap?.insets
  const globalAsync: AsyncWindowOptions = options.async ?? {}

  // Stripped once at install, so open() and hydration both read a plain defaults object, and the
  // async keys never travel towards the descriptor.
  const defaults: Record<string, WindowDefaults> = {}
  const asyncOptions: Record<string, AsyncWindowOptions> = {}
  for (const [name, entry] of Object.entries(components)) {
    if (!isSpec(entry)) continue
    const { component, ...rest } = entry
    void component
    const async: AsyncWindowOptions = {}
    for (const key of ASYNC_KEYS) {
      if (rest[key] === undefined) continue
      Object.assign(async, { [key]: rest[key] })
      delete rest[key]
    }
    // The `result` marker exists only so `open()` can infer what the window settles with; whatever
    // value carries it is never read, and must not travel on towards the descriptor.
    delete rest.result
    defaults[name] = rest
    asyncOptions[name] = async
  }

  /** Per-type over app-wide, key by key: a spec that sets only `timeout` keeps the global spinner. */
  function asyncFor(name: string): AsyncWindowOptions {
    return { ...globalAsync, ...asyncOptions[name] }
  }

  return {
    components,
    persist: options.persist ?? null,
    maxWindows: options.maxWindows ?? 8,
    bounds: { minVisible: options.bounds?.minVisible ?? 80 },
    snap: {
      enabled: options.snap?.enabled ?? true,
      edge: options.snap?.edge ?? 12,
      corner: options.snap?.corner ?? 100,
      insets: {
        top: insets?.top ?? 0,
        right: insets?.right ?? 0,
        bottom: insets?.bottom ?? 0,
        left: insets?.left ?? 0,
      },
    },
    mobileBreakpoint: options.mobileBreakpoint ?? 768,
    zIndexBase: options.zIndexBase ?? 0,
    beforeClose: options.beforeClose ?? null,
    keymap: resolveKeymap(options.keymap),
    resolve(name) {
      const cached = cache.get(name)
      if (cached) return cached

      const entry = components[name]
      if (!entry) throw new Error(`[vue-windows] unknown window "${name}"`)
      const source = isSpec(entry) ? entry.component : entry

      // A bare function is a loader — plain functional components must be wrapped
      // in defineComponent so they carry component options.
      const resolved =
        typeof source === 'function' && !('render' in source) && !('setup' in source)
          ? defineAsyncComponent({ loader: source as () => Promise<Component>, ...asyncFor(name) })
          : (source as Component)

      cache.set(name, resolved)
      return resolved
    },
    defaultsFor(name) {
      return defaults[name] ?? NO_DEFAULTS
    },
    errorComponentFor(name) {
      return asyncFor(name).errorComponent ?? null
    },
  }
}
