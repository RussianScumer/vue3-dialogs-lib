# Recipes

Every snippet below is a complete, working use case. The playground (`npm run dev`) runs cases
1–14 side by side.

## 1 · Install and mount

```js
// main.js
import { createApp } from 'vue'
import { createWindows } from 'vue-windows'
import 'vue-windows/style.css' // optional baseline
import App from './App.vue'

createApp(App)
  .use(createWindows({
    components: {
      itemEditor: () => import('./windows/ItemEditor.vue'),
      logViewer: () => import('./windows/LogViewer.vue'),
    },
    persist: { key: 'app:windows', storage: localStorage }, // omit to disable
    maxWindows: 8,
    bounds: { minVisible: 80 },
    mobileBreakpoint: 768,
  }))
  .mount('#app')
```

```vue
<!-- App.vue — mount the host once, above the router outlet -->
<template>
  <router-view />
  <WindowHost />
</template>

<script setup>
import { WindowHost } from 'vue-windows'
</script>
```

## 2 · Open a window

```js
import { useWindows } from 'vue-windows'

const win = useWindows()
const id = win.open('itemEditor', { id: 42 }, { title: 'Item 42', w: 720, h: 520 })
```

`open(name, props, options)` returns the window id. `options` takes `title`, `x`, `y`, `w`, `h`
and `meta`; anything omitted cascades or falls back to 640×480.

Calling it again with the same `name` and shallow-equal `props` does **not** open a second window —
it restores and raises the existing one and returns the same id. That is what makes "one window per
entity" free:

```js
win.open('itemEditor', { id: 42 })  // opens
win.open('itemEditor', { id: 42 })  // same window, raised
win.open('itemEditor', { id: 43 })  // a different entity, a second window
```

## 3 · Open from outside a component

`useWindows()` works in plain modules, route guards and service files:

```js
// notifications.js
import { useWindows } from 'vue-windows'

export function onServerAlert(alert) {
  useWindows().open('logViewer', { source: alert.source }, { title: `Alert ${alert.id}` })
}
```

## 4 · Write a window's content

`WindowHost` passes the descriptor's `props` plus a `windowId` to your component.

```vue
<script setup>
import { useWindowContext } from 'vue-windows'

const props = defineProps({ id: Number, windowId: String })
const { setTitle, minimize, close, descriptor, isRestored } = useWindowContext()

setTitle(`Item ${props.id}`)
</script>

<template>
  <p>Editing item {{ props.id }}</p>
  <button @click="minimize()">Minimize</button>
  <button @click="close()">Done</button>
</template>
```

## 5 · Draft state that survives minimize and reload

Minimized means unmounted, so local `ref`s are gone. Put the draft on the descriptor:

```vue
<script setup>
import { useWindowState } from 'vue-windows'

const props = defineProps({ windowId: String })

const form = useWindowState(props.windowId, () => ({ name: '', note: '' }))
</script>

<template>
  <input v-model="form.name" />
  <textarea v-model="form.note" />
</template>
```

`form` is reactive, is part of the persisted descriptor, and must stay JSON-serializable.

## 6 · Fetch your own data, and handle a stale draft

A window outlives the view that opened it, so its props are **ids and primitives only** and the
content fetches for itself. On a restored mount, the server may have moved on:

```vue
<script setup>
import { onMounted, ref } from 'vue'
import { useWindowContext, useWindowState } from 'vue-windows'

const props = defineProps({ id: Number, windowId: String })
const form = useWindowState(props.windowId, () => ({ name: '' }))
const { descriptor, isRestored } = useWindowContext()

const conflict = ref(false)
const server = ref(null)

onMounted(async () => {
  const item = await api.get(`/items/${props.id}`)

  if (!isRestored) {
    // fresh open: seed the draft and remember the version it started from
    form.name = item.name
    descriptor.meta.version = item.version
    return
  }

  // restored draft: compare against what the server has now
  server.value = item
  conflict.value = item.version !== descriptor.meta.version
})

function takeServerCopy() {
  form.name = server.value.name
  descriptor.meta.version = server.value.version
  conflict.value = false
}
</script>

<template>
  <p v-if="conflict">
    This item changed while your draft was minimized.
    <button @click="conflict = false">Keep my draft</button>
    <button @click="takeServerCopy">Take the server copy</button>
  </p>
</template>
```

The library gives you `meta` and `isRestored` and stops there — it never fetches, so it cannot
resolve the conflict for you.

## 7 · A taskbar of your own design

`WindowTaskbar` renders nothing itself:

```vue
<WindowTaskbar v-slot="{ windows, restore, close }">
  <div v-if="windows.length" class="taskbar">
    <button v-for="w in windows" :key="w.id" @click="restore(w.id)">
      {{ w.title || w.name }}
      <span role="button" aria-label="Close window" @click.stop="close(w.id)">✕</span>
    </button>
  </div>
</WindowTaskbar>
```

`windows` is the minimized set (full descriptors, so `w.meta` and `w.state` are available for
badges or unsaved-changes markers). For an actual taskbar — every window, with the focused one
marked — use `all` and `active` instead:

```vue
<WindowTaskbar v-slot="{ all, active, restore, focus, requestClose }">
  <div v-if="all.length" class="taskbar">
    <button
      v-for="w in all"
      :key="w.id"
      :class="{ active: w.id === active, minimized: w.minimized }"
      @click="w.minimized ? restore(w.id) : focus(w.id)"
    >
      {{ w.title || w.name }}
      <span role="button" aria-label="Close window" @click.stop="requestClose(w.id)">✕</span>
    </button>
  </div>
</WindowTaskbar>
```

`requestClose` runs the guards; `close` does not.

## 8 · Custom header and control buttons

The library ships no strings, so labels and `aria-label`s are yours. Both slots pass the
descriptor and apply to every window:

```vue
<script setup>
import { WindowHost, useWindows } from 'vue-windows'

const win = useWindows()
</script>

<template>
<WindowHost>
  <template #header="{ descriptor }">
    <img :src="iconFor(descriptor.name)" alt="" width="16" />
    <strong>{{ descriptor.title }}</strong>
    <input v-model="descriptor.meta.search" data-vw-nodrag placeholder="Filter…" />
  </template>

  <template #controls="{ descriptor }">
    <button aria-label="Minimize window" @click="win.minimize(descriptor.id)">–</button>
    <button aria-label="Close window" @click="win.close(descriptor.id)">✕</button>
  </template>
</WindowHost>
</template>
```

`data-vw-nodrag` on any element in the header stops it from starting a drag, so inputs and buttons
behave normally.

## 9 · Restyle it

`style.css` is cosmetics only, and it only ever *reads* the `--vtd-*` properties. Set them at any
level above the windows — nothing in the library declares them on `.vw`, so no specificity fight:

```css
:root {
  --vtd-font: system-ui, sans-serif;
  --vtd-font-size: 14px;
  --vtd-radius: 2px;
  --vtd-border: 2px solid #4338ca;
  --vtd-shadow: 0 12px 40px rgba(67, 56, 202, 0.45);
  --vtd-bg: #fff;
  --vtd-fg: #111;
  --vtd-accent: #4338ca; /* header focus ring */
  --vtd-head-bg: #4338ca;
  --vtd-head-fg: #fff;
  --vtd-head-pad: 6px 8px;
  --vtd-body-pad: 12px;
  --vtd-btn-hover-bg: rgba(255, 255, 255, 0.2);
}

/* a theme class works the same way — plain inheritance */
.theme-dark { --vtd-bg: #0b1120; --vtd-head-bg: #020617; }

/* per window type, via the name you registered */
.vw:has(.log-viewer) { --vtd-head-bg: #0f172a; }
```

Anything left unset keeps the library default, so an app can theme two properties and inherit the
rest — dark-mode defaults included. Switching a theme at runtime is
`document.documentElement.style.setProperty('--vtd-head-bg', '#4338ca')`; removing the property
restores the default.

Skip the import entirely and windows still work — layout and positioning are inline.

## 10 · Let ESC belong to your content

ESC minimizes the focused window. A component that needs ESC for its own dropdown takes it first:

```vue
<script setup>
function onKeydown(e) {
  if (e.key === 'Escape' && open.value) {
    e.preventDefault()   // the window stays open
    open.value = false
  }
}
</script>

<template>
  <div @keydown="onKeydown">…</div>
</template>
```

## 11 · Persist somewhere other than localStorage

`storage` is any `{ getItem, setItem, removeItem }`:

```js
// per-tab instead of per-browser
persist: { key: 'app:windows', storage: sessionStorage }
```

```js
// server-backed, write-through with a cached read
const remote = {
  cache: localStorage.getItem('app:windows'),
  getItem() { return this.cache },
  setItem(key, value) {
    this.cache = value
    localStorage.setItem(key, value)
    navigator.sendBeacon('/api/layout', value)
  },
  removeItem(key) { this.cache = null; localStorage.removeItem(key) },
}

createWindows({ components, persist: { key: 'app:windows', storage: remote } })
```

Writes are debounced ~300ms, so a network adapter is not hammered per keystroke.

## 12 · Close everything on logout

