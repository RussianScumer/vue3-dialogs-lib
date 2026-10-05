import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue}'],
  },

  {
    name: 'app/files-to-ignore',
    ignores: ['dist/**', 'coverage/**'],
  },

  pluginVue.configs['flat/recommended'],
  // Type-aware: the parser resolves each file through the `tsconfig.json` project references (app,
  // node, vitest), so specs and benches are linted against the same types `pnpm type-check` uses.
  vueTsConfigs.recommendedTypeChecked,

  {
    name: 'app/rules',
    rules: {
      // Omitting a key by naming it beside a rest property is the idiom for stripping it; the
      // binding exists to be discarded, and an underscore says so.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true, varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // `const { resolve, close } = useWindowContext()` is the documented idiom; every function on the
      // context and the store is a closure, so the `this`-binding hazard the rule guards against
      // does not exist here.
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  {
    name: 'app/test-fixtures',
    files: ['src/__tests__/**', 'src/__bench__/**'],
    rules: {
      // Suites declare several throwaway stub components inline; one file per
      // component would only scatter the fixtures away from their assertions.
      'vue/one-component-per-file': 'off',
      // Guards and loaders are written `async` to exercise the promise path even when they return
      // synchronously; the missing `await` is the point.
      '@typescript-eslint/require-await': 'off',
    },
  },
)
