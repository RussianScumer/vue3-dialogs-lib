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
9. **Three gates before a task is done**, in order: `npm run lint` and `npm run type-check`; then
   `npx vitest run` across both projects; then the change exercised by hand in the running
   playground (`npm run dev`), in a real browser. The specs and the browser session catch different
   things — a spec proves the logic against the UA, a playground session is what puts it through
   real pointer input, real window stacking and the consumer's own markup. A task that has only
   passed the first two is not finished.

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

**Roadmap:** §8 · **Size:** M · **Depends on:** VW-01 · **Status:** done on `vw-04-focus-destinations`.

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

### Notes

- **One existing test changed, deliberately.** `host.spec.ts`'s "leaves focus alone when a window
  is only minimized" asserted that minimizing the only window does *not* focus the opener — which
  is step 3 of the chain this task defines. Global constraint 6 says a test needing to change is a
  signal the task is out of its lane; here it is the signal that the task is exactly in it, since
  "minimize does not move focus" is the sentence VW-04 exists to delete. It was rewritten to the
  new contract, with the old title kept in a comment. Nothing else in the suite moved.
- **The store holds DOM now, for one reason.** Step 1 asks "which window is on top", which is a
  question about `z` and `minimized`; step 1 then has to focus that window's header, which is an
  element some other component owns. The header registry lives in `state.ts` beside `docks` and
  `closeGuards` — runtime-only, outside the watched `s`, and elements, so it can no more be
  persisted than a guard function can. It reuses the existing `activeId` computed rather than
  adding a second "which one is next", so the focus destination cannot drift from `data-vw-active`.
- **`excluding the one leaving` needs no exclusion.** By the time the frame unmounts the store has
  already stopped counting it: a closed window is out of the stack and a minimized one is skipped
  by `activeId`. The leaving window can never be its own destination.
- **Containment is measured in `onBeforeUnmount`, not `onUnmounted`.** By the latter the frame is
  detached and `document.activeElement` has already fallen back to `<body>`, so "was focus inside
  this window" can no longer be asked.
- **No `nextTick` anywhere.** The next window's header is already mounted, and the taskbar target
  is the consumer's own persistent element rather than a per-window button, so both destinations
  exist at unmount time. A per-window button would have needed one, since the taskbar re-renders
  after the host.
- `registerFocusTarget` is a plain Vue ref callback: the element arrives on mount and `null` on
  unmount, which is the whole registration. Nothing to clean up, and no library markup needed to
  scope the lookup.
- **Both projects, and the browser one earns its place.** The chain's logic is jsdom's to prove —
  `focus.spec.ts`, next to the existing focus coverage in `host.spec.ts`. But jsdom fakes the two
  things the chain runs against: `dialog.show()` there is a shim that sets an attribute, so the UA's
  dialog focusing steps never run and never get the chance to compete with ours, and jsdom's
  `focus()` is unconditional where a real browser refuses it on an element it does not consider
  focusable. `focus.browser.spec.ts` measures the chain in Chromium, which is also what pins the
  documented `tabindex="-1"` on the registered taskbar target as load-bearing rather than
  decorative.

### Verification

`npx vitest run` — 126 tests, 112 jsdom (6 new) and 14 browser (4 new). `npm run type-check` and
`npm run lint` clean. One existing assertion rewritten, as recorded above.

---

## VW-05 — Window transitions and the leaving lifecycle

**Roadmap:** §1 · **Size:** L · **Depends on:** VW-01, VW-04 · **Blocks:** VW-06 · **Status:** done on
`vw-05-transitions`.

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

### Notes

- **One `v-for`, not two.** `WindowHost` renders a single insertion-ordered map of frames rather
  than `visible` plus a leaving list. Two `v-for`s would put the same key in two fragments, so a
  window crossing from one to the other would be unmounted and remounted — which kills the
  transition and remounts the content at the exact moment both are supposed to be leaving. Keeping
  the map's insertion order is the other half of that: a leaving frame must not move in the DOM.
