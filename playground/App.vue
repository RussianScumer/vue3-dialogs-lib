<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { WindowHost, WindowTaskbar, useWindows, useWindowOptions } from '../src'
import { components } from './components'
import { log, useEventLog } from './eventLog'
import ThemeControls from './ThemeControls.vue'

// Typed against the real components map, so `open()` checks the props it is given and types what
// the window settles with — `itemEditor` declares a `SavedItem`, everything else is `unknown`.
const win = useWindows<typeof components>()
const options = useWindowOptions()
const events = useEventLog()

let nextItem = 1
const stack = computed(() => win.s.stack)

// Every store transition, straight into the log. Titles are kept alongside because a `close`
// event arrives after the descriptor has already left the stack.
const titles = new Map<string, string>()
win.on('*', (e) => {
  const w = win.byId(e.id)
  if (w) titles.set(e.id, w.title || w.name)
  log(`${e.type} · ${titles.get(e.id) ?? e.id.slice(0, 8)}`)
  if (e.type === 'close') titles.delete(e.id)
})

/**
 * The result path, in the shape a consumer writes it: open the window and await what it settled
 * with. `open()` returns `{ id, result }`, so there is no `on('close')` plus a side channel here —
 * and the promise settles whatever happens to the window, including a `closeAll()` from case 5.
 */
async function openItem() {
  const id = nextItem++
  const saved = await win.open('itemEditor', { id }, { title: `Item ${id}`, w: 420, h: 360 }).result
  if (saved.ok) log(`Item ${id} resolved: ${saved.data.name} (${saved.data.note.length} chars of note)`)
  else log(`Item ${id} settled without a value: ${saved.reason}`)
}

async function openSameItem() {
  log("open('itemEditor', { id: 1 }) again — should dedupe")
  // The deduped caller joins the window that is already open — and its answer with it, so both
  // callers hear the same `resolve()`.
  const saved = await win.open('itemEditor', { id: 1 }, { title: 'Item 1', w: 420, h: 360 }).result
  log(`the deduped caller heard: ${saved.ok ? `saved ${saved.data.name}` : saved.reason}`)
}

function openLog(source: string) {
  win.open('logViewer', { source }, { w: 380, h: 300 })
}

/** No options at all: the size and limits come from the component's spec in main.ts. */
function openLogWithSpecDefaults() {
  const id = win.open('logViewer', { source: 'defaults' }).id
  const w = win.byId(id)!
  log(`spec defaults applied: ${w.w}×${w.h}, min ${w.minW}×${w.minH}, maxH ${w.maxH}`)
}

/**
 * Nothing in the header, nothing to grab: only a programmatic close can get rid of it. The id is
 * kept because every window here sets its own title from its content, so titles are not handles.
 * Named "locked" rather than "fixed" because `fixed` is case 20's option, and it means the other
 * thing entirely — always on top, and still closable.
 */
const lockedPanelId = ref<string | null>(null)

function openLockedPanel() {
  lockedPanelId.value = win.open(
    'logViewer',
    { source: 'locked' },
    { x: 120, y: 120, w: 380, h: 300, closable: false, minimizable: false, draggable: false, resizable: false },
  ).id
}

function closeLockedPanel() {
  if (lockedPanelId.value) win.close(lockedPanelId.value) // close() ignores both the flag and any guard
  lockedPanelId.value = null
}

/**
 * Always on top: `fixed` is not a descriptor flag, so it neither persists nor is it a lock — the
 * window keeps its ✕ and its –, and the pin button in its own header lets the user let go of it.
 */
function openPinnedPanel() {
  win.open(
    'logViewer',
    { source: 'pinned' },
    // Per-window labels merge over the app-wide ones: this window renames only its ✕.
    { x: 260, y: 60, w: 380, h: 240, fixed: true, labels: { close: 'Close the pinned log' } },
  )
}

/**
 * A desktop-scoped question. `{ preset: 'dialog' }` is the whole call: the preset in main.ts is
 * `modal: true` plus a centred 420×260 frame with no drag and no grips, so the shape lives in one
 * place rather than at every call site.
 */
async function openModal() {
  const answer = await win.open(
    'modalDialog',
    { message: 'Delete the selected items?' },
    // The title is the dialog's accessible name, so a modal wants one even though the preset
    // carries everything else about its shape.
    { preset: 'dialog', title: 'Delete items' },
  ).result
  log(`the modal settled: ${answer.ok ? String(answer.data) : answer.reason}`)
}

/** Two at once: stacked modals dim each other, and only the top one answers. */
function openTwoModals() {
  void win.open(
    'modalDialog',
    { message: 'The first question' },
    { preset: 'dialog', dedupe: false, title: 'First question' },
  )
  void win.open(
    'modalDialog',
    { message: 'The second question, asked over the first' },
    { preset: 'dialog', dedupe: false, title: 'Second question', x: 200, y: 160 },
  )
}

