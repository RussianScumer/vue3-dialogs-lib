# Performance

The library makes one performance claim — **a minimized window costs nothing, because its content
is unmounted rather than hidden** — plus the implicit claim that a store of plain descriptors is
cheap to mutate at interactive rates. This document says how both are measured, what the numbers
were, and where the costs actually are.

```sh
npm run bench      # vitest bench --run
```

## What is measured

| File | Covers |
|---|---|
| `src/__bench__/store.bench.ts` | `open` (dedupe scan, eviction), `focus`, `minimize`/`restore`, `byId`, `setGeometry` (one drag frame), `clampAll`, `close`, computed recomputation. Pure JS, no DOM. |
| `src/__bench__/host.bench.ts` | Mounting `WindowHost` with N open vs N minimized windows, minimize/restore round trips, 60 drag frames, 60 focus bumps. jsdom. |
| `src/__bench__/persist.bench.ts` | Hydration on install (valid, oversized, rejected snapshots) and one debounced serialize. |

Two rules the benchmarks follow, because breaking them is the usual way a benchmark lies:

- **Steady state where it matters.** The `open`, `focus`, `setGeometry` and `close` benchmarks build
  their store once, outside the measured function, and keep the stack at a fixed size (`maxWindows`
  equal to the pre-filled count, so each open evicts the oldest). Benchmarks that do include setup
  say so in their name ("cold start…", "includes building them").
- **jsdom measures script, not pixels.** The `host` numbers are Vue's mount/patch work plus the
  store's. Layout, paint and compositing are not in them, so treat those figures as *relative*
  (open vs minimized) rather than as frame budgets.

## Results

AMD Ryzen 7 5700G, Node 22.22, vitest 4.1.11, jsdom. `hz` = operations per second, `mean` in ms.
Your absolute numbers will differ; the ratios are the point.

### Store, stack of 100 windows

| Operation | hz | mean |
|---|---:|---:|
| `byId` lookup | 143,214 | 0.0070 ms |
| `focus` (z bump) | 116,096 | 0.0086 ms |
| `setGeometry` — one drag frame | 115,693 | 0.0086 ms |
| `minimize` + `restore` round trip | 44,183 | 0.0226 ms |
| `clampAll` — one viewport resize | 19,900 | 0.0503 ms |

A drag frame costs ~9µs of store work at 100 windows, against a 16.7ms budget at 60Hz. Geometry is
never the bottleneck; rendering the window's own content is.

### What a drag frame really costs

The store write above is not the whole frame. With `persist` on, a deep watcher covers the stack,
so every drag frame also pays one deep traversal of every open descriptor before the debounce
swallows the write. That is inherent: `useWindowState` hands the content its draft object to mutate
directly and the drag writes `x`/`y` straight onto the descriptor, so neither passes through a store
method an event could hook. Watching deeply is the only way to see them.

The traversal is O(open windows × descriptor size), bounded by `maxWindows` (8 by default), and
lands well inside a frame at that size. It is worth knowing about before raising `maxWindows` into
the hundreds *and* leaving persistence on.

An ordinary click inside a window used to pay the same price for nothing: `focus()` bumped `z`
unconditionally, waking the watcher on every `pointerdown`. It now returns early when the window is
already on top, so only a real raise costs anything.

### Opening windows

| Operation | hz | mean |
|---|---:|---:|
| `open` at stack size 8 | 44,427 | 0.0225 ms |
| `open` at stack size 100 | 6,106 | 0.164 ms |
| `open` a duplicate at stack size 100 (dedupe hit) | 13,165 | 0.076 ms |
| open + close pair at stack size 100 | 5,846 | 0.171 ms |
| cold start: create a store, open 100 windows | 133 | 7.5 ms |

`open` is **O(n) in the stack size**: it scans for a duplicate (`name` + shallow-equal `props`) and,
past `maxWindows`, evicts the oldest. That is why 8 windows cost 22µs and 100 cost 164µs. With the
default `maxWindows: 8` the scan is bounded by design — the limit is a correctness feature that
also caps this cost. `close` re-filters the stack into a new array, also O(n).

### Render cost: open vs minimized

Each benchmark mounts a fresh app with N windows whose content renders a 200-item list, then
unmounts it. This is the headline claim.

