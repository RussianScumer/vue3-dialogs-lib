import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createStore } from '../state'
import { resolveOptions } from '../options'
import { createWindows, useWindows } from '../createWindows'
import { useWindowContext } from '../useWindowContext'
import WindowHost from '../WindowHost.vue'
import WindowTaskbar from '../WindowTaskbar.vue'
import type { BeforeCloseGuard } from '../types'

const Stub = { render: () => h('div') }

function store(beforeClose?: BeforeCloseGuard) {
  return createStore(resolveOptions({ components: { editor: Stub }, beforeClose }))
}

/** A guard the test settles by hand, which is the whole point of an async guard. */
function deferred() {
  let settle: (ok: boolean) => void = () => {}
  const promise = new Promise<boolean>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('async close guards', () => {
  it('keeps the window while an async guard is deciding, and closes when it allows', async () => {
    const win = store()
    const id = win.open('editor', { id: 1 }).id
    const answer = deferred()
    win.onBeforeClose(id, () => answer.promise)

    const request = win.requestClose(id)
    expect(win.isClosing(id)).toBe(true)
    expect(win.byId(id)).toBeDefined()

    answer.settle(true)
    await expect(request).resolves.toBe(true)
    expect(win.isClosing(id)).toBe(false)
    expect(win.byId(id)).toBeUndefined()
  })

  it('resolves false and clears the flag when the guard refuses later', async () => {
    const win = store()
    const id = win.open('editor', { id: 1 }).id
    const answer = deferred()
    win.onBeforeClose(id, () => answer.promise)

    const request = win.requestClose(id)
    answer.settle(false)

    await expect(request).resolves.toBe(false)
    expect(win.byId(id)).toBeDefined()
    expect(win.isClosing(id)).toBe(false)
  })

  it('an app-wide async guard covers a minimized window, whose own guard is gone', async () => {
    const answer = deferred()
    const beforeClose = vi.fn(() => answer.promise)
    const win = store(beforeClose)
    const id = win.open('editor', { id: 1 }).id
    win.minimize(id)

    const request = win.requestClose(id)
    expect(win.isClosing(id)).toBe(true)
    answer.settle(false)

    await expect(request).resolves.toBe(false)
    expect(beforeClose).toHaveBeenCalledTimes(1)
    expect(win.byId(id)).toBeDefined()
  })

  it('joins a second request to the pending one instead of asking twice', async () => {
    const win = store()
    const id = win.open('editor', { id: 1 }).id
    const answer = deferred()
    const guard = vi.fn(() => answer.promise)
    win.onBeforeClose(id, guard)

    const first = win.requestClose(id)
    const second = win.requestClose(id)
    expect(second).toBe(first)

    answer.settle(false)
    expect(await first).toBe(await second)
    expect(guard).toHaveBeenCalledTimes(1)

    // Settled: the next request asks again rather than replaying the old answer.
    const again = win.requestClose(id)
    expect(again).not.toBe(first)
    expect(win.isClosing(id)).toBe(true)
    expect(guard).toHaveBeenCalledTimes(2)
    await expect(again).resolves.toBe(false)
  })

  it('treats a guard that throws as a veto, and warns in dev', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const win = store()
    const sync = win.open('editor', { id: 1 }).id
    win.onBeforeClose(sync, () => {
      throw new Error('boom')
    })
    const async = win.open('editor', { id: 2 }).id
    win.onBeforeClose(async, () => Promise.reject(new Error('boom')))

    await expect(win.requestClose(sync)).resolves.toBe(false)
    await expect(win.requestClose(async)).resolves.toBe(false)
    expect(win.byId(sync)).toBeDefined()
    expect(win.byId(async)).toBeDefined()
    expect(win.isClosing(sync)).toBe(false)
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[0]?.[0]).toMatch(/close guard/)
  })

  it('an app-wide guard that throws vetoes too', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const win = store(() => {
      throw new Error('boom')
    })
    const id = win.open('editor', { id: 1 }).id

    await expect(win.requestClose(id)).resolves.toBe(false)
    expect(win.byId(id)).toBeDefined()
  })

  it('close() ignores a pending guard entirely — logout must never be blockable', async () => {
    const win = store()
    const id = win.open('editor', { id: 1 }).id
    const answer = deferred()
    win.onBeforeClose(id, () => answer.promise)

    const request = win.requestClose(id)
    win.close(id)

    expect(win.byId(id)).toBeUndefined()
    expect(win.isClosing(id)).toBe(false)

    // The guard still answers; the window it was guarding is already gone, and nothing throws.
    answer.settle(false)
    await expect(request).resolves.toBe(false)
    expect(win.byId(id)).toBeUndefined()
  })

  it('closeAll() ignores pending guards and leaves no window closing', async () => {
    const win = store()
    const a = win.open('editor', { id: 1 }).id
    const b = win.open('editor', { id: 2 }).id
    const answer = deferred()
    win.onBeforeClose(a, () => answer.promise)
    win.onBeforeClose(b, () => answer.promise)

    const requests = Promise.all([win.requestClose(a), win.requestClose(b)])
    win.closeAll()

    expect(win.s.stack).toHaveLength(0)
    expect(win.isClosing(a)).toBe(false)
    expect(win.isClosing(b)).toBe(false)

    answer.settle(true)
    await expect(requests).resolves.toEqual([true, true])
    expect(win.s.stack).toHaveLength(0)
  })

  it('does not persist the pending state: it is on no descriptor, and hydrate clears it', async () => {
    const win = store()
    const id = win.open('editor', { id: 1 }).id
    const answer = deferred()
    win.onBeforeClose(id, () => answer.promise)
    const request = win.requestClose(id)

    expect(win.isClosing(id)).toBe(true)
    expect(JSON.stringify(win.s)).not.toContain('closing')

    // A reload while a guard is out brings back an ordinary window.
    const stack = JSON.parse(JSON.stringify(win.s.stack))
    win.hydrate(stack, win.s.topZ)
    expect(win.isClosing(id)).toBe(false)

    answer.settle(true)
    await request
  })
})

