import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig, configDefaults } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

/**
 * Deliberately not built on `vite.config.ts`: that file describes the library *build* (lib entry,
 * externals, devtools) and none of it applies to a test run. `vite-plugin-vue-devtools` in
 * particular throws inside browser mode. Tests need the SFC compiler and the `@` alias, nothing
 * else.
 */
const shared = {
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
}

/**
 * Two projects. The jsdom one is the whole suite as it always was; the browser one exists because
 * jsdom's `HTMLDialogElement` is a stub (see `src/__tests__/setup.ts`) and cannot answer questions
 * about what the UA actually does with a non-modal dialog, ESC, or a native `<select>`. Browser
 * specs are named `*.browser.spec.ts` and deliberately get no setup file — the shims there fake
 * exactly what those specs are here to measure.
 */
export default defineConfig({
  test: {
    root: fileURLToPath(new URL('./', import.meta.url)),
    projects: [
      {
        ...shared,
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
        ...shared,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.spec.ts'],
          // `vitest bench` would otherwise pick the jsdom benchmarks up a second time here.
          benchmark: {
            include: ['src/**/*.browser.bench.ts'],
          },
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
})
