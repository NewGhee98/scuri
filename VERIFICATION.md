# Scuri verification

## Current verification — 20 September 2026

The current production baseline is PR #28 / main `8398085`, verified Ready / Current on Vercel. The Project photos scrolling fix is a separate change awaiting production release. It removes scrollTop feedback during native scrolling, including delayed React updates and height-only viewport changes, while retaining one-time restoration, explicit resets and anchored layout changes.

**512 tests across 39 files pass**, as do standalone typecheck, full ESLint, the normal webpack production build and whitespace checks. Six focused regressions exercise the actual gallery component and effects. Three reproduce the original scroll writes/rollback before the fix. All preceding template, crop, export, sync-safety and library tests remain included. No dependency or schema changes.

Local Chrome checks use a blank-cloud build and a generated backup containing 120 synthetic photos and two populated pages. Native scrolling advances through virtual rows while previews load; filtering resets to the beginning; the viewer returns to the same photo region with keyboard focus; both 1180×820 and 820×1180 CSS viewports are checked. This is desktop verification, not a physical-iPad momentum test or live cloud round trip. Browsing does not enable composition Undo or load all originals.

Evidence: `../../outputs/scuri-scroll-{before-tests,tests,typecheck,lint,build}.txt` and `SCURI_SCROLL_AND_DOCUMENTATION_2026-09-20.md`. Current release/architecture and the documentation inventory are in `PROJECT_CONTEXT.md` and `README.md`. Older counts and local-only statements below describe historical packages and must not be presented as current release status.

## Four built-in panorama choices (historical local verification, 15 September)

Base: fetched GitHub main `6df71f9b0f51392694ff628c79cb15c370d96a32`. The final panorama set contains exact-ratio five/seven-photo layouts and a borderless version of each; smaller panorama counts from the initial local proposal were retired. No production crop, editor, thumbnail, export, storage, custom-template or sync code changes.

| Check | Result |
| --- | --- |
| Panorama regression cases | 41 passed as part of the full suite |
| Full existing test script (`pnpm test`) | **185 tests passed in 18 files** |
| Typecheck (`pnpm typecheck`) | Passed |
| Lint (`pnpm lint`) | Passed without warnings or errors |
| Production build (`pnpm build`) | Passed webpack compilation, TypeScript, all 4 static pages and build traces |
| Previous built-in definitions | All 45 compared equal to the fetched base; both exact pano layouts match their initial local definitions |
| Picker visual review | Rendered the actual picker SVGs; inspected all four layouts, including gapless rows |

Both bordered templates are checked for exact physical aspect ratios, bounds, non-overlap, equal 32px gaps/margins and vertical centering; matching 6400×1440 and 1536×230 sources have no baseline overflow/underfill. Borderless templates are checked for full-page coverage, equal-height rows, zero margins/gaps, unchanged image proportions, normal panning without exposed background and the expected 10% / 16.1458333% horizontal crop. All four templates' SVGs and shared geometry are checked at picker, thumbnail, editor, export and doubled-output sizes. The real JPEG export function uses mocked decoding/canvas encoding and is compared with shared preview drawing calls at baseline, negative and positive zoom. Custom copies and project save/restore retain geometry, assignments and crops; unavailable local bytes retain metadata.

Tests use synthetic data and in-memory storage/canvas adapters. No helper seeds, resets, overwrites or deletes existing project assets. No service configuration, credentials, migration or live cloud operations were used. Vitest was run through the permitted local process path after Windows sandbox `spawn EPERM`. Commands use the unchanged package scripts through bundled pnpm (npm is not installed in this environment). Real browser pixel/JPEG encoding comparisons, touch gestures and live cloud persistence are outside this local verification.

## Upload-checkpoint protection recovery (earlier local verification)

Based on GitHub main a8b0e5417ff0685929580e791a05e6e75ae7fecd. The new integration regression first failed against the previous handler behaviour with a lost upload-folder ID. After the fix, **144 tests passed in 17 files** (eight additional regressions), TypeScript and ESLint passed, and the final production build compiled, typechecked, prerendered all four static pages and completed traces. A test callback's async type was corrected before the final successful checks.

Coverage includes protection -> cache reload -> active-page metadata adoption -> subsequent cloud push, independent original/preview checkpoints, missing folder retention, immutable-key matching after frame moves, cloud-ID precedence, library-only originals, retained local edits, unchanged acknowledged state, and a failed-preview retry that never re-uploads the completed original. All fixtures/adapters are synthetic and real transport is blocked or mocked. Existing assets were not seeded, reset, overwritten or deleted.

This fix introduces no migration, dependency or environment changes. Existing SQL files are unchanged. No Supabase/Drive writes or production deployment were performed for this fix. On 14 September the user relayed the connector's confirmation that the photo-library migration is applied and verified live; that confirmation was not independently re-run here. The recorded migration timestamp alignment and cross-device transactional limitation remain separate. The earlier browser deployment smoke test covered the preceding release, not this new fix. Packaging verification for the preceding local handoff is recorded in the companion SCURI_UPLOAD_CHECKPOINT_FIX.md.

## Zoom and arrangement suggestions (earlier local package)

Final checks on 13 September 2026: **136 tests passed in 16 files** (26 additional tests), TypeScript passed, ESLint passed without errors or warnings, and the production build completed compilation, TypeScript checking, prerendering and build traces. The worker is included in the successful webpack build. No dependency or lockfile changes are included.

