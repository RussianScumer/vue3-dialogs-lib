# How it works

The whole library follows from one decision:

> **A window is a serializable descriptor in a store, not a component instance.**

Minimize, restore, persistence, the taskbar, and "minimized costs nothing" are consequences of
that, not separate features.

## The descriptor

Every window is one plain object in one array:

```ts
interface WindowDescriptor {
  id: string                       // crypto.randomUUID()
  name: string                     // key into the components map, NOT a component
  props: Record<string, unknown>   // ids and primitives only
  state: unknown | null            // draft state owned by the content component
  title: string
  minimized: boolean
  x: number; y: number; w: number; h: number
  z: number
  meta: Record<string, unknown>    // consumer bookkeeping (entity version, ETag, …)

  closable: boolean                // capabilities: serializable, so they persist with the window
  minimizable: boolean
  draggable: boolean
  resizable: boolean
  minW: number; minH: number
  maxW: number | null; maxH: number | null   // null means unbounded
}
```

Nothing in it is a component reference, a fetched entity, or a function. That is what makes
`JSON.stringify` — and therefore reload survival — possible at all. `name` is a string key that
`WindowHost` looks up in the components map at render time.

## The pieces

| File | Job |
|---|---|
| `state.ts` | The reactive store: the stack, `open`/`close`/`minimize`/`restore`/`focus`, dedupe, eviction, clamping. No DOM except the header registry focus hand-off needs. |
| `createWindows.ts` | Plugin factory. Resolves options, creates one store per app, provides both, wires persistence. |
| `options.ts` | Defaults, per-type async loading options, the parsed keymap, and memoized `resolve(name)` that turns loader functions into async components. |
| `WindowHost.vue` | Renders one `BaseWindow` per **non-minimized** descriptor, holds a leaving frame for the motion duration, and re-clamps on viewport resize. |
| `BaseWindow.vue` | The `<dialog>`: geometry, header, drag handle, ESC, raise-and-focus on pointerdown, `data-vw-state`, per-window context. |
| `WindowTaskbar.vue` | Renderless. Exposes the minimized set to the consumer's own markup, `registerFocusTarget` for opting into focus on minimize, and `setTaskbarRect` for opting into the fly-to-button animation. |
| `useWindowDrag.ts` | Pointer-events drag + arrow-key move/resize, and the snap zone armed by a drag. |
| `useWindowResize.ts` | The eight resize grips: pointer maths, size limits, and the edges that move `x`/`y`. |
| `useWindowFocus.ts` | Focus into a window on open, and the destination chain — next window, taskbar, opener — when its frame unmounts. |
| `useWindowState.ts` | Draft state stored on the descriptor. |
| `useWindowContext.ts` | Per-window control surface via provide/inject. |
| `useViewport.ts` | The app's one viewport tracker, created by the plugin. One resize listener, however many windows. SSR-safe. |
| `useKeymap.ts` | The app's one keymap listener, created by the plugin. On the document, acting on the active window. SSR-safe. |
| `persist.ts` | Snapshot, schema check, hydration filtering, debounced writes, cross-tab detection. |
| `geometry.ts` | Cascade placement, clamping and snap-zone maths — pure functions. |

## Lifecycle of a window

```
win.open('itemEditor', { id: 42 }, { title: 'Item 42', w: 720, h: 520 })  → { id, result }
  │
  ├─ unknown name?            → throw immediately (typos fail loudly, not silently)
  ├─ same name + same props?  → restore + focus the existing window, hand back its id and result
  ├─ at maxWindows?           → close the oldest
  └─ push descriptor { id, name, props, cascade geometry, z: ++topZ }
       │                       + record the unsettled result, before the `open` event fires
       │
WindowHost renders `visible` (= stack minus minimized)
       │
BaseWindow mounts → dialog.show()  (non-modal)
       │             provideWindowContext(descriptor)
       │             content component mounts, gets `v-bind="props"` + `windowId`
       │
minimize(id) → descriptor.minimized = true
       │        → drops out of `visible` → the content UNMOUNTS at once, the frame goes `leaving`
       │        → the descriptor (and its draft `state`) stays in the stack
       │
restore(id)  → minimized = false, z = ++topZ → content mounts again, geometry unchanged
       │
close(id)    → descriptor removed from the stack; everything about it is gone
       │        → its result settles { ok: false, reason: 'closed' } if it has not answered
       │        → the frame goes `leaving`, with its content, until the motion duration elapses
```

