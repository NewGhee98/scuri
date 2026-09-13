# Project-photo sync safety fix

Prepared locally from the supplied archive. No live service access, credentials, recovery, schema change, seed operation or deployment.

## Failure trace

1. `storage.loadProjects()` loads cached version-3 metadata; `pullProjectsFromCloud()` / `rowsToStoredProject()` reconstruct authoritative pages and photo assignments from Supabase.
2. Previously, `LayoutsApp.openStoredProject()` called `hydrateProjectPages()`, which omitted a photo if IndexedDB had no bytes and Drive was disconnected, downloading failed, or decoding failed. It could also omit a page on a template/format mismatch.
3. `serializePage()` and `buildStoredProject()` serialized only the surviving runtime `photos`. The 250 ms autosave wrote the reduced metadata to localStorage. Navigation/manual sync also called `persistActiveProject()`.
4. The 1.8 second push timer and manual/Drive-connect paths called `pushProjectNow()`. Drive backup was optional and asynchronous. `pushProjectToCloud()` gated the parent revision, then upserted pages/assets and deleted remote rows absent from the local snapshot. Empty assets produced an unqualified project-wide asset delete; omitted pages could also cascade-delete assets.
5. Cloud pull/push updated the library but left active runtime pages unchanged. Reopening the same project returned early, so stale empty state and missing uploaded Drive ids could be serialized again.

## Final behavior

`reconcileProjectPages()` adopts metadata immediately and keeps assigned-but-unavailable photos in `unavailablePhotos`. `hydrateProjectPhotos()` resolves only bytes; `applyHydratedPhotos()` checks current page/frame/blob identity before applying results. `serializePage()` combines loaded and unavailable metadata. Renaming/autosaving without Drive is safe; failed downloads and decode failures retain assignment and crop records. The editor labels unavailable photos separately from empty frames and retries on token restoration/reopening.

The cloud writer preflights every project id. Unexplained missing photos or pages return `CloudAssetProtection` before any Supabase mutation. Explicit actions record durable local deletion intent keyed by page/frame/blob, with a separate page-id list for page removal. A complete acknowledgement clears only the intent included in that request. Read failures stop the push; partial failures retain intent and the advanced revision for retry.

Writes preserve existing slot row ids for replacements/swaps and use fresh ids for new slots. Known remote Drive ids survive older caches that lack them. Deletions use exact observed identities; page deletion checks for remaining assets before deleting the page. Conflict copies receive new page ids and independent asset row ids, preventing subsequent upserts from moving the original project's rows into the copy. Cached image bytes shared with another local project are retained.

Cloud pull, protection and acknowledgement paths now reconcile the active editor. Acknowledgements merge Drive ids and revision into current edits rather than replacing them with the older sent snapshot. An unchanged failed backup does not spin in an automatic retry loop.

Both original and preview Drive uploads include project, page, frame and blob identity. Existing files remain compatible and are not modified. These are upload-time hints, not a placement/crop history or an authoritative manifest.

## Verification

The regression suite uses fabricated in-memory rows, mocks Supabase/Drive/IndexedDB boundaries, and blocks accidental network fetches. It exercises the complete pull/hydrate/cache/push path; disconnection, download/IDB/decode failure and later restoration; active metadata reconciliation; stale hydration; empty/partial/cascade protection; explicit last-photo deletion; replacement, swaps and layout/page deletion; read/write failure and retry; revision conflict; unrelated-project preservation; acknowledgement races; and Drive upload metadata.

All **85 tests passed** (31 new regressions); TypeScript, ESLint (zero warnings) and the production build passed. See `VERIFICATION.md`. The supplied package manifest/lockfile and migrations remain unchanged.

## Limits and rollout

This was not a physical-device or live Supabase/Google OAuth acceptance test. The existing cloud writer uses multiple REST requests, not a database transaction; the patch does not add general multi-writer transaction isolation. It also cannot protect projects from an older app version still running the old writer. Review and deploy the fix through the normal preview/release process, then ensure old sessions are refreshed before resuming sync/recovery.

This prevents future loss through missing local photo bytes. It does not repair already-deleted metadata. The separate `ISLANDS_RECOVERY.md` explains evidence preservation, historical mapping recovery and the manual-copy fallback without assuming the current live contents.
