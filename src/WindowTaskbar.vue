<script setup lang="ts">
import { computed, type ComponentPublicInstance } from 'vue'
import { useWindows } from './createWindows'

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
    focus: (id: string) => string
    minimize: (id: string) => string
    /**
     * Opt in to receiving focus when the last window is minimized: `:ref="registerFocusTarget"` on
     * whichever element should take it. Without this, focus falls through to the opener. It is not
     * consulted on close — a closed window has no taskbar button left to focus.
     */
    registerFocusTarget: (el: Element | ComponentPublicInstance | null) => void
  }): unknown
}>()

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
    :focus="win.focus"
    :minimize="win.minimize"
    :register-focus-target="registerFocusTarget"
  />
</template>
