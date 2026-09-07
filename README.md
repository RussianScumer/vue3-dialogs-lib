# @korneevec/vue3-dialogs-lib

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

```sh
npm install @korneevec/vue3-dialogs-lib
```

Vue 3.5 or newer is the only requirement — it is a peer dependency, and the library has no runtime
dependency of its own. The stylesheet is optional: without it the windows are unstyled but fully
functional.

```js
import { createWindows } from '@korneevec/vue3-dialogs-lib'
import '@korneevec/vue3-dialogs-lib/style.css' // optional baseline

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
  keymap: {                              // Meta+arrow snapping, Alt+` switching; on by default
    enabled: true,                       // false removes every binding, store API unaffected
    bindings: { snapLeft: 'Ctrl+Alt+ArrowLeft' }, // per action: a chord, several, or null
  },
  async: {                               // fallback loading/error states for every window type
    loadingComponent: WindowLoading,     // per-type overrides live on the component's spec
    errorComponent: WindowError,         // also used when a window's content throws
  },
}))
```

A bare function in `components` is treated as an async loader. A plain functional component must
be wrapped in `defineComponent` so it carries component options. `loadingComponent`,
`errorComponent`, `delay` and `timeout` can also be set per type on a `WindowSpec`; a window whose
content throws renders the same `errorComponent` inside its own frame and leaves every other window
alone.

Mount the host once, above the router outlet:

```vue
<router-view />
<WindowHost />
<WindowTaskbar v-slot="{ all, active, restore, focus, close, registerFocusTarget }">
  <div :ref="registerFocusTarget" class="my-taskbar" tabindex="-1">
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
`null`), `closing(id)`, and `restore` / `focus` / `minimize` / `close` / `requestClose`.
`registerFocusTarget` is
optional: bind it as a template ref and the taskbar becomes where focus goes when the last window
is minimized, instead of the element that opened it.

## Driving it

Works anywhere, including outside `setup()`:

```js
import { useWindows } from '@korneevec/vue3-dialogs-lib'

const win = useWindows()
const { id, result } = win.open('itemEditor', { id: 42 }, { title: 'Item 42', w: 720, h: 520 })
win.minimize(id)
win.restore(id)
win.focus(id)
win.close(id)            // unconditional
await win.requestClose(id) // runs the guards; resolves false if one refused
win.closeAll()

win.updateProps(id, { id: 43 })
win.setMeta(id, { version: 7 })

await result             // what the window settled with — see Window results
win.resultOf(id)         // the same promise, for a window you did not open yourself

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

One option in that shape is **not** on the descriptor and does not persist — `fixed`, which pins
the window above every other one. It is toggled from the header at runtime, so it lives in a
runtime map instead; see [Pinned windows](#pinned-windows).

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

Either guard may be async, which is the whole reason a guard exists — show a confirm, await the
answer:

```js
onBeforeClose(async () => {
  if (!form.dirty) return true
  return await askTheUser() // a window of your own, a toast, anything that resolves
})
```

While a guard is deciding the window is *closing*: `win.isClosing(id)`, the `closing` computed on
`useWindowContext()`, and a `closing(id)` slot prop on `WindowTaskbar`. The default ✕ and –
controls disable themselves for that stretch. A second `requestClose` in the meantime joins the
first — same promise, guard run once, the user asked once — and a guard that throws counts as a
veto and warns in dev. None of this touches the descriptor: reload mid-question and the window
comes back ordinary.

Both must pass. **The per-window guard only exists while the content is mounted**, which is a
direct consequence of "minimized means unmounted": a minimized window closed from the taskbar is
covered only by the app-wide `beforeClose`. Put anything that must hold for a minimized window
there.

## Window results

`open()` returns `{ id, result }`. `result` is a promise for what the window settled with:

```ts
type WindowResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'closed' | 'restored' }
```

The window settles it from its own content:

```vue
<script setup>
const { resolve, dismiss } = useWindowContext()

