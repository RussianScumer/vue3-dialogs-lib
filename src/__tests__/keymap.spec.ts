import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createWindows, useWindows } from '../createWindows'
import { snapRect } from '../geometry'
import WindowHost from '../WindowHost.vue'
import type { KeymapOptions, SnapInsets, WindowsOptions } from '../types'
import type { WindowsApi } from '../state'

/** An input inside the content, because a keystroke in a text field is not the window's. */
const Content = defineComponent({
  props: { id: { type: Number, default: 0 }, windowId: { type: String, default: '' } },
  render() {
    return h('div', { class: 'content' }, [
      h('input', { class: 'field' }),
      h('textarea', { class: 'area' }),
      h('div', { class: 'rich', contenteditable: 'true' }),
    ])
  },
})

/** The store comes from the mounted app: this file mounts one per test. */
function app(options: Partial<WindowsOptions> = {}) {
  const plugin = createWindows({ components: { editor: Content }, ...options })
  const wrapper = mount(
    defineComponent({
      components: { WindowHost },
      setup: () => ({ win: useWindows() }),
      template: '<WindowHost />',
    }),
    { global: { plugins: [plugin] }, attachTo: document.body },
  )
  return { wrapper, win: (wrapper.vm as unknown as { win: WindowsApi }).win }
}

const view = () => ({ w: window.innerWidth, h: window.innerHeight })
const NO_INSETS: SnapInsets = { top: 0, right: 0, bottom: 0, left: 0 }

/** Alt+` really carries both: `key` is the character, `code` the physical key Alt may have eaten. */
const BACKQUOTE = { key: '`', code: 'Backquote' }

