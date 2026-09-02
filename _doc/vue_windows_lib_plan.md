# Standalone Vue 3 window/dialog library

> Plan for a self-contained library to be built in a separate repository.
> Nothing in this repository is created, modified, or referenced by it.

## Context

Every dialog library on offer (`el-dialog`, `vue-final-modal`, PrimeVue `DynamicDialog`, Naive
`useModal`) models a dialog as a transient boolean owned by the component that opened it. That
model cannot express the thing actually wanted here: a dialog that **outlives its opener**, can be
minimized and picked up again from anywhere in the app, remembers where it was on screen, and
costs nothing while minimized.

None of them provide it because they all own positioning and lifecycle. So this is a library of
its own: a **window manager** for Vue 3, built on the native `<dialog>` element, with zero runtime
dependencies beyond Vue itself.

Core promise: **a window is a serializable descriptor in a store, not a component instance.**
Everything else — minimize, restore, persist, reopen after reload, taskbar — falls out of that.

## Design decisions

| Decision | Choice | Why |
|---|---|---|
| Primitive | Native `<dialog>` | Free `role=dialog`, ESC handling, focus restore, `::backdrop`. No dependency. |
| Modality | **Non-modal** (`.show()`) | Multiple windows at once, background usable, taskbar clickable. Trade: no top layer, library manages `z-index`. Upside: consumer's teleported poppers (select/date-picker dropdowns) keep working normally. |
| Minimized | Content **unmounted** | Zero cost while minimized — no watchers, timers, map or grid instances. |
| Window state | Store-backed, not component-local | Drafts survive unmount and reload. |
| State container | Own reactive module, **not pinia** | A library must not force a state-management dependency on its consumer. |
| Styling | Headless-ish: structure + CSS custom properties, everything overridable | Consumers have their own design systems. |
| Snapping | Windows edge gestures, **runtime-only state** | Zone assigns geometry and nothing else, so the descriptor and the persisted schema stay exactly as they were. |
| Strings | None in the library | Consumer supplies all labels; no i18n dependency, no hardcoded language. |

## Public API

Installation:

```js
import { createWindows } from '@you/vue-windows'
import '@you/vue-windows/style.css'   // optional baseline, ~40 lines

app.use(createWindows({
  components: {                        // name → component (async recommended)
    itemEditor: () => import('./windows/ItemEditor.vue'),
    logViewer:  () => import('./windows/LogViewer.vue'),
  },
  persist: { key: 'app:windows', storage: localStorage },   // omit to disable
  maxWindows: 8,
  bounds: { minVisible: 80 },          // px of header kept reachable
  snap: {                              // edge snapping; omit for these defaults
    enabled: true,
    edge: 12,                          // px from an edge that arms a half or maximize
    corner: 100,                       // px from two edges that arms a quarter
    insets: { bottom: 36 },            // keep snapped windows clear of a fixed taskbar
  },
  mobileBreakpoint: 768,               // below this: fullscreen, no drag/resize
}))
```

Mount once, above the router outlet:

```vue
<!-- App.vue -->
<router-view />
<WindowHost />
<WindowTaskbar v-slot="{ windows, restore, close }">
  <div class="my-taskbar">
    <button v-for="w in windows" :key="w.id" @click="restore(w.id)">
      {{ w.title }}
      <span @click.stop="close(w.id)">✕</span>
    </button>
  </div>
</WindowTaskbar>
```

`WindowTaskbar` renders no markup of its own — it is a renderless component exposing the
minimized set. The consumer owns the visual completely.

Driving it, from anywhere including outside `setup()`:

```js
import { useWindows } from '@you/vue-windows'

const win = useWindows()
win.open('itemEditor', { id: 42 }, { title: 'Item 42', w: 720, h: 520 })
win.minimize(id)
win.restore(id)
win.close(id)
win.closeAll()

const view = { w: innerWidth, h: innerHeight }
win.snap(id, 'left', view)   // 'left' | 'right' | 'max' | 'top-left' | 'top-right' | 'bottom-*'
win.snap(id, 'none', view)   // back to the pre-snap geometry
win.dockZone(id)             // the current zone, or null
```

