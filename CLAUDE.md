# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Vue 3.5 window/dialog library (`@korneevec/vue3-dialogs-lib`), npm, ES-only Vite lib build, no CI.

## Commands

- `npm run build` — `type-check` + `build-only` in parallel, then `build-types` (`vue-tsc -p tsconfig.lib.json` → `dist/types/`), then `build-css`. `dist/style.css` is a plain file copy of `src/style.css`, not bundled; if `build-types` fails, `build-css` never runs and `dist/` ships without CSS.
- `npm run lint` / `npm run lint:fix` (`eslint .`), `npm run type-check` (`vue-tsc --build`).
- Tests are two Vitest projects: `unit` (jsdom, `src/**/*.spec.ts`) and `browser` (Playwright Chromium headless, `src/**/*.browser.spec.ts`).
  - All: `npx vitest run`. One project: `npx vitest run --project unit` / `--project browser`.
  - One file: `npx vitest run src/__tests__/focus.spec.ts`. One test: `npx vitest run -t "name"`.
  - Browser project needs `npx playwright install chromium` once.
- `npm run bench` — Vitest benchmarks (`src/__bench__/`).
- `npm run dev` — playground at `playground/` (`index.html`), the real-browser test surface.

## Global constraints (from `_doc/TASKS-tier1.md`)

A change that violates one of these is rejected even if it works.

1. `SCHEMA` in `persist.ts` does not move. If a persisted-shape change seems needed, stop and raise it; do not bump the version.
2. `WindowDescriptor` gains no persisted fields. Runtime-only per-window state goes in a reactive structure alongside `docks` / `restoredIds`, outside the watched `s` object. A new descriptor field wakes the persistence watcher and changes the schema.
3. Zero new runtime dependencies. Vue 3.5+ peer only; dev deps for tests are fine.
4. No user-facing strings in the library. `aria-label`s and visible text come from consumers. Dev-mode `console.warn` is exempt.
5. SSR-safe: every `window` / `document` / `matchMedia` access guarded, nothing at module scope. `src/__tests__/ssr.spec.ts` must keep passing untouched.
6. The existing suite passes untouched. If a test needs to change, the task is out of its lane; raise it rather than editing the assertion.
7. The library works with no stylesheet imported. Structure stays inline; `style.css` is cosmetics only.
8. Tests live in `src/__tests__/`. DOM-level behaviour (dialog, ESC, native `<select>`) goes in `*.browser.spec.ts`, not jsdom: jsdom's `HTMLDialogElement` is a stub shimmed by `src/__tests__/setup.ts`, and browser specs deliberately get no setup file.
9. Three gates before a task is done, in order: `npm run lint` + `npm run type-check`; `npx vitest run` (both projects); then the change exercised by hand in the running playground in a real browser. Run `/verify-task` — it does all three, gate 3 via the Chrome tools. A task that passed only the first two is not finished.

## Gotchas

- `vitest.config.ts` deliberately does not extend `vite.config.ts`: `vite-plugin-vue-devtools` throws inside browser mode. Keep them separate.
- `tsconfig.lib.json` must keep `types: ["vite/client"]` (it excludes the root `env.d.ts`); without it `import.meta.env.DEV` guards fail with TS2339.
- `noUncheckedIndexedAccess` is on. `import.meta.env.DEV` is the only environment access; no env vars.

## Style

2-space indent, single quotes, no semicolons. `@/` aliases `src/`. ESLint (`eslint.config.ts`, flat) is the only style tool, no Prettier: `npx eslint --fix <file>`.

## Workflow

- One task per branch, one PR (remote is Bitbucket). Branch `vw-NN-slug` off `master`. `/start-task VW-NN slug` scaffolds it.
- Task contracts (Goal / Do / Done when / Status) live in `_doc/TASKS-*.md`; reasoning in `_doc/ROADMAP-gaps.md`. Read the roadmap section named in the task before starting.
- Commits: Conventional Commits, lowercase sentence-style subject, e.g. `feat(keymap): keyboard snapping and window switching`, `fix(drag): undock on drag, not on pointerdown`; `!` after the scope for breaking changes.
- Do not bump `package.json` version or edit `CHANGELOG.md` unless asked. Releases are manual and the publish process is undecided.
