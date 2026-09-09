import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { defineComponent, h, nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createWindows, useWindows } from '../createWindows'
import WindowHost from '../WindowHost.vue'

/**
 * What a modal is actually worth, measured rather than assumed. `inert` and hit testing are the
 * UA's and jsdom implements neither, so `modal.spec.ts` can only assert that the library sets the
 * attribute and picks the z-index. Everything after that — a background window that stops taking
 * clicks, focus and drags, a scrim that swallows a click meant for the page, and the documented
 * hole that Tab still walks into the page without `modal.inertRoot` — lives here.
 *
 * The baseline stylesheet is deliberately not imported: the scrim has to block a click on the
 * strength of its inline geometry alone.
 */

const Content = defineComponent({
  props: { windowId: { type: String, default: '' }, tag: { type: String, default: '' } },
  render() {
    return h('div', { class: 'content' }, [h('button', { class: `btn ${this.tag}` }, this.tag)])
  },
})

let wrapper: VueWrapper | null = null
let page: HTMLElement | null = null

/** A page behind the desktop, outside the host — what `modal.inertRoot` is meant to point at. */
function pageBehind(): HTMLButtonElement {
  page = document.createElement('div')
  page.id = 'page-behind'
  page.innerHTML =
    '<button class="page-btn" style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%)">page</button>'
  document.body.prepend(page)
  return page.querySelector<HTMLButtonElement>('.page-btn')!
}

function app(over: Record<string, unknown> = {}) {
  const plugin = createWindows({
    components: { editor: Content, confirm: Content },
    mobileBreakpoint: 0,
    ...over,
  } as Parameters<typeof createWindows>[0])
  wrapper = mount(defineComponent({ render: () => h(WindowHost) }), {
    global: { plugins: [plugin] },
    attachTo: document.body,
  })
  return { win: useWindows() }
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  page?.remove()
  page = null
})

function dialogs(): HTMLDialogElement[] {
  return [...document.querySelectorAll<HTMLDialogElement>('dialog.vw')]
}

/**
 * Drags from whatever the UA finds at those coordinates rather than from the header element: a
 * synthetic event dispatched straight onto an inert node still runs its listeners, so aiming at the
 * element would measure nothing at all. The hit test is the thing under test.
 */
function dragFrom(fromX: number, y: number, toX: number): void {
  const target = document.elementFromPoint(fromX, y)
  if (!target) return
  const at = (type: string, x: number) =>
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1 }))
  at('pointerdown', fromX)
  at('pointermove', toX)
  at('pointerup', toX)
}