Inside a window's content component:

```vue
<script setup>
import { useWindowState, useWindowContext } from '@you/vue-windows'

const props = defineProps({ id: Number, windowId: String })

// draft state that survives minimize (unmount) and page reload
const form = useWindowState(props.windowId, () => ({ name: '', note: '' }))

// control your own window
const { setTitle, close, minimize, isRestored } = useWindowContext()
setTitle(`Item ${props.id}`)
</script>
```

`isRestored` is `true` when this mount came from a restored descriptor rather than a fresh
`open()` — the hook consumers need to decide whether to refetch, warn about staleness, etc.

## Package layout

```
src/
  index.js                 public exports
  createWindows.js         plugin factory, options, injection key
  state.js                 reactive store (no pinia)
  persist.js               serialize / hydrate / schema version
  WindowHost.vue           renders non-minimized windows
  WindowTaskbar.vue        renderless, exposes minimized set
  BaseWindow.vue           <dialog> + header + drag + resize
  useWindowDrag.js         pointer-events drag, and the snap zone armed by a drag
  useWindowState.js        store-backed draft state
  useWindowContext.js      per-window control surface (provide/inject)
  types.d.ts
style.css                  optional baseline
```

## Core design

### Descriptor

Everything in it must be JSON-serializable. This is the whole trick — no component references,
no fetched objects, no functions.

```ts
interface WindowDescriptor {
  id: string            // crypto.randomUUID()
  name: string          // key into the components map, NOT a component
  props: Record<string, unknown>   // ids and primitives only
  state: unknown | null // draft state, owned by the content component
  title: string
  minimized: boolean
  x: number; y: number; w: number; h: number
  z: number
  meta: Record<string, unknown>    // consumer's own bookkeeping (e.g. entity version)
}
```

### Store — `state.js`

```js
export function createStore(options) {
  const s = reactive({ stack: [], topZ: 10 })

  const open = computed(() => s.stack.filter(w => !w.minimized))
  const minimized = computed(() => s.stack.filter(w => w.minimized))
  const byId = id => s.stack.find(w => w.id === id)

  function openWindow(name, props = {}, opts = {}) {
    if (!options.components[name]) throw new Error(`[vue-windows] unknown window "${name}"`)

    const dup = s.stack.find(w => w.name === name && shallowEqual(w.props, props))
    if (dup) return restore(dup.id)                     // one window per entity

    if (s.stack.length >= options.maxWindows) closeWindow(s.stack[0].id)

    const d = { id: crypto.randomUUID(), name, props, state: null,
                title: opts.title ?? '', minimized: false,
                ...cascade(s.stack.length, opts), z: ++s.topZ, meta: {} }
    s.stack.push(d)
    return d.id
  }

  function focus(id)    { byId(id).z = ++s.topZ }
  function minimize(id) { byId(id).minimized = true }
  function restore(id)  { const w = byId(id); w.minimized = false; focus(id); return id }
  function closeWindow(id) { s.stack = s.stack.filter(w => w.id !== id) }

  return { s, open, minimized, byId, openWindow, closeWindow, minimize, restore, focus }
}
```

Handed to components through `provide`/`inject` with a symbol key; `useWindows()` is `inject` with
a clear error when the plugin was not installed. No global singleton — multiple app instances and
SSR both stay sane.

### Host — `WindowHost.vue`

```vue
<script setup>
const win = useWindows()
const { components } = useWindowOptions()
</script>

<template>
  <BaseWindow v-for="w in win.open" :key="w.id" :descriptor="w">
    <component :is="components[w.name]" v-bind="w.props" :window-id="w.id" />
  </BaseWindow>
</template>
```

The "don't render when not visible" requirement is satisfied structurally: `win.open` excludes
minimized windows, so their content is never created. No `v-show`, no `KeepAlive`, no
`IntersectionObserver`.

### BaseWindow — `BaseWindow.vue`

