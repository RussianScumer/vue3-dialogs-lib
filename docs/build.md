# Build and pack

The repository is developed with pnpm — `packageManager` in `package.json` pins the version, so
corepack picks it up automatically. `pnpm-lock.yaml` is the only lockfile.

```sh
pnpm install
```

No dependency has an install script, so pnpm 10's build-script blocking never asks for an
`onlyBuiltDependencies` allowlist. Nothing relies on hoisting either: if an import ever fails to
resolve, the fix is to declare the real dependency, not to add `shamefully-hoist`.

## Build

```sh
pnpm build
```

Three stages, in order:

1. `type-check` (`vue-tsc --build`) and `build-only` (`vite build`) in parallel, via `run-p`.
   `vite build` writes the ES bundle to `dist/vue3-dialogs-lib.js`. Vue is external — the bundle
   imports it, it is not inlined.
2. `build-types` (`vue-tsc -p tsconfig.lib.json`) emits declarations to `dist/types/`.
3. `build-css` copies `src/style.css` to `dist/style.css` and `src/themes/` to `dist/themes/`
   verbatim. It is a plain file copy, not a bundler output.

The stages are chained with `&&`, so **if `build-types` fails, `build-css` never runs and `dist/`
is left without a stylesheet**. A build that printed a `vue-tsc` error did not produce a shippable
`dist/`, even though the bundle is there.

The stylesheet is cosmetics only. Structural layout is inline, so the library works with no
stylesheet imported at all.

Expected output:

```
dist/
  vue3-dialogs-lib.js
  style.css
  themes/
    all.css
    dracula.css
    ...
  types/
    index.d.ts
    ...
```

## Pack

```sh
pnpm pack
```

Writes `korneevecin-vue3-dialogs-lib-<version>.tgz` in the repository root. This is a local
operation — it never contacts a registry and is not a publish.

`prepack` runs `pnpm build` first, so the tarball always carries a fresh `dist/`. `files: ["dist"]`
keeps everything else out; npm adds `package.json`, `README.md` and `LICENSE` on its own. `src/`,
`docs/`, `playground/` and the tests are not in the tarball.

Inspect it:

```sh
tar -tzf korneevecin-vue3-dialogs-lib-<version>.tgz
```

Tarballs are gitignored (`*.tgz`).

## Trying the tarball in another project

The one check that proves `exports` and `types` point at files that exist:

```sh
mkdir /tmp/consume && cd /tmp/consume
pnpm init
pnpm add vue /path/to/vue3-dialogs-lib/korneevecin-vue3-dialogs-lib-<version>.tgz
```

```js
import { createWindows } from '@korneevecin/vue3-dialogs-lib'
import '@korneevecin/vue3-dialogs-lib/style.css'
```

## Other commands

```sh
pnpm dev                      # playground at playground/, the real-browser test surface
pnpm exec vitest run          # both test projects: unit (jsdom) and browser (Playwright)
pnpm exec vitest run --project unit
pnpm bench                    # benchmarks in src/__bench__/
pnpm lint                     # eslint .
pnpm lint:fix
pnpm type-check               # vue-tsc --build
```

The browser test project needs Chromium once:

```sh
pnpm exec playwright install chromium
```

## Releasing

Releases are manual. The package is scoped and `publishConfig.access` is already `public`, so the
whole flow is:

```sh
# 1. bump "version" in package.json (semver), commit it
# 2. see exactly what would be uploaded — prepack rebuilds dist/ first
pnpm publish --dry-run
# 3. publish
pnpm publish
# 4. tag the commit
git tag v<version> && git push --tags
```

`pnpm publish` runs `prepack`, so `dist/` is always rebuilt from the commit being released; a
`vue-tsc` error aborts the publish before anything is uploaded. The dry run prints the file list —
check it against the expected `dist/` tree above and that `LICENSE` and `README.md` are in it.
