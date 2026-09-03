# Features

What `vue-windows` does today, as implemented in `src/`. Every entry maps to code in this
repository; nothing here is planned or aspirational.

For the reasoning behind these choices see [docs/how-it-works.md](./docs/how-it-works.md), and for
usage see [docs/recipes.md](./docs/recipes.md).

---

## Core model

### Windows are serializable descriptors in a store

A window is a plain, JSON-serializable `WindowDescriptor` (`src/types.ts`) held in a reactive
stack, not a boolean owned by the component that opened it. It carries identity (`id`, `name`),
data (`props`, `state`, `meta`), presentation (`title`, `minimized`), geometry (`x`, `y`, `w`,
`h`, `z`) and capabilities (`closable`, `minimizable`, `draggable`, `resizable`, `minW`, `minH`,
`maxW`, `maxH`).

Consequences: a window outlives the view that opened it, can be driven from anywhere, and can be
written to storage as-is.

### Components registered by name

`createWindows({ components })` maps a string name to a component, an async loader
(`() => import('./X.vue')`), or a `WindowSpec` — a component plus per-type defaults. Resolution is
memoized; a bare function is wrapped in `defineAsyncComponent` automatically
(`src/options.ts`).

Descriptors store the *name*, never a component reference, which is what keeps them serializable.

### Loading and failure states

A window's component is usually a chunk, so it can be slow, absent, or broken. A `WindowSpec`
accepts `loadingComponent`, `errorComponent`, `delay` and `timeout`, and `createWindows({ async })`
sets the same four app-wide; the per-type value wins key by key. They are handed to
`defineAsyncComponent` and are *not* window configuration: they cannot be passed to `open()` and
never reach the descriptor (`src/options.ts`).

`BaseWindow` also catches errors from the content itself with `onErrorCaptured` and renders the
type's `errorComponent` in its own body, with the error as an `error` prop — the same component the
async wrapper uses for a chunk that failed, so both failures look alike. Propagation stops there on
purpose: an error allowed to reach `WindowHost` mid-patch takes every other window with it. A
window in this state keeps its header and controls, and carries `data-vw-error` for styling. With
no `errorComponent` registered the body is empty — the library ships no strings — and the window is
still movable, minimizable and closable.

### Plugin install, single instance per app

`app.use(createWindows({ ... }))` provides the store, resolved options and the viewport tracker
through injection keys (`src/injection.ts`). The viewport listener and persistence watcher run in
a detached `effectScope` owned by the app and are stopped on `app.onUnmount`
(`src/createWindows.ts`).

A module-level fallback lets `useWindows()` work outside `setup()` (services, route guards), while
`inject()` still wins inside components — so multiple app instances and SSR stay correct.

---

## Window lifecycle

### Open

`open(name, props?, opts?)` returns the new window's id. Per-call `OpenOptions` override the
component's `WindowSpec` defaults, which override the library defaults.

- **Dedupe by default** — same `name` plus shallow-equal `props` restores and focuses the existing
  window instead of opening a second one. Opt out with `{ dedupe: false }`.
- **Cascade placement** — successive windows step 28px, wrapping every 8, unless `x`/`y` are given
  (`src/geometry.ts`).
- **`maxWindows` cap** (default 8) — opening past the cap closes the oldest windows first.
- Unknown names throw immediately.

### Focus and z-order

`focus(id)` raises a window by assigning the next `z`. Raising an already-top window is a no-op, so
`pointerdown` on the active window costs no store write and does not wake the persistence watcher.

`activeId` is derived from the stack (highest `z` among non-minimized) rather than stored, so it
can never desync.

### Minimize and restore

`minimize(id)` unmounts the content — the window is genuinely gone from the render tree, not
hidden with CSS. `restore(id)` clears `minimized` and focuses.

### Close, and close guards

Two closes, deliberately:

- `close(id)` — unconditional. `closeAll()` on logout can never be blocked.
- `requestClose(id)` — runs the window's own guard, then the app-wide `beforeClose` option, and
  resolves `false` when either vetoes.

Per-window guards are registered from mounted content via `onBeforeClose()` and unregister on
scope dispose. A minimized window therefore has no guard of its own and is covered only by the
app-wide `beforeClose`, which is consulted for every window including minimized ones.

### Mutation API

`setTitle`, `setGeometry` (re-clamped against the window's size limits), `updateProps` (re-renders
content in place), `setMeta`, `hydrate`, `closeAll`, `isRestored`.

### Events

`on(type, cb)` subscribes to `open`, `close`, `focus`, `minimize`, `restore`, `geometry`, `title`,
or `'*'` for all of them. Returns an unsubscribe function.

---

## Geometry

### Bounds clamping

