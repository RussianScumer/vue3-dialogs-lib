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
