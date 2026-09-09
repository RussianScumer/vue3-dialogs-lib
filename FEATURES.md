# Features

What `@korneevec/vue3-dialogs-lib` does today, as implemented in `src/`. Every entry maps to code in this
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
through injection keys (`src/injection.ts`). The viewport listener, the keymap listener, the
persistence watcher and its cross-tab `storage` listener run in a detached `effectScope` owned by
the app and are stopped on `app.onUnmount` (`src/createWindows.ts`).

A module-level fallback lets `useWindows()` work outside `setup()` (services, route guards), while
`inject()` still wins inside components — so multiple app instances and SSR stay correct.

---

## Window lifecycle

### Open

`open(name, props?, opts?)` returns a handle — `{ id, result }`, see *Window results* below — not
a bare id. Per-call `OpenOptions` override the component's `WindowSpec` defaults, which override
the library defaults.

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

Both guards may be **async**: `requestClose` awaits them, so a consumer can ask a question and
answer later. While they are deciding the window is *closing* — `isClosing(id)` on the store, a
`closing` computed on the window context, a `closing(id)` slot prop on `WindowTaskbar` — and the
default ✕ and – controls are disabled. Two consequences worth relying on:

- a second `requestClose` for the same window joins the pending one and gets the same promise; the
  guard runs once, so the user is never asked twice;
- a guard that throws is a veto, with a dev-mode warning. An unanswered question is not permission.

The pending state is runtime-only: it is on no descriptor, never persists, and a reload during a
pending guard brings back an ordinary window.

### Window results

`open()` hands back `{ id, result }`. `result` is a `Promise<WindowResult<T>>`:

```ts
type WindowResult<T> = { ok: true; data: T } | { ok: false; reason: 'closed' | 'restored' }
```

The window settles it from its own content — `resolve(data)` settles `{ ok: true, data }` and
closes, `dismiss()` settles `closed` and closes — and the store settles it everywhere else:

- **it never hangs.** The ✕, `close()`, `closeAll()`, `maxWindows` eviction and an owner closing
  its child all settle `closed`;
- a value answered by `resolve()` survives the close it performs — a window answers once;
- a guard that refuses a `requestClose` leaves both the window and its result open;
- a deduped `open()` joins the existing window *and* its answer: one window per entity, one answer,
  both callers hear it;
- a **restored** window settles `{ ok: false, reason: 'restored' }` before anything can await it.
  Its opener belongs to a previous page load; this is the one place the descriptor model and a
  promise API genuinely disagree, and the library says so rather than hanging.

`resultOf(id)` is the same promise for a window the caller did not open; an id the store no longer
has answers `closed`. Results live in a runtime-only map beside the close guards — no descriptor
field, no `SCHEMA` change, nothing persisted (`src/state.ts`).

The handle is not string-compatible on purpose. In dev it warns once when it is coerced to a
string, which is what a pre-0.2 call site does; in production it coerces to `[object Object]`.

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

From anywhere inside a window, a keymap covers what the pointer can do and the pointer alone cannot.
Every action carries two chords — the platform's own, and one that survives the window manager:

| Action | Familiar | Survives |
| --- | --- | --- |
| left, right, maximize, restore | `Meta`+`←` / `→` / `↑` / `↓` | `Ctrl`+`Shift`+ the same arrow |
| the four quarters | `Meta`+`Shift`+arrow, clockwise from the top-left | `Ctrl`+`Shift`+`1`…`4`, reading order |
| next / previous window by `z` | `Alt`+`` ` `` / `Alt`+`Shift`+`` ` `` | `Ctrl`+`` ` `` / `Ctrl`+`Shift`+`` ` `` |

