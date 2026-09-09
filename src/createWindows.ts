import { effectScope, getCurrentInstance, inject, type App, type Plugin } from 'vue'
import { OPTIONS_KEY, VIEWPORT_KEY, WINDOWS_KEY } from './injection'
import { resolveOptions } from './options'
import { setupPersist } from './persist'
import { setupKeymap } from './useKeymap'
import { createStore, type TypedWindowsApi, type WindowsApi } from './state'
import { createViewport } from './useViewport'
import type { ComponentsMap, ResolvedOptions, WindowsOptions } from './types'

// Fallback for calls made outside setup(); inject() is still preferred and wins,
// so multiple app instances and SSR stay correct inside components.
let activeStore: WindowsApi | null = null
let activeOptions: ResolvedOptions | null = null

export function createWindows(userOptions: WindowsOptions): Plugin {
  const options = resolveOptions(userOptions)
  const store = createStore(options)

  return {
    install(app: App) {
      // Detached: the viewport listener, the keymap listener and the persistence watcher belong to
      // the app, not to whichever component happened to be rendering when install() ran.
      const scope = effectScope(true)
      const view = scope.run(() => {
        const v = createViewport()
        // Before persistence, so a hydration that lands here already has a real viewport to
        // clamp against — and because `placement: 'center'` is unanswerable without one.
        store.attachViewport(v)
        setupPersist(store, options)
        setupKeymap(store, options, v)
        return v
      })!

      app.provide(WINDOWS_KEY, store)
      app.provide(OPTIONS_KEY, options)
      app.provide(VIEWPORT_KEY, view)
      activeStore = store
      activeOptions = options

      app.onUnmount(() => {
        scope.stop()
        if (activeStore === store) activeStore = null
        if (activeOptions === options) activeOptions = null
      })
    },
  }
}

function notInstalled(): never {
  throw new Error('[vue3-dialogs-lib] plugin not installed — call app.use(createWindows({ ... })) first')
}

/**
 * Pass the components map as a type argument to get a checked `open()`:
 * `const useAppWindows = () => useWindows<typeof components>()`. The bare call is unchanged.
 */
export function useWindows(): WindowsApi
export function useWindows<C extends ComponentsMap>(): TypedWindowsApi<C>
export function useWindows(): WindowsApi {
  const store = (getCurrentInstance() ? inject(WINDOWS_KEY, null) : null) ?? activeStore
  return store ?? notInstalled()
}

export function useWindowOptions(): ResolvedOptions {
  const options = (getCurrentInstance() ? inject(OPTIONS_KEY, null) : null) ?? activeOptions
  return options ?? notInstalled()
}
