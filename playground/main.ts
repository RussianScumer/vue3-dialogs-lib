import { createApp } from 'vue'
import App from './App.vue'
import { createWindows } from '../src'
import { components } from './components'
import WindowError from './windows/WindowError.vue'
import { log } from './eventLog'
import '../src/style.css'
import '../src/themes/all.css'

createApp(App)
  .use(
    createWindows({
      components,
      persist: {
        key: 'playground:windows',
        storage: localStorage,
        // Open this page in a second tab to see it: whichever tab does not write last stops
        // persisting and says so. Resuming is opt-in because it hydrates — the other tab's
        // windows replace this tab's, drafts included.
        // Deliberately not confirm(): a modal blocks the page, and the point of the default is
        // that nothing happens until the consumer asks for it. Call __vwResume() from the console
        // to adopt the other tab's snapshot and start writing again.
        onExternalChange: (info) => {
          log(`another tab wrote ${info.key} — this tab stopped persisting; __vwResume() to adopt it`)
          Object.assign(window, {
            __vwResume: () => {
              info.resume()
              log('adopted the other tab’s snapshot and resumed persisting')
            },
          })
        },
      },
      // App-wide fallback: any window type that does not name its own error component gets this.
      async: { errorComponent: WindowError },
      maxWindows: 8,
      // The taskbar below is 33px tall and fixed: snapped windows must not hide under it.
      snap: { insets: { bottom: 36 } },
      // The page header is at z-index 100; windows have to clear it.
      zIndexBase: 1000,
      // The library ships no strings, so the glyph controls have no accessible name until an app
      // gives them one. In dev an app that gives none is warned about, once.
      labels: { minimize: 'Minimize window', close: 'Close window', pin: 'Keep window on top' },
      // The whole el-dialog shape as one named bundle: the call site says `{ preset: 'dialog' }`
      // and nothing else. A preset outranks the component's own spec and loses to the options of
      // the call that named it.
      presets: {
        dialog: { modal: true, placement: 'center', w: 420, h: 260, draggable: false, resizable: false },
      },
      // The scrim stops the pointer; nothing stops Tab. This is the opt-in that does. It names the
      // wrapper around everything *except* WindowHost — an ancestor of the windows would make the
      // modal itself inert, since `inert` covers a subtree, and the library warns and ignores one.
      modal: { inertRoot: '.desktop' },
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
