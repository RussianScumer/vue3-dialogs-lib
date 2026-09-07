import { bench, describe } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createWindows, useWindows } from '../createWindows'
import WindowHost from '../WindowHost.vue'

// Content heavy enough that mounting it is visible in the numbers — the point of
// unmounting on minimize is that this cost disappears entirely.
const Content = defineComponent({
  props: { id: { type: Number, default: 0 }, windowId: { type: String, default: '' } },
  setup() {
    const rows = ref(Array.from({ length: 200 }, (_, i) => `row ${i}`))
    return () => h('ul', rows.value.map((r) => h('li', r)))
  },
})

const Root = defineComponent({
  components: { WindowHost },
  template: '<WindowHost />',
})

function app(windows: number, minimized: boolean) {
  const plugin = createWindows({ components: { editor: Content }, maxWindows: 100000 })
  const wrapper = mount(Root, { global: { plugins: [plugin] }, attachTo: document.body })
  const win = useWindows()
  for (let i = 0; i < windows; i++) {
    const id = win.open('editor', { id: i }).id
    if (minimized) win.minimize(id)
  }
  return { wrapper, win }
}

describe('render cost by window count', () => {
  bench('mount host + 1 open window', async () => {
    const { wrapper } = app(1, false)
    await nextTick()
    wrapper.unmount()
  })

  bench('mount host + 8 open windows', async () => {
    const { wrapper } = app(8, false)
    await nextTick()
    wrapper.unmount()
  })

  bench('mount host + 8 minimized windows (content must not mount)', async () => {
    const { wrapper } = app(8, true)
    await nextTick()
    wrapper.unmount()
  })

  bench('mount host + 100 minimized windows', async () => {
    const { wrapper } = app(100, true)
    await nextTick()
    wrapper.unmount()
  })
})

describe('interaction with 8 windows open', () => {
  bench('minimize one (unmounts its content)', async () => {
    const { wrapper, win } = app(8, false)
    await nextTick()
    win.minimize(win.s.stack[0]!.id)
    await nextTick()
    wrapper.unmount()
  })

  bench('restore one (remounts its content)', async () => {
    const { wrapper, win } = app(8, false)
    const id = win.s.stack[0]!.id
    win.minimize(id)
    await nextTick()
    win.restore(id)
    await nextTick()
    wrapper.unmount()
  })

  bench('60 drag frames on one window', async () => {
    const { wrapper, win } = app(8, false)
    await nextTick()
    const d = win.s.stack[0]!
    for (let i = 0; i < 60; i++) {
      d.x = 100 + i
      d.y = 100 + i
      await nextTick()
    }
    wrapper.unmount()
  })

  bench('focus (z bump) 60 times', async () => {
    const { wrapper, win } = app(8, false)
    await nextTick()
    const ids = win.s.stack.map((w) => w.id)
    for (let i = 0; i < 60; i++) {
      win.focus(ids[i % ids.length]!)
      await nextTick()
    }
    wrapper.unmount()
  })
})
