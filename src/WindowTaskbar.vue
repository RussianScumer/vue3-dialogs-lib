<script setup lang="ts">
import { computed } from 'vue'
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
  }): unknown
}>()
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
  />
</template>
