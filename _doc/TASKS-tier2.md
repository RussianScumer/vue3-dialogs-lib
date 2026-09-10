# Tier 2 tasks — VW-13 …

> Execution tasks found by the review in [FABLE_REVIEW_AND_PLAN.md](../FABLE_REVIEW_AND_PLAN.md),
> in build order. One task per branch, one PR each. Read the roadmap section named in each task
> before starting; it holds the reasoning, this file holds the contract.

---

## Global constraints

Same as [TASKS-tier1.md](./TASKS-tier1.md) §Global constraints; they apply unchanged.

---

## VW-13 — A frame adopts a re-hydrated descriptor

**Roadmap:** [§9 Cross-tab persistence](./ROADMAP-gaps.md) · **Size:** S · **Blocks:** VW-16 ·
**Status:** done, merged into `master` for 0.2.1.

### Goal

After `hydrate()` — in practice after `ExternalChangeInfo.resume()` — every rendered frame shows
the descriptor that is now in the store, and drags on it are persisted.

Today it does not. `WindowHost`'s watcher on `visible` swaps `f.d` only when the frame is
`leaving`, and `BaseWindow` captures `props.descriptor` once at setup. `hydrate()` replaces
`s.stack` with fresh objects, so any id that survives keeps rendering the old, detached object:
the store says `x: 300` while the DOM renders `translate(10px, 10px)`, and a subsequent drag
mutates the detached object, which the persistence watcher never sees.

### Do

- `src/WindowHost.vue`: add `gen: number` to `Frame` and a module-level `generation` counter.
- In the `now` loop add a branch `else if (f.d !== d)`: `retire(id)`, then
  `frames.set(id, { d, state: 'entering', gen: ++generation })`.
- Template key becomes `` `${f.d.id}:${f.gen}` `` so Vue remounts the frame.
- Remounting is the intended semantics: the content re-reads `state` from the adopted descriptor,
  which is the whole point of `resume()`. Focus is not stolen — `hydrate()` marks every id
  restored and `useWindowFocus` already skips restored windows.
- Do **not** make `BaseWindow` react to descriptor changes. `d` is closed over by the drag,
  resize, focus and context composables; a remount is cheaper and correct.

### Files

`src/WindowHost.vue`, new `src/__tests__/hydrate-frames.spec.ts`.

### Done when

- Mount the host, open a window, `hydrate([clone with x: 300])`: the dialog's transform contains
  `300px`, exactly one `<dialog>` exists, and `useWindowState` inside the content sees the new
  draft.
- Same through the plugin: `setupPersist` with `onExternalChange`, fire a foreign storage event,
  call `info.resume()`, same assertions.
- A window absent from the new blob departs through the normal leaving path.
- Playground: two tabs; move a window in tab B; in tab A run `__vwResume()`; the window jumps to
  B's position and dragging it afterwards is persisted.
- All three gates in CLAUDE.md §9 pass (`/verify-task`).

### Out of scope

Merging the two tabs' stacks. VW-10's "second writer stops" rule stands.

---

## VW-22 — Colour theme presets

**Roadmap:** none — requested directly, no prior gap entry · **Size:** M · **Blocks:** nothing ·
**Status:** done, branch `vw-22-color-themes`.

### Goal

Ship the well-known editor palettes as ready-made stylesheets, so a consumer picks Dracula or Nord
with one import and one attribute instead of hand-deriving thirteen token values.

The theming contract already exists: `style.css` reads the public `--vtd-*` properties and never
declares them, so every palette is pure data. Nothing in the components needs to change — there is
no colour literal anywhere outside `src/style.css`, and `WindowTaskbar` is renderless.

### Do

- `src/themes/<slug>.css`, one per palette, each a single rule
  `:where([data-vtd-theme='<slug>'], .vtd-theme-<slug>)`. `:where()` is load-bearing: this is the
  first time the library declares a public `--vtd-*` rather than only reading it, and zero
  specificity is what keeps the consumer's own declarations winning.
- Each file declares `--vtd-color-scheme` plus the thirteen colour tokens — all of them, every time.
  A palette never declares the `color-scheme` property itself: activated on `<html>` that would
  repaint the whole page. `style.css` reads the token on `.vw` instead, so the scheme reaches native
  scrollbars and controls inside a window and stops there. The
  `prefers-color-scheme: dark` block in `style.css` covers only four and leaves `--vtd-fg`,
  `--vtd-head-fg`, `--vtd-accent`, `--vtd-shadow` and the ghost colours at their light values, so a
  dark palette cannot lean on it.
- Colours only. `--vtd-radius`, `--vtd-font`, the `*-pad` tokens and `--vtd-motion-duration` stay
  untouched so a palette composes with the consumer's shape choices instead of overwriting them.
- `src/themes/all.css` `@import`s every palette, for a runtime picker.
- `package.json`: `"./themes/*.css": "./dist/themes/*.css"` in `exports`; `build-css` gains
  `fs.cpSync('src/themes', 'dist/themes', { recursive: true })`. Node builtins, no new dependency.
- Palette values come from each theme's published spec. No eyeballing.

### Files

New `src/themes/*.css` (22 palettes + `all.css`), new `src/__tests__/themes.spec.ts` and
`src/__tests__/themes.browser.spec.ts`. Modified `package.json`, `playground/main.ts`,
`playground/ThemeControls.vue`, `playground/App.vue`, `README.md`, `docs/recipes.md`,
`docs/recipes_ru.md`.

### Done when

- Unit: every palette file declares the full token set and nothing outside it, targets its own slug
  at zero specificity, declares `--vtd-color-scheme` and no bare `color-scheme`, sets no shape or
  motion token, and appears in
  `all.css`. Read off disk — importing the files would hand them to Vite's CSS pipeline and hollow
  them out.
- Browser: with `style.css` and `themes/all.css` loaded, `data-vtd-theme="dracula"` on `<html>`
  resolves to `rgb(40, 42, 54)` on the frame and `rgb(68, 71, 90)` on the header; the class form
  reaches the same window; `--vtd-border-active` accents the active frame; a light palette tints
  the modal scrim instead of falling through to the baseline dark default; the frame's
  `color-scheme` is `dark` while `<html>`'s is unchanged; and a `:root` rule from a consumer still
  beats the palette.
- `npm run build` produces `dist/themes/` beside `dist/style.css`.
- Playground: the case-8 picker cycles every palette with a window open and a second behind it —
  frame, header, active border, button hover, snap ghost and modal scrim all follow, and so does the
  playground's own taskbar, which reads the same tokens — while the demo page itself does not change
  colour at all. The manual `--vtd-*` knobs still layer on top.
- All three gates in CLAUDE.md §9 pass (`/verify-task`).

### Out of scope

Light/dark auto-pairing (each variant is its own explicit palette), a JS token export, and theming
the taskbar — it is renderless, so its visual is the consumer's entirely.
