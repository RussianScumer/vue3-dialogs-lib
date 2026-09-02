<script setup lang="ts">
import { computed, reactive, ref, watchEffect } from 'vue'

/**
 * Case 7 in the flesh: every knob here writes a `--vtd-*` property onto <html>.
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
}

const presets = {
  brand: {
    label: 'Brand',
    tokens: {
      bg: '#ffffff', fg: '#111827', headBg: '#4338ca', headFg: '#ffffff', accent: '#4338ca',
      borderColor: '#4338ca', borderWidth: 2, radius: 2, bodyPad: 12,
      font: 'system-ui, sans-serif', shadow: 'glow',
    },
  },
  terminal: {
    label: 'Terminal',
    tokens: {
      bg: '#0b1120', fg: '#22d3ee', headBg: '#020617', headFg: '#22d3ee', accent: '#22d3ee',
      borderColor: '#155e75', borderWidth: 1, radius: 0, bodyPad: 10,
      font: 'ui-monospace, SFMono-Regular, monospace', shadow: 'hard',
    },
  },
  paper: {
    label: 'Paper',
    tokens: {
      bg: '#fffdf7', fg: '#1c1917', headBg: '#f5e9d0', headFg: '#57534e', accent: '#b45309',
      borderColor: '#d6c8ab', borderWidth: 1, radius: 14, bodyPad: 18,
      font: 'Georgia, serif', shadow: 'soft',
    },
  },
} satisfies Record<string, Preset>

const t = reactive<Tokens>({ ...presets.brand.tokens })
const on = ref(false)

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
}))

// Off removes the properties entirely, so the library's own defaults (including
// its prefers-color-scheme dark values) come back — proof they are fallbacks.
watchEffect(() => {
  const root = document.documentElement.style
  for (const [name, value] of Object.entries(vars.value)) {
    if (on.value) root.setProperty(name, value)
    else root.removeProperty(name)
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
