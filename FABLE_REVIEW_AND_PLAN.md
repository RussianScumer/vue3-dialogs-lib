# Review and plan — 2026-09-07

Deep review of `@korneevec/vue3-dialogs-lib` at `master` (`ae8ca59`), followed by a task plan in the
same contract format as `_doc/TASKS-tier1.md`. All twelve tier-1 tasks are merged; this document
covers what the review found on top of them.

## Gates as run

| Gate | Result |
|---|---|
| `npm run lint` | pass |
| `npm run type-check` | pass |
| `npx vitest run --project unit` | 219/220 pass. The one failure is the known timing-sensitive `transitions.spec.ts` "retires every frame of 50 opened and closed windows" case, which passes when the file runs alone. |
| `npx vitest run --project browser` | not run: `@vitest/browser-playwright` wants `chromium_headless_shell-1234`, only `-1208` is cached. `npx playwright install chromium` was started; the download is slow on this machine. |
| `npm run build` | pass; `dist/` contains the bundle, `types/` and `style.css`. |

## Findings

### Confirmed bugs

Both reproduced with a throwaway spec (deleted afterwards).

**1. A frame keeps a stale descriptor after `resume()` re-hydrates the store.**
`src/WindowHost.vue:139-152`. The watcher on `visible` only replaces `f.d` when the frame is in
the `leaving` state, and `BaseWindow` captures `props.descriptor` once at setup. `hydrate()`
replaces `s.stack` with fresh objects; any id that survives keeps rendering the old, detached
object. The store then says `x: 300` while the DOM renders `translate(10px, 10px)`, and a
subsequent drag mutates the detached object, which the persistence watcher never sees.
Realistic path: two tabs load the same blob, one edits, the other calls `resume()` from
`onExternalChange`.

**2. The snap ghost renders below every window when `zIndexBase > 0`.**
`src/WindowHost.vue:183`. The ghost uses `win.s.topZ + 1`; windows use
`options.zIndexBase + (pinned ? topZ : 0) + d.z`. With the playground's `zIndexBase: 1000` the
dialog is at z 1011 and the ghost at z 12. Even with base 0 the ghost sits under the pinned band.

### Design gaps

**3. The persistence debounce is lost on unload.** `src/persist.ts:135`. Writes are debounced by
300 ms and nothing flushes on `pagehide`. A reload within 300 ms of the last keystroke in a
`useWindowState` draft drops it. The docs promise reload survival without this caveat.

**4. The `geometry` event is not emitted for drag, resize or arrow-key nudges.** Only `snap()` and
`setGeometry()` emit it; the pointer and keyboard paths mutate the descriptor directly. A consumer
listening on `on('geometry')` misses most moves.

**5. Hydration does not clamp size.** `normalize()` fills `minW`/`maxW` but never runs
`clampSize`, so a hand-edited or older blob with `w < minW` renders under the minimum until the
first resize.

**6. `hydrate()` is silent to listeners.** It settles outstanding results as `closed` but emits no
`close` event for windows that a `resume()` drops.

**7. Module-level `activeStore` fallback.** `src/createWindows.ts:13`. Shared across SSR requests:
`useWindows()` outside `setup()` on a server returns the last-installed app's store. The comment
acknowledges it; the docs do not warn.

**8. The pinned band breaks "top window equals active window".** A pinned window is drawn above
everything, but `activeId` is derived from `z`, so ESC, the keymap and `data-vw-active` target the
unpinned window beneath it. Consistent with the VW-11 design, but surprising and undocumented.

### Packaging

**9.** `exports["."]` declares `types` and `import` only, no `default` condition. Tooling that
resolves with custom conditions fails.
**10.** No `prepack`/`prepublishOnly` runs `build`, so a stale `dist/` can ship. No CI at all.
**11.** README "Development" says `npm run test # unit tests`; it runs both projects and needs
Chromium.

### Minor

- `types.ts`: `state: unknown | null` collapses to `unknown`.
- `WindowTaskbar` types the `all` slot prop with the `minimized` computed's type.
- Resize from a west or north grip does not clamp `x`/`y` to `bounds`; drag does.
- `maxWindows: 0` evicts everything and opens the window anyway.
- `resolveOptions` uses `void component` to silence an unused binding.
- Roadmap tier-2 "Default control labels" is still open: the shipped ✕/– buttons have no
  accessible name unless the consumer replaces the `controls` slot. This is the largest
  accessibility hole.

### Strengths

The store design is clean: runtime-only maps keep the schema stable, every close path settles a
result, guards join instead of re-asking, owner groups re-stack atomically. Comments consistently
explain why, not what. The test suite is dense (about 4.5k lines against 3k of library).

---

## Plan

### Order

```
VW-14 ghost z-index       (XS)  ─┐
VW-13 stale frame         (S)    ├─ separate files, land in this order, one branch each
VW-15 pagehide flush      (S)   ─┘
VW-16 geometry events     (M)   — after VW-13 (neighbouring edits in WindowHost/BaseWindow)
VW-17 hydrate hardening   (S)   — after VW-15 (both in persist.ts)
VW-18 packaging + CI      (S)   — independent, any time
VW-20 minor batch         (S)   — last, sweeps leftovers
VW-19 control labels      (M)   — separate release, needs an option-shape decision first
```