function openConstrained() {
  win.open(
    'itemEditor',
    { id: nextItem++ },
    { title: 'Between 320×240 and 560×420', w: 400, h: 300, minW: 320, minH: 240, maxW: 560, maxH: 420 },
  )
}

function openPopper() {
  win.open('popperDemo', {}, { w: 420, h: 280 })
}

/** Content far taller than the frame, to show the body scrolling under a pinned header and footer. */
function openLongDoc() {
  win.open('longDoc', {}, { w: 460, h: 320 })
}

/** Three ways a window's component can fail to be there: slow, never, and throwing. */
function openSlowPanel() {
  win.open('slowPanel', {}, { title: 'Slow chunk' })
}

function openHungPanel() {
  win.open('hungPanel', {}, { title: 'Never arrives' })
}

function openBrokenPanel() {
  win.open('brokenPanel', {}, { title: 'Throws on mount' })
}

function floodMaxWindows() {
  log(`opening ${options.maxWindows + 2} windows against maxWindows=${options.maxWindows}`)
  for (let i = 0; i < options.maxWindows + 2; i++) win.open('logViewer', { source: `flood-${i}` }, { w: 300, h: 200 })
}

function snapTwo() {
  const view = { w: window.innerWidth, h: window.innerHeight }
  const a = win.open('itemEditor', { id: nextItem++ }, { title: 'Left' }).id
  const b = win.open('logViewer', { source: 'snap' }, { title: 'Right' }).id
  win.snap(a, 'left', view)
  win.snap(b, 'right', view)
  log('snapped two windows to the left and right halves')
}

function unsnapAll() {
  const view = { w: window.innerWidth, h: window.innerHeight }
  for (const w of win.s.stack) win.snap(w.id, 'none', view)
  log('unsnapped every window')
}

/**
 * Placement is the third level of the same precedence chain as everything else: `open()` over the
 * preset over the component's spec. `center` reads the live viewport; an explicit `x` or `y` still
 * wins, one axis at a time.
 */
function openCentered() {
  win.open('logViewer', { source: 'centered' }, { placement: 'center', title: 'Centred' })
}

/** The default: `40 + (index % 8) * 28`, so three in a row step down the desktop. */
function openCascade() {
  for (let i = 0; i < 3; i++) {
    win.open('logViewer', { source: `cascade-${i}` }, { title: `Cascade ${i + 1}`, dedupe: false })
  }
}

/** `center` with one axis pinned: the window is centred horizontally and sits at y = 80. */
function openHalfPlaced() {
  win.open('logViewer', { source: 'half-placed' }, { placement: 'center', y: 80, title: 'Centred, y pinned' })
}

/**
 * The mutation API against whatever is active. Each of these writes the descriptor, so the change
 * survives a minimize and a reload — and `setTitle` and `setGeometry` show up in the log, because
 * both emit. `updateProps` re-renders the content in place without remounting the frame.
 */
function mutateActive() {
  const id = win.activeId.value
  if (!id) return log('nothing active to mutate')
  const w = win.byId(id)!
  win.setTitle(id, `${w.name} · renamed`)
  win.setGeometry(id, { w: w.w + 40, h: w.h + 20 })
  win.setMeta(id, { ...w.meta, touchedAt: Date.now() })
  if (w.name === 'logViewer') win.updateProps(id, { source: `mutated-${Math.round(Math.random() * 99)}` })
  log(`mutated: title, geometry, meta${w.name === 'logViewer' ? ' and props' : ''} — no remount`)
}

/** A second tab on the same persist key: whichever tab does not write last stands down. */
function openSecondTab() {
  const tab = window.open(location.href, '_blank')
  if (tab) log('opened a second tab on the same key — move a window there, then watch this one stand down')
  else log('the browser blocked the popup — open this URL in a second tab by hand instead')
}

/**
 * The motion duration is one property on <html>, and the host reads it back off the window element
 * — so this slider changes both the animation and how long the frame is retained, with no second
 * API. `null` removes it and the baseline sheet's own 180ms comes back.
 */
const motionMs = ref<number | null>(null)

watchEffect(() => {
  const root = document.documentElement.style
  if (motionMs.value === null) root.removeProperty('--vtd-motion-duration')
  else root.setProperty('--vtd-motion-duration', `${motionMs.value}ms`)
})

function reload() {
  location.reload()
}

/**
 * A restored descriptor has no live opener — the `open()` that made it belongs to a previous page
 * load — so its result is settled `restored` before anything can await it.
 */
