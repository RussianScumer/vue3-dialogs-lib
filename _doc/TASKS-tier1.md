# Tier 1 tasks — VW-01 … VW-10

> Execution tasks for all of [ROADMAP-gaps.md](./ROADMAP-gaps.md) Tier 1, in build order.
> One task per branch, one PR each. Read the roadmap section named in each task before starting;
> it holds the reasoning, this file holds the contract.
>
> **Decisions taken**, superseding the open questions in the roadmap:
>
> - **§4 → owned child windows.** A window may own a child that renders above it and makes *only
>   its owner* `inert`. No top layer, no page-wide backdrop, no focus trap — the `.showModal()`
>   non-goal stands.
> - **§2 → `open()` returns `{ id, result }`.** Breaking change, taken deliberately before `1.0`
>   rather than carried as a parallel `openFor()`.

---

## Global constraints

Apply to every task in this file. A PR that violates one of these is rejected regardless of
whether it works.

1. **`SCHEMA` does not move.** No task here changes the persisted shape. If you believe a change is
   needed, stop and raise it — do not bump the version.
2. **`WindowDescriptor` does not gain persisted fields.** New per-window state that must not
   persist goes in a runtime-only reactive structure alongside the existing `docks` map and
   `restoredIds` set, outside the watched `s` object. Adding a field to the descriptor wakes the
   persistence watcher and changes the schema — both are failures.
3. **Zero new runtime dependencies.** Vue 3.5+ peer only. Dev dependencies for tests are fine.
4. **No user-facing strings in the library.** `aria-label`s and visible text come from consumers.
   Dev-mode `console.warn` is exempt.
5. **SSR-safe.** Every `window` / `document` / `matchMedia` access guarded; nothing at module
   scope. `src/__tests__/ssr.spec.ts` must keep passing untouched.
6. **The existing suite passes untouched.** If a test needs to change, that is a signal the task is
   out of its lane — raise it rather than editing the assertion.
7. **The library works with no stylesheet imported.** Structure stays inline; `style.css` is
   cosmetics only. A task that makes the library depend on the baseline sheet is wrong.
8. **Tests colocated** in `src/__tests__/`. DOM-level work goes in vitest browser mode
   (Playwright provider), not jsdom — `HTMLDialogElement` support there is unreliable.

---

## VW-01 — Audit the ESC path

**Roadmap:** §10 · **Size:** S · **Blocks:** VW-05, VW-06

### Goal

Establish what actually closes/minimizes a window on ESC today. The current `@cancel`
handler in `BaseWindow.vue` is suspected dead code: `HTMLDialogElement`'s `cancel` event and
ESC-to-close fire only for dialogs opened with `showModal()`. This library uses `.show()`.

### Do

- Write a browser-mode test asserting ESC on a focused window minimizes it. Run it **before**
  touching anything and record whether it passes.
- If `@cancel` never fires: delete the handler and implement ESC via a `keydown` listener scoped to
  the window element.
- Either way, the ESC handler must ignore the event when:
  - `event.defaultPrevented` is already true (content handled it — the documented escape hatch);
  - the event target is inside the window but the window is not the active one;
  - the target is an element with an open native picker (`<select>`, `<input type="date">`) — the
    browser consumes ESC first, so this falls out of `defaultPrevented` on most engines; assert it
    rather than assume it.
- Update the `cancel` bullet in `FEATURES.md` to describe what the code actually does.

### Files

`src/BaseWindow.vue`, `src/__tests__/` (new spec), `FEATURES.md`

### Done when

- A test proves ESC minimizes the active window.
- A test proves ESC inside an open `<select>` in a window does **not** minimize it.
- A test proves ESC in content that calls `preventDefault()` does not minimize.
- ESC on a non-active window does nothing.
- `FEATURES.md` no longer claims behaviour the code does not have.

### Out of scope

Any change to what ESC *does* (minimize stays minimize). Focus movement — that is VW-04.

---

## VW-02 — Body scroll and sticky footer