```vue
<script setup>
const props = defineProps({ descriptor: { type: Object, required: true } })
const win = useWindows()
const el = ref(null), handle = ref(null)
const d = props.descriptor

onMounted(() => el.value.show())        // non-modal — no backdrop, no top layer

useWindowDrag(handle, d)                 // mutates d.x / d.y
useResizeSync(el, d)                     // ResizeObserver → d.w / d.h

provideWindowContext(d)                  // powers useWindowContext() in the slot

function onCancel(e) { e.preventDefault(); win.minimize(d.id) }   // ESC minimizes
</script>

<template>
  <dialog
    ref="el"
    class="vw"
    :style="{
      margin: 0, inset: 'auto', left: 0, top: 0,
      width: d.w + 'px', height: d.h + 'px',
      zIndex: d.z,
      transform: `translate(${d.x}px, ${d.y}px)`,
    }"
    :aria-label="d.title"
    @cancel="onCancel"
    @pointerdown="win.focus(d.id)"
  >
    <header ref="handle" class="vw__head">
      <slot name="header" :descriptor="d">
        <span class="vw__title">{{ d.title }}</span>
      </slot>
      <slot name="controls" :descriptor="d">
        <button class="vw__btn" @click="win.minimize(d.id)">–</button>
        <button class="vw__btn" @click="win.close(d.id)">✕</button>
      </slot>
    </header>
    <section class="vw__body"><slot /></section>
  </dialog>
</template>
```

Baseline CSS uses custom properties (`--vw-radius`, `--vw-shadow`, `--vw-head-bg`, …) so consumers
restyle without fighting specificity, and `resize: both; overflow: hidden` on the host with
`overflow: auto` on `.vw__body`.

Gotchas that will otherwise cost a debugging session:

- the UA stylesheet gives `<dialog>` `position: absolute; margin: auto; inset: 0` — all three must
  be cleared or centering fights the transform;
- `position: fixed` so windows don't scroll away with page content;
- never put `transform` in a CSS `transition` — dragging lags a frame behind the pointer;
- `resize: both` needs `overflow` ≠ `visible` to take effect.

### Drag — `useWindowDrag.js`

Pointer Events with capture: one code path for mouse, touch and pen, and no `window`-level
listeners to leak.

```js
export function useWindowDrag(handleRef, d) {
  let start = null

  function onDown(e) {
    if (e.button !== 0 || e.target.closest('[data-vw-nodrag]')) return
    e.preventDefault()
    handleRef.value.setPointerCapture(e.pointerId)
    start = { px: e.clientX, py: e.clientY, x: d.x, y: d.y }
  }
  function onMove(e) {
    if (!start) return
    d.x = clampX(start.x + e.clientX - start.px, d.w)
    d.y = clampY(start.y + e.clientY - start.py, d.h)
  }
  function onUp(e) {
    start = null
    handleRef.value.releasePointerCapture(e.pointerId)
  }
  // pointerdown / pointermove / pointerup / pointercancel, cleaned up on unmount
}
```

`data-vw-nodrag` lets consumers put buttons and inputs in the header without them starting a drag.
Clamping keeps `bounds.minVisible` px of header reachable; every window is re-clamped on
`window.resize`, otherwise a window becomes unreachable when the viewport shrinks.

### Draft state — `useWindowState.js`

Because minimized means unmounted, content cannot hold its form in local `ref`s.

```js
export function useWindowState(windowId, factory) {
  const w = useWindows().byId(windowId)
  if (w.state == null) w.state = factory()
  return w.state              // already reactive; part of the persisted descriptor
}
```

**Documented contract for consumers:** a window's props are ids and primitives only, never fetched
objects and never values read from the route. A window outlives the view that opened it, so its
content must fetch its own data.

### Data freshness is the consumer's job, and the library must say so

A preserved draft can be older than the server's copy. The library does not fetch, so it cannot
resolve this — but it must not pretend the problem doesn't exist. What it provides:

- `descriptor.meta` — a serializable slot for the consumer to stash an entity version/ETag;
- `isRestored` from `useWindowContext()` — distinguishes a restored mount from a fresh open.

