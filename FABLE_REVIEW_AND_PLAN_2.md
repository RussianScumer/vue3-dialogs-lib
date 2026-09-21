# Review and plan 2 — 2026-09-19

Deep review of `@korneevec/vue3-dialogs-lib` at `master` (`ed80e9f`, v0.3.0), the second pass after
[FABLE_REVIEW_AND_PLAN.md](./FABLE_REVIEW_AND_PLAN.md) (2026-09-07). VW-13 … VW-22 are merged; this
document covers what is left on top of them, read from four sides:

1. Correctness
2. Architecture and API design
3. Performance, tests, security
4. User experience — the end user and the consumer developer

The plan at the end is written in the `_doc/TASKS-tier2.md` contract format so an entry can be
copied there verbatim when it is picked up. Nothing in the library changed for this review.

## Gates as run

| Gate | Result |
|---|---|
| `pnpm lint` | pass |
| `pnpm type-check` | pass |
| `pnpm exec vitest run --project unit` | 350/350 pass, 18 files |
| `pnpm exec vitest run --project browser` | 36/36 pass, 7 files (chromium 1234 cached) |
| `pnpm build` | pass; `dist/` has the bundle, `types/`, `style.css`, `themes/` |

## Method

Three read-only sweeps (store + persistence, components + composables, tests + docs + tooling),
then the top claims were reproduced with a throwaway `src/__tests__/_review.spec.ts` (jsdom,
deleted afterwards, never committed). Every finding carries a status:

- **reproduced** — a spec showed the failure on `master`
- **confirmed** — verified by reading the source, not run
- **not reproduced** — the attempt did not show it; kept only where the reading is still convincing

Severity: **H** breaks a user's data or a stated guarantee; **M** wrong in a realistic path;
**L** rough edge, cleanup, or a doc gap.

UX findings were read from the source and the playground code, not exercised in a browser for
this review; each one names the code path so the check is a two-minute playground run.

---

## Findings

### Side 1 — Correctness

**1.1 (H, reproduced) A non-finite persisted `topZ` poisons every z-index.**
`src/persist.ts:102` accepts `topZ` with `typeof parsed.topZ === 'number'`, which admits `Infinity`
and `NaN` (`1e999` in the blob parses to `Infinity`). `src/state.ts:851` then does
`s.topZ = Math.max(topZ, …)`, so `s.topZ` is `Infinity`; every later `++s.topZ` stays `Infinity`,
every opened window gets `z = Infinity`, and `focus()`'s early return at `src/state.ts:283`
(`z === s.topZ`) is always true — no window can ever be raised again. Repro: hydrate a blob with
`"topZ":1e999`, open a window, observe `z === Infinity`. A hand-edited or corrupted blob is enough;
`isDescriptor` finite-checks `x,y,w,h,z` on each descriptor but nothing checks `topZ`.

**1.2 (H, reproduced) `maxWindows` eviction bypasses close guards.**
`src/state.ts:591-595` evicts the oldest root with `close(roots[0].id)`, not `requestClose`, so an
`onBeforeClose` guard is never consulted. Repro: `maxWindows: 2`, guard on window A that returns
`false`, open two more windows — the guard is called zero times and A is gone. The unsaved draft
that the guard exists to protect is lost on the ninth `open()` at the default limit.

**1.3 (M, reproduced) An east or south resize is not clamped to the viewport.**
`src/useWindowResize.ts:71-89` pre-clamps only the west and north edges against `bounds`. A
south-east drag to `(3000, 3000)` in a 1024×768 jsdom viewport leaves `w = h = 2700` in the
descriptor. The frame paints capped by the inline `maxWidth: 100vw` / `maxHeight: 100dvh`
(`src/BaseWindow.vue:241-242`), so the pointer stops moving the edge while the descriptor keeps
growing, and the oversized geometry is what persists and what `clampAll` later works from.
Keyboard Shift+arrow resize (`src/useWindowDrag.ts:130`) has the same gap.

**1.4 (M, reproduced) `resume()` writes the hydrated blob back under this tab's token.**
`src/persist.ts:207-210`: `resume()` calls `hydrateFromStorage()`, which replaces `s.stack` and
wakes the deep watcher; 300 ms later `write()` runs with `stopped` already `false` and stores the
same data with **this** tab's `writer`. Repro: foreign `storage` event, `resume()`, no user action,
`nextTick`, advance 400 ms — one write, own token. Every other tab sees that as a foreign write and
stops persisting. Two tabs whose `onExternalChange` both call `resume()` (the README's own example
at `README.md:406-409`) ping-pong every 300 ms for as long as both stay open. Merely opening a
second tab freezes persistence in the first, which the README documents; the write-back loop it
does not.

**1.5 (M, reproduced) `resolve()` on a restored window drops the payload.**
`src/state.ts:868` installs `settle: () => {}` for every hydrated id. `resolve(id, data)` then
closes the window, and `resultOf(id)` reports `{ ok: false, reason: 'closed' }` — the data went
nowhere and the caller cannot tell a resolve from a plain close. The design note at `:865-867`
explains why the *original* promise is pre-settled; it does not follow that a later, live
`resolve()` should be discarded.

**1.6 (M, reproduced) The page becomes tabbable while the scrim is still on screen.**
`src/WindowHost.vue:270` releases the root `inert` the instant `topModalId()` turns null, while the
scrim follows `scrimUnder` (`:195-200`), which keeps the leaving modal's frame for the whole
`--vtd-motion-duration`. Repro: `modal.inertRoot: '#page'`, open a modal, set a 200 ms duration,
`close()`, two ticks — `inert` is gone, the dialog is still present in `data-vw-state="leaving"`,
the scrim is still rendered. For the length of the leave animation the page is dimmed and
click-blocked but fully reachable by Tab.

**1.7 (L, confirmed) `storage` events are not filtered by `storageArea`.**
`src/persist.ts:193` compares only `e.key`. A consumer who passes a custom `StorageLike` (a
namespaced wrapper, `sessionStorage`) still stops persisting when an unrelated `localStorage` write
happens to use the same key name.

