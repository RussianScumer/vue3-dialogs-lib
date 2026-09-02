<script setup lang="ts">
import { computed, watch } from 'vue'
import BaseWindow from './BaseWindow.vue'
import { useWindows, useWindowOptions } from './createWindows'
import { useViewport } from './useViewport'

const win = useWindows()
const options = useWindowOptions()
const view = useViewport()
const visible = win.visible
/** Armed snap target of the drag in progress; drawn as a ghost above every window. */
const preview = win.preview

// A shrinking viewport must not strand a window off-screen; snapped windows follow it instead.
watch(() => [view.w, view.h], () => win.clampAll(view), { immediate: true })

const ghostStyle = computed(() => {
  const p = preview.value
  if (!p) return undefined
  return {
    position: 'fixed' as const,
    left: '0',
    top: '0',
    width: `${p.w}px`,
    height: `${p.h}px`,
    transform: `translate(${p.x}px, ${p.y}px)`,
    zIndex: String(win.s.topZ + 1),
    pointerEvents: 'none' as const,
    boxSizing: 'border-box' as const,
  }
})
</script>

<template>
  <BaseWindow
    v-for="w in visible"
    :key="w.id"
    :descriptor="w"
  >
    <template
      v-if="$slots.header"
      #header="slotProps"
    >
      <slot
        name="header"
        v-bind="slotProps"
      />
    </template>
    <template
      v-if="$slots.controls"
      #controls="slotProps"
    >
      <slot
        name="controls"
        v-bind="slotProps"
      />
    </template>
    <component
      :is="options.resolve(w.name)"
      v-bind="w.props"
      :window-id="w.id"
    />
  </BaseWindow>

  <div
    v-if="preview"
    class="vw-ghost"
    :style="ghostStyle"
    aria-hidden="true"
    :data-vw-zone="preview.zone"
  />
</template>