**Roadmap:** §5 · **Size:** S · **Blocks:** nothing (but unblocks realistic demo content)

### Goal

A window has a fixed `h` the user can shrink. Content taller than the frame currently escapes it
and takes the action buttons with it.

### Do

- `overflow: auto` on `.vw__body` — in the **inline structural styles**, not `style.css`, since the
  library must be functional without the sheet (global constraint 7). This is structure, not
  cosmetics.
- Add `.vw__foot` as a stable class hook: an optional `footer` slot on `BaseWindow`, rendered after
  `.vw__body`, that does not scroll. The window becomes a three-row grid
  (`auto` / `1fr` / `auto`) so header and footer are pinned and only the body scrolls.
- Footer renders nothing and occupies no space when the slot is unused.
- Baseline `style.css`: separator border and padding for `.vw__foot`, cosmetics only.
- `playground/`: one window with long content and a footer with two buttons.

### Files

`src/BaseWindow.vue`, `style.css`, `playground/`, `FEATURES.md`, `docs/recipes.md`

### Done when

- Content 3× the window height scrolls inside `.vw__body`; header and footer stay put.
- Resizing the window smaller keeps the footer visible and shrinks the scroll area.
- A window with no `footer` slot renders identical DOM height to before this change.
- Works with `style.css` not imported.

### Out of scope

Scroll shadows, overscroll behaviour, virtualisation.

---

## VW-03 — Async loading and error states

**Roadmap:** §7 · **Size:** M · **Blocks:** nothing

### Goal

A bare loader function is wrapped in `defineAsyncComponent` with no `loadingComponent` or
`errorComponent`, so a slow chunk is an empty window and a failed chunk is an empty window
forever. And a content component that throws currently propagates up through `WindowHost` and can
take every other window with it.

### Do

- `WindowSpec` accepts `loadingComponent`, `errorComponent`, `delay`, `timeout`; `createWindows`
  accepts the same four as global defaults. Per-component wins. Pass them straight through to
  `defineAsyncComponent`. Resolution stays memoized.
- `onErrorCaptured` in `BaseWindow.vue`: a throwing content component renders the resolved
  `errorComponent` (or nothing plus a dev warning) **inside its own frame**, returns `false` to
  stop propagation, and leaves every other window untouched. The window stays draggable,
  resizable and closable in the error state — the user must be able to get rid of it.
- The error component receives `{ error, retry, windowId }`; `retry` re-mounts the content by
  bumping a local key.

### Files

`src/options.ts`, `src/types.ts`, `src/BaseWindow.vue`, `src/__tests__/`

### Done when

- A component whose loader rejects renders the error state, and the other open windows still
  render and still respond to drag.
- A component that throws in `setup()` does the same.
- `retry` re-runs the loader and mounts on success.
- Resolution memoization is unchanged — assert a loader is called once for two windows of the same
  name.
- No new descriptor field; error state is local to `BaseWindow`.

### Out of scope

Retry backoff, offline detection, Suspense.

---

## VW-04 — Focus destinations on minimize and close

**Roadmap:** §8 · **Size:** M · **Depends on:** VW-01

### Goal

`FEATURES.md` says minimize does not move focus. But minimize unmounts the content, so focus lands
on `<body>` and a keyboard user is dumped at the top of the page. Same when the active window is
closed.

### Do

Define and implement the destination chain, in order:

1. the next window's header — highest `z` among non-minimized, excluding the one leaving;
2. the taskbar, if the consumer opted in (below);
3. the recorded opener element, if it is still in the document;
4. `document.body` as the acknowledged last resort.

- `WindowTaskbar` exposes `registerFocusTarget(el)` in its slot props; when a consumer calls it,
  the taskbar becomes step 2 for **minimize only** (not close — a closed window has no taskbar
  button to focus).
- Focus moves only if focus was inside the leaving window at the time. If the user had already
  moved focus elsewhere, leave it alone.