VW-13 to VW-15 are bug fixes and ship as `0.2.1`. VW-16 and VW-19 add public surface and belong
in `0.3.0`. Versions are not bumped as part of any task; releases stay manual.

Every task obeys the global constraints in `_doc/TASKS-tier1.md`: `SCHEMA` untouched, no new
descriptor fields, no dependencies, no user-facing strings, SSR guards on every DOM access, the
existing suite untouched, and the three gates in order (lint + type-check, both vitest projects,
then the playground in a real browser via `/verify-task`).

---

### VW-14 — Snap ghost above every band

**Roadmap:** none, reported bug · **Size:** XS · **Depends on:** nothing · **Status:** done, merged into `master` for 0.2.1.

#### Goal

The drop-preview ghost renders above every window, pinned or not, whatever `zIndexBase` is.

#### Do

- `src/WindowHost.vue`, `ghostStyle`: `zIndex: String(options.zIndexBase + 2 * win.s.topZ + 1)`.
  The pinned band tops out at `base + topZ + topZ`, so this clears it.

#### Files

`src/WindowHost.vue`, `src/__tests__/host.spec.ts`, `src/__tests__/pinned.spec.ts`.

#### Done when

- `host.spec.ts`, next to the existing "offsets the rendered z-index by zIndexBase" case: open a
  window with `zIndexBase: 1000`, call `setPreview('left', view)`, assert the ghost's z-index is
  greater than the dialog's.
- `pinned.spec.ts`: a pinned window plus a preview, ghost still above.
- Playground (already `zIndexBase: 1000`): drag a window to the left edge; the ghost draws over
  the other windows and over a pinned one.

---

### VW-13 — A frame adopts a re-hydrated descriptor

**Roadmap:** §9 · **Size:** S · **Depends on:** nothing · **Status:** done, merged into `master` for 0.2.1.

#### Goal

After `hydrate()` — in practice after `ExternalChangeInfo.resume()` — every rendered frame shows
the descriptor that is now in the store, and drags on it are persisted.

#### Root cause

`WindowHost`'s watcher on `visible` swaps `f.d` only when the frame is `leaving`. `BaseWindow`
also does `const d = props.descriptor` once. A same-id descriptor arriving as a new object is
ignored by both.

#### Do

- Add `gen: number` to `Frame` and a module-level `generation` counter.
- In the `now` loop add a branch `else if (f.d !== d)`: `retire(id)`, then
  `frames.set(id, { d, state: 'entering', gen: ++generation })`.
- Template key becomes `` `${f.d.id}:${f.gen}` `` so Vue remounts the frame.
- Remounting is the intended semantics: the content re-reads `state` from the adopted descriptor,
  which is the whole point of `resume()`. Focus is not stolen: `hydrate()` marks every id
  restored and `useWindowFocus` already skips restored windows.
- Do **not** make `BaseWindow` react to descriptor changes. `d` is closed over by the drag,
  resize, focus and context composables; a remount is cheaper and correct.

#### Files

`src/WindowHost.vue`, new `src/__tests__/hydrate-frames.spec.ts`.

#### Done when

- Mount the host, open a window, `hydrate([clone with x: 300])`: the dialog's transform contains
  `300px`, exactly one `<dialog>` exists, and `useWindowState` inside the content sees the new
  draft.
- Same through the plugin: `setupPersist` with `onExternalChange`, fire a foreign storage event,
  call `info.resume()`, same assertions.
- A window absent from the new blob departs through the normal leaving path.
- Playground: two tabs; move a window in tab B; in tab A run `__vwResume()`; the window jumps to
  B's position and dragging it afterwards is persisted.

#### Out of scope

Merging the two tabs' stacks. VW-10's "second writer stops" rule stands.

---

### VW-15 — Flush the persistence debounce on `pagehide`

**Roadmap:** §9 · **Size:** S · **Depends on:** nothing · **Status:** done, merged into `master` for 0.2.1.

#### Goal

A change made in the last 300 ms before the page goes away still reaches storage.

#### Do

- `src/persist.ts`: extract `write()` from the watcher; the watcher only schedules it.
- Add `onPageHide`: if a timer is pending and the tab is not `stopped`, clear the timer and call
  `write()` synchronously.
- Register it on `window`, remove it in the same `onScopeDispose` as the storage listener.
- `pagehide` rather than `beforeunload`: it also fires for bfcache and mobile tab discard, and it
  does not block unload.
- `docs/how-it-works.md`, persistence section: one sentence on the flush.

#### Files

`src/persist.ts`, `src/__tests__/persist.spec.ts`, `src/__tests__/persist-crosstab.spec.ts`,
`docs/how-it-works.md`.

#### Done when

- `persist.spec.ts`: with fake timers, mutate `state`, dispatch `new Event('pagehide')` on
  `window` before advancing; storage already holds the draft.
