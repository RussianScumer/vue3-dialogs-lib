import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { defineComponent, h, nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createWindows, useWindows } from '../createWindows'
import WindowHost from '../WindowHost.vue'
import type { WindowsOptions } from '../types'

/**
 * ESC with focus outside every window, in a real browser: the keystroke reaches the document
 * listener from `<body>` or from the consumer's own page, never through a frame.
 */

const Content = defineComponent({
  props: {
    windowId: { type: String, default: '' },
    /** Only to keep two windows out of each other's dedupe bucket. */
    tag: { type: String, default: '' },
  },
  render() {
    return h('div', { class: 'content' }, [h('input', { class: 'field' })])
  },
})

let wrapper: VueWrapper | null = null
const outside: HTMLElement[] = []

function app(options: Partial<WindowsOptions> = {}) {
  const plugin = createWindows({ components: { editor: Content }, ...options })
  // A render function, not a `template`: the browser build of Vue is runtime-only.
  wrapper = mount(defineComponent({ render: () => h(WindowHost) }), {
    global: { plugins: [plugin] },
    attachTo: document.body,
  })
  return { wrapper, win: useWindows() }
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  for (const el of outside.splice(0)) el.remove()
})

/** Where a user is after clicking the page background: focus on `<body>`, inside no window. */
function blurAll(): void {
  ;(document.activeElement as HTMLElement | null)?.blur()
  expect(document.activeElement).toBe(document.body)
}

function onPage<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  document.body.appendChild(el)
  outside.push(el)
  return el
}

describe('ESC outside every window', () => {
  it('closes the active window', async () => {
    const { win } = app()
    const id = win.open('editor').id
    await nextTick()
    blurAll()

    await userEvent.keyboard('{Escape}')
    await nextTick()
    expect(win.byId(id)).toBeUndefined()
  })

  it('closes the top window first, then the next one', async () => {
    const { win } = app()
    const back = win.open('editor', { tag: 'back' }).id
    const front = win.open('editor', { tag: 'front' }).id
    await nextTick()
    blurAll()

    await userEvent.keyboard('{Escape}')
    await nextTick()
    expect(win.byId(front)).toBeUndefined()
    expect(win.byId(back)).toBeDefined()

    blurAll()
    await userEvent.keyboard('{Escape}')
    await nextTick()
    expect(win.byId(back)).toBeUndefined()
  })

  it('follows the active window, not the last opened one', async () => {
    const { win } = app()
    const back = win.open('editor', { tag: 'back' }).id
    const front = win.open('editor', { tag: 'front' }).id
    win.focus(back)
    await nextTick()
    blurAll()

    await userEvent.keyboard('{Escape}')
    await nextTick()
    expect(win.byId(back)).toBeUndefined()
    expect(win.byId(front)).toBeDefined()
  })

  it('goes through requestClose, so a guard can still keep the window', async () => {
    const { win } = app({ beforeClose: () => false })
    const id = win.open('editor').id
    await nextTick()
    blurAll()

    await userEvent.keyboard('{Escape}')
    await nextTick()
    expect(win.byId(id)).toBeDefined()
  })

  it('skips minimized windows and does nothing when none is on screen', async () => {
    const { win } = app()
    const id = win.open('editor').id
    await nextTick()
    win.minimize(id)
    await nextTick()
    blurAll()

    await userEvent.keyboard('{Escape}')
    await nextTick()
    expect(win.byId(id)).toBeDefined()
  })

  it('leaves ESC in a text field on the page to the field', async () => {
    const { win } = app()
    const id = win.open('editor').id
    await nextTick()
    onPage('input').focus()

    await userEvent.keyboard('{Escape}')
    await nextTick()
    expect(win.byId(id)).toBeDefined()
  })

  it('leaves ESC on a native <select> on the page to the picker', async () => {
    const { win } = app()
    const id = win.open('editor').id
    await nextTick()
    const select = onPage('select')
    select.append(new Option('a'), new Option('b'))
    select.focus()

    await userEvent.keyboard('{Escape}')
    await nextTick()
    expect(win.byId(id)).toBeDefined()
  })

  it('stands down when page content took the key first', async () => {
    const { win } = app()
    const id = win.open('editor').id
    await nextTick()
    const button = onPage('button')
    button.addEventListener('keydown', (e) => e.preventDefault())
    button.focus()

    await userEvent.keyboard('{Escape}')
    await nextTick()
    expect(win.byId(id)).toBeDefined()
  })

  it('never overrides a frame that stood down: ESC inside a non-minimizable window does nothing', async () => {
    const { win } = app()
    const id = win.open('editor', {}, { minimizable: false }).id
    await nextTick()
    expect(document.querySelector('dialog.vw')!.contains(document.activeElement)).toBe(true)

    await userEvent.keyboard('{Escape}')
    await nextTick()
    expect(win.byId(id)).toBeDefined()
  })

  it('closeOnOutsideEscape: false leaves the keystroke to the page', async () => {
    const { win } = app({ closeOnOutsideEscape: false })
    const id = win.open('editor').id
    await nextTick()
    blurAll()

    await userEvent.keyboard('{Escape}')
    await nextTick()
    expect(win.byId(id)).toBeDefined()
  })
})
