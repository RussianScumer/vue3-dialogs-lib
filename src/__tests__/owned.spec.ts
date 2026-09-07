import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createStore } from '../state'
import { resolveOptions } from '../options'
import { createWindows, useWindows } from '../createWindows'
import { SCHEMA, setupPersist } from '../persist'
import WindowHost from '../WindowHost.vue'
import type { StorageLike, WindowDescriptor, WindowsOptions } from '../types'
import type { WindowsApi } from '../state'

/**
 * Owned child windows: the store half here, in jsdom, because ownership is bookkeeping — who owns
 * whom, what closes with what, what never reaches storage. What jsdom cannot answer is whether
 * `inert` actually stops anything, which is the UA's own contract and lives in the browser spec.
 * The attribute itself is asserted here, since setting it is the library's half of that contract.
 */

const Stub = { render: () => h('div') }

function store(over: Partial<WindowsOptions> = {}) {
  return createStore(resolveOptions({ components: { editor: Stub, confirm: Stub }, ...over }))
}

const Content = defineComponent({
  props: { windowId: { type: String, default: '' } },
  render() {
    return h('p', { class: 'content' })
  },
})

let wrapper: VueWrapper | null = null

/** The store comes from the mounted app: this file mounts one per test. */
function app() {
  const plugin = createWindows({ components: { editor: Content, confirm: Content } })
  wrapper = mount(
    defineComponent({
      components: { WindowHost },
      setup: () => ({ win: useWindows() }),
      template: '<WindowHost />',
    }),
    { global: { plugins: [plugin] }, attachTo: document.body },
  )
  return { wrapper, win: (wrapper.vm as unknown as { win: WindowsApi }).win }
}

function dialogs(): HTMLDialogElement[] {
  return [...document.querySelectorAll<HTMLDialogElement>('dialog.vw')]
}

function memoryStorage(seed?: string): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  if (seed) data.set('k', seed)
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.restoreAllMocks()
})

