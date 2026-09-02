import { describe, expect, it, vi } from 'vitest'
import { Teleport, defineAsyncComponent, defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createWindows, useWindows } from '../createWindows'
import { useWindowContext } from '../useWindowContext'
import WindowHost from '../WindowHost.vue'
import WindowTaskbar from '../WindowTaskbar.vue'

const mounted = vi.fn()
const unmounted = vi.fn()

const Content = defineComponent({
  props: { id: { type: Number, default: 0 }, windowId: { type: String, default: '' } },
  mounted,
  unmounted,
  render() {
    return h('p', { class: 'content' }, `item ${this.id}`)
  },
})

/** vue-test-utils cannot set `button`/`pointerId`, and jsdom has no PointerEvent — build it here. */
function pointer(el: Element, type: string, pointerId: number, clientX: number, clientY: number) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY })
  Object.assign(e, { pointerId })
  el.dispatchEvent(e)
}

function app() {
  mounted.mockClear()
  unmounted.mockClear()
  const plugin = createWindows({ components: { editor: Content }, maxWindows: 4 })
  const wrapper = mount(
    defineComponent({
      components: { WindowHost, WindowTaskbar },
      template: `<WindowHost /><WindowTaskbar v-slot="{ windows, all, active }">
        <b class="bar">{{ windows.length }}</b>
        <b class="bar-min">{{ windows.length }}</b>
        <b class="bar-all">{{ all.length }}</b>
        <b class="bar-active">{{ all.find((w) => w.id === active)?.title ?? 'none' }}</b>
      </WindowTaskbar>`,
    }),
    { global: { plugins: [plugin] }, attachTo: document.body },
  )
  return { wrapper, win: useWindows() }
}