The README documents the pattern: stash the version in `meta` when the draft starts, compare after
refetch on a restored mount, and let the user choose between draft and server copy. A README
section rather than a code path, but an explicit one — silently overwriting concurrent edits is
the sharpest edge this library creates.

### Persistence — `persist.js`

- serialize `{ schema, stack, topZ }` through the configured `storage`;
- debounced (~300ms) deep watch on the stack;
- hydrate on install: parse, drop on `schema` mismatch, drop descriptors whose `name` is not in
  the current `components` map, clamp geometry to the current viewport;
- guard all `window` / `localStorage` access so SSR imports don't explode; hydrate on mount, not
  at module scope;
- `storage` is any `{ getItem, setItem, removeItem }` — consumers can swap in IndexedDB or a
  server-backed adapter.

Bump `schema` whenever the descriptor shape changes. A stale blob hydrating into new code is the
likeliest source of hard-to-reproduce bugs in this design.

### Snapping — `geometry.js` + `state.js`

Drag a header against an edge and the window snaps like a Windows one: left or right edge gives a
half, a corner gives a quarter, the top maximizes, and a translucent ghost shows the drop before
release. Double-clicking the header toggles maximize.

The whole feature is **geometry assignment**. There is no second layout model, no container tree,
no splitters: a snapped window is still a plain descriptor with `x/y/w/h`, and everything else in
the library keeps working on it unchanged.

Zone state lives in the store but **outside the reactive `s` object**, next to the existing
`restoredIds` set:

```js
const docks = reactive(new Map())   // id -> { zone, prev: { x, y, w, h } }
const preview = shallowRef(null)    // the armed drop target, drawn by WindowHost
```

That placement is the design decision. It keeps the descriptor exactly as it was, so `SCHEMA` never
moves and old persisted blobs keep hydrating; and the debounced persistence watcher — which watches
`s` — never fires for a ghost hover. The price is that snapping does not survive a reload: a snapped
window comes back as an ordinary floating one with the geometry the snap gave it. That is the
accepted trade, not an oversight.

Pure maths in `geometry.js`, so it is unit-testable with no DOM:

```js
snapArea(view, insets)                    // the viewport minus the insets
snapRect(zone, view, insets)              // the geometry a zone assigns
zoneFromPointer(px, py, view, snap)       // the zone a drop here would take, or null
```

A corner beats an edge in `zoneFromPointer`: the corner band is wide (100px) and the edge band is a
few px, otherwise quarters are unreachable in practice. The bottom edge alone arms nothing, as on
Windows. The ghost is drawn from `snapRect` too, so the preview cannot disagree with the drop.

The transitions:

```
drag moves          -> zoneFromPointer -> store.setPreview -> WindowHost ghost
drag released       -> snap(id, zone): stash `prev` once, assign snapRect(zone), focus
drag starts on a
  snapped window    -> undockForDrag: pre-snap size back, placed under the cursor
double-click header -> snap(id, dockZone === 'max' ? 'none' : 'max')
corner resize       -> undock(id): keep the new size, forget the zone
viewport resize     -> clampAll: docked windows re-snap, floating ones clamp
```

`prev` is stashed on the *first* snap only, so left -> max -> none lands where the window started.
`snap.insets` is what keeps a consumer's fixed taskbar uncovered. Snapping is inert below
`mobileBreakpoint`, where windows are fullscreen anyway, and `snap: { enabled: false }` turns it off
entirely.

### Accessibility and small screens

- header controls are real `<button>`s; the consumer supplies `aria-label`s via the `controls` slot
  (no strings in the library);
- ESC minimizes the focused window rather than closing it — closing would defeat the point;
- arrow-key move/resize while the header has focus, otherwise the feature is pointer-only and
  keyboard users cannot reposition anything;
- below `mobileBreakpoint`, geometry is forced fullscreen and drag/resize are disabled — a 640×480
  floating window on a phone is unusable.

## Build order