function askRestoredResults() {
  const all = win.s.stack
  if (!all.length) return log('no windows open')
  for (const w of all) {
    void win.resultOf(w.id).then((r) => {
      log(`resultOf(${w.title || w.name}) → ${r.ok ? 'ok' : r.reason}`)
    })
  }
}

/** The band BaseWindow renders in, mirrored here so the stack table shows the real z-index. */
function bandOf(id: string): number {
  if (win.topModalId() !== null && !win.isBlockedByModal(id)) return 3
  return win.isPinned(id) ? 1 : 0
}

function clearStorage() {
  localStorage.removeItem('playground:windows')
  log('storage cleared — reload to see an empty desktop')
}
</script>

<template>
  <!-- Everything the desktop floats over, in one element — which is what `modal.inertRoot` in
       main.ts points at. It must not contain WindowHost: `inert` covers a subtree, so an ancestor
       of the windows would make the modal itself unclickable. -->
  <div class="desktop">
    <header class="topbar">
      Fixed page header · <code>z-index: 100</code> — windows sit above it because
      <code>zIndexBase: {{ options.zIndexBase }}</code>
    </header>

    <main class="page">
      <h1>@korneevecin/vue3-dialogs-lib playground</h1>
      <p class="lede">
        Every case below is a claim the library makes. The log on the right records what happened.
      </p>

      <div class="cols">
        <div class="cases">
          <section>
            <h2>1 · Open, minimize, restore</h2>
            <p>Windows are non-modal: several at once, the page behind stays usable.</p>
            <button
              type="button"
              @click="openItem"
            >
              Open item editor
            </button>
            <button
              type="button"
              @click="openLog('app')"
            >
              Open log viewer
            </button>
            <button
              type="button"
              @click="openPopper"
            >
              Open poppers window
            </button>
          </section>

          <section>
            <h2>2 · Minimized costs nothing</h2>
            <p>
              Content is unmounted, not hidden. Live mounts:
              <code>{{ events.mounts }}</code>
            </p>
            <button
              type="button"
              @click="openLog('ticker')"
            >
              Open ticking log
            </button>
            <button
              type="button"
              @click="win.s.stack.forEach((w) => win.minimize(w.id))"
            >
              Minimize all
            </button>
          </section>

          <section>
            <h2>3 · Draft state survives</h2>
            <p>Type into an item editor, minimize, restore. Then reload the page — the draft and layout come back.</p>
            <button
              type="button"
              @click="openItem"
            >
              Open item editor
            </button>
            <button
              type="button"
              @click="reload"
            >
              Reload page
            </button>
            <button
              type="button"
              @click="clearStorage"
            >
              Clear storage
            </button>
          </section>

          <section>
            <h2>4 · One window per entity</h2>
            <p>Same <code>name</code> + shallow-equal <code>props</code> restores and raises instead of duplicating.</p>
            <button
              type="button"
              @click="openSameItem"
            >
              open(itemEditor, id: 1) twice
            </button>
          </section>

          <section>
            <h2>5 · maxWindows evicts the oldest</h2>
            <p>Limit is {{ options.maxWindows }}; opening past it closes the oldest window.</p>
            <button
              type="button"
              @click="floodMaxWindows"
            >
              Flood
            </button>
            <button
              type="button"
              @click="win.closeAll()"
            >
              Close all
            </button>
          </section>

          <section>
            <h2>6 · Drag, resize, keyboard, z-order</h2>
            <p>
              Drag the header, click to raise, and resize from any of the eight grips — the west and north edges move
              <code>x</code>/<code>y</code> as they go, so the opposite edge stays put. Focus a header and use arrow keys
              to move it, shift+arrow to resize; both honour the same limits as the pointer. ESC minimizes the focused
              window. Opening a window moves focus into it, and closing one gives focus back to the button that opened
              it.
            </p>
          </section>

          <section>
            <h2>7 · Snap a window to an edge</h2>
            <p>
              Drag a header against the left or right edge for a half, into a corner for a quarter, or against the top to
              maximize — a ghost shows the drop first. Double-click a header to toggle maximize. Drag a snapped window
              away and it gets its old size back under the cursor; resize it by the corner and it stops being snapped.
              Snapping keeps clear of the taskbar (<code>snap.insets.bottom</code>), and snapped windows follow the
              viewport when you resize the browser.
            </p>
            <p>
              From anywhere inside a window: <kbd>Meta</kbd>+arrow snaps left, right, maximized or back to the pre-snap
              geometry, <kbd>Meta</kbd>+<kbd>Shift</kbd>+arrow takes the four quarters clockwise from the top-left, and
              <kbd>Alt</kbd>+<kbd>`</kbd> cycles focus between windows (<kbd>Shift</kbd> reverses it). Inside a text
              field the keystroke belongs to the field.
            </p>
            <p>
              Your desktop has almost certainly taken those already — Windows snapping, GNOME and KDE tiling, GNOME's
              switch-group — and a grabbed key never reaches the page at all, so each action has a second chord one
              modifier out of the way: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+arrow for the halves and maximize,
              <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>1</kbd>…<kbd>4</kbd> for the quarters in reading order, and
              <kbd>Ctrl</kbd>+<kbd>`</kbd> to cycle. Every binding is movable through <code>keymap.bindings</code>, and
              <code>keymap: { enabled: false }</code> removes them all.
            </p>
            <button
              type="button"
              @click="snapTwo"
            >
              Snap two side by side
            </button>
            <button
              type="button"
              @click="unsnapAll"
            >
              Unsnap all
            </button>
          </section>

          <section>
            <h2>8 · Restyle without fighting specificity</h2>
            <p>
              The whole visual surface is <code>--vtd-*</code> custom properties. Set them anywhere above the windows —
              here they go straight onto <code>&lt;html&gt;</code>. Turn the switch off and the library defaults, dark
              mode included, come back.
            </p>
            <p>
              The theme picker is the shipped palettes: one attribute on <code>&lt;html&gt;</code> swaps every colour at
              once. Watch what does <em>not</em> change — this page. A palette only feeds the <code>--vtd-*</code> the
              windows read, and even <code>color-scheme</code> is scoped to the frame through
              <code>--vtd-color-scheme</code>, so the demo keeps its own background and scrollbars. The taskbar below
              follows along only because it opts in by reading <code>--vtd-head-bg</code> itself, the way any
              consumer-drawn dock would. The knobs below layer on top of whichever palette is picked, because the
              palettes are held at zero specificity.
            </p>
            <p>
              Two of the knobs reach parts of a window you have to go looking for: the scrim behind case 21's modal,
              and the native scrollbars inside a frame — with nothing set those mix <code>currentColor</code>, so they
              already follow whichever palette is picked, and <code>--vtd-scrollbar-*</code> is how a theme overrides
              that. Open a modal, or case 16's long document, with the switch on.
            </p>
            <ThemeControls />
          </section>

          <section>
            <h2>9 · Where a window opens</h2>
            <p>
              With no <code>x</code>/<code>y</code>, <code>placement</code> decides.
              <code>cascade</code> is the default — <code>40 + (index % 8) * 28</code>, so a run of windows steps down
              the desktop — and <code>center</code> reads the live viewport instead. An explicit coordinate still wins,
              one axis at a time: pass <code>y</code> alongside <code>placement: 'center'</code> and the window is
              centred horizontally at the <code>y</code> you gave.
            </p>
            <p>
              <code>placement</code> sits on the same three levels as every other default, with the same precedence:
              <code>open()</code> over the preset over the component's spec. Case 21's <code>dialog</code> preset is
              nothing but that — <code>placement: 'center'</code> bundled with a size and no chrome.
            </p>
            <button
              type="button"
              @click="openCascade"
            >
              Three cascaded
            </button>
            <button
              type="button"
              @click="openCentered"
            >
              Centred
            </button>
            <button
              type="button"
              @click="openHalfPlaced"
            >
              Centred with y pinned
            </button>
          </section>

          <section>
            <h2>10 · Per-window capabilities</h2>
            <p>
              <code>closable</code>, <code>minimizable</code>, <code>draggable</code>, <code>resizable</code> and the
              <code>min</code>/<code>max</code> size live on the descriptor, so they survive a reload with the window.
              The locked panel (<em>Log: locked</em>) has no header buttons, no grips and no drag; <code>close(id)</code>
              still disposes of it, because the flag is an affordance and not a lock. Its options also outrank the
              <code>logViewer</code> spec defaults from case 11.
            </p>
            <button
              type="button"
              @click="openLockedPanel"
            >
              Open locked panel
            </button>
            <button
              type="button"
              @click="closeLockedPanel"
            >
              close(id) the locked panel
            </button>
            <button
              type="button"
              @click="openConstrained"
            >
              Open with size limits
            </button>
          </section>

          <section>
            <h2>11 · Defaults per window type</h2>
            <p>
              <code>logViewer</code> is registered as <code>{{ '{ component, w, h, minW, minH, maxH }' }}</code>, so it
              opens at its own size with its own limits and no options at the call site. Options passed to
              <code>open()</code> still outrank them.
            </p>
            <button
              type="button"
              @click="openLogWithSpecDefaults"
            >
              open('logViewer') with no options
            </button>
          </section>

          <section>
            <h2>12 · Refusing to close</h2>
            <p>
              Type into an item editor's <em>Name</em> and its own guard takes over the ✕: it is <em>async</em>, so it
              spends 600ms pretending to check for unsaved changes and then asks in an owned child window (case 18).
              While it
              is out the window is <code>closing</code> — its controls, the footer buttons and the taskbar ✕ all stand
              down, and a second click joins the same request instead of asking twice. That guard is registered by the
              content, so minimizing the window unmounts it along with everything else. A minimized window is covered
              only by the app-wide <code>beforeClose</code>, which is why closing a minimized dirty draft from the
              taskbar is refused too. <code>close()</code>, <code>closeAll()</code> and <code>maxWindows</code> eviction
              never consult either, pending guard or not.
            </p>
            <button
              type="button"
              @click="openItem"
            >
              Open item editor
            </button>
            <button
              type="button"
              @click="win.closeAll()"
            >
              closeAll() — ignores guards
            </button>
          </section>

          <section>
            <h2>13 · The active window</h2>
            <p>
              The top non-minimized window carries <code>data-vw-active</code> and is marked in the taskbar and the stack
              table below. It is derived from <code>z</code> rather than stored, so it cannot fall out of step.
            </p>
            <p>
              Both minimize and close unmount the frame, so focus has to go somewhere. Open two windows and minimize the
              top one with the keyboard: focus lands on the next window's header. Minimize the last one and it lands on
              the taskbar below, which opted in with <code>:ref="registerFocusTarget"</code> — never on
              <code>&lt;body&gt;</code>.
            </p>
          </section>

          <section>
            <h2>14 · Lifecycle events</h2>
            <p>
              The log on the right is fed entirely by <code>win.on('*')</code>. A drag, a resize or an arrow-key nudge
              logs one <code>geometry</code> line when the gesture ends, never one per frame. Note what never appears
              there: typing in a draft, and the frames within a gesture. Both write straight onto the descriptor without
              passing through a store method, which is exactly why persistence watches the stack deeply instead of
              listening to events.
            </p>
          </section>

          <section>
            <h2>15 · Mutating an open window</h2>
            <p>
              <code>setTitle</code>, <code>setGeometry</code>, <code>updateProps</code> and <code>setMeta</code> all
              write the descriptor from outside the window, so every change survives a minimize and a reload.
              <code>setGeometry</code> is re-clamped against the window's own size limits, so it cannot put a window
              somewhere a grip could not; <code>updateProps</code> re-renders the content in place rather than
              remounting the frame, which is why the live-mount count in case 2 does not move and a log viewer's tick
              does not restart. What re-renders is the template — a log viewer's <code>source:</code> line follows the
              new prop, while the title it set from the same prop in <code>setup</code> does not, because a re-render
              is not a remount.
            </p>
            <p>
              Only the two that a user could have done by hand emit — <code>title</code> and <code>geometry</code> —
              so the log below gets two lines, not four. <code>meta</code> is the serializable slot case 23 uses.
            </p>
            <button
              type="button"
              @click="mutateActive"
            >
              Mutate the active window
            </button>
            <button
              type="button"
              @click="win.focusNext()"
            >
              focusNext()
            </button>
            <button
              type="button"
              @click="win.focusPrev()"
            >
              focusPrev()
            </button>
          </section>

          <section>
            <h2>16 · Body scroll and a sticky footer</h2>
            <p>
              <code>.vw__body</code> scrolls; the header and the <code>footer</code> slot around it do not. The footer
              here is the host's <code>footer</code> slot, so it applies to every window and receives the descriptor —
              that is how its buttons know whether this window can be minimized or closed. Shrink the window from a grip
              and the scroll area gives way, never the footer.
            </p>
            <button
              type="button"
              @click="openLongDoc"
            >
              Open long document
            </button>
          </section>

          <section>
            <h2>17 · Loading and failure</h2>
            <p>
              A window's component is a chunk that may be slow, may never arrive, or may throw once it
              does. Open the last one alongside any other window: only its own frame turns into the
              error state.
            </p>
            <button
              type="button"
              @click="openSlowPanel"
            >
              Slow chunk (1.5s)
            </button>
            <button
              type="button"
              @click="openHungPanel"
            >
              Never arrives (2s timeout)
            </button>
            <button
              type="button"
              @click="openBrokenPanel"
            >
              Throws on mount
            </button>
          </section>

          <section>
            <h2>18 · Owned child windows</h2>
            <p>
              The question case 12's guard asks is a window, not a <code>confirm()</code>: opened with
              <code>{{ '{ owner: id }' }}</code>, it renders directly above the editor that asked and makes
              <em>only that editor</em> <code>inert</code> — the editor stops taking clicks and focus, and every other
              window on the desktop keeps working, drag included. There is no page-wide backdrop and no focus trap; this
              is the macOS sheet, not <code>showModal()</code>.
            </p>
            <p>
              Type a name into an item editor and press its ✕. While the sheet is open the editor cannot be minimized
              and cannot be asked to close again — the sheet <em>is</em> the question. ESC dismisses the sheet instead of
              minimizing it, and dismissing counts as “keep editing”. Focusing either window raises both, in order.
              Owned windows are never persisted: open one, reload, and only the editor comes back.
            </p>
            <button
              type="button"
              @click="openItem"
            >
              Open item editor
            </button>
          </section>

          <section>
            <h2>19 · Window results</h2>
            <p>
              <code>open()</code> returns <code>{{ '{ id, result }' }}</code>, and
              <code>result</code> is a promise: <code>{{ '{ ok: true, data }' }}</code> when the
              window resolved a value, and <code>{{ "{ ok: false, reason: 'closed' | 'restored' }" }}</code>
              when it went away without one. It never hangs — the ✕, <code>close()</code>,
              <code>closeAll()</code> and <code>maxWindows</code> eviction all settle it.
            </p>
            <p>
              Open an item editor, type a name and press <em>Save and close</em>: the log records the
              <code>SavedItem</code> the window resolved, typed through the components map. Close it
              any other way and the same log line reports <code>closed</code> instead. Case 18's
              confirm sheet is the same mechanism: its answer is its result, which is why it needs no
              callback in its props.
            </p>
            <p>
              A window that came back from storage is the one case a promise cannot honestly cover —
              whoever was awaiting it belongs to a page load that is over — so its result is already
              settled as <code>restored</code>.
            </p>
            <button
              type="button"
              @click="openItem"
            >
              Open item editor
            </button>
            <button
              type="button"
              @click="askRestoredResults"
            >
              resultOf() every open window
            </button>
          </section>

          <section>
            <h2>20 · Pinned (always-on-top) windows</h2>
            <p>
              <code>fixed: true</code> opens a window above every other one and keeps it there: open the pinned log,
              then click any other window, snap it, or maximize it — the pinned one stays on top. It renders in a second
              z band (<code>zIndexBase + topZ + z</code>), so nothing about <code>focus()</code> or the active window
              changes; there is still one stack.
            </p>
            <p>
              It cannot be dragged, resized or snapped — no grips, no header drag, arrow keys do nothing and
              double-clicking the header does nothing — but it stays closable and minimizable, and it shows up in the
              taskbar like any other window. The extra button in its header after the ✕ unpins it: it becomes draggable,
              resizable and snappable again and drops back into the normal band. Press it once more to re-pin, which
              also drops any snap it had picked up.
            </p>
            <p>
              The pin is <em>runtime-only</em> — the same placement as snap state — so it never touches the descriptor
              or the storage schema. Pin the window, reload, and it comes back unpinned and draggable, exactly as a
              snapped window comes back undocked.
            </p>
            <button
              type="button"
              @click="openPinnedPanel"
            >
              Open pinned panel
            </button>
            <button
              type="button"
              @click="openLog('busy')"
            >
              Open another window to click around
            </button>
          </section>

          <section>
            <h2>21 · Modal windows, the scrim and presets</h2>
            <p>
              <code>{{ "{ preset: 'dialog' }" }}</code> opens the <code>el-dialog</code> shape: centred, 420×260, no
              drag and no grips, above every band, with the page dimmed behind it and every other window
              <code>inert</code> until it is answered. The preset lives in <code>createWindows</code>, so the call site
              says nothing about size, position or chrome.
            </p>
            <p>
              Still <code>show()</code>, never <code>showModal()</code> — there is no browser top layer, so the taskbar,
              <code>zIndexBase</code> and the leaving animation all keep working, and a desktop with no modal open is
              exactly the desktop above. Click a background window or its taskbar button while the modal is up: nothing
              happens. ESC dismisses it through <code>requestClose</code>, and it has no minimize to fall back on.
            </p>
            <p>
              The scrim stops the pointer and nothing stops Tab, so this playground sets
              <code>modal: {{ "{ inertRoot: '.desktop' }" }}</code> — the topbar, the case list beside you and the
              taskbar all go untabbable while a modal is open. It names everything the desktop floats over, which is a
              sibling of <code>WindowHost</code> and never an ancestor of it: pointing it at <code>#app</code> would
              make the modal itself inert, and the library warns and ignores one that does.
            </p>
            <p>
              Modality is <em>runtime-only and unpersisted</em> — stronger than the pin, which merely comes back off: a
              modal is dropped from the blob entirely, exactly as an owned sheet is. Open one and reload: the desktop
              comes back without it.
            </p>
            <button
              type="button"
              @click="openModal"
            >
              Ask a modal question
            </button>
            <button
              type="button"
              @click="openTwoModals"
            >
              Two stacked modals
            </button>
            <button
              type="button"
              @click="openLog('behind')"
            >
              Open a window to click at
            </button>
          </section>

          <section>
            <h2>22 · Transitions and where the window went</h2>
            <p>
              <code>data-vw-state</code> goes <code>entering</code> → <code>open</code> → <code>leaving</code> on the
              <code>&lt;dialog&gt;</code>, and the host keeps a leaving frame mounted for exactly
              <code>--vtd-motion-duration</code> before unmounting it — read off the window element, so this slider and
              <code>prefers-reduced-motion</code> both work through the one property. Minimize a window and it flies to
              its own taskbar button, because the taskbar below reports each button's rect with
              <code>setTaskbarRect</code>; close one and it just fades, having no button to fly to. At
              <code>0ms</code> windows appear and vanish in one frame, exactly as they do with no stylesheet imported.
            </p>
            <label class="motion">
              <input
                v-model.number="motionMs"
                type="range"
                min="0"
                max="900"
                step="20"
              >
              {{ motionMs === null ? 'stylesheet default (180ms)' : `${motionMs}ms` }}
            </label>
            <button
              type="button"
              @click="motionMs = null"
            >
              Back to the default
            </button>
          </section>

          <section>
            <h2>23 · Staleness is yours to resolve</h2>
            <p>
              A preserved draft can be older than the server's copy, and the library does not fetch, so it cannot
              resolve that for you. What it gives you is two things: <code>descriptor.meta</code>, a serializable slot
              for a version or an ETag, and <code>isRestored</code> from <code>useWindowContext()</code> — true when
              this mount came back from storage rather than from a fresh <code>open()</code>.
            </p>
            <p>
              The item editor does exactly that. It stashes <code>meta.version</code> when the draft starts and, on a
              restored mount only, refetches and compares — the stand-in server has moved to v2, so a restored editor
              offers the choice between the draft and the server copy. Open one, type a name, reload: the banner is the
              pattern working. Silently overwriting a concurrent edit is the sharpest edge this design creates, which is
              why the choice is the consumer's and not the library's.
            </p>
            <button
              type="button"
              @click="openItem"
            >
              Open item editor
            </button>
            <button
              type="button"
              @click="reload"
            >
              Reload page
            </button>
          </section>

          <section>
            <h2>24 · Two tabs on one key</h2>
            <p>
              Two tabs sharing <code>persist.key</code> would otherwise overwrite each other's layout every write. When
              a tab sees a foreign write on its key it stops persisting and calls <code>onExternalChange</code> —
              it never hydrates on its own, because adopting the other tab's snapshot would replace this tab's windows,
              drafts included.
            </p>
            <p>
              This playground logs the notice and parks <code>info.resume()</code> on
              <code>window.__vwResume()</code>. Open a second tab, move a window there, and watch this tab's log:
              from that point on nothing here is written. Call <code>__vwResume()</code> in the console to adopt the
              other tab's snapshot and start writing again.
            </p>
            <button
              type="button"
              @click="openSecondTab"
            >
              Open a second tab
            </button>
            <button
              type="button"
              @click="clearStorage"
            >
              Clear storage
            </button>
          </section>

          <section>
            <h2>25 · Small screens</h2>
            <p>
              Below {{ options.mobileBreakpoint }}px windows go fullscreen and drag/resize turn inert; the stored geometry
              is untouched. Narrow the browser to see it.
            </p>
          </section>
        </div>

        <aside class="side">
          <h2>Stack ({{ stack.length }})</h2>
          <table>
            <tr
              v-for="w in stack"
              :key="w.id"
              :class="{ 'is-active': w.id === win.activeId.value }"
            >
              <td>{{ w.id === win.activeId.value ? '▸' : '' }}</td>
              <td>{{ w.title || w.name }}</td>
              <td>{{ w.minimized ? 'min' : `${Math.round(w.x)},${Math.round(w.y)} ${w.w}×${w.h}` }}</td>
              <td>{{ win.dockZone(w.id) ?? '—' }}</td>
              <td>z{{ w.z }} → {{ options.zIndexBase + bandOf(w.id) * win.s.topZ + w.z }}</td>
              <td>{{ [win.ownerOf(w.id) ? 'child' : '', win.hasChild(w.id) || win.isBlockedByModal(w.id) ? 'inert' : '', win.isPinned(w.id) ? 'pinned' : '', win.isModal(w.id) ? 'modal' : '', w.closable ? '' : 'no-x', w.minimizable ? '' : 'no-min', w.draggable ? '' : 'no-drag', w.resizable ? '' : 'no-size'].filter(Boolean).join(' ') || '—' }}</td>
            </tr>
          </table>

          <h2>Events</h2>
          <ul class="log">
            <li
              v-for="(e, i) in events.entries"
              :key="i"
            >
              <span>{{ e.at }}</span> {{ e.text }}
            </li>
          </ul>
        </aside>
      </div>
    </main>


    <WindowTaskbar
      v-slot="{ all, active, restore, focus, requestClose, closing, registerFocusTarget, setTaskbarRect }"
    >
      <div
        :ref="registerFocusTarget"
        class="taskbar"
        tabindex="-1"
      >
        <span class="taskbar__label">Windows ({{ all.length }})</span>
        <!-- The ref callback runs on every taskbar render, so the rect a minimizing window flies to
           is always the current one — even after the buttons have reflowed. -->
        <!-- Owned windows are left out: a sheet belongs to its owner, not to the desktop, and it
           cannot be minimized in the first place. -->
        <button
          v-for="w in all.filter((x) => !win.ownerOf(x.id))"
          :key="w.id"
          :ref="(el) => setTaskbarRect(w.id, el)"
          type="button"
          class="taskbar__item"
          :class="{ 'is-active': w.id === active, 'is-min': w.minimized, 'is-closing': closing(w.id) }"
          @click="w.minimized ? restore(w.id) : focus(w.id)"
        >
          {{ w.title || w.name }}
          <!-- A second click would join the pending request rather than ask twice, but showing that
             the question is already out is the point of the slot prop. -->
          <span
            v-if="w.closable && closing(w.id)"
            class="taskbar__close"
            aria-hidden="true"
          >…</span>
          <span
            v-else-if="w.closable"
            class="taskbar__close"
            role="button"
            aria-label="Close"
            @click.stop="requestClose(w.id)"
          >✕</span>
        </button>
      </div>
    </WindowTaskbar>
  </div>

  <WindowHost>
    <template #footer="{ descriptor }">
      <div class="winfoot">
        <button
          type="button"
          :disabled="!descriptor.minimizable || win.isClosing(descriptor.id)"
          @click="win.minimize(descriptor.id)"
        >
          Minimize
        </button>
        <button
          type="button"
          :disabled="!descriptor.closable || win.isClosing(descriptor.id)"
          @click="win.requestClose(descriptor.id)"
        >
          {{ win.isClosing(descriptor.id) ? 'Closing…' : 'Close' }}
        </button>
      </div>
    </template>
  </WindowHost>