- `persist-crosstab.spec.ts`: after a foreign write, `pagehide` writes nothing.
- `ssr.spec.ts` passes untouched; the listener sits behind the existing `typeof window` return.
- Playground: type in an ItemEditor draft and reload within a fraction of a second; the draft is
  back.

---

### VW-16 — `geometry` fires for every user gesture

**Roadmap:** none, API consistency · **Size:** M · **Depends on:** VW-13 · **Status:** open.

#### Goal

`on('geometry')` fires once per drag, resize, keyboard nudge and snap, so a consumer can react to
the window moving without polling the descriptor.

#### Do

- Check first: grep the specs for assertions on `geometry` call counts. If any existing assertion
  would change, stop and raise it (constraint 6).
- `useWindowDrag`: add `onEnd`; `onUp` calls `onDrop` when a zone is armed, otherwise `onEnd`.
- `BaseWindow`: map drag `onEnd` to `win.setGeometry(d.id, { x: d.x, y: d.y })`, which re-clamps
  and emits. Resize `onEnd` already exists: call `setGeometry` with `w`/`h` alongside `undock`.
- `onWindowKeydown`: add `onChange`, wired the same way.
- `clampAll` on viewport resize stays silent; document that.
- README event list: "once per drag, resize or nudge, and on snap".

#### Files

`src/useWindowDrag.ts`, `src/useWindowResize.ts`, `src/BaseWindow.vue`, `src/__tests__/host.spec.ts`,
`README.md`, `docs/recipes.md`.

#### Done when

- `host.spec.ts` drag test: a spy on `on('geometry')` is called once after `pointerup`, zero times
  during moves. Same for a resize grip and for `ArrowRight` on the header.
- Snap on drop still emits exactly once (from `snap()`), not twice.
- Playground event log shows one `geometry` line per gesture.

---

### VW-17 — Hydration hardening

**Roadmap:** §9 · **Size:** S · **Depends on:** VW-15 · **Status:** open.

#### Goal

A restored descriptor respects its own size limits, and listeners learn about windows a
re-hydration drops.

#### Do

- `normalize()`: after the limits are filled, `Object.assign(d, clampSize(d.w, d.h, d))`.
- `hydrate()`: emit `close` for every id that was in the old stack and is not in the new one.
  Do not emit `open` for arrivals; that would change what `on('open')` means. Raise it if the
  consumer story needs otherwise.

#### Files

`src/persist.ts`, `src/state.ts`, `src/__tests__/persist.spec.ts`, `src/__tests__/state.spec.ts`.

#### Done when

- `persist.spec.ts`: a blob with `w: 10` and `minW: 160` hydrates at 160.
- `state.spec.ts`: `hydrate()` that drops an id fires `close` once for it and nothing for
  survivors.

---

### VW-18 — Packaging and CI

**Roadmap:** none · **Size:** S · **Depends on:** nothing · **Status:** open.

#### Do

- `package.json`: add `"default": "./dist/vue3-dialogs-lib.js"` under `exports["."]`; add
  `"prepack": "npm run build"` so `npm publish` cannot ship a stale `dist/`.
- README Development: `npm run test` runs both projects and needs
  `npx playwright install chromium` once.
- `bitbucket-pipelines.yml`: Node 24 image, `npm ci`, `npx playwright install --with-deps chromium`,
  `npm run lint`, `npm run type-check`, `npx vitest run`, `npm run build`. Cache
  `~/.cache/ms-playwright`.
- `CLAUDE.md`: drop "no CI".

#### Done when

- `npm pack --dry-run` lists `dist/` after a clean checkout.
- A `node -e "import('@korneevec/vue3-dialogs-lib')"` from a consumer resolves with the `default`
  condition.
- The pipeline is green on a push to a branch.

---

### VW-20 — Minor batch

**Roadmap:** none · **Size:** S · **Depends on:** VW-16 · **Status:** open.

#### Do

- `types.ts`: `state: unknown | null` → `unknown`, same comment.
- `WindowTaskbar.vue`: type the `all` slot prop as `ComputedRef<WindowDescriptor[]>`.
- `useWindowResize.ts`: west and north grips clamp `x`/`y` through `clampX`/`clampY`; takes
  `view` and `bounds` in its options like drag does.
- `state.ts` `openWindow`: `maxWindows < 1` is treated as 1 with a dev warning.
- `options.ts`: rest-destructure with `_component` instead of `void component`.
- Docs: the pinned band versus `activeId` semantics (finding 8); `useWindows()` outside `setup()`
  on the server returns the last-installed store, prefer `inject` (finding 7).

#### Done when

- Type-check passes; a resize from the west grip past the left edge leaves at least `minVisible`
  px on screen (new case in `host.spec.ts`).

---

### VW-19 — Accessible names for the default controls

**Roadmap:** tier 2 "Default control labels" · **Size:** M · **Depends on:** VW-20 · **Status:**
needs a decision.

#### Decision needed

Option shape `labels: { minimize?, close?, pin? }`, `aria-label` only, no defaults, and a dev
warning when neither `labels` nor a `controls` slot is present. This keeps constraint 4 intact:
the strings come from the consumer, the library only places them.

#### Do

Written as its own contract once the shape is agreed. Not started before the tasks above land.