1. `state.js` + `createWindows.js` — open/close/minimize/restore/focus, no UI. Verified by unit tests alone.
2. `BaseWindow.vue` + `WindowHost.vue` — static geometry, no drag. One window type end to end.
3. `WindowTaskbar.vue` — minimize/restore round trip across a route change.
4. `useWindowDrag.js` + resize sync — geometry lands in the descriptor.
5. `useWindowState.js` + `useWindowContext.js` — drafts across minimize.
6. `persist.js` — drafts and layout across reload.
7. `style.css`, `types.d.ts`, README, demo app.
8. Snapping — `geometry.js` zone maths first (pure, unit-tested), then the store transitions, then
   the drag arming and the ghost. Additive throughout: nothing above changes shape for it.

Steps 1–4 are a coherent, shippable `0.1`. Steps 5–6 are where the real complexity lives. Step 8
came after `0.1` and is deliberately the last one that could have been left out.

## Packaging

- Vite library mode, ESM only, `vue` as a peer dependency and external;
- ship `types.d.ts` hand-written (small surface, not worth `vue-tsc` in the build);
- `exports` map with `"./style.css"` as a separate entry so the baseline CSS is opt-in;
- `sideEffects: ["*.css"]` so bundlers can tree-shake the rest;
- a `playground/` app in the repo doubling as manual test bed and README screenshots source.

## Verification

Unit (vitest, no DOM): store transitions — `open` dedupes on identical name+props, `maxWindows`
evicts oldest, `focus` bumps `z` monotonically, `close` removes, hydrate drops unknown `name` and
bad `schema`.

Component/browser tests — note `jsdom`'s `HTMLDialogElement` support is recent and `happy-dom`'s is
partial. Run the DOM-level suite in **vitest browser mode** (Playwright provider) rather than
fighting shims.

1. Two windows open: drag both, resize both, click to raise → `z` order correct.
2. Minimize one, change route, restore from the taskbar → same window, same geometry.
3. Type into a form, minimize, restore → draft intact.
4. Type into a form, minimize, reload the page → window restores minimized; restoring shows the draft.
5. `open()` the same name+props twice → one window, raised, not two.
6. Descriptor with an unknown `name` in storage → dropped on hydrate, no crash.
7. Shrink the viewport → windows clamp back into view; below the breakpoint they go fullscreen and
   the drag handle is inert.
8. With a window minimized, assert its content component is not mounted (spy on the content's
   `onMounted` / check the instance tree) — this is the headline claim and deserves a real test.
9. A consumer popper (any teleported dropdown) inside a window renders above the window content —
   guards the non-modal decision from being silently reverted to `.showModal()`.
10. Import the entry in a Node/SSR context → no `window`/`document` access at module scope.
11. `snapRect` tiles: the four quarters cover the snap area with no gap and no overlap, insets are
    respected, and an odd width still ends flush against the right edge.
12. `zoneFromPointer` boundaries: a corner beats the edge it sits on, the bottom edge alone is
    `null`, mid-screen is `null`, and insets move the trigger lines inward.
13. Drag a header to an edge → the ghost matches `snapRect`; release → the window takes it; drag it
    away → the pre-snap size comes back under the cursor.
14. A cancelled drag (`pointercancel`) clears the ghost and snaps nothing — a ghost left on screen
    has no way back.
15. Resize a snapped window by its corner → the new size sticks and the zone is dropped; resize the
    viewport → snapped windows follow it while floating ones only clamp.
16. The persistence suite passes untouched — proof the descriptor shape and `SCHEMA` did not move.

## Non-goals

- modal mode (`.showModal()`, backdrop, inert background) — that is what every other modal library
  already does well;
- confirm/alert/prompt helpers;
- data fetching, staleness resolution, or any server contract;
- syncing layout across devices (the `storage` adapter is the extension point; the library ships
  `localStorage` only);
- tiling window management — docked rails, tab stacks, splitters — or `window.open` multi-monitor
  popups. Edge snapping is the one exception and stays geometry-only, see *Snapping* above;
- a bundled design system — baseline CSS is deliberately minimal and opt-in.
