# Scuri — Current Task

_This file should be empty (this template only) whenever nothing is actively in progress. It is not a log — do not let entries pile up here. Once a task is complete, verified, and any durable outcome is recorded in `PROJECT_CONTEXT.md`, clear this file back to the template below._

See `PROJECT_CONTEXT.md` → "Handoff between sessions / agents" for the full process.

---

## Status

`in progress`

## Task

Update the built-in **Vertical pair** template so its outer border matches the existing 24px gap between its two photos, and add an optional centre-anchored resize mode to the custom template editor.

## Done so far

- Verified live GitHub (`main` at `d3ba740`), Vercel Production (READY), and Supabase (healthy; no schema change needed).
- Created branch `feature/vertical-pair-border`.
- Added an `outerInsetMultiplier` template option and applied it only to **Vertical pair**; its centre gap stays 24px while the outside border becomes 24px.
- Added focused geometry tests.
- The first focused test run caught that the template-expansion map needed to preserve the new option; that wiring is now fixed.
- Added **Resize from centre** to the Template editor's selected-frame controls. It retains normal one-sided resizing as the default, and keeps a selected frame centred while resizing when enabled.
- Added focused unit coverage for normal, centre-anchored, and edge-constrained resizing.
- Corrected the focused test expectations to respect floating-point geometry and a centre-fixed frame's nearest-edge limit.
- Verified `npm test` (54 passing), `npm run typecheck`, `npm run lint`, and `git diff --check`. The production build compiled, completed static page generation and emitted `.next/BUILD_ID` successfully.

## Remaining

- Push the feature branch and open a PR/Preview for review.

---

**Reminder for the agent currently working:** update this file after every discrete unit of work — a file edit, a test run, a decision — not on a timer. If your session ends unexpectedly (e.g. runs out of tokens), the next agent should be able to resume from exactly what's written here.
