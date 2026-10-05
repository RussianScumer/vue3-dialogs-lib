import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { defineComponent, h, nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createWindows, useWindows } from '../createWindows'
import WindowHost from '../WindowHost.vue'
import type { WindowMenuProps, WindowsOptions } from '../types'

/**
 * The header's `contextmenu` slot, in a real browser: a right-click is a real `contextmenu` event,
 * whose default action only a real UA can be asked about.
 */

const Content = defineComponent({
  props: { windowId: { type: String, default: '' } },
  render: () => h('div', { class: 'content' }, 'body'),
})

/** A consumer's menu: one button per action, and a marker for what the slot was given. */
function menu(p: WindowMenuProps) {
  return h('div', { role: 'menu', class: 'menu', 'data-at': `${p.x},${p.y}` }, [
    h('button', { class: 'm-max', disabled: !p.canSnap, onClick: p.toggleMaximize }, 'max'),
    h('button', { class: 'm-left', onClick: () => p.snap('left') }, 'left'),
    h('button', { class: 'm-pin', onClick: () => p.pin() }, 'pin'),
    h('button', { class: 'm-min', onClick: p.minimize }, 'min'),
    h('button', { class: 'm-close', onClick: p.requestClose }, 'close'),
  ])
}

let wrapper: VueWrapper | null = null

/** `mobileBreakpoint: 0` because the test iframe is narrower than the default, which would make every frame fullscreen. */
function app(withMenu = true, options: Partial<WindowsOptions> = {}) {
  const plugin = createWindows({ components: { editor: Content }, mobileBreakpoint: 0, ...options })
  const slots = withMenu ? { contextmenu: menu } : {}
  wrapper = mount(defineComponent({ render: () => h(WindowHost, null, slots) }), {
    global: { plugins: [plugin] },
    attachTo: document.body,
  })
  return { wrapper, win: useWindows() }
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

function head(): HTMLElement {
  return document.querySelector<HTMLElement>('.vw__head')!
}

function openMenu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-vw-menu]')
}

/** Dispatches the event by hand to read `defaultPrevented`, which a real right-click does not expose. */
function contextmenuAt(el: Element, x: number, y: number): MouseEvent {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y })
  el.dispatchEvent(e)
  return e
}

describe('header context menu', () => {
  it('leaves the browser menu alone when no slot is provided', async () => {
    const { win } = app(false)
    win.open('editor')
    await nextTick()
    expect(contextmenuAt(head(), 50, 20).defaultPrevented).toBe(false)
    await nextTick()
    expect(openMenu()).toBeNull()
  })

  it('opens the slot at the pointer, outside the frame, above every band', async () => {
    const { win } = app()
    win.open('editor', {}, { x: 40, y: 40 })
    await nextTick()
    expect(contextmenuAt(head(), 120, 50).defaultPrevented).toBe(true)
    await nextTick()

    const m = openMenu()!
    expect(m.parentElement).toBe(document.body)
    expect(m.style.position).toBe('fixed')
    expect(m.getBoundingClientRect()).toMatchObject({ left: 120, top: 50 })
    expect(Number(m.style.zIndex)).toBeGreaterThan(Number(document.querySelector<HTMLElement>('dialog')!.style.zIndex))
    expect(m.querySelector('.menu')!.getAttribute('data-at')).toBe('120,50')
  })

  it('opens on a real right-click and moves focus into the menu', async () => {
    const { win } = app()
    win.open('editor')
    await nextTick()
    await userEvent.click(head(), { button: 'right' })
    await nextTick()
    expect(openMenu()).not.toBeNull()
    expect(document.activeElement?.classList.contains('m-max')).toBe(true)
  })

  it('opens from the keyboard at the header corner', async () => {
    const { win } = app()
    win.open('editor', {}, { x: 30, y: 20 })
    await nextTick()
    head().focus()
    await userEvent.keyboard('{Shift>}{F10}{/Shift}')
    await nextTick()
    await nextTick()
    const r = head().getBoundingClientRect()
    expect(openMenu()!.getBoundingClientRect()).toMatchObject({ left: Math.round(r.left), top: Math.round(r.bottom) })
  })

  it('ignores a right-click on a header control', async () => {
    const { win } = app()
    win.open('editor')
    await nextTick()
    const control = document.querySelector('.vw__btn')!
    expect(contextmenuAt(control, 10, 10).defaultPrevented).toBe(false)
    await nextTick()
    expect(openMenu()).toBeNull()
  })

  it('stays inside the viewport near the far corner', async () => {
    const { win } = app()
    win.open('editor')
    await nextTick()
    contextmenuAt(head(), innerWidth - 2, innerHeight - 2)
    await nextTick()
    await nextTick()
    const r = openMenu()!.getBoundingClientRect()
    expect(r.right).toBeLessThanOrEqual(innerWidth)
    expect(r.bottom).toBeLessThanOrEqual(innerHeight)
  })

  it('ESC closes the menu, gives focus back to the header and leaves the window open', async () => {
    const { win } = app()
    const id = win.open('editor').id
    await nextTick()
    await userEvent.click(head(), { button: 'right' })
    await nextTick()

    await userEvent.keyboard('{Escape}')
    await nextTick()
    expect(openMenu()).toBeNull()
    expect(document.activeElement).toBe(head())
    expect(win.byId(id)!.minimized).toBe(false)
  })

  it('a pointerdown outside the menu closes it', async () => {
    const { win } = app()
    win.open('editor')
    await nextTick()
    contextmenuAt(head(), 60, 20)
    await nextTick()
    await userEvent.click(document.body, { position: { x: 5, y: 5 } })
    await nextTick()
    expect(openMenu()).toBeNull()
  })

  it('runs each action and closes the menu first', async () => {
    const { win } = app(true, { snap: { insets: {} } })
    const id = win.open('editor').id
    const pick = async (cls: string) => {
      contextmenuAt(head(), 60, 20)
      await nextTick()
      await userEvent.click(document.querySelector(cls)!)
      await nextTick()
      expect(openMenu()).toBeNull()
    }
    await nextTick()

    await pick('.m-max')
    expect(win.isMaximized(id)).toBe(true)
    await pick('.m-max')
    expect(win.isMaximized(id)).toBe(false)
    await pick('.m-left')
    expect(win.dockZone(id)).toBe('left')
    await pick('.m-pin')
    expect(win.isPinned(id)).toBe(true)
    await pick('.m-pin')
    await pick('.m-min')
    expect(win.byId(id)!.minimized).toBe(true)

    win.restore(id)
    await nextTick()
    await pick('.m-close')
    await nextTick()
    expect(win.byId(id)).toBeUndefined()
  })

  it('does not snap a window that cannot be resized, and says so', async () => {
    const { win } = app()
    const id = win.open('editor', {}, { resizable: false }).id
    await nextTick()
    contextmenuAt(head(), 60, 20)
    await nextTick()
    expect(document.querySelector<HTMLButtonElement>('.m-max')!.disabled).toBe(true)
    await userEvent.click(document.querySelector('.m-left')!)
    expect(win.dockZone(id)).toBeNull()
  })

  it('goes away with its window', async () => {
    const { win } = app()
    const id = win.open('editor').id
    await nextTick()
    contextmenuAt(head(), 60, 20)
    await nextTick()
    win.close(id)
    await new Promise((r) => setTimeout(r, 400))
    expect(openMenu()).toBeNull()
  })
})
