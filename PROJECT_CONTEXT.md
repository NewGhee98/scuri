# Scuri — Project Context

_Last updated: 2026-09-20_

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
- **Browser storage (`localStorage` + IndexedDB) remains the local-first/offline cache**. The 19 September library rebuild adds a separate disposable derived-cache/job database; it does not rewrite the original-photo store or change project identity.
- Templates and projects are separate tables/features but **share one Supabase sign-in** (`src/lib/supabase-client.ts`); templates sync/RLS is unchanged.
- Conflict policy: never silently overwrite. A device whose push loses the revision race keeps its edits as a new, clearly-labelled "(conflicted copy)" project; the cloud copy stays canonical under the original id (`src/lib/project-sync.ts`'s `resolveProjectConflict`).
- Use the narrow non-sensitive Google `drive.file` scope, not broad Drive access. The 19 September library rebuild adds persistent byte-range resume for photo backups, with cloud-accepted reserved file IDs and separate original/preview/thumbnail checkpoints. Export-file uploads retain their existing path. Project deletion soft-deletes the Supabase row and retains Drive bytes because surviving copies may share them.

Required public environment variables:

- `NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID` (Google Drive backup; optional - projects still sync without it, just without full-resolution originals following the project to a new device)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (already required for templates; now also gate project sync)
- Optional direct imports: `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`, `NEXT_PUBLIC_GOOGLE_PICKER_APP_ID` (numeric Google Cloud project number), and `NEXT_PUBLIC_GOOGLE_PHOTOS_CLIENT_ID` (otherwise reuse the configured Drive OAuth client). Photos Picker requires its own API/consent scope. See `docs/PROJECT_PHOTOS_RELEASE_CHECKLIST.md` before claiming either direct picker is live.

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

- Images can be dragged on both axes at every photo zoom, including exact-fit and smaller-than-frame sizes. The fixed frame clips the photo and exposed space uses the page background. Centre photo preserves zoom; Reset centres at 0%. Optional free-position metadata preserves deliberate placement through later zoom changes, while untouched legacy crops retain their historical rendering. See the 20 September positioning release below.

Existing living backlog document:

- **Scuri — Upcoming Features**
- `https://docs.google.com/document/d/1MoA7dIhztuWHU3lsp4ljRJa9EU6OgCBAumSu6KLH_HA/edit`

Existing project history document:

- **Scuri — Change Timeline**
- `https://docs.google.com/document/d/1EzYIQcQbDIdQ-Rzzr38FwE7vnDpavuda2tsc5_JuuBw/edit`

Other Scuri project docs have also existed (for example Product Overview / Status & Roadmap); use them as supporting history, but this file should remain the concise technical/product handoff.

Confirmed documentation inventory on 20 September: the signed-in `App Projects / scuri` Drive folder contains those two documents plus [Product Overview](https://docs.google.com/document/d/1R1yIt6UgGGTSJAnbp1wzg6ZZTLNyseoxrXUeJtdug3s/edit) and [Status & Roadmap](https://docs.google.com/document/d/1NnVgZOhONDBdp9_tZMU2mngKThWCbRVT6K-xNOqbi2g/edit). Their August state descriptions predate project sync, photo backups, the independent library and all recent editor work. Product/status/backlog summaries should reflect deployed capabilities; dated timeline and implementation records remain historical. The README links the full set.

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

## Add-page intent fix — 2026-09-17 (deployed and verified)

The user authorized implementation and immediate deployment after validation. `layouts-app.tsx` now captures an explicit Add or Replace action when opening the template picker. Add always appends a fresh page, independently of selected-page changes from cloud pulls, save acknowledgements, upload checkpoints or history reconciliation. Replace is pinned to its requested page. Picker heading and highlighting use the same intent; selecting the existing template in Add still creates a new page.

Leaving the picker or changing projects/accounts clears intent synchronously. Completed choices consume it before a second click can act, and stale callbacks cannot reuse a cancelled/reopened picker. A missing replacement target safely returns to the project without choosing another page. Template selection checks the latest page limit. Explicit layout changes retain confirmation, library originals, exact deletion intent and Undo.

No schema, dependency, asset, crop-format, template or rendering changes. Existing pages/frames/assignments/crops/library and Drive references remain untouched by Add. Cloud metadata adoption and upload checkpoint handling continue normally; temporary unavailable bytes still never mean deletion. This patch prevents future accidental replacement; it does not reconstruct previously lost layouts/crops.

Validation: **257 tests in 21 files**, typecheck, ESLint and production build passed. The 23 new component-handler integration regressions execute extracted production handlers with controlled state commits and deferred real sync-helper results. The 12 primary race cases first failed on the production baseline and then passed: same/different templates following acknowledgement/checkpoint/pull, with loaded/unavailable photos. Additional checks cover save/reload, first page, repeated/stale clicks, navigation cancellation, project/workspace changes, pinned deliberate replacement/Undo, disappearing targets, page limits and format mismatch. These are handler-integration tests, not a DOM test-runner replacement.

An isolated Chrome production build at `127.0.0.1:3017`, with all cloud/Drive configuration blank, used a generated photo only. Undo/Redo while the Add picker was open exercised the real React project-adoption path; same-template and different-template choices appended separate pages (three total). Page 1 retained its photo and exact stored zoom `0.8765433` (-12.34567%). Explicit Change layout still displayed its normal confirmation, which was cancelled. Reopening from a fresh tab restored all three pages, the original image and exact zoom; no browser errors/warnings were recorded. No live project, Drive original or database was modified. Physical-device and real-account cross-device sync were not exercised.

## Add-page production release — 2026-09-17

[PR #19](https://github.com/NewGhee98/scuri/pull/19) was merged and closed after two successful GitHub checks. Freshly fetched main is `da5bb2bce5d1d16592db523a597cc5457980b9a0`. Its complete tree, `558d3140c10c46213ccb14143728e029773495ee`, exactly matches both the tested local commit `c17df6045b004051e914d9c8cf40ea96708f30b3` and uploaded branch head `c7f6ba37bbd9282f643b4c4f020fde31bf71cee7`. The validation above therefore applies unchanged to the production source.

Vercel [production deployment Cq8vpVRKTCt34eKDUAYqUxDydPTQ](https://vercel.com/nugee/scuri/Cq8vpVRKTCt34eKDUAYqUxDydPTQ) is Ready from `da5bb2b` on main and assigned to `scuri.vercel.app`. A session-free public check at 18:03:19 UTC returned HTTP 200, fetched nine published JavaScript assets, and found the new missing-page safety message plus all five prior editor feature markers. No production project, original image, database, migration or service configuration was changed. Existing open clients should refresh to load the fix; previously replaced layouts/crops are not reconstructed automatically.

This post-deployment record is local only; the deployed commit contains the implementation and validation record prepared before deployment. Full evidence is in `../../outputs/SCURI_ADD_PAGE_PRODUCTION_2026-09-17.md` and `SCURI_ADD_PAGE_PUBLIC_RELEASE_2026-09-17.json`.

## Session photo previews and composition guides — 2026-09-18 (deployed and verified)

User requested lightweight previews retained across project navigation, full-resolution page Preview, and composition guides. They confirmed the thirds grid and centre cross should stay fixed inside the selected frame and appear while it is selected for editing, with a Guides toggle. The feature was implemented on `feat/session-photo-previews-guides`, based on verified public main `da5bb2b`, and deployed following explicit user approval. See the production release record below.

`PhotoPreviewCache` retains display-only previews for the current app/workspace session. It reuses existing 320px uncropped analysis thumbnails or prepares previews up to 640px from local/volatile bytes or Drive's preview file. Project covers, page thumbnails, the editor and library share this cache. Concurrent requests for a photo are coalesced and preparation is limited to two jobs. Retention is capped at 64 MiB of compressed preview bytes / 1,000 entries; exceeding either limit evicts the least recently requested previews. Ordinary navigation does not clear the cache. Account/workspace changes and app teardown clear it, revoke URLs and invalidate queued/late results. Reloading starts a new session cache.

The safety invariant is unchanged: **unavailable original bytes never mean a deleted photo**. Display previews never become `PhotoAsset.sourceBlob`, enter the original IndexedDB namespace, mark an original as available, change library membership, or own assignments/crops. Rendering always uses current project metadata. Crops edited against a cached preview are stored on the existing unavailable assignment and retained when its original later hydrates. Deleted/replaced assignments cannot be restored from the cache. A small preview remains available while its higher-quality editor image decodes.

Full-resolution page Preview and JPEG export continue through the existing original-byte renderer at the project's output dimensions. They wait/report unavailable originals rather than silently substituting cached small images. No source original, schema, Drive file, existing project, crop format, frame geometry, template or synchronization rule is changed.

The editor alone draws fine thirds lines and a short centre cross clipped to the selected photo frame, with a dark under-stroke for visibility on light photos. Guides default on for the session, can be toggled, and do not appear in empty frames, rearrange mode, thumbnails, page Preview or exported JPEGs. Pan/zoom, negative zoom, frame movement and alignment snapping retain their existing geometry.

Validation: **287 tests / 23 files**, standalone typecheck, full ESLint (no warnings), production build and whitespace checks passed. The 30 added regressions cover cache reuse across navigation, concurrent requests, bounded work/memory, empty/failed IDB and disconnected Drive, late account-bound results, current assignments/crops, duplicate placements, preview-only crop edits followed by original hydration, deletion/replacement safety, full-resolution Preview, guide geometry/toggle/selection and the handover to higher-quality image rendering. Canvas effect tests execute the actual production draw callback; they are not a full React DOM runner.

Isolated Chrome QA at `127.0.0.1:3018` used only generated photos, with Supabase/Drive configuration blank. A two-photo portrait page showed guides only on the selected frame; the toggle worked and page Preview rendered at 1080 × 1350 without guides. Switching from photo project A to empty project B and back retained previews while originals reloaded. Exact stored zoom `0.8765433` (-12.34567%) and both photos survived project switching and a fresh app reload. No browser errors/warnings were recorded. Live-account cross-device sync and physical iPad gestures were not tested. Evidence summary: `../../outputs/SCURI_SESSION_PREVIEWS_GUIDES_2026-09-18.md`.

## Session previews production release — 2026-09-18

[PR #20](https://github.com/NewGhee98/scuri/pull/20) was merged and closed after two successful GitHub checks and a Ready Vercel Preview. Freshly fetched main is `b306a7105732c9799ea54168851e5d01078356e1`. Its complete tree, `dab84f4767d559ece9263aae4642b7e6f744c920`, exactly matches both tested local commit `d9248344d5ee28e884de738a0e301781a52ae476` and uploaded review head `be14fc36419e867c1b0a07863db9121e5c4f14c2`. Windows line endings introduced by five initial browser uploads were corrected from exact Git blobs before this verification. The 287 passing tests, typecheck, lint, production build and isolated Chrome checks therefore apply unchanged to the released source.

Vercel [production deployment CVHpYsvgiA2zvf1BbH5DypciAgc5](https://vercel.com/nugee/scuri/CVHpYsvgiA2zvf1BbH5DypciAgc5) is Ready, marked Latest/Production, and assigned to `scuri.vercel.app`, from `b306a71` on main. The build took 40 seconds. A session-free public check at 10:21:59 UTC returned HTTP 200, checked nine JavaScript assets, and found the new guide/preview messages plus all six prior editor/add-page safety markers. No production project was opened or edited, and no database migration, Drive operation or service configuration change was performed. Existing open clients should refresh to load the release; full-resolution Preview/export and the photo safety invariant remain unchanged.

This post-deployment record is local only; the deployed commit contains the implementation and validation record prepared before deployment. Full evidence is in `../../outputs/SCURI_SESSION_PREVIEWS_PRODUCTION_2026-09-18.md` and `SCURI_SESSION_PREVIEWS_PUBLIC_RELEASE_2026-09-18.json`. Existing Islands recovery limitations remain unchanged.

## Export quality review and proportional output — 2026-09-18 (local implementation)

Implemented on `feat/export-quality-preview`, based on the previously tested/released app tree at local `d924834`. This feature has **not been deployed**. The user authorised three bounded improvements: advisory photo-resolution checks, settings-aware preview with 100% detail, and proportional larger exports. No new format, print-colour workflow, PNG option, migration or live service change is included.

All three export entry points (editor, page card and project-wide export) now open a review before creating JPEGs. The same review controls are available in read-only Preview. Standard output remains unchanged; 2x, 3x and a custom pixel width are available. Custom widths round to whole-pixel multiples of the saved aspect ratio (4px for 4:5; 9px for 9:16), and the actual dimensions are shown. Output is bounded to 20 megapixels and an 8192px edge to limit browser canvas memory; devices may still require a smaller size. Export choices live only in session state and reset when switching projects. They never enter Supabase/local project records, history, template snapshots or crop metadata.

`src/lib/export-settings.ts` resolves frames once at the editor's standard dimensions, then uniformly scales positions, dimensions and corner radii. This preserves embedded whitespace, gutters, moved/overlapping custom frames, tiny-frame minimums, source proportions and exact saved zoom/pan. The original-byte JPEG renderer accepts separate output dimensions; Preview uses that same renderer and its existing 0.94 JPEG quality. Download, sharing, ZIP and Drive export retain the generated bytes. Larger filenames include dimensions; standard filenames are unchanged.

The advisory check evaluates each placement separately using original dimensions and the existing cover/crop function. It compares visible source pixels against visible output pixels after crop and zoom, excluding background exposed by negative zoom. Any enlargement beyond native source detail (allowing floating-point tolerance) is labelled "may look soft", with page/frame/file identity, enlargement and suggested remedies. This is a pixel-density estimate, not an assessment of focus, JPEG artifacts, occlusion by overlapping frames, physical print size or printer colour accuracy. Unknown dimensions are disclosed. Softness never disables export; genuinely incomplete pages or unavailable assigned originals retain their existing export protection.

Preview shows actual output dimensions, Fit page and scrollable 100% detail (one image pixel per CSS pixel). Full-resolution originals remain required, editor guides are excluded, width typing is coalesced, superseded renders are cancelled and object URLs released. Page/size/template identity prevents an older image from appearing with a new label. Preview navigation leaves the active editor page unchanged; export results from a departed project/workspace are discarded.

Safety invariant: **export inspection, sizing and generation must never modify saved photo configurations; unavailable original bytes still never mean deletion**. Original files, existing projects, library entries, assignments, crops and sync/deletion rules are unchanged. The previously documented Islands recovery limitation is unchanged; this feature cannot reconstruct lost assignments or manufacture source detail.

Validation: **311 tests across 25 files pass**, including 24 new cases for both panorama sizes, cropped versus total source pixels, negative-zoom background, repeated placements, missing/unknown originals, exact output ratios, every built-in's scaled geometry, moved/custom/tiny frames, preview/export identity, original-byte drawing, save/restore and real export-handler flow. The normal production build (including TypeScript), standalone typecheck, ESLint and whitespace checks pass. Chrome QA used only generated photos in a local app with all Supabase/Drive configuration blank: warnings remain advisory, 2400x3000 preview and actual downloaded JPEG match, and the two-page ZIP preserves order and dimensions. The 390x844 review fits without horizontal overflow. At 100% the 3240x4050 preview can scroll from its top-left to bottom-right edges; an inherited-centering issue found during QA was corrected. Reload restored both pages and exact crop zoom `0.8765433`; Preview navigation to page 2 left the editor on page 1 with its crop unchanged. Browser error/warning logs were empty. Physical-device gestures, live cloud sync, OS share sheets and Drive export were not exercised. Evidence: `../../outputs/SCURI_EXPORT_QUALITY_PREVIEW_2026-09-18.md`.

## Export quality production release — 2026-09-18

User explicitly authorised deployment after implementation. PR [#21](https://github.com/NewGhee98/scuri/pull/21) merged to `main` as `6b1de7c84adfaa9f635bd568393ac96d12a5df71`. The remote branch head `b421064db0f44e75ba9118558ffdfe949d32d9b1` and merged main both have exact tested Git tree `b4d70fbd7e82495a54b62e1b454a59a831cc4b6d`, matching local tested commit `1b12558`. All ten changed file hashes were verified. The 311-test/typecheck/lint/build and isolated Chrome results above therefore apply to the published implementation.

Vercel Preview [GEmmJvnHAcW96b9qpY6HM656d5qa](https://vercel.com/nugee/scuri/GEmmJvnHAcW96b9qpY6HM656d5qa) was Ready with both GitHub checks successful before merge. Vercel Production [5dQT5ErZH4fiqxAfe7uC8hLBP59i](https://vercel.com/nugee/scuri/5dQT5ErZH4fiqxAfe7uC8hLBP59i) was verified Ready / Latest, source `6b1de7c`, with `scuri.vercel.app` assigned at 17:11 BST. A public HTTP check at 16:11:54 UTC returned 200 and verified all twelve new/prior feature markers in the served JavaScript, including Review export, Photo quality check, 100% detail, Custom width, advisory softness, session previews, guides, add-page protection, zoom, frame movement, duplicate review and snapping.

No migration, live project edit, asset modification, Drive-original change, credential/configuration change or storage rewrite was performed during release. The photo safety invariant and Islands recovery limitation remain unchanged. This post-deployment record is local only; the deployed documentation contains the pre-deployment implementation/validation record. Evidence: `../../outputs/SCURI_EXPORT_QUALITY_PRODUCTION_2026-09-18.md` plus the branch, main and public verification JSON files.

## Project photos rebuild — 2026-09-19 (implemented locally, not deployed)

The user approved the detailed Project photos plan, native Files/Photos and direct Google sources, 30 saved pages, the existing 256 MiB ZIP limit and an iPad Air 11-inch M2 acceptance baseline. This implementation is on local branch `feat/project-photo-library-rebuild`, based on tested `1b12558`; it preserves the preceding export-release documentation. No live account, service, database row, migration, Drive original or production deployment was changed.

**Final safety invariant:** Supabase remains authoritative for library membership, page/frame assignments and crops. Drive stores immutable originals and derived previews. Browser original/preview storage and analysis are caches. An unavailable original, missing thumbnail, failed analysis, expired provider selection or interrupted upload is never deletion intent. Existing identities, duplicate aliases, placements and exact crop values remain intact through browsing, inspection, navigation, retry and reload. Intentional assignment removal/replacement continues to require exact recorded deletion intent and retains the library photo. No SQL migration is needed; optional fields use the existing `projects.photo_library` JSON array.

- **Capacity and placement:** admit 250 visible unique library photos and up to 30 pages. Older over-limit libraries remain visible without truncation. Repeated placements share original bytes and retain independent crops. Export all and selected-page review use assignment metadata, then load full originals on demand. Page duplication no longer requires downloading originals. ZIP backup/restore validates 30 pages and keeps its 256 MiB cap.
- **Browsing:** fullscreen project library/picker, uncropped panorama cards, virtual rows, search, natural filename/import ordering, combined proportion/colour/usage filters, manual Auto/B&W/Colour override, and session-scoped scroll/filter restoration. Portrait is ratio <0.95, square 0.95–1.05, landscape >1.05 and <2.5, panorama >=2.5. Worker analysis uses a 256px uncropped sample and perceptual chroma distribution; ambiguous/unavailable results stay visibly uncertain/awaiting. Usage includes drafts, unavailable originals, aliases and every repeated frame placement.
- **Inspection and intent:** Fit/100%/Original detail, pan/pinch, previous/next and keyboard controls operate only on inspection state. Only explicit Use commits a placement to the captured account/project/page/frame; changed destinations fail closed. Double Use is consumed once, Cancel changes nothing, and same underlying photo selection preserves its crop. Source chooser imports only to its captured project and never silently fills neighbouring frames.
- **Import:** native Photos/Files and supported folders share serial validation, original-byte SHA-256 fingerprinting, exact deduplication, quota handling and per-file progress/retry with direct Drive/Photos adapters. Supported delivered files remain JPEG/PNG/WebP, at most 80 MiB each. The provider can convert media before delivery; Scuri retains delivered bytes unchanged. No thumbnails or temporary download URLs become originals. Legacy photos without verified fingerprints may need the explicit duplicate scan. Reselecting an exact known file can restore its missing local original and retry backup without changing crops or identity.
- **Cache and originals:** account-scoped persistent 640px/inspection previews and versioned analysis live in additive `scuri-photo-cache-v1`; original blob keys/store are untouched. A 320px cached analysis rendition can upgrade to 640px without revoking pinned URLs. Gallery cache targets are 64 MiB compressed and 48 MiB estimated decoded; derived disk budget adapts to quota up to 128 MiB. Quota recovery evicts derived data only; failed durable original writes pause intake. Large source decodes are serialised. No project-wide eager original download remains. The editor uses previews with original dimensions; original detail, page preview and JPEG export explicitly load original bytes. A preview never enters `sourceBlob`.
- **Backup and sync:** metadata writes use their own queue, with parent-only saves only when the checked child rows and deletion intent are unchanged. A separate serial transfer queue reserves each Drive file ID and requires cloud acceptance through the revision gate before transmitting bytes. Its durable journal stores resumable-session state without OAuth tokens. Retries verify the reserved ID, resume acknowledged 1 MiB chunks, handle expired sessions/lost completion responses, and checkpoint each rendition independently. Completed originals are neither reuploaded nor overwritten because a preview failed. New thumbnail renditions are limited to new imports, with no mass rewrite of older Drive files.
- **Compatibility:** optional fingerprint/import-order/classification/thumbnail/pending-upload fields survive validation, sync, recovery and history; restored/conflicted copies clear pending IDs that belong to another project. Old-client omissions can be recovered from a surviving newer client cache, with a refresh notice. This cannot recover metadata already lost from every client/cloud copy. Keep devices updated. The previously documented non-transactional cross-device child-write limitation remains.

**Validation:** 375 tests in 31 files, standalone TypeScript, full ESLint and the production build pass; whitespace checks pass. Tests include existing sync/deletion/panorama/crop/custom-template/export coverage plus 250-photo limits, filters, alias usage, manual override Undo, stale/cancelled/double picker actions, late account/project selection, quota/folder-access failures, interrupted resumable uploads, independent checkpoints, expired/denied Google selections and shared decode-budget recovery. Fixtures and service mocks are synthetic only.

The production build passed isolated desktop Chrome acceptance with all non-localhost origins blocked: 250 unique JPEGs plus an exact duplicate, both panorama types, a 24-megapixel source and EXIF-rotated input; untouched original bytes; correct oriented dimensions; 250-photo gallery/filtering; original detail; portrait/landscape scroll restoration; explicit placement; duplicate pages with independent -20%/-30% zoom; same-photo reselection; selected-page export; and reload persistence. The 2160x2700 downloaded JPEG exactly matched the settings-aware preview bytes and did not change either saved page. No browser runtime errors occurred. Measured on this desktop run: 28.6s import, 13ms filename filtering and 10 mounted cards at the initial sample. These are synthetic desktop measurements, not physical-device performance claims. Reproducer: `scripts/qa-photo-library.mjs`. Evidence: `../../outputs/scuri-library-validation/browser-report.json` and its screenshots/JPEG.

**Release checks still required:** configure and validate the direct Google Picker APIs/origins/consent in a disposable signed-in project, verify live interrupted-backup recovery, and run physical iPad Files/Photos/pinch/background/memory/share acceptance. The user's baseline is iPad Air 11-inch (M2), MUWG3NF/A, reported iPadOS 26.5.2. Local tests do not certify native providers, Google console setup, actual iPad memory limits or background execution. Full checklist: `docs/PROJECT_PHOTOS_RELEASE_CHECKLIST.md`. This turn implemented and verified locally; deployment was not requested.

**Recovery limitation:** new Drive project/page/frame/blob properties are upload-time hints, not a manifest or a reconstruction of historical crops. They do not repair Islands. Later recovery requires separately authorised live connector inspection of surviving Supabase records/backups/history and Drive files, a reviewed frame-to-photo mapping and known crop evidence before any repair. Do not invent lost assignments or infer deletion from missing bytes.

## Project photos iPad Preview — 19 September 2026

The user requested a Vercel Preview for physical iPad testing. Published branch `feat/project-photo-library-rebuild` and opened draft [PR #22](https://github.com/NewGhee98/scuri/pull/22); it remains unmerged. Remote commit `3c1db2f43973735cc0a55f33a44acb99435566a3` and tested local commit `adf9e2816099310e7118305bfc0a5dc90d79f856` have the identical complete tree `e10e06ad8f61b388cc0eaff57c259ab3f85fc2b2`. All 55 changed file blobs match. Publication used exact Git blobs through the signed-in GitHub upload UI because non-interactive Git push credentials were unavailable. The only pre-publication changes after implementation validation were README corrections; application source was unchanged.

- Stable preview: https://scuri-git-feat-project-photo-library-rebuild-nugee.vercel.app
- Immutable deployment: https://scuri-h0qt21i7r-nugee.vercel.app
- Vercel deployment `CmXmGnWQSd2pTRAwrhTMQfYtjWH1` is **Ready**, Preview environment, source `3c1db2f`; build duration 33 seconds.
- Vercel authentication protection is retained. An unauthenticated HTTP check redirects both preview hosts to Vercel. Sign in to the existing Vercel account on iPad, then open the stable preview link.
- Deployed Chrome smoke check: Scuri loaded, new anonymous local project opened the rebuilt library, 250-photo capacity and 30-page limit appeared, source menu exposed Photos/Files/folder/Drive/Photos choices, and no captured warning/error logs appeared. The empty smoke-test project is local to that desktop preview origin. No live cloud projects, originals or migrations were modified.
- Production remains `6b1de7c84adfaa9f635bd568393ac96d12a5df71`, deployment `5dQT5ErZH4fiqxAfe7uC8hLBP59i`, serving https://scuri.vercel.app with HTTP 200. Nothing was merged or promoted.

Preview and Production share the configured Supabase URL/publishable-key variables. Signing in to Scuri can expose the same real projects; use a fresh disposable test project. Direct Drive import's Picker key/app ID are absent from Vercel; Google Photos API/consent and the exact preview OAuth origin remain unverified. Files/Photos are the initial iPad acceptance path. Do not claim live OAuth or physical-device acceptance from this release. Evidence: `../../outputs/library-preview-branch-verification.json`, `../../outputs/library-preview-http-verification.json`, and `../../outputs/SCURI_LIBRARY_PREVIEW_2026-09-19.md`.

## Project photos production — 19 September 2026

After approving the Preview, the user explicitly confirmed merging PR #22 into `main` and deploying to https://scuri.vercel.app. [PR #22](https://github.com/NewGhee98/scuri/pull/22), titled "Rebuild Project photos and resumable backups", merged as `74c2e6eecd1f0dd0e18f063f7f1603ab4855dc95`. Both GitHub checks passed and the merge had no conflicts. The merged complete tree is `e10e06ad8f61b388cc0eaff57c259ab3f85fc2b2`, identical to the approved Preview and tested local commit `adf9e2816099310e7118305bfc0a5dc90d79f856`; all 55 changed blobs match. No application source changed during release, so the preceding 375-test/typecheck/lint/build and isolated Chrome evidence applies unchanged.

Vercel automatically built Production deployment [J6wuWt6WEAhbGCYeazKfE1MtDwAJ](https://vercel.com/nugee/scuri/J6wuWt6WEAhbGCYeazKfE1MtDwAJ) from merged `main`. Verified **Ready / Latest / Production / Current**, source `74c2e6e`, 45-second build completed at 20:29:40 BST, with `scuri.vercel.app` assigned. Immutable deployment URL: https://scuri-6kbmkj5ht-nugee.vercel.app. Public verification at 19:30:10 UTC returned HTTP 200 and checked nine served scripts; all ten new/prior interface markers passed, including Open Project photos, filename search, source chooser, selected-page export, original retention, zoom, frame movement and snapping. This check used no account session or project data.

No migration, Supabase/Drive project edit, original rewrite or Google configuration change was performed. Direct Google Drive/Photos import still requires the separately documented external setup; release does not certify live OAuth, upload-resume or physical-device performance. Files/Photos and the approved library/editor changes are deployed. Refresh existing app tabs to load the new version; do not clear browser storage to refresh. The existing data-preservation invariant and Islands recovery limitation remain unchanged.

Evidence: `../../outputs/library-production-main-verification.json`, `../../outputs/library-production-public-verification.json`, and `../../outputs/SCURI_LIBRARY_PRODUCTION_2026-09-19.md`. This post-release record is local only; deployed documentation retains the implementation and acceptance checklist.

## Photo viewing space — 19 September 2026 (implemented locally, not deployed)

The user approved the follow-up library/viewer design after testing the library release on iPad. Implemented on `feat/photo-viewing-space`, based on production `74c2e6e`. This is an interface change; no schema, sync, import, crop, assignment or export algorithm changed. The earlier Preview/Production release records above are preserved.

- Library has one compact header with context, Filters, a tappable backup count and Done (or Choose a photo / Cancel for a placement). Backup/import failures retain a visible Needs attention indicator. Search, Add photos, View, Actions and removable active-filter chips scroll with the photo grid. View contains remembered sort/thumbnail preferences; Actions contains duplicate review and suggestions. Analysis, import progress and backup recovery controls are in Backups and activity. Photo cards retain uncropped previews with one filename line and a usage badge.
- Inspector replaces all library chrome. Its top bar contains Back to photos, position, Info and explicit Use this photo when choosing a placement; bottom controls contain Previous/Next, Fit/100% and Hide controls. Info holds filename, original dimensions, placement/classification details, original-detail loading and inspection zoom. Tap or H toggles controls; hidden controls persist when browsing. Pinch/drag and Fit-only swipe navigation remain, with visible Retry on unavailable originals. Inspection does not modify a saved crop.
- Virtual gallery measures the scrolling toolbar and saves photo-row anchors independently of its height, preserving filters and the exact scroll position on return, including size/orientation changes and explicit scroll resets. Keyboard focus returns without scrolling. Nested tool dialogs close on Escape without closing the library. Touch targets remain at least 44 CSS px. The permanent footer is removed; the 256 MB ZIP limit is beside backup actions and exact-byte matching details are in duplicate review.

**Validation:** all 380 tests in 32 files, standalone TypeScript, full ESLint, the normal production build (including its TypeScript check) and whitespace checks pass. Five new unit tests cover toolbar-aware virtualisation/scroll anchors and tap/swipe/pan discrimination. Extended `scripts/qa-photo-library.mjs` passes against the final production build in an isolated desktop Chrome profile with all cloud configuration blank and external requests blocked. It imports 250 synthetic unique JPEGs plus a duplicate, preserves original bytes and oriented dimensions, exercises filters/View/Escape focus, verifies exact scroll return, simulates pinch/pan/swipe and hidden-control navigation, checks both iPad viewport orientations and a 390x844 selection viewer, and confirms independent -20%/-30% crops and persistence after reload. Its 2160x2700 JPEG is byte-identical to the original-based export preview; both saved pages remain unchanged. No browser runtime errors or external-origin requests occurred.

The image stage occupies 85.1% of a 1180x820 viewport and 89.7% of an 820x1180 viewport with controls visible; hiding controls uses the full stage. These are browser-layout measurements, not physical iPad certification. Visual review covered the library, landscape photo, panorama and phone selector. Evidence: `../../outputs/scuri-viewing-space-final/browser-report.json`, screenshots and JPEG; overview: `../../outputs/SCURI_PHOTO_VIEWING_SPACE_2026-09-19.md`.

No live accounts, projects, Supabase records or Drive originals were accessed or modified. Physical iPad acceptance and deployment remain separate next steps. The primary safety invariant remains: unavailable local bytes/analysis must never imply cloud deletion; explicit placements and every independent crop remain authoritative. Existing Drive metadata cannot reconstruct historical Islands assignments or crops, and the previously documented recovery limitation is unchanged.

## Photo viewing space production — 19 September 2026

The user explicitly requested deployment after approving the implemented and tested interface. [PR #23](https://github.com/NewGhee98/scuri/pull/23), "Give project photos and the inspector more viewing space", merged into `main` as `00249dff2af3e7b4260d55f63550872fd9078ac0`. Both GitHub checks passed and the Vercel Preview was Ready before merge. Remote branch head `c1420c426c48cb178a2bc90835ffeac7c4281f54` and merged main have the identical complete tree `7554ca27d10434d3c0e01140fd5be74bfd022197`, matching tested local commit `3fd7079f6469811fbc5e1b57c2c409ddee5e78ee`; all 12 changed file hashes match. The preceding 380-test/typecheck/lint/build and isolated browser acceptance results therefore apply unchanged. Publication used exact Git blobs through the signed-in GitHub upload UI because the bundled local Git lacks its HTTPS remote helper.

Vercel Preview [BemQemGPFMuH7xshCEHWoWMZoSgZ](https://vercel.com/nugee/scuri/BemQemGPFMuH7xshCEHWoWMZoSgZ) was Ready. Production deployment [E69b3UQ9SCYMGqAn7HFrGW8WhemL](https://vercel.com/nugee/scuri/E69b3UQ9SCYMGqAn7HFrGW8WhemL) was verified **Ready / Latest / Production / Current**, source `00249df`, with `scuri.vercel.app` assigned. Its 34-second build completed at 22:37:41 BST. Immutable URL: https://scuri-lr1jvws8n-nugee.vercel.app. Public verification at 21:38:08 UTC returned HTTP 200 and checked 11 served JavaScript/CSS assets; all 14 new/prior markers passed, including Back to photos, Hide/Show controls, Backups and activity, Active filters, Photo info, photo search, export, exact zoom, frame movement and snapping. The public check used no account session or project data.

This release deploys only the documented viewing-space changes. No migration, Supabase/Drive data edit, original rewrite, saved-composition change or environment/credential change was performed. Physical iPad acceptance remains a user-device check; synthetic browser results do not certify device gestures or memory behaviour. Refresh the app normally to load this release; no browser-storage clearing is needed. The photo safety invariant and historical Islands recovery limitation remain unchanged.

Evidence: `../../outputs/viewing-release-branch-verification.json`, `../../outputs/viewing-production-main-verification.json`, `../../outputs/viewing-production-public-verification.json`, and `../../outputs/SCURI_PHOTO_VIEWING_PRODUCTION_2026-09-19.md`. This post-release record is local only; deployed documentation contains the implementation and validation record above.

## Add-page template filters — 19 September 2026 (implemented locally, not deployed)

The user requested the existing Templates filters in the Add page chooser. Fresh public GitHub verification confirmed main `00249dff2af3e7b4260d55f63550872fd9078ac0` has complete tree `7554ca27d10434d3c0e01140fd5be74bfd022197`, identical to this checkout's tested `3fd7079` baseline. Work is on `feat/add-page-template-filters`; the preceding library/viewer changes and release records are preserved.

`TemplateFilterControls` now serves both the Templates library and page chooser. It reuses the existing exact photo-count choices, dynamic custom-template counts, Rounded/Straight/Mixed corner choices and `filterTemplates` predicate. The library keeps its All/Post/Square/Story selector. The page chooser displays the project's fixed format and filters only the existing `getTemplatesForFormat` pool: compatible built-ins and saved compatible custom templates, excluding drafts. Count and corner filters combine; Clear filters restores that entire eligible pool without changing the project format. Empty results explain how to change or clear filters, and the result count is announced. Controls wrap and have at least 44×44 CSS-pixel targets. The existing Change layout chooser receives the same controls because it shares this screen.

Filters are session-only interface state, separate from library filters and reset on each new chooser intent. Add retains the existing explicit project-bound Add intent, one-use selection and stale/cancelled/project-switch rejection. Replace retains its pinned page and deliberate confirmation. Removed Add's unnecessary `setActivePageId(null)`: opening, filtering and cancelling now leave even the saved active-page selection unchanged. A visible Cancel uses the existing back-navigation path. Selecting Add always appends a new page, including when sync restores an existing selected page in the background. No schema, storage, photo, template-geometry, crop, export or cloud-sync format changed.

**Validation:** 390 tests across 33 files pass; standalone TypeScript, full ESLint, normal production build and whitespace checks pass. Ten added regressions cover control/choice parity, combined count/corner filters, clear/reset and fixed-format behaviour, eligible custom/draft handling, read-only browsing/cancellation with loaded or unavailable photos, two populated pages, background reconciliation and stale filtered actions. Handler tests execute production selectors and handlers; controls are exercised directly and rendered using React.

Local Chrome QA used the production build at `127.0.0.1:3027` with all cloud configuration blank, an existing generated JPEG fixture and a newly created local custom template. Library and chooser both returned Rounded stories, Night frames and the custom three-photo rounded layout. Mixed produced an explained empty result; Clear restored all 22 eligible layouts. Cancelling preserved two populated pages. Choosing the filtered custom layout added a distinct third page with no confirmation. Reload retained all three pages and both original photos/crops; the first exact slider value remained `0.8765433` (-12.34567%) and the second `0.7` (-30%). DOM checks at 1180×820 and 820×1180 showed no horizontal overflow, and filter targets measured at least 44×44. Captured warning/error logs were empty. This is desktop browser viewport QA, not physical iPad certification.

No live project, Supabase record, Drive file or production deployment was modified. The safety invariant remains: missing bytes never mean deletion; existing assignments and independent crops remain authoritative. Historical Islands recovery limitations are unchanged. Evidence: `../../outputs/SCURI_ADD_PAGE_FILTERS_2026-09-19.md`, `scuri-template-filters-tests.txt` and `scuri-template-filters-build.txt`.

## Add-page template filters production — 20 September 2026

The user explicitly requested deployment of the completed filter changes. [PR #24](https://github.com/NewGhee98/scuri/pull/24), "Reuse template filters in the Add page chooser", merged into `main` as `d5fd67f8151f71d09a8426fa41bcd976fed46c26`. Both GitHub checks passed, the branch had no conflicts, and Vercel Preview [GSavyGM65yioQ5vfTW9UL7GN1qew](https://vercel.com/nugee/scuri/GSavyGM65yioQ5vfTW9UL7GN1qew) was Ready with source `f2f1f67` before merge. Published branch head `f2f1f67b4c5bbe54e6362b3c7c396a2c7fd3e65d` and merged main have the identical complete tree `798917d80b787de122bc00679ef3ecfc53fab36b`, matching tested local commit `3718e7c1835fcbd94c8a9ad9c1dd155d7c8b3eec`; all seven changed file hashes match. Publication used exact Git blobs through the signed-in GitHub upload UI because the bundled Git lacks its HTTPS remote helper. No application source changed during release, so the preceding 390-test/typecheck/lint/build and local Chrome acceptance results apply unchanged.

Vercel Production deployment [fnihuTo51kGw3vsUr4CLHzeyzSid](https://vercel.com/nugee/scuri/fnihuTo51kGw3vsUr4CLHzeyzSid) was verified **Ready / Latest / Production**, source `d5fd67f`, with `scuri.vercel.app` assigned. Its 34-second build completed at 00:06:31 BST on 20 September (23:06:31 UTC on 19 September). Immutable URL: https://scuri-crfc58blv-nugee.vercel.app. Public verification at 23:06:44 UTC returned HTTP 200 and checked 11 served JavaScript/CSS assets; all 20 new/prior markers passed, including fixed project-format text, empty-result guidance, shared filter controls/reset, the improved photo viewer, export, exact zoom, frame movement and snapping. The public check used no account session or project data.

No migration, Supabase/Drive project edit, original rewrite, saved-composition change or environment/credential change was performed. The normal Add page flow retains explicit project-bound intent and stale-action rejection; browsing/filtering/cancelling do not mutate the project, and selecting an Add result appends a distinct page. Existing library/viewer improvements are preserved. Physical iPad acceptance remains a user-device check; the recorded viewport checks were desktop browser tests. Refresh the app normally to load this release; no browser-storage clearing is needed. The photo safety invariant and historical Islands recovery limitation remain unchanged.

Evidence: `../../outputs/template-filters-release-branch-verification.json`, `../../outputs/template-filters-production-main-verification.json`, `../../outputs/template-filters-production-public-verification.json`, and `../../outputs/SCURI_ADD_PAGE_FILTERS_PRODUCTION_2026-09-20.md`. This post-release record is local only; deployed documentation contains the implementation and validation record above.

## Subtle selection shading — 20 September 2026 (implemented locally, not deployed)

Change 2 only, on `feat/subtle-frame-selection`. Read-only GitHub verification confirmed latest main `d5fd67f8151f71d09a8426fa41bcd976fed46c26` has complete tree `798917d80b787de122bc00679ef3ecfc53fab36b`, matching the local `3718e7c` starting point. The preceding Add page filters, photo viewing space, project library and release records are preserved. The user explicitly requested no deployment.

The photo editor and template builder share a light 12% blue tint, `rgba(64, 139, 205, 0.12)`, replacing their dashed/solid black selection outlines. The canvas clips the tint inside the selected frame; the template builder applies a pointer-transparent overlay to every selected frame, including multiple selections. It inherits rounded corners and adds no selection border. Existing resize handles, composition guides, snap guides and layer controls remain. Guides render above the tint. Keyboard focus remains distinct: a blue focus ring outside the whole photo canvas, and native focus on the builder's keyboard-operable layer controls. Template Preview omits selection tint, handles and snap guides.

**Selection safety invariant:** selecting a photo/frame is session-only editing UI. It must not change original bytes, crop metadata, frame geometry, stored page selection, edit timestamps, undo history or composition autosave inputs. The editor now tracks its active selection separately from page data; legacy saved selection fields remain readable as the initial fallback. Replace/reset/remove/zoom/frame-layer actions use the current UI selection. Stationary pointer events do not trigger crop edits, frame snapping or pinch updates; stationary template selection does not replace its draft. Clean previews, template/page thumbnails and JPEG export never use selection shading. Their shared rendering/crop geometry and persistence formats are unchanged.

**Validation:** 402 tests across 34 files pass, including new loaded/unavailable-photo selection safety, mouse/touch no-movement events in all editor modes, multi-selection tint, preserved handles and clean preview/thumbnail/export coverage. Standalone typecheck, full ESLint, the normal production build and whitespace checks pass. No new dependencies or migrations.

Local Chrome QA used only a generated synthetic backup on a fresh `127.0.0.1:3028` origin with all cloud configuration blank. Visual review covered light/dark photos and backgrounds, 5/7 panorama stacks, -28% zoom, small/rounded frames, multi-selection and clean previews at 1180×820 and 820×1180 browser viewports. Selecting did not enable Undo; exact zoom targeted the newly selected photo. Keyboard focus/guides remained usable. Every existing 18px resize handle passed hit testing, retained `touch-action: none`, and a real pointer resize followed by Undo restored exact frame geometry. Final-build reload retained the -28% crop; Move frames selection remained an unedited state and keyboard movement remained undoable. No captured warning/error logs. Temporary tabs/server were closed and viewport sizing reset.

Physical iPad Air 11-inch M2 touch targeting, pinch/drag, Pencil and performance remain untested; browser viewport and synthetic touch-event checks do not certify hardware behaviour. The existing handle sizes are unchanged. No live project, Supabase record, Drive file or deployment was modified. Missing local bytes still never imply deletion, and the historical Islands recovery limitation is unchanged. Evidence: `../../outputs/SCURI_SELECTION_SHADING_2026-09-20.md`, `scuri-selection-tests.txt` and `scuri-selection-build.txt`.

## Subtle selection shading production — 20 September 2026

After approving the implemented Change 2, the user explicitly requested deployment. [PR #25](https://github.com/NewGhee98/scuri/pull/25), "Use subtle shading for frame and photo selection", merged into `main` as `94da43da307e8cc8bd5ef463083bd2ba7bdf24bc`. Both GitHub checks passed and there were no merge conflicts. Published head `563ae00cd3085efa34875cb6031ba2f3de3247f6`, merged main and tested local commit `4c715870cec91c7f266aff1694201e483f6ef2af` have the identical complete tree `1a6991146130c400231e47be7b6b16fb09d3df6c`; all ten changed file hashes match. The application source is unchanged from the 402-test/typecheck/lint/build and local visual/persistence checks above. Publication used exact Git blobs through the signed-in GitHub upload UI.

Vercel Preview [Euboyp6cijXKV6pKKMEr55znqhWL](https://vercel.com/nugee/scuri/Euboyp6cijXKV6pKKMEr55znqhWL) was Ready before merge, source `563ae00`, with a 26-second build. Production deployment [5oEJY8JLiFCPejSZY54sk37iWCYK](https://vercel.com/nugee/scuri/5oEJY8JLiFCPejSZY54sk37iWCYK) was verified **Ready / Latest / Production / Current**, source `94da43d`, with `scuri.vercel.app` assigned. Its 33-second build completed at 00:53:12 BST on 20 September (23:53:12 UTC on 19 September). Immutable deployment: https://scuri-abofnkiiw-nugee.vercel.app. Public verification at 23:53:40 UTC returned HTTP 200 and checked 11 JavaScript/CSS assets; all 24 checks passed, including the shared tint, pointer-transparent shading class, separate keyboard-focus style, removal of the old template-selection outline and retained filter/library/editor markers.

No migration, Supabase/Drive project edit, original rewrite, environment/credential change or saved-composition transformation occurred. Selection remains editing UI only and cannot alter composition autosave inputs; clean previews/thumbnails/exports remain unshaded. Physical iPad gestures and performance remain unverified by this release. Refresh the app normally to load the update; no storage clearing is needed. The photo safety invariant and historical Islands recovery limitation are unchanged.

Evidence: `../../outputs/selection-release-branch-verification.json`, `../../outputs/selection-production-main-verification.json`, `../../outputs/selection-production-public-verification.json`, and `../../outputs/SCURI_SELECTION_PRODUCTION_2026-09-20.md`. This post-release record is local only; deployed documentation contains the implementation and validation record above.

## Canvas viewport navigation — 20 September 2026 (implemented locally, not deployed)

Change 3 only, on `feat/canvas-viewport`. Before editing, read-only GitHub verification confirmed `main` remains `94da43da307e8cc8bd5ef463083bd2ba7bdf24bc`, with complete tree `1a6991146130c400231e47be7b6b16fb09d3df6c`, matching the local Change 2 baseline. The prior selection shading, Add page safety/filter parity, project library and release records are preserved. The implementation stage was local only. The user subsequently authorized deployment on 20 September; release verification is recorded separately after publication.

The page editor, template designer and export preview share `CanvasViewport` and screen-only geometry in `src/lib/canvas-viewport.ts`. All offer zoom out/in, a typed percentage, Fit and 100%. Default Fit includes space around every edge; view scale is bounded at 400%, with a 10% minimum (or the Fit scale when smaller). Button/numeric zoom keeps the inspected centre stable; pinch zoom follows its centroid, subject to bounds that keep the entire design reachable. Fit resets pan and follows container resizing; a manually magnified view retains its inspected centre on resize. Opening another page/view starts at Fit. Returning between Edit and Navigate preserves the current scale and pan.

**Gesture contract:**

- Page editor and template designer start in **Edit**. Existing photo drag/pinch crop editing, rearranging/swapping, frame movement and template handle resizing keep their existing roles. A template drag belongs to its first pointer; a second pointer cannot start another frame edit.
- **Navigate** captures canvas gestures before editing handlers: one pointer drags the view; two pointers pinch and pan the view. It cannot crop, select, swap, move or resize a photo/frame. Normal wheel/trackpad scrolling pans; Ctrl/Command-wheel magnifies around the pointer. Navigation works from the page background as well as the design.
- A focused navigation viewport supports arrow-key panning (Shift for larger steps), +/- zoom and 0 for Fit. Escape cancels an active navigation gesture; idle Escape preserves the export dialog's normal close action. Buttons and numeric zoom remain keyboard accessible and have distinct focus styling.
- Mode/view changes, pointer cancellation, lost capture and window blur clear active input. Cancelled swaps and empty-frame taps never complete. Already applied photo/frame edits retain their existing Undo path; cancelling an unfinished template move/resize restores its starting draft without adding an Undo entry. A new gesture starts from the current view without a jump.
- Export preview always navigates the canvas. Previous/Next controls change pages; canvas swipes now pan instead of advancing the page, removing the swipe/pan ambiguity.

**Composition safety invariant:** viewport scale/pan/mode are transient component state, excluded from saved projects/templates, crop metadata, composition timestamps, cloud sync and Undo. Pointer coordinates use transformed canvas bounds, and snap tolerances stay approximately five screen pixels. Template resize handles keep an 18px visible circle within a 40px touch target regardless of view magnification. Existing subtle selection shading, composition/snap guides, negative photo zoom and clean preview behaviour remain. No schema/migration, original-byte rewrite or stored-composition transformation is involved.

The editor still draws lightweight cached preview URLs, using a bounded reference-size canvas and capped device-pixel ratio; viewport magnification never requests project originals or increases the backing canvas with zoom. Template rendering keeps normalized frame geometry. Export preview still hydrates only its requested page and renders through the original-byte JPEG path at the chosen output size. Its 100% view maps one output pixel to one CSS pixel, matching the prior detail-view convention. View navigation reuses the same rendered JPEG URL; only page/output-setting changes create a new render. Export dimensions, borders, gutters and crop geometry never derive from viewport state.

**Validation:** 419 tests across 35 files pass, covering anchored zoom, pan bounds, Fit/resize, pinch-to-pan transitions, cancellation/stale pointers, gesture ownership, actual crop/frame edit callbacks at 25%/100%/300%, template cancellation, modal Escape, and identical original-quality render geometry after view changes. Standalone typecheck, full ESLint, the normal production build and whitespace checks all pass. No new dependencies or migrations.

Local Chrome QA used the synthetic selection/panorama backup on blank-cloud `127.0.0.1:3029`, without real project data. Observed: editor navigation at 150% left crop zoom and Undo unchanged; mode switching retained the exact transform; keyboard panning reached canvas edges; template navigation at 200% preserved every frame style and left Undo disabled; handles measured 40px at both Fit and 200%; actual pointer resize at reduced scale followed by Undo restored the exact template geometry; clean template Preview omitted all selection shades/handles. Export 100% measured exactly 1080×1350 and 2160×2700 CSS pixels matching the JPEG's natural dimensions; 250% zoom/pan reused the same JPEG URL. After the final build/reload, Fit kept the complete dark-background composition on screen; its saved -28% photo zoom survived 200% canvas magnification with Undo disabled. Escape closed export preview and returned to the same 200% editor view. No captured browser warning/error logs. Temporary test tabs/server were closed and the ineffective viewport override reset.

**Testing limitation:** these are desktop Chrome checks (observed CSS viewport 1806×979), plus automated pointer/geometry tests. The browser viewport-override request did not change the actual viewport, so do not count it as iPad-size or physical-device coverage. Physical iPad Air 11-inch M2 Safari two-finger gestures, Pencil, orientation, touch targeting and performance remain a device acceptance check. No live project, Supabase record, Drive file or deployment was changed. Missing local bytes still never imply deletion; the historical Islands recovery limitation remains unchanged.

Evidence: `../../outputs/scuri-viewport-tests.txt`, `scuri-viewport-lint.txt`, `scuri-viewport-build.txt` and `SCURI_CANVAS_VIEWPORT_2026-09-20.md`.

## Canvas viewport production — 20 September 2026

Following the user's explicit deployment request, [PR #26](https://github.com/NewGhee98/scuri/pull/26), "Add canvas zoom and pan to editing and export preview", merged into `main` as `24728972add9a1286b77e3fede204578880acc8d`. Both GitHub checks passed and there were no merge conflicts. Published head `bc8b3881a5ba65c3074472c0723009f2fe47a5db`, merged main and tested local commit `a830c47802f1957fbdd1c2d90f32390e06262986` share the identical complete tree `fe8ba6ad9dd1780995b77302d22373d0d80bc38f`; all 11 changed file hashes match. Exact committed blobs were published through the signed-in GitHub upload UI. Application code is unchanged from the 419-test/typecheck/lint/build and desktop QA verification above.

Vercel Preview [Em1Wj65euFPdahae4dRk7jmVPmUJ](https://vercel.com/nugee/scuri/Em1Wj65euFPdahae4dRk7jmVPmUJ) was Ready before merge, source `bc8b388`, duration 33 seconds. Production [C6hLxK3tF8XfgNDaA4jFzJoeNQ3M](https://vercel.com/nugee/scuri/C6hLxK3tF8XfgNDaA4jFzJoeNQ3M) was verified **Ready / Latest / Production / Current**, source `2472897`, with `scuri.vercel.app` assigned. The 48-second build completed at 07:47:53 BST (06:47:53 UTC). Immutable deployment: https://scuri-ahjo01hcb-nugee.vercel.app. Public verification at 06:48:24 UTC returned HTTP 200, checked 11 JavaScript/CSS assets and passed all 36 new/retained feature checks, including the canvas controls, viewport styles, selection shading, Add page filters and spacious library.

Viewport navigation remains independent of saved compositions, photo crops, Undo and export dimensions. No migration, Supabase/Drive project edit, original rewrite, environment/credential change or saved-data transformation occurred. Physical iPad Safari pinch, Pencil, orientation, touch targeting and performance remain untested; the desktop checks above do not certify hardware behaviour. Refresh the app normally to load the release; do not clear browser storage. Missing local bytes still never imply deletion, and the historical Islands recovery limitation is unchanged.

Evidence: `../../outputs/viewport-release-branch-verification.json`, `../../outputs/viewport-production-main-verification.json`, `../../outputs/viewport-production-public-verification.json`, and `../../outputs/SCURI_CANVAS_VIEWPORT_PRODUCTION_2026-09-20.md`. This post-release record is local only; deployed documentation contains the implementation and validation record above.

## Free photo positioning — 20 September 2026 (implemented locally, not deployed)

Change 4 only, on `feat/free-photo-positioning`. Read-only GitHub verification at 06:52 UTC confirmed main `24728972add9a1286b77e3fede204578880acc8d` has complete tree `fe8ba6ad9dd1780995b77302d22373d0d80bc38f`, identical to the local Change 3 baseline `a830c47802f1957fbdd1c2d90f32390e06262986`. Prior viewport navigation, selection shading, template filters, library and release records are preserved. The implementation stage was local only. The user subsequently authorized deployment on 20 September; release verification is recorded separately after publication.

Photos can now move horizontally and vertically at positive, zero and negative photo zoom, including exact-fit images and axes with no overflow. The frame stays fixed and clips the image. Exposed space uses the page background, painted inside that frame's clip so a lower overlapping photograph cannot show through. The same `coverPlacement` / `drawCroppedPhoto` path serves editor, thumbnails, original-quality export preview and JPEG export, including proportional larger outputs. Normal editing still uses lightweight previews; moving or magnifying the viewport does not request originals.

**Compatibility and persistence:** `CropState` adds optional `freePosition: { x, y }`, the image-centre offset in frame widths/heights. Existing crops without this field retain their exact historical overflow-relative rendering, including centred legacy negative zoom. Reading, selecting, hydrating and exporting do not convert them. An explicit move or zoom edit converts the currently rendered centre to the new representation without a jump; subsequent zoom preserves that offset. The legacy `positionX`/`positionY` fields are not reinterpreted. The existing `project_assets.crop` JSONB field, local serialization and portable backup already preserve this optional metadata; no SQL/schema migration, original-file rewrite or bulk conversion is required. Every placement retains its own crop, even when several frames share one original. Older app versions do not render `freePosition`; all editing clients should load the eventual release before editing these new crops.

**Interaction rules:** photo dragging in Edit mode uses accumulated unsnapped input, preventing lost rapid pointer deltas between React renders and allowing the user to drag through centre snapping. Each axis gently snaps within approximately five screen pixels, respecting the existing Snap toggle and Alt bypass. Keyboard arrow nudges remain exact. Visible-edge zoom snapping accounts for the shifted photo centre. Centre photo clears the offset while preserving the exact zoom; Reset retains its separate historical centre-and-0% behaviour. Both have distinct Undo groups from preceding positioning. Photos may be moved completely outside their frame; Centre photo restores them. Canvas Navigate, Move frames and Rearrange retain their separate gesture ownership. A second photo-pinch finger may land on page background, and lifting one finger resumes dragging from the remaining finger without a jump. Cancellation, mode changes and lost capture clear gesture state.

**Photo safety invariant:** a missing original never removes a placement or its metadata. Editing an available cached preview updates that placement's crop in the unavailable-photo metadata; late original hydration merges the current edited crop. Selection alone and stationary pointer events do not add a positioning field, composition edit or Undo/autosave change. No Supabase/Drive record, existing asset or original was modified. Historical Islands recovery limitations remain unchanged.

**Validation:** all 442 tests across 36 files pass, along with standalone typecheck, full ESLint, the normal production build and whitespace checks. Coverage includes both axes and all zoom ranges, exact-fit/smaller images, untouched legacy geometry, conversion without jumps, centre snapping/drag-through/toggle, Centre versus Reset and Undo, repeated placements, preview edits followed by hydration, local/cloud JSON and portable-backup round trips, cancellation, editing at 25%/100%/300% viewport scales, and matching editor/thumbnail/export geometry/background masking at 1×/2×/3× output. Cloud tests use synthetic rows and a fake transport; no live cloud data is involved.

Local desktop Chrome QA ran the production build at blank-cloud `127.0.0.1:3030` with a generated two-page backup. Actual pointer checks covered exact-fit 0%, -40% and +50% movement, crossing centre snapping, cream/dark backgrounds, overlapping frames, panorama and small repeated placements. Centre retained -40%; Reset returned 0%; separate Undo restored each prior state. A preview edit survived original hydration, save/reload and the project thumbnail. Original-quality previews at 1080×1350 and 2160×2700 retained the same offset and clean background masking; the larger JPEG's natural dimensions were verified in the DOM. Editing continued to show zero loaded originals until preview requested them. Captured warning/error logs were empty. Temporary QA tab/server were closed.

**Testing limitation:** desktop Chrome and automated pointer/geometry checks do not certify physical iPad Air 11-inch M2 Safari pinch, Pencil, touch targeting, orientation or performance. No physical-device test or live cloud round trip was performed during implementation. Evidence: `../../outputs/SCURI_FREE_POSITIONING_2026-09-20.md` and `scuri-free-position-{tests,typecheck,lint,build}.txt`.

## Free photo positioning production — 20 September 2026

Following the user's explicit deployment request, [PR #27](https://github.com/NewGhee98/scuri/pull/27), "Allow free photo positioning at every zoom level", merged into `main` as `1e0ecab5f28cbdf962b62860b512a0d66802eb5e`. Both GitHub checks passed and there were no merge conflicts. Published head `2a616a9d13de01e0d103874c80d8f52a95814fc7`, merged main and tested local commit `3fbbeb4b2eb2ccf4d8c8592ce648a3b557556e7c` share the identical complete tree `a210c547def1d96fe614c0a985ae6757d5fb5862`; all 19 changed file hashes match. Exact committed blobs were published through the signed-in GitHub upload UI. No application code changed after the 442-test/typecheck/lint/build and desktop QA verification above.

Vercel Preview [GzFkAQHdms8oPndbu8EJUCm7jJBE](https://vercel.com/nugee/scuri/GzFkAQHdms8oPndbu8EJUCm7jJBE) was verified **Ready / Latest / Preview** before merge, source `2a616a9`, with a 40-second build ending at 08:28:11 BST. Production [3ETb3MwHk7LABnr6y6wy9E3uYs49](https://vercel.com/nugee/scuri/3ETb3MwHk7LABnr6y6wy9E3uYs49) was verified **Ready / Latest / Production / Current**, source `1e0ecab`, with `scuri.vercel.app` assigned. Its 50-second build completed at 08:30:26 BST (07:30:26 UTC). Immutable deployment: https://scuri-r4rna6xwu-nugee.vercel.app. Public verification at 07:31:11 UTC returned HTTP 200, checked 11 JavaScript/CSS assets and passed all 41 new/retained feature markers, including free positioning, Centre photo, centre snapping, viewport navigation, selection shading, template filters and the spacious library. These public checks used no account session or project data. An intermediate component-only upload (`ed49904`) produced a failed Preview before its crop-library dependencies were uploaded; it was superseded by the successful final Preview and production builds.

No migration, Supabase/Drive project edit, original rewrite, environment/credential change or bulk saved-data transformation occurred. Untouched legacy crops retain their original rendering; new optional offsets preserve deliberate positioning through zoom, hydration and proportional exports. Refresh Scuri normally on every editing device before using these crops: older app clients do not understand the optional positioning field. Do not clear browser storage. Physical iPad Safari gestures and touch performance remain untested; the desktop and automated checks above do not certify hardware behaviour. Missing local bytes still never imply deletion, and the historical Islands recovery limitation is unchanged.

Evidence: `../../outputs/free-position-release-baseline.json`, `free-position-release-branch-verification.json`, `free-position-production-main-verification.json`, `free-position-production-public-verification.json`, and `SCURI_FREE_POSITIONING_PRODUCTION_2026-09-20.md`. This post-release record is local only; deployed documentation contains the implementation and validation record above.

## Template design tools — Change 5 (local implementation, not deployed)

The user approved the critical plan review and implementation of coordinated template sizing and persistent rows/stacks. Work is on `feat/template-arrangement-tools`, based on local `3fbbeb4`, whose application tree matches production main `1e0ecab`. GitHub main was rechecked read-only during implementation and remained `1e0ecab`. All preceding stages and the local production record above are preserved. The implementation stage was local only. The user subsequently authorized production deployment on 20 September; release verification is recorded separately after publication.

**Selection and sizing:** Select multiple makes canvas and Layers taps consistently toggle membership without moving frames, adding Undo entries or changing draft timestamps. Done selecting restores dragging. The selected count is visible; the most recently selected frame is the default matching reference, with an explicit Reference frame selector independent of layer order. Multiple selections share four corner handles; individual selected frames retain the subtle tint. Handles remain 18px visually within 40px touch targets at every viewport scale and can receive keyboard focus (arrows resize; Shift uses ten reference pixels). Existing Edit/Navigate ownership, screen-space snapping and cancellation are retained. A continuous gesture creates one Undo entry; cancellation restores its original geometry and metadata.

Width/height controls use exact reference-canvas pixels, show Mixed for differing sizes and commit on Enter/blur; Escape cancels pending input. Unfocused rounded displays do not rewrite fractional geometry. Same width/height use the chosen reference, adjusting the other dimension for each locked frame. Square, 2:1, 3:2, 4:3, 16:9, 40:9 and 768:115 presets, custom positive width:height and orientation flip operate on actual pixel proportions, not normalized width/height alone. Presets/flip lock the ratio; explicit unlock allows independent dimensions. Choosing a proportion retains width and centre where possible, moving or uniformly limiting the result when bounds require it. The former single-frame boundary clamp could break a lock; it now limits one common scale factor instead.

**Arrangements and spacing:** Horizontal row / Vertical stack explicitly relate only their selected members. Their order follows spatial order, with perpendicular centring; frame/layer IDs and layer order are retained. Keep gaps consistent defaults on. Each saved arrangement has one direction and a fixed nonnegative gap; no nesting or multiple-group membership. Resizing a member repositions its related members around the arrangement centre. Shared complete-arrangement handles retain fixed gaps and the opposite corner (or the centre when enabled). Freeform multi-resizing scales both frames and intervening space uniformly. A partial arrangement cannot be moved independently or silently regrouped: Select arrangement moves it together; Release arrangement retains geometry and allows freeform movement. Disabling Keep gaps releases the relationship; arranging with it off is a one-shot action. Whole-arrangement duplication creates fresh group/frame IDs; a partial duplicate is independent. Deleting a member closes only its group's gaps; a sole survivor is released.

Minimum margins are separate from gaps and apply to the selected frames/arrangement. They support zero and linked/unlinked sides. They define clearances, not four mandatory exact visible borders; Centre group centres inside that available area. For five 1016px-wide 40:9 frames on 1080×1350, 32px side margins and gaps correctly leave 39.5px top/bottom whitespace. Seven 768:115 strips leave approximately 46.5260417px. A new arrangement or gap that cannot fit is rejected without resizing other frames or changing the requested gap. Numeric resizing stops at a common valid maximum, reports the limit and preserves locks/equal dimensions; unlocked orthogonal dimensions remain unchanged. Frames edited with these tools have a 6-reference-pixel minimum on each axis, so the existing 180px template thumbnail's one-pixel floor does not distort very small new frames. Untouched older geometry is not converted. Equalise spacing preserves the end anchors; negative-gap conflicts are explained. Existing edge/centre snapping is supplemented by gentle matching of adjacent visible edge gaps, with screen-scale tolerance and the same Snap toggle. All measurements/guides are editing-only.

**Persistence and compatibility:** Optional `NormalizedFrame.aspectRatio`, `layoutMargins` and `arrangement` editing metadata travels in the existing `templates.frames` JSONB array and local template cache. Common arrangement settings are written to all members in the same template save. Local and fake-cloud transport tests exercise the actual save/load functions; no schema change or migration is required. Copies materialize the original resolved bounds with zero additional default gutter and remap arrangement identities. Stored rectangles remain authoritative: reading, rendering or exporting never runs the arrangement logic. Project pages retain their independent template snapshots, photo assignments, crops and original references when a reusable template is edited or saved. Existing built-ins and old custom templates keep their appearance. Ratio exactness describes the saved visible geometry/default zero additional inset; a later deliberate page Border/gutter edit retains its existing behaviour and can change the visible proportion. No panorama-specific renderer, image treatment or export reflow is introduced.

Selection, reference choice and viewport settings are transient. Geometry, locks, margins and membership are included in template Undo and save/restore. Clean preview, template/page thumbnails and JPEG export do not include tint, handles or measurement UI. The source-of-truth and photo safety invariant remain unchanged: unavailable bytes never mean a deleted placement; Supabase stores structure/metadata and Drive stores image bytes. No live project/asset/Drive file was accessed or modified, and this work does not repair historical Islands mappings.

**Validation:** all 506 tests across 38 files pass, including actual template-designer callbacks with queued React state updates; multi-selection without edits; ratio locks and matching dimensions; arranged/freeform shared resizing at 25%/100%/300%; cancellation; fixed/zero gaps; linked/asymmetric margins; bounds; group lifecycle; every existing built-in's copied geometry; exact thumbnail/editor/export proportions at larger sizes; actual local/cloud JSON round-trips using a fake cloud transport; and existing populated page snapshots with repeated originals and independent crops surviving reusable-template edits. Standalone typecheck, full ESLint, the production build and whitespace checks pass. No dependency or schema changes.

Local Chrome QA used only synthetic template copies on blank-cloud `127.0.0.1:3031`, with actual CSS viewports of 1180×820 and 820×1180. Observed: multi-tap selection leaves Undo disabled; exact five/seven-strip stacks; 32px and zero gaps; linked margins; bounds notices; real shared-handle drag with one Undo; 40px handle hit areas and 44px numeric/select controls; clean preview without shading/handles/measurements; local save/reopen retaining arrangement metadata; and 300% navigation without geometry edits. Browser QA exposed a deferred-state Undo bug where an updater read the draft ref after replacement. Commit/Undo/Redo now capture stable snapshots first, and the queued-update regression host reproduces the old failure. Final-build checks confirmed one Undo/Redo restores keyboard resizing, and one Undo restores typed widths and zero-gap edits. No captured browser warnings/errors. Temporary tabs/server were closed and viewport overrides reset.

Physical iPad Air 11-inch M2 Safari touch, Pencil, pinch, virtual keyboard and performance remain untested. Desktop viewport/hit-target checks and synthetic pointer callbacks do not certify physical-device behaviour. Live cloud synchronization was not exercised; persistence coverage uses the existing transport with a fake client. No live project, asset, original, migration or deployment was changed. Evidence: `../../outputs/SCURI_TEMPLATE_DESIGN_2026-09-20.md`, `scuri-template-layout-tests.txt`, `scuri-template-layout-typecheck.txt`, `scuri-template-layout-lint.txt` and `scuri-template-layout-build.txt`.

## Template design tools production — 20 September 2026

Following the user's explicit deployment request, [PR #28](https://github.com/NewGhee98/scuri/pull/28), "Add coordinated template resizing, proportions and spacing", merged into `main` as `8398085f8ab3221027faa6e669084c3d159633c4`. Both GitHub checks passed and there were no merge conflicts. Published head `bde014467452c48ba93ab0b78badce56bb4ed6d2`, merged main and tested local commit `36b5c18997e77b12183319ae5b6d2ea298b30317` share the identical complete tree `07ccbe64d38046dde47f74e5417e35f3d9371d62`; all 12 changed file hashes match. Exact committed blobs were published through the signed-in GitHub upload UI in dependency-first batches, with every Preview reaching Ready. No application code changed after the 506-test/typecheck/lint/build and desktop QA verification above.

Vercel Preview [99o3RB656eWVquTfgqkjpyK2Z81q](https://vercel.com/nugee/scuri/99o3RB656eWVquTfgqkjpyK2Z81q) was verified **Ready / Latest / Preview** before merge, source `bde0144`, with a 34-second build ending at 11:34:32 BST. Production [4pCqfGKNsb3j9M5mV6ViNn6rcETS](https://vercel.com/nugee/scuri/4pCqfGKNsb3j9M5mV6ViNn6rcETS) was verified **Ready / Latest / Production / Current**, source `8398085`, with `scuri.vercel.app` assigned. Its 47-second build completed at 11:37:03 BST (10:37:03 UTC). Immutable deployment: https://scuri-mwkme35bl-nugee.vercel.app. Public verification at 10:39:06 UTC returned HTTP 200, checked 11 JavaScript/CSS assets and passed all 55 new/retained feature checks, including coordinated sizing/arrangement controls and preceding positioning, viewport, selection, filter and library features. These checks used no account session or project data.

No migration, live data repair, Supabase/Drive asset operation, original rewrite or environment/credential change occurred. Saved frame rectangles remain authoritative; optional editing metadata uses the existing JSON representation. Existing project-page snapshots, assignments and crops are not rewritten when a reusable template is edited. Missing local bytes still never imply deletion, and historical Islands recovery limitations remain unchanged. Refresh Scuri normally on editing devices to load the new controls; do not clear browser storage. Physical iPad Air 11-inch M2 Safari touch, Pencil, pinch, virtual keyboard and performance remain untested, as does live cloud synchronization; desktop and fake-transport checks do not certify those paths.

Evidence: `../../outputs/template-tools-release-baseline.json`, `template-tools-release-branch-verification.json`, `template-tools-production-main-verification.json`, `template-tools-production-public-verification.json`, and `SCURI_TEMPLATE_TOOLS_PRODUCTION_2026-09-20.md`. This post-release record is local only; deployed documentation contains the implementation and validation record above.

## Project photos scrolling and documentation — 20 September 2026 (tested, awaiting release)

The user reported the gallery moving briefly and then stuttering/stopping while scrolling, and requested reconciliation of the GitHub/Drive documentation. Work is on `fix/project-photos-scroll`, based on local `36b5c18`; fresh public GitHub verification confirmed main `8398085` has the identical complete tree `07ccbe64d38046dde47f74e5417e35f3d9371d62`. The preceding template-tools production record and all previous changes are retained. No new production deployment was requested for this task.

**Cause and correction:** `PhotoLibraryGallery`'s layout effect depended on every reported `view.scrollTop` and wrote the remembered offset back to the scrolling element after every native event. Same-value writes can cancel touch momentum, and delayed React commits can rewind a browser that has already advanced. Height-only ResizeObserver updates also triggered unnecessary restoration. The component now distinguishes native observations by identity (weak references, including delayed echoes) from explicit view/reset commands. Native scroll reports still update virtualization and the session-only remembered view, but never write scrollTop back. Initial visible-dialog restoration, explicit filter/scroll resets and actual row/toolbar reflow retain anchored restoration; height-only or width changes without repacking leave native scrolling alone. Restoration also skips already-matching offsets. Preview hydration does not request scroll restoration.

**Validation:** all 512 tests across 39 files, standalone typecheck, full ESLint and the production build pass. Six new tests exercise the real component/effects: native/fractional scrolling with no setter calls, delayed updates while the compositor advances, preview/height-only changes, explicit reset with unchanged filters, toolbar/column/thumbnail reflow, hidden-dialog restoration and focus without scrolling. The native, delayed and height-only regressions fail against the old implementation. No crop, geometry, original-loading, sync, persistence or migration code changed.

Desktop Chrome QA used a blank-cloud production build at `127.0.0.1:3032` and a generated backup with 120 synthetic originals and two populated pages. Repeated browser scrolling advanced through the virtual gallery (observed offsets approximately 2274 and 5554 CSS px with 24 cards mounted), including arriving previews. Returning from photo inspection restored the photo region and focused card. Panorama filtering showed 60/120 and reset to zero; clearing filters restored the full library. Both 1180×820 and 820×1180 CSS viewports were exercised. Composition Undo stayed disabled and loaded-original count stayed zero; captured warning/error logs were empty. Temporary QA tab/server were closed and the viewport override reset. This is not physical iPad Safari momentum/Pencil/pinch validation or a live cloud round trip; those remain acceptance checks.

**Documentation reconciliation:** README, this handoff, VERIFICATION and the photo-library acceptance checklist now describe current features/status. Historical sync/client/zoom/checkpoint notes are explicitly labelled; migration-review and Islands-recovery notes distinguish the user's reported schema confirmation from independent verification and retain the no-repair/no-repeat-migration boundary. The stale missing `CLAUDE_START_HERE.md` reference was replaced with the current handoff/checklist. All four documents in the signed-in Drive `App Projects / scuri` folder were read, updated and exported for read-back: Product Overview, Status & Roadmap, Upcoming Features and Change Timeline. Current-state documents no longer describe project metadata as device-only or positioning/backups as unbuilt. Every original timeline text line survives, with older handoff headings dated as historical; the September release history and pending scrolling fix are added. They clearly distinguish deployed PR #28 from this fix awaiting release. All four read-backs contain main `8398085` and current 512-test verification. Before/after evidence is in `../../outputs/scuri-docs-2026-09-20/`.

No live project/asset/original, Supabase record, migration or credential was modified. Drive writes were restricted to the four requested documentation files, retaining their private sharing. Supabase remains authoritative for metadata and assignments; Drive stores image bytes; missing bytes never imply deletion. This work does not recover historical Islands mappings. Evidence: `../../outputs/SCURI_SCROLL_AND_DOCUMENTATION_2026-09-20.md` and `scuri-scroll-{before-tests,tests,typecheck,lint,build}.txt`.

## Guidance for future coding agents / chats

Earlier deployment/version statements are historical; the latest production release is recorded in Template design tools production above. The scrolling correction is separately tested and awaiting release; do not describe it as live until deployment is verified. Recheck live state before further changes.

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