- **The host holds the frame elements, not the store.** The duration is read off the window
  element, so something has to hold it. `state.ts` already holds header elements with a narrow
  justification (only the store can answer "which window is next"), and this question is the host's
  own, so it stays in the host — one stable ref callback per id, memoized because Vue re-runs a
  ref whose identity changed and an inline arrow is a new function on every desktop render.
- **A closing window keeps its content; a minimizing one does not.** Both are the same `leaving`
  state, and the difference is read off the descriptor rather than passed as a second prop:
  `minimized` is true for the one and false for the other. That is also what keeps existing test 8
  honest — "the content is really gone while minimized" would quietly have become "gone,
  eventually".
- **`prefers-reduced-motion` needs no code.** The baseline sheet collapses
  `--vtd-motion-duration` to `0ms`, the host reads `0`, and the frame retires in the same watcher
  tick — the same path as no stylesheet at all. The one deviation from `style.css`'s "read, never
  declare" rule is that the sheet must *declare* `--vtd-motion-duration`, since the host reads a
  value back; `:where(:root)` keeps it at zero specificity so a consumer override still wins.
- **The sheet animates `translate`/`scale`, never `transform`.** `transform` is where the window
  *is*. The separate properties compose with it, so the fly-to-taskbar animation cannot fight the
  drag position.
- **A hidden tab delivers no animation frame.** Measured, not assumed: `requestAnimationFrame` in
  a backgrounded Chrome tab did not fire within 800ms, so `entering` released on rAF alone left
  the window parked at `opacity: 0` until the tab was looked at again. With nothing painting there
  is nothing to animate, so `settle()` releases the frame immediately when `document.hidden`. This
  cost a real bug and has its own test.
- **The retention cap is not the same thing as the duration.** 1000ms is a ceiling on how long a
  frame may be held, so a consumer who writes `--vtd-motion-duration: 30s` gets a clipped
  animation rather than a desktop full of dead windows.

### Verification

`npx vitest run` — 143 tests, 126 jsdom (14 new) and 17 browser (3 new). `npm run lint` and
`npm run type-check` clean. Existing specs untouched.

Both projects again, for the usual reason: jsdom has no cascade, so `transitions.spec.ts` stubs the
computed duration and pins the machine — retention, adoption on restore, the 50-window loop,
`closeAll` mid-transition, host unmount — while `transitions.browser.spec.ts` imports `style.css`
and lets Chromium resolve `--vtd-motion-duration` through inheritance, which is the one claim a
stub cannot make. The browser spec is also what proves the frame is really animating (`opacity`
below 1 mid-leave) and that the inline `transform` survives the fly.

Exercised by hand in the playground under Chrome, where §17's slider writes the duration onto
`<html>`: states through `entering` → `open` → `leaving`, a closing frame retained with its
content and a minimizing one retained without it, the fly-to properties computed from the real
taskbar button's rect (`--vtd-min-x: -21px`, `--vtd-min-y: 550px`, `--vtd-min-scale: 0.253`), a
window restored mid-leave adopting its own frame back, `closeAll()` mid-transition leaving zero
`<dialog>` elements, and no console output. The automated Chrome tab is `hidden`, which is how the
animation-frame bug above was found; the timing claims themselves are the browser spec's, since a
hidden tab throttles the timers that would measure them.

---

## VW-06 — Async close guards

**Roadmap:** §3 · **Size:** M · **Depends on:** VW-05 · **Status:** done on `vw-06-async-close-guards`.

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

### Notes

- **The guards were already awaited.** `requestClose` was `async` and `await`ed both guards before
  this task, so nothing about "a guard may return a promise" needed writing. What was missing is
  everything that makes an *awaited* guard usable: a pending state to render, one guard run per
  question, and a defined answer when the guard throws.
- **Two structures, not one.** `closing` is a reactive `Set` beside `docks` — what the view reads —
  and `pending` is a plain `Map` of the in-flight promise, which is what re-entrancy joins. A single
  reactive map keyed by id would have had to hold promises inside a `reactive()` proxy, and awaiting
  a proxied thenable is a subtlety with nothing to gain.
