import { useWindows } from './createWindows'

/**
 * Draft state that survives minimize (which unmounts the content) and, with
 * persistence on, a page reload. Must be JSON-serializable.
 */
export function useWindowState<T extends object>(windowId: string, factory: () => T): T {
  const w = useWindows().byId(windowId)
  if (!w) throw new Error(`[vue3-dialogs-lib] useWindowState: no window "${windowId}"`)
  if (w.state == null) w.state = factory()
  return w.state as T
}