`close()` is unconditional and synchronous, so `closeAll()` on logout can never be blocked.
`requestClose()` is the guarded path — the window's own guard first (registered by its mounted
content), then the app-wide `beforeClose` option. Only the second one can see a **minimized**
window, whose content is unmounted and whose guard therefore no longer exists. The ✕ button calls
`requestClose`; `maxWindows` eviction calls `close`.

Both guards are awaited, so a window sits in a *closing* state for as long as they take. That state
is a reactive set beside `docks` — runtime-only, so the descriptor and the schema stay where they
are, and a reload during a pending question restores an ordinary window. The in-flight promise is
kept beside it and handed to any further `requestClose` for the same id, which is why an impatient
second click cannot ask the user twice. `close()` and `closeAll()` clear both without consulting
anything: the pending guard still answers, into a window that is already gone, and nothing throws.

## Window results

`open()` returns a handle rather than an id, because the id alone cannot say what the window was
opened *for*. The answer lives in a third runtime-only map, beside the guards and for the same
reason — it holds promises, so it could never be persisted even if it wanted to be:

```
results: Map<id, { promise, settle }>   // runtime-only; no descriptor field, no SCHEMA change
```

```
open(...)              → deferResult(id); the handle carries the promise
resolve(id, data)      → settle { ok: true, data }, then close(id)
dismiss() / close(id)  → settle { ok: false, reason: 'closed' }
closeAll(), eviction,
  owner closing child  → the same, for every window involved
hydrate(stack)         → each restored id gets an already-settled { ok: false, reason: 'restored' }
```

Two properties are load-bearing. **A result never hangs**: every path that removes a window from
the stack goes through `close()`, and `close()` settles. And **a window answers once**: settling is
a no-op on an already-settled promise, which is what lets `resolve()` settle a value and then call
`close()` without the close overwriting it.

The restored case is the one place where the descriptor model and a promise API genuinely disagree.
A hydrated window's opener belongs to a previous page load, so there is no promise to settle and no
caller to settle it for; the store settles it as `restored` at hydration time rather than leaving a
promise nobody will ever answer. `resultOf(id)` reads any window's promise back, and answers
`closed` for an id the store no longer has.

The handle is deliberately not string-compatible. A handle that stringified to an id would let a
pre-0.2 call site keep working silently in production and fail somewhere else entirely; instead it
warns once in dev when it is coerced, and coerces to `[object Object]` otherwise.

Both `minimize` and `close` unmount the frame, and an unmounted frame cannot keep the focus it was
holding — the browser drops it on `<body>`. So `useWindowFocus` records, just before the unmount,
whether focus was inside that window, and if it was, walks a chain: the window now on top, by the
header it registered with the store; then the taskbar, if the consumer bound
`registerFocusTarget` and this was a minimize rather than a close; then the element that opened the
window. The store owns the header registry because the first step is a question about `z` and
`minimized` that only the store can answer — it reuses the same `activeId` computed that
`data-vw-active` is drawn from, so the focus destination cannot drift away from the visibly active
window.

Each transition emits an event (`open`, `close`, `focus`, `minimize`, `restore`, `geometry`,
`title`), subscribable with `win.on(type, cb)`. A gesture reports through the store once it is
over: drag, resize and the arrow keys write x/y/w/h straight onto the descriptor frame by frame,
then hand the result to `setGeometry`, so `geometry` fires once per gesture rather than per frame,
and a drop into a snap zone fires it once, from `snap()`. Note what this deliberately cannot see:
a draft mutation, or a mid-gesture frame. Both write straight onto the descriptor without passing
through a store method, which is exactly why persistence watches the stack deeply instead of
listening to events. `clampAll` on a viewport resize is silent by the same reasoning — nobody
asked for that move.

## Why the content is really gone while minimized

