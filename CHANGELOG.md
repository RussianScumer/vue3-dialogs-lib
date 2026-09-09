# Changelog

Notable changes to `@korneevec/vue3-dialogs-lib`. Dates are release dates; unreleased work sits at the top.

## 0.3.0 — 2026-09-09

### Added

- **Modal windows.** `open(name, props, { modal: true })` opens a window that draws above every
  other band, dims the page behind it with a single scrim, and makes every other window on the
  desktop `inert` until it closes. It is still `dialog.show()`, never `showModal()`: there is no
  browser top layer, so `zIndexBase`, the taskbar, the pinned band and the leaving animation all
  keep working, and a desktop with no modal open is byte-for-byte the desktop 0.2.1 rendered —
  `isBlockedByModal(id)` answers `false` for every id while no modal is open, which is what leaves
  everything else untouched.

  The scrim is one element under the topmost modal, positioned and stacked inline so it blocks the
  pointer with no stylesheet imported; the tint is a new `--vtd-scrim-bg` token in the optional
  sheet. Containment is `inert` — the same mechanism, and the same record-and-restore, an owner
  already used for its own sheet — not a focus-trap loop, which stays a non-goal. A modal is forced
  non-minimizable, and ESC dismisses it through `requestClose(id)` so a close guard still runs.

  Modality is runtime-only, in a reactive `Set` beside `pins`: `WindowDescriptor` gains no field and
  `SCHEMA` does not move. A modal is filtered out of the persisted blob entirely, exactly as an
  owned window is — a question must not come back after a reload. New store methods `isModal(id)`,
  `topModalId()` and `isBlockedByModal(id)`.

  Tab is **not** trapped: the scrim stops the pointer and nothing stops the keyboard. The opt-in
  answer is `modal: { inertRoot }`, an element that goes `inert` alongside — it must not contain
  `WindowHost`, and in development one that does warns and is ignored. Said plainly rather than
  papered over.

  This narrows the founding non-goal rather than dropping it; the rejection bullet in
  `_doc/ROADMAP-gaps.md` and the "non-modal by design" claims in the README and
  `docs/how-it-works.md` were rewritten to match what the library now does.

- **Presets and centring.** `presets: Record<string, WindowDefaults>` on the options are named
  bundles of the same keys a `WindowSpec` takes, chosen per call with `{ preset: 'dialog' }`.
  Precedence is `open()` → preset → the component's spec → the library default: a preset is named at
  the call site, so it outranks the spec and loses to that call's explicit options. An unknown name
  throws at `open()`, as an unknown component does. `placement: 'center'` puts a window in the
  middle of the viewport instead of the cascade, one axis at a time, with an explicit `x` or `y`
  still winning.

- **Accessible names for the default controls.** `labels: { minimize, close, pin }`, app-wide on the
  options and per window as a spec default or an `open()` option, merged key by key. `aria-label`
  only — the library still ships no strings, it only places the consumer's. The pin renders
  `aria-pressed` whether or not it was named, being a toggle. A window that renders a default
  control with no name and no `controls` slot warns once per app in development instead of silently
  shipping unnamed buttons. Labels are runtime-only and are dropped by `hydrate()`: a label belongs
  to the running app's locale, not to the window.

- **`geometry` fires for every user gesture.** Drag, resize and arrow-key nudges emit once at the
  end of the gesture — not per frame — alongside the existing `snap()` and `setGeometry()`. A drop
  into a snap zone still reports exactly once, from the snap. Re-clamping the whole stack after a
  viewport resize stays silent, and that is now documented.

- **[Window modes](./docs/window-modes.md)** — a guide to every kind of window the library opens:
  plain, owned, pinned, modal, and what each one does to focus, ESC, persistence and the z bands.

### Fixed

- **Hydration respects a window's own size limits.** `normalize()` filled `minW`/`maxW` but never
  ran `clampSize`, so a hand-edited or older blob with `w` below the minimum rendered under it until
  the first resize.

- **`hydrate()` tells listeners what it dropped.** It settled outstanding results as `closed` but
  emitted no `close` event for a window that a `resume()` removed. Arrivals still emit no `open`:
  that would change what `on('open')` means.

