import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The shipped palettes are plain text, so the thing that can go wrong is a typo: a slug that does
 * not match its filename, a token spelled `--vtd-headbg`, a file that forgot `--vtd-scrim-bg` and
 * so falls back to the baseline tint under a dark palette. None of that needs a cascade — it is a
 * file-shape check, and it runs here rather than in the browser twin so a missing token is named
 * precisely. `themes.browser.spec.ts` is the one that proves the cascade actually resolves.
 */

// Off disk, resolved from the runner's cwd — which vitest pins to the repo root. Importing the
// files instead would hand them to Vite's CSS pipeline and hollow them out; this spec is about the
// text as written.
const dir = resolve('src/themes')

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.css') && f !== 'all.css')
  .sort()

/** Every palette declares all of these, and nothing outside them. */
const TOKENS = [
  '--vtd-color-scheme',
  '--vtd-bg',
  '--vtd-fg',
  '--vtd-head-bg',
  '--vtd-head-fg',
  '--vtd-accent',
  '--vtd-border',
  '--vtd-border-active',
  '--vtd-shadow',
  '--vtd-shadow-active',
  '--vtd-btn-hover-bg',
  '--vtd-ghost-bg',
  '--vtd-ghost-outline',
  '--vtd-scrim-bg',
]

function read(file: string) {
  return readFileSync(resolve(dir, file), 'utf8')
}

function declaredIn(css: string) {
  return [...css.matchAll(/^\s*(--vtd-[a-z-]+):/gm)].map((m) => m[1] as string)
}

describe('theme files', () => {
  it('ships the palettes', () => {
    expect(files.length).toBe(22)
  })

  it.each(files)('%s declares the full token set, once each', (file) => {
    const declared = declaredIn(read(file))
    expect([...declared].sort()).toEqual([...TOKENS].sort())
  })

  it.each(files)('%s targets its own slug at zero specificity', (file) => {
    const slug = file.replace(/\.css$/, '')
    expect(read(file)).toContain(`:where([data-vtd-theme='${slug}'], .vtd-theme-${slug}) {`)
  })

  it.each(files)('%s declares its scheme as a token, not as a page-wide color-scheme', (file) => {
    // `--vtd-color-scheme:` and not `color-scheme:` — the property itself is applied by `style.css`
    // on `.vw`, so activating a palette on <html> repaints the windows and leaves the page alone.
    expect(read(file)).toMatch(/--vtd-color-scheme: (light|dark);/)
    expect(read(file)).not.toMatch(/^\s*color-scheme:/m)
  })

  it.each(files)('%s leaves shape and motion to the consumer', (file) => {
    // A palette that set padding or the motion duration would silently overwrite a consumer's
    // layout choices the moment they picked a colour scheme.
    expect(read(file)).not.toMatch(/--vtd-(radius|font|font-size|\w+-pad|motion-duration):/)
  })

  it('bundles every palette in all.css', () => {
    const all = read('all.css')
    for (const file of files) expect(all).toContain(`@import './${file}';`)
    expect(declaredIn(all)).toEqual([])
  })
})
