<script setup lang="ts">
/**
 * The one component the library renders for both kinds of failure: a chunk that never arrived, and
 * content that threw once it did. The `error` prop is passed in both cases.
 */
defineProps<{ error?: unknown }>()
</script>

<template>
  <div class="failed">
    <h3>This window could not load</h3>
    <p>{{ (error as Error)?.message ?? String(error) }}</p>
    <p class="hint">
      The frame is still yours: move it, minimize it, close it.
    </p>
  </div>
</template>

<style scoped>
.failed { font-size: 13px; }
h3 { margin: 0 0 6px; font-size: 14px; color: #b91c1c; }
p { margin: 0 0 6px; color: #6b7280; }
.hint { font-size: 12px; }
</style>