- **A west or north resize grip clamps to `bounds` like a drag does.** Dragging the leading edge
  could push the window's own top or left out of reach; the grip now stops where a drag would.

- **`maxWindows` below one is treated as one, with a development warning.** It used to evict every
  window and then open one anyway, leaving a desktop the option said could not exist.

### Changed

- `WindowDescriptor['state']` is typed `unknown` rather than `unknown | null`, which collapsed to
  the same type and only read as if it did more.
- `WindowTaskbar`'s `all` slot prop is typed `WindowDescriptor[]` instead of borrowing the
  `minimized` computed's type.

`SCHEMA` does not move in this release: nothing here is a persisted-shape change, and a reload
restores exactly the windows 0.2.1 restored.

## 0.2.1 — 2026-09-08

### Fixed

- **A frame keeps rendering a descriptor that `hydrate()` has already replaced.** `hydrate()` —
  in practice `resume()` after a foreign cross-tab write — swaps `s.stack` for fresh objects, but
  the host only replaced a frame's descriptor when the frame was leaving, and `BaseWindow` reads
  `props.descriptor` once at setup. A surviving id went on rendering the old, detached object: the
  store said `x: 300` while the DOM stayed where it was, and a drag afterwards mutated an object
  the persistence watcher no longer saw. A frame whose descriptor object changed is now retired and
  rebuilt around the new one, remounting its content so it re-reads `state` from the adopted
  descriptor. Focus is not stolen — `hydrate()` marks every id restored and `useWindowFocus`
  skips a restored window.

- **The snap ghost drew below the windows whenever `zIndexBase` was non-zero.** It used
  `topZ + 1` while windows use `zIndexBase + (pinned ? topZ : 0) + z`, so with a base of 1000 the
  drop preview vanished under every window, and even at base 0 it sat under the pinned band. It now
  clears the pinned band at any base.

- **The debounced persistence write is flushed on `pagehide`.** Writes are debounced by 300 ms and
  nothing flushed them on the way out, so a reload within 300 ms of the last keystroke in a
  `useWindowState` draft dropped it. `pagehide` rather than `beforeunload`: it also fires for a
  bfcache freeze and a mobile tab discard, and it does not block unload. A tab that has stopped
  after a foreign write still writes nothing.

## 0.2.0 — 2026-09-07

### Breaking