**1.8 (L, confirmed) Hydration has no size or uniqueness limits.**
`src/state.ts:851` spreads the whole stack into `Math.max(...)` (a `RangeError` past ~100k entries
in a crafted blob), hydration ignores `maxWindows`, and two descriptors with the same `id` are both
kept — `byId` returns the first, the frame `v-for` keys collide.

**1.9 (L, confirmed) Minor correctness notes.**
- `src/persist.ts:10` comment says `MIGRATABLE` is "newest first"; it is a `Set`.
- `src/geometry.ts:53` `clampY` ignores `_h` and floors at 0, so a window can never be dragged above
  the top edge, while `clampX` lets it go off-screen to `minVisible - w`. Asymmetric and undocumented.
- `src/useWindowFocus.ts:61-68` the `MutationObserver` that hands focus to late content disconnects
  only when a tabbable appears or focus leaves the header; a window whose content mutates constantly
  and never gains a tabbable (a live log) keeps it running for the window's lifetime.

### Side 2 — Architecture and API design

**2.1 (M, confirmed) Events carry nothing but `{ type, id }`.**
`src/state.ts:193`. `geometry` has no rect, `close` has no reason and no result and fires after the
descriptor is gone (`:342-360`), and there is no event at all for pin, snap zone, modal open, or the
active window changing. Every listener re-queries the store, and a `close` listener cannot even name
the window: the playground keeps a side `Map` of titles for exactly this (`playground/App.vue:19-25`).

**2.2 (M, confirmed) Mutators disagree about emitting.**
`setTitle` and `setGeometry` emit (`src/state.ts:662-675`); `updateProps` and `setMeta` (`:677-683`)
do not. `restore()` of a window already on top emits `restore` but not `focus`, because `focus()`
returns early (`:283`).

**2.3 (M, confirmed) No `maximize` in the API.**
The store has `snap(id, 'max' | 'none', view)` (`:761`) and a viewport attached at `:835`, but the
consumer still has to pass a viewport and to know that "maximize" means the `'max'` zone. There is no
`maximize(id)`, `unmaximize(id)`, or `isMaximized(id)`.

**2.4 (M, confirmed) Module-level `activeStore` / `activeOptions`.**
`src/createWindows.ts:12-13`. Last-installed app wins; on a server the two singletons are shared
across concurrent requests for any `useWindows()` that runs outside `setup()` (the fallback path).
The `setup()`-only contract is implied, not stated in the docs.

**2.5 (L, confirmed) Public-shaped types not exported.**
`ControlLabels` is the type of `WindowsOptions.labels` and `WindowDefaults.labels`
(`src/types.ts:41`) but is not in `src/index.ts`; a consumer typing a labels object has no name for
it.

**2.6 (L, confirmed) `BaseWindow` reads its descriptor once.**
`src/BaseWindow.vue:37` copies `props.descriptor` into a non-reactive `const d`; the host copes by
remounting on a `gen` key (`src/WindowHost.vue:150-162`). The prop type does not say so, and a
hand-mounted `BaseWindow` with a swapped descriptor silently keeps the old one.

**2.7 (L, confirmed) Internal shape.**
- Runtime-map teardown is copied three times: `close` (`src/state.ts:348-357`), `closeAll`
  (`:367-376`), `hydrate` (`:852-861`). A new runtime map has to be added in all three.
- `openWindow` is ~115 lines (`:545-660`): preset resolution, owner validation, dedupe, eviction,
  defaults merge, placement, descriptor build, five side-map writes.
- `newId` (`src/state.ts:39`) and `newToken` (`src/persist.ts:26`) are the same helper with two
  different `crypto` guards; `warn()` (`src/state.ts:44`) is bypassed by inline `console.warn` in
  `src/options.ts:135` and `src/WindowHost.vue:241`.
- `function require(id)` (`src/state.ts:211`) shadows the CJS global.
- `WindowTaskbar` exposes both `windows` (minimized only, kept for back-compat,
  `src/WindowTaskbar.vue:16-18`) and `all`; the first is a trap for new code.
- `package.json` `"."` export has `import` and `types` but no `default` condition.

### Side 3 — Performance, tests, security

**Performance**

**3.1 (M, confirmed) The whole frame re-renders on every `pointermove`.**
`src/BaseWindow.vue:222` builds the dialog's `style` from `d.x / d.y / d.w / d.h`, so a drag patches
the frame per frame; the same render re-allocates `{ ...headStyle, cursor }` (`:371`) and eight
`handleStyle(dir)` objects (`:262`, `:452`), so `patchStyle` walks nine elements ~60×/s. Position and
size could live in four custom properties on the dialog (one `style` write each), with static style
objects for the header and grips. The persistence deep watch (`src/persist.ts:152-162`) also re-runs
per move; that one is by design and documented (`docs/performance.md:50-54`).

**3.2 (L, not reproduced) `topModalId()` fan-out.**
`src/state.ts:724` scans the stack and is called from every window's `blocked` (`BaseWindow.vue:73`,
via `isBlockedByModal`) and `band` (`:216`) computed. A spy on the public method saw one call per
`focus()` because the computeds call the closure-internal function directly, so the O(N²) reading
could not be measured from outside. Cheap at `maxWindows: 8`; noted, not promoted.

**3.3 (L, confirmed) Viewport re-clamp at event rate.**
`src/WindowHost.vue:23` watches `[view.w, view.h]` and runs `clampAll` on every `resize` event with no
throttling; a slow drag-resize of the browser window runs an O(N) pass per event.

**Tests and tooling**

**3.4 (H, confirmed) Specs are type-checked by no config.**
`tsconfig.json` references only `tsconfig.node.json` and `tsconfig.app.json`; `tsconfig.app.json`
excludes `src/**/__tests__/*`; `tsconfig.lib.json` excludes tests and benches and is not referenced
at all. `pnpm type-check` never sees a spec, so a spec that calls a removed method or misuses a type
still passes gate 1 and only fails at runtime — or not at all, when the misuse is a typo in an
assertion object.