The first column is what a user already has in their fingers, and on most desktops it never reaches
the page: Windows takes `Win`+arrow for Snap Assist, GNOME and KDE take `Super`+arrow for tiling,
GNOME takes `Alt`+`` ` `` for switch-group, and macOS Chrome reads `Cmd`+`←` as Back. A grab happens
above the browser — it cannot be detected, warned about or overridden — so the second column is one
modifier away from everything a desktop reserves, and is what the feature actually runs on.

**Every chord acts on the active window** — the top non-minimized one, the same `activeId` that
carries `data-vw-active` — from wherever focus is on the page. One listener on the document, in the
plugin's effect scope, removed when the app unmounts. Clicking a window both raises it and focuses
it, so the window on top is the window the keyboard is talking to.

The snap chords call the same `snap(id, zone, view)` the drop path calls, so the keyboard cannot
land anywhere the pointer cannot, and they obey the same gates: `snap.enabled`, the window's own
flags, and the inertness below `mobileBreakpoint`. A keystroke aimed at an `<input>`, `<textarea>`
or `contenteditable` is the text field's — on macOS `Meta`+`←` is line-start, and `Ctrl`+`Shift`+
arrow is word-select — and content that calls `preventDefault()` keeps the key, since the listener
is on the bubble phase.

Every binding is movable, an override replaces both chords for its action, and
`keymap: { enabled: false }` removes all of them. `focusNext()` / `focusPrev()` are on the store
either way, for a consumer building their own shortcuts.

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

## Pinned (always-on-top) windows

`fixed: true` — as an `open()` option or a `WindowSpec` default — opens a window above every other
one, and gives it a pin button in its own header to let go again.

- **A second z band.** A pinned window renders at `zIndexBase + topZ + z`, an unpinned one at
  `zIndexBase + z`. Since `z` is always positive, every pinned window outranks every unpinned one,
  and pinned windows keep their relative order. `focus()`, `activeId` and everything persisted are
  untouched — there is still one stack.
- **Inert to geometry.** No drag, no resize grips, no arrow-key nudge, no maximize double-click, and
  `snap()` refuses — which is what makes the keymap chords no exception. One `interactive`
  predicate in `BaseWindow`, so a window can never be half pinned.
- **Still closable and minimizable.** The ✕ and – keep working, and a minimized pinned window
  appears in the taskbar like any other.
- **Runtime-only, and toggleable.** Pin state lives in a reactive map beside `docks`, not on the
  descriptor: it is toggled at runtime, so it cannot be a persisted capability without the schema
  moving. The accepted cost is that a reload brings a pinned window back unpinned and draggable,
  exactly as it brings a snapped one back undocked.
- **Opt-in per window.** Mentioning `fixed` at all — `fixed: false` included — is what makes a
  window pin-capable and gives it the button. A window that never mentions it renders exactly as it
  did before the feature existed.
- **Store API** — `isPinned(id)`, `isPinnable(id)`, `setPinned(id, boolean)`. No new event type: the
  map is reactive and drives the view directly. Pinning drops any snap, the same reasoning a manual
  resize uses, and keeps the geometry.

---

## Control labels

The default `–`, `✕` and pin controls are glyphs, and the library ships no strings — `labels` is
where their accessible names come from.

- **`aria-label` only, no defaults.** `labels: { minimize, close, pin }` on the options, and the
  same key on a `WindowSpec` or an `open()` call. An English default would be wrong in every app
  that is not English, so an unnamed control renders no attribute at all.
- **Merged key by key** — `open()` over the component's spec over the app-wide option, so a window
  that renames only its ✕ keeps the app-wide `Minimize`. `labelsFor(id)` is the effective answer.
- **The pin is a toggle.** It carries `aria-pressed` with its state, so one name covers both
  directions.
- **Runtime-only.** Labels belong to the locale of the running app, not to the window: they never
  reach the descriptor or storage, and the app-wide option is read again on the next load.
- **A dev warning, once per app**, when a frame renders a default control with no name and no
  `controls` slot. Production is silent, and a replaced `controls` slot is never warned about.

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
- **Cross-tab safe by default** — every blob carries the writing tab's token in its envelope (not on
  a descriptor, so `SCHEMA` does not move). A `storage` event carrying anything this tab did not
  write stops that tab from persisting, permanently: regaining focus does not resume it, only
  `onExternalChange(info)` → `info.resume()`, which re-reads and hydrates first. Ignoring the
  report leaves the tab stale, which is the safe half of the trade. Adapters other than
  `localStorage` emit no `storage` events and silently keep the old last-writer-wins behaviour.

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
(minimized only), `all`, `active`, `closing(id)` (true while that window's guards are deciding),
and the `restore`, `close`, `requestClose`, `focus`, `minimize` actions, plus `registerFocusTarget` — bind it as `:ref="registerFocusTarget"` on the element that
should take focus when the last window is minimized.

---

## Inside a window's content

`useWindowContext()` gives content its own `descriptor`, plus `setTitle`, `minimize`, `close`,
`requestClose`, `onBeforeClose`, `closing` (a computed, true while this window's guards are out),
`resolve(data)` and `dismiss()` (settle this window's result and close it), and `isRestored` (true
when this mount came from storage rather than a fresh `open()`). `useWindowContext<T>()` types what
`resolve` accepts.

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
- `aria-label` on the dialog from the window title; the snap ghost is `aria-hidden`; the default
  header controls take their names from `labels`, and the pin button carries `aria-pressed`.

---

## Responsive

Below `mobileBreakpoint` (default 768px) a window goes fullscreen (`100vw`/`100dvh`) and drag and
resize are disabled — a floating window at that size is unusable.

---

## Typing

- **Typed `open()`** — `useWindows<typeof components>()` checks the name against your components
  map and the props against that component. Props stay required when the component requires them
  and optional when it does not.
- **Typed results** — a `WindowSpec` may carry a type-only `result` marker
  (`result: null as unknown as SavedItem`), which types `handle.result`. Nothing reads the value:
  `resolveOptions()` strips the key exactly as it strips the async ones.
- **Graceful degradation** — a component whose props cannot be inferred (a plain object component,
  a loader whose module type cannot be seen) falls back to `Record<string, unknown>` rather than
  becoming a type error. A library that cannot type your window must not refuse to open it.
- `windowId` is excluded from the caller's props: `WindowHost` supplies it.
- Full public type surface is re-exported from `src/index.ts`.

---

## Styling

- **Structure is inline** — the library is fully functional with no stylesheet imported.
- **Optional baseline** at `@korneevec/vue3-dialogs-lib/style.css`, cosmetics only.
- **Theming through `--vtd-*` custom properties** — font, radius, border, shadow, backgrounds,
  foregrounds, padding, accent, button hover, ghost fill/outline, and active-window border/shadow.
  Each is read through a private `--_vtd-*` holding the default, so setting one on `:root`, a theme
  class, or inline on `<html>` wins by inheritance with no selector to out-specify.
- **Dark mode defaults** under `prefers-color-scheme: dark`, still as fallbacks, so consumer values
  keep winning.
- Stable hooks: `.vw`, `.vw__head`, `.vw__title`, `.vw__body`, `.vw__foot`, `.vw__btn`, `.vw__grip`,
  `.vw-ghost`,
  `[data-vw-active]`, `[data-vw-zone]`, `[data-vw-grip]`, `[data-vw-nodrag]`, `[data-vw-state]`.

---

## Motion

- **The library owns the state machine, the consumer owns the motion** —
  `data-vw-state="entering" | "open" | "leaving"` on the `<dialog>`. `WindowHost` keeps a leaving
  frame mounted so it can be animated out, then unmounts it.
- **One property, no second API** — the retention is the computed value of
  `--vtd-motion-duration` read off the window element, so a consumer override, a media query and
  `prefers-reduced-motion: reduce` all work through it. Unreadable (no stylesheet, no DOM) means
  `0ms` and instant removal; the retention is capped at 1000ms regardless.
- **A minimized window's content is still unmounted immediately** — the frame lingers, never the
  content. A closing window keeps its content while it fades.
- **Fly to the taskbar, optionally** — `setTaskbarRect(id, rect)` from `WindowTaskbar`'s slot puts
  `--vtd-min-x`, `--vtd-min-y` and `--vtd-min-scale` on a minimizing frame; without it, a plain
  fade. Runtime-only, never persisted.
- Baseline `style.css` ships a 180ms fade and scale, `0ms` under `prefers-reduced-motion`.

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
