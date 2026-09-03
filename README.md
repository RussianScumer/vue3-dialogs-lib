# vue-windows

A window manager for Vue 3, built on the native `<dialog>` element, with no runtime dependency
beyond Vue itself.

Every other dialog library models a dialog as a transient boolean owned by the component that
opened it. This one models it as **a serializable descriptor in a store**. A window therefore
outlives its opener: it can be minimized and picked up again from anywhere in the app, it
remembers where it was on screen, it costs nothing while minimized (its content is unmounted, not
hidden), and with persistence on it survives a page reload.

## Documentation

- [How it works](./docs/how-it-works.md) — the descriptor model, the render path, geometry,
  persistence, and why the windows are non-modal.
- [Recipes](./docs/recipes.md) — complete use cases with code.
- [Performance](./docs/performance.md) — benchmark suite, measured numbers, and what they imply.

## Install

```js
import { createWindows } from 'vue-windows'
import 'vue-windows/style.css' // optional baseline

app.use(createWindows({
  components: {                          // name -> component (async loader recommended)
    itemEditor: () => import('./windows/ItemEditor.vue'),
    logViewer: () => import('./windows/LogViewer.vue'),
  },
  persist: { key: 'app:windows', storage: localStorage }, // omit to disable
  maxWindows: 8,
  bounds: { minVisible: 80 },            // px of the window kept reachable
  snap: {                                // Windows-style edge snapping; omit for the defaults
    enabled: true,
    edge: 12,                            // px from an edge that arms a half or maximize
    corner: 100,                         // px from two edges that arms a quarter
    insets: { bottom: 36 },              // keep snapped windows clear of your taskbar
  },
  mobileBreakpoint: 768,                 // below this: fullscreen, no drag/resize
  zIndexBase: 0,                         // added to every window's z, to clear your own overlays
  beforeClose: (d) => confirm(`Close ${d.title}?`), // consulted by requestClose(), see below
}))
```

A bare function in `components` is treated as an async loader. A plain functional component must
be wrapped in `defineComponent` so it carries component options.

Mount the host once, above the router outlet:

```vue
<router-view />
<WindowHost />
<WindowTaskbar v-slot="{ all, active, restore, focus, close }">
  <div class="my-taskbar">
    <button
      v-for="w in all"
      :key="w.id"
      :class="{ active: w.id === active }"
      @click="w.minimized ? restore(w.id) : focus(w.id)"
    >
      {{ w.title }}
      <span @click.stop="close(w.id)">✕</span>
    </button>
  </div>
</WindowTaskbar>
```

`WindowTaskbar` renders no markup of its own — the consumer owns the visual completely. The slot
gets `all` (every window), `windows` (only the minimized ones), `active` (the top window's id or
`null`), and `restore` / `focus` / `minimize` / `close` / `requestClose`.

## Driving it

Works anywhere, including outside `setup()`:

```js
import { useWindows } from 'vue-windows'

const win = useWindows()
win.open('itemEditor', { id: 42 }, { title: 'Item 42', w: 720, h: 520 }) // returns the window id
win.minimize(id)
win.restore(id)
win.focus(id)
win.close(id)            // unconditional
await win.requestClose(id) // runs the guards; resolves false if one refused
win.closeAll()

win.updateProps(id, { id: 43 })
win.setMeta(id, { version: 7 })

win.activeId.value       // id of the top non-minimized window, or null
const off = win.on('close', (e) => console.log(e.id)) // 'open' | 'close' | 'focus' | 'minimize' |
                                                     // 'restore' | 'geometry' | 'title' | '*'
```

`open()` deduplicates: the same `name` plus shallow-equal `props` restores and raises the existing
window instead of opening a second one. Pass `{ dedupe: false }` when you really want two. Past
`maxWindows`, the oldest window is closed — silently, and without consulting any guard.

## Window capabilities

Every window carries its own flags and size limits. They are part of the descriptor, so they
persist with it:

```js
win.open('itemEditor', { id: 42 }, {
  closable: false,      // hides the ✕; win.close(id) still works
  minimizable: false,   // hides the –, and makes ESC do nothing
  draggable: false,
  resizable: false,     // no grips
  minW: 320, minH: 200,
  maxW: 900, maxH: null, // null means unbounded
})
```

Repeating those at every call site is the failure mode, so a component can carry its own defaults.
Give the components map a `{ component, ... }` object instead of a bare component:

```js
components: {
  itemEditor: { component: () => import('./windows/ItemEditor.vue'), w: 720, h: 520, minW: 320 },
  logViewer: () => import('./windows/LogViewer.vue'),
}
```

