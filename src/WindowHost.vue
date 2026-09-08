<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  reactive,
  watch,
  type ComponentPublicInstance,
} from 'vue'
import BaseWindow from './BaseWindow.vue'
import { useWindows, useWindowOptions } from './createWindows'
import { useViewport } from './useViewport'
import type { WindowDescriptor, WindowVisualState } from './types'

const win = useWindows()
const options = useWindowOptions()
const view = useViewport()
const visible = win.visible
/** Armed snap target of the drag in progress; drawn as a ghost above every window. */
const preview = win.preview

// A shrinking viewport must not strand a window off-screen; snapped windows follow it instead.
watch(() => [view.w, view.h], () => win.clampAll(view), { immediate: true })

/**
 * The leaving lifecycle. The store stays the truth — `close()` and `minimize()` are synchronous
 * there and the descriptor is gone (or minimized) the instant they return — and the host is simply
 * slower to let go of the frame, so a stylesheet has time to animate it out.
 *
 * A frame therefore outlives its window, which is the one dangerous thing about this: a frame that
 * never retires is a leak that looks like a working animation. Three things prevent it — the
 * retention is capped whatever the stylesheet says, `close()` of an already-leaving window retires
 * it at once, and unmounting the host retires everything.
 */
const MAX_LEAVING_MS = 1000

interface Frame {
  /** The descriptor object, still referenced here after the store has dropped it. */
  d: WindowDescriptor
  state: WindowVisualState
}

/** Insertion-ordered on purpose: a window that starts leaving must not move in the DOM. */
const frames = reactive(new Map<string, Frame>())
const rendered = computed(() => [...frames.values()])

const els = new Map<string, HTMLElement>()
const binders = new Map<string, (c: Element | ComponentPublicInstance | null) => void>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * One stable ref callback per id. Stable because Vue re-runs a ref whose identity changed, and an
 * inline arrow would be a new function on every render of the whole desktop.
 */
function frameRef(id: string) {
  let bind = binders.get(id)
  if (!bind) {
    bind = (c) => {
      const node = c && '$el' in c ? (c.$el as unknown) : c
      if (node instanceof HTMLElement) els.set(id, node)
      else els.delete(id)
    }
    binders.set(id, bind)
  }
  return bind
}

/**
 * How long to keep a leaving frame, read off the window element itself so that a consumer override,
 * a media query and `prefers-reduced-motion` all work through the one property they already set.
 * Unreadable — no stylesheet imported, or no DOM at all — means `0ms`, and a window that leaves in
 * the same tick as before this file learned to wait.
 */
function durationOf(id: string): number {
  const el = els.get(id)
  if (!el || typeof getComputedStyle !== 'function') return 0
  const raw = getComputedStyle(el).getPropertyValue('--vtd-motion-duration').trim()
  const n = Number.parseFloat(raw)
  if (!Number.isFinite(n) || n <= 0) return 0
  // A bare number is not a valid <time>, but treating it as ms beats retaining the frame for
  // 300 seconds because someone wrote `300`.
  return raw.endsWith('ms') || !raw.endsWith('s') ? n : n * 1000
}

function retire(id: string): void {
  const timer = timers.get(id)
  if (timer !== undefined) clearTimeout(timer)
  timers.delete(id)
  frames.delete(id)
  els.delete(id)
  binders.delete(id)
}

function depart(id: string, f: Frame): void {
  const ms = Math.min(durationOf(id), MAX_LEAVING_MS)
  if (ms <= 0) return retire(id)
  f.state = 'leaving'
  timers.set(id, setTimeout(() => retire(id), ms))
}

/**
 * Releases an arriving frame from `entering` on the next animation frame, which is what gives the
 * stylesheet a painted state to transition out of.
 *
 * A hidden tab is the case that has to be special: it paints nothing and delivers no animation
 * frame at all — measured, not assumed — so waiting for one there leaves the window sitting at
 * whatever `entering` looks like, which in the baseline sheet is invisible, until the tab is looked
 * at again. With nothing to animate, the frame is released immediately instead.
 */
function settle(id: string): void {
  const run = () => {
    const f = frames.get(id)
    if (f?.state === 'entering') f.state = 'open'
  }
  const painting = typeof document !== 'undefined' && !document.hidden
  if (painting && typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
  else run()
}

// `pre` (the default) on purpose: the arrival is marked `entering` before the frame is first
// rendered, so the state the stylesheet animates out of is the state it is painted in.
watch(
  visible,
  (list) => {
    const now = new Map(list.map((w) => [w.id, w]))

    for (const [id, d] of now) {
      const f = frames.get(id)
      if (!f) {
        frames.set(id, { d, state: 'entering' })
        settle(id)
      } else if (f.state === 'leaving') {
        // Restored mid-flight: the same frame is adopted back rather than duplicated.
        const timer = timers.get(id)
        if (timer !== undefined) clearTimeout(timer)
        timers.delete(id)
        f.d = d
        f.state = 'open'
      }
    }

    for (const [id, f] of frames) if (!now.has(id) && f.state !== 'leaving') depart(id, f)
  },
  { immediate: true },
)

// A window closed while it was already leaving — minimized, then closed from the taskbar — has no
// second animation to wait for, and nothing left in the store to belong to.
const offClose = win.on('close', (e) => {
  if (frames.get(e.id)?.state === 'leaving') retire(e.id)
})

onBeforeUnmount(() => {
  offClose()
  for (const id of [...frames.keys()]) retire(id)
})

const ghostStyle = computed(() => {
  const p = preview.value
  if (!p) return undefined
  return {
    position: 'fixed' as const,
    left: '0',
    top: '0',
    width: `${p.w}px`,
    height: `${p.h}px`,
    transform: `translate(${p.x}px, ${p.y}px)`,
    // The pinned band tops out at `zIndexBase + topZ + d.z` and `d.z` never exceeds `topZ`, so
    // doubling the counter clears every window, pinned or not, whatever the base is.
    zIndex: String(options.zIndexBase + 2 * win.s.topZ + 1),
    pointerEvents: 'none' as const,
    boxSizing: 'border-box' as const,
  }
})
</script>

<template>
  <BaseWindow
    v-for="f in rendered"
    :key="f.d.id"
    :ref="frameRef(f.d.id)"
    :descriptor="f.d"
    :state="f.state"
  >
    <template
      v-if="$slots.header"
      #header="slotProps"
    >
      <slot
        name="header"
        v-bind="slotProps"
      />
    </template>
    <template
      v-if="$slots.controls"
      #controls="slotProps"
    >
      <slot
        name="controls"
        v-bind="slotProps"
      />
    </template>
    <template
      v-if="$slots.footer"
      #footer="slotProps"
    >
      <slot
        name="footer"
        v-bind="slotProps"
      />
    </template>
    <!-- A minimized window's content is unmounted the moment it is minimized — the frame is what
         lingers for the animation, never the content. A closing window keeps its content, because a
         window that fades out empty reads as a bug. -->
    <component
      :is="options.resolve(f.d.name)"
      v-if="!f.d.minimized"
      v-bind="f.d.props"
      :window-id="f.d.id"
    />
  </BaseWindow>

  <div
    v-if="preview"
    class="vw-ghost"
    :style="ghostStyle"
    aria-hidden="true"
    :data-vw-zone="preview.zone"
  />
</template>
