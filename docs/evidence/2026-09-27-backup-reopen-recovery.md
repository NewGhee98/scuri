# Backup recovery after reopening Scuri

Date: **27 September 2026**. Application source
**7c390e80c23a1084c7d040d30c6d16e09d17fdad** on
**codex/backup-stall-recovery**, based on c14a93f. This is a local implementation
and verification record, **not a deployment**. The last recorded production
release is PR #37; this task did not inspect or change live production data,
service configuration or deployment. No migration or dependency change.

## Report and reproduced cause

The user reported 121 completed imports, 119 analysed photos, email sign-in and
Drive connection present, but backup at 0/121 with ineffective Retry. It later
advanced slowly to 4/123. After force-closing/reopening and reconnecting Drive,
it stopped at 6/123 with a thumbnail error: "The reserved Drive file does not
match this photo. Existing files were left untouched." The user accepts uploads
only while Scuri is open, but requires reliable resumption on return.

Code inspection found a matching deterministic failure. The first thumbnail
was encoded from the reduced preview, but after the preview's checkpoint was
saved a retry could encode it directly from the original. Those bytes and sizes
differ. Even with a consistent pipeline, browser encoders can produce different
derived bytes after reopening. Existing-file verification compared a completed
reserved thumbnail with the new blob's exact size and rejected it, then the
serial backup batch stopped at that photo. New tests failed with the reported
message before the repair and pass after it. This is a reproduced code defect;
the user's actual iPad journal and Drive files were not inspected.

Separate stall paths were also reproduced: an unresolved local read or metadata
save could hold the serial worker indefinitely. The old Retry only re-enqueued
work behind that active promise, so it could not restart the worker. Before the
first transfer there was little visible feedback about folder setup, original
reads or cloud checkpoints.

## Changes and safeguards

- Returning to a visible page, a restored page or connectivity triggers a
  coalesced resume check. A full reload uses the existing startup/account/Drive
  restoration path. Actual token validity is checked; expired access produces
  a reconnect message, and a successful reconnect restarts pending backup.
- Retry cancels the old attempt, prioritizes the selected project, rechecks
  sign-in/connectivity and reports what is happening inside both backup panels.
  A 90-second inactivity watchdog releases stalled metadata or upload work.
  Progress refreshes it, so a healthy transfer can last longer than 90 seconds.
  Abort signals and current-attempt guards prevent late work from applying
  stale changes. Cancelled metadata waits do not imply cloud acknowledgement.
- A completed preview/thumbnail can be reused when reserved ID, project ID,
  photo blob key and rendition role all match, and its size is positive with a
  supported image MIME type. Wrong identities, trashed or invalid images remain
  errors. **Original size/MIME validation stays strict**, as does verification
  immediately after transmitting new bytes. No existing file is patched,
  replaced or deleted to match a new rendering.
- First-run and resumed thumbnails both use original -> preview -> thumbnail.
  Partial derived uploads carry a SHA-256 fingerprint of their encoded bytes.
  A missing/different fingerprint restarts that partial transfer with the same
  reserved file ID, preventing mixed bytes even when two renders have equal
  sizes. Completed originals and compatible resumable sessions remain reusable.
- A new photo reserves all missing rendition IDs in one Drive request and one
  cloud-accepted checkpoint, then checkpoints each completion independently.
  This reduces reservation requests from three to one and cloud checkpoints
  from six to four for a newly imported photo. This is reduced protocol overhead,
  **not a measured iPad throughput improvement**. Original bytes are unchanged.
- Folder setup, source reads, reservation, checkpoint waiting, upload progress
  and errors are visible. Retry and explicit reconnect have separate touch
  targets. Placements, crops, rank/labels, backup identity and original retention
  continue through the existing persistence and conflict protection paths.

The batch ID API uses the documented `count` parameter in
[Google Drive files.generateIds](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds).
No background-upload or screen-awake feature was added.

## Local checks

Windows, Node **v24.19.0**, dependencies from the existing lockfile. Commands
completed successfully on 27 September:

| Check | Result |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run --config vitest.local.config.mts` | **622 tests / 48 files passed**; local runner configuration only |
| `node node_modules/typescript/bin/tsc --noEmit` | Passed |
| `node node_modules/eslint/bin/eslint.js .` | Passed, no warnings in the final run |
| `node node_modules/next/dist/bin/next build --webpack` | Passed, including TypeScript and four static pages |
| `git diff --check` | Passed |

The full regression run covers sync preservation, conflicts/lost responses,
imports, ranks/labels, editor and export behaviour. New cases exercise:

- Matching completed derived files despite regenerated byte-size changes;
  rejection of wrong project/photo/role, invalid/trashed files, changed originals
  and incorrect newly uploaded content; changed partial derived bytes.
- Persisted upload IDs and JSON-restored project metadata in a 123-photo
  simulation: the first six completed photos remain untouched while the
  remaining photos finish using preserved reservations and checkpoints.
- A hung source, hung cloud/auth request, late response, healthy ten-minute job,
  cancelled metadata waiter and explicit Retry while an older project is stuck.
- Foreground/restore/online event coalescing, hidden-page and unmount behaviour,
  actual application Retry/resume callbacks, expired/rejected Drive access and
  visible signed-out/offline/missing-worker feedback.

Final production-build browser smoke at **20:10 UTC** used local Chrome with no
Supabase or Google connection and an existing synthetic six-photo/two-page
project. Reload preserved that project. Both Project photos activity and editor
Status displayed the sign-in prerequisite; Retry retained that explanation.
The separated controls were inspected visually. No application console errors
were captured; warnings came from an unrelated browser extension. Screenshot
artifact `backup-recovery-local-status.png` remains outside Git. This was desktop
browser testing, **not physical iPad testing or a live upload**. The final small
button-spacing change was rebuilt, linted and browser-checked after the complete
regression run; it did not alter backup logic.

## Remaining acceptance after release

On the physical iPad, test Safari and the installed app with the same account:
start pending uploads, lock/unlock, switch away/back, then force-close/reopen.
Check valid-token automatic continuation and expired-token reconnect followed
by automatic continuation; the count should keep advancing without repeated
manual Retry. Verify existing IDs/checkpoints are reused, completed originals
are not duplicated, and placements/crops/ranks/labels remain unchanged. Include
an interrupted chunk, a temporary network loss and an already-backed-up preview
with a pending thumbnail. Reaching 123/123 for the user's project is **not yet
verified**. Missing local bytes without a completed original still require exact
file reselection; resumption cannot reconstruct an unavailable original.