describe('keymap — snapping', () => {
  it('Meta+ArrowLeft produces exactly snapRect("left"), the same rect the drop path lands on', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 }, { x: 100, y: 90, w: 400, h: 300 }).id
    await nextTick()

    await wrapper.find('dialog.vw').trigger('keydown', { key: 'ArrowLeft', metaKey: true })

    expect(win.byId(id)).toMatchObject(snapRect('left', view(), NO_INSETS))
    expect(win.dockZone(id)).toBe('left')
  })

  it('covers the halves, maximize, the four quarters and back to none', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 }, { x: 100, y: 90, w: 400, h: 300 }).id
    await nextTick()
    const dialog = wrapper.find('dialog.vw')

    const chords = [
      [{ key: 'ArrowRight', metaKey: true }, 'right'],
      [{ key: 'ArrowUp', metaKey: true }, 'max'],
      [{ key: 'ArrowUp', metaKey: true, shiftKey: true }, 'top-left'],
      [{ key: 'ArrowRight', metaKey: true, shiftKey: true }, 'top-right'],
      [{ key: 'ArrowDown', metaKey: true, shiftKey: true }, 'bottom-right'],
      [{ key: 'ArrowLeft', metaKey: true, shiftKey: true }, 'bottom-left'],
    ] as const

    for (const [chord, zone] of chords) {
      await dialog.trigger('keydown', chord)
      expect(win.dockZone(id)).toBe(zone)
      expect(win.byId(id)).toMatchObject(snapRect(zone, view(), NO_INSETS))
    }

    // 'none' gives back the geometry the window had before the first snap of the run.
    await dialog.trigger('keydown', { key: 'ArrowDown', metaKey: true })
    expect(win.dockZone(id)).toBeNull()
    expect(win.byId(id)).toMatchObject({ x: 100, y: 90, w: 400, h: 300 })
  })

  it('the Ctrl+Shift fallbacks reach the same zones as the Meta chords', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 }, { x: 100, y: 90, w: 400, h: 300 }).id
    await nextTick()
    const dialog = wrapper.find('dialog.vw')

    // Every desktop that matters takes Meta+Arrow for its own tiling, so the second chord is what
    // the feature actually runs on. Same actions, same rects.
    const chords = [
      [{ key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true, shiftKey: true }, 'left'],
      [{ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, shiftKey: true }, 'right'],
      [{ key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true, shiftKey: true }, 'max'],
      // The quarters cannot reuse the arrows — Ctrl+Shift+Arrow is already a half — so they are the
      // digits in reading order, matched by `code` because Shift+1 is `!` on a US layout.
      [{ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }, 'top-left'],
      [{ key: '@', code: 'Digit2', ctrlKey: true, shiftKey: true }, 'top-right'],
      [{ key: '#', code: 'Digit3', ctrlKey: true, shiftKey: true }, 'bottom-left'],
      [{ key: '$', code: 'Digit4', ctrlKey: true, shiftKey: true }, 'bottom-right'],
    ] as const

    for (const [chord, zone] of chords) {
      await dialog.trigger('keydown', chord)
      expect(win.dockZone(id)).toBe(zone)
      expect(win.byId(id)).toMatchObject(snapRect(zone, view(), NO_INSETS))
    }

    await dialog.trigger('keydown', { key: 'ArrowDown', code: 'ArrowDown', ctrlKey: true, shiftKey: true })
    expect(win.dockZone(id)).toBeNull()
    expect(win.byId(id)).toMatchObject({ x: 100, y: 90, w: 400, h: 300 })
  })

  it('respects snap.insets, like the pointer path', async () => {
    const insets = { top: 20, bottom: 36 }
    const { wrapper, win } = app({ snap: { insets } })
    const id = win.open('editor', { id: 1 }).id
    await nextTick()

    await wrapper.find('dialog.vw').trigger('keydown', { key: 'ArrowUp', metaKey: true })
    expect(win.byId(id)).toMatchObject(snapRect('max', view(), { ...NO_INSETS, ...insets }))
  })

  it('ignores a snap keystroke inside an editable target', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 }, { x: 100, y: 90, w: 400, h: 300 }).id
    await nextTick()
    const before = { ...win.byId(id)! }

    for (const selector of ['.field', '.area', '.rich']) {
      await wrapper.find(selector).trigger('keydown', { key: 'ArrowLeft', metaKey: true })
      expect(win.dockZone(id)).toBeNull()
      expect(win.byId(id)).toMatchObject(before)
    }
  })

  it('leaves content that took the key first alone', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 }).id
    await nextTick()

    const e = new KeyboardEvent('keydown', { key: 'ArrowLeft', metaKey: true, bubbles: true, cancelable: true })
    e.preventDefault()
    wrapper.find('.content').element.dispatchEvent(e)

    expect(win.dockZone(id)).toBeNull()
  })

  it('is inert below mobileBreakpoint, where the window is fullscreen anyway', async () => {
    const { wrapper, win } = app({ mobileBreakpoint: window.innerWidth + 1 })
    const id = win.open('editor', { id: 1 }, { x: 100, y: 90, w: 400, h: 300 }).id
    await nextTick()

    await wrapper.find('dialog.vw').trigger('keydown', { key: 'ArrowLeft', metaKey: true })
    expect(win.dockZone(id)).toBeNull()
    expect(win.byId(id)).toMatchObject({ x: 100, y: 90, w: 400, h: 300 })
  })

  it('ignores snap keystrokes for a window that is not draggable or not resizable', async () => {
    const { wrapper, win } = app()
    const fixedSize = win.open('editor', { id: 1 }, { resizable: false }).id
    const fixedPlace = win.open('editor', { id: 2 }, { draggable: false }).id
    await nextTick()

    const dialogs = wrapper.findAll('dialog.vw')
    await dialogs[0]!.trigger('keydown', { key: 'ArrowLeft', metaKey: true })
    await dialogs[1]!.trigger('keydown', { key: 'ArrowLeft', metaKey: true })

    expect(win.dockZone(fixedSize)).toBeNull()
    expect(win.dockZone(fixedPlace)).toBeNull()
  })

  it('does nothing when snap.enabled is false', async () => {
    const { wrapper, win } = app({ snap: { enabled: false } })
    const id = win.open('editor', { id: 1 }).id
    await nextTick()

    await wrapper.find('dialog.vw').trigger('keydown', { key: 'ArrowLeft', metaKey: true })
    expect(win.dockZone(id)).toBeNull()
  })

  it('a modified arrow is the keymap’s: the 10px nudge does not also run', async () => {
    const { wrapper, win } = app({ keymap: { enabled: false } })
    const id = win.open('editor', { id: 1 }, { x: 100, y: 90, w: 400, h: 300 }).id
    await nextTick()

    // With the keymap off the chord does nothing at all — including the plain arrow nudge, which
    // would otherwise have moved the window 10px under a shortcut meant for the window manager.
    await wrapper.find('.vw__head').trigger('keydown', { key: 'ArrowLeft', metaKey: true })
    expect(win.byId(id)).toMatchObject({ x: 100, y: 90 })
    expect(win.dockZone(id)).toBeNull()

    // The unmodified arrow still moves it, and shift still resizes.
    await wrapper.find('.vw__head').trigger('keydown', { key: 'ArrowLeft' })
    expect(win.byId(id)!.x).toBe(90)
  })
})

