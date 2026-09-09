<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useWindowContext } from '../../src'
import { log, trackMount } from '../eventLog'

/**
 * A desktop-scoped question: opened with `{ preset: 'dialog' }`, which is `modal: true` plus a
 * centred 420×260 frame with no drag and no grips. Where a ConfirmSheet blocks exactly one window —
 * the one that asked — this one dims the whole page and makes every other window inert until it is
 * answered.
 *
 * The answer travels the same way a sheet's does: `resolve()` settles the promise `open()` handed
 * back and closes the window in one move.
 */
defineProps<{
  message: string
  windowId: string
}>()

const { resolve } = useWindowContext<boolean>()

onMounted(() => trackMount('ModalDialog', 1))
onUnmounted(() => trackMount('ModalDialog', -1))

function respond(ok: boolean) {
  log(`ModalDialog: ${ok ? 'confirmed' : 'cancelled'}`)
  resolve(ok)
}
</script>

<template>
  <div class="dialog">
    <p>{{ message }}</p>
    <p class="hint">
      The page behind is dimmed by the scrim and every other window carries <code>inert</code>. ESC
      dismisses this window through its close guard rather than minimizing it — a modal has no
      minimize at all. Still <code>show()</code>, never <code>showModal()</code>: the taskbar below
      and the page header are ordinary markup, and only <code>modal.inertRoot</code> keeps Tab out
      of the page.
    </p>
    <p class="row">
      <button
        type="button"
        @click="respond(false)"
      >
        Cancel
      </button>
      <button
        type="button"
        @click="respond(true)"
      >
        Confirm
      </button>
    </p>
  </div>
</template>

<style scoped>
.dialog { display: flex; flex-direction: column; height: 100%; padding: 4px; }
.hint { font-size: 12px; color: #6b7280; }
.row { display: flex; gap: 8px; justify-content: flex-end; margin-top: auto; }
</style>
