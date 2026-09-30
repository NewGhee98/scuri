# Scuri client safety, backups and undo

Historical 13 September 110-test package, including original review-package instructions. Current behaviour and production status are in [START_HERE](START_HERE.md) and [PROJECT_CONTEXT](PROJECT_CONTEXT.md); current check evidence is in [VERIFICATION](VERIFICATION.md). Later library work supersedes the original backup/resume limitations below. Do not apply the old patch or rerun SQL from this historical note. Original external packages are covered by the [evidence index](docs/evidence/README.md#legacy-local-artifacts).

Prepared locally on 13 September 2026 after approval of the audit's recommended first stage. No live services, real credentials, browser sessions or deployment were used. This package includes the earlier photo-sync fix. The three existing SQL migrations and dependency manifest/lockfile are unchanged.

## Review package

`scuri-client-safety-backups.zip` contains the complete updated source under `scuri-main/`. The companion `scuri-client-safety-backups.patch` is incremental: apply it from the root of a clean copy extracted from the earlier `scuri-photo-sync-fixed.zip`, not the original uploaded archive. Use a separate checkout for review. No deployment is included or required to inspect these changes. Packaging checks and hashes are supplied alongside the archive.

## Included

- Preserve meaningful local edits when the cloud-photo protection guard restores remote assignments.
- Repair decoded-dimension hydration, capture source file metadata, and use in-memory originals when local photo storage fails.
- Save each completed Drive original/preview ID independently, so a later preview/cloud failure does not discard known upload progress.
- Retry every dirty project, including inactive projects, through a serial queue with backoff and reconnect handling.
- Separate account caches, invalidate stale workspace callbacks and verify the expected account for queued writes.
- Coordinate project deletion with pending saves; retain original files that other projects may reference.
- Wait for IndexedDB commit, handle aborts, validate saved metadata and preserve damaged raw caches before replacement.
- Show pending originals/previews and expired Drive access accurately; distinguish empty frames from unavailable assigned photos.
- Add portable project backup/import, session Undo/Redo and session restoration of deleted projects as new copies.

## How to use the new features

**Backup:** open a project and select **Download project backup**. The package contains its layouts, crops and original photos currently available locally or in memory. It does not download missing originals as part of packaging: connect Drive and wait for photos to load first. If originals are missing, the app asks before downloading an explicitly incomplete package. The limit is 256 MB.

**Restore:** choose **Restore backup** from Projects, select a `.scuri.zip`, and review its name, page count and included/missing originals. **Restore as new project** writes fresh photo keys and adds a new project. Existing projects are never overwritten. Imported cloud/Drive IDs are discarded; the new copy backs up into the current account normally.

**Undo/Redo:** use the controls above the project/editor. History covers project names, crops, replacements, rearrangements, layouts and page operations, up to 40 steps. Crop gestures are grouped. Cloud acknowledgements do not reset local undo history or roll revisions backwards. Opening another project, reloading or changing accounts resets this history.

**Restore deletion:** Projects shows the most recently removed project with **Restore a copy**. Up to ten removed projects remain available during the current workspace session. Restoring creates new project/page IDs. This is not a persistent cloud Trash. Drive originals are retained rather than automatically trashed.

**Storage trouble:** a persistent warning offers **Retry local save** and a portable backup. Do not treat an incomplete backup as containing missing originals.

## Account transition

Each signed-in account has separate project/template cache keys. Older unscoped data remains in **Local workspace**, visible when signed out. It is not automatically claimed by a signed-in account. Existing cloud projects still load from Supabase.

To bring an older local project into an account, download its backup in Local workspace, sign in, then restore it. If needed, manually connect Drive in Local workspace to load originals before backing up. Account changes clear the active Drive token and stop old queued work; reconnect Drive for the selected account.

## Verification and limits

- **110 tests passed in 12 files**, including 25 new regression tests.
- TypeScript and ESLint passed with zero errors/warnings; production build passed.
- Tests use synthetic project/page/asset records and mocked external boundaries. Backup tests use synthetic bytes, not a user's photographs. No migration, seed or helper touches existing assets.
- No visual/browser, physical-device, real OAuth or deployed-RLS acceptance test was performed.

**The remaining cross-device save race is not fixed here.** Project metadata and child rows still use separate REST writes. A single client queue cannot make those writes atomic across devices/tabs. A02 requires a reviewed transactional database operation; no migration is included in this release. Full template conflict handling, pagination/completeness, persistent history, automatic byte cleanup and the remaining feature roadmap also remain separate.

Completed-file upload checkpoints are included; resuming partially transferred byte ranges across a reload is not. Retained cache/Drive originals can require later deliberate cleanup. Portable backup compression/validation still uses bounded in-memory ZIP processing, so device memory/performance acceptance remains necessary.

Supabase remains the authoritative project store. Portable backup manifests are explicit export/import files only; Drive is never used as the live project manifest. Existing Drive files are not rewritten to add identity hints. This release does not recover Islands or establish its current state; use the separate manual recovery plan later.
