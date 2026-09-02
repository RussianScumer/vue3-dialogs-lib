import type { InjectionKey } from 'vue'
import type { WindowsApi } from './state'
import type { ResolvedOptions, Viewport, WindowDescriptor } from './types'

export const WINDOWS_KEY: InjectionKey<WindowsApi> = Symbol('vue-windows')
export const OPTIONS_KEY: InjectionKey<ResolvedOptions> = Symbol('vue-windows:options')
/** One viewport tracker per app, created by the plugin — see useViewport. */
export const VIEWPORT_KEY: InjectionKey<Viewport> = Symbol('vue-windows:viewport')

export interface WindowContext {
  descriptor: WindowDescriptor
  setTitle(title: string): void
  minimize(): void
  /** Unconditional. Guards live on requestClose. */
  close(): void
  /** Runs this window's guard, then the app-wide one. False means the window stayed open. */
  requestClose(): Promise<boolean>
  /**
   * Veto a requestClose while this content is mounted — the unsaved-draft hook. Unregisters
   * automatically, so a minimized (and therefore unmounted) window is covered only by the
   * app-wide `beforeClose` option.
   */
  onBeforeClose(guard: () => boolean | Promise<boolean>): void
  /** True when this mount came from a persisted descriptor, not a fresh open(). */
  isRestored: boolean
}

export const WINDOW_CTX_KEY: InjectionKey<WindowContext> = Symbol('vue-windows:window')
