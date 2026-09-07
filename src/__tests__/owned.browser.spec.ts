import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { defineComponent, h, nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createWindows, useWindows } from '../createWindows'
import WindowHost from '../WindowHost.vue'

/**
 * What `inert` is actually worth, measured rather than assumed. jsdom implements none of it — the
 * attribute is inert there in the wrong sense — so `owned.spec.ts` can only assert that the library
 * sets it. Everything the feature promises after that is the UA's: the owner stops taking clicks
 * and focus, a sibling keeps both, and ESC on the owner never arrives because the event is not
 * delivered into an inert subtree.
 */

const Content = defineComponent({
  props: { windowId: { type: String, default: '' }, tag: { type: String, default: '' } },
  render() {
    return h('div', { class: 'content' }, [h('button', { class: `btn ${this.tag}` }, this.tag)])
  },
})

let wrapper: VueWrapper | null = null

function app() {
  const plugin = createWindows({ components: { editor: Content, confirm: Content }, mobileBreakpoint: 0 })
  wrapper = mount(defineComponent({ render: () => h(WindowHost) }), {
    global: { plugins: [plugin] },
    attachTo: document.body,
  })
  return { win: useWindows() }
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

function dialogs(): HTMLDialogElement[] {
  return [...document.querySelectorAll<HTMLDialogElement>('dialog.vw')]
}

describe('an owned child in a real browser', () => {
  it('makes its owner refuse clicks and focus while a sibling keeps both', async () => {
    const { win } = app()
    const sibling = win.open('editor', { tag: 'sibling' }, { x: 20, y: 20, w: 240, h: 160 }).id
    const owner = win.open('editor', { tag: 'owner' }, { x: 300, y: 20, w: 240, h: 160 }).id
    await nextTick()

    const [siblingEl, ownerEl] = dialogs()
    const ownerBtn = ownerEl!.querySelector<HTMLElement>('.btn')!
    const siblingBtn = siblingEl!.querySelector<HTMLElement>('.btn')!

    let siblingClicks = 0
    siblingBtn.addEventListener('click', () => void siblingClicks++)

    win.open('confirm', { tag: 'sheet' }, { owner, x: 340, y: 60, w: 200, h: 120 })
    await nextTick()

    // A hit test at the button's own coordinates, not a dispatched event: a synthetic click lands
    // on an inert element just the same, which is exactly the thing being measured. Chromium hands
    // back <body> instead — the button is no longer there to be hit. (Playwright's own click
    // reports this as "<body> intercepts pointer events" and retries until it times out, which is
    // the same measurement with a worse failure mode.)
    const centre = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    }
    expect(centre(ownerBtn)).not.toBe(ownerBtn)
    expect(centre(siblingBtn)).toBe(siblingBtn)

    await userEvent.click(siblingBtn)
    expect(siblingClicks).toBe(1)

    ownerBtn.focus()
    expect(document.activeElement).not.toBe(ownerBtn)
    siblingBtn.focus()
    expect(document.activeElement).toBe(siblingBtn)

    // Dragging a sibling still works: there is no page-wide overlay to intercept the pointer.
    const head = siblingEl!.querySelector<HTMLElement>('.vw__head')!
    const before = win.byId(sibling)!.x
    head.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 60, clientY: 30, pointerId: 1 }))
    head.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 140, clientY: 30, pointerId: 1 }))
    head.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 140, clientY: 30, pointerId: 1 }))
    expect(win.byId(sibling)!.x).toBe(before + 80)
  })

  it('takes ESC itself and leaves an inert owner untouched', async () => {
    const { win } = app()
    const owner = win.open('editor', { tag: 'owner' }, { x: 40, y: 40, w: 260, h: 180 }).id
    const child = win.open('confirm', { tag: 'sheet' }, { owner, x: 80, y: 80, w: 200, h: 120 }).id
    await nextTick()

    const [ownerEl, childEl] = dialogs()
    childEl!.querySelector<HTMLElement>('.vw__head')!.focus()
    await userEvent.keyboard('{Escape}')
    await nextTick()

    // The child is dismissed, not minimized — it has no minimize to fall back on.
    expect(win.byId(child)).toBeUndefined()
    expect(win.byId(owner)!.minimized).toBe(false)

    // With the question answered the owner is an ordinary window again, ESC included.
    await nextTick()
    expect(ownerEl!.hasAttribute('inert')).toBe(false)
    ownerEl!.querySelector<HTMLElement>('.vw__head')!.focus()
    await userEvent.keyboard('{Escape}')
    expect(win.byId(owner)!.minimized).toBe(true)
  })

  it('delivers no ESC at all to an owner while it is inert', async () => {
    const { win } = app()
    const owner = win.open('editor', { tag: 'owner' }, { x: 40, y: 40, w: 260, h: 180 }).id
    win.open('confirm', { tag: 'sheet' }, { owner, x: 80, y: 80, w: 200, h: 120 })
    await nextTick()

    const ownerEl = dialogs()[0]!
    let delivered = 0
    ownerEl.addEventListener('keydown', () => void delivered++)

    // Focus cannot get inside an inert subtree, so the key is typed wherever focus really is.
    ownerEl.querySelector<HTMLElement>('.vw__head')!.focus()
    await userEvent.keyboard('{Escape}')

    expect(delivered).toBe(0)
    expect(win.byId(owner)!.minimized).toBe(false)
  })
})
