# Production evidence — PR #29

This small, sanitized record is sufficient to understand the release without access to the original computer. It contains no account session, credentials, project data or photos.

## Independently rechecked for this documentation task

| Observation | Evidence / result |
| --- | --- |
| GitHub at 2026-09-20 20:07:43 UTC | [main commit](https://github.com/NewGhee98/scuri/commit/24075d1e4c8cd6dfc2936d77332f8cd3793bf268) is `24075d1e4c8cd6dfc2936d77332f8cd3793bf268` |
| PR state | [PR #29](https://github.com/NewGhee98/scuri/pull/29) merged at 12:42:34 UTC; head `f777149c616029462792d8d419ba5f07f9f3f6be`; merge commit matches main |
| Complete Git tree | `32ab55a98d801320f0bc92e44f54c32da6f90c66`; local tested commit `3639dd3257683c1af43632ccdc47c28648df6f2b` resolves to the same tree |
| Authenticated Vercel inspection, 20:07–20:11 UTC | [Deployment G6GijpLztNtqiQNT966cjQms2S7Z](https://vercel.com/nugee/scuri/G6GijpLztNtqiQNT966cjQms2S7Z): Ready / Latest / Production / Current; source `24075d1`; `scuri.vercel.app` assigned |
| Deployment creation record | 42-second build completed 2026-09-20 13:43:21 BST / 12:43:21 UTC |
| Public release address | [scuri.vercel.app](https://scuri.vercel.app); [immutable deployment](https://scuri-2f1pl3twe-nugee.vercel.app) |
| Separate open branch work | [PR #14](https://github.com/NewGhee98/scuri/pull/14), `feature/client-safety-backups`, remained open; not reviewed for merging |

GitHub identifiers and release links are public. Vercel details and the Drive documents require the owner's existing access; a reader without that access has this dated observation, not a live dashboard verification. No live Supabase rows, Supabase/Google configuration or environment values were inspected. A later read-only check of Vercel's root-directory/ignored-build setting established the automatic Preview publication constraint in the [documentation audit](2026-09-20-documentation-audit.md); no setting was changed.

## Recorded checks from the implementation/release sessions

The local raw test/build logs and release JSON were available and inspected during this documentation task. They are summarized here rather than committing machine paths, full build output or synthetic photo fixtures. Tests were **not rerun** for this documentation-only change.

- Test output: `Test Files 39 passed (39)`, `Tests 512 passed (512)`, reported duration 7.30s. Six component-level scrolling regressions cover native/fractional scrolling without DOM writes, delayed echoes, height-only resizes, explicit reset, row reflow and hidden-dialog restoration. The old implementation failed three of these cases.
- Standalone typecheck and full ESLint: recorded successful exit in the release notes; their redirected logs are empty, so the empty files alone are not independent proof of success.
- Production webpack build log: compiled successfully, completed TypeScript checking, generated 4/4 static pages and completed build traces.
- Desktop Chrome: recorded production-build checks with 120 synthetic photos/two pages, blank cloud configuration, 1180×820 and 820×1180 CSS viewports. Scrolling progressed while previews loaded; viewer return retained the photo region/focus; filter reset worked; originals loaded remained zero and composition Undo remained disabled. This was not a pixel-exact scroll-return assertion or physical iPad momentum test.
- Release read-back at 12:42:55 UTC: main, published head and tested local commit had the same complete tree; all 12 changed file hashes matched.
- Public smoke check at 12:44:05 UTC: HTTP 200, 11 public JavaScript/CSS assets loaded, 55 retained feature markers passed. These markers check served content, not full interactions or authenticated synchronization. This public smoke test was not rerun during the documentation task.

## Unverified boundaries

Physical iPad Safari, Pencil/pinch, memory and share sheets; live Google picker/OAuth/upload-resume flows; two-device saves; live Supabase schema/policies/grants; historical Islands data; colour-managed printing. No passing build or deployment closes these gaps. See [VERIFICATION](../../VERIFICATION.md) and the [acceptance checklist](../PROJECT_PHOTOS_RELEASE_CHECKLIST.md).

## Historical predecessor

[PR #28](https://github.com/NewGhee98/scuri/pull/28), main `8398085`, was the preceding template-tools release. It is not the current production source. Its implementation and the earlier releases are preserved in the [historical context](../history/PROJECT_CONTEXT_THROUGH_2026-09-20.md). References to the scrolling fix awaiting release describe the earlier implementation/publication stage only.
