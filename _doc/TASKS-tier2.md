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
