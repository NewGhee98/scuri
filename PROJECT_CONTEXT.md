# Scuri — Project Context

_Last updated: 2026-09-17_

## How to use this file

This is the handoff / source-of-truth context for future Scuri chats and coding sessions.

At the start of a new Scuri chat:

1. Read this file first.
2. Read `CURRENT_TASK.md` next. If it is non-empty, there is unfinished work from a previous session (possibly a different agent — ChatGPT/Codex, Claude, or other) that should be resumed before starting anything new. See "Handoff between sessions / agents" below.
3. Verify any **live** GitHub, Vercel, or Supabase state before acting; branch heads, deployment IDs, PR status, environment variables, and migration state can change.
4. Preserve the product decisions below unless the user explicitly changes them.
5. After a meaningful release, architecture change, migration, or product decision, update this file.
6. Never paste secret keys, database passwords, JWT secrets, service-role keys, or access tokens into chat or commit them to Git.

---

## Handoff between sessions / agents

Scuri work may be picked up by different chats and different coding agents (ChatGPT/Codex, Claude, or others) within a single task, and a session can end abruptly — for example by running out of tokens — without warning. `CURRENT_TASK.md` exists to make that handoff reliable.

- `CURRENT_TASK.md` holds only the **currently active task**: what it is, what's been done so far, what's left, and any decisions or blockers.
- **Update it after every discrete unit of work** — after each file edit, test run, or meaningful decision — rather than on a timer. Context/token limits can be hit unpredictably, so "did I just finish a step" is a safer trigger than "has some time passed."
- When a task is fully done, verified, and (if applicable) merged, **clear `CURRENT_TASK.md` back to its empty template**. It must not be left accumulating history — that would make it expensive to read every session for no benefit. Durable outcomes belong in this file's own dated "Release status" sections instead, not in `CURRENT_TASK.md`.
- A non-empty `CURRENT_TASK.md` at the start of a session means: resume that work first, or explicitly confirm with the user that it should be abandoned/cleared before starting something new.

---

## Product summary

**Scuri** is a web app for building photo layouts/projects and exporting them. The product is being shaped primarily around **iPad and desktop**, while still supporting iPhone use.

Core mental model:

**Projects → project pages/layouts → editor**

There is also a reusable **Templates** library for layouts that can be reused across projects.

GitHub repository:

- `https://github.com/NewGhee98/scuri`

Vercel production domain:

- `https://scuri.vercel.app`

---

## Ironclad product requirement: templates must persist across devices

Once a custom template is created and saved, it must become part of the user's general template library **persistently**, not just in local browser storage.

Expected behaviour:

- Create a template on iPhone.
- Sign in with the same account on iPad or desktop.
- The saved template is present there as well.
- Local drafts may exist before sign-in, but saved cloud templates must survive new browser/app instances and device changes.

This cross-device persistence requirement is one of the main reasons Supabase was introduced.

## Ironclad product requirement: projects must persist across devices

A project built on iPad must be available on laptop or another signed-in device later, including its full-resolution source photographs. Device-only `localStorage` and IndexedDB are a cache, not the permanent copy.

**Architecture decision agreed on 2026-08-30, superseded on 2026-08-31:** the first implementation pass (Codex, branch `codex/google-drive-project-sync`, never pushed to GitHub - see "Release status" below) made Google Drive itself the source of truth, via a `project.scuri.json` manifest inside a private Drive folder. That work was reused but refactored before merge, because a Drive manifest is awkward to query, cannot use row-level security, and complicates conflict detection across devices.

**Current architecture (2026-08-31):**

- **Supabase is the source of truth** for project state: `projects`, `project_pages` and `project_assets` tables (`supabase/migrations/20260831120000_create_projects.sql`), owner-only RLS following the existing `templates` table's model, server-generated `updated_at`/`revision` columns for optimistic concurrency - a client's write is gated on the `revision` it last saw, so a stale device detects a conflict instead of silently overwriting a newer remote revision.
- **Google Drive is a file warehouse only**: untouched full-resolution originals, lightweight previews and optional exports live in a private per-project `Scuri/Projects/<name>/{Originals,Previews,Exports}` folder tree (`src/lib/google-drive.ts`). No Drive-side manifest is authoritative; Drive being disconnected or unavailable never hides project metadata, only the original photo bytes.
- **Browser storage (`localStorage` + IndexedDB) remains the local-first/offline cache**, unchanged in shape from before.
- Templates and projects are separate tables/features but **share one Supabase sign-in** (`src/lib/supabase-client.ts`); templates sync/RLS is unchanged.
- Conflict policy: never silently overwrite. A device whose push loses the revision race keeps its edits as a new, clearly-labelled "(conflicted copy)" project; the cloud copy stays canonical under the original id (`src/lib/project-sync.ts`'s `resolveProjectConflict`).
- Use the narrow non-sensitive Google `drive.file` scope, not broad Drive access. Uploads use a resumable-session endpoint; completed files are checkpointed, but byte-range resume across reloads is not implemented. Project deletion soft-deletes the Supabase row and retains Drive bytes because surviving copies may share them.

Required public environment variables:

- `NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID` (Google Drive backup; optional - projects still sync without it, just without full-resolution originals following the project to a new device)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (already required for templates; now also gate project sync)

See `README.md`'s "Cloud setup" section for exact Google Cloud Console steps (OAuth consent screen, Web application client, authorized JavaScript origins - no redirect URI is used; wildcards are not supported for JS origins, so ephemeral Vercel Previews cannot pre-authorize Drive connect the way Supabase's redirect allow-list does).

---

## Navigation / project UX decisions

The desired hierarchy is:

**Projects → Project → layouts/pages/templates → Editor**

Product decisions already agreed:

- A persistent top navigation should include **Projects**.
- Clicking **Projects** should always return to an overview of all current projects.
- Opening a project should show all layouts/pages currently in that project.
- A user can open any layout/page and edit it.
- Layouts/pages inside a project can be reordered.
- The project page should have an **Export all** action that exports every layout/page in the current order.
- Changes should autosave where safe and practical.
- Deletion should be allowed where it can be implemented safely.
- Optimise the interaction model primarily for **iPad / desktop**.
- The app should not trap the user in a newly created project; back/navigation actions must have coherent destinations.

