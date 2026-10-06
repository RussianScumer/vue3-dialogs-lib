import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { createStore } from '../state'
import { resolveOptions } from '../options'
import type { WindowsOptions } from '../types'

const Stub = { render: () => h('div') }
const view = { w: 1000, h: 800 }

function store(extra: Partial<WindowsOptions> = {}) {
  return createStore(resolveOptions({ components: { editor: Stub }, ...extra }))
}

describe('auto height', () => {
  it('is on for a window that names no height and no height limit', () => {
    const win = store()
    expect(win.isAutoHeight(win.open('editor').id)).toBe(true)
  })

  it('is off when the call names h, minH or maxH', () => {
    const win = store()
    expect(win.isAutoHeight(win.open('editor', { n: 1 }, { h: 300 }).id)).toBe(false)
    expect(win.isAutoHeight(win.open('editor', { n: 2 }, { minH: 100 }).id)).toBe(false)
    expect(win.isAutoHeight(win.open('editor', { n: 3 }, { maxH: 600 }).id)).toBe(false)
    expect(win.isAutoHeight(win.open('editor', { n: 4 }, { maxH: null }).id)).toBe(false)
  })

  it('is off when the preset or the component spec names one', () => {
    const fromPreset = store({ presets: { tall: { h: 600 } } })
    expect(fromPreset.isAutoHeight(fromPreset.open('editor', {}, { preset: 'tall' }).id)).toBe(false)

    const fromSpec = store({ components: { editor: { component: Stub, minH: 200 } } })
    expect(fromSpec.isAutoHeight(fromSpec.open('editor').id)).toBe(false)
  })

  it('grows by the overflow and reports it as geometry', () => {
    const win = store()
    const id = win.open('editor', {}, { y: 40 }).id
    const rects: unknown[] = []
    win.on('geometry', (e) => rects.push(e.rect))

    win.growToFit(id, 120, view)

    expect(win.byId(id)!.h).toBe(600)
    expect(win.byId(id)!.y).toBe(40)
    expect(rects).toHaveLength(1)
  })

  it('moves up when the bottom edge would leave the viewport', () => {
    const win = store()
    const id = win.open('editor', {}, { y: 300 }).id

    win.growToFit(id, 200, view)

    expect(win.byId(id)!.h).toBe(680)
    expect(win.byId(id)!.y).toBe(120)
  })

  it('stops at the viewport height', () => {
    const win = store()
    const id = win.open('editor', {}, { y: 100 }).id

    win.growToFit(id, 5000, view)

    expect(win.byId(id)!.h).toBe(800)
    expect(win.byId(id)!.y).toBe(0)
  })

  it('stays inside the snap insets', () => {
    const win = store({ snap: { insets: { top: 20, bottom: 36 } } })
    const low = win.open('editor', { n: 1 }, { y: 300 }).id
    const tall = win.open('editor', { n: 2 }, { y: 100 }).id

    win.growToFit(low, 200, view)
    win.growToFit(tall, 5000, view)

    expect(win.byId(low)!.h).toBe(680)
    expect(win.byId(low)!.y + win.byId(low)!.h).toBe(view.h - 36)
    expect(win.byId(tall)!.h).toBe(view.h - 56)
    expect(win.byId(tall)!.y).toBe(20)
  })

  it('never shrinks, and ignores a window that is not auto height', () => {
    const win = store()
    const id = win.open('editor').id
    win.growToFit(id, -100, view)
    expect(win.byId(id)!.h).toBe(480)

    const fixed = win.open('editor', { n: 2 }, { h: 300 }).id
    win.growToFit(fixed, 100, view)
    expect(win.byId(fixed)!.h).toBe(300)
  })

  it('is dropped by setGeometry with a new h, but not by a move', () => {
    const win = store()
    const id = win.open('editor').id
    win.setGeometry(id, { x: 10, y: 10 })
    expect(win.isAutoHeight(id)).toBe(true)
    win.setGeometry(id, { h: 480 })
    expect(win.isAutoHeight(id)).toBe(true)
    win.setGeometry(id, { h: 300 })
    expect(win.isAutoHeight(id)).toBe(false)
  })

  it('is dropped by a snap, a maximize and stopAutoHeight', () => {
    const win = store()
    const a = win.open('editor', { n: 1 }).id
    const b = win.open('editor', { n: 2 }).id
    const c = win.open('editor', { n: 3 }).id

    win.snap(a, 'left', view)
    win.maximize(b)
    win.stopAutoHeight(c)

    expect([a, b, c].map((id) => win.isAutoHeight(id))).toEqual([false, false, false])
  })

  it('is not carried by a restored window, and is forgotten on close', () => {
    const win = store()
    const id = win.open('editor').id
    win.close(id)
    expect(win.isAutoHeight(id)).toBe(false)

    const kept = win.open('editor', { n: 2 }).id
    win.hydrate(win.s.stack.map((d) => ({ ...d })), 20)
    expect(win.isAutoHeight(kept)).toBe(false)
  })
})
