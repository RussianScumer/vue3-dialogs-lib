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
  vueTsConfigs.recommended,

  {
    name: 'app/rules',
    rules: {
      // Omitting a key by naming it beside a rest property is the idiom for stripping it; the
      // binding exists to be discarded, and an underscore says so.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true, varsIgnorePattern: '^_' }],
    },
  },

  {
    name: 'app/test-fixtures',
    files: ['src/__tests__/**', 'src/__bench__/**'],
    rules: {
      // Suites declare several throwaway stub components inline; one file per
      // component would only scatter the fixtures away from their assertions.
      'vue/one-component-per-file': 'off',
    },
  },
)