describe('owned child windows', () => {
  it('renders directly above its owner and keeps the pair together on focus', () => {
    const win = store()
    const other = win.open('editor', { id: 0 }).id
    const owner = win.open('editor', { id: 1 }).id
    const child = win.open('confirm', {}, { owner }).id

    expect(win.ownerOf(child)).toBe(owner)
    expect(win.byId(child)!.z).toBe(win.byId(owner)!.z + 1)
    expect(win.byId(owner)!.z).toBeGreaterThan(win.byId(other)!.z)
    expect(win.activeId.value).toBe(child)

    // Focusing the other window puts it on top of both; focusing the owner brings the pair back
    // with their relative order intact — the child can never end up under the window it belongs to.
    win.focus(other)
    expect(win.byId(other)!.z).toBeGreaterThan(win.byId(child)!.z)

    win.focus(owner)
    expect(win.byId(child)!.z).toBe(win.byId(owner)!.z + 1)
    expect(win.byId(owner)!.z).toBeGreaterThan(win.byId(other)!.z)
    expect(win.activeId.value).toBe(child)
  })

  it('is closable, is not minimizable, and skips dedupe', () => {
    const win = store()
    const owner = win.open('editor', { id: 1 }).id
    const a = win.open('confirm', { q: 1 }, { owner, closable: false, minimizable: true }).id
    const b = win.open('confirm', { q: 1 }, { owner }).id

    expect(win.byId(a)).toMatchObject({ closable: true, minimizable: false })
    expect(b).not.toBe(a) // same name, shallow-equal props: an ordinary open would have deduped
    expect(win.childrenOf(owner)).toEqual([a, b])
    expect(win.minimize(a)).toBe(a)
    expect(win.byId(a)!.minimized).toBe(false)
  })

  it('sets inert on its owner and on nothing else', async () => {
    const { win } = app()
    win.open('editor', { id: 0 })
    const owner = win.open('editor', { id: 1 }).id
    await nextTick()

    const [siblingEl, ownerEl] = dialogs()
    expect(ownerEl!.hasAttribute('inert')).toBe(false)

    win.open('confirm', {}, { owner })
    await nextTick()

    expect(ownerEl!.hasAttribute('inert')).toBe(true)
    expect(siblingEl!.hasAttribute('inert')).toBe(false)
    expect(dialogs()[2]!.hasAttribute('inert')).toBe(false)
  })

  it('clears inert exactly back to what it was when the child closes', async () => {
    const { win } = app()
    const owner = win.open('editor', { id: 1 }).id
    const preset = win.open('editor', { id: 2 }).id
    await nextTick()

    // A consumer who set inert themselves must get it back, not lose it to the library.
    const [ownerEl, presetEl] = dialogs()
    presetEl!.setAttribute('inert', '')

    const a = win.open('confirm', { q: 1 }, { owner }).id
    const b = win.open('confirm', { q: 2 }, { owner: preset }).id
    await nextTick()
    expect(ownerEl!.hasAttribute('inert')).toBe(true)

    win.close(a)
    win.close(b)
    await nextTick()
    expect(ownerEl!.hasAttribute('inert')).toBe(false)
    expect(presetEl!.hasAttribute('inert')).toBe(true)
  })

  it('keeps the owner inert while any of its children is still open', async () => {
    const { win } = app()
    const owner = win.open('editor', { id: 1 }).id
    await nextTick()
    const ownerEl = dialogs()[0]!

    const a = win.open('confirm', { q: 1 }, { owner }).id
    const b = win.open('confirm', { q: 2 }, { owner }).id
    await nextTick()

    win.close(a)
    await nextTick()
    expect(ownerEl.hasAttribute('inert')).toBe(true)

    win.close(b)
    await nextTick()
    expect(ownerEl.hasAttribute('inert')).toBe(false)
  })

  it('closes the child with the owner, and leaves the owner when the child goes', () => {
    const win = store()
    const owner = win.open('editor', { id: 1 }).id
    const child = win.open('confirm', {}, { owner }).id
    const grandchild = win.open('confirm', { q: 2 }, { owner: child }).id

    win.close(child)
    expect(win.byId(child)).toBeUndefined()
    expect(win.byId(grandchild)).toBeUndefined() // a sheet never outlives what it belongs to
    expect(win.byId(owner)).toBeDefined()
    expect(win.hasChild(owner)).toBe(false)

    const second = win.open('confirm', {}, { owner }).id
    win.close(owner)
    expect(win.s.stack).toHaveLength(0)
    expect(win.ownerOf(second)).toBeNull()
  })

  it('emits close for the child before the owner', () => {
    const win = store()
    const seen: string[] = []
    const owner = win.open('editor', { id: 1 }).id
    const child = win.open('confirm', {}, { owner }).id
    win.on('close', (e) => void seen.push(e.id))

    win.close(owner)
    expect(seen).toEqual([child, owner])
  })

  it('refuses to minimize or requestClose an owner while its child is open', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const win = store()
    const owner = win.open('editor', { id: 1 }).id
    const child = win.open('confirm', {}, { owner }).id

    win.minimize(owner)
    expect(win.byId(owner)!.minimized).toBe(false)
    await expect(win.requestClose(owner)).resolves.toBe(false)
    expect(win.byId(owner)).toBeDefined()
    expect(win.isClosing(owner)).toBe(false)
    expect(warn).toHaveBeenCalledTimes(2)

    // Answer the child and both are ordinary again.
    win.close(child)
    win.minimize(owner)
    expect(win.byId(owner)!.minimized).toBe(true)
  })

  it('joins the request whose own guard opened the child, rather than refusing it', async () => {
    const win = store()
    const owner = win.open('editor', { id: 1 }).id
    let settle: (ok: boolean) => void = () => {}
    let child = ''
    // The shape the feature exists for: the guard asks its question in a window of its own.
    win.onBeforeClose(owner, () => {
      child = win.open('confirm', {}, { owner }).id
      return new Promise<boolean>((resolve) => {
        settle = resolve
      })
    })

    const first = win.requestClose(owner)
    expect(win.hasChild(owner)).toBe(true)
    // Refusing here would answer "the window stayed open" while the real answer is still out. The
    // request is already pending, so a second one joins it — which *is* "answer the child first".
    expect(win.requestClose(owner)).toBe(first)

    settle(true)
    await expect(first).resolves.toBe(true)
    expect(win.byId(owner)).toBeUndefined()
    expect(win.byId(child)).toBeUndefined()
  })

  it('brings a minimized owner back when a child is opened on it', () => {
    const win = store()
    const owner = win.open('editor', { id: 1 }).id
    win.minimize(owner)

    const child = win.open('confirm', {}, { owner }).id
    expect(win.byId(owner)!.minimized).toBe(false)
    expect(win.byId(child)!.z).toBe(win.byId(owner)!.z + 1)
  })

  it('does not count towards maxWindows and never evicts to make room', () => {
    const win = store({ maxWindows: 8 })
    const owner = win.open('editor', { id: 1 }).id
    const others = Array.from({ length: 6 }, (_, i) => win.open('editor', { id: i + 2 }).id)

    for (let i = 0; i < 20; i++) win.open('confirm', { q: i }, { owner })

    expect(win.byId(owner)).toBeDefined()
    expect(others.every((id) => win.byId(id))).toBe(true)
    expect(win.childrenOf(owner)).toHaveLength(20)
    expect(win.s.stack).toHaveLength(27)
  })

  it('evicts the oldest unowned window, never a child, when the limit is reached', () => {
    const win = store({ maxWindows: 2 })
    const first = win.open('editor', { id: 1 }).id
    const child = win.open('confirm', {}, { owner: first }).id
    const second = win.open('editor', { id: 2 }).id

    win.open('editor', { id: 3 })
    // `first` was the oldest root; its child goes with it, and nothing else is touched.
    expect(win.byId(first)).toBeUndefined()
    expect(win.byId(child)).toBeUndefined()
    expect(win.byId(second)).toBeDefined()
  })

  it('throws at call time for an unknown owner and for a chain that is too deep', () => {
    const win = store()
    expect(() => win.open('confirm', {}, { owner: 'nope' }).id).toThrow(/unknown owner/)

    const root = win.open('editor', { id: 1 }).id
    let last = root
    for (let i = 0; i < 3; i++) last = win.open('confirm', { q: i }, { owner: last }).id
    expect(() => win.open('confirm', { q: 9 }, { owner: last }).id).toThrow(/owner chain/)
    expect(win.s.stack).toHaveLength(4)
  })

  it('never reaches storage, and is dropped from a hand-crafted blob', async () => {
    vi.useFakeTimers()
    const storage = memoryStorage()
    const options = resolveOptions({
      components: { editor: Stub, confirm: Stub },
      persist: { key: 'k', storage },
    })
    const win = createStore(options)
    setupPersist(win, options)

    const owner = win.open('editor', { id: 1 }).id
    win.open('confirm', {}, { owner })
    await nextTick()
    vi.advanceTimersByTime(300)
    vi.useRealTimers()

    const written = JSON.parse(storage.data.get('k')!) as { stack: WindowDescriptor[] }
    expect(written.stack).toHaveLength(1)
    expect(written.stack[0]!.id).toBe(owner)
    expect(JSON.stringify(written)).not.toContain('"owner"')

    // The reverse direction: a blob that claims one anyway loses it rather than restoring a sheet
    // with nothing to answer.
    const blob = {
      schema: SCHEMA,
      topZ: 12,
      stack: [
        { id: 'a', name: 'editor', props: {}, state: null, title: 'A', minimized: false, x: 1, y: 1, w: 300, h: 200, z: 11, meta: {} },
        { id: 'b', name: 'confirm', props: {}, state: null, title: 'B', minimized: false, x: 1, y: 1, w: 300, h: 200, z: 12, meta: {}, owner: 'a' },
      ],
    }
    const second = resolveOptions({
      components: { editor: Stub, confirm: Stub },
      persist: { key: 'k', storage: memoryStorage(JSON.stringify(blob)) },
    })
    const restored = createStore(second)
    expect(() => setupPersist(restored, second)).not.toThrow()
    expect(restored.s.stack.map((w) => w.id)).toEqual(['a'])
    expect(restored.hasChild('a')).toBe(false)
  })

  it('forgets ownership on closeAll and on hydrate', () => {
    const win = store()
    const owner = win.open('editor', { id: 1 }).id
    const child = win.open('confirm', {}, { owner }).id

    win.closeAll()
    expect(win.ownerOf(child)).toBeNull()

    const again = win.open('editor', { id: 1 }).id
    const kid = win.open('confirm', {}, { owner: again }).id
    win.hydrate([win.byId(again)!], 12)
    expect(win.ownerOf(kid)).toBeNull()
    expect(win.hasChild(again)).toBe(false)
  })

  it('dismisses the child on ESC instead of minimizing it, and gives focus back to the owner', async () => {
    const { win } = app()
    const owner = win.open('editor', { id: 1 }).id
    const child = win.open('confirm', {}, { owner }).id
    await nextTick()

    const [ownerEl, childEl] = dialogs()
    childEl!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()

    expect(win.byId(child)).toBeUndefined()
    expect(win.byId(owner)!.minimized).toBe(false)
    await nextTick()
    expect(document.activeElement).toBe(ownerEl!.querySelector('.vw__head'))
  })

  it('leaves the window alone when ESC is pressed on a window that is not a child', async () => {
    const { win } = app()
    const id = win.open('editor', { id: 1 }).id
    await nextTick()

    dialogs()[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(win.byId(id)!.minimized).toBe(true) // unchanged: ESC still minimizes an ordinary window
  })
})
