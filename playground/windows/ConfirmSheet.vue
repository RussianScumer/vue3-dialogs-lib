<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useWindowContext } from '../../src'
import { log, trackMount } from '../eventLog'

/**
 * The question a close guard asks, as a window of its own. Opened with `{ owner: <the editor> }`,
 * so it renders above that editor, makes only that editor inert, and dies with it.
 *
 * `answer` is a function prop, which is exactly the thing a descriptor may not carry — and it is
 * safe here for the same reason the whole window is: an owned window is never persisted, so this
 * one can never come back from storage with a dead callback in its props. An ordinary window would
 * have to pass an id and look the resolver up.
 */
const props = defineProps<{
  message: string
  answer: (ok: boolean) => void
  windowId: string
}>()

const { close } = useWindowContext()

onMounted(() => trackMount('ConfirmSheet', 1))
onUnmounted(() => trackMount('ConfirmSheet', -1))

// close(), not requestClose(): the sheet has answered, and there is nothing left to ask it.
function respond(ok: boolean) {
  log(`ConfirmSheet: ${ok ? 'discard' : 'keep'}`)
  props.answer(ok)
  close()
}
</script>

<template>
  <div class="sheet">
    <p>{{ props.message }}</p>
    <p class="hint">
      ESC dismisses this window instead of minimizing it, and the editor behind it is
      <code>inert</code> — every other window on the desktop still works.
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
