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

// jsdom has no PointerEvent; a MouseEvent carrying a pointerId is all the drag handler reads.
function pointer(el: Element, type: string, clientX: number, clientY: number) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY })
  Object.assign(e, { pointerId: 1 })
  el.dispatchEvent(e)
}

function app(windows: number, minimized: boolean) {
  const plugin = createWindows({ components: { editor: Content }, maxWindows: 100000,
    labels: { minimize: 'Minimize', close: 'Close', pin: 'Pin' } })
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

  // The desktop is mounted once and kept: the gesture is what is measured, not the mount around it.
  let dragged: ReturnType<typeof app> | null = null
  bench('100 pointermoves on one window', async () => {
    if (!dragged) {
      dragged = app(8, false)
      await nextTick()
    }
    // Back to the same spot every iteration, or the window soon sits clamped at the edge and the
    // moves stop changing anything.
    Object.assign(dragged.win.s.stack[0]!, { x: 100, y: 100 })
    await nextTick()
    const head = dragged.wrapper.find('.vw__head').element
    pointer(head, 'pointerdown', 200, 200)
    for (let i = 0; i < 100; i++) {
      pointer(head, 'pointermove', 200 + i, 200 + i)
      await nextTick()
    }
    pointer(head, 'pointerup', 299, 299)
    await nextTick()
  }, { teardown: () => {
    dragged?.wrapper.unmount()
    dragged = null
  } })

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
