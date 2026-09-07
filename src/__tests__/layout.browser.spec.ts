import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, type Slots } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createWindows, useWindows } from '../createWindows'
import WindowHost from '../WindowHost.vue'

/**
 * The three-row frame, measured. jsdom has no layout at all — `clientHeight`, `scrollHeight` and
 * `getBoundingClientRect()` are zero there — so every claim about what scrolls and what stays
 * pinned has to be made in a real browser. The baseline stylesheet is deliberately *not* imported:
 * the structure under test is BaseWindow's inline styles.
 */

/** Far taller than any frame opened here, so the body always has somewhere to scroll. */
const Content = defineComponent({
  props: { windowId: { type: String, default: '' } },
  render() {
    return h(
      'div',
      { class: 'content' },
      Array.from({ length: 40 }, (_, i) => h('p', { style: 'margin:0;height:40px' }, `line ${i}`)),
    )
  },
})

const footerSlots: Slots = {
  footer: () => h('div', { class: 'foot-content', style: 'height:30px' }, 'actions'),
}

let wrapper: VueWrapper | null = null

function app(slots?: Slots) {
  // The test browser is narrower than the default breakpoint, and a mobile window is fullscreen —
  // which is a different layout question from the one under test here.
  const plugin = createWindows({ components: { doc: Content }, mobileBreakpoint: 0 })
  wrapper = mount(defineComponent({ render: () => h(WindowHost, null, slots) }), {
    global: { plugins: [plugin] },
    attachTo: document.body,
  })
  return { win: useWindows() }
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

const q = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!

describe('window layout', () => {
  it('scrolls the body while the header and footer stay pinned', async () => {
    const { win } = app(footerSlots)
    win.open('doc', {}, { w: 320, h: 300 })
    await nextTick()

    const dialog = q<HTMLDialogElement>('dialog.vw')
    const body = q('.vw__body')
    const head = q('.vw__head')
    const foot = q('.vw__foot')

    // Content is ~5x the frame: the overflow is the body's, not the dialog's.
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight * 3)
    expect(dialog.scrollHeight).toBe(dialog.clientHeight)

    const headTop = head.getBoundingClientRect().top
    const footBottom = foot.getBoundingClientRect().bottom
    body.scrollTop = body.scrollHeight
    await nextTick()

    expect(body.scrollTop).toBeGreaterThan(0)
    expect(head.getBoundingClientRect().top).toBe(headTop)
    expect(foot.getBoundingClientRect().bottom).toBe(footBottom)
    expect(dialog.scrollTop).toBe(0)
  })

  it('gives the scroll area up, not the footer, when the window is resized smaller', async () => {
    const { win } = app(footerSlots)
    const id = win.open('doc', {}, { w: 320, h: 300, minH: 100 }).id
    await nextTick()

    const dialog = q<HTMLDialogElement>('dialog.vw')
    const body = q('.vw__body')
    const foot = q('.vw__foot')
    const tallBody = body.clientHeight
    const footHeight = foot.getBoundingClientRect().height

    win.setGeometry(id, { h: 160 })
    await nextTick()

    expect(body.clientHeight).toBeLessThan(tallBody)
    expect(foot.getBoundingClientRect().height).toBe(footHeight)
    // The three rows exactly fill the frame, so the footer cannot have been pushed out of it. The
    // dialog's own border is why this is measured against `clientHeight` rather than the outer rect.
    expect(q('.vw__head').offsetHeight + body.offsetHeight + foot.offsetHeight).toBe(dialog.clientHeight)
  })

  it('renders no footer element, and the same body height as before, when the slot is unused', async () => {
    const withFooter = app(footerSlots)
    withFooter.win.open('doc', {}, { w: 320, h: 300 })
    await nextTick()
    const shortBody = q('.vw__body').clientHeight
    const dialogHeight = q('dialog.vw').getBoundingClientRect().height
    wrapper!.unmount()

    const plain = app()
    plain.win.open('doc', {}, { w: 320, h: 300 })
    await nextTick()

    expect(document.querySelector('.vw__foot')).toBe(null)
    expect(q('dialog.vw').getBoundingClientRect().height).toBe(dialogHeight)
    expect(q('.vw__body').clientHeight).toBe(shortBody + 30)
  })
})
