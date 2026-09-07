import { onBeforeUnmount, onMounted, onUnmounted, type Ref } from 'vue'
import type { WindowsApi } from './state'
import type { WindowDescriptor } from './types'

const TABBABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

interface FocusRefs {
  /** The `<dialog>` — the boundary that decides whether this window held focus. */
  root: Ref<HTMLElement | null>
  /** The header. Takes focus when the content has nothing tabbable; it is `tabindex="0"`. */
  head: Ref<HTMLElement | null>
  body: Ref<HTMLElement | null>
}

/**
 * Non-modal means no focus trap, deliberately — but "no trap" is not the same choice as "no focus
 * at all", which is where this started. Opening a window moves focus into it; a window whose frame
 * unmounts hands focus on rather than dropping it.
 *
 * Must be called *after* the `dialog.show()` hook is registered: `show()` runs the dialog focusing
 * steps, which would otherwise overwrite this with the first focusable element in the whole dialog
 * — the header, since it precedes the content.
 */
export function useWindowFocus(
  win: WindowsApi,
  d: WindowDescriptor,
  refs: FocusRefs,
  shouldFocus: () => boolean,
) {
  // Captured before the window can steal it, so this really is the opener.
  const opener = typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)
  let observer: MutationObserver | null = null
  let unregister: (() => void) | null = null
  /** Whether focus was still inside this window when it started to go away. */
  let held = false

  function stop() {
    observer?.disconnect()
    observer = null
  }

  function firstTabbable(): HTMLElement | null {
    return refs.body.value?.querySelector<HTMLElement>(TABBABLE) ?? null
  }

  onMounted(() => {
    if (refs.head.value) unregister = win.registerHeader(d.id, refs.head.value)
    if (!shouldFocus()) return
    const target = firstTabbable()
    if (target) {
      target.focus()
      return
    }
    refs.head.value?.focus()

    // An async component — the recommended way to register a window — has not rendered yet on its
    // first open, so there was nothing to focus. Take the header now and hand focus on when the
    // content lands, unless the user has moved focus in the meantime.
    if (!refs.body.value || typeof MutationObserver === 'undefined') return
    observer = new MutationObserver(() => {
      if (document.activeElement !== refs.head.value) return stop()
      const late = firstTabbable()
      if (!late) return
      late.focus()
      stop()
    })
    observer.observe(refs.body.value, { childList: true, subtree: true })
  })

  // Measured here rather than in onUnmounted: by then the frame is detached from the document and
  // `activeElement` has already fallen back to <body>, so the question can no longer be asked.
  onBeforeUnmount(() => {
    held = !!refs.root.value?.contains(document.activeElement)
  })

  /**
   * Where focus goes when this frame unmounts, in order: the window that is now on top, then — on
   * minimize only, since a closed window has no button to focus — the consumer's taskbar, then the
   * opener. Both minimize and close unmount the content, so leaving focus alone means leaving it on
   * `<body>`, with the keyboard user back at the top of the page.
   */
  function destination(closed: boolean): HTMLElement | null {
    const next = win.activeId.value
    // `activeId` is derived from the stack, which no longer counts this window: closed windows are
    // gone from it and a minimized one is skipped, so the leaving frame can never be its own answer.
    const header = next ? win.headerOf(next) : null
    if (header?.isConnected) return header

    const taskbar = closed ? null : win.taskbarTarget()
    if (taskbar?.isConnected) return taskbar

    if (opener && opener !== document.body && opener.isConnected) return opener
    return null
  }

  onUnmounted(() => {
    stop()
    unregister?.()
    unregister = null
    // Focus was somewhere else entirely — the user put it there, and this window going away is no
    // reason to take it back.
    if (!held) return
    destination(!win.byId(d.id))?.focus?.()
  })
}