`bounds.minVisible` (default 80px) is the amount of a window kept reachable inside the viewport.
Applied on drag, on keyboard move, on hydration from storage, and on every viewport resize
(`clampAll`), so a shrinking window never strands a window off-screen.

### Size limits

`minW`/`minH` (defaults 160×80) and `maxW`/`maxH` (`null` = unbounded) are per-window and applied
through a single `clampSize` helper, so pointer resize, keyboard resize, snapping and `setGeometry`
all agree.

### Drag

`useWindowDrag` uses Pointer Events with pointer capture: one code path for mouse, touch and pen,
and no window-level listeners to leak. Elements marked `[data-vw-nodrag]` never initiate a drag.
Drag writes `x`/`y` straight onto the descriptor.

### Resize

Eight grips (`n s e w nw ne sw se`), positioned with inline styles so resizing works with no
stylesheet imported. Replaces CSS `resize: both`, which offered one corner, could not honour
min/max, and could not move `x`/`y` — a west or north grip has to, since the opposite edge is what
stays anchored. Anchoring is exact even at the min-size stop.

### Keyboard control

With the header focused: arrow keys move the window by 10px, `Shift`+arrows resize it. Both respect
the window's `draggable`/`resizable` flags and its size limits, so the keyboard can do neither more
nor less than the pointer.

---

## Snapping

Windows-style edge snapping, on by default (`src/geometry.ts`, `src/state.ts`).

- **Seven zones** — `left`, `right`, `max`, and the four quarters.
- **Corner beats edge** — a wide `corner` band (default 100px) makes quarters reachable through a
  narrow `edge` band (default 12px). The bottom edge alone does nothing, as on Windows.
- **Insets** — `snap.insets` excludes px of the viewport from the snap area, e.g. to keep snapped
  windows clear of a fixed taskbar.
- **Live drop preview** — the armed zone renders as a ghost element above every window, with a
  `data-vw-zone` attribute for styling.
- **Undock restores the pre-snap rect** — re-snapping keeps the original geometry, so
  left → max → none lands where the window started.
- **Drag off a snapped window** gives back its floating size and keeps the pointer at the same
  relative position along the header.
- **Manual resize drops the snap** without moving the window back — an explicit size outranks it.
- **Double-click the title bar** toggles maximize.
- **Snapped windows follow the viewport** — on resize they are re-snapped rather than clamped.

Snap state lives outside the persisted descriptor: it is runtime-only, so the storage schema does
not move, but reactive, so the zone can be rendered.

---

## Persistence

Optional, via `persist: { key, storage }`. Any object with `getItem`/`setItem`/`removeItem`
satisfies `StorageLike` — `localStorage`, `sessionStorage`, or your own adapter.

- **Debounced writes** (300ms) from a deep watcher on the store. Deep is required: draft state and
  drag both mutate the descriptor directly without going through a store method.
- **Schema versioned** (`SCHEMA = 2`) with a migration set. A readable older blob is migrated, not
  discarded — an upgrade must not throw away every open window.
- **Validated and repaired on read** — descriptors missing fields are filled from the component's
  defaults through one `normalize` path, which doubles as the schema-1 migration and the repair
  path for a hand-edited blob.
- **Unknown window types are dropped** — a descriptor whose component no longer exists can never
  be rendered.
- **Never load-bearing** — every storage read and write is wrapped; private mode, quota errors and
  blocked storage degrade to no persistence rather than a crash.
- **Restored windows are re-clamped** to the current viewport on hydration.

---

## Components

### `WindowHost`

Mounted once, above the router outlet. Renders every non-minimized window, resolves each
descriptor's component by name, and draws the snap ghost. Forwards `header`, `controls` and
`footer` slots through to each window.

### `BaseWindow`

One window. Renders a native non-modal `<dialog>` via `.show()`, so the background stays usable and
the taskbar clickable.

- Clears the UA `position: absolute; margin: auto; inset: 0` so `transform`-based positioning works.
- `zIndexBase` is added to every window's `z` at render time, to clear an app's own stacking
  contexts.
- `header`, `controls` and `footer` slots, each receiving the descriptor; default controls are
  minimize and close, shown per the window's capability flags.
- **Three rows: header, body, footer.** The header and the footer are intrinsic and never shrink;
  `.vw__body` takes the rest and is the only part that scrolls (`overflow: auto` inline, so it
  holds with no stylesheet imported). Resizing the frame smaller gives up scroll area, never the
  footer. The `footer` slot is optional — unused, no `.vw__foot` element is rendered and the body
  keeps the full height.
- **ESC minimizes** through a `keydown` listener on the window element. There is no `cancel`
  handler: `cancel` and ESC-to-close are `showModal()` behaviour, and a `.show()` dialog never
  receives them — asserted in a real browser by `src/__tests__/esc.browser.spec.ts`. ESC stands
  down for content that called `preventDefault()`, for a window that is not the active one, for a
  native picker target, and for `minimizable: false`.