```js
import { useWindows } from 'vue-windows'

export function logout() {
  useWindows().closeAll()             // drafts of the previous user are gone
  localStorage.removeItem('app:windows')
  router.push('/login')
}
```

`closeAll()` clears the stack; removing the storage key stops the layout coming back on reload.

## 13 · Drive the stack yourself

```js
const win = useWindows()

win.s.stack        // all descriptors, in creation order
win.visible.value  // non-minimized
win.minimized.value
win.byId(id)

win.focus(id)
win.setTitle(id, 'New title')
win.setGeometry(id, { x: 0, y: 0, w: 900, h: 600 })
win.clampAll({ w: window.innerWidth, h: window.innerHeight })
win.isRestored(id)
```

Example — a "tile everything" button, since the library ships no tiling:

```js
function tile() {
  const open = win.visible.value
  const w = Math.floor(window.innerWidth / open.length)
  open.forEach((d, i) => win.setGeometry(d.id, { x: i * w, y: 0, w, h: window.innerHeight }))
}
```

## 14 · Test windows in your own app

The store is DOM-free, so most assertions need no browser:

```js
import { createWindows, useWindows } from 'vue-windows'
import { mount } from '@vue/test-utils'

const plugin = createWindows({ components: { editor: ItemEditor } })
const wrapper = mount(App, { global: { plugins: [plugin] } })
const win = useWindows()

const id = win.open('editor', { id: 1 })
win.minimize(id)
await nextTick()
expect(wrapper.find('dialog.vw').exists()).toBe(false)   // content really unmounted
```

In jsdom, `HTMLDialogElement.show()` is missing — add a two-line shim in a setup file (see
`src/__tests__/setup.ts`) or run the suite in a real browser.

## 15 · Refuse to close a window with an unsaved draft

Two guards, and both have to pass. The per-window one lives in the content, so it is the natural
place for "is this form dirty":

```vue
<script setup>
const { onBeforeClose } = useWindowContext()
const form = useWindowState(props.windowId, () => ({ name: '' }))

onBeforeClose(() => !form.name || confirm('Discard the draft?'))
</script>
```

It unregisters when the content unmounts — which is what minimizing does. A minimized window is
therefore covered only by the app-wide guard, which sees the descriptor and its saved draft:

```js
createWindows({
  components,
  beforeClose: (d) => !d.state?.name || confirm(`Discard the draft in ${d.title}?`),
})
```

Guards run on `requestClose(id)` and on the ✕ button. They are deliberately *not* run by
`close(id)`, `closeAll()`, or `maxWindows` eviction — a logout must not be blockable, and the
eviction is silent by design. If losing the oldest window's draft matters, raise `maxWindows` or
watch for it:

```js
win.on('close', (e) => saveDraftSomewhere(e.id))
```

## 16 · Give a window type its own defaults

Repeating the same size and flags at every call site is the failure mode. Put them on the
component instead:

```js
createWindows({
  components: {
    itemEditor: { component: () => import('./windows/ItemEditor.vue'), w: 720, h: 520, minW: 320 },
    confirmBox: { component: ConfirmBox, w: 380, h: 180, resizable: false, minimizable: false },
    logViewer: () => import('./windows/LogViewer.vue'),   // bare component: library defaults
  },
})
```

`open()` options still win over these, and these win over the library's. Because the flags end up
on the descriptor, they survive a reload with the window.

## 17 · Type-check `open()` against your components

```ts
// windows.ts
import { useWindows } from 'vue-windows'

export const components = {
  itemEditor: () => import('./windows/ItemEditor.vue'), // defineProps<{ id: number }>()
  logViewer: () => import('./windows/LogViewer.vue'),
}
export const useAppWindows = () => useWindows<typeof components>()
```

```ts
import { useAppWindows } from './windows'

const win = useAppWindows()
win.open('itemEditor', { id: 42 })  // ok
win.open('itemEditor', { id: 'x' }) // error
win.open('typo', {})                // error
```

Import the alias everywhere; a bare `useWindows()` has no map to check against. `windowId` is
supplied by the host and must not be passed. This is a types-only feature — the runtime call is
identical, and a window whose props cannot be inferred simply falls back to
`Record<string, unknown>`.

## 18 · React to window transitions

```js
const off = win.on('*', (e) => analytics.track(`window:${e.type}`, { id: e.id }))
// 'open' | 'close' | 'focus' | 'minimize' | 'restore' | 'geometry' | 'title' | '*'
```

Events cover store transitions only. A draft mutation and a drag frame write straight onto the
descriptor without passing through a store method, so neither emits — if you need those, watch the
descriptor yourself.
