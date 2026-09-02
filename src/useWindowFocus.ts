import { onMounted, onUnmounted, type Ref } from 'vue'

const TABBABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

interface FocusOptions {
  /** Falls back to this when the content has nothing tabbable — the header is tabindex="0". */
  fallback: Ref<HTMLElement | null>
  /** Skip stealing focus: another window is on top, or this one came back from storage on load. */
  shouldFocus: () => boolean
  /** True when the unmount is a close rather than a minimize. */
  closed: () => boolean
}

/**
 * Non-modal means no focus trap, deliberately — but "no trap" is not the same choice as "no focus
 * at all", which is where this started. Opening a window moves focus into it; closing one hands
 * focus back to whatever opened it.
 *
 * Must be called *after* the `dialog.show()` hook is registered: `show()` runs the dialog focusing
 * steps, which would otherwise overwrite this with the first focusable element in the whole dialog
 * — the header, since it precedes the content.
 */
export function useWindowFocus(body: Ref<HTMLElement | null>, options: FocusOptions) {
  // Captured before the window can steal it, so this really is the opener.
  const opener = typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)
  let observer: MutationObserver | null = null

  function stop() {
    observer?.disconnect()
    observer = null
  }

  function firstTabbable(): HTMLElement | null {
    return body.value?.querySelector<HTMLElement>(TABBABLE) ?? null
  }

  onMounted(() => {
    if (!options.shouldFocus()) return
    const target = firstTabbable()
    if (target) {
      target.focus()
      return
    }
    options.fallback.value?.focus()

    // An async component — the recommended way to register a window — has not rendered yet on its
    // first open, so there was nothing to focus. Take the header now and hand focus on when the
    // content lands, unless the user has moved focus in the meantime.
    if (!body.value || typeof MutationObserver === 'undefined') return
    observer = new MutationObserver(() => {
      if (document.activeElement !== options.fallback.value) return stop()
      const late = firstTabbable()
      if (!late) return
      late.focus()
      stop()
    })
    observer.observe(body.value, { childList: true, subtree: true })
  })

  onUnmounted(() => {
    stop()
    if (!options.closed()) return // minimized: the window is coming back, leave focus alone
    if (!opener || opener === document.body || !opener.isConnected) return
    opener.focus?.()
  })
}
