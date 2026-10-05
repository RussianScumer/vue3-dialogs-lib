<script setup lang="ts">
import { ref } from 'vue'

defineProps<{ windowId: string }>()

// Opened with no h, minH or maxH, so the frame follows this list as it grows — until the user
// resizes the window, after which new paragraphs scroll inside the body as usual.
const count = ref(3)
</script>

<template>
  <h3>Grows with its content</h3>
  <button
    type="button"
    @click="count += 3"
  >
    Add paragraphs
  </button>
  <p
    v-for="n in count"
    :key="n"
  >
    <strong>{{ n }}.</strong> This window named no height, so it grows to fit what it shows, down to
    the bottom of the screen, then upward, then no further.
  </p>
</template>

<style scoped>
h3 { margin-top: 0; font-size: 14px; }
p { font-size: 13px; color: #6b7280; }
</style>
