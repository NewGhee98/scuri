# Preserve Drive upload checkpoints during protection recovery

Historical implementation record, reconciled 20 September 2026. This checkpoint protection is included in current production through PR #28; the local-only wording below refers to its original preparation. Later library backup work adds reserved IDs and resumable checkpoints for original/preview/thumbnail uploads. See `PROJECT_CONTEXT.md`, `README.md` and `VERIFICATION.md` for current status and remaining live-service acceptance. No migration, lost-file rediscovery or live repair is implied.

Focused fix for [PR #15's P2 review finding](https://github.com/NewGhee98/scuri/pull/15#discussion_r4001065158). Prepared from GitHub main commit a8b0e5417ff0685929580e791a05e6e75ae7fecd, which matched the previously checked Vercel production deployment. This fix is local until separately published and deployed.

## Problem and change

Drive upload callbacks persist completed original/preview IDs locally before a cloud push. If the photo-loss guard then returns the canonical remote project, the old handler could discard those IDs because uploads alone did not count as meaningful local content edits. A later retry could upload an already completed original again. A missing project folder reference could also be lost.

The handler now uses one reconciliation result for its cache, project list and active editor. It fills missing byte IDs by immutable blob key and retains the known project folder when the cloud has none. Existing cloud IDs take precedence. Cloud structure, page order, placements, crops, row identities, revision and acknowledged timestamp are preserved. Retained checkpoints are marked dirty for the next metadata push, including when the device clock is behind the server.

Assigned and cloud-library-only photos are covered. New local photos and genuine edits remain in the existing separate recovery copy; backup progress alone does not create another project. Failed preview/original uploads remain retryable. No photo-loss guard, explicit-deletion rule or architecture boundary changes.

## Verification

The new integration regression failed against the previous handler behaviour because the newly uploaded folder reference was lost. It passes with the fix. The final offline suite contains 144 passing tests in 17 files, including eight additional regressions. TypeScript, ESLint and the production build all passed, including static-page generation and build traces.

Coverage includes retained original/preview IDs, cloud reference precedence, matching photos after a frame move, library-only originals, preserved edits/crops, cache reload and active-page restoration, and a subsequent cloud push retaining all assignments. A simulated preview failure followed by recovery and reload uploads only the remaining preview; it does not upload the completed original again. Already-acknowledged checkpoints stay clean, avoiding an unnecessary retry.

All records, tokens, URLs and image bytes in tests are synthetic. Cloud and Drive adapters are mocked; no test helper seeds, resets, deletes or overwrites existing assets. Public repository inspection used no credential helper. No Supabase/Drive data, real credentials or production configuration was used for this fix. Final compiler/lint/build and package results are recorded in the companion release note.

## Applying the patch

scuri-upload-checkpoint-fix.patch is incremental against commit a8b0e5417ff0685929580e791a05e6e75ae7fecd. Apply it in a clean separate checkout or branch, review the diff, and rerun the existing test/typecheck/lint/build scripts before merging. Do not apply the earlier cumulative feature patches again. The full source ZIP is also supplied for review; build output, node_modules, Git metadata and private environment files are excluded.

No additional migration is required. All existing migrations and dependency manifests remain unchanged. On 14 September the user relayed the connector's live confirmation that the photo-library migration is applied with its required constraint and unchanged policies/grants/trigger. This session did not independently re-run that check. Supabase recorded it as 20260913224149_add_project_photo_library; aligning the earlier committed filename is separate work and does not require reapplying its SQL. This fix does not resolve the cross-device transaction gap or recover upload IDs already lost by older clients. No Drive files are rewritten or automatically deleted, and Islands recovery remains separate.