function save(item) {
  resolve(item)   // settles { ok: true, data: item }, then closes the window
}
function cancel() {
  dismiss()       // settles { ok: false, reason: 'closed' }, then closes
}
</script>
```

```js
const saved = await win.open('itemEditor', { id: 42 }).result
if (saved.ok) refreshTheList(saved.data)
```

**A result promise never hangs.** Every path that takes a window away without an answer settles it
as `closed`: the ✕, `close()`, `closeAll()`, `maxWindows` eviction, and an owner closing its child.
`resolve()` answers first and the close it performs cannot overwrite that value. A guard that
refuses a `requestClose` leaves the window open, and its result pending — the question is still on
screen.

A deduped `open()` — same name, shallow-equal props — joins the window that is already open, and
its answer with it: one window per entity means one answer, heard by both callers.

### A restored window has no live opener

This is the one place where the descriptor model and a promise API genuinely disagree, and the
library does not paper over it. A window that came back from storage was opened by a call that
belongs to a previous page load — often a previous day. There is nobody left to answer, so its
result is settled before anything can await it:

```js
await win.resultOf(restoredId) // { ok: false, reason: 'restored' }
```

`resultOf(id)` is also how you reach the result of a window you did not open yourself; an id the
store no longer has answers `closed`. Nothing about a result is persisted: it lives in a
runtime-only map beside the close guards, and the descriptor and `SCHEMA` are untouched.

To type `data`, give the window's spec a `result` marker. It is type-only — the key is stripped
before it can reach the descriptor — and it degrades to `unknown` rather than to an error:

```ts
export const components = {
  itemEditor: {
    component: () => import('./windows/ItemEditor.vue'),
    result: null as unknown as SavedItem,
  },
}

const saved = await useWindows<typeof components>().open('itemEditor', { id: 42 }).result
saved.ok && saved.data.name // SavedItem
```

## Inside a window's content

```vue
<script setup>
import { useWindowState, useWindowContext } from '@korneevec/vue3-dialogs-lib'

const props = defineProps({ id: Number, windowId: String })

// draft state that survives minimize (unmount) and page reload
const form = useWindowState(props.windowId, () => ({ name: '', note: '' }))

const { setTitle, close, requestClose, onBeforeClose, minimize, isRestored, closing, resolve, dismiss } =
  useWindowContext()
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

