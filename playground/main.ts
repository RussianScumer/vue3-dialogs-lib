import { createApp } from 'vue'
import App from './App.vue'
import { createWindows } from '../src'
import { components } from './components'
import WindowError from './windows/WindowError.vue'
import { log } from './eventLog'
import '../src/style.css'

createApp(App)
  .use(
    createWindows({
      components,
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
