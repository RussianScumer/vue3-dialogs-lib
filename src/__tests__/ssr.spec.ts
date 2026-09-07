// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

/**
 * Guards the rule that nothing DOM-touching runs at module scope or at install time. A library
 * whose import crashes in Node cannot be used by any framework that renders on the server.
 */
describe('SSR', () => {
  it('imports and installs with no window or document present', async () => {
    expect(globalThis.window).toBeUndefined()

    const lib = await import('../index')
    const Stub = { render: () => h('div', 'content') }
    const app = createSSRApp({
      components: { WindowHost: lib.WindowHost },
      template: '<div><WindowHost /></div>',
    })
    app.use(
      lib.createWindows({
        components: { editor: Stub },
        // Persistence is configured but must stay inert without a DOM.
        persist: { key: 'k', storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } },
      }),
    )

    await expect(renderToString(app)).resolves.toContain('<div')
  })

  it('opens a window on the server without touching the DOM', async () => {
    const lib = await import('../index')
    const Stub = { render: () => h('div') }
    const app = createSSRApp({ render: () => h('div') })
    app.use(lib.createWindows({ components: { editor: Stub } }))

    const win = lib.useWindows()
    const id = win.open('editor', { id: 1 }).id
    expect(win.byId(id)).toMatchObject({ name: 'editor', w: 640, h: 480 })
  })
})
