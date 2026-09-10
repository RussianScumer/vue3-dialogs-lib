<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useWindowContext } from '../../src'
import { trackMount } from '../eventLog'

const props = defineProps<{ source: string; windowId: string }>()
const lines = ref<string[]>([])
const { setTitle } = useWindowContext()
setTitle(`Log: ${props.source}`)

// A running interval makes the unmount-on-minimize claim observable: the tick
// stops and the live-mount counter drops to zero while minimized.
let timer: ReturnType<typeof setInterval>
onMounted(() => {
  trackMount('LogViewer', 1)
  timer = setInterval(() => lines.value.unshift(new Date().toLocaleTimeString()), 1000)
})
onUnmounted(() => {
  clearInterval(timer)
  trackMount('LogViewer', -1)
})
</script>

<template>
  <p class="hint">
    Ticks once a second. Minimize: the timer is gone, not paused.
  </p>
  <!-- The prop, live: case 15's `updateProps` swaps it and this line follows without a remount, so
       the tick below never restarts. The title does not follow, because `setTitle` above runs in
       setup and setup is exactly what a re-render does not re-run. -->
  <p class="hint">
    <code>source: {{ source }}</code>
  </p>
  <ol>
    <li
      v-for="(l, i) in lines.slice(0, 15)"
      :key="i"
    >
      {{ l }}
    </li>
  </ol>
</template>

<style scoped>
.hint { margin-top: 0; color: #6b7280; }
ol { font-family: ui-monospace, monospace; font-size: 12px; }
</style>