`WindowHost` iterates `visible`, which is `stack.filter(w => !w.minimized)`. A minimized window is
not in the list, so Vue unmounts its subtree: no watchers, no timers, no map or grid instances, no
`KeepAlive`, no `v-show`. The playground makes this observable with a live mount counter — minimize
a ticking log viewer and the count drops to zero.

The cost of that is the content cannot keep its form in local `ref`s. That is exactly what
`useWindowState` exists for: the draft lives on the descriptor, which outlives the mount.

## Motion

The library owns the state machine; the consumer owns the motion. `WindowHost` puts one attribute
on the `<dialog>` and nothing else:

```
data-vw-state="entering"   the first frame after the window appears
                 "open"    from the next animation frame onwards
              "leaving"    the store has let go; the frame has not yet
```

The store stays the truth. `close()` and `minimize()` are synchronous there — the descriptor is
gone, or minimized, the instant they return — and the *host* is simply slower to let go of the
frame:

```
close(id)    → out of the stack → frame goes `leaving`, content and all, retained for the duration
minimize(id) → out of `visible` → frame goes `leaving`, content unmounted immediately
restore(id)  → the leaving frame is adopted back, not duplicated, and animates in reverse
```

A minimized window's content is unmounted the moment it is minimized. The frame is what lingers,
never the content — otherwise the headline claim would quietly become "unmounted, eventually".
A closing window keeps its content while it fades, because a window that empties itself first reads
as a bug rather than an animation.

The duration is read from the computed value of `--vtd-motion-duration` **on the window element**,
which is why there is no second API for it: a consumer override, a media query and
`prefers-reduced-motion: reduce` (which the baseline sheet collapses to `0ms`) all arrive through
the one property the sheet already declares. Unreadable — no stylesheet imported, or no DOM at all —
means `0ms` and a frame that leaves in the same tick, exactly as it did before any of this existed.

The failure mode worth naming is a frame that never retires: a leak that looks like a working
animation and passes a naive test. Four things prevent it, and each has a test — the retention is
capped at 1000ms whatever the stylesheet says, `close()` of an already-leaving window retires it at
once, unmounting the host retires everything, and 50 open/close rounds must leave zero `<dialog>`
elements behind. A leaving frame is also `pointer-events: none` and inert to drag, resize and arrow
keys, since the store no longer knows the id it would be asked about.

The one thing the library cannot know is where the window is *going*, because the taskbar is the
consumer's markup. So it is offered, not assumed:

```
setTaskbarRect(id, rect)   from WindowTaskbar's slot, usually out of a button's ref callback
  ↓
taskbarRects: Map<id, Rect>              // runtime-only, beside `docks`
  ↓
--vtd-min-x / --vtd-min-y / --vtd-min-scale   on the leaving frame
```

The offsets are from the window's own centre to the button's centre, and they appear on a
**minimizing** frame only — a closing window has no button to fly to, so the same baseline rule
falls back to a plain fade for it. The sheet animates the separate `translate` and `scale`
properties rather than `transform`, because `transform` is the window's position: the individual
properties compose with it instead of overwriting it.

## Why non-modal

Windows are opened with `dialog.show()`, not `showModal()`.

- Several windows can be open at once, the page behind stays usable, and the taskbar stays
  clickable — all impossible with a modal, which makes everything else inert.
- Teleported poppers from your own components (select menus, date pickers) render above window
  content normally, because a non-modal dialog is in the normal stacking context.

The price: no browser top layer, so the library owns `z-index` (`descriptor.z`, bumped on
`pointerdown` and on `restore`), and the browser sends **no close request**, so ESC is handled by a
`keydown` listener rather than the `cancel` event — a `.show()` dialog never receives `cancel` at
all. Content that wants ESC for itself calls `preventDefault()` first; a background window and a
native picker are skipped too.

## Geometry

- New windows cascade: 28px steps, wrapping every 8 windows, defaults 640×480.
- Dragging writes `x`/`y` straight onto the descriptor through Pointer Events with pointer capture
  — one code path for mouse, touch and pen, and no `window`-level listeners to leak.
- Resizing works the same way, from eight grips positioned inside the window's edges. It replaced
  CSS `resize: both`, which offered one corner only, could not honour `minW`/`maxW`, and could not
  express a west or north resize at all — those have to move `x`/`y` as the width changes, because
  the *opposite* edge is what must stay put. Every path that sets a size, pointer or keyboard or
  snap, goes through `clampSize`, so they cannot disagree.