- **The flag is what says whether there is anything to join.** A window with no guards at all never
  suspends: `runGuards` runs to its `finally` synchronously, so by the time `requestClose` could
  record the promise the request is already over. Recording it then would leave a `pending` entry
  nothing ever removes. `if (closing.has(id))` is that check, and it is why every existing
  synchronous caller still settles in the same microtask it always did.
- **A throw is a veto, not a close.** The alternative — let the error propagate out of
  `requestClose` — leaves the caller with a rejected promise and the window in an undefined state.
  Treating an unanswered question as permission is the destructive reading, so a throwing guard
  keeps the window and warns. That warning is the library's first `console.warn`; it is dev-only
  (`import.meta.env.DEV`) and addressed at the developer, so constraint 4 is intact.
- **`close()` mid-pending is not a special case.** It clears both structures, and the guard that is
  still out answers into a window that no longer exists — `close(id)` inside `runGuards` finds
  nothing and returns. The promise settles with whatever the guard said, which is honest: it is the
  answer to a question that stopped mattering.
- **Minimize is disabled too, not only close.** Minimizing unmounts the content, and the content is
  where the pending guard lives — the frame would drop the very function that is being awaited.
- **The taskbar exposes `closing(id)`, a function rather than a ref**, matching `setTaskbarRect`
  and `registerFocusTarget`: the slot is per-window and a function reading the reactive set tracks
  correctly in the consumer's own `v-for`.

### Verification

`npx vitest run` — 154 tests, 137 jsdom (11 new in `close-guards.spec.ts`) and 17 browser.
`npm run lint` and `npm run type-check` clean. Existing specs untouched.

jsdom only, and deliberately: everything here is store logic and one `:disabled` binding, and the
one thing a real UA could add — that a disabled button really refuses the click — is the UA's own
contract, not the library's.

Exercised by hand in the running playground under Chrome. `window.confirm` was replaced in the
page with a recording stub for the session: a native dialog blocks the automation channel, and the
question being asked is the playground's stand-in for VW-07's owned window anyway — what is being
measured is the state around it. Measured there: the ✕ and – disabled while the guard is out, the
footer button reading `Closing…`, the taskbar button dimmed with `…` in place of its ✕, and the
content's own hint switching to "Guard is deciding"; one `confirm` for three clicks on ✕ during the
same request; refuse keeps the window and re-enables every control; accept closes it and the frame
retires; `closeAll()` while a guard is pending leaves zero `<dialog>` elements and the guard's late
answer lands harmlessly. No console output but Vite's own.

The tab throttles timers — the same `document.hidden` condition VW-05 ran into — so a 600ms guard
and a 180ms leave both take about five times as long there. It changes nothing about the order of
events, which is what this task is about; the timing claims are the specs'.

---

## VW-07 — Owned child windows

**Roadmap:** §4 (decided: option **a**) · **Size:** L · **Depends on:** VW-06 · **Status:** done on
`vw-07-owned-child-windows`.

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

### Notes

- **The cycle the task asks for cannot be built.** `open()` is the only thing that adds an owner
  link, and the window it links is brand new, so the new window can never already be an ancestor of
  its own owner. The walk up the chain still carries a `seen` set and throws on a repeat — a loop
  that can hang is not a thing to leave in a library — but what the tests can reach are the two
  real failures: an unknown owner id, and a chain past the cap. Both throw at call time, as an
  unknown window name does.
- **The pending join outranks the owner refusal, deliberately.** "`requestClose(ownerId)` is
  refused outright" is the rule for a request that arrives while a child is open. But in the shape
  this whole feature exists for, the child *is* that request's own guard asking its question — so
  by the time the child exists, `requestClose` is already pending, and VW-06's re-entrancy hands
  the second caller the same promise. Refusing there would answer "the window stayed open" while
  the real answer is still out. The refusal therefore sits after the `pending` join and covers the
  other case: a child opened by something other than a guard. Both are tested.
- **Ownership is a group, not a parent pointer, for stacking.** "Focusing either raises both" is
  not `owner.z + 1` computed at render time; it is one re-stack of the whole chain, owners before
  children, on every focus. That is also how the child gets its `owner.z + 1` at open, which is why
  `open()` calls the re-stack directly rather than `focus()`: the fresh window is already at
  `topZ`, so `focus()`'s early return would have left the owner wherever it was.
