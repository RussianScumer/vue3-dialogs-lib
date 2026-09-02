<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useWindowContext } from '../../src'
import { trackMount } from '../eventLog'

defineProps<{ windowId: string }>()
const { setTitle } = useWindowContext()
setTitle('Poppers & forms')

const anchor = ref<HTMLElement | null>(null)
const open = ref(false)
const pos = ref({ x: 0, y: 0 })
const picked = ref('—')

onMounted(() => trackMount('PopperDemo', 1))
onUnmounted(() => trackMount('PopperDemo', -1))

// A teleported dropdown, the way a select/date-picker library builds one. It must
// paint above the window: that is what the non-modal .show() decision buys.
function toggle() {
  const rect = anchor.value?.getBoundingClientRect()
  if (rect) pos.value = { x: rect.left, y: rect.bottom + 4 }
  open.value = !open.value
}

function pick(value: string) {
  picked.value = value
  open.value = false
}
</script>

<template>
  <p class="hint">
    Non-modal windows keep teleported poppers usable.
  </p>

  <label>Native select
    <select>
      <option>alpha</option>
      <option>beta</option>
    </select>
  </label>

  <p>
    <button
      ref="anchor"
      type="button"
      @click="toggle"
    >
      Teleported dropdown ▾
    </button>
    picked: <b>{{ picked }}</b>
  </p>

  <Teleport to="body">
    <ul
      v-if="open"
      class="popper"
      :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
    >
      <li
        v-for="o in ['one', 'two', 'three']"
        :key="o"
      >
        <button
          type="button"
          @click="pick(o)"
        >
          {{ o }}
        </button>
      </li>
    </ul>
  </Teleport>
</template>

<style scoped>
.hint { margin-top: 0; color: #6b7280; }
label { display: block; margin-bottom: 8px; }
</style>

<style>
.popper {
  position: fixed;
  z-index: 2147483000; /* above every window; the library owns z-index below this */
  margin: 0;
  padding: 4px;
  list-style: none;
  background: #fff;
  color: #111;
  border: 1px solid rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.25);
}
.popper button { display: block; width: 120px; text-align: left; border: 0; background: none; padding: 4px 8px; }
.popper button:hover { background: rgba(0, 0, 0, 0.08); }
</style>
