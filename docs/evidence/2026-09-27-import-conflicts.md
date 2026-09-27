# False conflicts during photo intake — 27 September 2026

The user reported that a new project became a `(conflicted copy)` while
importing 100 photos from iPad Files after PR #33. No device network trace was
available. The following independently reproduced defect is consistent with
that report; it is not proof of the original iPad's exact network failure.

## Reproduction and cause

The cloud can commit a project-row insert/update while its response is lost.
The browser retains its earlier revision. Intake and backup checkpoints keep
advancing local metadata while that save is pending. PR #33 recognised a lost
response only if the *current* local content exactly matched the cloud. Once
another photo arrived, that condition failed and the app incorrectly treated
its own earlier save as a competing edit.

Initial creation has an additional case: the parent insert may commit but lose
its response before the initial page is written. Comparing the complete local
project with that incomplete cloud project also produced a false conflict.

Three regressions failed against the previous implementation: newer imports
after a lost response, lost initial creation, and newer imports/crop edits
after a lost parent response before child writes.

## Change

- Record the exact outbound project and preflight snapshot before a mutation.
  The record is account/project scoped in per-tab session storage and survives
  a reload. It contains metadata, not image bytes or credentials.
- On revision mismatch, permit recovery only when the cloud has the exact next
  revision and matches the recorded request, either completely or with its
  unchanged preflight child rows. Save the newest local content through the
  usual revision gate. Repeated lost responses retain the original caller's
  revision so the chain can be recovered safely.
- Keep the record until the returned revision has been durably saved in the
  normal local project cache. A storage failure stops before cloud mutation
  and gives a visible error. Genuine remote content/revision differences still
  use conflict preservation.

## Checks actually run

- 572 tests across 43 files passed, including 10 added regression cases.
- The real intake and metadata queues imported 100 synthetic Files while the
  first cloud confirmation was interrupted; a backup checkpoint superseded
  that save. The result contained one cloud project, all 100 entries, the
  reserved upload identity, and byte-identical originals verified by checksum.
- Consecutive lost responses, reload before acknowledgement, tab/account
  isolation and storage rejection passed. Genuine remote crop/library changes
  and unexpected later revisions remained protected. Existing preservation
  and explicit-deletion regressions passed.
- Standalone TypeScript, full ESLint and the webpack production build passed.
- The tests used fabricated cloud rows and synthetic files. They did not
  connect to or modify any existing user project.

## Limits

This requires no database migration or service configuration change. It does
not merge or delete previously created copies. Session storage is a tab-lifetime
recovery aid; closing a tab or clearing browser data can remove the record.
The existing separate parent/page/asset writes are still nontransactional;
arbitrary interrupted or interleaved child writes remain outside this fix.
Physical iPad Files intake and completion of the user's actual backup remain
unverified. Deployment evidence is recorded separately after release.
