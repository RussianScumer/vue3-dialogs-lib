# Changelog

Notable changes to `vue-windows`. Dates are release dates; unreleased work sits at the top.

## Unreleased — 0.2.0

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

- A keyboard keymap: `Meta`+arrow snaps, `Meta`+`Shift`+arrow takes the quarters, and
  `` Alt+` `` / `` Alt+Shift+` `` switch windows. On by default and every binding movable through
  `keymap.bindings`, since `Meta`+arrow collides with a real OS window manager on some platforms;
  `keymap: { enabled: false }` removes the lot. A keystroke inside an `<input>`, `<textarea>` or
  `contenteditable` never reaches it. Snapping goes through the same `snap(id, zone, view)` a drop
  does, and obeys the same flags, insets and `mobileBreakpoint` inertness.
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

- ESC is a real `keydown` listener rather than the `<dialog>` `cancel` event, which never fires for
  a non-modal dialog. It stands down for `defaultPrevented`, for a background window, and for a
  focused native picker.
- An arrow key carrying `Meta`, `Ctrl` or `Alt` no longer nudges the window 10px on its way to the
  keymap. `Shift`+arrow still resizes, as before.

## 0.1.0

- First release: serializable window descriptors in a store, drag, resize, snap, persistence,
  taskbar, typed `open()`.