describe('WindowHost', () => {
  it('renders a non-modal dialog per open window', async () => {
    const { wrapper, win } = app()
    win.open('editor', { id: 1 }, { title: 'One' })
    await nextTick()

    const dialog = wrapper.find('dialog.vw').element as HTMLDialogElement
    expect(dialog.open).toBe(true)
    expect(dialog.getAttribute('aria-label')).toBe('One')
    expect(wrapper.find('.content').text()).toBe('item 1')
    expect(mounted).toHaveBeenCalledTimes(1)
  })

  it('unmounts the content while minimized — the headline claim', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 })
    await nextTick()

    win.minimize(id)
    await nextTick()
    expect(wrapper.find('dialog.vw').exists()).toBe(false)
    expect(unmounted).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.bar').text()).toBe('1') // still in the taskbar

    win.restore(id)
    await nextTick()
    expect(wrapper.find('.content').exists()).toBe(true)
    expect(mounted).toHaveBeenCalledTimes(2)
  })

  it('keeps geometry across a minimize/restore round trip', async () => {
    const { win } = app()
    const id = win.open('editor', { id: 1 }, { x: 120, y: 90, w: 400, h: 300 })
    await nextTick()
    win.minimize(id)
    win.restore(id)
    await nextTick()

    expect(win.byId(id)).toMatchObject({ x: 120, y: 90, w: 400, h: 300 })
  })

  it('ESC minimizes instead of closing', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 })
    await nextTick()

    // A non-modal dialog gets no UA close request, so the keydown path is the real one.
    await wrapper.find('dialog.vw').trigger('keydown', { key: 'Escape' })
    expect(win.byId(id)!.minimized).toBe(true)

    win.restore(id)
    await nextTick()
    await wrapper.find('dialog.vw').trigger('cancel')
    expect(win.byId(id)!.minimized).toBe(true)
  })

  it('leaves ESC alone when the content already handled it', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 })
    await nextTick()

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    event.preventDefault()
    wrapper.find('dialog.vw').element.dispatchEvent(event)
    await nextTick()
    expect(win.byId(id)!.minimized).toBe(false)
  })

  it('header buttons minimize and close', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 })
    await nextTick()

    const [minimizeBtn, closeBtn] = wrapper.findAll('.vw__btn')
    await minimizeBtn!.trigger('click')
    expect(win.byId(id)!.minimized).toBe(true)

    win.restore(id)
    await nextTick()
    await wrapper.findAll('.vw__btn')[1]!.trigger('click')
    expect(win.byId(id)).toBeUndefined()
    expect(closeBtn).toBeDefined()
  })

  it('pointerdown raises the window', async () => {
    const { wrapper, win } = app()
    const a = win.open('editor', { id: 1 })
    const b = win.open('editor', { id: 2 })
    await nextTick()

    await wrapper.findAll('dialog.vw')[0]!.trigger('pointerdown')
    expect(win.byId(a)!.z).toBeGreaterThan(win.byId(b)!.z)
  })

  it('arrow keys on the header move the window, shift+arrow resizes', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 }, { x: 100, y: 100, w: 400, h: 300 })
    await nextTick()

    const head = wrapper.find('.vw__head')
    await head.trigger('keydown', { key: 'ArrowRight' })
    await head.trigger('keydown', { key: 'ArrowDown' })
    expect(win.byId(id)).toMatchObject({ x: 110, y: 110 })

    await head.trigger('keydown', { key: 'ArrowRight', shiftKey: true })
    expect(win.byId(id)!.w).toBe(410)
  })

  it('double-clicking the header maximizes, again restores', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 }, { x: 120, y: 90, w: 400, h: 300 })
    await nextTick()

    await wrapper.find('.vw__head').trigger('dblclick')
    expect(win.byId(id)).toMatchObject({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight })
    expect(win.dockZone(id)).toBe('max')

    await wrapper.find('.vw__head').trigger('dblclick')
    expect(win.byId(id)).toMatchObject({ x: 120, y: 90, w: 400, h: 300 })
    expect(win.dockZone(id)).toBeNull()
  })

  it('double-clicking a header button does not maximize', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 }, { x: 120, y: 90, w: 400, h: 300 })
    await nextTick()

    await wrapper.find('.vw__btn').trigger('dblclick')
    expect(win.dockZone(id)).toBeNull()
    expect(win.byId(id)).toMatchObject({ x: 120, y: 90 })
  })

  it('renders the snap ghost while a drop target is armed', async () => {
    const { wrapper, win } = app()
    win.open('editor', { id: 1 })
    await nextTick()
    expect(wrapper.find('.vw-ghost').exists()).toBe(false)

    win.setPreview('right', { w: window.innerWidth, h: window.innerHeight })
    await nextTick()
    const ghost = wrapper.find('.vw-ghost')
    expect(ghost.attributes('data-vw-zone')).toBe('right')
    expect((ghost.element as HTMLElement).style.width).toBe(`${Math.round(window.innerWidth / 2)}px`)

    win.setPreview(null, { w: window.innerWidth, h: window.innerHeight })
    await nextTick()
    expect(wrapper.find('.vw-ghost').exists()).toBe(false)
  })

  it('dragging the header to an edge arms a ghost and drops the window into the zone', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 }, { x: 300, y: 300, w: 400, h: 300 })
    await nextTick()

    const head = wrapper.find('.vw__head').element
    pointer(head, 'pointerdown', 1, 400, 320)
    pointer(head, 'pointermove', 1, 200, 320)
    expect(win.preview.value).toBeNull() // mid-screen: nothing armed

    pointer(head, 'pointermove', 1, 3, 320)
    expect(win.preview.value?.zone).toBe('left')
    await nextTick()
    expect(wrapper.find('.vw-ghost').exists()).toBe(true)

    pointer(head, 'pointerup', 1, 3, 320)
    expect(win.dockZone(id)).toBe('left')
    expect(win.byId(id)).toMatchObject({ x: 0, y: 0, w: Math.round(window.innerWidth / 2) })
    expect(win.preview.value).toBeNull()
    await nextTick()
    expect(wrapper.find('.vw-ghost').exists()).toBe(false)

    // Dragging it away again gives the floating size back.
    pointer(head, 'pointerdown', 2, 100, 10)
    expect(win.dockZone(id)).toBeNull()
    expect(win.byId(id)).toMatchObject({ w: 400, h: 300 })
  })

  it('a cancelled drag clears the ghost without snapping', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 }, { x: 300, y: 300, w: 400, h: 300 })
    await nextTick()

    const head = wrapper.find('.vw__head').element
    pointer(head, 'pointerdown', 1, 400, 320)
    pointer(head, 'pointermove', 1, 3, 320)
    pointer(head, 'pointercancel', 1, 3, 320)

    expect(win.preview.value).toBeNull()
    expect(win.dockZone(id)).toBeNull()
  })

  it('goes fullscreen and inert below the mobile breakpoint', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 }, { x: 100, y: 100 })
    await nextTick()

    Object.defineProperty(window, 'innerWidth', { value: 480, configurable: true })
    window.dispatchEvent(new Event('resize'))
    await nextTick()

    const dialog = wrapper.find('dialog.vw').element as HTMLElement
    expect(dialog.style.width).toBe('100vw')
    expect(dialog.style.transform).toBe('none')

    await wrapper.find('.vw__head').trigger('keydown', { key: 'ArrowRight' })
    expect(win.byId(id)!.x).toBe(100) // drag/resize inert on small screens

    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
    window.dispatchEvent(new Event('resize'))
  })
})

