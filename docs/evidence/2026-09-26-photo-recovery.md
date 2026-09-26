# Photo import and retry recovery — implementation verification

26 September 2026. **The checks below were completed locally before publication.**
Local branch: `codex/photo-import-recovery`, based on the clean documentation
checkout `2b049eb`. The existing checkout and its documentation branch were
preserved. The user subsequently authorized deployment. The GitHub release
branch starts from production `5446dd3` and contains this fix and its tests;
the separate documentation PR #31 remains outside this release. Deployment
receipts belong to the release PR and the subsequent production record.

## Diagnosis and limits

The user reported 87 photos imported on the same iPad from both Files and Apple
Photos. Screenshots showed 34/87 analysed, original backups and previews, with
several “Original unavailable on this device” messages.

The code confirms the recovery failure:

- Library metadata survives independently of original bytes. Backup previously
  converted IndexedDB read errors to null, reported a missing original, and
  could return success even when originals were skipped.
- Backup only checked local originals. It could not finish a missing preview
  from an original already safely stored in Drive.
- Retry analysis reused the same worker after its error handler had terminated
  it. Exact-file reimport could restore bytes without changing the metadata
  dependencies that start analysis.
- The activity panel requested file reselection without offering a direct
  recovery control.

The underlying reason this iPad lost access to the files is **not established**.
No device storage/console evidence or live project inspection was available.
Picker-file lifetime, browser storage failures and later eviction remain
possibilities. An older [WebKit report](https://bugs.webkit.org/show_bug.cgi?id=240216)
describes apparently valid but unreadable IndexedDB blobs; it is supporting
background, not evidence that this user's current device has that specific bug.
There is no evidence of a 34-photo limit or a request to delete these assets.

## Change

- Copy each selected file into an independent byte snapshot before hashing and
  decoding. Store it as a plain Blob and read it back, checking its size and
  SHA-256 fingerprint, before declaring import complete or releasing its source.
  A failed verification pauses intake. Original bytes and the existing
  IndexedDB format are retained; no migration is required.
- Distinguish missing/unreadable originals from completed backups. Validate
  source bytes, recover from an existing Drive original when available, and
  upload only missing renditions using the existing reservation/checkpoint
  mechanism. A failed download/checksum never replaces an original.
- Offer **Reselect originals…** in Backups and activity. This recovery path
  accepts only exact fingerprint matches to existing entries. It restores their
  original keys and retains assignments, crops and Drive references; a different
  file with the same name is rejected. Legacy entries without a verified
  fingerprint are not matched by guesswork.
- Restart the analysis worker on retry, rerun analysis when imports/restorations
  complete, reuse cached analysis thumbnails, and refresh recovered previews.
  Refresh completed backup status to clear obsolete missing-original warnings.

## Fresh validation

All checks below completed in this task using the locked installed dependencies,
an isolated checkout and no live service configuration.

| Check | Result |
| --- | --- |
| Full Vitest suite | **548 tests / 42 files passed**; 15 new regressions |
| TypeScript | `tsc --noEmit` exited 0 |
| ESLint | Application checks exited 0; a temporary local-runner warning was corrected |
| Production build | `next build --webpack` exited 0, including its TypeScript check |
| Diff whitespace | `git diff --check` passed |
| Browser recovery | Isolated Chrome with **87 synthetic photos**; no external requests or runtime errors |

The browser test first injects an analysis-worker failure and verifies that
Retry recovers. It then removes 53 originals and their derived caches from its
own disposable browser profile, retaining all 87 library records. The activity
panel reaches **34/87 analysed**. Reselecting the exact batch restores all
**87/87**, with every stored original's checksum unchanged and no new library
entries. A deliberately unrelated same-name file is rejected, a previously
missing preview appears without reload, and metadata survives reload.

The browser fixture has no placed pages; preservation of actual nonempty
placements and crops is covered by the import-queue regression. Drive recovery,
quota failure, mismatched downloads and account switching are tested with
synthetic adapters, not live Google/Supabase sessions.

Run `node scripts/qa-photo-recovery.mjs <artifact-directory>` against the local
production build on `127.0.0.1:3026`. As with the existing browser helper,
`SCURI_BROWSER_RUNTIME` may point to a node_modules directory containing
Playwright and sharp. The helper uses a fresh Chrome profile and blocks external
origins. Its JSON report and screenshots are generated artifacts, not private
photo attachments. An initial browser run timed out because it looked for an
error inside a collapsed details element using visible text; the corrected
assertion reads its text content and the complete rerun passed.

## Remaining acceptance and release

Physical iPad Files/Photos selection, suspension and storage pressure still need
verification after deployment. Copying and checksum read-back add bounded work
per file; they cannot prevent later OS eviction. Already unavailable originals
without a completed Drive backup require the user's exact source files.

The local implementation and validation did not modify a user project,
original, Drive account, Supabase row, service configuration or deployment.
Deployment does not itself establish recovery of the user's affected project.
