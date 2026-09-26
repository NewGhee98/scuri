# Review-only migration: independent project photos

Status reconciled 20 September 2026: this is the historical design/review record, not a request to apply SQL. On 14 September the user relayed a live-connector confirmation that `projects.photo_library` is required JSONB with default `[]` and an array-only constraint; existing owner-only RLS, grants and revision trigger were unchanged and no assets/rows were rewritten. This session has not independently inspected Supabase. The reported applied migration name is `20260913224149_add_project_photo_library`; the repository filename still starts `20260913180000`. Do not run it again merely to reconcile filenames. Subsequent library/editor/template/scroll work requires no new migration. See [START_HERE](START_HERE.md) for current releases and [PROJECT_CONTEXT](PROJECT_CONTEXT.md) for implementation. The documentation audit did not query Supabase or rename/apply migration files.

## Why it is needed

In the supplied schema, project_assets requires a project, page and frame and represents an assignment. It cannot persist a photo before that photo is placed without inventing a hidden page/frame or changing existing assignment constraints. An independent library therefore needs additive metadata storage. This release proposes one JSONB array, projects.photo_library, within the existing project owner/revision boundary. Photo bytes and previews remain in Drive; this column is not a Drive manifest.

The SQL file 20260913180000_add_project_photo_library.sql adds a non-null array with an empty default and an array-type check, plus a descriptive column comment. Entries contain immutable blobKey, dimensions, optional source filename/MIME/size and Drive original/preview IDs. There is no image data, crop or frame assignment in library entries. Page/frame/crop records remain in project_assets.

There are no changes to existing table constraints, foreign keys, revision triggers, RLS policies or grants. The file contains no insert/update/delete/backfill, no asset cleanup and no seed data. All earlier SQL files are unchanged. Existing assigned photos seed the library in client memory and on later ordinary saves; the migration does not invent entries or rewrite existing assignments.

## Client compatibility and failure behaviour

- Reads work with and without the new column. Missing local/remote library metadata is unioned with known assigned originals; omission does not delete known entries.
- With the column present, library metadata is written as part of the revision-gated parent save. Assignment deletion still requires explicit scoped intent and leaves library membership intact.
- Without it, a missing-column error permits a retry omitting the field only when all library originals are assigned. A save containing any unassigned original stops before child writes, displays the cloud-library setup error and keeps the local project for backup. Removing/replacing a frame can make an original unassigned and therefore trigger this protection.
- Old clients omit the new column on writes, so they leave its stored value alone. They cannot show unassigned library entries and cannot correctly render new negative-baseline crops. Upgrade active clients before relying on the new workflow across devices. This is compatibility support, not a promise that mixed app versions provide equivalent behaviour.

## Original rollout checklist (historical; inspect current state before any action)

1. Preserve the current database schema/data snapshot and any unsynced browser drafts. Inspect the deployed application and schema before relying on historical notes. Use an isolated test database and synthetic photos first.
2. Review the supplied SQL against the actual projects table, policies, revision trigger and any existing photo_library column. IF NOT EXISTS is not a substitute for checking an already-present column's type, default and constraints. PostgreSQL may take a table lock while applying DDL; choose the normal maintenance procedure for that environment.
3. Only after authorization, apply the additive file using the normal migration process. This local release does not execute it or supply a live connection command. Verify the new column's array/default behaviour and unchanged owner isolation/revision behaviour in that test environment.
4. Test a library-only photo, unavailable bytes before Drive connection, reload/second-device metadata, explicit frame removal retaining its original, ordinary assigned crop saves, and explicit suggestion application preserving the source project. Verify original/preview upload IDs are retained across retries.
5. Review those results before any production release. Refresh active clients, including installed PWA sessions, before using library-only photos or negative zoom across devices.

## Rollback and unresolved work

If an application rollback is required, preserve the additive column and its data. Do not drop the column or delete/repurpose original assets; older clients can omit the column. Export unsynced/new-format work and avoid editing new negative-zoom crops in older code. The package intentionally contains no destructive down migration.

This change does not repair A02: project metadata and child rows still use separate REST writes and can interleave across devices. The new column's parent revision gate does not make the complete project save transactional. A future transaction design needs its own review and justified migration.

It also does not recover Islands. No old Drive identity metadata is assumed. Preserve evidence and follow ISLANDS_RECOVERY.md later under separate live authorization.
