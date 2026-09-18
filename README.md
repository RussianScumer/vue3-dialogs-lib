# @korneevec/vue3-dialogs-lib

[![npm](https://img.shields.io/npm/v/%40korneevec%2Fvue3-dialogs-lib)](https://www.npmjs.com/package/@korneevec/vue3-dialogs-lib)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/LICENSE)

**English** · [Русский](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/README_ru.md)

A window manager for Vue 3, built on the native `<dialog>` element, with no runtime dependency
beyond Vue itself.

A window here is **a serializable descriptor in a store**, not a boolean owned by the component
that opened it. So a window outlives its opener: it can be minimized and picked up again from
anywhere in the app, it remembers where it was on screen, it costs nothing while minimized (its
content is unmounted, not hidden), and with persistence on it survives a page reload.

## Features

- **Native `<dialog>`, non-modal by default** — several windows at once, the page behind stays
  usable, teleported poppers from your own components keep working.
- **Minimize = unmount.** A minimized window keeps its descriptor and draft state, and nothing else.
- **Drag, resize from eight grips, keyboard nudging**, min/max size limits, viewport clamping,
  fullscreen below a mobile breakpoint.
- **Edge snapping** like a desktop: halves, quarters, maximize, a ghost preview, and a rebindable
  keymap for snapping and window switching.
- **Persistence** to any `{ getItem, setItem, removeItem }` storage, with a schema check, repair
  of partial descriptors and a guard against two tabs writing the same key.
- **Close guards** — app-wide and per window, sync or async — behind `requestClose()`.
- **Window results**: `open()` returns a promise for what the window settled with, and it never
  hangs.
- **Owned child windows**, **modal windows** with a scrim and an `inert` sweep, **pinned**
  (always-on-top) windows, and named **presets**.
- **Typed `open()`** — window names and props checked against your components map.
- **Async loading and error states** per window type, with failure contained to one window.
- **Works without a stylesheet.** Layout is inline; `style.css` is cosmetics, restyled through
  `--vtd-*` tokens, plus 22 ready-made colour themes.
- **SSR-safe**, zero runtime dependencies, no user-facing strings baked in.

## Install

```sh
pnpm add @korneevec/vue3-dialogs-lib
# or: npm install @korneevec/vue3-dialogs-lib
```

Vue 3.5 or newer is the only requirement (a peer dependency). The stylesheet is optional: without
it the windows are unstyled but fully functional.

## Quick start

Register your window components once and mount the host above the router outlet:

```js
// main.js
import { createWindows } from '@korneevec/vue3-dialogs-lib'
import '@korneevec/vue3-dialogs-lib/style.css' // optional

app.use(createWindows({
  components: {
    itemEditor: () => import('./windows/ItemEditor.vue'),
    logViewer: () => import('./windows/LogViewer.vue'),
  },
  persist: { key: 'app:windows', storage: localStorage }, // omit to disable
  labels: { minimize: 'Minimize', close: 'Close', pin: 'Keep on top' },
}))
```

```vue
<!-- App.vue -->
<router-view />
<WindowHost />
<WindowTaskbar v-slot="{ all, active, restore, focus, close }">
  <button
    v-for="w in all"
    :key="w.id"
    :class="{ active: w.id === active }"
    @click="w.minimized ? restore(w.id) : focus(w.id)"
  >
    {{ w.title }}
    <span @click.stop="close(w.id)">✕</span>
  </button>
</WindowTaskbar>
```

`WindowTaskbar` renders no markup of its own — the visual is entirely yours.

Open windows from anywhere, inside or outside `setup()`:

```js
import { useWindows } from '@korneevec/vue3-dialogs-lib'

const win = useWindows()
const { id, result } = win.open('itemEditor', { id: 42 }, { title: 'Item 42', w: 720, h: 520 })

win.minimize(id)
win.restore(id)
await win.requestClose(id)   // runs the close guards; false if one refused
const saved = await result   // { ok: true, data } | { ok: false, reason: 'closed' | 'restored' }
```

Inside a window's content:

```vue
<script setup>
import { useWindowState, useWindowContext } from '@korneevec/vue3-dialogs-lib'

const props = defineProps({ id: Number, windowId: String })

// draft state that survives minimize (unmount) and page reload
const form = useWindowState(props.windowId, () => ({ name: '', note: '' }))

const { setTitle, onBeforeClose, resolve, dismiss } = useWindowContext()
setTitle(`Item ${props.id}`)
onBeforeClose(() => !form.name || confirm('Discard the draft?'))
</script>
```

Modal question, answered by its result:

```js
const answer = await win.open('confirm', { message }, { modal: true, placement: 'center' }).result
if (answer.ok) proceed()
```

## Documentation

| English | Русский | |
| --- | --- | --- |
| [API reference](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/api.md) | [Справочник API](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/api_ru.md) | every option, method and behaviour |
| [Window modes](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/window-modes.md) | [Режимы окон](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/window-modes_ru.md) | plain, restricted, pinned, owned sheet, modal — with what survives a reload |
| [How it works](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/how-it-works.md) | [Как это работает](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/how-it-works_ru.md) | the descriptor model, render path, geometry, persistence |
| [Recipes](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/recipes.md) | [Рецепты](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/recipes_ru.md) | complete use cases with code |
| [Motion](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/motion.md) | [Анимация](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/motion_ru.md) | frame lifecycle, replacing the animation, fly-to-taskbar |
| [Performance](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/performance.md) | [Производительность](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/performance_ru.md) | benchmarks and what they imply |
| [Build and pack](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/build.md) | [Сборка и упаковка](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/build_ru.md) | pnpm setup, `dist/`, publishing |

## Non-goals

`showModal()` and the browser top layer, a focus-trap loop, confirm/alert helpers, data fetching or
staleness resolution, cross-device layout sync, tiling window management, and a bundled design
system. Modal windows are the narrow reading of the first two: an opt-in scrim and an `inert`
sweep, per window.

## Development

```sh
pnpm install
pnpm dev              # playground at playground/
pnpm exec vitest run  # unit (jsdom) + browser (Playwright Chromium) projects
pnpm bench            # benchmarks
pnpm lint && pnpm type-check
pnpm build            # dist/
pnpm pack             # local tarball; prepack rebuilds dist/ first
```

The browser test project needs Chromium once: `pnpm exec playwright install chromium`.

## License

[MIT](./LICENSE)
