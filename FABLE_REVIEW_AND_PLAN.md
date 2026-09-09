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
VW-20 minor batch         (S)   — last, sweeps leftovers
VW-19 control labels      (M)   — separate release, needs an option-shape decision first
VW-21 modal windows       (L)   — independent of the above; reopens a documented non-goal, so it
                                  needs the decision in its own section before any code
```

VW-13 to VW-15 are bug fixes and ship as `0.2.1`. VW-16, VW-19 and VW-21 add public surface and
belong in `0.3.0`. Versions are not bumped as part of any task; releases stay manual.

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

**Roadmap:** none, API consistency · **Size:** M · **Depends on:** VW-13 · **Status:** done, merged into `master` for 0.3.0.

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

**Roadmap:** §9 · **Size:** S · **Depends on:** VW-15 · **Status:** done, merged into `master`.

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

**Roadmap:** tier 2 "Default control labels" · **Size:** M · **Depends on:** VW-20 (independent
lines, so it can land first) · **Status:** done, merged into `master` for 0.3.0.

#### Decision taken

`labels: { minimize?, close?, pin? }`, `aria-label` only, no default strings, and a dev-mode
`console.warn` when a frame renders a default control with no name and no `controls` slot. The
strings stay the consumer's, so constraint 4 holds: the library only places them.

Three details were decided on top of that shape:

- **Both levels.** `labels` is an app-wide option *and* a `WindowDefaults` key, so it works as a
  component spec default and as an `open()` option: `open('settings', {}, { labels: { close:
  'Close settings' } })`. Merged key by key, `open()` over the spec over the app-wide option, so a
  window that names only `close` keeps the app-wide `minimize`.
- **The pin toggle takes one name.** The button is a toggle, so it carries `aria-pressed` with the
  pin state and a single `labels.pin` covers both directions — the standard toggle-button pattern,
  and one string instead of two. `aria-pressed` is rendered whether or not a label was given.
- **`restore` is not part of this.** The roadmap row named it, but the taskbar is renderless: its
  button is the consumer's own markup and already carries whatever name they gave it.

Per-window labels are **runtime-only**, in a reactive map beside `pins`, for the reason that
decided every other map there: `WindowDescriptor` gains no field (constraint 2) and `SCHEMA` does
not move (constraint 1). A label is a property of the running app's locale, not of the window, so
losing it across a reload is correct — the app-wide option is re-read on the next install.

#### Goal

The default ✕, – and ▲ buttons have an accessible name whenever the consumer supplies one, from
one place for the whole app or per window, and a consumer who supplies none is told about it in
dev instead of shipping three unnamed buttons.

#### Do

- `src/types.ts`: `ControlLabels { minimize?, close?, pin? }`; `labels?: ControlLabels` on
  `WindowDefaults` (which is what puts it on `WindowSpec` and `OpenOptions`) and on
  `WindowsOptions`; `labels: ControlLabels` on `ResolvedOptions`.
- `src/options.ts`: `labels: options.labels ?? NO_LABELS`, a frozen empty object like
  `NO_DEFAULTS`.
- `src/state.ts`: `controlLabels = reactive(new Map<string, ControlLabels>())` beside `pins`, with
  the same runtime-only rationale comment. Filled in `openWindow` from `{ ...defs.labels,
  ...opts.labels }` when either side has a key, cleared in `close()`, `closeAll()` and
  `hydrate()` where `pins` is. One store method, `labelsFor(id)`, returning the effective merge
  `{ ...options.labels, ...controlLabels.get(id) }` — the store already holds the options, so the
  precedence lives in one place rather than in the template.
- `src/BaseWindow.vue`: `:aria-label` on the three default buttons from a `labels` computed over
  `win.labelsFor(d.id)`; `:aria-pressed="pinned"` on the pin button. An undefined label renders no
  attribute, which is what keeps the DOM identical for a consumer who sets none.
- `src/BaseWindow.vue`, dev warning: on mount, in `DEV` only, when no `controls` slot was passed
  and a rendered control has no name, warn once per app. The flag is a module-level `WeakSet` keyed
  on the resolved options object, so one desktop warns once however many windows it opens, and two
  independent `createWindows()` calls each warn.
- `playground/`: labels on the app-wide options, and one window with a per-window `close` label.
- Docs: the options block and a short "Control labels" section in `README.md`, the `FEATURES.md`
  row, and the runtime-state list in `docs/how-it-works.md` that already names `docks` and `pins`.
  The tier-2 row in `_doc/ROADMAP-gaps.md` moves to the shipped list rather than staying open.

#### Files

`src/types.ts`, `src/options.ts`, `src/state.ts`, `src/BaseWindow.vue`, new
`src/__tests__/labels.spec.ts`, `playground/`, `README.md`, `FEATURES.md`, `docs/how-it-works.md`,
`_doc/ROADMAP-gaps.md`.

#### Done when

- `labels.spec.ts`: with app-wide labels, the minimize and close buttons carry them; a window
  opened with `{ labels: { close: 'Close settings' } }` overrides only `close` and keeps the
  app-wide `minimize`; a component spec's labels sit between the two.
- The pin button carries `aria-pressed="false"`, then `"true"` after a click, with and without a
  `labels.pin`.
- With no labels anywhere, no `aria-label` attribute is rendered at all and `console.warn` fires
  exactly once for two open windows; with a `controls` slot it never fires; in neither case does it
  fire outside `DEV`.
- No label reaches the descriptor or the persisted blob, and `hydrate()` drops the per-window
  entries. `persist.spec.ts`, `pinned.spec.ts` and `host.spec.ts` pass untouched — the `.vw__btn`
  count and order do not move.
- Playground: a screen reader reads "Close" and "Minimize" on the default controls, the pinned
  window's pin button reads as a pressed toggle, and the console carries no label warning.

#### Out of scope

Default English strings, a `restore` label for the taskbar, labelling the resize grips (they are
`aria-hidden` and pointer-only), and translating the title — the title is already the dialog's
accessible name.

---

### VW-21 — Modal windows, scrim and open presets

**Roadmap:** none — reopens a rejected non-goal, see the decision below · **Size:** L ·
**Depends on:** nothing · **Status:** needs the decision recorded below to be confirmed, then open.

#### What exists today, and what does not

The question that started this task was whether pinned windows already carry presets — a size, a
position, a tinted background. They do not. `fixed` (VW-11) is exactly two things: a second render
band, `zIndexBase + topZ + d.z` in `src/BaseWindow.vue:152`, and one `interactive()` predicate
(`src/BaseWindow.vue:33`) that turns drag, resize, the arrow keys and the maximize double-click off.
A pinned window is visually identical to every other one — `src/style.css` has no `[data-vw-pinned]`
rule and no tint token, and `data-vw-pinned` sits on the pin button rather than on the `<dialog>`.

Nothing else of the classical-dialog shape is present either:

- No presets, and no centring code path. Every window opens through `cascade()`
  (`src/geometry.ts:21-28`) at `40 + (index % 8) * 28`, sized `640×480`.
- No scrim, overlay or backdrop anywhere. `BaseWindow.vue:69` calls `el.show()`, never
  `showModal()`; `aria-modal` and `::backdrop` do not occur in `src/`.
- The only click blocking in the library is `inert` on a single element: an owner's own `<dialog>`
  while it has a child sheet (`src/BaseWindow.vue:84-100`). `owned.browser.spec.ts:80` asserts that
  a sibling window stays draggable, precisely because there is no page-wide overlay.

#### The decision, and the non-goal it reopens

`_doc/ROADMAP-gaps.md:209-217` lists "Modal mode / `showModal()` / page-wide backdrop / focus trap"
under *Considered and rejected — the founding non-goal*, and `README.md:335` and
`docs/how-it-works.md:215` sell non-modality as a design position. This task reopens part of that
decision deliberately, in a narrow reading that the docs must be rewritten to state:

- still `show()`, never `showModal()` — no top layer, so the taskbar, `zIndexBase`, the two existing
  bands and the leaving/transition lifecycle all keep working;
- the scrim and the `inert` sweep are opt-in per window, so a desktop with no modal open behaves
  exactly as it does today;
- no focus-trap loop. Containment comes from `inert`, the same mechanism owner-sheets already use.
  The one hole this leaves is named and covered by an option below rather than papered over.

The rejection bullet in `_doc/ROADMAP-gaps.md` is edited as part of this task; leaving it standing
would put the docs in contradiction with the library.

Four shape decisions were taken up front:

| Question | Decision |
| --- | --- |
| Flag shape | A new `modal` capability, separate from `fixed`. Decided at `open()` time and not toggleable from the header. Pinning keeps its non-blocking always-on-top meaning and its runtime toggle. |
| Mechanism | A synthetic scrim element plus `inert` on every other window. `show()` is kept. |
| Presets | `placement: 'center'` **and** a named `presets` map in `createWindows` options. |
| Persistence | A modal window is filtered out of the persisted blob entirely, exactly as an owned window is. |

#### Goal

`open(name, props, { modal: true })` opens a window that draws above everything, dims the page behind
it, and is the only thing on screen that answers a click — the `el-dialog` shape — while a desktop
with no modal open is byte-for-byte the desktop that exists today. Alongside it, a named preset map
and a `center` placement make that shape a one-liner without the library shipping opinions about
size, position or chrome.

#### Do

**Runtime state.** `const modals = reactive(new Set<string>())` in `src/state.ts`, next to `pins`
(`:114`) and carrying the same rationale comment. Populated in `openWindow` where `pins` is
(`:571-573`), from `opts.modal ?? defs.modal`; `modal` goes on `WindowDefaults` in `src/types.ts:44-57`
beside `fixed`, so it works as a spec default, a preset field and an `open()` option. It never reaches
the descriptor: `SCHEMA` does not move (constraint 1) and `WindowDescriptor` gains no field
(constraint 2). Cleared where `pins` is cleared — `close()` (`:315-316`), `closeAll()` (`:332-333`),
`hydrate()` (`:721-722`).

Store API, mirroring `isPinned`:

```ts
isModal(id): boolean          // this window is a modal
topModalId(): string | null   // highest-z non-minimized modal, or null — what the scrim sits under
isBlockedByModal(id): boolean // a modal is open and this window is neither it nor a child of it
```

`isBlockedByModal` returns false for every id when no modal is open. That is the guard which keeps
`owned.spec.ts` passing untouched (constraint 6). A modal is forced `minimizable: false` at
`openWindow`, the same forcing owned windows already get (`state.ts:562-564`), so a minimized modal
freezing the desktop stays theoretical.

**Bands and the scrim.** The bands today are unpinned `base + d.z`, pinned `base + topZ + d.z`, and
the snap ghost `base + 2*topZ + 1` (`WindowHost.vue:189`); `d.z <= topZ` always, so each is clear of
the next. Add a third above the ghost, in `BaseWindow.vue`'s `style` computed (`:149-152`):

```ts
zIndex: String(options.zIndexBase + band * win.s.topZ + d.z)   // band: modal ? 3 : pinned ? 1 : 0
```

The ghost keeps `2*topZ + 1` untouched — `pinned.spec.ts:174-185` asserts ghost above pinned dialog,
and a ghost cannot coexist with a modal anyway, since every other window is inert and no drag can
start.

The scrim is one element in `WindowHost.vue`, a sibling of the ghost, rendered only when
`topModalId()` is non-null and positioned one below that modal's own rendered z. One scrim, under the
topmost modal: stacked modals then dim each other, which is what `el-dialog` does, and the lower one
is inert regardless. Its `position`, `inset` and `z-index` are inline so that clicks are blocked with
no stylesheet imported (constraint 7); the tint is a new `.vw-scrim` rule in `src/style.css` reading a
new `--vtd-scrim-bg` token (default `rgba(0, 0, 0, 0.4)`), beside the existing `.vw-ghost` block
(`:72-79`), with a dark-scheme override and a fade on `--vtd-motion-duration` so a modal does not
leave a hard rectangle behind mid-transition. It is `aria-hidden="true"` and carries no click
handler — click-outside-to-dismiss stays the consumer's business.

**Blocking.** `BaseWindow.vue:86-100` already owns an `inert` watcher that records and restores
`priorInert` and flushes `sync`. Widen only its condition:

```ts
const blocked = computed(() => win.hasChild(d.id) || win.isBlockedByModal(d.id))
```

Nothing else in that watcher changes — the recording that makes a nested owner safe is exactly what
makes a modal over an owner safe.

**Focus.** `inert` covers the other windows. It does not cover the consumer's own page behind the
scrim: the scrim blocks the pointer, but Tab can still walk into the app. Closing that with a trap
loop is the founding non-goal, so instead an opt-in option, no default:

```ts
createWindows({ modal: { inertRoot: '#app' } })   // selector or HTMLElement
```

While a modal is open, `WindowHost` sets `inert` on that element and takes it off after, with the same
record-and-restore discipline, resolved in `onMounted` and guarded for SSR. Documented plainly:
without it, a modal blocks clicks but not Tab.

**ESC.** `onEscape` (`BaseWindow.vue:202-215`) dismisses for `owned` and minimizes otherwise. A modal
takes the sheet's branch — `e.preventDefault()` then `requestClose(d.id)` — so close guards still run.

**Presets and centring.** `placement: 'cascade' | 'center'` on `WindowDefaults`, default `'cascade'`.
`src/geometry.ts` gains `centerRect(w, h, view)` beside `cascade()`, and `openWindow` picks between
them at `state.ts:556`; an explicit `opts.x`/`opts.y` beats `placement` either way. Centring needs the
viewport, which `createStore(options)` (`state.ts:77`) does not have, since the store is built before
`createViewport()` in `createWindows.ts:17,25` — add `store.attachViewport(view)`, called inside the
existing effect scope right after `createViewport()`, with the store holding a `{ w: 1024, h: 768 }`
default until then so SSR and a store used without the plugin still work.

`presets: Record<string, WindowDefaults>` on `WindowsOptions`, resolved in `src/options.ts` beside
`defaultsFor(name)` (`:232-234`) as `presetFor(name)`. Precedence at `openWindow` becomes one step
wider than today's comment at `state.ts:547`: the `open()` call, then the named preset, then the
component's spec, then the library default. A preset is named at the call site, so it outranks the
component's own spec but loses to the explicit options of that call. An unknown preset name throws at
`open()`, exactly as an unknown owner id does.

Together that is the whole `el-dialog` shape without the library holding an opinion:

```js
createWindows({
  presets: {
    dialog: { modal: true, placement: 'center', w: 420, h: 200,
              draggable: false, resizable: false, minimizable: false },
  },
})

