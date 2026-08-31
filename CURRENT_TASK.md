# Scuri — Current Task

_This file should be empty (this template only) whenever nothing is actively in progress. It is not a log — do not let entries pile up here. Once a task is complete, verified, and any durable outcome is recorded in `PROJECT_CONTEXT.md`, clear this file back to the template below._

See `PROJECT_CONTEXT.md` → "Handoff between sessions / agents" for the full process.

---

## Status

`awaiting push to GitHub + PR review`

## Task

Refactor Codex's Drive-heavy project-sync implementation (branch `codex/google-drive-project-sync`, never pushed - see attached snapshot) so Supabase is the source of truth for project state and Google Drive is only the full-resolution asset warehouse, per the corrected architecture decision in `PROJECT_CONTEXT.md`.

## Done so far

- Compared the attached Codex snapshot to live GitHub (`codex/google-drive-project-sync` does not exist remotely - only the snapshot has this work).
- Built branch `agent/supabase-project-sync` off `main` (`71fa515`).
- Wrote `supabase/migrations/20260831120000_create_projects.sql` (projects/project_pages/project_assets, owner-only RLS, revision trigger).
- Wrote `src/lib/project-sync.ts` (pull/push, revision-gated optimistic concurrency, safe conflict policy, cloud/local merge policy, derived sync status) and `src/lib/supabase-client.ts` (client shared with `custom-templates.ts` so templates and projects use one auth session).
- Rewrote `src/lib/google-drive.ts` to drop manifest/project-authority code, keep OAuth + per-project folder tree + resumable upload/download/trash.
- Wired `src/components/layouts-app.tsx` and `src/components/project-library-card.tsx` to the new sync engine (cloud banner, per-project sync status badge, debounced push, Drive connect/disconnect, coordinated deletion).
- Kept the "Layouts" → "Scuri" rename (product.ts, package.json, export filenames, service worker cache name, brand mark).
- Added `src/lib/__tests__/project-sync.test.ts` (15 tests: conflict resolution, merge policy, derived sync status, row reconstruction).
- Updated `README.md` (architecture, Google Cloud OAuth setup steps, known limitations, roadmap) and `PROJECT_CONTEXT.md` (superseded the 2026-08-30 Drive-authoritative decision, added a 2026-08-31 release-status entry).
- Verified: `npm run typecheck`, `npm run lint`, `npm test` (48/48 passing), `npm run build -- --webpack`, `git diff --check` all pass clean.
- **Applied the migration to the live `supabase-teal-nest` project** (user confirmed first) - `projects`/`project_pages`/`project_assets` exist there now with RLS. A follow-up commit pinned `search_path` on the three trigger functions per the Supabase security advisor; that fix was also applied live.

## Remaining

- Push this branch to GitHub and open a PR. No push credentials were available in the environment that built it - a git bundle (`agent-supabase-project-sync.bundle`) and instructions were left alongside the original handoff files for whoever has push access to pick up.
- Physical-device acceptance testing (iPad + laptop, real Google account) per the acceptance test in the original handoff brief - needs a human with real credentials, not something an automated build can do.
- Google Cloud Console OAuth client setup (Drive API enabled, consent screen, Web application client, authorized JavaScript origins) - instructions are in `README.md`, but the actual console configuration and `NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID` value are the user's to create.

## Decisions / notes

- Conflict policy: never silently overwrite. Losing device keeps its edits as a new "(conflicted copy)" project; cloud stays canonical under the original id. See "Known limitations" in `README.md` for the small non-transactional gap between the project-row revision bump and its pages/assets writes (self-healing on retry).
- Deletion of a previously-synced project is blocked (not silently local-only) while offline/signed-out, so a cloud copy is never orphaned.

## Blockers

- GitHub push credentials (see "Remaining").

---

**Reminder for the agent currently working:** update this file after every discrete unit of work — a file edit, a test run, a decision — not on a timer. If your session ends unexpectedly (e.g. runs out of tokens), the next agent should be able to resume from exactly what's written here.