---

## Templates feature

The templates release introduces:

- A Templates section in top navigation.
- Built-in reusable templates.
- Creation of custom templates.
- A personal **My templates** cloud library.
- Email magic-link sign-in through Supabase.
- Cross-device cloud synchronisation for saved templates.

Current UI has shown states including:

- `Cloud connection required` before Supabase variables were available.
- `Sign in for permanent cross-device templates` once the app could see Supabase configuration.
- `Synced as <user>` after successful email authentication.

### Curated editorial starter pack

On 2026-08-30, PR #7 added six built-in templates derived from the user's own Instagram carousel visual language: **Rounded stories**, **Travel notes**, **Editorial portrait**, **Formal gathering**, **Night frames**, and **Quiet landscape**. These are available for every supported output format and complement the original utility layouts with warm-white, rounded, editorial compositions.

### Template library filters

On 2026-08-30, PR #8 added compact filters to the Templates library. Users can combine the existing output-format selector with an **exact photo-count** filter (for example, `2`) and **corner treatment** filters: **Rounded**, **Straight**, or **Mixed**. The library automatically includes relevant counts from custom templates and offers a one-click clear action.

### Image repositioning

- Images can be repositioned within a fixed frame by dragging; movement is constrained to keep the frame covered.

Existing living backlog document:

- **Scuri — Upcoming Features**
- `https://docs.google.com/document/d/1MoA7dIhztuWHU3lsp4ljRJa9EU6OgCBAumSu6KLH_HA/edit`

Existing project history document:

- **Scuri — Change Timeline**
- `https://docs.google.com/document/d/1EzYIQcQbDIdQ-Rzzr38FwE7vnDpavuda2tsc5_JuuBw/edit`

Other Scuri project docs have also existed (for example Product Overview / Status & Roadmap); use them as supporting history, but this file should remain the concise technical/product handoff.

---

## GitHub / release workflow

Feature work has been developed on branches and deployed as Vercel Previews.

Relevant PR history:

- **PR #4** — iPhone/Safari drag-and-drop callout fix (`agent/fix-ios-drag-callout`). Closed as superseded by #6.
- **PR #5** — project/navigation work. Closed as superseded by #6.
- **PR #6** — cloud template designer / templates release (`agent/cloud-template-designer`). Squash-merged into `main` on 2026-08-12.

Important: commit IDs and exact PR heads can change during development. **Query GitHub/Vercel first rather than relying on old chat screenshots.**

Preferred release workflow:

1. Work on a feature branch.
2. Open/update PR.
3. Let Vercel create a **Preview** deployment.
4. Test the Preview thoroughly.
5. Merge the PR into `main` when approved.
6. Let Vercel deploy **Production automatically from `main`**.
7. Verify production after deployment.
8. Avoid manually promoting a feature-branch Preview to Production unless there is a deliberate reason.

---

## Safari / iPhone issue already addressed

An iPhone Safari bug caused native selection/drag actions such as Copy / Search-style callouts to appear while rearranging photos on the canvas.

The final #6 release retains the callout-suppression changes from PR #4. Physical iPhone verification remains useful for Safari-native gesture behaviour that cannot be fully reproduced by server/build checks.

---

## Supabase

### Project

Supabase project/resource:

- `supabase-teal-nest`

Vercel shows the Supabase integration connected to the `scuri` project.

### Correct browser environment variables

Scuri expects these exact variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

They have been manually created in Vercel for **Production and Preview** using the values supplied by the existing Supabase integration.

### Mis-prefixed integration variables

The original Vercel/Supabase connection created many variables with an incorrect custom prefix, resulting in names such as:

- `NEXT_PUBLIC_SUPABASE_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_NEXT_PUBLIC_SUPABASE_SUPABASE_URL`

It also created sensitive/server values with `NEXT_PUBLIC_` in their names, including variants corresponding to:

- Supabase secret key
- service-role key
- JWT secret
- Postgres password / connection details

**Security note:** there is no evidence from the debugging session that these secret values were actually exposed to end users, and their values were not pasted into chat. However, they should not be used in client-side code. Once the connection is stable, clean up the integration configuration carefully so secrets do not carry misleading `NEXT_PUBLIC_` names. Do not delete/rotate blindly without first confirming what the deployed app and integration actually depend on.

### Vercel deployment behaviour

Environment-variable additions/changes require a new Vercel deployment/redeploy to be picked up by a Next.js build.

---

## Supabase Auth

Email magic-link authentication is enabled and has been tested successfully.

### URL configuration currently set

**Site URL**

- `https://scuri.vercel.app`

**Allowed redirect URLs**

- `https://scuri.vercel.app/**`
- `https://*-nugee.vercel.app/**`
- `http://localhost:3000/**` (local development)

Previously the Site URL was `http://localhost:3000` with no redirect allow-list, which caused successful magic-link authentication to redirect to localhost. That has been corrected.

Supabase's built-in email sender has a low testing quota, so avoid repeatedly requesting magic links while debugging.

---

## Supabase database state verified during the 2026-08-12 release

Live project `supabase-teal-nest` was verified **ACTIVE_HEALTHY**.

Live migration history matches the repository:

- `20260811172718_create_templates`
- `20260811172858_restrict_templates_to_authenticated`

The live `templates` table schema matches the app's queries. RLS is enabled and authenticated owner-only policies exist for SELECT, INSERT, UPDATE and DELETE.

A live ACL inspection showed broader **non-DML** table privileges than the release description originally implied. Owner-only RLS and DML access are correct, but privilege hardening should be reviewed separately before changing the database. No speculative privilege migration was applied during this release.

---

## Cross-device acceptance test

This remains the final user-device acceptance test for cloud templates:

1. Open Scuri on iPhone.
2. Sign in with email.
3. Create a custom template.
4. Save it.
5. Confirm it appears under **My templates**.
6. Open Scuri independently on iPad (or desktop) in a fresh browser/app instance.
7. Sign in with the same email.
8. Confirm the template appears without manual transfer.
9. Edit or create another template on the second device.
10. Return to the first device and use **Sync now** / refresh as appropriate.
11. Confirm the library converges correctly.
12. Confirm local project drafts are not unexpectedly lost or overwritten.

