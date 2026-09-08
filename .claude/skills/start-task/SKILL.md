---
name: start-task
description: Start a new vw-NN task — create the branch off master and scaffold its contract in _doc/TASKS-tier2.md. Usage: /start-task VW-13 short-slug
disable-model-invocation: true
---

Arguments: `$ARGUMENTS` — expected `VW-NN slug` (e.g. `VW-13 url-sync`). Branch name is `vw-NN-slug` (lowercase id, hyphen, slug).

## Steps

1. **Validate.** If arguments are missing or malformed, print the usage line and stop. If `git status --porcelain` is non-empty, stop and tell the user to commit or stash first.
2. **Branch.**
   ```
   git checkout master && git pull --ff-only && git checkout -b vw-NN-slug
   ```
3. **Find the roadmap entry.** Search `_doc/ROADMAP-gaps.md` for the feature (Tier 2 table under "## Tier 2 — after `1.0`", or a numbered §section). Read it; it holds the reasoning the task contract must reference.
4. **Scaffold the contract.** Append to `_doc/TASKS-tier2.md`. If the file does not exist, create it with the same header shape as `_doc/TASKS-tier1.md` (title, blockquote pointing at the roadmap, "one task per branch, one PR each", then a `## Global constraints` line that says "Same as TASKS-tier1.md §Global constraints; they apply unchanged."). Then add:

   ```markdown
   ## VW-NN — <title from the roadmap row>

   **Roadmap:** <§ or "Tier 2 table"> · **Size:** S|M|L · **Blocks:** — · **Status:** in progress on `vw-NN-slug`.

   ### Goal

   <one paragraph drafted from the roadmap row's "Sketch" and "Why it earns its place">

   ### Do

   - <concrete steps drafted from the sketch; name the files (`src/geometry.ts`, `src/persist.ts`, `BaseWindow.vue`...)>

   ### Done when

   - <observable checks, at least one `*.browser.spec.ts` if the change is DOM-level>
   - All three gates in CLAUDE.md §9 pass (`/verify-task`).
   ```

   Mark drafted text you are unsure about with `<!-- TODO: confirm -->` so the user can edit before starting.
5. **Do not commit.** Print the branch name and the heading you added, and remind the user to review the contract.
