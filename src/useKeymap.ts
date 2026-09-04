import { onScopeDispose } from 'vue'
import { KEYMAP_ZONES, isSnapAction, matchKeymap } from './options'
import type { WindowsApi } from './state'
import type { ResolvedOptions, Viewport } from './types'

/**
 * A keystroke inside a text field belongs to the text field: on macOS `Meta+ArrowLeft` is
 * line-start and `Ctrl+Shift+ArrowLeft` is word-select everywhere, and a window manager that eats
 * either is a window manager the user switches off.
 */
function editable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true
  // `closest`, not `isContentEditable`: a keystroke in rich text is delivered to whatever inline
  // element the caret is in, not to the editable root — and the property is one of the things jsdom
  // does not implement, so a spec could never see it.
  return !!el.closest?.('[contenteditable]:not([contenteditable="false"])')
}

/**
 * The app's single keymap listener. Created once by the plugin inside its effect scope, next to the
 * viewport tracker and for the same reasons — one listener however many windows are open, removed
 * when the app unmounts, and inert without a DOM.
 *
 * **On the document, not on each window.** The first version of this bound a `keydown` to every
 * `<dialog>`, which works right up to the second window: a `<dialog>` is not focusable and neither
 * is most window content, so clicking a window's body — or the page background — leaves
 * `document.activeElement` on `<body>` and no window ever sees the key. Worse, the drag handle
 * calls `preventDefault()` on pointerdown, so clicking a window's header raised it without moving
 * focus, and the chord went to whichever window still held focus rather than the one just clicked.
 *
 * **Every chord acts on the active window**, therefore — the top non-minimized one, the same
 * `activeId` that drives `data-vw-active` and the focus chain — rather than on whichever frame
 * happened to receive the event. That is one rule instead of two, and it is what a window manager
 * does.
 *
 * Bubble phase, never capture: content that takes a key with `preventDefault()` still owns it, and
 * an app-level handler of the consumer's own can still pre-empt the library.
 */
export function setupKeymap(win: WindowsApi, options: ResolvedOptions, view: Viewport): void {
  if (typeof document === 'undefined') return

  function onKeydown(e: KeyboardEvent) {
    if (e.defaultPrevented || editable(e.target)) return
    const action = matchKeymap(e, options.keymap)
    if (!action) return

    // Switching guards itself: with nothing to focus it answers null and does nothing.
    if (!isSnapAction(action)) {
      e.preventDefault()
      win[action]()
      return
    }

    const id = win.activeId.value
    if (!id) return
    const d = win.byId(id)
    if (!d) return
    // The same gates the pointer path respects, plus `resizable`: a snap moves the window and
    // resizes it, and below the breakpoint a window is fullscreen and inert to both.
    if (!options.snap.enabled || !d.draggable || !d.resizable) return
    if (view.w < options.mobileBreakpoint) return
    e.preventDefault()
    win.snap(id, KEYMAP_ZONES[action], view)
  }

  document.addEventListener('keydown', onKeydown)
  onScopeDispose(() => document.removeEventListener('keydown', onKeydown))
}
