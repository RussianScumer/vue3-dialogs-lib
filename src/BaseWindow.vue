<script lang="ts">
import type { ResolvedOptions } from './types'

/**
 * The apps already warned about unnamed controls, keyed on the resolved options object so one
 * desktop warns once however many windows it opens while two independent `createWindows()` calls
 * each get their own warning. Weak, so a torn-down app is not kept alive by its own warning.
 *
 * In a plain `<script>` on purpose: everything in `<script setup>` runs per component instance, so
 * a set declared there would be one set per frame and would never dedupe anything.
 */
const warnedApps = new WeakSet<ResolvedOptions>()
</script>

<script setup lang="ts">
import { computed, onErrorCaptured, onMounted, ref, useSlots, watch } from 'vue'
import { useWindows, useWindowOptions } from './createWindows'
import { onWindowKeydown, useWindowDrag } from './useWindowDrag'
import { RESIZE_DIRS, RESIZE_STYLES, useWindowResize } from './useWindowResize'
import { useWindowFocus } from './useWindowFocus'
import { provideWindowContext } from './useWindowContext'
import { useViewport } from './useViewport'
import type { WindowDescriptor, WindowVisualState } from './types'

const props = defineProps<{
  descriptor: WindowDescriptor
  /** Driven by `WindowHost`; a frame mounted by hand is simply always `open`. */
  state?: WindowVisualState
}>()

const win = useWindows()
const options = useWindowOptions()
const view = useViewport()
const el = ref<HTMLDialogElement | null>(null)
const handle = ref<HTMLElement | null>(null)
const body = ref<HTMLElement | null>(null)
const d = props.descriptor

/** Below the breakpoint a floating window is unusable: fullscreen, no drag or resize. */
const mobile = computed(() => view.w < options.mobileBreakpoint)
/** Pinned above every other window, and inert to geometry for as long as it is. */
const pinned = computed(() => win.isPinned(d.id))
/**
 * The one notion of "this frame answers to input that moves it". Drag, resize, the header's arrow
 * keys and the maximize double-click all read it, so a window can never be half inert.
 */
const interactive = () => !mobile.value && !leaving.value && !pinned.value
const canDrag = () => interactive() && d.draggable
const canResize = computed(() => interactive() && d.resizable)
const active = computed(() => win.activeId.value === d.id)
/**
 * A `requestClose` is out with the guards. The default controls stand down until it settles: a
 * second ✕ only joins the same request, but minimize would unmount the content — and with it the
 * very guard that is still being awaited.
 */
const closing = computed(() => win.isClosing(d.id))
/**
 * Accessible names for the default controls: the app-wide option with this window's own laid over
 * it. Nothing has a default, so an unnamed control renders no `aria-label` attribute at all rather
 * than an empty one — the DOM of a consumer who names none is exactly what it was.
 */
const labels = computed(() => win.labelsFor(d.id))
/** True for a sheet: a window opened with `{ owner }`, which ESC dismisses instead of minimizing. */
const owned = computed(() => win.ownerOf(d.id) !== null)
/** True while this window owns a child. The child is the question; this frame stands down. */
const blocked = computed(() => win.hasChild(d.id))
const visual = computed<WindowVisualState>(() => props.state ?? 'open')
/** Retained for the animation only: the store has already let go, so nothing here may be clicked. */
const leaving = computed(() => visual.value === 'leaving')

/**
 * Hands a gesture's result back to the store so `on('geometry')` fires for it. The descriptor is
 * already where the gesture left it — this is the report, not the move. Guarded because a window
 * can be closed mid-gesture: the pointerup still arrives, and `setGeometry` would throw on an id
 * the store has forgotten.
 */
function report(geom: Partial<Pick<WindowDescriptor, 'x' | 'y' | 'w' | 'h'>>) {
  if (win.byId(d.id)) win.setGeometry(d.id, geom)
}

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
  // The pointer writes x/y straight onto the descriptor, frame by frame; the store hears about it
  // once, when the gesture ends. `setGeometry` re-clamps and emits `geometry`, so a listener sees
  // one event per move whichever path moved the window.
  onEnd: () => report({ x: d.x, y: d.y }),
})
// Resizing by a grip is an explicit choice of size — it outranks the snap, which is dropped
// without moving the window back.
const resize = useWindowResize(d, {
  view,
  bounds: options.bounds,
  enabled: () => canResize.value,
  onStart: () => win.focus(d.id),
  onEnd: () => {
    win.undock(d.id)
    report({ w: d.w, h: d.h })
  },
})
const slots = useSlots()

/**
 * True when this frame renders a default control that has no name. Only the controls it actually
 * renders count, and a consumer who replaced the `controls` slot renders their own buttons, which
 * are not the library's to label.
 */
function unnamedControls(): boolean {
  if (slots.controls) return false
  if (d.minimizable && !labels.value.minimize) return true
  if (d.closable && !labels.value.close) return true
  return win.isPinnable(d.id) && !labels.value.pin
}

onMounted(() => {
  el.value?.show() // non-modal: background stays usable, taskbar clickable
  // Dev-only, and the one place the library says anything in English: the default controls are
  // glyphs, so without a name they reach a screen reader as "–", "✕" and "▲".
  if (!import.meta.env.DEV || warnedApps.has(options) || !unnamedControls()) return
  warnedApps.add(options)
  console.warn(
    '[vue3-dialogs-lib] the default window controls have no accessible name. Pass labels: ' +
      '{ minimize, close, pin } to createWindows(), per window via open(), or replace the ' +
      'controls slot.',
  )
})

