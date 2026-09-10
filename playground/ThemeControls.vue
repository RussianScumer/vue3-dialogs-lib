<script setup lang="ts">
import { computed, reactive, ref, watchEffect } from 'vue'

/**
 * Case 8 in the flesh: every knob here writes a `--vtd-*` property onto <html>.
 * Nothing targets `.vw`, so this is the whole restyle surface — inheritance
 * carries the values into windows that render outside this component's subtree.
 */

type Preset = { label: string; tokens: Tokens }
type Tokens = {
  bg: string
  fg: string
  headBg: string
  headFg: string
  accent: string
  borderColor: string
  borderWidth: number
  radius: number
  bodyPad: number
  font: string
  shadow: 'none' | 'soft' | 'hard' | 'glow'
  scrim: string
  scrimAlpha: number
  scrollbar: 'palette' | 'accent' | 'hidden'
}

const presets = {
  brand: {
    label: 'Brand',
    tokens: {
      bg: '#ffffff', fg: '#111827', headBg: '#4338ca', headFg: '#ffffff', accent: '#4338ca',
      borderColor: '#4338ca', borderWidth: 2, radius: 2, bodyPad: 12,
      font: 'system-ui, sans-serif', shadow: 'glow',
      scrim: '#1e1b4b', scrimAlpha: 45, scrollbar: 'accent',
    },
  },
  terminal: {
    label: 'Terminal',
    tokens: {
      bg: '#0b1120', fg: '#22d3ee', headBg: '#020617', headFg: '#22d3ee', accent: '#22d3ee',
      borderColor: '#155e75', borderWidth: 1, radius: 0, bodyPad: 10,
      font: 'ui-monospace, SFMono-Regular, monospace', shadow: 'hard',
      scrim: '#020617', scrimAlpha: 70, scrollbar: 'accent',
    },
  },
  paper: {
    label: 'Paper',
    tokens: {
      bg: '#fffdf7', fg: '#1c1917', headBg: '#f5e9d0', headFg: '#57534e', accent: '#b45309',
      borderColor: '#d6c8ab', borderWidth: 1, radius: 14, bodyPad: 18,
      font: 'Georgia, serif', shadow: 'soft',
      scrim: '#57534e', scrimAlpha: 35, scrollbar: 'palette',
    },
  },
} satisfies Record<string, Preset>

const t = reactive<Tokens>({ ...presets.brand.tokens })
const on = ref(false)

/**
 * The shipped palettes, imported once as `themes/all.css` in `main.ts`. Switching is one attribute
 * on <html> — no re-import, no per-window prop, and the knobs below still layer on top because the
 * palettes sit at zero specificity.
 *
 * On <html> and yet the page stays as it is: a palette declares only `--vtd-*`, which nothing
 * outside the windows reads, and its `color-scheme` travels as `--vtd-color-scheme` for `.vw` to
 * apply. The taskbar in App.vue joins in by reading the tokens on purpose.
 */
const THEMES = [
  ['dracula', 'Dracula'],
  ['nord', 'Nord'],
  ['solarized-light', 'Solarized Light'],
  ['solarized-dark', 'Solarized Dark'],
  ['gruvbox-dark', 'Gruvbox Dark'],
  ['catppuccin-latte', 'Catppuccin Latte'],
  ['catppuccin-frappe', 'Catppuccin Frappé'],
  ['catppuccin-macchiato', 'Catppuccin Macchiato'],
  ['catppuccin-mocha', 'Catppuccin Mocha'],
  ['tokyo-night', 'Tokyo Night'],
  ['one-dark', 'One Dark'],
  ['one-light', 'One Light'],
  ['monokai', 'Monokai'],
  ['monokai-pro', 'Monokai Pro'],
  ['rose-pine', 'Rosé Pine'],
  ['everforest-dark', 'Everforest Dark'],
  ['kanagawa-wave', 'Kanagawa Wave'],
  ['github-light', 'GitHub Light'],
  ['github-dark', 'GitHub Dark'],
  ['ayu-dark', 'Ayu Dark'],
  ['material-darker', 'Material Darker'],
  ['nightfox', 'Nightfox'],
] as const

const theme = ref('')

watchEffect(() => {
  const root = document.documentElement
  if (theme.value) root.setAttribute('data-vtd-theme', theme.value)
  else root.removeAttribute('data-vtd-theme')
})

const shadows = {
  none: 'none',
  soft: '0 10px 30px rgba(0, 0, 0, 0.25)',
  hard: '0 0 0 1px rgba(0, 0, 0, 0.4), 0 18px 0 -12px rgba(0, 0, 0, 0.6)',
  glow: 'glow', // resolved against the accent below
}