/** A window whose content refuses to close until the test lets it. */
const answer = { current: deferred() }

const Guarded = defineComponent({
  props: { windowId: { type: String, default: '' } },
  setup() {
    useWindowContext().onBeforeClose(() => answer.current.promise)
    return () => h('p', 'guarded')
  },
})

describe('the pending state in the view', () => {
  it('disables the default close and minimize controls while a guard is out', async () => {
    answer.current = deferred()
    const plugin = createWindows({ components: { guarded: Guarded } })
    const wrapper = mount(defineComponent({ components: { WindowHost }, template: '<WindowHost />' }), {
      global: { plugins: [plugin] },
      attachTo: document.body,
    })
    const win = useWindows()
    const id = win.open('guarded', {}).id
    await nextTick()

    const buttons = () => wrapper.findAll('.vw__btn')
    expect(buttons().map((b) => b.attributes('disabled'))).toEqual([undefined, undefined])

    const request = win.requestClose(id)
    await nextTick()
    expect(buttons().map((b) => b.attributes('disabled'))).toEqual(['', ''])

    answer.current.settle(false)
    await request
    await nextTick()
    expect(buttons().map((b) => b.attributes('disabled'))).toEqual([undefined, undefined])
    wrapper.unmount()
  })

  it('exposes the pending state in the taskbar slot props', async () => {
    answer.current = deferred()
    const plugin = createWindows({ components: { guarded: Guarded } })
    const wrapper = mount(
      defineComponent({
        components: { WindowHost, WindowTaskbar },
        template: `<WindowHost /><WindowTaskbar v-slot="{ all, closing }">
          <b class="pending">{{ all.filter((w) => closing(w.id)).length }}</b>
        </WindowTaskbar>`,
      }),
      { global: { plugins: [plugin] }, attachTo: document.body },
    )
    const win = useWindows()
    const id = win.open('guarded', {}).id
    await nextTick()
    expect(wrapper.find('.pending').text()).toBe('0')

    const request = win.requestClose(id)
    await nextTick()
    expect(wrapper.find('.pending').text()).toBe('1')

    answer.current.settle(false)
    await request
    await nextTick()
    expect(wrapper.find('.pending').text()).toBe('0')
    wrapper.unmount()
  })
})
