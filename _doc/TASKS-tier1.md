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
