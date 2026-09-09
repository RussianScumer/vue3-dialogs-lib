# Roadmap — gaps

> What `vue-windows` does not do yet, derived from a feature survey of the Vue 3 dialog ecosystem
> (`vue-final-modal`, Reka UI, PrimeVue, Quasar, Element Plus, Vuetify, native `<dialog>` +
> Invoker Commands) read against the current [FEATURES.md](./FEATURES.md).
>
> Entries are grouped by whether they belong before `1.0`, after it, or not at all. Anything that
> is a consequence of the non-modal decision is listed under *Still non-goals* rather than
> silently omitted.

---

## Tier 1 — before `1.0`

These are gaps a consumer hits in the first week, not exotica.

### 1. Open/close/minimize transitions

There is currently no animation surface at all. A window appears and disappears in one frame, and
minimize does not visually connect to the taskbar — which is the one moment where the user needs
to know *where the thing went*.

Not a `<Transition>` wrapper with library-chosen keyframes. The library owns the state machine;
the consumer owns the motion:

```
data-vw-state="entering" | "open" | "leaving"
```

set on the `<dialog>` by `WindowHost`/`BaseWindow`, plus `--vtd-motion-duration` read once so the
host knows when to actually unmount. Baseline `style.css` ships a fade/scale; everything else is
CSS the consumer writes.

Requirements:

- `WindowHost` keeps a leaving window in the render tree until the duration elapses, so `close()`
  stays synchronous in the store but visual;
- `prefers-reduced-motion: reduce` collapses the duration to `0ms` in the baseline sheet, and the
  host reads the computed value rather than assuming;
- the minimize target rect is exposed so a consumer can animate towards its own taskbar button:
  `setTaskbarRect(id, DOMRect)` from `WindowTaskbar`'s slot, read as
  `--vtd-min-x/--vtd-min-y/--vtd-min-scale` on the leaving window. Optional; absent rect means a
  plain fade.

Prior art: VFM's separate `overlayTransition`/`contentTransition`, Reka's `data-state`.

### 2. Window results — `open()` should be awaitable

`open()` returns an id. Every "open an editor, wait for the saved entity" flow therefore has to be
built by the consumer out of `on('close')` plus a side channel. Quasar (`onDialogOK(payload)`) and
Element Plus (`ElMessageBox` returning a promise) both solve this; the descriptor model makes it
*more* natural here, not less, because the result is just another serializable value.

```js
const handle = win.open('itemEditor', { id: 42 })
handle.id                     // string, as today — the return stays back-compatible via valueOf/toString? no: see note
const res = await handle.result   // { ok: true, data } | { ok: false, reason: 'closed' | 'cancelled' }
```

Note on compatibility: do **not** try to make the handle stringify to an id. Change the signature
to return `{ id, result }` and take the break — this lands before `1.0` precisely so it can.

Inside content:

```js
const { resolve, dismiss } = useWindowContext()
resolve(savedItem)     // settles result, then closes
```

Rules that need to be explicit in the types and the README:

- an unresolved window that is closed settles as `{ ok: false, reason: 'closed' }` — never hangs;
- `closeAll()` settles everything outstanding;
- a **restored** window has no live promise (the opener is gone, possibly from a previous page
  load). `handle.result` for a hydrated descriptor settles immediately as
  `{ ok: false, reason: 'restored' }`. This is the one place where the descriptor model and a
  promise API genuinely disagree, and the docs must say so rather than paper over it;
- the resolved value is **not** persisted — it is not part of the descriptor.

### 3. Async close guards

`onBeforeClose()` vetoes, but if the guard is synchronous a consumer cannot show a confirm and
await the answer — which is the only reason a close guard exists. Element Plus's
`beforeClose(action, instance, done)` is the reference: it can flip the confirm button into a
loading state and call `done` later.

```ts
type CloseGuard = () => boolean | Promise<boolean>
```

`requestClose(id)` becomes `Promise<boolean>` (it already is), and additionally:

- sets `closing: true` on the descriptor (runtime-only, like snap state) so `BaseWindow` can
  disable the close button and the taskbar can render a spinner;
- is re-entrant-safe: a second `requestClose` while one is pending returns the same promise
  instead of running the guard twice;
- the app-wide `beforeClose` may also be async, and runs after the per-window guard as today.

### 4. Something to render a confirm in

Tier 1 item 3 gives a window the ability to say "wait" — with nothing to ask the question with.
Two options; pick one, do not ship both:

