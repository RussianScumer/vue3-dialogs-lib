import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createStore } from '../state'
import { resolveOptions } from '../options'
import { createWindows, useWindows } from '../createWindows'
import WindowHost from '../WindowHost.vue'
import type { ControlLabels, WindowEntry } from '../types'

const Stub = { render: () => h('div') }

function store(labels?: ControlLabels, components: Record<string, WindowEntry> = { editor: Stub }) {
  return createStore(resolveOptions({ components, labels }))
}

/** A host mounted over a fresh app, so the once-per-app dev warning is fresh with it. */
function app(labels?: ControlLabels, components: Record<string, WindowEntry> = { editor: Stub }) {
  const plugin = createWindows({ components, labels })
  const wrapper = mount(defineComponent({ components: { WindowHost }, template: '<WindowHost />' }), {
    global: { plugins: [plugin] },
    attachTo: document.body,
  })
  return { wrapper, win: useWindows() }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('control labels — store', () => {
  it('returns the app-wide names for a window that named none', () => {
    const win = store({ minimize: 'Minimize', close: 'Close' })
    expect(win.labelsFor(win.open('editor').id)).toEqual({ minimize: 'Minimize', close: 'Close' })
  })

  it('is empty when nothing anywhere names a control', () => {
    const win = store()
    expect(win.labelsFor(win.open('editor').id)).toEqual({})
  })

  it('merges key by key: open() over the spec over the app-wide option', () => {
    const win = store({ minimize: 'Minimize', close: 'Close', pin: 'Pin' }, {
      settings: { component: Stub, labels: { close: 'Close settings', pin: 'Keep settings on top' } },
    })
    const id = win.open('settings', {}, { labels: { close: 'Discard settings' } }).id

    expect(win.labelsFor(id)).toEqual({
      minimize: 'Minimize',
      close: 'Discard settings',
      pin: 'Keep settings on top',
    })
  })

  it('keeps the names off the descriptor, and forgets them on close and hydrate', () => {
    const win = store({ close: 'Close' })
    const id = win.open('editor', {}, { labels: { close: 'Close editor' } }).id
    const d = win.byId(id)!

    expect('labels' in d).toBe(false)
    expect(JSON.stringify(d)).not.toContain('Close editor')

    win.hydrate([{ ...d }], 10)
    expect(win.labelsFor(id)).toEqual({ close: 'Close' })

    const other = win.open('editor', {}, { labels: { close: 'Close other' } }).id
    win.close(other)
    expect(win.labelsFor(other)).toEqual({ close: 'Close' })
  })
})

describe('control labels — frame', () => {
  it('names the default controls, and lets a window override one of them', async () => {
    const { wrapper, win } = app({ minimize: 'Minimize', close: 'Close' })
    win.open('editor', {}, { labels: { close: 'Close editor' } })
    await nextTick()

    const [minimize, close] = wrapper.findAll('.vw__btn')
    expect(minimize!.attributes('aria-label')).toBe('Minimize')
    expect(close!.attributes('aria-label')).toBe('Close editor')
  })

  it('renders no aria-label at all when nothing named the control', async () => {
    const { wrapper, win } = app()
    win.open('editor')
    await nextTick()

    for (const btn of wrapper.findAll('.vw__btn')) {
      expect(btn.attributes('aria-label')).toBeUndefined()
    }
  })

  it('renders the pin toggle as a pressed state, named or not', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { wrapper, win } = app({ minimize: 'Minimize', close: 'Close', pin: 'Pin' })
    const id = win.open('editor', {}, { fixed: false }).id
    await nextTick()

    const pin = () => wrapper.findAll('.vw__btn')[2]!
    expect(pin().attributes('aria-label')).toBe('Pin')
    expect(pin().attributes('aria-pressed')).toBe('false')

    await pin().trigger('click')
    await nextTick()
    expect(win.isPinned(id)).toBe(true)
    expect(pin().attributes('aria-pressed')).toBe('true')
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns once per app about unnamed controls, and not at all when they are named', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const unnamed = app()
    unnamed.win.open('editor')
    unnamed.win.open('editor', { id: 2 })
    await nextTick()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toMatch(/accessible name/)
    unnamed.wrapper.unmount()

    const named = app({ minimize: 'Minimize', close: 'Close' })
    named.win.open('editor')
    await nextTick()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('warns about a control the window itself left unnamed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { win } = app({ minimize: 'Minimize', close: 'Close' })
    // Pin-capable, and `labels.pin` was never given: the third button has no name.
    win.open('editor', {}, { fixed: true })
    await nextTick()

    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('says nothing when the consumer renders their own controls', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const plugin = createWindows({ components: { editor: Stub } })
    const wrapper = mount(
      defineComponent({
        components: { WindowHost },
        template: '<WindowHost><template #controls><button class="mine">x</button></template></WindowHost>',
      }),
      { global: { plugins: [plugin] }, attachTo: document.body },
    )
    useWindows().open('editor')
    await nextTick()

    expect(wrapper.find('.mine').exists()).toBe(true)
    expect(warn).not.toHaveBeenCalled()
  })
})