describe('WindowTaskbar', () => {
  it('keeps listing every window after the stack array is replaced', async () => {
    const { wrapper, win } = app()
    win.open('editor', { id: 1 }, { title: 'A' })
    win.open('editor', { id: 2 }, { title: 'B' })
    await nextTick()
    expect(wrapper.find('.bar-all').text()).toBe('2')

    // close() and closeAll() assign a new array; a captured reference would strand the taskbar.
    win.closeAll()
    win.open('editor', { id: 3 }, { title: 'C' })
    await nextTick()
    expect(wrapper.find('.bar-all').text()).toBe('1')
    expect(wrapper.find('.bar-active').text()).toBe('C')

    win.minimize(win.s.stack[0]!.id)
    await nextTick()
    expect(wrapper.find('.bar-all').text()).toBe('1') // still listed, just minimized
    expect(wrapper.find('.bar-min').text()).toBe('1')
    expect(wrapper.find('.bar-active').text()).toBe('none')
  })
})

describe('capabilities', () => {
  it('marks only the top window active', async () => {
    const { wrapper, win } = app()
    const a = win.open('editor', { id: 1 }, { title: 'A' })
    const b = win.open('editor', { id: 2 }, { title: 'B' })
    await nextTick()

    const active = () =>
      wrapper.findAll('dialog.vw').filter((d) => d.attributes('data-vw-active') !== undefined)
    expect(active()).toHaveLength(1)
    expect(active()[0]!.attributes('aria-label')).toBe('B')
    expect(win.activeId.value).toBe(b)

    win.focus(a)
    await nextTick()
    expect(active()).toHaveLength(1)
    expect(active()[0]!.attributes('aria-label')).toBe('A')
    expect(win.activeId.value).toBe(a)
  })

  it('tracks the viewport with one listener however many windows are open', async () => {
    const add = vi.spyOn(window, 'addEventListener')
    const { win } = app()
    for (let i = 0; i < 5; i++) win.open('editor', { id: i })
    await nextTick()

    expect(add.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(1)
    add.mockRestore()
  })

  it('hides the controls a window does not have', async () => {
    const { wrapper, win } = app()
    win.open('editor', { id: 1 }, { closable: false, minimizable: false })
    await nextTick()

    expect(wrapper.findAll('.vw__btn')).toHaveLength(0)
  })

  it('the close button asks rather than closes, and a guard can refuse', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 })
    await nextTick()
    win.onBeforeClose(id, () => false)

    await wrapper.findAll('.vw__btn')[1]!.trigger('click')
    await nextTick()
    expect(win.byId(id)).toBeDefined()

    win.onBeforeClose(id, () => true)
    await wrapper.findAll('.vw__btn')[1]!.trigger('click')
    await nextTick()
    expect(win.byId(id)).toBeUndefined()
  })

  it('renders eight grips, and none when the window is not resizable', async () => {
    const { wrapper, win } = app()
    win.open('editor', { id: 1 })
    await nextTick()
    expect(wrapper.findAll('[data-vw-grip]')).toHaveLength(8)

    win.closeAll()
    win.open('editor', { id: 2 }, { resizable: false })
    await nextTick()
    expect(wrapper.findAll('[data-vw-grip]')).toHaveLength(0)
  })

  it('the south-east grip grows the window', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 }, { x: 300, y: 300, w: 400, h: 300 })
    await nextTick()

    const grip = wrapper.find('[data-vw-grip="se"]').element
    pointer(grip, 'pointerdown', 1, 700, 600)
    pointer(grip, 'pointermove', 1, 750, 630)
    pointer(grip, 'pointerup', 1, 750, 630)

    expect(win.byId(id)).toMatchObject({ x: 300, y: 300, w: 450, h: 330 })
  })

  it('the west grip moves x so the opposite edge stays put, even at the minimum width', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 }, { x: 300, y: 300, w: 400, h: 300 })
    await nextTick()
    const east = () => win.byId(id)!.x + win.byId(id)!.w

    const grip = wrapper.find('[data-vw-grip="w"]').element
    pointer(grip, 'pointerdown', 1, 300, 450)
    pointer(grip, 'pointermove', 1, 350, 450)
    expect(win.byId(id)).toMatchObject({ x: 350, w: 350 })
    expect(east()).toBe(700)

    // Past the min width the window stops shrinking and stops moving with the pointer.
    pointer(grip, 'pointermove', 1, 700, 450)
    expect(win.byId(id)).toMatchObject({ x: 540, w: 160 })
    expect(east()).toBe(700)
    pointer(grip, 'pointerup', 1, 700, 450)
  })

  it('a grip resize drops the snap without moving the window back', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 }, { x: 300, y: 300, w: 400, h: 300 })
    win.snap(id, 'left', { w: window.innerWidth, h: window.innerHeight })
    await nextTick()
    const snapped = { ...win.byId(id)! }

    const grip = wrapper.find('[data-vw-grip="se"]').element
    pointer(grip, 'pointerdown', 1, snapped.w, snapped.h)
    pointer(grip, 'pointermove', 1, snapped.w + 40, snapped.h)
    pointer(grip, 'pointerup', 1, snapped.w + 40, snapped.h)

    expect(win.dockZone(id)).toBeNull()
    expect(win.byId(id)!.w).toBe(snapped.w + 40)
  })

  it('keyboard resize obeys the size limits, and the flags gate both keyboard paths', async () => {
    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 }, { x: 100, y: 100, w: 400, h: 300, maxW: 405 })
    await nextTick()

    const head = wrapper.find('.vw__head')
    await head.trigger('keydown', { key: 'ArrowRight', shiftKey: true })
    expect(win.byId(id)!.w).toBe(405) // clamped to maxW, not 410

    win.closeAll()
    const fixed = win.open('editor', { id: 2 }, { x: 100, y: 100, draggable: false, resizable: false })
    await nextTick()
    const head2 = wrapper.find('.vw__head')
    await head2.trigger('keydown', { key: 'ArrowRight' })
    await head2.trigger('keydown', { key: 'ArrowRight', shiftKey: true })
    expect(win.byId(fixed)).toMatchObject({ x: 100, w: 640 })
  })

  it('offsets the rendered z-index by zIndexBase, leaving the descriptor alone', async () => {
    const plugin = createWindows({ components: { editor: Content }, zIndexBase: 1000 })
    const wrapper = mount(defineComponent({ components: { WindowHost }, template: '<WindowHost />' }), {
      global: { plugins: [plugin] },
      attachTo: document.body,
    })
    const win = useWindows()
    const id = win.open('editor', { id: 1 })
    await nextTick()

    const dialog = wrapper.find('dialog.vw').element as HTMLElement
    expect(win.byId(id)!.z).toBe(11) // the stored counter never learns about the base
    expect(dialog.style.zIndex).toBe('1011')
    wrapper.unmount()
  })

  it("drops a content-registered guard when the content unmounts — a minimized window has none", async () => {
    const Guarded = defineComponent({
      props: { windowId: { type: String, default: '' } },
      setup() {
        useWindowContext().onBeforeClose(() => false)
        return () => h('p', 'guarded')
      },
    })
    const plugin = createWindows({ components: { guarded: Guarded } })
    const wrapper = mount(defineComponent({ components: { WindowHost }, template: '<WindowHost />' }), {
      global: { plugins: [plugin] },
      attachTo: document.body,
    })
    const win = useWindows()
    const id = win.open('guarded', {})
    await nextTick()

    await expect(win.requestClose(id)).resolves.toBe(false) // mounted: the guard refuses

    win.minimize(id)
    await nextTick()
    // Minimized means unmounted, so the guard died with the content. This is the documented
    // limitation, not an accident: cover a minimized window with the app-wide `beforeClose`.
    await expect(win.requestClose(id)).resolves.toBe(true)
    expect(win.byId(id)).toBeUndefined()
    wrapper.unmount()
  })

  it('honours minW when the window opens', async () => {
    const { win } = app()
    const id = win.open('editor', { id: 1 }, { w: 100, minW: 320 })
    await nextTick()
    expect(win.byId(id)!.w).toBe(320)
  })
})