describe('keymap — window switching', () => {
  it('Alt+` cycles by z, wraps, and puts focus on the header', async () => {
    const { wrapper, win } = app()
    const a = win.open('editor', { id: 1 }).id
    const b = win.open('editor', { id: 2 }).id
    const c = win.open('editor', { id: 3 }).id
    await nextTick()
    expect(win.activeId.value).toBe(c)

    // c is on top, so the next one by z wraps round to the bottom of the stack.
    await wrapper.findAll('dialog.vw')[2]!.trigger('keydown', { ...BACKQUOTE, altKey: true })
    expect(win.activeId.value).toBe(a)
    expect(document.activeElement).toBe(win.headerOf(a))

    await wrapper.findAll('dialog.vw')[0]!.trigger('keydown', { ...BACKQUOTE, altKey: true })
    expect(win.activeId.value).toBe(b)

    await wrapper.findAll('dialog.vw')[1]!.trigger('keydown', { ...BACKQUOTE, altKey: true, shiftKey: true })
    expect(win.activeId.value).toBe(a)
  })

  it('Ctrl+` switches too, with Shift reversing it in both families', async () => {
    const { wrapper, win } = app()
    const a = win.open('editor', { id: 1 }).id
    win.open('editor', { id: 2 })
    const c = win.open('editor', { id: 3 }).id
    await nextTick()

    // From the top of the stack, next wraps to the bottom.
    await wrapper.findAll('dialog.vw')[2]!.trigger('keydown', { key: '`', code: 'Backquote', ctrlKey: true })
    expect(win.activeId.value).toBe(a)

    // a is now on top, so prev is the one below it — the window that was just left.
    await wrapper
      .findAll('dialog.vw')[0]!
      .trigger('keydown', { key: '~', code: 'Backquote', ctrlKey: true, shiftKey: true })
    expect(win.activeId.value).toBe(c)
  })

  it('skips minimized windows', async () => {
    const { win } = app()
    const a = win.open('editor', { id: 1 }).id
    const b = win.open('editor', { id: 2 }).id
    const c = win.open('editor', { id: 3 }).id
    await nextTick()

    win.minimize(a)
    await nextTick()
    expect(win.focusNext()).toBe(b)
    expect(win.activeId.value).toBe(b)
    expect(win.focusNext()).toBe(c)
  })

  it('skips a window that owns a child — its own frame is inert', async () => {
    const { win } = app()
    const owner = win.open('editor', { id: 1 }).id
    const other = win.open('editor', { id: 2 }).id
    const child = win.open('editor', { id: 3 }, { owner }).id
    await nextTick()

    expect(win.focusNext()).toBe(other)
    expect(win.focusNext()).toBe(child)
  })

  it('answers null with nothing to focus, and does not throw', async () => {
    const { win } = app()
    expect(win.focusNext()).toBeNull()
    expect(win.focusPrev()).toBeNull()

    const only = win.open('editor', { id: 1 }).id
    await nextTick()
    expect(win.focusNext()).toBe(only)
  })

  it('ships on the store with the keymap off', async () => {
    const { wrapper, win } = app({ keymap: { enabled: false } })
    const a = win.open('editor', { id: 1 }).id
    const b = win.open('editor', { id: 2 }).id
    await nextTick()

    await wrapper.findAll('dialog.vw')[1]!.trigger('keydown', { ...BACKQUOTE, altKey: true })
    expect(win.activeId.value).toBe(b) // the key is dead

    expect(win.focusNext()).toBe(a) // the store is not
    expect(win.activeId.value).toBe(a)
  })
})

