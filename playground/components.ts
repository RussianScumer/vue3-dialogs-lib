import WindowLoading from './windows/WindowLoading.vue'
import type { SavedItem } from './types'

/**
 * The window types this playground registers. A module of its own so the same map types
 * `useWindows<typeof components>()` at every call site — the prop check, and now the result of
 * `open()` too — and so `typed-open.type-test.ts` checks the real map rather than a copy of it.
 */
export const components = {
  // A spec rather than a bare loader for one reason: the `result` marker, which is what makes
  // `open('itemEditor').result` settle with a SavedItem instead of `unknown`. Nothing reads the
  // value — the key is stripped before it can reach the descriptor.
  itemEditor: {
    component: () => import('./windows/ItemEditor.vue'),
    result: null as unknown as SavedItem,
  },
  // A spec instead of a bare loader: every log viewer opens with these, no options needed
  // at the call site, and they persist on the descriptor.
  logViewer: {
    component: () => import('./windows/LogViewer.vue'),
    w: 380,
    h: 300,
    minW: 260,
    minH: 180,
    maxH: 520,
  },
  popperDemo: () => import('./windows/PopperDemo.vue'),
  longDoc: () => import('./windows/LongDoc.vue'),
  // A slow chunk with its own spinner: the frame is usable before the content exists.
  slowPanel: {
    component: () =>
      new Promise<typeof import('./windows/SlowPanel.vue')>((resolve) => {
        setTimeout(() => resolve(import('./windows/SlowPanel.vue')), 1500)
      }),
    loadingComponent: WindowLoading,
    delay: 0,
    w: 380,
    h: 220,
  },
  // A loader that never settles, given a deadline: after it, the app-wide errorComponent.
  hungPanel: {
    component: () => new Promise<never>(() => {}),
    loadingComponent: WindowLoading,
    delay: 0,
    timeout: 2000,
    w: 380,
    h: 220,
  },
  // The confirm an ItemEditor's close guard asks with: opened as an owned child of the window
  // asking the question, so it is never persisted and closes with its owner. Its answer is its
  // result — a boolean — which is why the sheet needs no callback prop.
  confirmSheet: {
    component: () => import('./windows/ConfirmSheet.vue'),
    w: 320,
    h: 190,
    result: null as unknown as boolean,
  },
  // The chunk arrives; the component throws on mount.
  brokenPanel: { component: () => import('./windows/BrokenPanel.vue'), w: 380, h: 220 },
}