- `z` is a bare counter in the descriptor; the rendered `z-index` is `zIndexBase + z`. Keeping the
  base out of the stored value means a persisted descriptor stays valid when the base changes.
  `focus()` skips the write when the window is already on top, so an ordinary click inside a window
  does not wake the persistence watcher.
- `bounds.minVisible` (default 80px) is clamped on drag, on hydration, and on every viewport
  resize, so a window can never end up unreachable.
- Below `mobileBreakpoint` the rendered geometry is forced fullscreen and drag/resize go inert. The
  stored geometry is untouched, so the window returns to its old place on a wide viewport.

## Snapping

Snapping assigns geometry; it does not introduce a second layout model. A snapped window is still a
plain descriptor with `x/y/w/h` — the store simply remembers, outside the persisted state, which
zone put it there and what it looked like before:

```
docks: Map<id, { zone, prev }>     // runtime-only, so the descriptor and SCHEMA never move
```

```
drag moves           → zoneFromPointer(pointer, viewport, snap) → store.preview → WindowHost ghost
drag released        → snap(id, zone): stash `prev` once, assign snapRect(zone), focus
drag passes 4px on a
  snapped window     → undockForDrag: pre-snap size back, placed under the cursor. On the
                       movement, never on the press, so a click cannot un-maximize
double-click header  → snap(id, dockZone === 'max' ? 'none' : 'max')
pinned window        → every one of these is refused; see Pinned windows
corner resize        → undock(id): keep the new size, forget the zone
viewport resize      → clampAll: docked windows re-snap, floating ones clamp
```

The zone geometry comes from `snapRect`, and the ghost is drawn from the same function, so the
preview cannot disagree with the drop. The snap area is the viewport minus `snap.insets`, which is
how a consumer's fixed taskbar stays uncovered. A corner beats an edge in `zoneFromPointer`: the
corner band is wide (100px by default) and the edge band is a few px, otherwise quarters would be
unreachable. The bottom edge alone arms nothing.

Because `docks` lives outside the reactive `s` object, the debounced persistence watcher never sees
a ghost hover, and a reload brings a snapped window back as an ordinary floating one.

## Pinned windows

`fixed` is the third piece of runtime-only per-window state, beside `docks` and `owners`, and it is
there for a reason of its own: pinning is toggled from the header, so it is not a capability the
descriptor could carry without `SCHEMA` moving.

```
pins: Map<id, boolean>             // runtime-only, beside `docks` — never persisted
```

**An entry means the window is pin-capable; the value means it is currently pinned.** A window
opened without `fixed` has no entry, gets no pin button, and renders exactly as it did before this
existed — which is also what keeps the control count of an ordinary window where it was.

```
open(..., { fixed })   → pins.set(id, fixed); `fixed: false` is capable but unpinned
setPinned(id, true)    → undock(id): an explicit pin outranks a snap, geometry kept
render band            → pinned: zIndexBase + topZ + z    unpinned: zIndexBase + z
snap(id, …)            → refused while pinned, so the document-level keymap is no exception
drag / resize / arrows → BaseWindow's one `interactive` predicate goes false while pinned
close / closeAll /
  hydrate              → the entry is dropped where the `docks` entry is
```

`z` is always positive, so `topZ + z` puts every pinned window above every unpinned one while
pinned windows keep their relative order. `focus()`, `activeId` and everything persisted are
untouched: there is still one stack, and the second band exists only at render time. The snap ghost
keeps `topZ + 1` and therefore sits under a pinned window, which is correct — nothing can be
snapped onto one anyway.

The cost is explicit and accepted: a reload brings a pinned window back unpinned and draggable, in
exactly the way it brings a snapped one back undocked.

## Control labels

The default controls are glyphs, and the library ships no strings, so their accessible names are
the consumer's. They are the fourth piece of runtime-only per-window state, beside `docks`, `pins`
and `owners`, and for a reason of its own: a label belongs to the locale of the app that is
running, not to the window. A persisted label would restore last month's translation into a page
that has since been re-installed with a new one.