| Scenario | hz | mean |
|---|---:|---:|
| host + 1 open window | 202 | 4.95 ms |
| host + 8 open windows | 32 | 31.3 ms |
| **host + 8 minimized windows** | **2,071** | **0.48 ms** |
| host + 100 minimized windows | 112 | 8.9 ms |

**8 minimized windows are ~65× cheaper to mount than 8 open ones** — and cheaper than a *single*
open window by ~10×, because nothing but the descriptors exists. The 100-window row shows what the
residual cost is: reactive descriptors and taskbar entries, ~0.09 ms each, with no content, no
watchers and no timers behind them.

Interaction with 8 windows open (each figure includes mounting and tearing down the whole app, so
compare them with each other, not with zero):

| Scenario | mean |
|---|---:|
| minimize one (unmounts its content) | 33.5 ms |
| restore one (remounts its content) | 31.6 ms |
| 60 drag frames on one window | 50.0 ms → **~0.31 ms/frame** beyond app setup |
| 60 focus bumps | 49.0 ms → **~0.29 ms/bump** |

Only the dragged window re-renders: `x`/`y` live on one descriptor, and the other windows' vnodes
are untouched.

### Persistence

| Operation | hz | mean |
|---|---:|---:|
| hydrate 8 windows, 200B drafts (typical) | 3,569 | 0.28 ms |
| hydrate 100 windows, 200B drafts | 306 | 3.27 ms |
| hydrate 8 windows, 100KB drafts | 766 | 1.31 ms |
| hydrate a rejected snapshot (schema mismatch) | 7,996 | 0.13 ms |
| serialize 8 windows, 200B drafts | 12,751 | 0.078 ms |
| serialize 100 windows, 200B drafts | 1,001 | 1.00 ms |
| serialize 8 windows, 100KB drafts | 467 | 2.14 ms |

Hydration happens once, at `app.use()`, and costs well under a millisecond for a normal stack. A
rejected snapshot is the cheapest path of all — a schema bump costs users nothing at load.

Writes are the ongoing cost: a deep watch on the stack, debounced 300ms, then `JSON.stringify` plus
a synchronous `storage.setItem`. At the default 8 windows that is ~0.08ms per flush. **Draft size
dominates**: 8 windows carrying 100KB drafts each serialize 27× slower than the same 8 windows with
200B drafts, and `localStorage.setItem` is synchronous on the main thread. Keep drafts small, or
swap `storage` for an adapter that writes asynchronously.

## Real-browser check

Measured in Chrome on the playground (`npm run dev`), 8 log-viewer windows each running a 1s timer:

| State | DOM nodes | JS heap |
|---|---:|---:|
| desktop empty | 220 | 14,021 KB |
| 8 windows open | 324 | 14,615 KB |
| 8 windows minimized | 268 | 14,020 KB |

Minimizing returns the heap to its empty-desktop level and removes every `<dialog>` from the DOM;
the 48 remaining nodes are the taskbar buttons and the playground's own event log. The eight
intervals are gone with the components — that is the difference between unmounting and `v-show`.
Calling `open` eight times took 0.4ms of handler time, `minimize` on all eight took 0.3ms.

Caveat: `ResizeObserver` (used to mirror CSS resize back into the descriptor) only delivers while
the tab renders. In a hidden or occluded tab it reports nothing until the tab is visible again.

## Practical guidance

- **Keep `maxWindows` small.** It bounds the dedupe scan, the deep-watch cost and the serialized
  blob. The default 8 is also about what a user can actually keep track of.
- **Keep drafts small.** `useWindowState` data is serialized on every debounced flush. Park ids and
  form fields there, not fetched lists or blobs.
- **Let minimize do the work.** Anything expensive — timers, subscriptions, map/grid instances,
  observers — belongs *inside* the content component, so minimizing genuinely disposes it. Work
  hoisted into a parent that stays mounted keeps running.
- **Props are ids and primitives.** Beyond the serialization contract, the dedupe scan compares them
  shallowly on every `open`.
- **Don't put `transform` in a CSS transition** on `.vw`: dragging writes `transform` every frame,
  and a transition makes every window lag a frame behind the pointer.
