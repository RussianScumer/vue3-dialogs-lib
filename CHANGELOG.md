# Changelog

Notable changes to `@korneevec/vue3-dialogs-lib`. Dates are release dates; unreleased work sits at the top.

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