**3.5 (M, confirmed) The declaration build is looser than the app build.**
`noUncheckedIndexedAccess` is set in `tsconfig.app.json:7` only; `tsconfig.lib.json` runs without it.
`pnpm type-check` and `pnpm build-types` therefore disagree about what compiles.

**3.6 (M, confirmed) ESLint is not type-aware.**
`eslint.config.ts` uses `vueTsConfigs.recommended`, so `no-floating-promises`, `no-misused-promises`
and `await-thenable` are off in a codebase whose close path is built on async guards and `void`-ed
promises (`src/useWindowContext.ts:9`, `src/createWindows.ts`).

**3.7 (M, confirmed) Coverage gaps.**
- Nothing imports `src/index.ts` to assert the export surface; `ssr.spec.ts:20` dynamic-imports it
  and checks two names. A dropped export is caught by nothing.
- `provideWindowContext` and `useWindowOptions` (both exported) have zero occurrences under
  `src/__tests__/`.
- `useViewport`, `useWindowDrag`, `useWindowResize`, `useKeymap`, `injection.ts` have no dedicated
  spec; the drag threshold, west/north clamps and viewport fallback are covered only through the DOM
  in `host.spec.ts`.
- `prefers-reduced-motion` is a roadmap requirement (`_doc/ROADMAP-gaps.md:38-39`) and no spec
  mentions it.
- Taskbar: two tests. `mobileBreakpoint`: appears in browser-spec config objects, never asserted.
- No coverage thresholds in `vitest.config.ts`; no CI (known and deliberate).

**Security and robustness**

**3.8 (M, confirmed) The persisted blob is a trust boundary the docs do not name.**
`src/persist.ts:64-83` hands `props`, `state`, `meta`, `title` from storage to the content component
verbatim; `state` gets no type check at all (`d.state ?? null`). This is not an XSS in the library:
`title` is rendered as text (`src/BaseWindow.vue:382`). It becomes one the moment a consumer renders
`title` or a prop with `v-html`, and a blob is user-editable in DevTools. Together with 1.1 and 1.8
the read side deserves one more validation pass and a sentence in the README.

**3.9 (M, confirmed) Five silent `catch` blocks in `persist.ts`.**
`:91`, `:103`, `:144`, `:186`, `:212`. A quota-exceeded `setItem`, a `state` draft with a cycle
(`JSON.stringify` throws, every write from then on is dropped), an unparseable blob and a throwing
`onExternalChange` are all invisible, even in DEV. Constraint 4 exempts `console.warn` in DEV, and
`warn()` already exists at `src/state.ts:44`.

### Side 4 — User experience

**End user**

**4.1 (H, confirmed) Maximize has no affordance.**
Double-click on the title bar toggles it (`src/BaseWindow.vue:349-353`) and that is all: no button
in the default controls (minimize, close, pin only), no restore button once maximized, and the
double-click is silently a no-op when `snap.enabled` is false. The playground has to build its own.

**4.2 (H) Eviction without a guard** — see 1.2. From the user's side: the ninth window quietly
closes the first, whatever was in it.

**4.3 (M, confirmed) ESC means minimize, and cannot mean anything else per window.**
`src/BaseWindow.vue:287-300`: ordinary window → `minimize`; sheet or modal → `requestClose`. The only
lever is `minimizable: false`, which makes ESC do nothing. A consumer using the library for plain
dialogs gets a minimized dialog on the taskbar (which they may not have built) instead of a closed
one.