/**
 * A child window makes its owner inert — the owner's own `<dialog>` and nothing else. No top layer,
 * no page-wide backdrop, no focus trap: a sibling window stays completely interactive, drag
 * included, which is the whole difference between this and `showModal()`.
 *
 * Whatever `inert` was there before is recorded and handed back, so a consumer who set it
 * themselves keeps it, and an owner that is itself somebody's child is not un-inerted by its own
 * child going away.
 *
 * Written by hand rather than bound in the template for that recording, and flushed `sync` for the
 * focus chain: closing a child hands focus back to this header, and a real UA refuses to focus
 * anything inside an inert subtree — so the attribute has to be gone by then, not next tick.
 */
let priorInert: boolean | null = null

watch(
  () => blocked.value && !!el.value,
  (on) => {
    const node = el.value
    if (!node) return
    if (on) {
      priorInert ??= node.hasAttribute('inert')
      node.setAttribute('inert', '')
    } else if (priorInert !== null) {
      if (!priorInert) node.removeAttribute('inert')
      priorInert = null
    }
  },
  { flush: 'sync' },
)

// After the show() hook on purpose: show() runs the dialog focusing steps, so registering this
// first would let the UA overwrite it. A window restored from storage on page load must not steal
// focus, and only the top one takes it.
useWindowFocus(
  win,
  d,
  { root: el, head: handle, body },
  () => active.value && !win.isRestored(d.id),
)

/**
 * Where a minimizing window is headed, as the offset from its own centre to the centre of its
 * taskbar button plus the scale that would fit it there. Only a consumer who called
 * `setTaskbarRect` gets these; without them the baseline sheet falls back to a plain fade, and a
 * *closing* window never gets them at all — it has no button to fly to.
 *
 * Custom properties rather than a transform, because the frame's own `transform` is its position:
 * the sheet animates the separate `translate`/`scale` properties, which compose with it instead of
 * overwriting it.
 */
const minTo = computed(() => {
  if (!leaving.value || !d.minimized) return null
  const r = win.taskbarRect(d.id)
  if (!r) return null
  const w = mobile.value ? view.w : d.w
  const cx = mobile.value ? view.w / 2 : d.x + d.w / 2
  const cy = mobile.value ? view.h / 2 : d.y + d.h / 2
  return {
    '--vtd-min-x': `${Math.round(r.x + r.w / 2 - cx)}px`,
    '--vtd-min-y': `${Math.round(r.y + r.h / 2 - cy)}px`,
    '--vtd-min-scale': w > 0 ? String(Math.round((r.w / w) * 1000) / 1000) : '0',
  }
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
  // Two bands. `d.z` is always positive, so `topZ + d.z` puts every pinned window above every
  // unpinned one while pinned windows keep their own relative order. Nothing persisted moves:
  // `focus()` and `activeId` still see one stack.
  zIndex: String(options.zIndexBase + (pinned.value ? win.s.topZ : 0) + d.z),
  width: mobile.value ? '100vw' : `${d.w}px`,
  height: mobile.value ? '100dvh' : `${d.h}px`,
  transform: mobile.value ? 'none' : `translate(${d.x}px, ${d.y}px)`,
  maxWidth: '100vw',
  maxHeight: '100dvh',
  pointerEvents: leaving.value ? ('none' as const) : undefined,
  ...minTo.value,
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
  if (e.defaultPrevented || !active.value || ownsEscape(e.target)) return
  // A sheet is dismissed by ESC rather than minimized — it is not minimizable, and dismissing is
  // what the key means over a question. It goes through `requestClose`, so a child with a guard of
  // its own is still asked. An inert owner never gets here: the UA does not deliver the event.
  if (owned.value) {
    e.preventDefault()
    void win.requestClose(d.id)
    return
  }
  if (!d.minimizable) return
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
  onWindowKeydown(e, d, {
    view,
    bounds: options.bounds,
    enabled: interactive,
    onChange: () => report({ x: d.x, y: d.y, w: d.w, h: d.h }),
  })
}

/**
 * Clicking a window raises it *and* takes focus, so the window on top is the window the keyboard
 * is talking to. They used to be allowed to disagree: the drag handle calls `preventDefault()` on
 * pointerdown, which suppresses the focus change, so clicking a header raised a window while focus
 * stayed behind in the last one — and ESC, typing and the keymap all went to the wrong place.
 *
 * Only when focus is not already inside this window, so a click on a field in the focused window
 * does not bounce focus up to the header. On a fresh click the header takes it first and the UA's
 * own focus-on-mousedown then lands on whatever focusable element was clicked, so clicking a field
 * still focuses the field.
 */
function onPointerdown() {
  // Raising a leaving window would ask the store about an id it has already forgotten.
  if (leaving.value) return
  win.focus(d.id)
  if (!el.value?.contains(document.activeElement)) handle.value?.focus()
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
    :data-vw-state="visual"
    @keydown.escape="onEscape"
    @pointerdown="onPointerdown"
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
          :aria-label="labels.minimize"
          :disabled="closing"
          @click="win.minimize(d.id)"
        >
          –
        </button>
        <button
          v-if="d.closable"
          class="vw__btn"
          type="button"
          data-vw-nodrag
          :aria-label="labels.close"
          :disabled="closing"
          @click="win.requestClose(d.id)"
        >
          ✕
        </button>
        <!-- After the close button on purpose: the control order is part of the public surface,
             and appending is what keeps a positional `.vw__btn` index meaning what it did. -->
        <button
          v-if="win.isPinnable(d.id)"
          class="vw__btn"
          type="button"
          data-vw-nodrag
          :aria-label="labels.pin"
          :aria-pressed="pinned"
          :data-vw-pinned="pinned || undefined"
          @click="win.setPinned(d.id, !pinned)"
        >
          ▲
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