- **`inert` is written by hand, not bound.** A binding would clear the attribute on false, taking a
  consumer's own `inert` with it, and there is no way to record what was there before. The watcher
  records it once and hands it back — which is also what makes an owner that is itself somebody's
  child survive its own child going away.
- **That watcher is `flush: 'sync'`.** Closing a child hands focus back to the owner's header
  through VW-04's chain, and a real UA refuses to focus anything inside an inert subtree. On the
  default `pre` flush the host retires the child's frame in the same tick that clears `inert`, and
  which of the two runs first is a matter of watcher creation order — the focus landed on nothing.
  Sync makes the attribute go the instant the store forgets the link.
- **Eviction counts roots, not windows.** `maxWindows` compares against the unowned windows only,
  and evicts one of those; a child leaves with its owner rather than being picked. Anything else
  would let a confirm close a real window to make room for itself.
- **Persistence is filtered on the way out *and* on the way in.** Out, because the link lives in a
  runtime map and a persisted child would come back as an ordinary window with no owner and no way
  to be answered. In, because a hand-crafted blob can carry an `owner` key that no version of this
  code writes, and dropping it is cheaper than reasoning about what it would mean.
- **A function in `props` is legal for an owned window, and only for one.** The playground's sheet
  takes its `answer` callback as a prop — normally the thing a descriptor may not carry. It is safe
  for exactly the reason the window is: it is never written to storage, so the callback can never
  come back dead. The playground says so where it does it.
- **An unanswered question must not hang the guard.** A sheet can go away without answering — ESC
  dismisses it, closing the owner takes it down — so the playground settles its promise from
  `on('close')` as well as from the buttons. That is the consumer's half of the contract and it is
  written into recipe 20, because getting it wrong leaves a window `closing` forever.

### Verification

`npx vitest run` — 174 tests, 154 jsdom (17 new in `owned.spec.ts`) and 20 browser (3 new in
`owned.browser.spec.ts`). `npm run lint` and `npm run type-check` clean. Existing specs untouched.

Both projects, and the browser one carries the half jsdom cannot: jsdom implements nothing of
`inert`, so the jsdom spec can only prove the library sets the attribute — ownership bookkeeping,
the close cascade, the refusals, the stacking group, the eviction rule and the two persistence
directions are all store logic and belong there. What the UA owes is measured in Chromium: an
`elementFromPoint` at the owner's own button comes back as `<body>` while the sibling's comes back
as itself, `focus()` on anything inside the inert owner is refused, a sibling still drags, and a
keydown on an inert owner is never delivered at all.

Exercised by hand in the running playground under Chrome. The `window.confirm` VW-06 stood in with
is gone: the editor's guard now opens a real owned window. Measured there — the sheet at
`z-index: 1015` over its owner at `1014` with the untouched sibling at `1011`; the owner carrying
`inert` and nothing else on the desktop doing so; the owner's input neither hittable nor focusable
while a sibling window still drags by its header; `minimize(owner)` refused with the dev warning
and no other console output; ESC on the sheet dismissing it, focus landing back inside the editor
and every control re-enabled; "Keep editing" keeping the window and "Discard" closing it; a chain
four windows deep with each owner inert and only the deepest interactive, a fifth throwing
`owner chain deeper than 3 windows` and an unknown owner id throwing at the call; the persisted
blob holding only the two real windows with no `owner` key anywhere in it, and a reload bringing
back exactly those two, neither inert; `closeAll()` with a question out leaving zero `<dialog>`
elements.

One thing worth writing down about driving it: `await`ing `requestClose(owner)` from the console
while the sheet is open hangs, because that promise is the question and the question is on screen.
That is the feature working, and it froze the automation channel once before it was understood.

---

## VW-08 — Window results (breaking `open()`)

**Roadmap:** §2 (decided: break the signature) · **Size:** M · **Depends on:** VW-07 · **Status:**
done on `vw-08-window-results`.

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