describe('keymap — configuration', () => {
  it('keymap: { enabled: false } restores today’s behaviour exactly', async () => {
    const { wrapper, win } = app({ keymap: { enabled: false } })
    const id = win.open('editor', { id: 1 }, { x: 100, y: 90, w: 400, h: 300 }).id
    await nextTick()
    const dialog = wrapper.find('dialog.vw')

    await dialog.trigger('keydown', { key: 'ArrowLeft', metaKey: true })
    await dialog.trigger('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true, shiftKey: true })
    await dialog.trigger('keydown', { key: 'ArrowUp', metaKey: true, shiftKey: true })
    await dialog.trigger('keydown', { key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true })
    await dialog.trigger('keydown', { ...BACKQUOTE, altKey: true })
    await dialog.trigger('keydown', { ...BACKQUOTE, ctrlKey: true })

    expect(win.dockZone(id)).toBeNull()
    expect(win.byId(id)).toMatchObject({ x: 100, y: 90, w: 400, h: 300 })
  })

  it('rebinds one action and leaves the rest on their defaults', async () => {
    const keymap: KeymapOptions = { bindings: { snapLeft: 'Ctrl+Alt+ArrowLeft' } }
    const { wrapper, win } = app({ keymap })
    const id = win.open('editor', { id: 1 }).id
    await nextTick()
    const dialog = wrapper.find('dialog.vw')

    await dialog.trigger('keydown', { key: 'ArrowLeft', metaKey: true })
    await dialog.trigger('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true, shiftKey: true })
    expect(win.dockZone(id)).toBeNull() // an override replaces *both* defaults, collision included

    await dialog.trigger('keydown', { key: 'ArrowLeft', ctrlKey: true, altKey: true })
    expect(win.dockZone(id)).toBe('left')

    await dialog.trigger('keydown', { key: 'ArrowRight', metaKey: true })
    expect(win.dockZone(id)).toBe('right') // untouched action, untouched default
  })

  it('takes several chords for one action, and null to unbind just that one', async () => {
    const keymap: KeymapOptions = {
      bindings: { snapMax: ['Meta+ArrowUp', 'Ctrl+Shift+M'], snapNone: null },
    }
    const { wrapper, win } = app({ keymap })
    const id = win.open('editor', { id: 1 }).id
    await nextTick()
    const dialog = wrapper.find('dialog.vw')

    await dialog.trigger('keydown', { key: 'm', ctrlKey: true, shiftKey: true })
    expect(win.dockZone(id)).toBe('max')

    await dialog.trigger('keydown', { key: 'ArrowDown', metaKey: true })
    expect(win.dockZone(id)).toBe('max') // unbound, so the window stays maximized

    await dialog.trigger('keydown', { key: 'ArrowUp', metaKey: true })
    expect(win.dockZone(id)).toBe('max') // the other chord for the same action still works
  })

  it('matches modifiers exactly — a quarter chord never falls through to the half', async () => {
    const keymap: KeymapOptions = { bindings: { snapTopLeft: null } }
    const { wrapper, win } = app({ keymap })
    const id = win.open('editor', { id: 1 }).id
    await nextTick()

    await wrapper.find('dialog.vw').trigger('keydown', { key: 'ArrowUp', metaKey: true, shiftKey: true })
    expect(win.dockZone(id)).toBeNull() // not 'max', which is Meta+ArrowUp
  })
})
