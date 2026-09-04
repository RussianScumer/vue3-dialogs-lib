<script setup lang="ts">
import { computed, type ComponentPublicInstance } from 'vue'
import { useWindows } from './createWindows'
import type { Rect } from './types'

// Renderless: the consumer owns the visual completely.
const win = useWindows()
const minimized = win.minimized
// Computed, not `win.s.stack`: close() and closeAll() replace the array, so a captured reference
// would go stale the first time a window is closed.
const all = computed(() => win.s.stack)
const activeId = win.activeId

defineSlots<{
  default(props: {
    /** The minimized set — unchanged, so existing taskbars keep working. */
    windows: ReturnType<typeof useWindows>['minimized']['value']
    /** Every window, minimized or not: what an actual taskbar needs. */
    all: ReturnType<typeof useWindows>['minimized']['value']
    /** Id of the top non-minimized window, or null. */
    active: string | null
    restore: (id: string) => string
    close: (id: string) => void
    requestClose: (id: string) => Promise<boolean>
    /**
     * True while a `requestClose` for that window is still waiting on its guards — render a
     * spinner, or disable the button, rather than letting the user click it again. The second
     * click is harmless either way: it joins the first request instead of asking twice.
     */
    closing: (id: string) => boolean
    focus: (id: string) => string
    minimize: (id: string) => string
    /**
     * Opt in to receiving focus when the last window is minimized: `:ref="registerFocusTarget"` on
     * whichever element should take it. Without this, focus falls through to the opener. It is not
     * consulted on close — a closed window has no taskbar button left to focus.
     */
    registerFocusTarget: (el: Element | ComponentPublicInstance | null) => void
    /**
     * Tell the library where a window's button is, and a minimizing window can be animated towards
     * it: the leaving frame gets `--vtd-min-x`, `--vtd-min-y` and `--vtd-min-scale`. Measure from a
     * ref callback — `:ref="(el) => setTaskbarRect(w.id, el)"` — so the rect is re-taken whenever
     * the taskbar re-renders. Optional; without it a minimize is a plain fade.
     */
    setTaskbarRect: (id: string, rect: DOMRectReadOnly | Rect | Element | ComponentPublicInstance | null) => void
  }): unknown
}>()

/**
 * A rect, an element or a component instance are all accepted, because a ref callback hands back
 * the element and measuring it is the only thing a consumer could do with it.
 */
function setTaskbarRect(
  id: string,
  rect: DOMRectReadOnly | Rect | Element | ComponentPublicInstance | null,
): void {
  const node = rect && '$el' in rect ? (rect.$el as unknown) : rect
  if (node instanceof Element) return win.setTaskbarRect(id, node.getBoundingClientRect())
  win.setTaskbarRect(id, (node as DOMRectReadOnly | Rect | null) ?? null)
}

// A template ref callback hands back the element on mount and `null` on unmount, which is exactly
// the registration this needs — nothing to clean up here. Bound to a component rather than an
// element it arrives as the instance, so unwrap `$el`; anything that is not a focusable node
// deregisters rather than being kept and failing silently later.
function registerFocusTarget(el: Element | ComponentPublicInstance | null): void {
  const node = el && '$el' in el ? (el.$el as unknown) : el
  win.registerFocusTarget(node instanceof HTMLElement ? node : null)
}
</script>

<template>
  <slot
    :windows="minimized"
    :all="all"
    :active="activeId"
    :restore="win.restore"
    :close="win.close"
    :request-close="win.requestClose"
    :closing="win.isClosing"
    :focus="win.focus"
    :minimize="win.minimize"
    :register-focus-target="registerFocusTarget"
    :set-taskbar-rect="setTaskbarRect"
  />
</template>
