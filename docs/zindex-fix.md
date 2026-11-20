# Fix: unbounded `topZ` growth breaks the z-index budget vs Element Plus

Library: `@korneevecin/vue3-dialogs-lib` (currently 0.6.3).
Symptom in the consumer app (logistic): after days of use, `ElMessageBox` / `ElNotification`
(z-index band starts at 2000 on every page load) render **behind** app windows. Looks
"Safari-only" only because the growth is persisted per-browser in localStorage.

## Root cause

Window z-index is computed as `zIndexBase + tier * topZ + z` (tiers: 0 background,
1 focused, 2 snap preview, 3 modal backdrop / modal-boosted windows, 4 context menu).

`topZ` and per-window `z` are monotonic counters:

- **open**: new descriptor gets `z: ++topZ`
- **focus**: the whole owner chain is renumbered `w.z = ++topZ` for each member
  (skipped only when the chain root is already topmost and not minimized)
- **hydrate**: `topZ = max(persisted topZ, max persisted z, 10)`
- **persist**: `topZ` and the stack's `z` values are written to storage verbatim

Nothing ever shrinks them. They survive reloads and grow without bound, so
`zIndexBase + 3*topZ + z` eventually crosses any fixed overlay band (Element Plus: 2000).
With `zIndexBase: 1000` the collision starts around `topZ ≈ 330` (modal tier) /
`topZ ≈ 500` (focused window, since `z ≈ topZ` there).

Minified-dist anchors (names will differ in source):

- state factory: `E({ stack: [], topZ: 10 })` — dist ~line 493
- focus renumber: `function P(e){ for (let n of e) n.z = ++t.topZ }` — ~558
- focus guard: `root.z === t.topZ && !minimized` — ~563
- open: `z: ++t.topZ` in the descriptor literal — ~779
- hydrate: `t.topZ = Math.max(o, 10)` — ~1022
- persist serialize: `topZ: e.s.topZ` — ~354
- z-index consumers: window style ~1561, context menu ~1634, modal backdrop ~1866,
  snap preview ~1895

## The fix: compact counters to rank order

`z` is only ever used for **relative ordering** (focus guard, alt-tab cycling sort,
persist truncation sort, hydrate max) and as an offset inside a tier. The absolute
values carry no meaning. So replace "monotonic counter" with the invariant:

> `z` values are exactly `1..n` in stack order; `topZ === n` (n = stack length,
> bounded by `maxWindows`).

### Implementation

1. Add one internal helper in the state module, e.g. `compact()`:
   - sort `state.stack` by current `z` ascending (stable; ties keep array order),
   - reassign `z = index + 1` in place (mutate the same descriptor objects — they are
     reactive and referenced by id everywhere; do **not** replace them),
   - set `state.topZ = state.stack.length` (keep the `max(…, 10)` floor only if some
     code relies on it — nothing should; prefer plain `n`, or `Math.max(n, 1)`).

2. Call `compact()` after every mutation that changes ordering or membership:
   - at the end of `open()` (after the descriptor is pushed),
   - at the end of the focus renumber (`P`/`F`) — the `root.z === topZ` early-exit
     guard keeps working unchanged, since compaction preserves "root is topmost",
   - at the end of `hydrate()` — **ignore the persisted `topZ` argument for ordering
     purposes**: renumber the incoming stack and derive `topZ` from it. This heals
     already-poisoned localStorage on the first load after the upgrade, no migration
     needed. Keep accepting the `(stack, topZ)` signature for API compatibility.
   - on window removal/close (keeps the invariant exact; not strictly required for
     correctness since values only shrink relative to the bound).

   Cost is O(n log n) with n ≤ maxWindows (8 in logistic) — negligible per focus.
   No threshold needed; the invariant holds always, which is easier to test and
   reason about than "compact when big".

3. Do **not** touch the four z-index formulas. With the invariant, the maximum
   z-index any library element can get is `zIndexBase + 4*n + 1`
   (context menu tier; modal-tier windows reach `zIndexBase + 4*n`).
   For logistic: `1000 + 4*8 + 1 = 1033` — permanently below Element Plus's 2000.

4. Persistence needs no schema change: it already writes `topZ` + `z`, which are now
   small by construction. Old payloads with huge values are compacted on hydrate.

### Document the consumer contract

In README / options docs for `zIndexBase`: the library occupies
`[zIndexBase, zIndexBase + 4*maxWindows + 1]`; consumers must keep their overlay
bands (Element Plus defaults to 2000+) above that. With default `maxWindows` this is
safe for any `zIndexBase ≤ ~1960`.

## Tests (vitest)

1. **Growth regression**: open/close/focus-cycle windows far beyond the old collision
   point (e.g. 2000 focus alternations between an owner and its child, plus opens).
   Assert after each step: `topZ === stack.length`, `z` values are a permutation of
   `1..n`, and every computed window/backdrop/menu z-index ≤ `zIndexBase + 4*maxWindows + 1`.
2. **Order preservation**: after compaction, focus order, alt-tab cycle order and
   "already topmost → no focus event" behavior are unchanged (compare before/after
   sequences on a small stack).
3. **Poisoned storage heal**: hydrate with `topZ: 100000` and large `z` values →
   state compacted, persisted payload rewritten small on next save.
4. **Persist round-trip**: save → hydrate → ordering identical.
5. Existing suite stays green (focus, owner chains, modal blocking, truncation to
   `maxWindows` — truncation sorts by `z`, which still works).

## Release & verify in logistic

1. Bump library to **0.6.4**, publish.
2. In logistic: `npm i @korneevecin/vue3-dialogs-lib@0.6.4` (package.json currently
   `^0.6.3`, so a fresh install picks it up; commit the lockfile change).
3. Repro before/after in Chrome (no Safari needed):
   - seed `localStorage['cr:windows']` with a huge `topZ` (e.g. 2000) and matching
     `z` values in the stack, reload;
   - on 0.6.3: open cargo → click an unconfirmed address → confirm → the
     `ElMessageBox`/notification renders behind the windows;
   - on 0.6.4: same steps, overlays on top; inspect `cr:windows` — `topZ` is now ≤ 8.
4. Sanity: window stacking, pinning, modal dimming/inert, taskbar minimize/restore,
   persisted layout across reload — all unchanged.
5. No app-code changes needed; the comment in `frontend/src/plugins/windows/index.js`
   ("below element-plus overlays (2000+)") becomes true again.

## Rejected alternatives

- **Threshold-only compaction** (compact when `topZ > N`): works, but leaves a magic
  number and a window where the invariant is false; always-compact is simpler and cheap.
- **Rank-based z-index at the four render sites**: same effect, but touches rendering
  instead of state and duplicates ordering logic in four places.
- **Raising Element Plus's initial z-index in the app**: only postpones the collision
  (counters grow unbounded); wrong layer to fix.
- **CSS `!important` z-index overrides on `.el-notification`/`.el-overlay`**: breaks
  mutual overlay ordering; fragile.
