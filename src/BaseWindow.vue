<script setup lang="ts">
import { computed, onErrorCaptured, onMounted, ref } from 'vue'
import { useWindows, useWindowOptions } from './createWindows'
import { onWindowKeydown, useWindowDrag } from './useWindowDrag'
import { RESIZE_DIRS, RESIZE_STYLES, useWindowResize } from './useWindowResize'
import { useWindowFocus } from './useWindowFocus'
import { provideWindowContext } from './useWindowContext'
import { useViewport } from './useViewport'
import type { WindowDescriptor } from './types'

const props = defineProps<{ descriptor: WindowDescriptor }>()

const win = useWindows()
const options = useWindowOptions()
const view = useViewport()
const el = ref<HTMLDialogElement | null>(null)
const handle = ref<HTMLElement | null>(null)
const body = ref<HTMLElement | null>(null)
const d = props.descriptor

/** Below the breakpoint a floating window is unusable: fullscreen, no drag or resize. */
const mobile = computed(() => view.w < options.mobileBreakpoint)
const interactive = () => !mobile.value
const canDrag = () => interactive() && d.draggable
const canResize = computed(() => interactive() && d.resizable)
const active = computed(() => win.activeId.value === d.id)

provideWindowContext(d)
useWindowDrag(handle, d, {
  view,
  bounds: options.bounds,
  enabled: canDrag,
  onStart: () => win.focus(d.id),
  snap: options.snap,
  onUndock: (pointerX) => win.undockForDrag(d.id, pointerX),
  onArm: (zone) => win.setPreview(zone, view),
  onDrop: (zone) => win.snap(d.id, zone, view),
})
// Resizing by a grip is an explicit choice of size — it outranks the snap, which is dropped
// without moving the window back.
const resize = useWindowResize(d, {
  enabled: () => canResize.value,
  onStart: () => win.focus(d.id),
  onEnd: () => win.undock(d.id),
})
onMounted(() => el.value?.show()) // non-modal: background stays usable, taskbar clickable

// After the show() hook on purpose: show() runs the dialog focusing steps, so registering this
// first would let the UA overwrite it. A window restored from storage on page load must not steal
// focus, and only the top one takes it.
useWindowFocus(body, {
  fallback: handle,
  shouldFocus: () => active.value && !win.isRestored(d.id),
  closed: () => !win.byId(d.id),
})

// The UA stylesheet gives <dialog> position:absolute; margin:auto; inset:0 —
// all three must be cleared or centering fights the transform.
const style = computed(() => ({
  position: 'fixed' as const,
  margin: '0',
  inset: 'auto',
  left: '0',
  top: '0',
  padding: '0',
  display: 'flex',
  flexDirection: 'column' as const,
  overflow: 'hidden',
  boxSizing: 'border-box' as const,
  zIndex: String(options.zIndexBase + d.z),
  width: mobile.value ? '100vw' : `${d.w}px`,
  height: mobile.value ? '100dvh' : `${d.h}px`,
  transform: mobile.value ? 'none' : `translate(${d.x}px, ${d.y}px)`,
  maxWidth: '100vw',
  maxHeight: '100dvh',
}))

const headStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flex: '0 0 auto',
  touchAction: 'none',
  userSelect: 'none',
} as const

// The three rows the frame is made of: header and footer are intrinsic and never shrink, the body
// takes the rest and is the only part that scrolls. `minHeight: 0` is what lets it shrink below its
// content when the user resizes the frame down, instead of pushing the footer out of the window.
const bodyStyle = { flex: '1 1 auto', minHeight: '0', overflow: 'auto' } as const
const footStyle = { flex: '0 0 auto' } as const

function handleStyle(dir: (typeof RESIZE_DIRS)[number]) {
  return { position: 'absolute' as const, touchAction: 'none', ...RESIZE_STYLES[dir] }
}

/**
 * A native picker owns ESC: the popup closes and the window must stay. Chromium does *not* mark
 * that keydown `defaultPrevented`, measured rather than assumed, so the escape hatch below cannot
 * cover it. Nothing exposes whether a picker's popup is open either, which makes the element type
 * the only guard available: ESC on a focused picker never minimizes, popup open or not.
 */