const vars = computed<Record<string, string>>(() => ({
  '--vtd-bg': t.bg,
  '--vtd-fg': t.fg,
  '--vtd-head-bg': t.headBg,
  '--vtd-head-fg': t.headFg,
  '--vtd-accent': t.accent,
  '--vtd-border': `${t.borderWidth}px solid ${t.borderColor}`,
  '--vtd-radius': `${t.radius}px`,
  '--vtd-body-pad': `${t.bodyPad}px`,
  '--vtd-font': t.font,
  '--vtd-btn-hover-bg': `color-mix(in srgb, ${t.headFg} 22%, transparent)`,
  '--vtd-shadow':
    t.shadow === 'glow' ? `0 12px 40px color-mix(in srgb, ${t.accent} 45%, transparent)` : shadows[t.shadow],
  // The dim behind a modal window — the scrim is a library element, so it is a token like the rest.
  '--vtd-scrim-bg': `color-mix(in srgb, ${t.scrim} ${t.scrimAlpha}%, transparent)`,
  // Native scrollbars inside the frame. The default mixes `currentColor`, so a window's bars follow
  // its own palette with nothing set; these two override that per theme.
  ...(t.scrollbar === 'palette'
    ? {}
    : t.scrollbar === 'hidden'
      ? { '--vtd-scrollbar-width': 'none' }
      : {
          '--vtd-scrollbar-thumb': `color-mix(in srgb, ${t.accent} 60%, transparent)`,
          '--vtd-scrollbar-track': `color-mix(in srgb, ${t.accent} 12%, transparent)`,
        }),
}))

// Off removes the properties entirely, so the library's own defaults (including
// its prefers-color-scheme dark values) come back — proof they are fallbacks.
// The previous keys are remembered because the set is not fixed: the scrollbar knob drops its two
// properties rather than setting them to a value, and a stale one left on <html> would win.
let applied: string[] = []

watchEffect(() => {
  const root = document.documentElement.style
  for (const name of applied) if (!(name in vars.value) || !on.value) root.removeProperty(name)
  applied = []
  if (!on.value) return
  for (const [name, value] of Object.entries(vars.value)) {
    root.setProperty(name, value)
    applied.push(name)
  }
})

function apply(key: string) {
  const preset = presets[key as keyof typeof presets]
  if (!preset) return
  Object.assign(t, preset.tokens)
  on.value = true
}
</script>

<template>
  <div class="tc">
    <div class="tc__row">
      <label>
        Theme
        <select v-model="theme">
          <option value="">none (library defaults)</option>
          <option
            v-for="[slug, label] in THEMES"
            :key="slug"
            :value="slug"
          >{{ label }}</option>
        </select>
      </label>
      <code>data-vtd-theme="{{ theme || '' }}"</code>
    </div>

    <div class="tc__row">
      <label><input
        v-model="on"
        type="checkbox"
      > Apply <code>--vtd-*</code> to &lt;html&gt;</label>
      <button
        v-for="(p, key) in presets"
        :key="key"
        type="button"
        @click="apply(key)"
      >
        {{ p.label }}
      </button>
    </div>

    <div class="tc__grid">
      <label>Window bg<input
        v-model="t.bg"
        type="color"
      ></label>
      <label>Window text<input
        v-model="t.fg"
        type="color"
      ></label>
      <label>Header bg<input
        v-model="t.headBg"
        type="color"
      ></label>
      <label>Header text<input
        v-model="t.headFg"
        type="color"
      ></label>
      <label>Accent (focus ring)<input
        v-model="t.accent"
        type="color"
      ></label>
      <label>Border color<input
        v-model="t.borderColor"
        type="color"
      ></label>
      <label>Border {{ t.borderWidth }}px<input
        v-model.number="t.borderWidth"
        type="range"
        min="0"
        max="6"
      ></label>
      <label>Radius {{ t.radius }}px<input
        v-model.number="t.radius"
        type="range"
        min="0"
        max="24"
      ></label>
      <label>Body pad {{ t.bodyPad }}px<input
        v-model.number="t.bodyPad"
        type="range"
        min="0"
        max="32"
      ></label>
      <label>
        Font
        <select v-model="t.font">
          <option value="system-ui, sans-serif">system-ui</option>
          <option value="Georgia, serif">Georgia</option>
          <option value="ui-monospace, SFMono-Regular, monospace">monospace</option>
        </select>
      </label>
      <label>Scrim<input
        v-model="t.scrim"
        type="color"
      ></label>
      <label>Scrim {{ t.scrimAlpha }}%<input
        v-model.number="t.scrimAlpha"
        type="range"
        min="0"
        max="100"
        step="5"
      ></label>
      <label>
        Scrollbars
        <select v-model="t.scrollbar">
          <option value="palette">follow the window</option>
          <option value="accent">accent</option>
          <option value="hidden">hidden</option>
        </select>
      </label>
      <label>
        Shadow
        <select v-model="t.shadow">
          <option
            v-for="key in Object.keys(shadows)"
            :key="key"
            :value="key"
          >{{ key }}</option>
        </select>
      </label>
    </div>

    <details>
      <summary>Copy as CSS</summary>
      <pre>:root {
<template
v-for="(value, name) in vars"
:key="name"
>  {{ name }}: {{ value }};
</template>}</pre>
    </details>
  </div>
</template>

<style scoped>
.tc__row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
.tc__row label { display: flex; align-items: center; gap: 4px; font-size: 13px; }
.tc__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 6px 12px; }
.tc__grid label { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; }
.tc__grid input[type='color'] { inline-size: 34px; block-size: 22px; padding: 0; }
.tc__grid input[type='range'] { inline-size: 90px; }
details { margin-top: 10px; font-size: 12px; }
pre { margin: 6px 0 0; padding: 8px; overflow: auto; background: rgba(127, 127, 127, 0.12); border-radius: 6px; }
</style>
