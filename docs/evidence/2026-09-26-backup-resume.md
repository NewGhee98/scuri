# Backup recovery follow-up - 26 September 2026

## Observed report

After PR #32, an iPad project shows all 92 photos analysed, 33 original backups,
32 previews, and a paused photo reporting "Load failed". The user reports that
Retry appears to do nothing. The project name includes "(conflicted copy)".
These screenshots establish a backup interruption, not its precise failing
request, token expiry time, or whether another device edited the project.

## Reproduced defects and correction

- Retry used a connected flag that remained true after the Drive token expired.
  The backup job then acknowledged success without doing work. Retry now checks
  current token validity, reconnects after expiry or an authentication rejection,
  and reports incomplete backup when access has expired. A separate Reconnect
  Drive control is available.
- A rejected upload fetch surfaced Safari's unhelpful "Load failed" message.
  Interrupted requests and transient Drive responses now receive three bounded
  retries (1, 2, 4 seconds). Each attempt verifies the existing reserved file ID
  and probes the saved resumable session before sending more bytes. Permanent
  errors, cancellation and authentication failures do not use this retry loop.
  Checkpoints and original IDs are retained; completed originals are not
  overwritten or uploaded again. Folder/download failures have useful context.
- A project metadata update could commit while its HTTP response was lost. The
  next push then treated the newer revision as a competing edit even when all
  persisted contents matched. An exact comparison of the complete library,
  pages, crop/text/layout state and assets now acknowledges that saved snapshot
  without another write. Different contents still preserve the conflict copy.
  This does not make the existing separate parent/child writes transactional.
- Completed rows no longer hide pending/failed backup activity. Errors appear
  first, include the failed step, and transient retries show their progress.

The upload recovery follows Google's [resumable-upload protocol](https://developers.google.com/workspace/drive/api/guides/manage-uploads#resume-upload)
and [Drive error guidance](https://developers.google.com/workspace/drive/api/guides/handle-errors).

## Verification

- Five newly added assertions failed against the previous implementation:
  interrupted chunk recovery, lost final response recovery, revoked-token
  recovery classification, expired-access incomplete status, and lost metadata
  response acknowledgement. The genuine competing-crop protection passed.
- Final suite: **562 tests across 43 files passed**. Includes bounded retries,
  server-confirmed offsets, 429/503 responses, authentication rejection, quota
  classification, cancellation, persistent journals, lost-response recovery and
  preservation of original references and crops.
- TypeScript, full ESLint and production build passed. Publication staging from
  the prior release was moved outside the TypeScript project before final checks.
- The local production build's actual Backups and activity dialog exposes Retry,
  Reconnect Drive and Reselect originals. The local test configuration has no
  account credentials or live cloud connection.

No migration, service configuration change or live project repair is part of
this correction. The user's iPad, real Google OAuth flow, the exact reported
network failure and two-device operation remain unverified. Deployment status
is recorded separately after publication.
