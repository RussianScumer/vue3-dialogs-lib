import { defineAsyncComponent, type Component } from 'vue'
import type {
  AsyncWindowOptions,
  ResolvedOptions,
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
