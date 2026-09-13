# Local verification — 2026-09-13

## Zoom and arrangement suggestions (latest, not deployed)

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
