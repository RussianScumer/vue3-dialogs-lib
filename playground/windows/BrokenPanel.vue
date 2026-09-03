<script setup lang="ts">
defineProps<{ windowId: string }>()

// The point of this window: a content component that fails on mount must not take the desktop with
// it. BaseWindow catches this and renders the error component in this frame only.
throw new Error('BrokenPanel threw during setup')
</script>

<template>
  <p>never rendered</p>
</template>
