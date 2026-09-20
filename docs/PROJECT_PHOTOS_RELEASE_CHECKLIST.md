# Project photos release acceptance

Implementation date: 19 September 2026; status reconciled 20 September. The library shipped in PR #22, viewing-space improvements in PR #23, and the current production baseline is PR #28 / main `8398085`. The scrolling fix is tested separately and awaits production release. Earlier local-only statements below describe the original implementation stage. Use synthetic/disposable projects for acceptance; never reset existing assets or rewrite live originals.

## Automated and local acceptance

- Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- `scripts/qa-photo-library.mjs <artifact-directory>` uses a fresh Chrome profile and blocks all external origins. Run a local production build on port 3005 with all `NEXT_PUBLIC_SUPABASE_*` and Google client values blank. Use an installed `playwright` and `sharp`, or set `SCURI_BROWSER_RUNTIME` to a runtime's `node_modules` directory. The script imports 250 unique synthetic JPEGs plus an exact duplicate, checks original-byte equality, EXIF dimensions, mounted-card bounds, original inspection, rotation/scroll restoration, repeated placement/crop independence, selected-page export and reload persistence. It verifies the actual 2160x2700 JPEG against the preview bytes and writes screenshots and a JSON report. These measurements are desktop results, not physical-iPad performance claims.
- Unit and production-handler regressions cover filters, usage/aliases, manual overrides/Undo, pinning, persistent cache reuse, zero gallery original downloads, 250-photo admission, stale placement intent, 30-page duplication/backup, metadata-only sync and explicit deletion safety. Fault tests cover storage rejection, lost upload responses, resumable offsets/expiry, token expiry, checkpoint failures, account changes and superseded metadata.

Completed locally on 19 September: **375 tests / 31 files**, typecheck, lint, production build and isolated Chrome acceptance. Chrome imported the synthetic batch in 28.6s; one filename filter took 13ms, and the initial gallery sample mounted 10 cards. No runtime errors were recorded. Preview and downloaded JPEG were byte-identical; original import bytes, both saved pages and their independent negative zoom survived reload. Report: `../../../outputs/scuri-library-validation/browser-report.json` (relative to this checklist). The app subsequently shipped; physical-device and live-service checks below are still not certified by that deployment.

Current code verification on 20 September: **512 tests / 39 files**, typecheck, lint and production build pass. Gallery regressions exercise the real component's scroll handler and effects: no scrollTop feedback on native events, no stale-scroll rollback, no height-only resize interruption, explicit reset, anchored row reflow and one-time visible-dialog restoration. An iPad flick/momentum check remains required; assigning scrollTop during a native scroll must never be reintroduced merely to remember the view.

## Required live configuration and checks (not completed locally)

1. Enable Google Picker/Drive APIs and configure a restricted browser API key, numeric app ID and exact authorised origins. Verify Drive cancellation, multi-select, denied access and source-file downloads using the normal `drive.file` permission.
2. Enable Photos Picker API and its consent scope (`photospicker.mediaitems.readonly`), with any required public-app verification. Test the hosted picker, return to Scuri, more than 100 selected files, original downloads and expired selections. Test browser/CORS behaviour on the deployed origin. Do not treat API mocks as proof that the Google console is configured.
3. In a disposable signed-in project, interrupt a large original upload, reload/reconnect and verify that its reserved Drive ID is reused. Interrupt preview/thumbnail transfer after original completion; verify no second original appears. Confirm metadata saves while bytes are still uploading. Completed file references must be visible in Supabase before reporting a complete backup.
4. Refresh old Scuri tabs/devices before editing. If an older client omits new metadata, a current client with a retained cache can restore missing fields; there is no guarantee of reconstructing fields that all clients and the cloud have already lost. The existing non-transactional cross-device child-write limitation remains separate.

## Physical-device baseline and acceptance (not yet performed)

User-reported device: **iPad Air 11-inch (M2), MUWG3NF/A, iPadOS 26.5.2**. Confirm the actual OS version when recording results.

- Files and Photos multi-selection; iCloud/Drive Files providers; supported folder selection and fallback; unsupported HEIC reporting.
- 250 mixed photos, including both panorama ratios, EXIF orientation, monochrome/low-saturation/sepia and realistic large JPEGs. Check cold/warm cache, bandwidth restriction, fast scrolling, portrait/landscape rotation and ten project-navigation cycles. Record filter latency, shell latency, memory behaviour, download counts and throughput; targets are <150ms filtering and <500ms cached shell, not current device measurements.
- Inspect Fit, pinch, pan, 100% original, swipe/keyboard navigation; a zoomed pan must not navigate. Check focus/44px controls, return position, Use/Replace/Cancel and a target changed by a cloud update. Verify independent crops on repeated placements.
- Lock/background/reopen during import and each upload rendition; quota pressure, offline navigation, Drive reconnect, reload and file reselection. No unavailable record may disappear. Unbacked originals must never be evicted by Scuri.
- Export only selected pages at standard and larger settings. Compare original-based preview and JPEG geometry, borders, panorama edges and exact negative zoom. All unselected alternatives must remain saved. Verify native share/download sheets.

## Recovery boundary

Supabase remains authoritative for library membership, frame assignments and crops; Drive holds image bytes/previews. Missing cache bytes, failed downloads or unavailable analysis are never deletion intent. New Drive properties are upload-time hints only. They cannot reconstruct historical missing Islands assignments or crop values. That recovery still requires separately authorised live-connector inspection, backups/history if available, and a reviewed mapping before any live repair.
