import { inject, onScopeDispose, reactive } from 'vue'
import { VIEWPORT_KEY } from './injection'
import type { Viewport } from './types'

/**
 * The app's single viewport tracker. Created once by the plugin inside its effect scope, never by
 * a consumer — one listener regardless of how many windows are open. SSR-safe.
 */
export function createViewport(): Viewport {
  const view = reactive<Viewport>({
    w: typeof window === 'undefined' ? 1024 : window.innerWidth,
    h: typeof window === 'undefined' ? 768 : window.innerHeight,
  })
  if (typeof window === 'undefined') return view

  const onResize = () => {
    view.w = window.innerWidth
    view.h = window.innerHeight
  }
  window.addEventListener('resize', onResize)
  onScopeDispose(() => window.removeEventListener('resize', onResize))
  return view
}

/** Internal: reads the tracker the plugin provided. Only ever called from inside a window. */
export function useViewport(): Viewport {
  const view = inject(VIEWPORT_KEY, null)
  if (!view) throw new Error('[vue-windows] plugin not installed — call app.use(createWindows({ ... })) first')
  return view
}