**(a) Owned child windows.** `open(name, props, { owner: id, modal: 'owner' })` — a window that
renders above its owner, blocks pointer events on the owner only (an `inert` attribute on the
owner's `<dialog>`, not a full-screen overlay), moves with focus as a group, and closes with the
owner. This is the macOS sheet / document-modal model and it fits the manager: still a plain
descriptor, still no top layer, still no global backdrop.

**(b) Nothing, plus a documented recipe** — the consumer wires their existing modal library into
the guard.

Recommendation: **(a)**. `inert` on one element is cheap, it is the missing half of the close-guard
feature, and "confirm before closing" is the single most common thing a window manager is asked
for. It is not the same as the `.showModal()` non-goal — no top layer, no page-wide backdrop, no
focus trap.

### 5. Body scroll and sticky chrome

`.vw__body` needs `overflow: auto` in the baseline sheet, and the documented content contract needs
a sticky-footer pattern. A window has a fixed `h`; content taller than it currently escapes the
frame and takes the action buttons with it. Every dialog library in the survey handles this; this
one has a *harder* version of the problem because the user can resize the frame under the content.

Add `.vw__foot` as a stable class hook alongside `.vw__head` / `.vw__body`, sticky by default in
the baseline sheet.

### 6. Keyboard parity for snapping and window switching

Snapping is the headline feature and it is pointer-only. Arrow keys move a window 10px at a time;
they cannot put it on the left half. Meanwhile there is no way to move focus *between* windows
without the mouse.

```
Meta/Super + ArrowLeft|Right|Up|Down   -> snap(id, zone)   (left/right/max/none)
Meta + Shift + Arrow                   -> quarters
Alt + `  /  Alt + Shift + `            -> focusNext() / focusPrev()
```

All of it behind `keymap: { enabled: true, ... }` in `createWindows` options, defaulting to
**enabled but overridable**, because `Meta+Arrow` collides with the real OS window manager on some
platforms and consumers must be able to remap or kill it. Ship `focusNext`/`focusPrev` on the store
regardless of the keymap — they are useful to a consumer building their own shortcuts.

### 7. Async component loading and error states

A bare loader is wrapped in `defineAsyncComponent` automatically, with no `loadingComponent` or
`errorComponent`. A failed chunk is an empty window with a title.

- `loadingComponent` / `errorComponent` / `delay` / `timeout` accepted per-component in
  `WindowSpec` and globally in options;
- `onErrorCaptured` in `BaseWindow` so a throwing content component degrades to an error state
  *inside its own frame* rather than tearing down the host and every other open window. This is a
  window manager: one bad window must not take the desktop with it.

### 8. Focus destination on minimize and close

FEATURES says minimize does not move focus — but minimize unmounts the content, so focus lands on
`<body>` and the keyboard user is at the top of the page. Same on close of the active window.

Define it: focus moves to the next window's header (highest `z`, non-minimized), or, if none,
returns to the opener element already tracked for close. `WindowTaskbar`'s slot can opt in to
receiving focus instead via a `focusOnMinimize` flag, since for many consumers the taskbar button
is the correct destination.

### 9. Cross-tab persistence

`persist` writes to `localStorage` from a debounced deep watcher. Two tabs with the same key
silently overwrite each other, last writer wins, and a window closed in one tab reappears in the
other on reload.

Minimum viable: a `storage` event listener that detects a foreign write and **stops persisting**
in the non-focused tab, plus an `onExternalChange` option so the consumer can decide (ignore /
reload / merge). Full CRDT-style merge is out of scope; silent data loss is not.

### 10. Correctness: the `cancel` handler is probably dead code

> `cancel` is prevented — closing on ESC would defeat the point of the library; ESC minimizes
> instead

`HTMLDialogElement`'s `cancel` event and ESC-to-close fire only for **modal** dialogs opened with
`showModal()`. With `.show()` the browser does not react to ESC at all, so `@cancel` never fires
and the ESC-minimize behaviour must be coming from a `keydown` handler — or not working. Verify,
then either delete the handler or document why it stays.

Related, and worth a test: ESC pressed while a `<select>` is open, or inside consumer content that
handles ESC itself, must not minimize the window. Only act on `keydown` whose target is inside the
window and whose `defaultPrevented` is false.

---

## Tier 2 — after `1.0`

| Feature | Sketch | Why it earns its place |
|---|---|---|
| **URL sync** | `router: { query: 'w' }` — serialize open windows into a query param, hydrate from it | Descriptors are already serializable; this gives shareable links and a working Back button. Only `jenesius-vue-modal` in the whole survey does anything comparable, and it does it for plain modals |
| **`alwaysOnTop`** | Capability flag + a second `z` band above the normal one | The flag slot already exists in the descriptor. Trivial once `z` is banded |
| **`tileAll()` / `cascadeAll()`** | Pure functions in `geometry.ts`, same shape as `snapRect` | Cascade already exists for placement; "arrange all" is the same maths applied to the whole stack |
| **Title-bar context menu** | `contextmenu` slot on `BaseWindow`, default: none | The discoverability surface for the keyboard operations in Tier 1 §6. Windows has taught users to look here |
| **`requestAttention(id)`** | Sets a runtime `attention` flag, cleared on focus | The consumer's taskbar needs a way to blink. `on()` already emits enough to build it, but the semantics belong in the library |
| **Shade / roll-up** | `shaded: boolean`, body height collapses to header | Cheaper than minimize when the user wants the window on screen but out of the way. Costs one flag and one CSS rule |
| **Programmatic slots** | `open(name, props, { slots })` accepting render functions | VFM's `useModalSlot()`. Lets one generic "shell" window type host arbitrary content without registering a component. **Breaks serializability** — must be explicitly marked non-persistable and dropped on hydrate |
| **RTL** | `dir` detection: mirror grip order, swap `left`/`right` snap zones and header layout | Currently unaddressed anywhere in the docs. Snapping is where it actually bites |
| **Touch-sized resize grips** | Widen the invisible hit area to 20px on `(pointer: coarse)`, keep the visual at 8px | The 768–1024px tablet band is not fullscreen and not mouse-driven. Eight 8px grips are unhittable with a finger |
| ~~**Default control labels**~~ | *Shipped as VW-19:* `labels: { minimize, close, pin }` app-wide and per window, `aria-label` only, no defaults, dev warning when a control renders unnamed | "No strings in the library" is right for visible text; it used to mean the default controls shipped with *no* accessible name unless the consumer replaced the `controls` slot. `restore` was dropped from the shape: the taskbar is renderless, so its button is the consumer's own markup |

---

## Considered and rejected

- **`showModal()` / the browser top layer / a focus-trap loop** — still rejected, and for the
  original reasons: the top layer would cost the taskbar, `zIndexBase`, the two existing bands and
  the leaving lifecycle, and a trap loop is machinery this library does not want to own.
  *Partly reopened as VW-21:* a page-wide backdrop and page-wide modality now exist as an **opt-in
  per window** — `modal: true` draws a scrim and sweeps `inert` across every other window, while
  still calling `show()`. A desktop with no modal open is unchanged. The one hole that leaves,
  Tab walking out of the modal into the consumer's page, is named rather than papered over and
  answered by the opt-in `modal: { inertRoot }` rather than by a trap.
- **`confirm`/`alert`/`prompt` helpers** — still no. Tier 1 §4 gives the mechanism; the dialog is
  the consumer's component.
- **Scroll lock, `reserveScrollBarGap`, `dismissableMask`, `persistent`, `modal-penetrable`,
  swipe-to-close** — consequences of an overlay the library still does not want opinions about.
  VW-21 added the scrim itself and nothing else: it carries no click handler, locks no scroll and
  reserves no gutter. Listing them here so a future reader does not "discover" them as gaps.
- **Tab stacks, docked rails, splitters** — the tiling non-goal stands. Tier 2's `tileAll()` is a
  one-shot geometry command, not a layout model.
- **Persisting snap zones** — the runtime-only placement is a deliberate schema trade, documented
  in the plan. Unchanged.

---

## Build order

Tier 1 items are ordered by dependency, not by value:

1. **§10** — verify the ESC path first; it may invalidate assumptions the rest builds on.
2. **§5** body scroll + `.vw__foot` — pure CSS and a class hook, unblocks realistic demo content.
3. **§7** async loading/error states — no API surface, contained in resolution and `BaseWindow`.
4. **§8** focus destinations — small, and §1 will otherwise bake in the wrong behaviour.
5. **§1** transitions — introduces the leaving-window lifecycle in `WindowHost`; everything visual
   after this point has to respect it.
6. **§3** async guards — needs the `closing` runtime flag and the leaving lifecycle from §1.
7. **§4** owned child windows — needs §3 to have a caller worth existing for.
8. **§2** window results — the signature break; do it once §4 exists so `resolve()` has its
   canonical use case.
9. **§6** keyboard snapping and switching — additive, no shape changes.
10. **§9** cross-tab — isolated in `persist.ts`, safe to land last.

§1–8 are a coherent `0.2`. §2 is the only breaking change in the set; schedule the release
accordingly.

---

## Verification additions

Extending the numbered suite in the plan:

17. Close a window with an async guard that resolves `false` after 50ms → the window stays, the
    close button is disabled while pending, and a second click does not run the guard twice.
18. `await win.open(...).result` settles `{ ok: false, reason: 'closed' }` when the user closes the
    window by its own control; settles `{ ok: true, data }` on `resolve()`; settles
    `{ ok: false, reason: 'restored' }` immediately for a hydrated descriptor.
19. `closeAll()` settles every outstanding result promise — assert no pending promises remain.
20. An owned child window sets `inert` on its owner and only its owner; a sibling window stays
    interactive; closing the owner closes the child.
21. A content component that throws on mount renders the error state inside its own frame while
    every other window keeps rendering.
22. Minimizing the active window moves focus to the next window's header; minimizing the only
    window moves focus to the taskbar or the opener, never to `<body>`.
23. `prefers-reduced-motion: reduce` → a closed window leaves the render tree in the same tick
    class as before transitions existed (no 300ms hang).
24. ESC inside an open `<select>` within a window does not minimize it; ESC on the window header
    does.
25. `Meta+ArrowLeft` snaps left and produces exactly the rect `snapRect('left', …)` returns —
    shares the assertion with test 11, so the keyboard path cannot drift from the pointer path.
26. A `storage` event from another tab stops persistence in the unfocused tab and fires
    `onExternalChange` once.
27. Import with `slots` passed to `open()` → the descriptor is excluded from persistence and the
    window is dropped on hydrate rather than restored empty.
