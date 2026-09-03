import { createApp } from 'vue'
import App from './App.vue'
import { createWindows } from '../src'
import WindowError from './windows/WindowError.vue'
import WindowLoading from './windows/WindowLoading.vue'
import { log } from './eventLog'
import '../src/style.css'

createApp(App)
  .use(
    createWindows({
      components: {
        itemEditor: () => import('./windows/ItemEditor.vue'),
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
        // The chunk arrives; the component throws on mount.
        brokenPanel: { component: () => import('./windows/BrokenPanel.vue'), w: 380, h: 220 },
      },
      persist: { key: 'playground:windows', storage: localStorage },
      // App-wide fallback: any window type that does not name its own error component gets this.
      async: { errorComponent: WindowError },
      maxWindows: 8,
      // The taskbar below is 33px tall and fixed: snapped windows must not hide under it.
      snap: { insets: { bottom: 36 } },
      // The page header is at z-index 100; windows have to clear it.
      zIndexBase: 1000,
      // The app-wide guard is the only one a minimized window has — its content, and therefore its
      // own onBeforeClose, is unmounted. Deliberately not confirm(): a modal would block the page.
      beforeClose: (d) => {
        const draft = d.state as { name?: string } | null
        if (!d.minimized || !draft?.name) return true
        log(`app-wide beforeClose refused "${d.title}" — minimized with an unsaved draft`)
        return false
      },
    }),
  )
  .mount('#app')