```
controlLabels: Map<id, ControlLabels>   // runtime-only, beside `pins` — never persisted
```

```
createWindows({ labels })  → the app-wide names, on ResolvedOptions
open(..., { labels })      → { ...spec.labels, ...opts.labels }, stored only if non-empty
labelsFor(id)              → { ...options.labels, ...controlLabels.get(id) }
render                     → :aria-label on –, ✕ and ▲; undefined renders no attribute
pin button                 → :aria-pressed="pinned", so one name covers both directions
dev warning                → once per resolved options object, from BaseWindow's onMounted
close / closeAll /
  hydrate                  → the entry is dropped where the `pins` entry is
```

The warning is keyed on the resolved options object in a module-level `WeakSet`, which is why it
lives in a plain `<script>` block in `BaseWindow.vue`: everything in `<script setup>` runs per
component instance, so a set declared there would be one set per frame and would dedupe nothing.

## Owned child windows

A window may own another one. `open(name, props, { owner: id })` records the link in a runtime map
and re-stacks the whole group, which is what puts the child at exactly `owner.z + 1`:

```
owners: Map<childId, ownerId>      // runtime-only, beside `docks` — never persisted
```

```
open(..., { owner })   → owners.set(child, owner); raise the group (owner, then its children)
focus(either)          → the whole group is raised in chain order, relative stacking preserved
owner has a child      → BaseWindow sets `inert` on the owner's own <dialog>, nothing else
minimize(owner)        → refused, dev warning: unmounting it would strand the question
requestClose(owner)    → refused: the child is the question, answer it first
close(owner)           → children close first, then the owner
ESC on a child         → requestClose(child) — dismiss, not minimize; its result settles `closed`
persistence            → owned windows are filtered out of the blob, and dropped out of one
```

`inert` is set imperatively rather than bound, because whatever was there before is recorded and
handed back — an owner that is itself somebody's child must not be un-inerted by its own child
going away. It is written with a `sync` watcher, not the default `pre`: closing a child hands focus
back to the owner's header through the destination chain, and a real UA refuses to focus anything
inside an inert subtree, so the attribute has to be gone by then rather than next tick.

The chain is capped at three links, and an unknown owner id throws at `open()` exactly as an
unknown window name does.

## The `<dialog>` element

The UA stylesheet gives `<dialog>` `position: absolute; margin: auto; inset: 0`; all three are
overridden inline (`position: fixed`, `margin: 0`, `inset: auto`) or centering fights the
transform. Positioning is inline on purpose: the library works with no stylesheet imported at all,
and `style.css` is cosmetics only.

## Persistence

```
install → read(storage[key])
            ├─ missing / unparsable / wrong `schema`      → ignore, start empty
            ├─ descriptor whose `name` is not registered  → dropped
            └─ survivors: clamp to the current viewport, hydrate, mark as restored
watch(stack, deep) → debounce 300ms → storage[key] = { schema, topZ, stack, writer }
pagehide → a pending debounced write is flushed synchronously (nothing once stopped)
storage event on key → writer !== ours → stop writing, onExternalChange(info)
                                          └─ info.resume() → re-read, hydrate, write again
```

On a schema mismatch the snapshot is *migrated* where it can be — every capability field a
descriptor is missing is filled from that component's defaults — and dropped only when the schema
is too old to read. Dropping a readable blob would throw away every open window and every draft on
upgrade, which the reload-survival promise cannot afford. The same repair path fixes a hand-edited
descriptor, so there is one code path to extend when a field is added.

A page can go away inside the debounce window, which would drop a draft typed a keystroke before a
reload. A `pagehide` listener flushes the pending write synchronously, so the last edit survives a
reload, a tab close, a bfcache freeze and a mobile tab discard alike; a tab that already stopped
writing after a foreign change stays silent through the flush too.

Everything DOM-touching is guarded by `typeof window === 'undefined'`, so importing the entry in
Node or during SSR does nothing. `storage` is any `{ getItem, setItem, removeItem }`, so
`sessionStorage`, an IndexedDB wrapper, or a server-backed adapter all drop in.

`isRestored` is not stored on the descriptor — the store keeps the set of hydrated ids in memory,
so `useWindowContext().isRestored` tells a content component whether this mount came from storage
or from a fresh `open()`.