Only after this passes should the cloud-template feature be considered fully accepted on physical devices.

---

## Production vs Preview rule

Production should come from `main`. Feature branches should create Vercel Previews only.

Before future release work, explicitly verify:

- what commit `main` points to;
- what commit the active PR points to;
- what commit/branch the current Production deployment was built from;
- what Preview deployment corresponds to the active PR.

Do not infer this from old screenshots because deployment state changes over time.

---

## Release status — 2026-08-12

The cloud Templates release has been merged and deployed.

Verified live state after release:

- **PR #6** (`agent/cloud-template-designer`) was squash-merged into `main`.
- Release merge commit on `main`: `556518085bf3e259a0bb18466e5965f079a11120`.
- **Vercel Production** deployed automatically from that exact `main` commit; no feature-branch Preview was manually promoted.
- Production deployment `dpl_4p3aUsaEtRz31jAre7jE7StiYP8J` reached **READY** and `https://scuri.vercel.app` returned HTTP 200.
- The production Next.js build compiled successfully and completed TypeScript checking.
- No Vercel runtime error clusters were present in the post-release check window.
- **PR #4** and **PR #5** were closed as superseded by #6.
- Supabase project `supabase-teal-nest` was verified **ACTIVE_HEALTHY**.
- Live Supabase migration history matches the repository files.
- The live `templates` table schema matches the app queries, RLS is enabled, and owner-only SELECT/INSERT/UPDATE/DELETE policies are present for authenticated users.
- `@supabase/supabase-js` is pinned to `2.112.2`.
- Two final PR review issues were fixed before merge:
  - legacy project migration no longer risks clearing the only saved copy if the new localStorage write fails;
  - copying a built-in template now materialises its gutter/inset geometry so the custom copy keeps the same visual spacing.
- Two regression tests were added for those final fixes. The earlier 29-test suite had passed before those additions; the final Vercel production build passed, but the two newly added unit tests were not independently run in this connector-only session.

Still outstanding / requires user-device validation:

- Run the physical cross-device acceptance test using the same account on iPhone and iPad/desktop.
- Re-audit and carefully clean up the old mis-prefixed Vercel/Supabase environment-variable entries once the cross-device flow is confirmed. Do not delete or rotate secrets blindly.
- Review the broader non-DML table privileges separately before applying any privilege-hardening migration.

Going forward, treat `main` as the production source of truth and keep feature branches Preview-only unless there is an explicit reason to do otherwise.

---

## Release status — 2026-08-31 (not yet merged)

Branch `agent/supabase-project-sync`, built on top of `main` at commit `71fa515` plus a reused/refactored copy of Codex's `codex/google-drive-project-sync` snapshot (that branch itself never reached GitHub - only `main` and the existing `agent/*` branches exist remotely).

What this branch adds, verified locally (typecheck, lint, all 48 vitest tests including 15 new project-sync tests, and `next build --webpack` all pass):

