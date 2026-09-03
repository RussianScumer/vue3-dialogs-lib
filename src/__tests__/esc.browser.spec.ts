import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from '@vitest/browser/context'
import { defineComponent, h, nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createWindows, useWindows } from '../createWindows'
import WindowHost from '../WindowHost.vue'

/**
 * The ESC path in a real browser. jsdom cannot answer any of these questions: its
 * `HTMLDialogElement` is a stub (`setup.ts` supplies `show()`/`close()` by hand), it never runs the
 * UA's close-request steps, and it has no native `<select>` popup. Every assertion here is about
 * what Chromium actually does, not what the DOM spec is read to imply.
 */

const Content = defineComponent({
  props: {
    windowId: { type: String, default: '' },
    /** Mimics content that owns ESC for its own popper — the documented escape hatch. */
    eatEscape: { type: Boolean, default: false },
  },
  render() {
    return h(
      'div',
      {
        class: 'content',
        onKeydown: (e: KeyboardEvent) => {
          if (this.eatEscape && e.key === 'Escape') e.preventDefault()
        },
      },
      [
        h('input', { class: 'field' }),
        h('select', { class: 'picker' }, [
          h('option', { value: 'a' }, 'a'),
          h('option', { value: 'b' }, 'b'),
        ]),
      ],
    )
  },
})

let wrapper: VueWrapper | null = null

function app() {
  const plugin = createWindows({ components: { editor: Content } })
  wrapper = mount(defineComponent({ components: { WindowHost }, template: '<WindowHost />' }), {
    global: { plugins: [plugin] },
    attachTo: document.body,
  })
  return { wrapper, win: useWindows() }
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

function dialogs(): HTMLDialogElement[] {
  return [...document.querySelectorAll<HTMLDialogElement>('dialog.vw')]
}

describe('ESC in a real browser', () => {
  it('a .show() dialog never receives the UA cancel event — the @cancel handler was dead code', async () => {
    const { win } = app()
    win.open('editor', {})
    await nextTick()

    const dialog = dialogs()[0]!
    expect(dialog.open).toBe(true)
    const cancel = vi.fn()
    const close = vi.fn()
    dialog.addEventListener('cancel', cancel)
    dialog.addEventListener('close', close)

    await userEvent.keyboard('{Escape}')

    expect(cancel).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    expect(dialog.open).toBe(true)
  })

  it('minimizes the active window', async () => {
    const { win } = app()
    const id = win.open('editor', {})
    await nextTick()

    expect(document.activeElement).toBe(document.querySelector('.field'))
    await userEvent.keyboard('{Escape}')
    expect(win.byId(id)!.minimized).toBe(true)
  })

  it('leaves the window alone when the content called preventDefault', async () => {
    const { win } = app()
    const id = win.open('editor', { eatEscape: true })
    await nextTick()

    await userEvent.keyboard('{Escape}')
    expect(win.byId(id)!.minimized).toBe(false)
  })

  it('reports the browser fact the picker guard exists for: ESC on a <select> is not defaultPrevented', async () => {
    const { win } = app()
    win.open('editor', {})
    await nextTick()

    const seen: boolean[] = []
    const record = (e: KeyboardEvent) => {
      if (e.key === 'Escape') seen.push(e.defaultPrevented)
    }
    document.addEventListener('keydown', record, true)
    document.querySelector<HTMLSelectElement>('.picker')!.focus()
    await userEvent.keyboard('{Escape}')
    document.removeEventListener('keydown', record, true)

    // If this ever flips to `true`, the element-type guard in BaseWindow can be deleted and the
    // `defaultPrevented` check alone will cover pickers.
    expect(seen).toEqual([false])
  })

  it('leaves the window alone when ESC is aimed at a native picker', async () => {
    const { win } = app()
    const id = win.open('editor', {})
    await nextTick()

    // Synthetic input cannot open a native `<select>` popup — CDP `alt+ArrowDown` moves the
    // selection instead of dropping the list, so "popup is open" is not an assertable state in any
    // driven browser. The guard is therefore on the element type, and so is this assertion.
    document.querySelector<HTMLSelectElement>('.picker')!.focus()
    await userEvent.keyboard('{Escape}')
    expect(win.byId(id)!.minimized).toBe(false)

    const date = document.createElement('input')
    date.type = 'date'
    document.querySelector('.content')!.append(date)
    date.focus()
    await userEvent.keyboard('{Escape}')
    expect(win.byId(id)!.minimized).toBe(false)
  })

  it('does nothing when the target is in a window that is not the active one', async () => {
    const { win } = app()
    const back = win.open('editor', {})
    const front = win.open('editor', {})
    await nextTick()
    expect(win.activeId.value).toBe(front)

    // Focus without raising: a Tab into a lower window does not call focus(), a pointerdown does.
    document.querySelectorAll<HTMLInputElement>('.field')[0]!.focus()
    await userEvent.keyboard('{Escape}')

    expect(win.byId(back)!.minimized).toBe(false)
    expect(win.byId(front)!.minimized).toBe(false)
  })

  it('ignores ESC on a window that is not minimizable', async () => {
    const { win } = app()
    const id = win.open('editor', {}, { minimizable: false })
    await nextTick()

    await userEvent.keyboard('{Escape}')
    expect(win.byId(id)!.minimized).toBe(false)
  })
})
