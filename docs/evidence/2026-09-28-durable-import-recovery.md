# Durable import-conflict recovery — 28 September 2026

Local repair on `codex/durable-import-recovery`, based on release handoff
`21bee9d` and PR #38's application. This change has **not been deployed**.
No existing user project or Drive original was changed.

## Problem and resulting behaviour

The installed iPad web app was reported to stop importing into a new project
and repeatedly create conflicted copies. Two code behaviours were reproduced
with fabricated cloud rows: a lost save confirmation could no longer be
recognised after its session-storage record disappeared; and conflict handling
switched the visible project while remaining import items still targeted the
original. The exact interruption on the user's iPad was not observed.

Each app save now writes a durable receipt and stores its unique reference in
the latest local project before sending any cloud mutation. That reference is
local metadata, excluded from cloud rows, portable packages and new conflict
copies. A stale tab cannot discover another save's receipt just by project ID.
Recovery still requires the exact expected revision and matching persisted
content. A receipt cannot authorise overwriting genuine remote differences.

The receipt survives a fresh browser session, remains until the local
acknowledgement is successfully stored, and is removed by its exact ID.
Persisting a recovered base revision also handles a subsequent request that
fails before committing. Receipt/cache storage failures stop before a cloud
write. Legacy per-tab receipts remain readable during an upgrade.

If an actual conflict or photo-preservation guard is reached during intake,
the app finishes the active batch locally before changing project identity.
The next queue retry preserves both versions with the complete imported batch
in the local copy. Settled failed/paused import items then follow that copy on
Retry; attempting to retarget an active import is rejected. Local acknowledgement
is persisted before replacing the active/cache references.

## Checks performed

- Full Vitest suite: **631 tests / 48 files passed**.
- Final focused sync and portable-backup checks: **69 tests / 2 files passed**,
  including a 100-file real intake/metadata queue run after a lost confirmation
  and replacement of session storage. One project retained all 100 entries,
  its backup reservation and every original checksum.
- The actual app save callback was exercised with the real import queue and
  mocked cloud transport: identity switching waited for the batch to settle,
  failed-file retry followed the copy, and acknowledgement storage failure
  retained the pending receipt and cached/in-memory state.
- Fresh-session creation recovery, repeated lost responses, failure before a
  retry commits, account/project/tab separation, original/crop/checkpoint
  retention, storage rejection and genuine remote conflicts passed.
- Standalone TypeScript, full ESLint and the production webpack build passed.
  Portable ZIP inspection confirms the local receipt reference is omitted.
- The built app ran at an isolated local origin without cloud configuration.
  Three generated PNGs imported into one project; all three thumbnails and
  the project name survived a reload. Browser warning/error logs were empty.
  This is a desktop local smoke check, not physical iPad or live-cloud testing.

Raw logs and the screenshot are retained beside this checkout in the local
`scuri-fix-evidence` directory. They contain synthetic fixtures only.

## Release and remaining boundaries

No migration, provider configuration, dependency change, deployment or existing
conflict-copy reconciliation is required or performed by these local edits.
At diagnosis, Vercel production still served PR #38, source `9f24899`, deployment
`FWEt6rmq4m7dFJ1tTdTdVsz5Yok2`. Recheck the current release before publication.

The repair cannot recreate a save receipt that an older version already lost.
Keep existing original/conflicted projects until their contents and backup
completeness have been reviewed. Native file-picker handles are not persisted
across a destroyed browser session; files not yet saved may require reselection.
Durable recovery remains subject to the browser retaining its local data.
Separate parent/page/asset REST writes are still not transactional, so arbitrary
interleaved or partially completed child writes are not claimed solved.

After a release, verify the installed iPad app through a real large import,
lock/unlock and reopen, using the current build. Do not clear browser storage
to update. Physical-device acceptance and completion of the user's actual
photo backup remain unverified.