const PICKERS = ['date', 'datetime-local', 'month', 'time', 'week', 'color', 'file']

function ownsEscape(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  if (el.tagName === 'SELECT') return true
  return el.tagName === 'INPUT' && PICKERS.includes((el as HTMLInputElement).type)
}

/**
 * A non-modal <dialog> gets no close request from the UA — its `cancel` event and ESC-to-close are
 * `showModal()` behaviour — so ESC is a plain keydown listener on the window element. It stands
 * down for content that took the key first, for a window that is not the active one (Tab can reach
 * a background window without raising it), and for a native picker.
 */
function onEscape(e: KeyboardEvent) {
  if (e.defaultPrevented || !active.value || !d.minimizable || ownsEscape(e.target)) return
  e.preventDefault()
  win.minimize(d.id)
}

/**
 * One bad window must not take the desktop with it: an error thrown by the content is caught here,
 * at the frame that owns it, and the body renders the type's `errorComponent` instead — the same
 * one `defineAsyncComponent` uses when the loader itself fails, so both failures look alike. The
 * frame keeps its header, so the window can still be moved, minimized and closed.
 *
 * Propagation is stopped: an error left to travel up reaches `WindowHost` mid-patch and takes the
 * whole `v-for` — every other window — down with it, which is the failure this exists to prevent.
 * The error is not lost, it is handed to `errorComponent` as its `error` prop; a consumer that
 * wants it centrally reports it from there.
 */
const failure = ref<unknown>(null)
const errorComponent = computed(() => options.errorComponentFor(d.name))

onErrorCaptured((err) => {
  failure.value = err
  return false
})

function onKeydown(e: KeyboardEvent) {
  onWindowKeydown(e, d, { view, bounds: options.bounds, enabled: interactive })
}

/** Double-click on the title bar toggles maximize, as it does on Windows. */
function onHeadDblclick(e: MouseEvent) {
  if (!options.snap.enabled || !canDrag()) return
  if ((e.target as Element | null)?.closest('[data-vw-nodrag]')) return
  win.snap(d.id, win.dockZone(d.id) === 'max' ? 'none' : 'max', view)
}
</script>

<template>
  <dialog
    ref="el"
    class="vw"
    :style="style"
    :aria-label="d.title || undefined"
    :data-vw-active="active || undefined"
    :data-vw-error="failure ? '' : undefined"
    @keydown.escape="onEscape"
    @pointerdown="win.focus(d.id)"
  >
    <header
      ref="handle"
      class="vw__head"
      :style="{ ...headStyle, cursor: canDrag() ? 'move' : 'default' }"
      tabindex="0"
      @keydown="onKeydown"
      @dblclick="onHeadDblclick"
    >
      <slot
        name="header"
        :descriptor="d"
      >
        <span
          class="vw__title"
          style="flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
        >
          {{ d.title }}
        </span>
      </slot>
      <slot
        name="controls"
        :descriptor="d"
      >
        <button
          v-if="d.minimizable"
          class="vw__btn"
          type="button"
          data-vw-nodrag
          @click="win.minimize(d.id)"
        >
          –
        </button>
        <button
          v-if="d.closable"
          class="vw__btn"
          type="button"
          data-vw-nodrag
          @click="win.requestClose(d.id)"
        >
          ✕
        </button>
      </slot>
    </header>
    <section
      ref="body"
      class="vw__body"
      :style="bodyStyle"
    >
      <component
        :is="errorComponent"
        v-if="failure && errorComponent"
        :error="failure"
      />
      <slot v-else-if="!failure" />
    </section>
    <footer
      v-if="$slots.footer"
      class="vw__foot"
      :style="footStyle"
    >
      <slot
        name="footer"
        :descriptor="d"
      />
    </footer>
    <div
      v-for="dir in canResize ? RESIZE_DIRS : []"
      :key="dir"
      class="vw__grip"
      :style="handleStyle(dir)"
      :data-vw-grip="dir"
      aria-hidden="true"
      @pointerdown="resize.onDown($event, dir)"
      @pointermove="resize.onMove"
      @pointerup="resize.onUp"
      @pointercancel="resize.onUp"
    />
  </dialog>
</template>