- Existing behaviour that must not regress: restored windows do not steal focus on page load, and
  only the top window takes focus on hydrate.

### Files

`src/BaseWindow.vue`, `src/WindowTaskbar.vue`, `src/state.ts` (focus bookkeeping), `src/types.ts`,
`src/__tests__/`

### Done when

- Minimizing the active window with focus inside it moves focus to the next window's header.
- Minimizing the only window with no registered taskbar target moves focus to the opener.
- Minimizing a **background** window while focus is elsewhere does not move focus.
- Closing the active window follows the same chain, skipping the taskbar step.
- Hydration focus behaviour is unchanged — existing tests untouched.

### Out of scope

Focus trapping (non-goal), `Alt+Tab`-style switching (that is §6).

---

## VW-05 — Window transitions and the leaving lifecycle

**Roadmap:** §1 · **Size:** L · **Depends on:** VW-01, VW-04 · **Blocks:** VW-06

### Goal

Windows appear and disappear in one frame, and minimize does not visually connect to wherever the
window went. Introduce a leaving lifecycle in `WindowHost` and a CSS surface for it — the library
owns the state machine, the consumer owns the motion.

### Do

- `data-vw-state="entering" | "open" | "leaving"` on the `<dialog>`, driven by `WindowHost`.
- `WindowHost` keeps a leaving window in the render tree for the transition duration, then
  unmounts. `close()` and `minimize()` stay synchronous in the store — the store is the truth, the
  host is just slower to let go. A window removed from the stack must never be able to linger
  indefinitely: hard-cap the retention and clear it on `close()` of the same id, on `closeAll()`,
  and on host unmount.
- Duration read from the computed value of `--vtd-motion-duration` on the window element, so
  `prefers-reduced-motion` and consumer overrides both work without a second API. Guard
  `getComputedStyle` for SSR; fall back to `0ms` when unreadable.
- Baseline `style.css`: fade + scale on enter, reverse on leave, `--vtd-motion-duration: 0ms` under
  `prefers-reduced-motion: reduce`.
- **Minimize target (optional):** `WindowTaskbar`'s slot exposes `setTaskbarRect(id, rect)`; when
  set, the leaving window gets `--vtd-min-x`, `--vtd-min-y`, `--vtd-min-scale` so the baseline
  sheet can fly it towards the button. Absent rect → plain fade. Rect is runtime-only.

### Files

`src/WindowHost.vue`, `src/BaseWindow.vue`, `src/state.ts`, `src/WindowTaskbar.vue`, `style.css`,
`src/__tests__/`, `docs/how-it-works.md`

### Done when

- Opening a window sets `entering`, then `open` on the next frame.
- Closing keeps the element mounted for the duration, then removes it — assert with a spy on the
  content's `onUnmounted`.
- **No leak:** open and close 50 windows in a loop; after the duration elapses the render tree
  holds zero `<dialog>` elements. Also assert `closeAll()` mid-transition leaves none behind.
- With `prefers-reduced-motion: reduce`, a closed window leaves the tree in the same tick class as
  before this change — no 300ms hang.
- Content of a minimized window is still unmounted (the headline claim, existing test 8, must
  still pass — the leaving window holds the frame, not the content).
- Works with `style.css` not imported: no duration, instant removal, no visual regression.

### Out of scope

Snap ghost animation, resize/drag inertia, spring physics.

### Note

This is the riskiest task in the set. The failure mode is windows that never unmount, which looks
like a memory leak in production and passes a naive test suite. The 50-window loop assertion is not
optional.

---

## VW-06 — Async close guards

**Roadmap:** §3 · **Size:** M · **Depends on:** VW-05

### Goal

`onBeforeClose()` vetoes synchronously, so a consumer cannot show a confirm and await the answer —
which is the only reason a close guard exists.

### Do

- `type CloseGuard = () => boolean | Promise<boolean>`. `requestClose(id)` awaits the per-window
  guard, then the app-wide `beforeClose`, and resolves `false` if either vetoes. Order unchanged.