describe('a modal window in a real browser', () => {
  it('stops a background window taking clicks, focus or a drag, and gives all three back', async () => {
    const { win } = app()
    const behind = win.open('editor', { tag: 'behind' }, { x: 20, y: 20, w: 240, h: 160 }).id
    await nextTick()

    const behindEl = dialogs()[0]!
    const behindBtn = behindEl.querySelector<HTMLElement>('.btn')!
    const head = behindEl.querySelector<HTMLElement>('.vw__head')!
    const headY = Math.round(head.getBoundingClientRect().y + 4)

    const modal = win.open('editor', { tag: 'modal' }, { modal: true, x: 400, y: 40, w: 240, h: 160 }).id
    await nextTick()

    // A hit test at the button's own coordinates, not a dispatched event: a synthetic click lands
    // on an inert element just the same, which is exactly the thing being measured.
    const centre = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    }
    expect(centre(behindBtn)).not.toBe(behindBtn)

    behindBtn.focus()
    expect(document.activeElement).not.toBe(behindBtn)

    const before = win.byId(behind)!.x
    dragFrom(60, headY, 140)
    expect(win.byId(behind)!.x).toBe(before)

    win.close(modal)
    await nextTick()

    expect(centre(behindBtn)).toBe(behindBtn)
    behindBtn.focus()
    expect(document.activeElement).toBe(behindBtn)
    dragFrom(60, headY, 140)
    expect(win.byId(behind)!.x).toBe(before + 80)
  })

  it('inerts every other dialog while it is open and nothing once it is gone', async () => {
    const { win } = app()
    win.open('editor', { tag: 'a' }, { x: 20, y: 20, w: 200, h: 140 })
    win.open('editor', { tag: 'b' }, { x: 240, y: 20, w: 200, h: 140 })
    const modal = win.open('editor', { tag: 'modal' }, { modal: true, x: 460, y: 20, w: 200, h: 140 }).id
    await nextTick()

    const inert = () => dialogs().map((el) => el.hasAttribute('inert'))
    expect(inert()).toEqual([true, true, false])

    win.close(modal)
    await nextTick()
    expect(inert()).toEqual([false, false])
  })

  it('hands an owner that was already inert its own inert back', async () => {
    const { win } = app()
    const owner = win.open('editor', { tag: 'owner' }, { x: 20, y: 20, w: 220, h: 150 }).id
    win.open('confirm', { tag: 'sheet' }, { owner, x: 60, y: 60, w: 180, h: 120 })
    const modal = win.open('editor', { tag: 'modal' }, { modal: true, x: 400, y: 20, w: 200, h: 140 }).id
    await nextTick()

    const ownerEl = dialogs()[0]!
    expect(ownerEl.hasAttribute('inert')).toBe(true)

    win.close(modal)
    await nextTick()
    // The child is still the question: the modal going away must not un-inert its owner.
    expect(ownerEl.hasAttribute('inert')).toBe(true)
  })

  it('blocks a click meant for the page with the scrim alone, no stylesheet imported', async () => {
    const btn = pageBehind()
    const { win } = app()
    win.open('editor', { tag: 'modal' }, { modal: true, x: 20, y: 20, w: 200, h: 140 })
    await nextTick()

    const r = btn.getBoundingClientRect()
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    expect(hit).not.toBe(btn)
    expect((hit as HTMLElement).classList.contains('vw-scrim')).toBe(true)
  })

  it('never lets Tab out of the modal into a background window', async () => {
    const { win } = app()
    win.open('editor', { tag: 'behind' }, { x: 20, y: 20, w: 220, h: 150 })
    win.open('editor', { tag: 'modal' }, { modal: true, x: 300, y: 20, w: 220, h: 150 })
    await nextTick()

    const behindBtn = dialogs()[0]!.querySelector<HTMLElement>('.btn')!
    dialogs()[1]!.querySelector<HTMLElement>('.btn')!.focus()

    const seen: Element[] = []
    for (let i = 0; i < 8; i++) {
      await userEvent.tab()
      if (document.activeElement) seen.push(document.activeElement)
    }
    expect(seen).not.toContain(behindBtn)
  })

  it('leaves the page tabbable without `modal.inertRoot` and takes it away with one', async () => {
    const btn = pageBehind()
    const open = (win: ReturnType<typeof useWindows>) =>
      win.open('editor', { tag: 'modal' }, { modal: true, x: 20, y: 20, w: 200, h: 140 })

    // The documented hole: the scrim stops the pointer, and nothing stops Tab.
    const bare = app()
    open(bare.win)
    await nextTick()
    btn.focus()
    expect(document.activeElement).toBe(btn)

    wrapper?.unmount()
    wrapper = null

    const guarded = app({ modal: { inertRoot: '#page-behind' } })
    const modal = open(guarded.win).id
    await nextTick()
    btn.focus()
    expect(document.activeElement).not.toBe(btn)

    guarded.win.close(modal)
    await nextTick()
    btn.focus()
    expect(document.activeElement).toBe(btn)
  })

  it('refuses an `inertRoot` that contains the desktop rather than inerting the modal', async () => {
    const { win } = app({ modal: { inertRoot: 'body' } })
    const modalId = win.open('editor', { tag: 'modal' }, { modal: true, x: 20, y: 20, w: 200, h: 140 }).id
    await nextTick()

    expect(document.body.hasAttribute('inert')).toBe(false)
    const btn = dialogs()[0]!.querySelector<HTMLElement>('.btn')!
    btn.focus()
    expect(document.activeElement).toBe(btn)
    win.close(modalId)
  })
})
