import { inject, onScopeDispose, reactive, ref, shallowRef, type Ref } from 'vue'
import { COARSE_POINTER_KEY, VIEWPORT_KEY } from './injection'
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
  if (!view) throw new Error('[vue3-dialogs-lib] plugin not installed — call app.use(createWindows({ ... })) first')
  return view
}

/**
 * Whether the primary pointer is a finger: `(pointer: coarse)`, followed live, since a tablet can
 * gain or lose a trackpad. Created once by the plugin next to the viewport tracker, for the same
 * reasons. False without a DOM or without `matchMedia`, which is the mouse-sized grip — exactly
 * what every window had before this existed.
 */
export function createCoarsePointer(): Readonly<Ref<boolean>> {
  const coarse = ref(false)
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return coarse

  const query = window.matchMedia('(pointer: coarse)')
  coarse.value = query.matches
  const onChange = (e: MediaQueryListEvent) => {
    coarse.value = e.matches
  }
  query.addEventListener('change', onChange)
  onScopeDispose(() => query.removeEventListener('change', onChange))
  return coarse
}

const MOUSE: Readonly<Ref<boolean>> = shallowRef(false)

/** Internal: the plugin's tracker, or a constant `false` for a frame mounted without one. */
export function useCoarsePointer(): Readonly<Ref<boolean>> {
  return inject(COARSE_POINTER_KEY, null) ?? MOUSE
}