- **Content that throws is contained**: `onErrorCaptured` swaps the body for the type's
  `errorComponent` and stops propagation, so one bad window cannot tear down the host and every
  other window with it.
- `data-vw-active` marks the top window for styling, `data-vw-error` a window whose content
  failed.

### `WindowTaskbar`

Renderless — the consumer owns the visual completely. The default slot receives `windows`
(minimized only), `all`, `active`, and the `restore`, `close`, `requestClose`, `focus`, `minimize`
actions, plus `registerFocusTarget` — bind it as `:ref="registerFocusTarget"` on the element that
should take focus when the last window is minimized.

---

## Inside a window's content

`useWindowContext()` gives content its own `descriptor`, plus `setTitle`, `minimize`, `close`,
`requestClose`, `onBeforeClose`, and `isRestored` (true when this mount came from storage rather
than a fresh `open()`).

`useWindowState(windowId, factory)` returns draft state stored on the descriptor. It survives
minimize (which unmounts the content) and, with persistence on, a page reload. Must be
JSON-serializable.

Every window's content receives a `windowId` prop, supplied by `WindowHost`.

---

## Accessibility

- **Focus is moved into an opening window**, and handed on when its frame leaves. Non-modal means
  no focus trap, deliberately — but that is not the same choice as no focus management.
- **Focus has a defined destination on minimize and close.** Both unmount the frame, so leaving
  focus alone would leave it on `<body>`, with the keyboard user back at the top of the page.
  The chain, in order: the window that is now on top, by its header; then the taskbar, if the
  consumer opted in with `registerFocusTarget` and this is a minimize (a closed window has no
  button left to focus); then the element that opened the window, if it is still in the document.
  Focus only moves if it was inside that window to begin with — a background window going away
  never takes focus from where the user put it.
- **Async content is handled** — a window whose component has not loaded yet takes focus on the
  header and hands it on to the first tabbable element when the content lands, unless the user has
  moved focus in the meantime (`MutationObserver`, disconnected as soon as it fires).
- **Restored windows do not steal focus** on page load, and only the top window takes it.
- The header is `tabindex="0"` and is the keyboard drag/resize surface, with a `:focus-visible`
  outline.
- `aria-label` on the dialog from the window title; the snap ghost is `aria-hidden`.

---

## Responsive

Below `mobileBreakpoint` (default 768px) a window goes fullscreen (`100vw`/`100dvh`) and drag and
resize are disabled — a floating window at that size is unusable.

---

## Typing

- **Typed `open()`** — `useWindows<typeof components>()` checks the name against your components
  map and the props against that component. Props stay required when the component requires them
  and optional when it does not.
- **Graceful degradation** — a component whose props cannot be inferred (a plain object component,
  a loader whose module type cannot be seen) falls back to `Record<string, unknown>` rather than
  becoming a type error. A library that cannot type your window must not refuse to open it.
- `windowId` is excluded from the caller's props: `WindowHost` supplies it.
- Full public type surface is re-exported from `src/index.ts`.

---

## Styling

- **Structure is inline** — the library is fully functional with no stylesheet imported.
- **Optional baseline** at `vue-windows/style.css`, cosmetics only.
- **Theming through `--vtd-*` custom properties** — font, radius, border, shadow, backgrounds,
  foregrounds, padding, accent, button hover, ghost fill/outline, and active-window border/shadow.
  Each is read through a private `--_vtd-*` holding the default, so setting one on `:root`, a theme
  class, or inline on `<html>` wins by inheritance with no selector to out-specify.
- **Dark mode defaults** under `prefers-color-scheme: dark`, still as fallbacks, so consumer values
  keep winning.
- Stable hooks: `.vw`, `.vw__head`, `.vw__title`, `.vw__body`, `.vw__foot`, `.vw__btn`, `.vw__grip`,
  `.vw-ghost`,
  `[data-vw-active]`, `[data-vw-zone]`, `[data-vw-grip]`, `[data-vw-nodrag]`.

---

## Packaging and environment

- **Zero runtime dependencies** beyond Vue 3.5+ (peer dependency).
- ESM build with generated `.d.ts` types and a separately importable stylesheet.
- **SSR-safe** — the viewport tracker, persistence and focus handling all guard on `window` /
  `document`, covered by `src/__tests__/ssr.spec.ts`.

## Testing and benchmarks

- Unit and component tests across store, geometry, persistence, host rendering and SSR
  (`src/__tests__/`, ~1300 lines).
- A Vitest benchmark suite (`src/__bench__/`) covering store operations, persistence and host
  render cost; measured numbers are in [docs/performance.md](./docs/performance.md).
- A playground app (`playground/`) with example windows, an event log, theme controls, and a
  compile-time type test for `open()`.