- Runtime-only `closing` flag (constraint 2) while a guard is pending, exposed on the window
  context and in `WindowTaskbar`'s slot props so consumers can show a pending state.
- `BaseWindow` disables the default close and minimize controls while `closing` is true.
- **Re-entrancy:** a second `requestClose` for the same id while one is pending returns the *same*
  promise. Do not run the guard twice.
- A guard that throws is treated as a veto, and warns in dev.
- `close(id)` stays unconditional and ignores `closing` entirely — `closeAll()` on logout must
  never be blockable. This is load-bearing; add a test that says so.
- A minimized window still has no guard of its own (content unmounted) and is covered only by the
  app-wide `beforeClose` — unchanged, but assert it, since async makes it easy to break.

### Files

`src/state.ts`, `src/useWindowContext.ts`, `src/BaseWindow.vue`, `src/WindowTaskbar.vue`,
`src/types.ts`, `src/__tests__/`

### Done when

- A guard resolving `false` after 50ms keeps the window; the close button is disabled meanwhile.
- Two rapid `requestClose` calls run the guard once and settle identically.
- A throwing guard vetoes and warns.
- `close()` and `closeAll()` bypass guards entirely, including mid-pending.
- The pending state is visible in the taskbar slot props.
- No new persisted field; reload during a pending guard restores a normal window.

### Out of scope

Rendering the confirm dialog itself — that is §4, and it is blocked. Until then the playground
uses `window.confirm` to exercise the async path.

---

## VW-07 — Owned child windows

**Roadmap:** §4 (decided: option **a**) · **Size:** L · **Depends on:** VW-06

### Goal

VW-06 lets a window say "wait" before closing, with nothing to ask the question with. A window may
now own a child: rendered above it, blocking interaction with **its owner only**, closing with it.
This is the macOS document-modal sheet, not a page modal.

### Do

- `open(name, props, { owner: id })` marks the new window as owned. Owned windows:
  - render at `owner.z + 1` and move as a group — focusing either raises both, preserving their
    relative order;
  - set `inert` on the **owner's `<dialog>` element only**. Record and restore whatever `inert`
    state was there before, in case of nesting;
  - are **not persisted** and are dropped on hydrate. A confirm dialog must never survive a
    reload. This is why `owner` lives in a runtime-only map (constraint 2) and not in the
    descriptor, and why `SCHEMA` does not move;
  - do not count toward `maxWindows` and never trigger eviction — a confirm must not close a real
    window to make room;
  - skip dedupe;
  - are `closable`, and not `minimizable` (a sheet with no owner on screen is orphaned UI).
- Owner constraints while it has a live child: `minimize(ownerId)` is a no-op with a dev warning;
  `close(ownerId)` closes the child first, then the owner; `requestClose(ownerId)` is refused
  outright — the child is the question, answer it first.
- ESC on an owned child **dismisses the child** rather than minimizing it, overriding VW-01's rule.
  ESC on an inert owner does nothing, because it is inert.
- Nesting: a child may itself own a child. Cap the chain (3 is plenty) and detect cycles at
  `open()` — throw immediately, as unknown names already do.
- Focus: opening a child moves focus into it; closing it returns focus to the owner, reusing
  VW-04's chain.
- `playground/`: replace VW-06's `window.confirm` with a real owned confirm window.

### Files

`src/state.ts`, `src/BaseWindow.vue`, `src/WindowHost.vue`, `src/persist.ts`, `src/types.ts`,
`src/options.ts`, `playground/`, `docs/recipes.md`, `src/__tests__/`

### Done when

- A child sets `inert` on its owner and on nothing else — a sibling window stays fully
  interactive, including drag.
- Closing the owner closes the child; closing the child leaves the owner and clears `inert`
  exactly back to its prior value.
- An owned window is absent from the persisted blob, and a hand-crafted blob containing one is
  dropped on hydrate without crashing.