New coverage includes:

- A 3:1 panorama in a square frame at fill, partial reveal, contain and smaller scales; centring, original crop compatibility and extreme image proportions.
- One shared editor/thumbnail/export drawing function, including exposed background and unchanged legacy rendering. Below-baseline crop values survive local/cloud serialization and portable-backup restoration.
- Weighted dominant palettes that distinguish images with the same average RGB, perceptual colour grouping, proportions, actual output/gutter geometry, eligible custom layouts, and panorama groups favouring stacked horizontal frames.
- Complete and unique photo accounting, page/photo limits, meaningfully distinct proposals, unavailable photos, non-mutating previews, explicit new-copy application, and rejection of stale or repeated placements.
- Assigned and unassigned library preservation across cloud merge, acknowledgement, explicit assignment removal, Drive checkpoints and portable backup; older schema reads and assigned-only saves; unassigned saves failing before child writes if the column is absent.
- Actual worker-message handling with mocked browser decoding/canvas boundaries, derived-analysis cache reuse/account separation/cancellation, unassigned Drive upload metadata, and a synthetic 200-photo proposal case.

The existing fresh-device, Drive-not-connected, missing-download, active-editor hydration and intentional-deletion safety tests continue to pass. All data and image bytes are synthetic; external adapters are mocked or blocked. No helper seeds, resets, overwrites or deletes existing assets. One additive SQL migration is supplied for review, but no migration or database-policy check was executed.

Canvas tests check drawing calls and geometry, not a browser pixel comparison. The worker tests are not physical-device performance or memory benchmarks. Browser UI, mobile gestures, real OAuth, real Drive downloads, deployed database policies and a two-device acceptance test remain unverified. No browser session, real credentials, live recovery or deployment was used. The existing non-transactional cross-device child-write race (A02) remains unresolved.

The companion SCURI_ZOOM_ARRANGEMENTS.md records verified ZIP/patch packaging checks. The source includes the review-only migration explanation in PHOTO_LIBRARY_MIGRATION_REVIEW.md and the unchanged manual Islands recovery guide.

## Approved client release (earlier)

The local client-safety/backup/undo update builds on the earlier fix below. Final suite: **110 passing tests in 12 files** (25 new tests). Typecheck and lint passed, with zero errors/warnings. A production build compiled, typechecked, prerendered all four static pages and completed traces. Final packaging checks are recorded in `SCURI_CLIENT_RELEASE.md`, supplied alongside the source archive.

New coverage: meaningful local-edit preservation, decoded dimensions and in-memory originals, truthful backup status, independent upload checkpoints, offline/reconnect queue draining, retries without new edits, deletion waiting for pending writes, account-separated project/template caches and stale-session cancellation, IndexedDB commit/abort, corrupt-cache preservation, undo/redo across a cloud acknowledgement, clock ordering, backup round-trip/fresh IDs/missing originals/checksum failures/path validation, and partial original/preview upload retries.

All records and photo bytes in these tests are synthetic. Real network fetches are blocked or mocked. No existing database/cache/Drive assets are seeded, reset, overwritten or deleted by any test helper. The app package includes no dependency or SQL migration changes. Browser UI, device memory/performance, real OAuth and deployed database policies have not been exercised.

The remaining non-transactional cross-device save race is explicitly outside this release; passing the client tests does not resolve it. See `CLIENT_RELEASE.md`.

## Earlier photo-sync patch

Input: the supplied `scuri-main.zip`.

Input SHA-256: `bbc86e3f98330ff77b46d030f1f0f797aeccc91cfb32fcb9eb15e391c3e724b3`.

Environment: Windows, Node.js 24.19.0, pnpm 11.19.0, Next.js 16.3.0, Vitest 4.1.10. Public dependencies were installed using a temporary pnpm lock imported from the supplied npm lock. That temporary lock, dependency store, node_modules, build output and local Git metadata are not part of the deliverable. No package dependency changes are included.

| Check | Result |
| --- | --- |
| Baseline unit suite | 54 tests passed in 8 files |
| Final `pnpm test` | **85 tests passed in 10 files**, including 31 new regression tests |
| `pnpm typecheck` | Passed; final production build also completed TypeScript checking |
| `pnpm lint` | Passed, zero errors and warnings |
| `pnpm build` (`next build --webpack`) | Passed: compiled, typechecked, prerendered all 4 static pages and completed build traces |
| `git diff --check` | Passed |

New tests exercise fabricated in-memory project/page/asset rows only. Supabase, Drive downloads/uploads, image preparation and IndexedDB calls are mocked where appropriate; the safety suite blocks accidental real fetches. The mock cloud enforces primary-row and page/frame uniqueness and models the page FK cascade. No helper seeds, resets or modifies a real database.

The build used empty public Supabase/Google Drive configuration and disabled Next.js telemetry. Process-spawning checks ran through the permitted local execution path after the Windows sandbox blocked child process startup. No Supabase, Drive, Vercel, GitHub, browser session or real credentials were used.

Reproduce from the fixed source using the existing npm scripts:

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run build
```

Run unit checks without live service configuration. Live database, OAuth, browser UI and physical-device acceptance tests are outside this verification. There was no deployment or Islands recovery. The fix's multi-request write limitation and the manual recovery boundary are documented in `PHOTO_SYNC_FIX.md` and `ISLANDS_RECOVERY.md`.