### Notes

- **The suite moved, and this is the one task where that is the deliverable.** Global constraint 6
  says an existing test needing to change is a signal the task is out of its lane; here the change
  *is* the lane. 179 call sites across the specs, the benches and the playground gained `.id` — a
  mechanical rewrite of the return value, not one rewritten assertion. Nothing about what any test
  asserts moved, which is what makes 154 jsdom tests still passing meaningful rather than
  coincidental.
- **The handle warns rather than works.** The roadmap ruled out a handle that stringifies to an id,
  and the task asks for a dev warning when one is used as a string; those are the same decision
  seen from two sides. `Symbol.toPrimitive` is defined only under `import.meta.env.DEV`, warns once
  per module and returns the id, so a 0.1 call site is loud in development and `[object Object]` in
  production. A handle that quietly coerced everywhere would move the failure from the call site
  that is wrong to somewhere else entirely.
- **`resolve()` is unconditional, like `close()`.** The alternative — route it through
  `requestClose` — means the editor's own "you have an unsaved draft" guard interrogates the save
  that just happened. `requestClose` stays what the *user* asking to close calls.
- **Settling once falls out of promises, not out of a flag.** `resolve(id, data)` settles and then
  calls `close(id)`, which settles again; the second answer is dropped because a settled promise
  drops it. That is also why `close()` can settle unconditionally without knowing whether anything
  answered first.
- **The restored case is settled at hydration, not on first access.** The task says "settles
  `restored` synchronously on first access", and a lazily-created promise would satisfy that
  wording — but `hydrate()` already walks every restored descriptor, so registering an
  already-settled entry there makes `resultOf()` a plain map read with no branch that could rot.
- **A deduped `open()` joins the answer as well as the window.** It could have handed the second
  caller a fresh promise that never settles, which is the bug this rule exists to prevent; one
  window per entity means one answer, and both callers hear it.
- **`resultOf(id)` is the whole API for a window you did not open.** It is what makes the restored
  case reachable at all — there is no handle for a hydrated window — and it answers `closed` for an
  unknown id, since asking after the fact is not a reason to hang.
- **The `result` marker is a `WindowSpec` field that no runtime reads.** `resolveOptions()` deletes
  it next to the async keys, so it reaches neither `defaultsFor()` nor the descriptor, and
  `WindowResultOf<E>` infers `unknown` from an entry that never declared one — the same
  graceful-degradation rule the prop inference already follows.
- **The playground's confirm sheet lost its callback prop.** VW-07 had to pass `answer` as a
  function in `props` — legal only because an owned window is never persisted — and had to settle
  it from `on('close')` as well, or an ESC-dismissed sheet hung the guard forever. Both are gone:
  the sheet calls `resolve(ok)`, the editor awaits `.result`, and dismissal settles `{ ok: false }`
  by itself. Recipe 20 is rewritten around that, and the playground's components map moved into
  `playground/components.ts` so the type test checks the real map rather than a copy of it.

### Verification

`npx vitest run` — 188 tests, 168 jsdom (14 new in `results.spec.ts`) and 20 browser.
`npm run lint` and `npm run type-check` clean. No assertion rewritten; 179 call sites took `.id`.

jsdom only for the new spec, and deliberately: every claim here is store bookkeeping plus one
binding in `useWindowContext`, and none of it is measured against the UA. The compile-time half is
`playground/typed-open.type-test.ts`, which `npm run type-check` runs — inferred (`itemEditor`
declares `result: SavedItem`), un-inferable (a bare loader), a spec with defaults but no marker, and
the untyped store, plus `@ts-expect-error` on passing the handle where an id belongs.

Exercised by hand in the running playground under Chrome. Measured there: *Save and close* settling
`{ ok: true, data }` with the typed `SavedItem` and the awaiting `openItem()` logging its `name` and
note length; the close guard opening the real sheet with the editor `inert` at `z-index: 1044` under
it at `1045`; ESC on the sheet settling `{ ok: false }`, which the guard read as "keep editing" —
the editor kept, `inert` cleared, every control re-enabled; *Discard* closing it and the opener
logging `closed`; two `open('itemEditor', { id: 1 })` calls deduping to one window and both hearing
`saved Shared`; `Flood` past `maxWindows: 8` settling all three evicted editors `closed`;
`closeAll()` settling the last one; the persisted blob carrying no `result` key and `schema: 2`; and
after a reload, `resultOf()` on both restored windows answering `restored`. No console output but
Vite's own.