- Supabase migration `supabase/migrations/20260831120000_create_projects.sql` (`projects`, `project_pages`, `project_assets`, owner-only RLS, revision trigger) - **applied to the live `supabase-teal-nest` project** (confirmed with the user first). The Supabase security advisor's `function_search_path_mutable` warning on the three trigger functions was fixed in both the migration file and live.
- `src/lib/project-sync.ts`, `src/lib/supabase-client.ts` (new), `src/lib/google-drive.ts` (rewritten - asset warehouse only, manifest/project-authority code removed), `src/lib/types.ts`, `src/components/layouts-app.tsx` and `src/components/project-library-card.tsx` (wired to the new sync engine).
- User-facing rename from "Layouts" to "Scuri" (matches this file's product name; was already implemented by Codex).

Not yet done:

- No GitHub push credentials were available in the environment that built this - the branch exists locally where it was built (and as a git bundle left alongside the original handoff files) and needs to be pushed and opened as a PR from a machine with push access.
- No physical-device acceptance testing (see the acceptance test in the original handoff brief) - this needs a real Supabase session and Google account, which an automated build cannot provide.

---

## Release status — 2026-09-12

PR #12 (**Refine vertical pair and template resizing**) was squash-merged into `main` and deployed to Production.

- The built-in **Vertical pair** now uses an outside border equal to its centre gap.
- The custom Template editor now offers **Resize from centre**, which keeps a frame centred while corner-resizing; one-sided resizing remains the default.
- Production deployment `dpl_7hmjC5E49ZJi9ynSE5JX4ip9jrSR` reached **READY** from main commit `f9b4b22`.
- Verification before release: 54 unit tests passing, TypeScript, ESLint, diff check, and production build completed successfully.
- No Supabase schema or configuration change was required.

---

## Local safety fix — 2026-09-13 (not deployed)

Historical first patch; the approved client safety release below supersedes its protection-result, retry and cache-lifecycle details.

Prepared and tested against the supplied `scuri-main.zip` only. No Supabase, Google Drive, GitHub, Vercel or browser session was accessed. The reported Islands state in the handoff has **not** been revalidated or repaired. Earlier live-state entries above remain historical.

**Safety invariant:** missing IndexedDB bytes, a missing/expired Drive token, failed downloads, and failed image decoding must never be interpreted as a user deleting a cloud photo. Supabase remains authoritative for projects, page/frame assignments and crop metadata. Drive stores originals/previews; localStorage/IndexedDB remains a cache.

- `project-photos.ts` preserves unavailable assignments separately from loaded `PhotoAsset` objects. `serializePage` includes both. Page/template mismatches do not silently drop saved records.
- The active editor adopts cloud metadata synchronously, reusing matching loaded bytes. Byte hydration runs separately, retries when Drive token restoration succeeds, and ignores late results for removed/replaced assignments. Push acknowledgements reconcile Drive ids without discarding edits made during the request.
- `pushProjectToCloud` reads the current remote project before any Supabase mutation and refuses unexplained missing assignments **or pages**, including partially empty snapshots and page-deletion cascades. A protection result restores canonical cloud metadata in the library and open editor; it does not create a blank cloud copy.
- Only explicit Remove (confirmed), Replace, rearrangement, confirmed layout change, or confirmed page deletion records deletion intent. Intent identifies each observed `(pageId, frameId, blobKey)`; page deletion also records the page id. It is cached locally across reloads and cleared only after a complete successful push. Old cached projects without this optional field remain readable; unexplained old-style deletions fail closed and must be repeated explicitly.
- Asset deletion is scoped to the observed project/owner/row/page/frame/blob identity. There are no project-wide/`NOT IN` deletes. Confirmed page deletion removes known assets first and checks for remaining assets before deleting the page. Replacements/swaps retain row identity for the occupied slot; new rows get new ids, independently of blob keys. Conflict/recovery copies get fresh page ids and their own future Drive folder; shared cached originals are retained while another local project references them.
- Future original/preview uploads include `scuriProjectId`, `scuriPageId`, `scuriFrameId`, and `scuriBlobKey`. These are **upload-time recovery hints**, not a live manifest: later moves/crops or reuse of a Drive file can make them stale. Existing files are not rewritten and need no new metadata to load normally.
- No schema change or migration is needed. The existing revision gate and multi-request REST writes remain; this patch does not make all project writes transactional or protect against an old deployed client continuing to use the old deletion logic. Partial-write retries retain local intent. An unchanged failed backup is not retried endlessly; edits, reconnection or manual sync can retry it.

**Islands recovery limitation:** this fix prevents this loss path; it cannot reconstruct already-lost frame mappings/crops. Later, with explicitly authorized live connectors, preserve read-only database/Drive evidence and the original device's browser cache before writes. Look for the original local mapping or an isolated historical database restore/export. If neither survives, use verified Drive originals to build a separate recovered copy and have the user place photos manually. Do not guess frame order, deduplicate/delete originals, or infer exact crops from old Drive files. See `ISLANDS_RECOVERY.md` for the manual procedure and `PHOTO_SYNC_FIX.md` for the trace and verification scope.

Local verification: **85 tests passed** (54 baseline + 31 new), TypeScript passed, ESLint passed without warnings, and the Next.js production build completed. The suite uses synthetic service mocks, not live accounts. See `VERIFICATION.md`.

---

## Product backlog / later ideas

Confirmed upcoming feature:

- Below-baseline photo scaling is included in the local zoom/arrangements release below; live deployment and physical-device acceptance are not established here.

Continue adding new ideas to the **Scuri — Upcoming Features** document and periodically summarise accepted product decisions into this context file.

---

## Approved client safety and backup release — 2026-09-13 (not deployed)

The user approved the audit's recommended first implementation. This is a local source release; no live service, browser, real credentials, migration, deployment or Islands recovery was used. No dependency versions or SQL schema files changed.

**Safety invariant:** temporary absence of photo bytes is never deletion intent. Supabase remains authoritative for project/page/frame/crop state; Drive remains an original/preview byte store. All unavailable assignments survive serialization, hydration, retry and active-editor reconciliation. Intentional Remove/Replace/page/layout actions still generate exact durable deletion intent. Undo is another explicit edit: it restores content using the latest revision, retains learned Drive IDs, cancels restored tombstones and records any new removals.

Implemented:

- Account-scoped project and template cache keys. Legacy/unscoped data is retained in Local workspace and is never silently assigned/uploaded to whichever account signs in next. To transfer a local project, download its portable backup, sign in, then restore it. Manual Drive connection can load older local originals; silent restoration is account-scoped. A workspace generation cancels stale asynchronous state changes, and queued project/template writes verify the expected account.
- A serial queue reconstructs pending work from every cached dirty project, including inactive ones. It retries transient failures with bounded backoff, resumes on connectivity changes, and is reset at account changes. Focus/reconnect triggers pulls; pulls overlapping a push are scheduled again. This is a per-runtime queue, not a cross-device transaction lock.
- The missing-assignment guard keeps meaningful local edits in a separate recovered copy before adopting remote metadata. Purely empty/stale caches are simply reconciled. Decoded original dimensions survive stale/null-derived stored dimensions. Filename, MIME type and file size are captured for future imports/uploads.
- Drive original/preview IDs are checkpointed independently before the next upload, preserving progress across subsequent failures. In-memory originals remain available to the backup path when IndexedDB fails. Backup status distinguishes metadata save, originals/previews backed up, available local photos and expired Drive access.
- IndexedDB success waits for transaction commit and handles aborts. Project records are validated as a whole; corrupt data is not silently filtered into a smaller library. Before a damaged raw library can be overwritten, its exact contents must be preserved under a recovery key. Failed writes leave a persistent warning and backup/retry actions.
- Portable `.scuri.zip` backups include page snapshots, crops and available original bytes, with SHA-256 integrity checks. Missing originals are disclosed; imports validate and display a review dialog, then create fresh project/page/blob identities and discard imported cloud IDs/revisions. No existing project is replaced. The 256 MB package/expanded-size cap is explicit. A portable backup manifest is an export format only: it is never used as a Drive manifest/source of truth.
- Project Undo/Redo keeps up to 40 content steps, coalescing crop gestures and retaining needed bytes. It preserves current sync acknowledgement state; opening another project, reloading or changing accounts resets history. Recently deleted projects can be restored as new copies during the same workspace session (up to 10). This is not persistent cloud version history.
- Project deletion blocks queued work, waits for issued writes, then writes a cloud tombstone before removing the local entry. Drive folders and shared original/cache bytes are retained. Physical cleanup is deliberately separate from assignment deletion; there is no automatic orphan-file cleanup in this release.

Verification: 110 offline automated tests (25 more than the prior 85), typecheck, lint and production build. See `CLIENT_RELEASE.md` and `VERIFICATION.md` for final results and manual acceptance limits.

Remaining: A02's project/child write race is **not fixed** by this client queue. The current revision gate plus separate REST child writes cannot guarantee atomic cross-device saves. That needs a reviewed transactional write/read operation and a justified additive database migration. Full template conflict control, cloud pagination/completeness, persistent history/Trash, resumable byte ranges across reloads, a persistent photo tray and remaining UX/performance work are separate audit items. No existing assets may be deleted or rewritten by migration/seed/test helpers.

**Recovery limitation:** this release cannot reconstruct already-lost Islands frame/crop mappings. Older Drive files do not acquire the new identity hints. Even newer hints describe upload-time placement only. Preserve and review live evidence later under separate authorization; never infer exact historic mappings/crops from file order or filenames. The existing `ISLANDS_RECOVERY.md` remains the manual plan.

## Zoom and arrangement suggestions — 2026-09-13 (not deployed)

The user authorized only below-baseline photo zoom and a focused non-AI arrangement feature on top of the preceding client safety release. No remaining audit recommendations were implemented. No live Supabase, Drive, Vercel, GitHub, browser session, credentials or recovery was used.

**Final safety invariant:** Supabase owns project structure, page/frame assignments, crop metadata and the independent photo library. Drive stores original/preview bytes only. Browser storage and colour analysis are disposable caches. Missing local bytes, delayed Drive access, failed downloads or failed analysis must never remove a library original or imply deletion of a cloud assignment. Metadata adoption/reconciliation remains independent of byte hydration. Cloud pushes still fail closed on unexplained missing assignments/pages. Only explicit assignment actions record scoped deletion intent; removing a frame/page retains its originals in the library and does not trash Drive files. This release has no library-original deletion or automatic cleanup action.

- Crop zoom remains a positive stored scale factor: 1 is the historic fill size, displayed as 0%. Negative displayed percentages use factors below 1. These shrink and centre the uncropped image within the same frame, exposing the page background. The slider minimum adapts to source/frame proportions so the whole image can fit with further surrounding space. Existing valid crops at or above 1 render as before; no saved crop rewrite or schema migration is needed. Editor, thumbnails, suggestion previews and exports share placement/drawing code. Panning below the baseline keeps the image centred; panning above it retains the existing constraints.
- Optional local photoLibrary metadata is the union of known originals by immutable blobKey, seeded from existing assignments without needing new Drive metadata. Direct frame imports and independent library imports retain originals. Undo changes assignments without removing library membership. Portable backups now include unassigned originals and disclose missing bytes, while still accepting older backups. Analysis caches never establish membership. Photos can be manually assigned from the library even when their bytes still need hydration.
- Independent cloud originals genuinely require a schema extension: existing project_assets rows require page_id/frame_id. The single proposed migration, 20260913180000_add_project_photo_library.sql, adds a projects.photo_library JSONB array under the existing project RLS/revision gate. It is **prepared for review only and has not been run**. All three previous migrations and package dependencies are unchanged. There is no asset DML, backfill, deletion, constraint repurposing or policy weakening. See PHOTO_LIBRARY_MIGRATION_REVIEW.md before any separately authorized rollout.
- On an older schema, project reads and assigned-only saves work. A save with independent unassigned photos fails before page/asset writes with an explicit cloud-library setup error, retaining the local project. Newly displaced originals also count as unassigned; install the reviewed column before releasing the full library/removal workflow. Do not label such failed metadata saves as backed up. Old clients omit the new column, but cannot understand library-only photos or render new below-baseline crops correctly: update active clients before using the new workflow across devices.
- The project/editor photo panel runs local analysis and proposal scoring in a module worker, with one image analysis at a time, progress, cancellation and retry. Uncropped previews are sampled at up to 96 pixels on the longest edge. Up to five weighted dominant OKLab palette colours, perceptual brightness and saturation describe each original; comparisons use weighted perceptual palette distance. Small thumbnails/analysis are cached by account, immutable photo identity/dimensions and analysis version. Unsupported worker/canvas APIs leave all metadata intact and manual editing available.
- The bounded deterministic heuristic jointly evaluates photo groups and existing built-in/eligible saved custom templates, using actual output dimensions, template gutters and resolved frame proportions. It scores fill-size crop loss, palette compatibility and template repetition with separate Colour harmony, Best fit and Balanced mix weights. It returns up to three meaningfully different proposals, ignoring differences that merely reorder pages or rename layouts. It does not promise global optimality or recognize subjects/faces.
- New independent imports/analysis are capped at 200 originals; proposals respect the existing 20-page limit and eligible templates have 1–12 frames. Existing larger libraries are never truncated. Each photo is placed at most once per proposal; unavailable/over-limit photos are explicitly listed as unplaced and retained. Previewing changes no assignments. Explicit Apply validates the current library and creates a new project with fresh project/page IDs, its own assignments at centred fill size, and the complete original library. The source arrangement and its crops remain available in the original project. Subsequent edits use normal editor/undo behaviour.
- Future Drive uploads of unassigned originals/previews include project ID and blob key. Page/frame hints are included only when placement exists at upload time. Reused files are not rewritten, and identity hints are never used as an authoritative or complete manifest.

Verification: **136 offline automated tests in 16 files**, TypeScript, ESLint and the production build passed, including the worker build. New tests cover panorama zoom/save/restore/shared rendering, palettes and colour grouping, actual frame/gutter matching, unique complete placement accounting, distinct proposals, unavailable photos, explicit new-copy application, library cloud/backup compatibility, missing-column failure before child writes, worker/cache handling and a synthetic 200-photo case. Browser pixel/device/OAuth/RLS checks and the SQL execution were not performed. See ZOOM_ARRANGEMENTS_RELEASE.md and VERIFICATION.md.

**Remaining safety limitation:** A02's cross-device child-write race is unchanged. Separate REST writes are still not a transaction; a client queue and additive library column do not make project/child saves atomic across devices. Its transactional fix, pagination/completeness and the remaining audit roadmap are separate work.

**Recovery limitation:** this feature cannot reconstruct already-lost Islands mappings or crops, and no current Islands state was inspected. Old Drive files do not contain the new metadata; even new upload hints can be stale after moves or copy reuse. Later, under separate live authorization, preserve the database/Drive inventory and original-device cache, seek a recoverable historical mapping, and use a separate recovery copy for any verified reconstruction. Without surviving mapping evidence, placement/crops require manual user reconstruction. Do not guess from filenames/order, overwrite the original project or delete suspected duplicates. ISLANDS_RECOVERY.md remains the separate manual plan.

## Upload-checkpoint protection recovery — 2026-09-13

Focused fix for PR #15 review discussion_r4001065158, prepared from main commit a8b0e5417ff0685929580e791a05e6e75ae7fecd. The preceding release was observed on GitHub main and Vercel's current Ready production deployment during the separate read-only deployment check. This checkpoint fix is being submitted for review and has not been deployed to production by this session.

On 14 September, the user relayed a live connector confirmation that projects.photo_library exists as required JSONB with an empty-array default and array-only constraint, with owner-only RLS, authenticated grants and the revision trigger unchanged. The connector reported no asset, Drive-file or existing-project-row changes. This session did not independently query Supabase. The applied migration was recorded as 20260913224149_add_project_photo_library, while the committed filename still begins 20260913180000; filename/documentation alignment is separate from this checkpoint fix. Do not run the additive SQL again merely to reconcile those names.

The previous protection handler adopted result.remote directly after Drive uploads. When uploads were the only local changes, preserveProtectedLocalEdits returned no copy, so newly checkpointed original/preview/folder IDs were discarded. The same gap could lose the project folder even when meaningful edits were preserved in a copy.

reconcileProtectedProject now combines protection reconciliation and edit preservation: cloud pages, order, assignments, crops, asset-row identities, revision and acknowledgement remain authoritative; only missing original/preview IDs for matching immutable blob keys and a missing project folder ID are filled from known checkpoints. Existing cloud IDs win. Both assigned and cloud-library-only photos are covered, without adding local-only placements to the canonical project. Local-only photos and genuine edits still use the existing separate recovery-copy path. Checkpoint progress alone does not create a recovery copy.

Retained checkpoint metadata is marked dirty using a timestamp later than the cloud acknowledgement, even with a lagging device clock, so the existing queue can persist it on the next metadata push. The cache, project list and active editor adopt that same canonical result. Partial byte-upload failure remains a retryable error. Missing bytes still never mean deletion; no absence guard or explicit-deletion requirement was weakened.

The synthetic regression reproduced the old loss before the fix. Coverage includes protection -> cache reload -> active-page reconciliation -> cloud retry; original/preview checkpoints independently; no repeated original upload after preview failure; cloud ID precedence; frame moves; unassigned originals; preserved local edits; and unchanged already-acknowledged snapshots. All 144 tests, TypeScript, ESLint and the production build pass. Final check/package details are in UPLOAD_CHECKPOINT_FIX.md and VERIFICATION.md.

No schema/migration, dependency, RLS, live database, Drive byte/file, project asset or recovery changes are included. Existing SQL files are untouched. This cannot rediscover upload IDs already lost by older clients; it prevents future loss in this protection path. The previously documented cross-device child-write transaction gap and Islands recovery limitations remain separate.

## Four built-in panorama choices — 2026-09-15 (local, not deployed)

Implemented on `feat/exact-panorama-templates` from freshly fetched main `6df71f9b0f51392694ff628c79cb15c370d96a32`. This change adds only the requested panorama layouts and their verification; it does not implement further UX audit recommendations.

- The user refined the initial local proposal to four panorama choices: `5 Pano · 40:9`, `5 Pano · 40:9 · Borderless`, `7 Ultra Pano · 768:115`, and `7 Ultra Pano · 768:115 · Borderless`. Lower-count panorama variants are removed from the registry. All 45 preceding built-ins and custom-template behavior remain unchanged; the portrait picker contains 21 built-ins and the total across formats is 49.
- Exact layouts retain IDs `instagram-post-pano-40-9-5` and `instagram-post-ultra-pano-768-115-7` and their original bounds. Both have 1016px-wide frames, 32px symmetric side margins and 32px gaps, with vertically centred stacks. Five Standard Panos have 228.6px-tall frames and 39.5px top/bottom space; seven Ultra Panos have `1016 * 115 / 768`-pixel-tall frames and approximately 46.5260417px top/bottom space. Matching originals remain entirely visible at 0% zoom.
- The new `-borderless` ID variants divide the unchanged 1080×1350 canvas into five or seven equal full-width rows, with no border or gutter. Their actual frame ratios are **4:1** and **28:5**, intentionally differing from the source ratios to fill the page without stretching. Normal centred cover placement at 0% zoom crops **10%** of a 40:9 original's width (5% per side) and **31/192 ≈ 16.1458333%** of a 768:115 original's width (approximately 8.07% per side). The full original height is retained, and normal panning can choose the horizontal crop. Names identify the intended source family, not an exact frame ratio for the borderless variant.
- Bounds remain normalized directly. `defaultGutter: 0` means no **additional** inset: exact layouts already encode their 32px spacing; borderless layouts have none. The existing Border and gutter control remains a manual adjustment. Default crop stays `{ positionX: 0, positionY: 0, zoom: 1 }` (displayed 0%). No special renderer, crop offset, baked-in negative zoom, stretching or new metadata fields are used. Existing shared frame/crop code handles the editor, all previews, arrangement scoring and JPEG export. Deliberate negative zoom can still expose background as normal.
- Verification: **185 tests passed in 18 files**, including 41 panorama cases, plus typecheck, lint and production build. Coverage includes the four-choice registry, exact geometry, borderless complete-page coverage, expected crop loss, safe panning, real picker SVGs, scaled shared drawing/JPEG calls, custom copies and crop/assignment persistence with unavailable bytes. Comparisons confirm all 45 earlier definitions and both retained exact panorama definitions are unchanged. Rendered picker SVGs were visually reviewed. Browser pixel comparisons, device gestures and live cloud sync were not run.

The photo safety invariant remains unchanged: unavailable cached/Drive bytes never imply deletion; Supabase owns project structure/assignments/crops/library metadata and Drive stores bytes. No migration, dependency, existing asset or live-service changes are included. This layout addition cannot recover lost Islands mappings or create metadata on old Drive files. The existing manual recovery plan remains separate. The production build is a local verification, not a deployment.

## Panorama production release — 2026-09-15

The user approved deployment of the final four panorama choices. PR [#17](https://github.com/NewGhee98/scuri/pull/17) is merged and closed; main is `88f95bb836728ab4471622481ab84a91406d5d72`. The review head `ddd763fc49270ed9c0313a8bda4275f080aa9cb2` and the merge commit both have exactly the tested local `e0eb5af` tree (`5cd97f68a5b756a685b007880134b20d907e5d44`). The 185 passing tests, typecheck, lint and production build therefore apply to the deployed source unchanged. GitHub reported two successful checks and no conflicts before merge.

Vercel [deployment BB8WfW2Rh7ApH82EEnVrrSiag3sA](https://vercel.com/nugee/scuri/BB8WfW2Rh7ApH82EEnVrrSiag3sA) was verified Ready, Production and Latest, built from `88f95bb` on main, with `scuri.vercel.app` in Current Domains. A refreshed signed-in production browser showed all four named panorama choices among the 21 portrait built-ins. Their five/seven-strip previews, exact-layout whitespace and borderless coverage were visually checked. Verification stayed in the project overview/template library; no project was opened or edited, and no migration, service setting or Drive operation was performed.

This release supersedes the panorama section's pre-deployment status above. The new production result is recorded in the local handoff and `../../outputs/SCURI_PANORAMA_PRODUCTION_2026-09-15.md`; the committed implementation documents describe verification before deployment. The photo safety invariant, separate Islands recovery limitation and previously documented sync limitations are unchanged. Live photo upload/export, cross-device persistence and physical-device gestures were not exercised by this deployment check.

## Editor alignment, preview and library cleanup — 2026-09-16

Implemented locally on `feat/editor-alignment-preview-library`, based on main `88f95bb`. These changes are for review and are **not a production deployment**. The preceding panorama production record is retained as historical evidence.

- **Selected-photo zoom:** gentle alignment to other photos' clipped, visible image edges, with guides and a Snap toggle. Slider, pinch and wheel use raw gesture values so continuing past a snap point releases it; Alt bypasses canvas snapping. Typed signed percentages and keyboard adjustments are exact and bypass snapping. The numeric field accepts decimals, validates the existing zoom range, and never rounds a saved crop merely because it received/lost focus. Zero remains the existing fill-frame baseline; stored scale/crop representation is unchanged.
- **Preview:** a fullscreen, read-only view starts on the active page and supports Previous/Next, arrow keys and horizontal swipes. It calls the actual JPEG renderer with originals and the existing background, frame order and crop geometry. Obsolete renders are cancelled and object URLs released. Unavailable assigned photos block a misleading preview; genuinely empty frames are disclosed as a draft. Preview navigation never changes the active editor page or arrangement.
- **Move frames:** a separate mode translates frames with their photos, allows overlap, gently snaps frame edges, and provides a frame selector plus Bring forward/Send backward. Arrow keys move by one output pixel, Shift by ten. Movement stays within page bounds. Only an explicit move materializes the page's already-rendered frame bounds into its existing `templateSnapshot`; IDs, sizes, corner radii, assignments and crop objects remain intact. Existing spacing becomes part of those bounds and the gutter slider starts at zero additional inset. Undo restores the original snapshot/gutter. Reusable built-ins/custom templates are never edited by this operation.
- **Exact duplicates:** Find duplicates compares SHA-256 plus byte length of untouched originals, sequentially and asynchronously, with a disposable account/original-scoped fingerprint cache. Names, dimensions, palette analysis and Drive previews are not evidence of equality. The review requires an explicit Combine action and can be cancelled. Unverifiable originals remain listed. Library cards and new arrangement suggestions show each combined photo once; usage counts include every retained placement.

### Preservation and compatibility invariant

Opening, hydrating, previewing or inspecting a project must not rewrite its image configuration. An unavailable local/Drive original never represents deletion. Explicit duplicate cleanup changes **library grouping only**: optional `ProjectPhoto.duplicateOf` links in the existing `projects.photo_library` JSONB combine cards while retaining all original metadata. Every page/frame/blob/cloud-row identity, crop, Drive original/preview reference and assignment remains unchanged, including repeated placements on one page. `null` explicitly undoes grouping; an omitted legacy field does not clear it. Invalid or dangling links show entries separately rather than hiding photographs. Raw original references remain available to backup/sync and are remapped only when deliberately restoring a new project copy.

No migration, dependency, Drive deletion, project-asset deletion or automatic deduplication is added. Supabase remains authoritative; Drive stores bytes and browser storage is a cache. Revision/conflict and explicit-deletion guards remain in place. An old-schema fallback cannot acknowledge library grouping as saved if `photo_library` is missing. In-flight save acknowledgements retain newer grouping/undo edits and upload checkpoints. Older clients may display duplicate cards again; grouping never rewrites their existing assignments. Undo remains session-scoped as stated in the app.

This work does not recover Islands or reconstruct lost frame mappings from old Drive files. The previously documented live-connector recovery plan remains a separate manual task; new metadata cannot repair old files retroactively.

### Verification

234 automated tests in 20 files pass, including all prior sync/protection, panorama, crop, custom-template, backup and arrangement tests. New cases cover clipped-edge snapping/release/bypass; exact signed input; moved frame sizes/IDs/crops and unavailable assignments; save/hydration/undo; matching preview/editor/thumbnail/JPEG geometry and cancellation; exact-byte duplicate proof, unavailable originals, explicit review/stale-scan rejection, aliases, cloud writes without asset deletion, old-client merges, upload checkpoints, undo/redo and portable restore. Typecheck, lint and the production build pass.

Chrome verification used only `127.0.0.1:3016` with all Supabase/Drive public configuration explicitly blank and generated synthetic photographs. Checked exact `-12.34567%` retention through blur and reload, invalid input, frame movement/undo/layer controls, duplicate review/cancel/apply/undo/redo, two retained placements with different crops, carousel preview navigation/Escape, complete-page fitting at desktop and 390×844, and actual 1080×1350 JPEG rendering. No browser errors/warnings were recorded. Physical iPad gestures and live cross-device cloud synchronization were not exercised; snapping mathematics and persistence were covered with automated fixtures. No live project or Drive data was accessed or modified.

## Editor production release — 2026-09-16

After explicit deployment approval, PR [#18](https://github.com/NewGhee98/scuri/pull/18) was merged and closed. Freshly fetched main is `52b3b2088dc61d51517d9d8428ba8e2fd96da361`. Both the review head `b4be84d04d0f010c1ef87c8b2da5c63fd8dc5033` and merged main have exactly the tested local `0bdbf07` tree (`099bdf0f5030af5679513c931744d4dcf57aa1a4`), so the 234 passing tests, typecheck, lint and production build apply unchanged. GitHub reported two successful checks and no conflicts before merge.

Vercel Preview [DYG8BSuq62zaY1FXupkjLSEHRhEy](https://vercel.com/nugee/scuri/DYG8BSuq62zaY1FXupkjLSEHRhEy) was Ready from the review head. Its signed-out workspace was checked using synthetic photos: exact negative zoom, frame movement/undo, actual JPEG preview, explicit duplicate combination and saved/reopened crop/grouping all worked, with both photos restored and no browser errors/warnings. Immediately after combining, the analysis counter briefly counted original records (2 cards / 3 analysed); reopening showed 2/2. This cosmetic summary follow-up does not affect assignments or crops.

Vercel's deployment listing showed [Production FDDUpGXj1tziY7sx1q4zpcrXb16v](https://vercel.com/nugee/scuri/FDDUpGXj1tziY7sx1q4zpcrXb16v) Ready from `52b3b20` on main, with a 43-second build. A session-free public check at 11:36:06 UTC received HTTP 200 from `https://scuri.vercel.app` and found all five new UI markers in its published JavaScript. No production project was opened or edited, and no migration, Drive operation or service configuration change was performed. Physical iPad gestures and live cross-device sync were not tested.

This verified release supersedes the implementation section's pre-deployment status. The post-deployment record is local only, with full evidence in `../../outputs/SCURI_EDITOR_PRODUCTION_2026-09-16.md`; the deployed commit retains its pre-deployment implementation/test record. Photo safety, storage authority, explicit cleanup and separate Islands recovery limitations remain as documented above.

## Add-page replacement diagnosis — 2026-09-17

User requested diagnosis of Add page sometimes warning about replacement and overwriting an existing page. GitHub main and Vercel production were rechecked: both remain `52b3b208`, with production deployment `FDDUpGXj1tziY7sx1q4zpcrXb16v` Ready at `scuri.vercel.app`. Local `src` matches that commit. No application code or production/project/Drive data was changed.

Confirmed cause: Add page uses `activePageId = null` as implicit creation intent. A background pull, push acknowledgement or Drive upload checkpoint calls `adoptActiveProject`, which restores an incoming selection or falls back to the first page. `selectTemplate` then sees an active page and executes Change layout. Accepting its confirmation records deliberate assignment deletion intent and replaces the existing page, so the cloud safety guard permits it. Choosing the same template instead silently reopens the existing page. Autosave can persist this before Save page, which only returns to the overview.

Twelve isolated probes executing extracted unchanged handlers and real pure helpers reproduced the race with loaded/unavailable photos, all three reconciliation paths, same-template selection, cancel, first-page/control flows and session Undo. These were offline synthetic state tests, not a React/browser scheduling or live-account reproduction. Full diagnosis and executable evidence are in `../../outputs/SCURI_ADD_PAGE_DIAGNOSIS_2026-09-17.md`, `diagnose-scuri-add-page.mjs` and `SCURI_ADD_PAGE_DIAGNOSIS_RESULTS.json`.

The fix below implements the recommended explicit project-scoped picker intent separating Add from Replace with a pinned page target. Originals remain in the library after this bug, but lost mappings/crops need surviving session Undo or prior backup/evidence; no live recovery was attempted.

## Add-page intent fix — 2026-09-17 (verified locally; deployment pending)

The user authorized implementation and immediate deployment after validation. `layouts-app.tsx` now captures an explicit Add or Replace action when opening the template picker. Add always appends a fresh page, independently of selected-page changes from cloud pulls, save acknowledgements, upload checkpoints or history reconciliation. Replace is pinned to its requested page. Picker heading and highlighting use the same intent; selecting the existing template in Add still creates a new page.

Leaving the picker or changing projects/accounts clears intent synchronously. Completed choices consume it before a second click can act, and stale callbacks cannot reuse a cancelled/reopened picker. A missing replacement target safely returns to the project without choosing another page. Template selection checks the latest page limit. Explicit layout changes retain confirmation, library originals, exact deletion intent and Undo.

No schema, dependency, asset, crop-format, template or rendering changes. Existing pages/frames/assignments/crops/library and Drive references remain untouched by Add. Cloud metadata adoption and upload checkpoint handling continue normally; temporary unavailable bytes still never mean deletion. This patch prevents future accidental replacement; it does not reconstruct previously lost layouts/crops.

Validation: **257 tests in 21 files**, typecheck, ESLint and production build passed. The 23 new component-handler integration regressions execute extracted production handlers with controlled state commits and deferred real sync-helper results. The 12 primary race cases first failed on the production baseline and then passed: same/different templates following acknowledgement/checkpoint/pull, with loaded/unavailable photos. Additional checks cover save/reload, first page, repeated/stale clicks, navigation cancellation, project/workspace changes, pinned deliberate replacement/Undo, disappearing targets, page limits and format mismatch. These are handler-integration tests, not a DOM test-runner replacement.

An isolated Chrome production build at `127.0.0.1:3017`, with all cloud/Drive configuration blank, used a generated photo only. Undo/Redo while the Add picker was open exercised the real React project-adoption path; same-template and different-template choices appended separate pages (three total). Page 1 retained its photo and exact stored zoom `0.8765433` (-12.34567%). Explicit Change layout still displayed its normal confirmation, which was cancelled. Reopening from a fresh tab restored all three pages, the original image and exact zoom; no browser errors/warnings were recorded. No live project, Drive original or database was modified. Physical-device and real-account cross-device sync were not exercised.

## Guidance for future coding agents / chats

Earlier deployment/version statements are historical; the latest verified release is recorded in the editor production section above. Recheck live state before further changes.

Before making changes:

- Read this file.
- Read `CURRENT_TASK.md` and resume any unfinished work recorded there first.
- Inspect the current repository and deployment state rather than relying on stale commit IDs.
- Prefer small, reviewable PRs and Preview deployments.
- Preserve existing user data and local drafts during cloud-sync changes.
- Keep Supabase secret/service-role credentials server-only; the client should use only the public URL + publishable key under the exact expected `NEXT_PUBLIC_` names.
- Do not weaken RLS as a shortcut.
- Treat iPad/desktop as the primary interaction target, while keeping iPhone behaviour usable.
- Cloud template persistence across devices is a non-negotiable acceptance criterion.
- Update `CURRENT_TASK.md` after every discrete unit of work, and clear it once the task is done — see "Handoff between sessions / agents" above.
