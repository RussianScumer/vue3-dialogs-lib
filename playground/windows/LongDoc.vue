<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useWindowContext } from '../../src'
import { trackMount } from '../eventLog'

defineProps<{ windowId: string }>()
const { setTitle } = useWindowContext()
setTitle('Release notes')

onMounted(() => trackMount('LongDoc', 1))
onUnmounted(() => trackMount('LongDoc', -1))

// Deliberately far taller than the window opens: the point is what the frame does with content it
// cannot fit.
const paragraphs = Array.from({ length: 12 }, (_, i) => i + 1)
</script>

<template>
  <h3>Long content, fixed frame</h3>
  <p
    v-for="n in paragraphs"
    :key="n"
  >
    <strong>{{ n }}.</strong> The window has a fixed height the user can shrink. Content taller than
    the frame scrolls inside the body; the header and the footer below stay where they are. Resize
    this window smaller from any grip — the scroll area shrinks and the footer buttons stay
    reachable.
  </p>
</template>

<style scoped>
h3 { margin-top: 0; font-size: 14px; }
p { font-size: 13px; color: #6b7280; }
</style>