describe('focus', () => {
  it('moves focus into a new window and hands it back on close', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)

    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 })
    await nextTick()

    // The content has nothing tabbable, so the focusable header takes it.
    expect(document.activeElement).toBe(wrapper.find('.vw__head').element)

    win.close(id)
    await nextTick()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('lands on the first tabbable element in the content, not the header', async () => {
    const Form = defineComponent({
      props: { windowId: { type: String, default: '' } },
      render: () => h('form', [h('input', { class: 'first' }), h('input', { class: 'second' })]),
    })
    const plugin = createWindows({ components: { form: Form } })
    const wrapper = mount(defineComponent({ components: { WindowHost }, template: '<WindowHost />' }), {
      global: { plugins: [plugin] },
      attachTo: document.body,
    })
    useWindows().open('form', {})
    await nextTick()

    expect(document.activeElement).toBe(wrapper.find('input.first').element)
    wrapper.unmount()
  })

  it('hands focus on when async content arrives after the mount', async () => {
    let resolve!: (c: unknown) => void
    const Late = defineAsyncComponent(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    const plugin = createWindows({ components: { late: Late } })
    const wrapper = mount(defineComponent({ components: { WindowHost }, template: '<WindowHost />' }), {
      global: { plugins: [plugin] },
      attachTo: document.body,
    })
    useWindows().open('late', {})
    await nextTick()

    // Nothing has rendered yet, so the focusable header holds focus for now.
    const head = wrapper.find('.vw__head').element
    expect(document.activeElement).toBe(head)

    resolve(defineComponent({ render: () => h('input', { class: 'late-input' }) }))
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()

    expect(document.activeElement).toBe(wrapper.find('input.late-input').element)
    wrapper.unmount()
  })

  it('leaves late content alone once the user has moved focus', async () => {
    let resolve!: (c: unknown) => void
    const Late = defineAsyncComponent(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    const plugin = createWindows({ components: { late: Late } })
    const wrapper = mount(defineComponent({ components: { WindowHost }, template: '<WindowHost />' }), {
      global: { plugins: [plugin] },
      attachTo: document.body,
    })
    useWindows().open('late', {})
    await nextTick()

    const elsewhere = document.createElement('button')
    document.body.appendChild(elsewhere)
    elsewhere.focus()

    resolve(defineComponent({ render: () => h('input', { class: 'late-input' }) }))
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()

    expect(document.activeElement).toBe(elsewhere) // not stolen back
    elsewhere.remove()
    wrapper.unmount()
  })

  it('leaves focus alone when a window is only minimized', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    const { wrapper, win } = app()
    const id = win.open('editor', { id: 1 })
    await nextTick()
    const head = wrapper.find('.vw__head').element
    expect(document.activeElement).toBe(head)

    win.minimize(id)
    await nextTick()
    expect(document.activeElement).not.toBe(opener)
    opener.remove()
  })
})

describe('non-modal', () => {
  it('never calls showModal, and a teleported popper escapes the window', async () => {
    const showModal = vi.fn()
    const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal?: () => void }
    const original = proto.showModal
    proto.showModal = showModal

    const Popper = defineComponent({
      props: { windowId: { type: String, default: '' } },
      render: () => h('div', [h(Teleport, { to: 'body' }, [h('span', { class: 'popper' }, 'menu')])]),
    })
    const plugin = createWindows({ components: { popper: Popper } })
    const wrapper = mount(defineComponent({ components: { WindowHost }, template: '<WindowHost />' }), {
      global: { plugins: [plugin] },
      attachTo: document.body,
    })
    useWindows().open('popper', {})
    await nextTick()

    const dialog = wrapper.find('dialog.vw').element
    const popper = document.querySelector('.popper')
    expect(dialog.hasAttribute('open')).toBe(true) // show(), not showModal()
    expect(showModal).not.toHaveBeenCalled()
    expect(popper).not.toBeNull()
    expect(dialog.contains(popper)).toBe(false) // really teleported out of the window

    wrapper.unmount()
    if (original) proto.showModal = original
    else delete proto.showModal
  })
})