The automation tab is `hidden`, as it was for VW-05 through VW-07, so screenshots come back stale
and the session was driven through the page's own DOM — clicks on the real buttons, `input` events
on the real fields, a real `keydown` for ESC — with the store's answers read back out of the event
log the playground already renders.

---

## VW-09 — Keyboard snapping and window switching

**Roadmap:** §6 · **Size:** M · **Depends on:** VW-04 · **Status:** done on `vw-09-keyboard-snapping`.

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

### Notes

- **The listener is on the window element, not the document.** ESC already works that way, and the
  same reasoning applies twice over here: the event's own window is the one that snaps, so the
  handler needs no notion of "which window did the user mean", and a library that binds `Meta+Arrow`
  at the document would be reaching outside its own markup for a shortcut it cannot know is free.
  The cost is that the chords only fire while focus is inside a window — which is what recipe 22's
  page-wide hotkey is for, and why `focusNext`/`focusPrev` are on the store regardless.
- **The plain arrow nudge had to learn about modifiers.** `onWindowKeydown` read `e.key` alone, so
  `Meta+ArrowLeft` on a focused header moved the window 10px *and* snapped it — and the 10px landed
  first, which meant the dock recorded the nudged rect as the geometry to give back. It now ignores
  any arrow carrying `Meta`, `Ctrl` or `Alt`; `Shift` stays its own, since that is the resize
  modifier.
- **The quarters are a ring, because four arrows onto four corners has no natural mapping.**
  The arrow names the edge you travel along to reach the next corner clockwise from the top-left:
  up to the top-left, right to the top-right, down to the bottom-right, left to the bottom-left.
  Any assignment here is a convention rather than a deduction, which is the sharpest argument for
  the per-action overrides the task asks for.
- **Snap keystrokes need `draggable` *and* `resizable`.** The pointer path reaches a snap through a
  drag, so it only ever checks `draggable`; the done-when list asks for a non-resizable window to
  ignore the keystrokes, and a snap does resize the window. The keyboard is therefore the stricter
  of the two by exactly one flag, deliberately.
- **Modifiers are compared exactly, not as a subset.** `Meta+ArrowUp` and `Meta+Shift+ArrowUp` are
  different actions on adjacent keys; a subset match would have made the quarter fall through to
  maximize the moment a consumer unbound it.
- **Every action ships two chords, because one of them is usually dead.** The task's defaults are
  the familiar ones, and on the three big desktops the familiar one never reaches the page at all:
  Windows takes `Win`+arrow for Snap Assist, GNOME and KDE take `Super`+arrow for tiling, GNOME
  takes `` Alt+` `` for switch-group, and macOS Chrome reads `Cmd`+`←` as Back. A window-manager
  grab happens above the browser — no event, no signal, nothing to detect or override — so the only
  available answer is a second chord one modifier away from everything a desktop reserves.
  `Ctrl`+`Shift` is that gap (GNOME's workspaces are `Ctrl`+`Alt`+arrow, KDE's move-to-desktop
  `Ctrl`+`Alt`+`Shift`+arrow, macOS' Mission Control `Ctrl`+arrow), and it is already covered by the
  editable guard, since inside a text field it is word-select. The quarters cannot reuse the arrows
  there — `Ctrl`+`Shift`+arrow is a half — so they are `Digit1`…`Digit4` in reading order, which
  needs no convention at all, bound by `code` because `Shift`+`1` is `!` on one layout and something
  else on the next. Switching keeps `Shift` as its reverse in both families rather than staying
  inside the `Ctrl`+`Shift` gap. **An override replaces both chords for its action**: a consumer who
  names a binding must not inherit the collision they did not ask for. Platform sniffing was
  rejected — `userAgentData.platform` names the OS, and the grab is the window manager's.
- **A chord matches `event.key` or `event.code`.** `Alt` turns `` ` `` into a dead key on several
  layouts, so `Alt+Backquote` written against `key` alone would be unreachable exactly where the
  binding matters. `Backquote` is the default for that reason, and either spelling works.
