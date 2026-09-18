# Window modes

Every window in this library is the same thing: a serializable descriptor in a store, rendered by
`WindowHost` into a non-modal `<dialog>`. What people call "modes" are combinations of a few
independent switches on top of that one object — how the window is placed, whether it can be moved,
which band it renders in, and what it blocks while it is open.

This guide walks through each mode: what it is, when to reach for it, the smallest example that
uses it, and what survives a reload.

- [At a glance](#at-a-glance)
- [Setup used by every example](#setup-used-by-every-example)
- [1 · Plain window](#1--plain-window) — the default
- [2 · Restricted window](#2--restricted-window) — turn off close, minimize, drag or resize
- [3 · Minimized](#3--minimized) — a state, not an option
- [4 · Snapped and maximized](#4--snapped-and-maximized)
- [5 · Pinned (always on top)](#5--pinned-always-on-top) — `fixed: true`
- [6 · Owned child window (sheet)](#6--owned-child-window-sheet) — `owner: id`
- [7 · Modal](#7--modal) — `modal: true`
- [8 · Fullscreen on small screens](#8--fullscreen-on-small-screens) — automatic
- [9 · Presets: naming a mode](#9--presets-naming-a-mode)
- [Choosing between them](#choosing-between-them)
- [What persists, and what does not](#what-persists-and-what-does-not)

---

## At a glance

| Mode | Option | Blocks | Render band | Persisted |
| --- | --- | --- | --- | --- |
| Plain | — | nothing | `zIndexBase + z` | yes |
| Restricted | `closable`, `minimizable`, `draggable`, `resizable` | nothing | `zIndexBase + z` | yes, on the descriptor |
| Pinned | `fixed: true` | nothing | `zIndexBase + topZ + z` | no — comes back unpinned |
| Owned sheet | `owner: id` | its owner only | its owner's, at `owner.z + 1` | never |
| Modal | `modal: true` | every other window, plus the page if you ask | `zIndexBase + 3 * topZ + z` | never |

Two of those switches are *capabilities on the descriptor* and persist with it; the rest are
runtime-only, which is a deliberate trade explained in
[What persists, and what does not](#what-persists-and-what-does-not).

They compose. A window can be pinned **and** restricted, a modal can own a sheet, and a sheet can be
opened over a pinned window. The only pair that is not meaningful is modal + minimizable: a modal is
forced non-minimizable, because a minimized modal would leave the desktop dimmed with nothing left
to dismiss.

---

## Setup used by every example

```js
import { createApp } from 'vue'
import { createWindows } from '@korneevec/vue3-dialogs-lib'
import '@korneevec/vue3-dialogs-lib/style.css' // optional baseline

const components = {
  itemEditor: () => import('./windows/ItemEditor.vue'),
  logViewer: () => import('./windows/LogViewer.vue'),
  confirm: () => import('./windows/Confirm.vue'),
}

createApp(App)
  .use(createWindows({
    components,
    persist: { key: 'app:windows', storage: localStorage },
    labels: { minimize: 'Minimize', close: 'Close', pin: 'Keep on top' },
  }))
  .mount('#app')
```

```vue
<!-- App.vue -->
<template>
  <div class="page">
    <!-- your app -->
  </div>
  <WindowHost />
</template>
```

Mount `WindowHost` **beside** your page content, not inside it. Nothing forces this until you use
[modal windows](#7--modal), where `inert` is applied to a subtree — but starting out this way saves
a move later.

Every example below assumes `const win = useWindows()`.

---

## 1 · Plain window

The default. Draggable by its header, resizable by eight grips, minimizable to your taskbar,
closable, snappable to the screen edges, and persisted.

```js
win.open('itemEditor', { id: 42 })
```

`open()` returns `{ id, result }` — not a string:

```js
const { id, result } = win.open('itemEditor', { id: 42 })
const answer = await result   // { ok: true, data } | { ok: false, reason: 'closed' | 'restored' }
```

What you get without asking for anything:

| | Default |
| --- | --- |
| Size | `640 × 480`, minimum `160 × 80`, no maximum |
| Position | cascaded: `40 + (index % 8) * 28` on both axes |
| Stacking | `z` is bumped on `pointerdown` and on restore |
| Limit | `maxWindows: 8` — opening a ninth closes the oldest |
| Dedupe | same window type + shallow-equal props joins the window already open |

Override any of it per call:

```js
win.open('logViewer', { source: 'app' }, {
  title: 'Application log',
  x: 120, y: 80, w: 480, h: 320,
  minW: 320, minH: 200, maxH: 640,
  meta: { version: 3 },          // your own bookkeeping, persisted with the window
  dedupe: false,                 // open a second one even though an identical one exists
})
```

Dedupe is worth understanding, because it is on by default: a second `open()` with the same type and
the same props does not open a second window — it raises the one already there and hands you *its*
result, so both callers await the same answer.

Inside the window's own component:

```vue
<script setup>
import { useWindowContext, useWindowState } from '@korneevec/vue3-dialogs-lib'

const props = defineProps({ windowId: String, id: Number })
const { setTitle, resolve, dismiss, onBeforeClose } = useWindowContext()

// Draft state that survives minimize (which unmounts this component) and a page reload.
const draft = useWindowState(props.windowId, () => ({ name: '', note: '' }))

setTitle(`Item ${props.id}`)
onBeforeClose(() => !draft.name || confirm('Discard the draft?'))
// resolve(value) settles the opener's `result` and closes the window.
</script>
```

---

## 2 · Restricted window

Four capability flags turn individual affordances off. They live **on the descriptor**, so they are
persisted and a restored window comes back just as restricted.

```js
// A dashboard panel: fixed geometry, no chrome, only code can take it away.
win.open('logViewer', { source: 'metrics' }, {
  x: 120, y: 120, w: 380, h: 300,
  closable: false,     // no ✕ in the header
  minimizable: false,  // no – in the header, and ESC no longer minimizes it
  draggable: false,    // the header does not drag, arrow keys do not move it
  resizable: false,    // no grips
})
```

Each flag is independent — `resizable: false` alone gives a window a user can still move and close.

`closable: false` is not a lock against your own code: `win.close(id)` ignores the flag and every
guard, which is what makes `closeAll()` on logout dependable. It only removes the affordance.

Set them once per window *type* instead of per call by registering a spec:

```js
components: {
  logViewer: {
    component: () => import('./windows/LogViewer.vue'),
    w: 380, h: 300, minW: 260, minH: 180, maxH: 520,
    resizable: false,
  },
}
```

Precedence, narrowest first: the `open()` call → a [preset](#9--presets-naming-a-mode) → the
component's spec → the library default.

---

## 3 · Minimized

Minimizing is a state on the descriptor, not a separate kind of window. The content is **unmounted**,
not hidden — timers stop, requests are not made, and `useWindowState` is what brings the draft back.

```js
win.minimize(id)
win.restore(id)      // un-minimizes and raises it
win.byId(id).minimized
win.minimized.value  // the minimized set, for your taskbar
```

The library renders no taskbar. `WindowTaskbar` is renderless — you own the markup:

```vue
<WindowTaskbar v-slot="{ all, active, restore, focus, requestClose, closing }">
  <div class="taskbar">
    <button
      v-for="w in all.filter((x) => !win.ownerOf(x.id))"
      :key="w.id"
      :class="{ active: w.id === active }"
      @click="w.minimized ? restore(w.id) : focus(w.id)"
    >
      {{ w.title || w.name }}
      <span v-if="w.closable" @click.stop="requestClose(w.id)">✕</span>
    </button>
  </div>
</WindowTaskbar>
```

Two things to know:

- **ESC minimizes** the active window by default. It does not close it — closing is a decision, and
  ESC is an escape. A window with `minimizable: false` ignores ESC entirely; a
  [sheet](#6--owned-child-window-sheet) and a [modal](#7--modal) are dismissed by it instead.
- **A minimized window has no close guard of its own**, because its content is unmounted along with
  the `onBeforeClose` it registered. The app-wide `beforeClose` option is the only one left, and it
  is consulted for every window.

---

## 4 · Snapped and maximized

Drag a window's header against a screen edge and it snaps like a Windows one — the left or right
edge gives a half, a corner gives a quarter, the top maximizes. A ghost previews the drop target,
and double-clicking the header toggles maximize.

```js
const view = { w: innerWidth, h: innerHeight }

win.snap(id, 'left', view)   // 'left' | 'right' | 'max' | 'top-left' | 'top-right'
                             // | 'bottom-left' | 'bottom-right'
win.snap(id, 'none', view)   // back to the geometry it had before the first snap
win.dockZone(id)             // the current zone, or null
```

Keep snapped windows clear of your own furniture with insets, and turn the whole thing off if it is
not wanted:

```js
createWindows({ components, snap: { enabled: true, edge: 12, corner: 100, insets: { bottom: 36 } } })
```

Snap state is **runtime-only**: it is not on the descriptor and is not persisted. After a reload a
snapped window comes back as an ordinary floating window with the geometry the snap gave it.
Dragging a snapped window away restores its pre-snap size under the cursor; resizing one by a grip
keeps the new size and simply stops treating it as docked.

Keyboard equivalents ship on by default — `Meta`+arrows, with `Ctrl`+`Shift`+arrows as the chord that
survives a real window manager — and every binding is movable or removable through `keymap`.

---

## 5 · Pinned (always on top)

`fixed: true` opens a window above every other one and keeps it there, wherever focus goes. Use it
for a mini player, a live monitor, a colour picker — something that has to stay visible while the
user works in the windows underneath.

```js
win.open('logViewer', { source: 'live' }, { fixed: true, w: 380, h: 240 })
```

- **A second render band.** A pinned window renders at `zIndexBase + topZ + z`, an unpinned one at
  `zIndexBase + z`. Every pinned window therefore outranks every unpinned one, and pinned windows
  keep their own relative order. `focus()` and `activeId` are untouched — there is still one stack.
- **Inert to geometry.** No drag, no grips, no arrow-key nudge, no maximize double-click, and
  `snap()` refuses. It stays closable and minimizable.
- **A pin button** appears in its header after the ✕, carrying `aria-pressed`. Pressing it drops the
  window back into the normal band, draggable and snappable again.

```js
win.isPinned(id)          // in the pinned band right now
win.isPinnable(id)        // has a pin to toggle — what the header button renders on
win.setPinned(id, true)   // pin, drop any snap, keep the geometry
```

Mentioning `fixed` at all is what makes a window pin-*capable*, so `fixed: false` gives you the
button without starting pinned, and a window that never mentions it renders exactly as it did before
the feature existed — no extra control, no second band.

Pin state is runtime-only. A reload brings a pinned window back unpinned and draggable, exactly as it
brings a snapped one back undocked: pinning is toggled by the user at runtime, and persisting it
would mean moving the storage schema.

---

## 6 · Owned child window (sheet)

`owner: id` opens a window that belongs to another one. This is the macOS document-modal sheet: it
renders directly above its owner, makes **only that owner** inert, moves with it as a group, and dies
with it. Every other window on the desktop stays fully interactive, drag included.

Reach for it when the question is about one document — an unsaved-draft confirm, a rename prompt, a
picker that belongs to one editor.

```js
// inside the editor's own component
const { windowId } = defineProps({ windowId: String })

async function ask(message) {
  const answer = await win.open('confirm', { message }, { owner: windowId }).result
  return answer.ok && answer.data
}

onBeforeClose(async () => !draft.name || (await ask('Discard the draft?')))
```

```vue
<!-- Confirm.vue: the answer is the window's own result -->
<script setup>
const { resolve } = useWindowContext()
</script>
<template>
  <button @click="resolve(false)">Keep editing</button>
  <button @click="resolve(true)">Discard</button>
</template>
```

What the library arranges for you:

- the pair moves as a group — focusing either raises both, and the child sits at exactly
  `owner.z + 1`;
- `minimize(owner)` and `requestClose(owner)` are refused while the child is open, since the child
  *is* the question; `close(owner)` closes the child first;
- ESC dismisses the child rather than minimizing it, and an inert owner never receives the key at
  all;
- the child is always `closable`, never `minimizable`, skips dedupe, and neither counts towards
  `maxWindows` nor evicts anything to make room;
- it is **never persisted** — a confirm must not come back after a reload.

A chain may be three deep (a sheet may own a sheet); a fourth throws at `open()`, as an unknown
owner id does.

```js
win.ownerOf(id)      // the owner's id, or null
win.childrenOf(id)   // live children, in stack order
win.hasChild(id)     // true while this window is inert because of its own child
```

A taskbar usually wants `all.filter((w) => !win.ownerOf(w.id))`: a sheet belongs to its owner, not to
the desktop.

---

## 7 · Modal

`modal: true` is the desktop-scoped version of the same idea. The window renders above every band,
the page behind is dimmed by a scrim, and **every other window** goes `inert` until it closes.

Reach for it when the question is about the app rather than about one document — a destructive
confirm, a licence prompt, anything that must be answered before work continues.

```js
const answer = await win.open('confirm', { message: 'Delete 12 items?' }, { modal: true }).result
if (answer.ok && answer.data) await deleteItems()
```

It is still `dialog.show()`, never `showModal()`. There is no browser top layer, so `zIndexBase`,
your taskbar, the pinned band and the leaving animation all keep working — and a desktop with no
modal open behaves exactly as it did before you used the option once.

- **A third render band**, above the pinned one and above the snap ghost. A sheet opened with
  `{ owner: <the modal> }` rides up with it; a *second* modal opened over the first is dimmed by it
  and inert, as a stacked dialog should be.
- **One scrim**, under the topmost modal. Its position and stacking are inline, so it blocks the
  pointer even with no stylesheet imported; the tint is `--vtd-scrim-bg` in the optional sheet
  (`rgba(0, 0, 0, 0.4)`, darker under `prefers-color-scheme: dark`). It carries no click handler —
  click-outside-to-dismiss stays your decision.
- **Never minimizable**, forced the way an owned window's flags are.
- **ESC dismisses it** through `requestClose(id)`, so a close guard still runs.
- **Never persisted**, and not toggleable: modality is decided at `open()` and a modal is filtered
  out of the stored blob entirely, exactly as an owned window is.

```js
win.isModal(id)            // opened as a modal
win.topModalId()           // the modal the scrim sits under, or null
win.isBlockedByModal(id)   // a modal is open and this window is neither it nor its child
```

### Tab is not trapped

The scrim stops the pointer and nothing stops the keyboard: without help, Tab walks out of a modal
into your own page. A focus-trap loop is a deliberate non-goal, so the answer is opt-in and uses the
same mechanism as everything else here:

```js
createWindows({ components, modal: { inertRoot: '#page' } })
```

That element goes `inert` for as long as a modal is open, and whatever `inert` it already had is
handed back afterwards. It must **not** contain `WindowHost` — `inert` covers a subtree, so an
ancestor of the windows would make the modal itself unclickable; in development such an element warns
and is ignored. This is why the [setup](#setup-used-by-every-example) puts the host beside the page
content.

### Sheet or modal?

| | Sheet — `{ owner: id }` | Modal — `{ modal: true }` |
| --- | --- | --- |
| Scope | one window: its owner | the desktop |
| What goes inert | the owner's own `<dialog>` | every other window, plus `inertRoot` if set |
| Backdrop | none | one scrim, under the top modal |
| Other windows | fully usable, drag included | inert |
| Where it sits | one `z` above its owner | the top band, above pinned |
| ESC | dismisses it | dismisses it |
| Persisted | never | never |

Both settle a result on every path that takes them away, so an unanswered question reads as "no"
rather than hanging the caller.

---

## 8 · Fullscreen on small screens

Below `mobileBreakpoint` (768px by default) a floating window is unusable, so every window renders at
`100vw × 100dvh` with drag, resize and snapping turned off. Nothing is asked for and nothing is
stored: the descriptor's geometry is untouched, so widening the browser puts every window back
exactly where it was.

```js
createWindows({ components, mobileBreakpoint: 768 })   // 0 disables the behaviour entirely
```

This is the one mode you do not opt into. It composes with the rest: a pinned window is still on top,
a modal still dims what is behind it.

---

## 9 · Presets: naming a mode

A "mode" in your app is usually a bundle of the options above. Register it once under a name instead
of repeating it at every call site:

```js
createWindows({
  components,
  presets: {
    // The classical dialog: modal, centred, fixed size, no chrome.
    dialog: { modal: true, placement: 'center', w: 420, h: 200,
              draggable: false, resizable: false },
    // A monitor panel: always on top, small, unresizable.
    hud: { fixed: true, w: 320, h: 180, resizable: false },
  },
})

const ok = await win.open('confirm', { message }, { preset: 'dialog' }).result
win.open('logViewer', { source: 'live' }, { preset: 'hud' })
```

A preset is named at the call site, so it outranks the component's own spec and loses to the explicit
options of that call:

```
the open() call  →  the named preset  →  the component's spec  →  the library default
```

An unknown preset name throws at `open()`, exactly as an unknown component name does.

`placement` is available on all three levels:

```js
win.open('confirm', { message }, { placement: 'center', w: 400, h: 300 })
// centred in the viewport; 'cascade' (the default) staggers instead
win.open('confirm', { message }, { placement: 'center', y: 40 })
// an explicit x or y still wins, one axis at a time
```

---

## Choosing between them

| The question you are answering | Mode |
| --- | --- |
| "Show me this document / tool, alongside the others" | [plain](#1--plain-window) |
| "…and the user must not move or close it" | [restricted](#2--restricted-window) |
| "Keep this visible while I work in something else" | [pinned](#5--pinned-always-on-top) |
| "Answer this **about this document** before closing it" | [owned sheet](#6--owned-child-window-sheet) |
| "Answer this before doing anything at all" | [modal](#7--modal) |
| "Always open this type the same way" | a [preset](#9--presets-naming-a-mode) or a component spec |

If a sheet would do, prefer it: it blocks one window instead of the whole desktop, and the rest of
the app keeps working while the user thinks.

---

## What persists, and what does not

With `persist` configured, the store is written to storage (debounced, and flushed on `pagehide`) and
read back on the next load. Only the descriptor is written.

**On the descriptor, therefore persisted:** `id`, `name`, `props`, `state` (your `useWindowState`
draft), `title`, `minimized`, `x`, `y`, `w`, `h`, `z`, `meta`, and the four capability flags with
their size limits.

**Runtime-only, therefore not:**

| State | What a reload does |
| --- | --- |
| Snap zone | the window comes back floating, with the geometry the snap gave it |
| Pin (`fixed`) | comes back unpinned and draggable |
| Owner link | the child is **never written at all** |
| Modality | the modal is **never written at all** |
| Control labels | re-read from the app-wide option on the next install |
| Close guards, pending closes, results | gone — a result belongs to the page load that opened it |

The rule behind that split: anything toggled at runtime, or anything that is a *question*, stays out
of the descriptor. Persisting it would move the storage schema, and a question that comes back after
a reload is a question nobody is asking any more.

A restored window has no live opener, so its result is already settled:

```js
const r = await win.resultOf(id)   // { ok: false, reason: 'restored' }
win.isRestored(id)                 // true for a window that came from storage
```

---

## See also

- [How it works](./how-it-works.md) — the descriptor model, the render bands, the runtime-only maps
  and why each one is where it is.
- [Recipes](./recipes.md) — complete, copy-pasteable use cases.
- [API reference](./api.md) — the full option and API reference.
