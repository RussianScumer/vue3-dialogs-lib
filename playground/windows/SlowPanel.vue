<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useWindowContext } from '../../src'
import { trackMount } from '../eventLog'

defineProps<{ windowId: string }>()
const { setTitle } = useWindowContext()
setTitle('Arrived late')

onMounted(() => trackMount('SlowPanel', 1))
onUnmounted(() => trackMount('SlowPanel', -1))
</script>

<template>
  <p>
    Registered behind a loader that takes 1.5s. The spinner above was the library's
    <code>loadingComponent</code>; the window frame, its header and its controls were live the whole
    time.
  </p>
</template>

<style scoped>
p { margin: 0; font-size: 13px; color: #6b7280; }
</style>