</template>

<style scoped>
.topbar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100; padding: 6px 12px;
  background: #1f2937; color: #e5e7eb; font: 12px system-ui, sans-serif;
}
.page { padding: 44px 24px 64px; font-family: system-ui, sans-serif; max-width: 1200px; }
.lede { color: #6b7280; }
.cols { display: grid; grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr); gap: 24px; }
section { border: 1px solid rgba(127, 127, 127, 0.3); border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; }
h2 { font-size: 15px; margin: 0 0 6px; }
section p { margin: 0 0 10px; font-size: 14px; color: #6b7280; }
button { margin-right: 8px; margin-bottom: 4px; }
.side table { width: 100%; font-size: 12px; border-collapse: collapse; }
.side td { border-bottom: 1px solid rgba(127, 127, 127, 0.25); padding: 2px 4px; }
.log { list-style: none; padding: 0; font-size: 12px; max-height: 320px; overflow: auto; }
.log li { padding: 2px 0; border-bottom: 1px solid rgba(127, 127, 127, 0.15); }
.log span { color: #9ca3af; margin-right: 6px; }
.taskbar__item.is-closing { opacity: 0.6; }
.taskbar {
  position: fixed; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; z-index: 2147483000; font: 13px system-ui, sans-serif;
  /* The dock is consumer-drawn, so a palette does not reach it by itself — reading the same
     tokens the windows read is what makes it follow the picker. Fallbacks are the old literals,
     so with no theme picked the taskbar looks exactly as it did. */
  background: var(--vtd-head-bg, #26262b);
  color: var(--vtd-head-fg, #e5e7eb);
  color-scheme: var(--vtd-color-scheme, inherit);
}
.taskbar__label { opacity: 0.7; }
.taskbar__item { padding: 4px 10px; opacity: 0.65; }
.taskbar__item.is-min { font-style: italic; }
.taskbar__item.is-active { opacity: 1; outline: 2px solid var(--vtd-accent, #60a5fa); }
.side tr.is-active td { font-weight: 600; }
.taskbar__close { margin-left: 6px; opacity: 0.7; }
/* Not scoped to the window's own DOM — the slot content belongs to this component. */
.motion { display: inline-flex; align-items: center; gap: 8px; margin-right: 12px; font-size: 13px; }
.winfoot { display: flex; justify-content: flex-end; gap: 8px; }
.winfoot button { margin: 0; }
</style>
