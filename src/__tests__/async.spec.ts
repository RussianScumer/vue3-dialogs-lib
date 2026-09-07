import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createWindows, useWindows } from '../createWindows'
import { resolveOptions } from '../options'
import WindowHost from '../WindowHost.vue'
import type { WindowsApi } from '../state'
import type { WindowsOptions } from '../types'

const Loading = defineComponent({ render: () => h('p', { class: 'loading' }, '...') })

const Failed = defineComponent({
  props: { error: { type: Object, default: null } },
  render() {
    return h('p', { class: 'failed' }, String((this.error as Error | null)?.message ?? ''))
  },
})

const Ok = defineComponent({ render: () => h('p', { class: 'ok' }, 'loaded') })

const Throws = defineComponent({
  setup() {
    throw new Error('boom')
  },
  render: () => h('p', 'never'),
})

/** A loader whose settlement the test controls, so "still pending" is an assertable state. */
function deferred() {
  let settle!: (c: unknown) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<never>((res, rej) => {
    settle = res as (c: unknown) => void
    reject = rej
  })
  return { loader: () => promise, settle, reject }
}

/**
 * The store comes from the mounted app, not from `useWindows()`'s module-level fallback: several
 * apps are mounted in this file and the fallback only ever points at one of them.
 */
function app(options: WindowsOptions) {
  const plugin = createWindows(options)
  const wrapper = mount(
    defineComponent({
      components: { WindowHost },
      setup: () => ({ win: useWindows() }),
      template: '<WindowHost />',
    }),
    { global: { plugins: [plugin] }, attachTo: document.body },
  )
  return { wrapper, win: (wrapper.vm as unknown as { win: WindowsApi }).win }
}

/** Async component state changes settle over microtasks, not ticks. */
async function flush() {
  for (let i = 0; i < 4; i++) await nextTick()
}

describe('async loading and error states', () => {
  it('renders the loading component while the loader is in flight, then the content', async () => {
    const { loader, settle } = deferred()
    const { wrapper, win } = app({
      components: { slow: { component: loader, loadingComponent: Loading, delay: 0 } },
    })

    win.open('slow', {})
    await flush()
    expect(wrapper.find('.loading').exists()).toBe(true)

    settle(Ok)
    await flush()
    expect(wrapper.find('.loading').exists()).toBe(false)
    expect(wrapper.find('.ok').text()).toBe('loaded')
  })

  it('renders the error component, with the error, when the loader rejects', async () => {
    const { loader, reject } = deferred()
    const { wrapper, win } = app({
      components: { broken: { component: loader, errorComponent: Failed } },
    })

    win.open('broken', {})
    await flush()
    reject(new Error('chunk gone'))
    await flush()

    expect(wrapper.find('.failed').text()).toBe('chunk gone')
    expect(wrapper.find('dialog.vw').exists()).toBe(true) // still a window, still closable
  })

  it('gives up on a loader that never settles once the timeout elapses', async () => {
    vi.useFakeTimers()
    try {
      const { loader } = deferred()
      const { wrapper, win } = app({
        components: { hung: { component: loader, errorComponent: Failed, timeout: 50 } },
      })

      win.open('hung', {})
      await flush()
      expect(wrapper.find('.failed').exists()).toBe(false)

      vi.advanceTimersByTime(51)
      await flush()
      expect(wrapper.find('.failed').exists()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders the error state inside the frame of the window that threw, leaving the rest alone', async () => {
    const { wrapper, win } = app({
      components: { bad: { component: Throws, errorComponent: Failed }, good: Ok },
    })

    win.open('good', {})
    win.open('bad', {})
    await flush()

    const dialogs = wrapper.findAll('dialog.vw')
    expect(dialogs).toHaveLength(2)
    expect(wrapper.find('.ok').exists()).toBe(true) // the other window kept rendering
    expect(wrapper.find('.failed').text()).toBe('boom')

    const failed = dialogs[1]
    expect(failed.attributes('data-vw-error')).toBe('')
    expect(failed.find('.vw__head').exists()).toBe(true) // still movable, minimizable, closable
  })

  it('drops the content and stays a usable window when a throwing type has no error component', async () => {
    const { wrapper, win } = app({ components: { bad: Throws } })

    const id = win.open('bad', {}).id
    await flush()

    const dialog = wrapper.find('dialog.vw')
    expect(dialog.attributes('data-vw-error')).toBe('')
    expect(dialog.find('.vw__body').text()).toBe('')

    win.close(id)
    await nextTick()
    expect(wrapper.find('dialog.vw').exists()).toBe(false)
  })

  it('falls back to the app-wide async options, and lets a type override them key by key', async () => {
    const { loader } = deferred()
    const OtherLoading = defineComponent({ render: () => h('p', { class: 'own-loading' }, '...') })
    const options = resolveOptions({
      components: {
        a: { component: loader },
        b: { component: loader, loadingComponent: OtherLoading },
      },
      async: { loadingComponent: Loading, errorComponent: Failed, delay: 0 },
    })

    expect(options.errorComponentFor('a')).toBe(Failed)
    expect(options.errorComponentFor('b')).toBe(Failed) // only the spinner was overridden
    expect(options.errorComponentFor('unknown')).toBe(Failed)

    const { wrapper, win } = app({
      components: {
        a: { component: loader },
        b: { component: loader, loadingComponent: OtherLoading },
      },
      async: { loadingComponent: Loading, delay: 0 },
    })
    win.open('a', {})
    win.open('b', {})
    await flush()
    expect(wrapper.find('.loading').exists()).toBe(true)
    expect(wrapper.find('.own-loading').exists()).toBe(true)
  })

  it('keeps the async keys off the descriptor and out of the window defaults', async () => {
    const options = resolveOptions({
      components: { a: { component: Ok, loadingComponent: Loading, delay: 0, timeout: 10, w: 400 } },
    })
    expect(options.defaultsFor('a')).toEqual({ w: 400 })

    const { win } = app({
      components: { a: { component: Ok, loadingComponent: Loading, delay: 0, timeout: 10, w: 400 } },
    })
    const d = win.byId(win.open('a', {}).id)!
    expect(d.w).toBe(400)
    expect(Object.keys(d)).not.toContain('timeout')
    expect(Object.keys(d)).not.toContain('loadingComponent')
  })
})