Precedence is `open()` options, then the component's defaults, then the library's.

## Closing, and guards

`close(id)` is unconditional and synchronous — `closeAll()` on logout must never be blockable.
`requestClose(id)` is the guarded path, and it is what the ✕ button calls:

```js
// app-wide, in createWindows options — also covers minimized windows
beforeClose: (d) => !d.state?.dirty || confirm('Discard the draft?')
```

```js
// per window, from its content component
const { onBeforeClose } = useWindowContext()
onBeforeClose(() => !form.dirty || confirm('Discard the draft?'))
```

Both must pass. **The per-window guard only exists while the content is mounted**, which is a
direct consequence of "minimized means unmounted": a minimized window closed from the taskbar is
covered only by the app-wide `beforeClose`. Put anything that must hold for a minimized window
there.

## Inside a window's content

```vue
<script setup>
import { useWindowState, useWindowContext } from 'vue-windows'

const props = defineProps({ id: Number, windowId: String })

// draft state that survives minimize (unmount) and page reload
const form = useWindowState(props.windowId, () => ({ name: '', note: '' }))

const { setTitle, close, requestClose, onBeforeClose, minimize, isRestored } = useWindowContext()
setTitle(`Item ${props.id}`)
onBeforeClose(() => !form.name || confirm('Discard the draft?'))
</script>
```

`WindowHost` passes `windowId` to every content component alongside the descriptor's `props`.

## Typed `open()`

Pass the components map as a type argument and `open()` checks both the window name and the props
of that window's component — including through an async loader. Types only; nothing changes at
runtime.

```ts
// windows.ts
export const components = {
  itemEditor: () => import('./windows/ItemEditor.vue'), // defineProps<{ id: number }>()
  logViewer: () => import('./windows/LogViewer.vue'),
}
export const useAppWindows = () => useWindows<typeof components>()
```

```ts
const win = useAppWindows()
win.open('itemEditor', { id: 42 })  // ok
win.open('itemEditor', { id: 'x' }) // error: id must be a number
win.open('nope', {})                // error: unknown window
```

Capture it once like that and import the alias — a bare `useWindows()` has no map to check
against. `windowId` is supplied by the host, never by the caller. A window whose props cannot be
inferred (a plain object component, a loader whose module type is opaque) falls back to
`Record<string, unknown>` rather than becoming a type error.

## Contract for consumers

**A window's props must be ids and primitives only** — never fetched objects, never values read
from the route. A window outlives the view that opened it, so its content fetches its own data.
Everything in a descriptor is serialized as-is; anything non-JSON-serializable breaks persistence.

### Staleness is yours to resolve

A preserved draft can be older than the server's copy. The library does not fetch, so it cannot
resolve this. What it gives you:

- `descriptor.meta` — a serializable slot for an entity version or ETag;
- `isRestored` from `useWindowContext()` — `true` when this mount came from a persisted descriptor
  rather than a fresh `open()`.

The pattern: stash the version in `meta` when the draft starts, refetch on a restored mount,
compare, and let the user choose between draft and server copy. Silently overwriting concurrent
edits is the sharpest edge this design creates.

## Behavior notes

- Windows are **non-modal** (`dialog.show()`): several at once, the background stays usable, the
  taskbar stays clickable, and teleported poppers from your own components keep working. The cost
  is no top layer, so the library manages `z-index` itself — offset it with `zIndexBase` if your
  app has its own stacking contexts to clear.
- **ESC minimizes** the active window rather than closing it. A non-modal `<dialog>` gets no close
  request from the browser — `cancel` and ESC-to-close belong to `showModal()` — so this runs off a
  `keydown` handler on the window element. It does nothing when: content called `preventDefault()`
  first, the window is not the active one (Tab can reach a background window without raising it),
  the key was aimed at a native picker (`<select>`, `<input type="date">` and friends, which take
  ESC for themselves without marking the event handled), or the window is `minimizable: false`.
- Opening a window moves focus into it — its first tabbable element, or the header. Closing one
  hands focus back to whatever opened it. There is deliberately **no focus trap**: these windows
  are not modal.
- The header is focusable: arrow keys move the window, shift+arrow resizes it.
- Windows resize from any of eight grips, honouring `minW`/`minH`/`maxW`/`maxH`. A west or north
  grip moves `x`/`y` too, so the opposite edge stays put.
- `[data-vw-nodrag]` on any element inside the header stops it from starting a drag.
- Windows are re-clamped on viewport resize so a shrinking window can never strand one off-screen.
- Below `mobileBreakpoint` geometry is forced fullscreen and drag/resize are inert; the stored
  geometry is untouched and comes back on a wide viewport.

