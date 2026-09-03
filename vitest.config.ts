import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import viteConfig from './vite.config'

/**
 * Two projects. The jsdom one is the whole suite as it always was; the browser one exists because
 * jsdom's `HTMLDialogElement` is a stub (see `src/__tests__/setup.ts`) and cannot answer questions
 * about what the UA actually does with a non-modal dialog, ESC, or a native `<select>` popup.
 * Browser specs are named `*.browser.spec.ts` and deliberately get no setup file — the shims there
 * fake exactly what those specs are there to measure.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      root: fileURLToPath(new URL('./', import.meta.url)),
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            environment: 'jsdom',
            include: ['src/**/*.spec.ts'],
            exclude: [...configDefaults.exclude, 'src/**/*.browser.spec.ts'],
            setupFiles: ['src/__tests__/setup.ts'],
            benchmark: {
              include: ['src/**/*.bench.ts'],
            },
          },
        },
        {
          extends: true,
          test: {
            name: 'browser',
            include: ['src/**/*.browser.spec.ts'],
            browser: {
              enabled: true,
              provider: playwright(),
              headless: true,
              instances: [{ browser: 'chromium' }],
            },
          },
        },
      ],
    },
  }),
)
