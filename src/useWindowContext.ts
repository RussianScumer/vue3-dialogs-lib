import { computed, inject, onScopeDispose, provide } from 'vue'
import { useWindows } from './createWindows'
import { WINDOW_CTX_KEY, type WindowContext } from './injection'
import type { WindowDescriptor } from './types'

export function provideWindowContext(d: WindowDescriptor): WindowContext {
  const win = useWindows()
  const ctx: WindowContext = {
    descriptor: d,
    setTitle: (title) => win.setTitle(d.id, title),
    minimize: () => void win.minimize(d.id),
    close: () => win.close(d.id),
    requestClose: () => win.requestClose(d.id),
    closing: computed(() => win.isClosing(d.id)),
    resolve: (data) => win.resolve(d.id, data),
    // `close()` already settles `{ ok: false, reason: 'closed' }`, so this is not a second path —
    // it is the one whose name says the window was answered rather than merely taken away.
    dismiss: () => win.close(d.id),
    onBeforeClose: (guard) => {
      // Registered from the content's setup, so it dies with the content — which is exactly the
      // documented limitation: a minimized window has no guard of its own.
      onScopeDispose(win.onBeforeClose(d.id, guard), true)
    },
    isRestored: win.isRestored(d.id),
  }
  provide(WINDOW_CTX_KEY, ctx)
  return ctx
}

/**
 * The window this content is rendered in. The type argument is what `resolve()` accepts — the same
 * value the opener awaits on `handle.result` — and defaults to `unknown`.
 */
export function useWindowContext<T = unknown>(): WindowContext<T> {
  const ctx = inject(WINDOW_CTX_KEY, null)
  if (!ctx) throw new Error('[vue-windows] useWindowContext() called outside a window')
  return ctx
}