- **`open()` returns `{ id, result }` instead of the window id.** Every call site that used the
  return value needs `.id`:

  ```diff
  - const id = win.open('itemEditor', { id: 42 })
  + const { id } = win.open('itemEditor', { id: 42 })
  ```

  `result` is a promise for what the window settled with —
  `{ ok: true, data } | { ok: false, reason: 'closed' | 'restored' }` — settled by `resolve(data)`
  or `dismiss()` from the window's own content, and by every close path otherwise, so it never
  hangs. A window restored from storage settles `restored`, because the call that opened it belongs
  to a previous page load. See [Window results](./README.md#window-results).

  The handle is deliberately not string-compatible: making it stringify to an id would have hidden
  the break at every call site that still expects one. In development it warns once when it is
  coerced to a string, which is exactly what a 0.1 call site does; in production it coerces to
  `[object Object]`. The break lands before `1.0` precisely so it can.

  Nothing about a result is persisted, and `SCHEMA` does not move — a reload restores exactly the
  windows 0.1 restored.

### Added

- Cross-tab safety for `persist`. A tab that sees another tab write its storage key stops
  persisting rather than racing it: last-writer-wins is how a session gets eaten, and a stale tab is
  the cheaper failure. The write is identified by a per-tab token in the blob's envelope beside
  `schema` and `topZ` — never on a descriptor, so `SCHEMA` does not move and blobs are readable in
  both directions. `onExternalChange(info)` reports it once per foreign write and hands over
  `info.resume()`, the only way back: it re-reads and hydrates before it resumes writing, so
  adopting the other tab's session is a deliberate choice that replaces this tab's windows and
  drafts. Only `localStorage` emits `storage` events; every other adapter behaves exactly as before,
  with no warning.
- Fixed (always-on-top) windows: `fixed: true` as a `WindowSpec` default or an `open()` option
  renders the window in a second `z` band above every unpinned one, and makes it inert to drag,
  resize, snap, the double-click toggle and the arrow-key nudge. It stays closable and minimizable,
  and a pin toggle in its own header — appended after the close control, hooked with
  `data-vw-pinned` — lets the user let go of it. `isPinned(id)`, `isPinnable(id)` and
  `setPinned(id, on)` are on the store. The pin is runtime-only, like a snap zone: nothing is
  persisted, and a reload returns the window unpinned and draggable.
- A keyboard keymap, with two chords per action: the familiar `Meta`+arrow / `Meta`+`Shift`+arrow /
  `` Alt+` `` and, because a desktop has usually taken those before the browser sees them,
  `Ctrl`+`Shift`+arrow for the halves, `Ctrl`+`Shift`+`1`…`4` for the quarters in reading order and
  `` Ctrl+` `` for switching. Every binding is movable through `keymap.bindings` — an override
  replaces both chords for its action — and `keymap: { enabled: false }` removes the lot. A
  keystroke inside an `<input>`, `<textarea>` or `contenteditable` never reaches it. Snapping goes
  through the same `snap(id, zone, view)` a drop does, and obeys the same flags, insets and
  `mobileBreakpoint` inertness. Chords act on the **active** window from wherever focus is, through
  one document listener in the plugin's effect scope.
- `focusNext()` / `focusPrev()` on the store, whatever the keymap is set to: the next non-minimized
  window by `z`, wrapping, focusing its header. A window that owns a child is skipped, since its
  own frame is `inert` while the question is open.
- `resolve(data)` and `dismiss()` on `useWindowContext()`, and `resultOf(id)` / `resolve(id, data)`
  on the store, for a window you did not open yourself.
- A type-only `result` marker on `WindowSpec`, so `useWindows<typeof components>()` types
  `handle.result`. It degrades to `unknown` rather than to an error, like the prop inference does,
  and the key is stripped before it can reach the descriptor.
- Owned child windows: `open(name, props, { owner: id })` renders a window above its owner and
  makes only that owner `inert` — the macOS document-modal sheet, not `showModal()`.
- Async close guards with a `closing` pending state, exposed on the window context and in
  `WindowTaskbar`'s slot props.
- A leaving lifecycle: `data-vw-state="entering" | "open" | "leaving"` on the `<dialog>`, with the
  retention read from `--vtd-motion-duration`.
- A focus destination chain for minimize and close, with an opt-in taskbar target.
- `loadingComponent` / `errorComponent` / `delay` / `timeout` per window type and app-wide.
- A `footer` slot on `BaseWindow` over a scrolling `.vw__body`.

### Fixed

- A single click on a maximized window's header no longer restores it. Undocking moved from
  `pointerdown` to the first `pointermove` past a 4px threshold, so a click raises the window and
  nothing else, and a double-click toggles maximize in both directions — it could previously
  maximize but never restore, because the first `pointerdown` had already cleared the zone.
- `npm run build` emits declarations again. The declaration-only pass reads `src/` without the root
  `env.d.ts`, so the `import.meta.env.DEV` guards behind the dev-mode warnings failed it with
  TS2339; `tsconfig.lib.json` now names Vite's client types directly. The failure also took
  `build-css` with it, so `dist/` shipped without `style.css`.
- The published package no longer carries declarations for the benchmark suite —
  `tsconfig.lib.json` excluded `src/**/__tests__/*` but not `src/**/__bench__/*`.

- ESC is a real `keydown` listener rather than the `<dialog>` `cancel` event, which never fires for
  a non-modal dialog. It stands down for `defaultPrevented`, for a background window, and for a
  focused native picker.
- An arrow key carrying `Meta`, `Ctrl` or `Alt` no longer nudges the window 10px on its way to the
  keymap. `Shift`+arrow still resizes, as before.
- Clicking a window now focuses it as well as raising it. The drag handle's `preventDefault()` on
  pointerdown had suppressed the focus change, so a click could raise one window while the keyboard
  went on talking to another — visible as ESC, typing and the keymap acting on the wrong window.

## 0.1.0

- First release: serializable window descriptors in a store, drag, resize, snap, persistence,
  taskbar, typed `open()`.
