import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createWindows, useWindows } from '../createWindows'
import WindowHost from '../WindowHost.vue'
import '../style.css'
import '../themes/all.css'

/**
 * What `themes.spec.ts` cannot answer: whether the palettes actually reach a window. They declare
 * `--vtd-*` on `<html>` and the baseline sheet reads them through its private `--_vtd-*` aliases,
 * so nothing here works without a real cascade. Chromium resolves it; jsdom has none.
 *
 * The second question is the one the `:where()` wrapper exists for — a palette is the first thing
 * in the library to *declare* a public property rather than only read it, and that must not cost a
 * consumer their override.
 */

const Content = defineComponent({
  props: { windowId: { type: String, default: '' } },
  render() {
    return h('p', { class: 'content' }, 'content')
  },
})

let wrapper: VueWrapper | null = null
let override: HTMLStyleElement | null = null

function app() {
  const plugin = createWindows({ components: { editor: Content }, mobileBreakpoint: 0 })
  wrapper = mount(defineComponent({ render: () => h(WindowHost) }), {
    global: { plugins: [plugin] },
    attachTo: document.body,
  })
  return { win: useWindows() }
}

async function themedWindow(theme: string) {
  document.documentElement.setAttribute('data-vtd-theme', theme)
  const { win } = app()
  win.open('editor', {}, { x: 40, y: 40, w: 320, h: 240 })
  await nextTick()
  return document.querySelector('dialog.vw') as HTMLElement
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.documentElement.removeAttribute('data-vtd-theme')
  document.documentElement.classList.remove('vtd-theme-nord')
  override?.remove()
  override = null
})

describe('theme presets, resolved', () => {
  it('paints the frame and the header from the attribute form', async () => {
    const dialog = await themedWindow('dracula')
    const head = dialog.querySelector('.vw__head') as HTMLElement

    expect(getComputedStyle(dialog).backgroundColor).toBe('rgb(40, 42, 54)')
    expect(getComputedStyle(dialog).color).toBe('rgb(248, 248, 242)')
    expect(getComputedStyle(head).backgroundColor).toBe('rgb(68, 71, 90)')
  })

  it('reaches the same window through the class form', async () => {
    document.documentElement.classList.add('vtd-theme-nord')
    const { win } = app()
    win.open('editor', {}, { x: 40, y: 40, w: 320, h: 240 })
    await nextTick()

    const dialog = document.querySelector('dialog.vw') as HTMLElement
    expect(getComputedStyle(dialog).backgroundColor).toBe('rgb(46, 52, 64)')
  })

  it('accents the active window through --vtd-border-active', async () => {
    const dialog = await themedWindow('dracula')
    expect(dialog.hasAttribute('data-vw-active')).toBe(true)
    expect(getComputedStyle(dialog).borderColor).toBe('rgb(189, 147, 249)')
  })

  it('tints the scrim from the palette rather than the baseline dark default', async () => {
    document.documentElement.setAttribute('data-vtd-theme', 'github-light')
    const { win } = app()
    win.open('editor', {}, { x: 40, y: 40, w: 320, h: 240, modal: true })
    await nextTick()

    const scrim = document.querySelector('.vw-scrim') as HTMLElement
    expect(getComputedStyle(scrim).backgroundColor).toBe('rgba(0, 0, 0, 0.4)')
  })

  it('scopes color-scheme to the frame and leaves the page alone', async () => {
    // The whole point of `--vtd-color-scheme`: the attribute sits on <html>, so a palette that
    // declared `color-scheme` directly would repaint the page's canvas, its scrollbars and every
    // native control on it. Only the window may change.
    const before = getComputedStyle(document.documentElement).colorScheme
    const dialog = await themedWindow('dracula')

    expect(getComputedStyle(dialog).colorScheme).toBe('dark')
    expect(getComputedStyle(document.documentElement).colorScheme).toBe(before)
    expect(getComputedStyle(document.body).backgroundColor).toBe('rgba(0, 0, 0, 0)')
  })

  it('lets a consumer declaration beat the palette', async () => {
    // A stylesheet rule rather than an inline property: inline would win against anything and so
    // would prove nothing. `:root` is one id-less selector, and it beats the palette only because
    // `:where()` holds the palette at zero specificity — no `!important`, nothing to out-specify,
    // which is the contract `style.css` documents.
    override = document.createElement('style')
    override.textContent = ':root { --vtd-bg: rgb(1, 2, 3); }'
    document.head.append(override)
    const dialog = await themedWindow('dracula')

    expect(getComputedStyle(dialog).backgroundColor).toBe('rgb(1, 2, 3)')
    // Untouched tokens still come from the palette.
    expect(getComputedStyle(dialog).color).toBe('rgb(248, 248, 242)')
  })
})
