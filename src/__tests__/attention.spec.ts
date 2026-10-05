import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createWindows, useWindows } from '../createWindows'
import { createStore } from '../state'
import { resolveOptions } from '../options'
import { useWindowContext } from '../useWindowContext'
import WindowHost from '../WindowHost.vue'
import WindowTaskbar from '../WindowTaskbar.vue'
import type { WindowContext } from '../injection'
import type { WindowEvent } from '../types'

const Stub = defineComponent({ render: () => h('div') })

function store() {
  return createStore(resolveOptions({ components: { editor: Stub } }))
}

/** Two windows, `a` buried under `b`: `b` is the active one. */
function pair() {
  const win = store()
  const a = win.open('editor', { n: 1 }).id
  const b = win.open('editor', { n: 2 }).id
  return { win, a, b }
}

describe('requestAttention — the store', () => {
  it('flags a buried window and fires one attention event', () => {
    const { win, a } = pair()
    const seen: WindowEvent[] = []
    win.on('attention', (e) => seen.push(e))

    expect(win.hasAttention(a)).toBe(false)
    expect(win.requestAttention(a)).toBe(true)
    expect(win.hasAttention(a)).toBe(true)
    expect(seen).toEqual([{ type: 'attention', id: a }])
  })

  it('a second request while the first is unanswered is the same request: no second event', () => {
    const { win, a } = pair()
    const cb = vi.fn()
    win.on('*', cb)
    win.requestAttention(a)
    expect(win.requestAttention(a)).toBe(true)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('refuses for the active window: the user is already looking at it', () => {
    const { win, b } = pair()
    const cb = vi.fn()
    win.on('attention', cb)
    expect(win.requestAttention(b)).toBe(false)
    expect(win.hasAttention(b)).toBe(false)
    expect(cb).not.toHaveBeenCalled()
  })

  it('throws for an unknown id, like every other id-taking method', () => {
    expect(() => store().requestAttention('nope')).toThrow()
  })

  it('a minimized window can ask, and restoring it answers', () => {
    const win = store()
    const a = win.open('editor', { n: 1 }).id
    win.minimize(a)
    expect(win.activeId.value).toBeNull()
    expect(win.requestAttention(a)).toBe(true)

    win.restore(a)
    expect(win.hasAttention(a)).toBe(false)
  })

  it('focus() answers it', () => {
    const { win, a } = pair()
    win.requestAttention(a)
    win.focus(a)
    expect(win.hasAttention(a)).toBe(false)
  })

  it('becoming active by any path answers it: the window above closes', () => {
    const { win, a, b } = pair()
    win.requestAttention(a)
    win.close(b)
    expect(win.activeId.value).toBe(a)
    expect(win.hasAttention(a)).toBe(false)
  })

  it('becoming active by any path answers it: the window above minimizes', () => {
    const { win, a, b } = pair()
    win.requestAttention(a)
    win.minimize(b)
    expect(win.hasAttention(a)).toBe(false)
  })

  it('focusing a different window does not answer it', () => {
    const win = store()
    const a = win.open('editor', { n: 1 }).id
    const b = win.open('editor', { n: 2 }).id
    const c = win.open('editor', { n: 3 }).id
    win.requestAttention(a)
    win.focus(b)
    win.focus(c)
    expect(win.hasAttention(a)).toBe(true)
  })

  it('clearAttention withdraws it without focusing', () => {
    const { win, a, b } = pair()
    win.requestAttention(a)
    win.clearAttention(a)
    expect(win.hasAttention(a)).toBe(false)
    expect(win.activeId.value).toBe(b)
  })

  it('close, closeAll and hydrate drop it', () => {
    const { win, a } = pair()
    win.requestAttention(a)
    win.close(a)
    expect(win.hasAttention(a)).toBe(false)

    const c = win.open('editor', { n: 3 }).id
    win.open('editor', { n: 4 })
    win.requestAttention(c)
    win.closeAll()
    expect(win.hasAttention(c)).toBe(false)

    const d = win.open('editor', { n: 5 })
    const e = win.open('editor', { n: 6 }).id
    win.requestAttention(d.id)
    win.hydrate([{ ...win.byId(d.id)!, z: 1 }, { ...win.byId(e)!, z: 2 }], 2)
    expect(win.hasAttention(d.id)).toBe(false)
  })

  it('never touches the descriptor, so persistence never sees it', () => {
    const { win, a } = pair()
    const before = JSON.stringify(win.s)
    win.requestAttention(a)
    expect(JSON.stringify(win.s)).toBe(before)
  })
})

describe('requestAttention — rendered', () => {
  let wrapper: VueWrapper | null = null
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  let ctx: WindowContext | null = null
  const Asker = defineComponent({
    props: { windowId: { type: String, default: '' }, n: { type: Number, default: 0 } },
    setup(props) {
      if (props.n === 1) ctx = useWindowContext()
      return () => h('p', 'content')
    },
  })

  function app() {
    let seen: ((id: string) => boolean) | null = null
    wrapper = mount(
      defineComponent({
        render: () => [
          h(WindowHost),
          h(WindowTaskbar, null, {
            default: ({ attention }: { attention: (id: string) => boolean }) => {
              seen = attention
              return h('div')
            },
          }),
        ],
      }),
      { global: { plugins: [createWindows({ components: { asker: Asker } })] }, attachTo: document.body },
    )
    return { win: useWindows(), attention: () => seen! }
  }

  const frame = (id: string) => document.querySelector(`dialog.vw[aria-label="${id}"]`)!

  it('marks the frame with data-vw-attention, and unmarks it once answered', async () => {
    const { win } = app()
    const a = win.open('asker', { n: 1 }, { title: 'A' }).id
    win.open('asker', { n: 2 }, { title: 'B' })
    await nextTick()
    expect(frame('A').hasAttribute('data-vw-attention')).toBe(false)

    win.requestAttention(a)
    await nextTick()
    expect(frame('A').getAttribute('data-vw-attention')).toBe('true')
    expect(frame('B').hasAttribute('data-vw-attention')).toBe(false)

    win.focus(a)
    await nextTick()
    expect(frame('A').hasAttribute('data-vw-attention')).toBe(false)
  })

  it('hands the taskbar an attention(id) slot prop', async () => {
    const { win, attention } = app()
    const a = win.open('asker', { n: 1 }, { title: 'A' }).id
    win.open('asker', { n: 2 }, { title: 'B' })
    await nextTick()
    expect(attention()(a)).toBe(false)
    win.requestAttention(a)
    expect(attention()(a)).toBe(true)
  })

  it('the content can ask through its context', async () => {
    const { win } = app()
    const a = win.open('asker', { n: 1 }, { title: 'A' }).id
    win.open('asker', { n: 2 }, { title: 'B' })
    await nextTick()

    expect(ctx!.requestAttention()).toBe(true)
    expect(win.hasAttention(a)).toBe(true)
  })
})
