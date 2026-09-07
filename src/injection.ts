import type { ComputedRef, InjectionKey } from 'vue'
import type { WindowsApi } from './state'
import type { ResolvedOptions, Viewport, WindowDescriptor } from './types'

export const WINDOWS_KEY: InjectionKey<WindowsApi> = Symbol('vue3-dialogs-lib')
export const OPTIONS_KEY: InjectionKey<ResolvedOptions> = Symbol('vue3-dialogs-lib:options')
/** One viewport tracker per app, created by the plugin — see useViewport. */
export const VIEWPORT_KEY: InjectionKey<Viewport> = Symbol('vue3-dialogs-lib:viewport')

export interface WindowContext<T = unknown> {
  descriptor: WindowDescriptor
  setTitle(title: string): void
  minimize(): void
  /** Unconditional. Guards live on requestClose. */
  close(): void
  /** Runs this window's guard, then the app-wide one. False means the window stayed open. */
  requestClose(): Promise<boolean>
  /**
   * True while a `requestClose` for this window is waiting on its guards — the pending state to
   * render on a confirm button. Runtime-only: it is not on the descriptor and never persists.
   */
  closing: ComputedRef<boolean>
  /**
   * Veto a requestClose while this content is mounted — the unsaved-draft hook. Unregisters
   * automatically, so a minimized (and therefore unmounted) window is covered only by the
   * app-wide `beforeClose` option.
   */
  onBeforeClose(guard: () => boolean | Promise<boolean>): void
  /**
   * Settle this window's result with a value and close it — the "the editor saved the entity"
   * path, and the reason `open()` returns a promise at all. Unconditional, like `close()`: the
   * content has just decided, so its own guard has nothing left to ask about.
   *
   * `useWindowContext<SavedItem>()` types the argument; without a type argument it is `unknown`.
   */
  resolve(data: T): void
  /**
   * Settle the result as `{ ok: false, reason: 'closed' }` and close — the explicit "the user said
   * no" to `resolve()`'s yes. Identical to `close()`, which settles the same way: `dismiss()` is
   * the name that says the answer was deliberate.
   */
  dismiss(): void
  /** True when this mount came from a persisted descriptor, not a fresh open(). */
  isRestored: boolean
}

export const WINDOW_CTX_KEY: InjectionKey<WindowContext> = Symbol('vue3-dialogs-lib:window')
