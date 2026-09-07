<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useWindowContext } from '../../src'
import { log, trackMount } from '../eventLog'

/**
 * The question a close guard asks, as a window of its own. Opened with `{ owner: <the editor> }`,
 * so it renders above that editor, makes only that editor inert, and dies with it.
 *
 * The answer travels back as the window's own result — `resolve(ok)` settles the promise
 * `open()` handed the editor and closes this sheet in one move. No callback in `props`, and no
 * subscription to `close` on the asking side: a window that goes away without answering settles
 * `{ ok: false }` by itself, which is the "keep editing" case.
 */
defineProps<{
  message: string
  windowId: string
}>()

const { resolve } = useWindowContext<boolean>()

onMounted(() => trackMount('ConfirmSheet', 1))
onUnmounted(() => trackMount('ConfirmSheet', -1))

// resolve(), not close(): the sheet has answered, and the answer is the point of the window.
function respond(ok: boolean) {
  log(`ConfirmSheet: ${ok ? 'discard' : 'keep'}`)
  resolve(ok)
}
</script>

<template>
  <div class="sheet">
    <p>{{ message }}</p>
    <p class="hint">
      ESC dismisses this window instead of minimizing it, and the editor behind it is
      <code>inert</code> — every other window on the desktop still works. Dismissing settles this
      window's result as <code>{{ '{ ok: false, reason: \'closed\' }' }}</code>, which the guard
      reads as “keep editing”.
    </p>
    <p class="row">
      <button
        type="button"
        @click="respond(false)"
      >
        Keep editing
      </button>
      <button
        type="button"
        @click="respond(true)"
      >
        Discard
      </button>
    </p>
  </div>
</template>

<style scoped>
.sheet { display: flex; flex-direction: column; height: 100%; padding: 4px; }
.hint { font-size: 12px; color: #6b7280; }
.row { display: flex; gap: 8px; justify-content: flex-end; margin-top: auto; }
</style>
