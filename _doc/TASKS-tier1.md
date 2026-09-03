# Tier 1 tasks — VW-01 … VW-12

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

**Roadmap:** §10 · **Size:** S · **Blocks:** VW-05, VW-06 · **Status:** done on `vw-01-esc-audit`.

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

### Audit findings

Measured in Chromium against the playground, before any code changed:

- `@cancel` is dead. A `.show()` dialog received zero `cancel` and zero `close` events on ESC;
  `cancel` and ESC-to-close are `showModal()` behaviour. The handler is deleted.
- ESC already minimized the active window through the existing `keydown` listener, so the listener
  stayed where it was and only gained guards.
- **A native picker does not set `defaultPrevented`.** With a `<select>` focused, the ESC keydown
  reached the page with `defaultPrevented === false` and the window minimized. The task's
  "assert it rather than assume it" resolves against the assumption, so the guard is on the element
  type: `<select>` and the picker `<input>` types never minimize, popup open or not.
- **"Popup is open" is not an assertable state.** Synthetic key input cannot open a native
  `<select>` popup — `alt+ArrowDown` followed by `ArrowDown` moved the selection from `a` to `b`,
  which only happens with the list closed. This holds for CDP-driven input generally, vitest browser
  mode included, so no test can distinguish an open picker from a focused one.

### Verification

`npx vitest run` runs both projects: 99 jsdom tests and 7 browser tests, 106 total. The browser
project needs `npx playwright install chromium chromium-headless-shell` once.

Two things the browser spec cannot prove, and does not pretend to: a native picker's popup cannot be
opened by driven input, so the picker assertion is on the element type; and the picker guard's own
justification is pinned by a separate test asserting `defaultPrevented === false`, which will fail
loudly if Chromium ever starts marking that keydown handled — at which point the guard can go.

---

## VW-02 — Body scroll and sticky footer

**Roadmap:** §5 · **Size:** S · **Blocks:** nothing (but unblocks realistic demo content) · **Status:** done on `vw-02-body-scroll-footer`.

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

### Notes

- `.vw__body` already carried `overflow: auto` and `flex: 1 1 auto; min-height: 0` inline, so the
  scroll half of this task was in place; the change is the footer row, its class hook and the docs.
- The frame stays a flex column rather than becoming a grid — header `0 0 auto`, body `1 1 auto`
  with `min-height: 0`, footer `0 0 auto` is the same `auto / 1fr / auto` behaviour with no
  restructuring of the existing header and body styles.
- The `footer` slot is host-level, like `header` and `controls`: it applies to every window and
  receives the descriptor, so a consumer branches on `descriptor.name` for a per-type footer.
- Measured in `src/__tests__/layout.browser.spec.ts`, not jsdom: `clientHeight`, `scrollHeight` and
  `getBoundingClientRect()` are all zero there. The spec runs with no stylesheet imported, and
  with `mobileBreakpoint: 0` because the test browser is narrower than the 768px default and a
  mobile window is fullscreen — a different layout question.
- The footer-bottom assertion is against the dialog's `clientHeight`, not its outer rect: the UA
  gives `<dialog>` a 3px border that the library does not clear.

### Verification

`npx vitest run` — 109 tests, 99 jsdom and 10 browser (3 new). Existing specs untouched.

---

## VW-03 — Async loading and error states

**Roadmap:** §7 · **Size:** S · **Blocks:** nothing · **Status:** done on `vw-03-async-error-states`.

### Goal

A window's component is a chunk. Today a slow one is an empty frame with a title, a failed one is
the same empty frame forever, and a component that throws on mount takes `WindowHost` — and every
other open window — down with it.

### Do

- `loadingComponent` / `errorComponent` / `delay` / `timeout` accepted per component on
  `WindowSpec`, and app-wide as `createWindows({ async })`, per-type winning key by key. Passed
  straight to `defineAsyncComponent` in `options.resolve()`.
- These configure the component, not the window: not accepted in `OpenOptions`, stripped from the
  spec before it becomes `defaultsFor(name)`, never on the descriptor (global constraint 2).
- `onErrorCaptured` in `BaseWindow`: the body renders the type's `errorComponent` with the error as
  an `error` prop, the frame keeps its header and controls, and the error does not propagate.
- `data-vw-error` on the `<dialog>` so the state is styleable without the library shipping a string.
- `playground/`: a slow chunk, a chunk that never arrives, and a component that throws on mount.

### Files

`src/types.ts`, `src/options.ts`, `src/BaseWindow.vue`, `src/__tests__/async.spec.ts` (new),
`playground/`, `FEATURES.md`, `README.md`, `docs/recipes.md`, `docs/how-it-works.md`

### Done when

- A pending loader renders `loadingComponent`; the content replaces it when the loader settles.
- A rejecting loader, and a loader that outlives `timeout`, both render `errorComponent` with the
  error.
- A content component that throws on mount renders the error state inside its own frame while every
  other window keeps rendering — roadmap verification 21.
