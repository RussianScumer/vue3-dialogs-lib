<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useWindowContext, useWindowState } from '../../src'
import { log, trackMount } from '../eventLog'

const props = defineProps<{ id: number; windowId: string }>()

// Draft survives minimize (unmount) and, with persist on, a reload.
const form = useWindowState(props.windowId, () => ({ name: '', note: '' }))
const { descriptor, setTitle, requestClose, onBeforeClose, minimize, isRestored } = useWindowContext()

setTitle(`Item ${props.id}`)

// Refuse to close while the draft has something in it. Registered from the content, so it lives
// exactly as long as the content does — minimize this window and the guard is gone with it.
onBeforeClose(() => {
  if (!form.name) return true
  log(`ItemEditor ${props.id}: refused to close — "Name" is not empty`)
  return false
})

// Staleness pattern: stash the version the draft started from in meta, compare after refetch.
const serverVersion = ref<number | null>(null)
const conflict = ref(false)

onMounted(() => {
  trackMount('ItemEditor', 1)
  if (descriptor.meta.version == null) descriptor.meta.version = 1
  if (isRestored) refetch()
})
onUnmounted(() => trackMount('ItemEditor', -1))

/** Stands in for a real fetch: pretends the server moved on. */
function refetch() {
  serverVersion.value = 2
  conflict.value = serverVersion.value !== descriptor.meta.version
  log(`ItemEditor ${props.id}: refetched on restored mount, conflict=${conflict.value}`)
}

function keepServer() {
  form.name = 'server copy'
  form.note = ''
  descriptor.meta.version = serverVersion.value ?? 1
  conflict.value = false
}
</script>

<template>
  <p
    v-if="isRestored"
    class="hint"
  >
    Restored from storage (<code>isRestored === true</code>).
    <span v-if="conflict"> Server is at v{{ serverVersion }}, draft started at v{{ descriptor.meta.version }}.</span>
  </p>
  <p
    v-if="conflict"
    class="conflict"
  >
    <button
      type="button"
      @click="conflict = false"
    >
      Keep my draft
    </button>
    <button
      type="button"
      @click="keepServer"
    >
      Take server copy
    </button>
  </p>

  <p class="hint guard">
    <template v-if="form.name">
      Closing is refused while this is filled in.
    </template>
    <template v-else>
      Type a name to arm the close guard.
    </template>
  </p>

  <label>Name <input
    v-model="form.name"
    placeholder="type, then minimize"
  ></label>
  <label>Note <textarea
    v-model="form.note"
    rows="3"
  /></label>

  <p class="row">
    <button
      type="button"
      @click="minimize()"
    >
      Minimize myself
    </button>
    <button
      type="button"
      @click="requestClose()"
    >
      Close myself
    </button>
  </p>
  <pre>{{ form }}</pre>
</template>

<style scoped>
label { display: block; margin-bottom: 8px; }
input, textarea { width: 100%; box-sizing: border-box; }
.hint { margin-top: 0; color: #b45309; }
.guard { font-size: 12px; }
.conflict { display: flex; gap: 8px; }
.row { display: flex; gap: 8px; }
pre { background: rgba(127, 127, 127, 0.15); padding: 6px; font-size: 12px; }
</style>