The same map types the result, when the spec declares one — see
[Window results](#window-results).

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
- Opening a window moves focus into it — its first tabbable element, or the header. Minimizing or
  closing one hands focus on, in this order: the window now on top, by its header; the taskbar, if
  it opted in with `registerFocusTarget` and this was a minimize; the element that opened the
  window. Never `<body>`, and never at all if focus had already been moved out of that window.
  There is deliberately **no focus trap**: these windows are not modal.
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

### Two tabs on one key

Every blob carries the token of the tab that wrote it. When a `storage` event brings a value this
tab did not write — another tab on the same key, or anything else writing there — the receiving tab
**stops persisting** and stays stopped. That is the default and needs no configuration: a stale tab
is recoverable, a tab that overwrites another tab's session is not. Reloading a foreign snapshot
mid-edit would be worse still, so the library never does it on its own.

`onExternalChange` is where you decide what to do about it:

```ts
persist: {
  key: 'app:windows',
  storage: localStorage,
  onExternalChange(info) {
    // Already stopped writing by the time this runs. Ignore it and this tab goes stale,
    // prompt and reload, or adopt the other tab's snapshot:
    info.resume() // re-reads `info.key`, hydrates the store, resumes persisting
  },
},
```

Regaining focus does **not** resume writing — resuming is how the data loss happens. Only
`resume()` or a page reload does. Note that `resume()` hydrates, so it replaces this tab's windows
with the other tab's; unsaved draft state in `useWindowState` goes with them.

Only `localStorage` emits `storage` events. A different adapter — IndexedDB, server-backed —
silently keeps today's last-writer-wins behaviour, with no warning and no detection. Use
`sessionStorage` for per-tab windows, or a key that includes a tab id, and none of this applies.

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

## Pinned windows

`fixed: true` opens a window above every other one, wherever focus goes:

```js
win.open('miniPlayer', {}, { fixed: true })
```

A pinned window cannot be dragged, resized or snapped — the grips are gone, the header does not
drag, arrow keys do not move it and double-clicking it does nothing. It stays closable and
minimizable, and it appears in the taskbar when minimized like any other window.

Its header carries a pin button after the ✕ (marked `data-vw-pinned` while pinned, so you can style
it), and pressing it drops the window back into the normal band, draggable and snappable again.
Pinning again re-pins it and drops any snap it had picked up.

```js
win.isPinned(id)          // in the pinned band right now
win.isPinnable(id)        // has a pin to toggle — what the header button renders on
win.setPinned(id, true)   // pin, drop any snap, keep the geometry
```

Mentioning `fixed` at all is what makes a window pin-capable, so `fixed: false` gives you the
button without starting pinned, and a window that never mentions it is untouched — no extra button,
no second band.

Pin state is **runtime-only**, like snap state: it is not on the descriptor and is not persisted, so
after a reload a pinned window comes back unpinned and draggable. That is deliberate — pinning is
toggled by the user at runtime, and persisting it would mean moving the storage schema.

## Keyboard

With the header focused, arrow keys move the window by 10px and `Shift`+arrows resize it. From
anywhere inside a window there is a keymap as well:

| Action | Familiar chord | Chord that survives |
| --- | --- | --- |
| `snapLeft`, `snapRight`, `snapMax`, `snapNone` | `Meta`+`←` / `→` / `↑` / `↓` | `Ctrl`+`Shift`+ the same arrow |
| the quarters, clockwise from the top-left | `Meta`+`Shift`+`↑` / `→` / `↓` / `←` | `Ctrl`+`Shift`+`1`…`4`, reading order |
| `focusNext`, `focusPrev` | `Alt`+`` ` `` / `Alt`+`Shift`+`` ` `` | `Ctrl`+`` ` `` / `Ctrl`+`Shift`+`` ` `` |

**Why two chords.** The familiar one usually never arrives: Windows takes `Win`+arrow for Snap
Assist, GNOME and KDE take `Super`+arrow for tiling, GNOME takes `Alt`+`` ` `` for switch-group, and
macOS Chrome reads `Cmd`+`←` as Back. A window manager grabs a key above the browser, so the page
cannot detect it, warn about it or take it back — the second chord sits one modifier away from
everything a desktop reserves, and is what the feature runs on in practice. The quarters cannot
reuse the arrows there, since `Ctrl`+`Shift`+arrow is already a half, so they are the digits in
reading order — matched by `event.code`, because `Shift`+`1` is `!` on one layout and something else
on the next.

**Chords act on the active window** — the top non-minimized one, the one carrying `data-vw-active`
— no matter where focus is. The keymap is a single `keydown` listener on the document, created in
the plugin's effect scope beside the viewport tracker and removed when the app unmounts; it is
inert without a DOM, so SSR is unaffected. Clicking a window raises *and* focuses it, so the window
on top is the one the keyboard is talking to.

The snap chords go through the same `snap(id, zone, view)` a drop does, so they respect
`snap.enabled`, `snap.insets`, the window's `draggable`/`resizable` flags and the inertness below
`mobileBreakpoint`. A keystroke inside an `<input>`, `<textarea>` or `contenteditable` belongs to
the text field and never reaches the window — `Meta`+`←` is line-start on macOS, and
`Ctrl`+`Shift`+arrow is word-select everywhere. The listener is on the bubble phase, so content
that calls `preventDefault()` keeps its key and your own handlers can pre-empt the library.

Every binding moves, and an override replaces **both** default chords for that action, so you never
inherit a collision you did not ask for:

```js
keymap: {
  bindings: {
    snapLeft: 'Ctrl+Alt+ArrowLeft',      // one chord replaces the default
    snapMax: ['Ctrl+ArrowUp', 'F11'],    // or several
    snapNone: null,                      // or none at all
  },
}
```

A chord is modifiers plus a key, in any order and any case: `Meta`/`Cmd`/`Super`/`Win`, `Ctrl`,
`Alt`/`Option`, `Shift`. The key is matched against both `event.key` and `event.code`, so
`Backquote` and `` ` `` name the same physical key — which matters where `Alt` turns it into a dead
key. Modifiers must match exactly, so rebinding a half never swallows the quarter above it.

Switching ships whether or not the keymap does:

```js
win.focusNext()   // next non-minimized window by z, wrapping; focuses its header, returns the id
win.focusPrev()
```

Both skip minimized windows and any window that currently owns a child, since an owner's frame is
`inert` while its question is on screen.

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
- **Two tabs on one persist key do not merge.** The second writer is detected and the receiving tab
  stops writing rather than losing a session — see [Persistence](#persistence) — but nothing is
  merged, and a tab that ignores `onExternalChange` is stale until it reloads.
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