## Persistence

Persistence writes a debounced (~300ms) snapshot. `storage` is any
`{ getItem, setItem, removeItem }`, so IndexedDB or a server-backed adapter drops in.

On load, a descriptor whose `name` is no longer registered is dropped, and one missing fields — an
older schema, or a hand-edited blob — is repaired from that component's defaults rather than
thrown away. A snapshot from a schema too old to read is dropped whole.

> **One key, one tab.** Two tabs sharing a `persist.key` both write the full snapshot, so the last
> writer wins and can destroy the other tab's windows and drafts. Reloading a foreign snapshot
> mid-edit would be worse, so the library does not try. Use `sessionStorage` for per-tab windows,
> or a key that includes a tab id.

## Snapping

Drag a window's header against an edge and it snaps like a Windows one: the left or right edge
gives a half, a corner gives a quarter, the top maximizes. A translucent ghost shows the drop
target before you release, and double-clicking the header toggles maximize.

Dragging a snapped window away restores its previous size under the cursor; resizing one by a grip
keeps the new size and simply stops treating it as snapped. Snapped windows follow the viewport
when the browser is resized, while floating ones are only clamped back into reach.

Snapping is inert below `mobileBreakpoint`, where windows are fullscreen anyway, and can be turned
off with `snap: { enabled: false }`. The snap area is the viewport minus `snap.insets`, so a fixed
taskbar or app header is never covered.

Drive it directly when you need to:

```js
win.snap(id, 'left', { w: innerWidth, h: innerHeight })  // 'left' | 'right' | 'max' | 'top-left' | …
win.snap(id, 'none', { w: innerWidth, h: innerHeight })  // back to the pre-snap geometry
win.dockZone(id)                                          // the current zone, or null
```

Snap state is **runtime-only**: it is not part of the descriptor and is not persisted. After a
reload a snapped window comes back as a plain floating window with the geometry the snap gave it.

The ghost is a `.vw-ghost` element styled through `--vtd-ghost-bg`, `--vtd-ghost-outline` and
`--vtd-ghost-radius`.

## Styling

`style.css` is cosmetics only — layout and positioning are inline, so windows work without it.
Restyle through the `--vtd-*` custom properties: `--vtd-font`, `--vtd-font-size`, `--vtd-radius`,
`--vtd-border`, `--vtd-shadow`, `--vtd-bg`, `--vtd-fg`, `--vtd-accent`, `--vtd-head-bg`,
`--vtd-head-fg`, `--vtd-head-pad`, `--vtd-body-pad`, `--vtd-foot-pad`, `--vtd-btn-hover-bg`,
`--vtd-ghost-bg`,
`--vtd-ghost-outline`, `--vtd-ghost-radius`.

The stylesheet reads these properties and never declares them, so set them wherever it suits —
`:root`, a theme class, an inline style on `<html>` — and inheritance carries them into the
windows; there is no `.vw` declaration to out-specify. Leave one unset and the built-in default
applies, including the `prefers-color-scheme: dark` values. The playground's case 8 has a live
editor for all of them.

The top window carries `data-vw-active`, so `.vw[data-vw-active]` is yours to style;
`--vtd-border-active` and `--vtd-shadow-active` are shortcuts that default to the inactive values,
leaving the baseline look unchanged. Resize grips are `.vw__grip` elements carrying
`data-vw-grip="n" | "se" | …`; they are transparent by default.

The library ships no strings: header button labels and their `aria-label`s come from the
`controls` slot on `WindowHost`/`BaseWindow`.

A window is three rows: header, body, footer. `.vw__body` is the only one that scrolls, so content
taller than the frame stays inside it and the action buttons in the optional `footer` slot stay
reachable while the user resizes the window down.

## Known limitations

- **No announcement on minimize/restore.** Minimizing removes a subtree with nothing said to a
  screen reader. Fixing it needs strings, and the library ships none by design; a consumer with an
  i18n setup can do it in a few lines off `win.on('minimize')`.
- **A minimized window has no guard of its own** — see [Closing, and guards](#closing-and-guards).
- **One persist key per tab** — see [Persistence](#persistence).
- Resize grips sit in the outermost 4px of the window, which is where a body scrollbar also lands.

## Non-goals

Modal mode, confirm/alert helpers, data fetching or staleness resolution, cross-device layout sync,
tiling window management (docked rails, tab stacks, splitters), and a bundled design system.
Snapping is limited to the Windows edge gestures described above.

## Development

```sh
npm run dev          # playground at playground/
npm run test         # unit tests
npm run bench        # performance benchmarks
npm run type-check
npm run build        # library build (dist/)
```
