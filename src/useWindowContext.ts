import { inject, onScopeDispose, provide } from 'vue'
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

export function useWindowContext(): WindowContext {
  const ctx = inject(WINDOW_CTX_KEY, null)
  if (!ctx) throw new Error('[vue-windows] useWindowContext() called outside a window')
  return ctx
}