- Opening 20 children with `maxWindows: 8` evicts nothing.
- A cycle (`open(..., { owner })` where owner descends from the new window) throws at call time.
- ESC on a child dismisses it; ESC on the owner does nothing.
- Focus returns to the owner on child close.

### Out of scope

`alertdialog` semantics, a bundled confirm component, page-wide backdrop, focus trap.

---

## VW-08 — Window results (breaking `open()`)

**Roadmap:** §2 (decided: break the signature) · **Size:** M · **Depends on:** VW-07

### Goal

`open()` returns an id, so every "open an editor, await the saved entity" flow has to be built out
of `on('close')` plus a side channel. Make the result a first-class part of the API.

### Do

- `open()` returns `{ id, result }` where `result` is
  `Promise<{ ok: true, data: T } | { ok: false, reason: 'closed' | 'restored' }>`.
- `useWindowContext()` gains `resolve(data)` — settles the result, then closes — and `dismiss()`,
  which settles `{ ok: false, reason: 'closed' }`.
- Settling rules, all of which need a test:
  - a window closed by any path (control, `close`, `closeAll`, `maxWindows` eviction, owner
    closing a child) settles as `closed`. **A result promise never hangs.**
  - a **restored** descriptor has no live opener — possibly from a previous page load. Its
    `result` settles `{ ok: false, reason: 'restored' }` immediately. This is the one place where
    the descriptor model and a promise API genuinely disagree; it gets its own README paragraph,
    not a footnote.
  - the resolved value is **never persisted** and is not part of the descriptor.
- Typing: `WindowSpec` accepts an optional result type so `open('itemEditor')` infers
  `data`. Falls back to `unknown` when it cannot be inferred — same graceful-degradation rule as
  props today. A library that cannot type your result must not refuse to open the window.
- Migration: `CHANGELOG` entry marked breaking, README examples updated, and a dev-mode warning
  if the return value is used where a string is expected (`String(handle)` → warn once).

### Files

`src/state.ts`, `src/useWindowContext.ts`, `src/types.ts`, `src/index.ts`, `README.md`,
`CHANGELOG.md`, `playground/` (type test), `src/__tests__/`

### Done when

- `resolve(data)` settles `{ ok: true, data }` and closes the window.
- Every close path settles `closed`; assert **zero pending promises** after `closeAll()`.
- A hydrated window's `result` settles `restored` synchronously on first access.
- The compile-time type test in `playground/` covers inferred, un-inferable and no-result cases.
- No new persisted field; the persistence suite passes untouched.

### Out of scope

Passing a result *into* a window, cancellation tokens, multiple results from one window.

---

## VW-09 — Keyboard snapping and window switching

**Roadmap:** §6 · **Size:** M · **Depends on:** VW-04

### Goal

Snapping is the headline feature and it is pointer-only: arrow keys move a window 10px and cannot
put it on the left half. And there is no way to move focus between windows without a mouse.

### Do

- `focusNext()` / `focusPrev()` on the store, shipped **regardless of the keymap** — cycling by
  `z` among non-minimized windows, wrapping, focusing the header.
- Default bindings, all behind `keymap` in `createWindows` options:

  ```
  Meta/Super + Arrow          -> snap left | right | max | none
  Meta + Shift + Arrow        -> the four quarters
  Alt + ` / Alt + Shift + `   -> focusNext / focusPrev
  ```

- `keymap: { enabled: false }` kills it entirely; individual bindings are overridable. Defaults are
  on, but `Meta+Arrow` collides with real OS window managers on some platforms, so this must be
  escapable without forking.
- **Ignore the event when the target is editable** — `input`, `textarea`, `contenteditable`. On
  macOS `Meta+Left` is line-start in a text field and stealing it is unforgivable.
- Respect everything the pointer path respects: the window's `draggable`/`resizable` flags,
  `snap.enabled`, `snap.insets`, and inertness below `mobileBreakpoint`.
- The keyboard snap calls the **same** `snap(id, zone, view)` the drop path calls. No second
  implementation.