- **Editable targets are found with `closest`, not `isContentEditable`.** A keystroke in rich text
  is delivered to whatever inline element the caret sits in rather than to the editable root, and
  the property is one of the things jsdom does not implement — so the spec could never have seen
  the guard work.
- **`focusNext` skips a window that owns a child.** An owner is `inert` while its question is on
  screen, and a real UA refuses to focus anything inside an inert subtree, so cycling onto one
  would leave focus on nothing. The child directly above it is the reachable half of that pair.
  Minimized windows are skipped for the older reason: they have no frame to focus.

### Verification

`npx vitest run` — 208 tests, 188 jsdom (20 new in `keymap.spec.ts`) and 20 browser. `npm run lint`
and `npm run type-check` clean. Existing specs untouched.

jsdom only for the new spec, following VW-06 and VW-08: the keymap is option resolution, one
comparison per keystroke and a `snap()` call the pointer path already makes. The one claim worth
sharing with the UA — that a header really takes focus — is already pinned in
`focus.browser.spec.ts` by VW-04. `Meta+ArrowLeft` is asserted against `snapRect('left', …)` from
`geometry.ts`, which is verification 11's own function, so the keyboard and pointer paths cannot
drift apart without one of the two specs failing.

Exercised by hand in the running playground under Chrome. Measured there, in a 2048×792 viewport
with `snap.insets.bottom: 36`: `Meta+←` giving 1024×756 at 0,0, `Meta+Shift+↑` the 1024×378
top-left quarter, `Meta+Shift+↓` the bottom-right at 1024,378, `Meta+↑` maximizing to 2048×756 and
`Meta+↓` returning the window to its pre-snap 420×360 at 68,68; the same chord in the editor's own
`<input>` changing nothing; `Alt+`` ` `` walking all four windows by `z` and wrapping, with
`document.activeElement` landing on each header in turn and `Alt+Shift+`` ` `` reversing; a
minimized window dropping out of the ring; the fixed panel — neither draggable nor resizable —
ignoring the chords entirely; an editor with an open confirm sheet skipped while `inert`, the sheet
itself in the ring, and the sheet still dismissible with the owner un-inerted afterwards; the plain
arrow still nudging 10px and `Shift`+arrow still resizing, with `Meta`+arrow doing neither; and
after a reload the persisted blob still at `schema: 2` with the same twenty descriptor keys and no
trace of a keymap. No console output but Vite's own.

The fallback chords were measured the same way, in a second session at 2560×990: `Ctrl+Shift+←/→`
giving the 1280-wide halves, `Ctrl+Shift+↑` the full 2560 width, `Ctrl+Shift+1…4` the four 1280×477
quarters in reading order, `Ctrl+Shift+↓` returning the window to its pre-snap 380×300 at 96,96,
`` Ctrl+` `` walking all three windows and `` Ctrl+Shift+` `` reversing — and `Ctrl+Shift+←` inside
the editor's `<input>`, where it is word-select, changing nothing about the window. The 520px
heights on the halves are the log viewer's own `maxH`, the same clamp the pointer path applies.

The automation tab is `hidden`, as it has been since VW-05, and this time that cost more than stale
screenshots: the extension's key channel delivered nothing at all to the page — a plain `ArrowLeft`
never arrived, and neither did `Ctrl+Shift+←` when the fallbacks were added — so both sessions were
driven with `KeyboardEvent`s dispatched onto the real elements. **The one claim no test and no
automation here can make is whether a given host OS lets a chord through at all**; a grabbed key
produces no event to observe. That is the whole reason for the second chord, and for keeping every
binding overridable. Confirming `Ctrl`+`Shift`+arrow against a real Windows, GNOME and macOS
desktop is a human's job, and is still open.

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