- A throwing type with no `errorComponent` is an empty body and a still-closable window.
- The async keys reach neither `defaultsFor()` nor the descriptor.

### Out of scope

Retry UI, a default error component, error events on the store, `Suspense`.

### Notes

- **The error must not propagate.** Returning nothing from `onErrorCaptured` was tried first, to
  keep `app.config.errorHandler` and Vue's own logging in the loop. It fails the headline
  requirement: an error thrown in a content component's `setup` reaches `WindowHost` mid-patch and
  aborts the whole `v-for`, so the measured result was one dialog rendered instead of two. The hook
  returns `false`, and the error is delivered to the error component as a prop instead — that is
  the consumer's reporting hook.
- The same `errorComponent` covers both failures — a chunk that never arrived, and a chunk that
  arrived and threw — because the difference is not one the user can act on. `errorComponentFor()`
  is on `ResolvedOptions` for exactly this: `BaseWindow` reads what `resolve()` already handed to
  `defineAsyncComponent`.
- With no `errorComponent` registered the body is empty rather than carrying library text, per
  global constraint 4. `data-vw-error` is the hook that makes that state addressable.
- jsdom, not browser mode: nothing here is measured against the UA. The specs mount several apps in
  one file, so they read the store out of the mounted app rather than through `useWindows()`'s
  module-level fallback, which only ever points at one of them.

### Verification

`npx vitest run` — 116 tests, 106 jsdom (7 new) and 10 browser. Existing specs untouched.

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

## VW-11 — Fixed (always-on-top) windows

**Roadmap:** Tier 2 "`alwaysOnTop`", promoted · **Size:** M · **Depends on:** VW-12 (see sequencing)

### Goal