Bump `SCHEMA` in `persist.ts` whenever the descriptor shape changes; a stale blob hydrating into
new code is the likeliest source of hard-to-reproduce bugs in this design.

### Cross-tab safety

`writer` is a token minted once per `setupPersist` call and written in the blob's **envelope**, not
on a descriptor: the descriptor shape is unchanged, so `SCHEMA` does not move for it, an old blob
with no token reads fine, and old code ignores the key. It answers exactly one question — did this
tab's last write produce the value that just arrived?

A `storage` event whose value is not this tab's own is a foreign write. Anything unreadable counts
as foreign too, including a cleared key (`e.key === null`) and a blob written by a version that had
no token: none of them came from here, which is the whole question. The receiving tab sets a
`stopped` flag, clears the pending debounce so a write scheduled *before* the foreign one cannot
land *after* it, and reports through `onExternalChange`. A consumer that throws is caught — it must
not take the listener down.

The flag is never cleared on its own. Resuming on focus, or on the next mutation, is precisely how
one session eats another, so only `info.resume()` clears it, and it hydrates from storage first.

Only `localStorage` fires `storage` events; every other adapter simply never reaches this path, with
no warning and no capability detection. The listener is added in the plugin's `effectScope` and
removed with it, beside the viewport tracker and the keymap.

## Wiring and SSR

The viewport tracker, the keymap listener, the persistence watcher and its `storage` listener are
created inside a detached `effectScope` that the plugin stops from `app.onUnmount`, so none of them
outlives the app that owns it.

`createWindows()` builds one store per app and provides it under a symbol key; `useWindows()` is
`inject` with a fallback to the most recently installed app so it also works outside `setup()`
(route guards, services, event handlers in plain modules). Inside components the injected store
always wins, so multiple app instances stay correct.

## Focus

Non-modal means **no focus trap**, deliberately. "No trap" is not the same choice as "no focus at
all", though, which is where this started: opening a window now moves focus to its first tabbable
element (falling back to the header, which is `tabindex="0"`), and closing one hands focus back to
whatever had it when the window opened.

Two ordering traps, both of which cost a debugging session and are now pinned by tests:

- `dialog.show()` runs the UA's *dialog focusing steps*, which focus the first focusable element in
  the whole dialog — the header, since it precedes the content. So the focus hook must be
  registered **after** the `show()` hook, or the browser silently overwrites it. jsdom's `show()`
  does not do this, so no jsdom test can catch it; it was found in a real browser.
- An async component — the recommended way to register a window — has not rendered when the window
  mounts, so there is nothing to focus yet. The header takes focus, and a `MutationObserver` hands
  it on to the first tabbable element when the content lands, unless the user has moved focus in
  the meantime.

The opener is a DOM node, so it cannot live in the descriptor. `BaseWindow` captures
`document.activeElement` in its own setup — before it can steal focus — which keeps the store free
of DOM references entirely. A window restored from storage on page load does not take focus: it has
no opener, and stealing focus on load is an accessibility problem rather than a feature.

## Failure containment

Windows are siblings in one `v-for` in `WindowHost`. Left alone, an error thrown by one window's
content propagates up through that `v-for` while the host is patching and takes the whole desktop
with it — every other window unmounts because one of them was broken. For a window manager that is
the wrong trade in every case, so `BaseWindow` registers `onErrorCaptured`, renders the type's
`errorComponent` in its own body instead of the content, and returns `false` to stop the error
there.

The cost of stopping it is that `app.config.errorHandler` never sees it; the error is passed to the
error component as a prop instead, which is the place a consumer reports it from. The same
component is what `defineAsyncComponent` renders when the chunk itself fails, so "the code never
arrived" and "the code arrived and threw" look identical to the user — the difference is not one
they can act on.

## What the library deliberately does not do

No modal mode, no confirm/alert helpers, no data fetching, no staleness resolution, no cross-device
sync, no tiling window management (docked rails, tab stacks, splitters), no design system. Edge
snapping is the one exception, and it stays geometry-only. Minimize and restore are not announced
to screen readers, because announcing them needs strings and the library ships none. See [recipes](./recipes.md) for the patterns that
cover the gaps.