const ok = await win.open('confirm', { message }, { preset: 'dialog' }).result
```

**Persistence.** `persist.ts:135` already writes `store.s.stack.filter((w) => !store.ownerOf(w.id))`.
Extend that one predicate to drop modals, and extend the comment at `:129-131` with the same
reasoning: a modal that came back after a reload would be a question with nobody asking it. `SCHEMA`,
`normalize()` and `isDescriptor` are untouched.

#### Files

`src/types.ts` (`modal`, `placement` on `WindowDefaults`; `preset` on `OpenOptions`; `presets` and
`modal.inertRoot` on `WindowsOptions`/`ResolvedOptions`), `src/state.ts`, `src/geometry.ts`,
`src/options.ts`, `src/createWindows.ts`, `src/WindowHost.vue`, `src/BaseWindow.vue`, `src/persist.ts`,
`src/style.css`, new `src/__tests__/modal.spec.ts` and `src/__tests__/modal.browser.spec.ts`,
`playground/`, `README.md`, `FEATURES.md`, `docs/how-it-works.md`, `docs/recipes.md`,
`_doc/ROADMAP-gaps.md`.

Docs to write: a "Modal windows" section in `README.md` after "Pinned windows" (`:422-452`) saying
plainly what modal does and does not do; a `docs/how-it-works.md` section after "Pinned windows"
(`:280-311`) in the same transition-table style, covering the third band, the single scrim, the
`inert` sweep and the persistence exclusion; a `docs/recipes.md` entry beside the owner-sheet one
(`:592-641`) contrasting a sheet (owner-scoped) with a modal (desktop-scoped); and the rewrite of the
`_doc/ROADMAP-gaps.md:209-217` rejection bullet.

The browser spec is not optional: `inert` and hit-testing are UA behaviour and jsdom implements
neither, which is exactly the split constraint 8 draws.

#### Done when

- `modal: true` never reaches the descriptor. `isModal` is true and `isPinned` false — the two are
  independent, and `{ modal: true, fixed: true }` renders in the modal band.
- A modal's rendered `z-index` is above a pinned window's and above a window focused after it.
- The scrim renders once for two stacked modals, at the top modal's z minus one, and not at all when
  no modal is open.
- `isBlockedByModal` is false for every id when no modal is open, and false for a sheet owned by the
  modal. `owned.spec.ts` and `pinned.spec.ts` pass untouched.
- The state is cleared on `close`, `closeAll` and `hydrate`; the persisted blob matches neither
  `/modal|scrim/` nor contains the modal's id, and a reload returns the desktop without it.
- `placement: 'center'` puts a 400×300 window at `(view.w - 400) / 2, (view.h - 300) / 2`; explicit
  `x`/`y` still win; the default stays `cascade`, asserted against an existing cascade position.
- Preset precedence holds in both directions — `open()` options beat the preset, the preset beats the
  component spec — and an unknown preset name throws `/preset/`.
- ESC on a modal calls `requestClose`, not `minimize`, and a close guard still runs.
- In Chromium: a pointerdown on a background window's header while a modal is open moves nothing, and
  the same drag works once the modal closes; every other `<dialog>` carries `inert` while the modal is
  open and none does after; a window that was already `inert` for its own reason is still `inert`
  afterwards; Tab from inside the modal never reaches a background window's control; with
  `modal.inertRoot` set a button in the page behind is unreachable by Tab and without it is reachable
  (the documented hole, pinned by a test so it cannot regress silently); and with no stylesheet
  imported a click at the viewport centre outside the modal still does not reach a page-behind button.
- Playground: `open('confirm', { message }, { preset: 'dialog' })` opens centred at 420×200 over a
  dimmed page with no grips and no drag; clicking a background window and the taskbar does nothing;
  ESC closes it through its guard and the desktop is fully interactive again afterwards; a pinned
  window sits below the modal and is dimmed by the scrim; `--vtd-scrim-bg` overridden on `:root`
  changes the tint and the dark scheme picks up its own default; the persisted blob contains no modal.

#### Out of scope

Click-on-scrim to dismiss, scroll lock on the page behind, `showModal()` and the top layer, a
focus-trap loop, persisting modality, a modal toggle in the header, and one scrim per stacked modal.
Each is a decision of its own; they are listed here so a later reader knows they were considered
rather than missed.