A window pinned above every other window, that cannot be dragged, resized or snapped, and that the
user can unpin from its own header. The Tier 2 sketch ("capability flag + a second `z` band above
the normal one") moved forward, with one change: pin state is toggleable at runtime and therefore
lives outside the descriptor.

**Decision taken:** the pin flag is **runtime-only**, in a reactive map beside `docks`. `SCHEMA`
does not move (constraint 1) and the descriptor gains no field (constraint 2). The cost is
explicit and accepted: a pinned window comes back **unpinned** after a reload, exactly like a
snapped window comes back undocked.

A fixed window stays **closable and minimizable**. Only drag, resize and snap are off.

### Do

- `fixed?: boolean` on `WindowDefaults` in `src/types.ts`, so it works both as a `WindowSpec`
  default and as an `open()` option, with the existing precedence: the `open()` call, then the
  component's spec, then the library default (unset).
- Runtime state in `createStore`, beside `docks` and carrying the same rationale comment:

  ```ts
  const pins = reactive(new Map<string, boolean>())
  ```

  **An entry means the window is pin-capable; the value means it is currently pinned.** A window
  opened without `fixed` gets no entry, is not pin-capable, and renders exactly as it does today.
  This is what keeps the existing suite passing — the "hides the controls a window does not have"
  test asserts a window with no capabilities renders zero `.vw__btn`.
- Store API: `isPinned(id)`, `isPinnable(id)`, `setPinned(id, boolean)`. No new `WindowEventType`:
  the reactive map drives the view directly, and consumers that need to observe pinning already
  have the store. Pinning calls `undock(id)` — an explicit pin outranks a snap, the same reasoning
  the resize grip already uses.
- Clear entries in `close()`, `closeAll()` and `hydrate()` at exactly the places `docks` is cleared.
- Render band, in `BaseWindow.vue`'s `style` computed: a pinned window renders at
  `zIndexBase + s.topZ + d.z`, an unpinned one at `zIndexBase + d.z` as today. Since `d.z` is
  always positive, every pinned window outranks every unpinned one, and pinned windows keep their
  relative order by `z`. `focus()`, `activeId` and everything persisted are untouched.
- Inertness: `canDrag()` and `canResize` return false while pinned, `onHeadDblclick` returns early,
  and the arrow-key path (`onWindowKeydown`, wired through `enabled: interactive`) goes with them.
  One predicate used everywhere — do not introduce a second notion of "interactive".
- Header control: a pin toggle in the default `controls` slot, rendered **after** the close button
  and only when `isPinnable(id)`, marked `data-vw-nodrag`, with `:data-vw-pinned` for styling.
  Appending after close is load-bearing: the existing tests index `.vw__btn` positionally.
  Glyph in the style of the existing `–` / `✕`; no `aria-label` (constraint 4 — the accessible-name
  gap is Tier 2's "Default control labels", not this task).
- The snap ghost in `WindowHost.vue` keeps `z = topZ + 1`. A pinned window sits above it, which is
  correct: nothing can be snapped onto a pinned window anyway.
- Docs: `FEATURES.md`, `README.md` (options table plus a short section), `docs/how-it-works.md`
  (the runtime-state list next to `docks`), and one pinned window in `playground/`.

### Files

`src/types.ts`, `src/state.ts`, `src/BaseWindow.vue`, `src/__tests__/`, `FEATURES.md`, `README.md`,
`docs/how-it-works.md`, `playground/`

### Done when

- A window opened with `fixed: true` renders above a window that is focused after it, and stays
  there across focus changes.
- Its header does not drag, its grips are absent, arrow keys do not move it, and double-clicking
  its header does nothing.
- Its close and minimize controls still work, and it appears in the taskbar when minimized.
- The pin button unpins: the window becomes draggable, resizable and snappable again and drops back
  into the normal band. Pinning again re-pins and drops any snap.
- A window opened without `fixed` renders no pin button and behaves exactly as before — assert the
  `.vw__btn` count is unchanged.
- The pin flag appears nowhere in the persisted blob, and a reload returns the window unpinned and
  draggable. `persist.spec.ts` and `ssr.spec.ts` pass untouched.

### Out of scope

Per-window `zIndexBase`, pinning from the taskbar, a reserved screen region for pinned windows,
"always on top of *these* windows" partial ordering.

---

## VW-12 — Undock on drag, not on click

**Roadmap:** none — reported bug · **Size:** S · **Depends on:** nothing

### Goal

A single click on a maximized window's header must not restore it. Only a double-click toggles
maximize, in both directions; a drag still undocks as it does today.

### Root cause

`onDown` in `src/useWindowDrag.ts` calls `options.onUndock?.(e.clientX)` on `pointerdown`, before
any pointer movement. `BaseWindow.vue` wires that to `win.undockForDrag(d.id, …)`, which restores
the pre-snap geometry and deletes the dock entry. Two consequences:

- a plain click on the header of a maximized window un-maximizes it;
- a real double-click un-maximizes on the first `pointerdown`, so by the time `onHeadDblclick`
  runs, `dockZone(id)` is already `null` and it snaps to `'max'` again. Double-click can maximize
  but can never restore.

The existing "double-clicking the header maximizes, again restores" test passes only because
`trigger('dblclick')` fires no `pointerdown`, so the suite is blind to this.

### Do

- Move the `onUndock` call out of `onDown` and into `onMove`, behind a drag threshold — 4px of
  pointer slop, as a named constant next to `STEP`. It fires at most once per drag.
- On crossing the threshold, call `onUndock(e.clientX)` and then re-seed `start` from the window's
  new geometry and the current pointer position, so the window does not jump twice: the
  pointer-relative header offset that `undockForDrag` establishes must survive the `onMove` that
  performs it.
- `onDown` keeps `preventDefault()`, `onStart` (focus) and pointer capture. Raising a window on
  click is correct and must not regress.
- Leave `onHeadDblclick` alone. Once the click no longer undocks, `dockZone(id) === 'max'` still
  holds on the second click and the existing toggle restores correctly.

### Files

`src/useWindowDrag.ts`, `src/__tests__/host.spec.ts`, `docs/how-it-works.md` (the drag line in the
lifecycle list)

### Done when

- A test using real pointer events (the `pointer()` helper already in `host.spec.ts`):
  `pointerdown` then `pointerup` on the header of a maximized window, with no movement, leaves
  `dockZone(id) === 'max'` and the geometry unchanged.
- A second test covers the reported flow end to end: `pointerdown`, `pointerup`, then `dblclick`
  restores the pre-snap geometry and leaves `dockZone(id)` null.
- A drag beyond the threshold off a maximized window still restores the floating size under the
  pointer; the `undockForDrag` unit tests in `state.spec.ts` stay untouched.
- Sub-threshold jitter during a click does not undock.
- The existing drag and snap tests pass untouched.

### Out of scope

Changing what double-click does, persisting snap zones, drag inertia.

---

## Suggested sequencing for the agent

```
VW-01 ─┬─ VW-04 ── VW-05 ── VW-06 ── VW-07 ── VW-08
       │                                │
VW-02 ─┤                                └─ (VW-09 after VW-04)
VW-03 ─┘
VW-12 ── VW-11   independent of the spine
VW-10  independent, land last
```

Strictly serial through the spine: **VW-01 → VW-04 → VW-05 → VW-06 → VW-07 → VW-08.**

- **VW-02 and VW-03** touch nothing the spine touches and can run in parallel from the start.
- **VW-09** only needs VW-04; it can run in parallel with VW-05/VW-06 if you have capacity.
- **VW-10** is isolated in `persist.ts`. Land it last so it rebases onto a settled descriptor.
- **VW-12 then VW-11** touch nothing the spine touches and can run in parallel from the start.
  VW-12 goes first: VW-11's "double-click does nothing while pinned" assertion is only trustworthy
  once the double-click path itself is correct.
- **VW-05 and VW-06 must not be parallelised** — VW-06's `closing` flag has nothing to attach to
  without VW-05's leaving lifecycle.
- **VW-08 goes last on the spine on purpose.** It is the only breaking change in the set, and
  VW-07 is what gives `resolve()` its canonical use case. Cut the release after it.

Ship `0.2` at VW-08. VW-09 and VW-10 can ride along or follow in `0.2.1`.
