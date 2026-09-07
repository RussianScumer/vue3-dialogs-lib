---
name: verify-task
description: Run the three definition-of-done gates for a vw-NN task in order — lint + type-check, vitest (unit + browser projects), then exercise the change in the playground in a real browser via the Chrome tools. Use after finishing a task, before opening a PR, or when asked to verify a change end-to-end.
---

Run the three gates from CLAUDE.md "Global constraints" §9, in order. Stop at the first failing gate and report; do not continue to the next one.

## Gate 1 — static

```
npm run lint && npm run type-check
```

On failure quote the shortest decisive line (file:line + rule or TS code), fix if the fix is inside the task's scope, rerun. Do not disable rules or add `// @ts-ignore`.

## Gate 2 — specs

```
npx vitest run
```

Runs both projects (`unit` jsdom, `browser` Playwright Chromium). If the browser project fails to launch rather than fails a test, tell the user to run `npx playwright install chromium`; that is not a test failure. If an existing spec fails, that is constraint §6 territory: raise it, do not edit the assertion.

## Gate 3 — playground in a real browser

1. Find what to exercise: read the task's entry in `_doc/TASKS-*.md` (the "Done when" list) or, if there is no task entry, derive it from the diff (`git diff master --stat`).
2. Start the dev server in the background and capture the URL it prints (default `http://localhost:5173`):
   ```
   npm run dev
   ```
3. Load the Chrome tools in ONE ToolSearch call:
   `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__tabs_close_mcp`
4. Call `tabs_context_mcp`, then open the playground URL in a **new** tab. Never reuse a tab id from an earlier session.
5. Exercise each "Done when" item with real pointer input: open windows from the playground buttons, drag, resize, snap, minimize, focus, ESC, whatever the task touches. Take a screenshot after each meaningful state.
6. Read console messages filtered for `error|warn|\[vw\]`; any library warning or Vue warning is a failure unless the task expects it.
7. Close the tab, stop the dev server.

## Report

One line per gate: `Gate N: pass|fail — <what ran / what broke>`. For gate 3 list exactly what was exercised and what was observed. If a gate was skipped (e.g. browser tools unavailable), say so explicitly; the task is not done until all three pass.

Note: if a bundled `/verify` skill exists it still works; this skill adds the project's gates on top.