**4.4 (M, confirmed) With no stylesheet, the ghost and the scrim are invisible.**
The snap ghost has inline geometry but no `background`/`outline` (`src/WindowHost.vue:272-288`,
tint in `style.css`); the scrim has inline `position/inset/zIndex` and a transparent face
(`:206-216`). Constraint 7 is met — structure is inline — but the affordance is not: a snap preview
arms invisibly and a modal blocks the page with nothing to show for it. Either a minimal inline
fallback (if the constraint's "cosmetics only" allows a one-line outline) or a loud line in the
README.

**4.5 (M, confirmed) `prefers-reduced-motion` loses to any consumer override.**
`src/style.css:164-168` sets `--vtd-motion-duration: 0ms` under `:where(:root)` at zero specificity,
so any consumer declaration wins — including the playground's own slider, which writes
`document.documentElement.style` (`playground/App.vue:223-227`) and silently defeats reduced motion
for that user. The docs should say "check `matchMedia` before overriding", or the host could read
the media query itself when it measures the duration (`src/WindowHost.vue:90-93`).

**4.6 (L, confirmed) Smaller rough edges.**
- Scrim fades in only (`style.css:103-112`); it unmounts with no fade-out.
- 4 px edge / 12 px corner grips are unhittable with a finger in the 768–1024 px band (already a
  Tier 2 roadmap row).
- `.vw__body { padding }` sits on the scroll container (`style.css:65-67`), so edge-to-edge content
  needs a cosmetic override; the padding belongs on an inner wrapper.
- No click-outside-to-dismiss on the scrim — deliberate (`src/WindowHost.vue:345`), keep it.

**Consumer developer**

**4.7 (M) The event surface** — see 2.1. Building a taskbar, a log, or an analytics hook means
re-querying the store on every event and losing the descriptor on `close`.

**4.8 (L, confirmed) Defaults that surprise.**
- `dedupe` is on by default and keyed on shallow-equal props: two "new item" windows with identical
  props collapse into one unless the caller remembers `dedupe: false`.
- `open()` throws on an unknown name, preset or owner (`src/state.ts:550,556,563`) rather than
  returning a failed handle; fine for a programming error, but the docs should say so.
- `setTaskbarRect` must be re-measured by hand from a ref callback; there is no taskbar primitive.

### Strengths

Recorded so the plan does not undo them.

- Type hygiene is clean: no `any`, no `@ts-ignore`, no `TODO`/`FIXME` in `src/`.
- Listener cleanup is complete: drag, resize, viewport, keymap, persist, host all dispose; no
  window/document leak was found.
- `focus()` returns early when already on top, so a pointerdown never wakes the persistence watcher.
- Drag: 4 px slop, undock exactly once with re-seeded origin, `pointercancel` handled, ghost never
  left behind.
- West/north resize clamping is exactly right, including the re-clamp after `clampSize`.
- Inline structure with zero-specificity themes and a private `--_vtd-*` alias layer is a sound
  styling contract; 22 palettes read off disk in a spec.
- Docs have zero option-name drift against `src/types.ts` in either direction; every `--vtd-*`
  custom property is documented.
- The persisted-state discipline (runtime maps outside `s`, owned and modal windows filtered on the
  way out) is consistent everywhere.

---

## Plan

### Order

Numbered from VW-23 (VW-22 is the highest in use). Sizes: S ≤ half a day, M ≤ two days. Every
task obeys the global constraints in `_doc/TASKS-tier1.md`: `SCHEMA` stays 2, no new descriptor
field, zero runtime deps, no user-facing strings, SSR guards, the existing suite passes untouched.

| Task | Title | Size | Side | Findings |
|---|---|---|---|---|
| VW-23 | Hydration hardening II | S | 1, 3 | 1.1, 1.4, 1.7, 1.8, 3.8 |
| VW-24 | `maxWindows` eviction honours close guards | M | 1, 4 | 1.2, 4.2 |
| VW-25 | East and south resize clamp to the viewport | S | 1 | 1.3 |
| VW-26 | Root `inert` follows the scrim | S | 1 | 1.6 |
| VW-27 | Richer events | M | 2, 4 | 2.1, 2.2, 4.7 |
| VW-28 | Maximize as a first-class action | M | 2, 4 | 2.3, 4.1 |
| VW-29 | Per-window ESC policy | S | 4 | 4.3 |
| VW-30 | Frame render cost | M | 3 | 3.1, 3.3 |
| VW-31 | Specs are type-checked | S | 3 | 3.4, 3.5, 3.6 |
| VW-32 | Minor batch: restored `resolve()`, exports, persist warnings | S | 1, 2, 3 | 1.5, 2.5, 2.7, 3.9 |
| VW-33 | Coverage for the untested modules | M | 3 | 3.7 |
| VW-34 | No-stylesheet affordance and reduced-motion docs | S | 4 | 4.4, 4.5 |

Not promoted: 1.9, 2.4 (document the `setup()`-only contract inside VW-32's README touch), 2.6,
3.2, 4.6, 4.8. They are listed above so the next review does not rediscover them.

Suggested order is the table order: VW-23 and VW-24 close the two data-loss paths, VW-25/26 are
one-afternoon fixes, VW-27 and VW-28 change the public surface and should land before any 1.0
talk, VW-30/31/33 are independent and can interleave.

---

## VW-23 — Hydration hardening II

**Roadmap:** none — found by [review 2 §1.1, 1.4, 1.7, 1.8, 3.8](../FABLE_REVIEW_AND_PLAN_2.md) ·
**Size:** S · **Blocks:** nothing · **Status:** proposed.

### Goal

A persisted blob, whatever is in it, cannot leave the store in a state a fresh session could not
reach: `topZ` is finite, ids are unique, the stack is no longer than `maxWindows`, a `storage` event
from a different storage area is ignored, and re-hydrating does not by itself write the blob back.

Today `read()` accepts any `typeof 'number'` for `topZ` (`src/persist.ts:102`), `hydrate()` keeps
duplicate ids and any stack length (`src/state.ts:844-871`), `onStorage` filters by key only
(`src/persist.ts:193`), and `resume()` wakes the deep watcher so the tab writes the hydrated data
under its own token 300 ms later, which every other tab reads as a foreign write.

### Do

- `src/persist.ts` `read()`: `Number.isFinite(parsed.topZ)` or fall back to `10`; drop descriptors
  whose `id` was already seen; keep at most `options.maxWindows` roots (the last N by `z`, so the
  most recently used survive); `state` must be `null` or a plain object, else `null`.
- `src/persist.ts` `onStorage`: return early when `e.storageArea` is set and is not `p.storage`
  (a custom `StorageLike` has no `storageArea` to compare, so `null`/`undefined` still passes).
- `src/persist.ts`: a `quiet` flag set by `hydrateFromStorage()` and consumed by the first
  `write()` after it — that write is skipped, the flag cleared. A real user edit after the hydrate
  still writes on the next debounce. Document in the `resume()` JSDoc that resuming no longer
  re-broadcasts.
- `src/state.ts` `hydrate()`: replace the `Math.max(...spread)` with a loop.
- `README.md` §Persistence: one paragraph naming the blob as user-editable and stating what the
  library validates and what it hands through (`props`, `state`, `meta`) unchecked.

### Files

`src/persist.ts`, `src/state.ts`, `README.md`, `src/__tests__/persist.spec.ts` and
`src/__tests__/persist-crosstab.spec.ts` gain cases (additions only).

### Done when

- A blob with `"topZ":1e999` hydrates with `s.topZ === 10` and a subsequent `open()` gets a finite `z`.
- Two descriptors sharing an id hydrate as one; a 20-descriptor blob at `maxWindows: 8` hydrates 8.
- A `storage` event whose `storageArea` is `sessionStorage` while `persist.storage` is
  `localStorage` does not stop persistence.
- After `resume()` with no further mutation, `setItem` is not called; after `resume()` plus one
  drag, it is called once.
- Playground: two tabs, both with an `onExternalChange` that calls `resume()`; drag in one, the
  other follows, neither tab stops or loops (watch the Application → Storage panel).
- All three gates in CLAUDE.md §9 pass (`/verify-task`).

### Out of scope

Validating `props` against the component's prop definitions; `SCHEMA` stays 2.

---

## VW-24 — `maxWindows` eviction honours close guards

**Roadmap:** none — found by [review 2 §1.2](../FABLE_REVIEW_AND_PLAN_2.md) · **Size:** M ·
**Blocks:** nothing · **Status:** proposed.

### Goal

Opening a window past `maxWindows` never discards a window whose close guard would have refused.
The oldest root is asked through `requestClose`; if it declines, the next-oldest is asked; if every
root declines, the new window opens over the limit and DEV warns once.

Today `openWindow` calls `close()` on the oldest root (`src/state.ts:591-595`), so
`onBeforeClose` and the global `beforeClose` are bypassed and an unsaved draft is lost on the ninth
`open()`.

### Do

- `src/state.ts` `openWindow`: eviction becomes guard-aware. Because `open()` is synchronous and
  returns a handle, the guard cannot be awaited inline; instead: a root with **no** guard registered
  (neither per-window nor global) is closed synchronously as today; a root **with** a guard is
  skipped and `requestClose` is fired for it fire-and-forget (`void`), so it closes on its own if the
  guard allows. If no guard-free root exists, open over the limit and `warn('maxWindows exceeded: N
  guarded windows refused to close')`.
- `README.md` §Limits: state the rule in two sentences.
- Decide inside the task, and record in `### Notes`, whether the global `beforeClose` counts as "a
  guard" for this purpose (recommended: yes).

### Files

`src/state.ts`, `README.md`, `src/__tests__/state.spec.ts` and `src/__tests__/close-guards.spec.ts`
gain cases (additions only).

### Done when

- `maxWindows: 2`, guard on A returning `false`, open B and C: A is still open, the guard was
  called once, C is open, `s.stack.length === 3`, one DEV warning.
- Same with the guard returning `true`: A closes (after the guard resolves), no warning.
- Same with no guard: behaviour identical to today, existing `maxWindows` tests untouched.
- Playground: open windows past the limit with the "dirty" toggle on the first one; it survives.
- All three gates in CLAUDE.md §9 pass (`/verify-task`).

### Out of scope

Making `open()` async; a UI for "which window should go".

---

## VW-25 — East and south resize clamp to the viewport

**Roadmap:** none — found by [review 2 §1.3](../FABLE_REVIEW_AND_PLAN_2.md) · **Size:** S ·
**Blocks:** nothing · **Status:** proposed.

### Goal

A pointer or keyboard resize never grows a window past the viewport edge it is growing towards, so
the descriptor and the painted frame agree and the persisted geometry is always reachable.

Today only the west/north edges are pre-clamped (`src/useWindowResize.ts:78-79`); a south-east drag
leaves `w = h = 2700` in a 1024×768 viewport while the frame paints at `100vw × 100dvh`.

### Do

- `src/useWindowResize.ts` `onMove`: for `east`, cap `wanted.w` at `options.view.w - start.x`; for
  `south`, cap `wanted.h` at `options.view.h - start.y`; then `clampSize` as today. Keep the west and
  north branches as they are.
- `src/useWindowDrag.ts` `onWindowKeydown` Shift+arrow branch: apply the same caps.
- One comment on each explaining that `bounds.minVisible` governs *position*, the viewport governs
  *size*.

### Files

`src/useWindowResize.ts`, `src/useWindowDrag.ts`, `src/__tests__/host.spec.ts` gains two cases
(additions only).

### Done when

- South-east drag to `(3000, 3000)` on a window at `(300, 300)` in 1024×768 ends at
  `w === 724, h === 468`.
- Shift+ArrowRight held past the edge stops at the same width.
- A window whose `minW` is wider than the remaining viewport still gets `minW` (the existing
  `clampSize` precedence is unchanged).
- Playground: drag the SE grip off-screen; the frame and the geometry readout stop together.
- All three gates in CLAUDE.md §9 pass (`/verify-task`).

### Out of scope

`clampY`'s floor at 0 and its unused `_h` parameter (§1.9); `maxW`/`maxH` semantics.

---

## VW-26 — Root `inert` follows the scrim

**Roadmap:** none — found by [review 2 §1.6](../FABLE_REVIEW_AND_PLAN_2.md) · **Size:** S ·
**Blocks:** nothing · **Status:** proposed.

### Goal

While a scrim is on screen, `modal.inertRoot` is inert. The two are released together, at the end of
the leave animation, not 300 ms apart.

Today the root watcher keys on `topModalId()` (`src/WindowHost.vue:270`) and releases the instant
the store forgets the modal, while `scrimUnder` (`:195-200`) keeps the leaving frame for
`--vtd-motion-duration`.

### Do

- `src/WindowHost.vue`: change the watched source at `:270` and the `onMounted` seed at `:265` from
  `win.topModalId() !== null` to `scrimUnder.value !== null`. `flush: 'post'` stays.
- Update the JSDoc above `applyRootInert` to say the root follows the scrim, and why.

### Files

`src/WindowHost.vue`, `src/__tests__/modal.spec.ts` gains one case (addition only); the browser
check goes in `src/__tests__/modal.browser.spec.ts` (addition only).

### Done when

- jsdom: modal open → root has `inert`; `close()` with a 200 ms duration → after two ticks root
  still has `inert`; after the leave timer fires → `inert` gone and scrim gone in the same tick.
- Browser: same sequence with a real `--vtd-motion-duration`, plus Tab from the modal during the
  leave does not reach the page.
- Playground: open a modal with the inert root set, close it, hammer Tab during the fade; focus
  stays out of the page until the scrim is gone.
- All three gates in CLAUDE.md §9 pass (`/verify-task`).

### Out of scope

A focus trap; a scrim fade-out (§4.6).

---

## VW-27 — Richer events

**Roadmap:** none — found by [review 2 §2.1, 2.2, 4.7](../FABLE_REVIEW_AND_PLAN_2.md) ·
**Size:** M · **Blocks:** nothing · **Status:** proposed.

### Goal

A listener gets what it needs from the event and does not have to re-query the store: `geometry`
carries the rect, `close` carries the reason, the result and the last descriptor, and there are
events for `pin`, `snap`, `active` and `props`/`meta` changes. `{ type, id }` stays the base shape, so
every existing listener keeps compiling and keeps working.

### Do

- `src/types.ts`: `WindowEvent` becomes a discriminated union over `type`; the base
  `{ type, id }` is preserved; add `geometry: { rect: Rect }`, `close: { reason: 'closed' |
  'resolved' | 'dismissed' | 'restored' | 'evicted', result: WindowResult, descriptor:
  WindowDescriptor }`, `pin: { pinned }`, `snap: { zone: SnapZone | null }`, `active: { previous:
  string | null }`, `props`, `meta`. Extend `WindowEventType` accordingly.
- `src/state.ts` `emit`: accept a payload; capture the descriptor **before** the splice in `close`;
  emit `props`/`meta` from `updateProps`/`setMeta`; emit `pin` from `setPinned`, `snap` from `snap`/
  `undock`/`undockForDrag`; emit `active` from a `watch` on `activeId` inside `createStore`
  (no descriptor field, no persisted state); `restore()` of an already-top window still emits
  `restore` only — document that.
- `README.md` §Events: table of every type and its payload. `docs/how-it-works.md` event section.
- `playground/App.vue:19-25`: delete the side `Map` of titles and use `event.descriptor.title`.

### Files

`src/types.ts`, `src/state.ts`, `README.md`, `docs/how-it-works.md`, `docs/how-it-works_ru.md`,
`playground/App.vue`, new `src/__tests__/events.spec.ts`.

### Done when

- Every existing `on()` test passes untouched (payload is a superset).
- `events.spec.ts`: each new type fires once with the documented payload; `close` after `resolve()`
  reports `reason: 'resolved'` and the data; `close` from eviction reports `'evicted'`.
- Type-level: assigning `(e: WindowEvent) => e.rect` fails to compile and
  `if (e.type === 'geometry') e.rect` compiles (a `// @ts-expect-error` line in the spec).
- Playground: the event log names closed windows without the side map.
- All three gates in CLAUDE.md §9 pass (`/verify-task`).

### Out of scope

Component-level `emits` on `BaseWindow`/`WindowHost`; a `beforeOpen` hook.

---

## VW-28 — Maximize as a first-class action

**Roadmap:** none — found by [review 2 §2.3, 4.1](../FABLE_REVIEW_AND_PLAN_2.md) · **Size:** M ·
**Blocks:** nothing · **Status:** proposed.

### Goal

`maximize(id)`, `unmaximize(id)`, `toggleMaximize(id)` and `isMaximized(id)` exist on the store and
use the attached viewport; the default controls show a maximize/restore button next to minimize when
the window is resizable and snapping is enabled; the double-click keeps working and goes through the
same method.

Today "maximize" is `snap(id, 'max', view)` with a viewport the consumer has to supply, and the only
affordance is a double-click that is a silent no-op when `snap.enabled` is false.

### Do

- `src/state.ts`: the four methods, thin over `snap`/`undock` and `docks`, using the closure
  `viewport`. `isMaximized` = `dockZone(id) === 'max'`. No new descriptor field (the dock map already
  holds it).
- `src/types.ts` `ControlLabels`: add `maximize` and `restore`; `labelsFor` merges them like the rest.
- `src/BaseWindow.vue`: a third default control, rendered when `canResize && snap.enabled`;
  `aria-label` from `labels.maximize` / `labels.restore` depending on state; `aria-pressed`; the
  existing DEV warning at `:129-140` names the two new labels. The double-click handler calls
  `toggleMaximize`. `data-vw-maximized` attribute on the dialog for consumer styling.
- `src/style.css`: a glyph for the new button in the same style as the others, cosmetic only.
- `README.md` §Controls, §Snapping; `docs/window-modes.md` (+ `_ru`).

### Files

`src/state.ts`, `src/types.ts`, `src/BaseWindow.vue`, `src/style.css`, `README.md`,
`docs/window-modes.md`, `docs/window-modes_ru.md`, `playground/App.vue` (drop the hand-built
maximize), `src/__tests__/state.spec.ts` and `src/__tests__/host.spec.ts` gain cases (additions
only).

### Done when

- `maximize(id)` docks to `'max'` at the attached viewport; `unmaximize` restores the previous rect;
  `toggleMaximize` alternates; `isMaximized` tracks `dockZone`.
- The button renders only when resizable and `snap.enabled`; its `aria-label` flips with state; the
  DEV warning fires when `labels.maximize` is missing and the button is rendered.
- Existing double-click test still passes.
- Playground: click maximize, restore, double-click, keyboard `Meta+ArrowUp` — all four agree.
- All three gates in CLAUDE.md §9 pass (`/verify-task`).

### Out of scope

Maximize with `snap.enabled: false` (would need a viewport-dock path without snapping; raise if
wanted); a fullscreen API.

---

## VW-29 — Per-window ESC policy

**Roadmap:** none — found by [review 2 §4.3](../FABLE_REVIEW_AND_PLAN_2.md) · **Size:** S ·
**Blocks:** nothing · **Status:** proposed.

### Goal

`escape: 'minimize' | 'close' | 'none'` is a `WindowDefaults` / `OpenOptions` / preset option with
the current behaviour as the default (`'minimize'` for an ordinary window, `'close'` forced for
sheets and modals).

### Do

- `src/types.ts`: the option on `WindowDefaults` and `OpenOptions`; not on `WindowDescriptor`.
- `src/state.ts`: a `reactive Map<id, EscapePolicy>` beside `pins`, written in `openWindow` from the
  usual precedence (call → preset → spec → default), read by `escapeOf(id)`, cleared in the three
  teardown blocks. Sheets and modals ignore the option (`'close'`), with a DEV warn if a consumer set
  something else.
- `src/BaseWindow.vue` `onKeydown` ESC branch: switch on `win.escapeOf(d.id)`; `'close'` goes through
  `requestClose`, `'none'` does nothing and does not `preventDefault`.
- `README.md` §Keyboard, `docs/window-modes.md` (+ `_ru`).

### Files

`src/types.ts`, `src/state.ts`, `src/BaseWindow.vue`, `README.md`, `docs/window-modes.md`,
`docs/window-modes_ru.md`, `src/__tests__/host.spec.ts` gains cases; the real-ESC check goes in
`src/__tests__/esc.browser.spec.ts` (additions only).

### Done when

- Default: unchanged, every existing ESC test passes.
- `escape: 'close'`: ESC calls `requestClose`, a refusing guard keeps the window.
- `escape: 'none'`: ESC leaves the window and the event untouched.
- A modal opened with `escape: 'minimize'` still closes on ESC, with one DEV warning.
- Hydrated windows get the policy from their spec (the map is runtime-only, not persisted).
- Playground: the ESC select on the open form drives all three behaviours.
- All three gates in CLAUDE.md §9 pass (`/verify-task`).

### Out of scope

An app-wide `escape` default in `createWindows` beyond `WindowDefaults`; ESC to un-maximize.

---

## VW-30 — Frame render cost

**Roadmap:** [docs/performance.md](./docs/performance.md) · **Size:** M · **Blocks:** nothing ·
**Status:** proposed.

### Goal

A drag or resize costs one style write per frame on one element, not a vdom patch of nine style
objects. `clampAll` on viewport resize runs at most once per animation frame.

Today `BaseWindow`'s `style` computed (`src/BaseWindow.vue:222`) depends on `d.x/y/w/h`, so the whole
frame re-renders per `pointermove` and re-allocates the header style (`:371`) and eight grip styles
(`:262`, `:452`).

### Do

- `src/BaseWindow.vue`: position and size go to `--_vtd-x/y/w/h` custom properties set on the
  dialog from a `watchEffect` that writes `el.style.setProperty` directly (SSR-guarded; the
  first render still inlines them so the no-JS/first paint is right). The `style` computed keeps only
  what does not change per frame; `transform`/`width`/`height` read the custom properties. Header and
  grip style objects become module-level constants; the cursor override on the header becomes a
  class toggle.
- `src/WindowHost.vue:23`: wrap the `clampAll` watcher in a rAF gate.
- `src/__bench__/host.bench.ts`: a "100 pointermoves on one window" case; record before/after in the
  task's `### Verification` when done.
- `docs/performance.md` (+ `_ru`): update the drag paragraph.

### Files

`src/BaseWindow.vue`, `src/WindowHost.vue`, `src/__bench__/host.bench.ts`, `docs/performance.md`,
`docs/performance_ru.md`; `src/__tests__/host.spec.ts` may gain a render-count case (addition only).

### Done when

- Every existing host, drag, resize, pinned, transitions and layout test passes untouched (they read
  `d.x` etc. from the store, and the browser specs read computed geometry, which the custom
  properties still produce).
- A render-count spy on `BaseWindow` shows 0 re-renders across 100 `pointermove`s.
- Bench: the pointermove case is at least 3× faster than the recorded baseline.
- SSR spec passes untouched (no `el.style` at module scope or in `setup()` before mount).
- Playground: drag a window with the DevTools performance overlay on; no layout thrash, no dropped
  frames at 60 Hz.
- All three gates in CLAUDE.md §9 pass (`/verify-task`).

### Out of scope

The persistence deep watch (documented cost); virtualising the stack.

---

## VW-31 — Specs are type-checked

**Roadmap:** none — found by [review 2 §3.4–3.6](../FABLE_REVIEW_AND_PLAN_2.md) · **Size:** S ·
**Blocks:** VW-33 · **Status:** proposed.

### Goal

`pnpm type-check` covers `src/__tests__/` and `src/__bench__/`; the declaration build uses the same
strictness as the app build; ESLint runs the type-aware promise rules.

### Do

- New `tsconfig.vitest.json` extending `tsconfig.app.json` with `include` set to the spec and bench
  globs plus `src/**/*`, `types: ["vitest/globals"]` if needed (specs import from `vitest`, so likely
  not), and its own `tsBuildInfoFile`. Add it to `tsconfig.json` `references`. Note: jsdom and
  browser specs share one config; if the browser specs need `@vitest/browser` types, add them there.
- `tsconfig.lib.json`: add `"noUncheckedIndexedAccess": true`.
- `eslint.config.ts`: switch to `vueTsConfigs.recommendedTypeChecked` with `parserOptions.project`
  pointing at the three configs; enable `@typescript-eslint/no-floating-promises` and
  `no-misused-promises`. Fix what they flag in `src/` (expected: a handful of `void` annotations).
- Fix every type error the first `pnpm type-check` raises in specs. Constraint 6: an assertion's
  *meaning* does not change; a `!` or a cast that makes the same assertion compile is fine. If a spec
  is found to assert the wrong thing, raise it, do not fix it here.
- `docs/build.md` (+ `_ru`), CLAUDE.md §Commands: mention the new config.

### Files

`tsconfig.json`, new `tsconfig.vitest.json`, `tsconfig.lib.json`, `eslint.config.ts`, `docs/build.md`,
`docs/build_ru.md`, `CLAUDE.md`, and whichever specs need type fixes.

### Done when

- `pnpm type-check` fails when a spec calls `win.noSuchMethod()` (verify with a temporary line,
  then remove it).
- `pnpm build-types` output is byte-identical before and after the `noUncheckedIndexedAccess` change,
  or every difference is explained.
- `pnpm lint` passes with the type-aware rules; lint time is recorded in `### Verification`.
- Both vitest projects pass with the same counts as before.
- All three gates in CLAUDE.md §9 pass (`/verify-task`); gate 3 is a playground smoke only.

### Out of scope

`strictTypeChecked`, `exactOptionalPropertyTypes`, coverage thresholds, CI.

---

## VW-32 — Minor batch: restored `resolve()`, exports, persist warnings

**Roadmap:** none — found by [review 2 §1.5, 2.5, 2.7, 3.9](../FABLE_REVIEW_AND_PLAN_2.md) ·
**Size:** S · **Blocks:** nothing · **Status:** proposed.

### Goal

Four small fixes that share no code and are each too small for a branch.

### Do

- `src/state.ts` `hydrate()`: a restored window gets a real deferred result (`deferResult`) whose
  promise is **already** settled with `RESTORED` for the old caller, plus a live `settle` so a later
  `resolve(id, data)` records `{ ok: true, data }` and `resultOf(id)` reports it. Simplest: keep a
  second promise for the post-hydrate answer and let `resultOf` return the later of the two.
- `src/index.ts`: export `ControlLabels` (type).
- `package.json` `exports["."]`: add `"default": "./dist/vue3-dialogs-lib.js"` after `import`.
- `src/persist.ts`: every `catch` calls `warn()` (import from `state.ts`, or lift `warn` into a
  tiny `src/warn.ts` used by `state.ts`, `options.ts`, `WindowHost.vue` too) with a one-line message;
  DEV-only by construction.
- `README.md` §Persistence: two sentences — `useWindows()` outside `setup()` is a fallback to the
  last-installed app and is not SSR-safe.
- Teardown: extract `forgetRuntime(id)` used by `close`, `closeAll`, `hydrate`.

### Files

`src/state.ts`, `src/index.ts`, `package.json`, `src/persist.ts`, `src/options.ts`,
`src/WindowHost.vue`, `README.md`, `src/__tests__/results.spec.ts` and `src/__tests__/persist.spec.ts`
gain cases (additions only).

### Done when

- `resolve('a', {saved: 1})` on a hydrated window → `await resultOf('a')` is `{ ok: true, data }`
  and the window is closed; the pre-hydrate promise (if any) is still `RESTORED`.
- `import type { ControlLabels } from '@korneevec/vue3-dialogs-lib'` compiles against `dist/types`.
- A storage `setItem` that throws produces one DEV warning in the persist spec (spy on
  `console.warn`) and none in production mode.
- `pnpm pack` tarball's `package.json` has the `default` condition.
- Playground: no visible change; a smoke run.
- All three gates in CLAUDE.md §9 pass (`/verify-task`).

### Out of scope

`newId`/`newToken` merge, the `require` rename, splitting `openWindow` — pure refactors, do them
when a feature touches those lines.

---

## VW-33 — Coverage for the untested modules

**Roadmap:** none — found by [review 2 §3.7](../FABLE_REVIEW_AND_PLAN_2.md) · **Size:** M ·
**Depends on:** VW-31 · **Status:** proposed.

### Goal

Every public export is asserted by name; every composable has a spec that imports it directly;
`prefers-reduced-motion` is measured in a real browser.

### Do

- New `src/__tests__/exports.spec.ts`: `Object.keys(await import('../index'))` equals a literal
  sorted list; type-level: `expectTypeOf<ControlLabels>()`.
- New `src/__tests__/viewport.spec.ts`: SSR fallback `1024×768`, resize listener attach/detach on
  scope dispose, one listener per scope.
- New `src/__tests__/resize.spec.ts`: `useWindowResize` against a fake descriptor and view, all 8
  dirs, min/max, west/north clamps, `RESIZE_DIRS`/`RESIZE_STYLES` shape.
- New `src/__tests__/keymap.spec.ts` additions or `useKeymap.spec.ts`: document listener attach/
  detach, `defaultPrevented` stand-down, input/textarea/contenteditable stand-down.
- `src/__tests__/host.spec.ts` or new `context.spec.ts`: `provideWindowContext` + `useWindowOptions`
  round-trip.
- `src/__tests__/transitions.browser.spec.ts` addition: with `page.emulateMedia({ reducedMotion:
  'reduce' })` (via the Playwright provider's context), `--vtd-motion-duration` resolves to `0ms`
  and a close retires in the same frame.
- `src/__tests__/host.spec.ts` addition: `mobileBreakpoint` flips the fullscreen layout on
  `resize`.

### Files

New spec files above; additions only to existing ones.

### Done when

- `pnpm exec vitest run` shows the new files; unit count ≥ 380, browser count ≥ 38.
- Removing `RESIZE_DIRS` from `src/index.ts` fails `exports.spec.ts` (verify, then revert).
- All three gates in CLAUDE.md §9 pass (`/verify-task`); gate 3 is a playground smoke only.

### Out of scope

Coverage thresholds; a CI pipeline.

---

## VW-34 — No-stylesheet affordance and reduced-motion docs

**Roadmap:** [§1 Transitions](./_doc/ROADMAP-gaps.md) for the motion half · **Size:** S ·
**Blocks:** nothing · **Status:** proposed.

### Goal

Without `style.css` the snap ghost and the scrim are still perceivable, and a consumer who overrides
`--vtd-motion-duration` is told how not to defeat `prefers-reduced-motion`.

### Do

- First, read constraint 7 in `_doc/TASKS-tier1.md` literally. If "structure stays inline;
  `style.css` is cosmetics only" forbids an inline tint, the ghost/scrim half of this task is a
  README paragraph ("with no stylesheet the ghost and the scrim are invisible; here is the four-line
  CSS to make them visible") and nothing else. If it allows a minimal fallback, add inline
  `outline: 2px dashed currentColor` on the ghost and `background: rgb(0 0 0 / .3)` on the scrim, both
  overridable by `style.css` as today (the stylesheet already sets them, so the visible result with
  the stylesheet is unchanged). Record the decision in `### Notes`.
- `src/WindowHost.vue` `durationOf`: when `window.matchMedia('(prefers-reduced-motion: reduce)')`
  matches (guarded), return `0` regardless of the computed property. One line; the stylesheet rule
  stays for the CSS transitions themselves.
- `docs/motion.md` (+ `_ru`), README §Styling: a "reduced motion" subsection — the library's rule is
  zero-specificity, an override wins, check the media query first; a snippet.
- `playground/App.vue:223-227`: the slider respects the media query (sets nothing when it matches).

### Files

`src/WindowHost.vue`, possibly `src/WindowHost.vue` ghost/scrim styles, `docs/motion.md`,
`docs/motion_ru.md`, `README.md`, `playground/App.vue`; `src/__tests__/transitions.spec.ts` gains a
`matchMedia`-stubbed case (addition only).

### Done when

- With `matchMedia` stubbed to match, a close retires synchronously even when
  `--vtd-motion-duration: 300ms` is set on the element.
- If the inline fallback was chosen: with no stylesheet the ghost and scrim have a computed
  non-transparent outline/background in the browser project; with the stylesheet the computed values
  equal today's.
- Playground: toggle the OS reduced-motion setting (or DevTools rendering emulation), move the
  slider, close a window — no animation.
- All three gates in CLAUDE.md §9 pass (`/verify-task`).

### Out of scope

A scrim fade-out; touch-sized grips (Tier 2 roadmap row).