### Files

`src/state.ts`, `src/BaseWindow.vue`, `src/options.ts`, `src/types.ts`, `src/__tests__/`,
`docs/recipes.md`

### Done when

- `Meta+ArrowLeft` produces exactly `snapRect('left', …)` — **shares the assertion with existing
  test 11**, so the keyboard and pointer paths cannot drift apart.
- The same keystroke inside a focused `<input>` inside a window does nothing to the window.
- `Alt+\`` cycles focus by `z`, skips minimized windows, and wraps.
- `keymap: { enabled: false }` restores today's behaviour exactly.
- Below `mobileBreakpoint`, snap keystrokes are inert.
- A non-`resizable` window ignores snap keystrokes.

### Out of scope

Chord sequences, per-window keymaps, a shortcuts cheatsheet UI.

---

## VW-10 — Cross-tab persistence safety

**Roadmap:** §9 · **Size:** M · **Depends on:** nothing (land last; touches `persist.ts` only)

### Goal

Two tabs sharing a `persist.key` silently overwrite each other. Last writer wins, and a window
closed in one tab reappears in the other on reload. Full merge is out of scope; **silent data loss
is not**.

### Do

- Listen for `storage` events on the configured key. Detect a foreign write — a value that did not
  come from this tab's own last write (compare against a per-tab write token stored in the blob's
  envelope, **not** in the descriptor).
- On detecting one, the non-focused tab **stops persisting** and reports. Default behaviour, no
  configuration needed: better a stale tab than a tab that eats another tab's session.
- `onExternalChange(info)` option lets the consumer decide: ignore, prompt to reload, or call
  `hydrate()` explicitly. Fires once per foreign write, not per key.
- A tab that regains focus does **not** silently resume writing — it stays stopped until the
  consumer calls `hydrate()` or the page reloads. Resuming is how the data loss happens.
- Guard everything: `addEventListener` on `window` only when it exists, listener removed in the
  plugin's `effectScope` teardown alongside the viewport tracker. A storage adapter that is not
  `localStorage` (IndexedDB, server-backed) emits no `storage` events — degrade to today's
  behaviour silently, do not warn.

### Files

`src/persist.ts`, `src/createWindows.ts`, `src/options.ts`, `src/types.ts`, `src/__tests__/`,
`README.md`

### Done when

- A simulated foreign `storage` event stops persistence in the receiving tab and fires
  `onExternalChange` exactly once.
- The tab's **own** writes never trigger it — assert across a burst of debounced writes.
- After stopping, further store mutations write nothing.
- A non-`localStorage` adapter behaves exactly as it does today, with no warning.
- The listener is removed on `app.unmount`; `ssr.spec.ts` passes untouched.

### Out of scope

Merging, CRDTs, `BroadcastChannel` live sync, server-backed sessions, leader election.

---

## Suggested sequencing for the agent

```
VW-01 ─┬─ VW-04 ── VW-05 ── VW-06 ── VW-07 ── VW-08
       │                                │
VW-02 ─┤                                └─ (VW-09 after VW-04)
VW-03 ─┘
VW-10  independent, land last
```

Strictly serial through the spine: **VW-01 → VW-04 → VW-05 → VW-06 → VW-07 → VW-08.**

- **VW-02 and VW-03** touch nothing the spine touches and can run in parallel from the start.
- **VW-09** only needs VW-04; it can run in parallel with VW-05/VW-06 if you have capacity.
- **VW-10** is isolated in `persist.ts`. Land it last so it rebases onto a settled descriptor.
- **VW-05 and VW-06 must not be parallelised** — VW-06's `closing` flag has nothing to attach to
  without VW-05's leaving lifecycle.
- **VW-08 goes last on the spine on purpose.** It is the only breaking change in the set, and
  VW-07 is what gives `resolve()` its canonical use case. Cut the release after it.

Ship `0.2` at VW-08. VW-09 and VW-10 can ride along or follow in `0.2.1`.
