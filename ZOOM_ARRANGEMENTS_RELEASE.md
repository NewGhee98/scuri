# Scuri: zoom out and suggest arrangements

Historical 13 September implementation record, reconciled 20 September. Both features are included in current production through PR #28. The original restriction centring negative zoom was superseded by PR #27: photos now move freely on both axes at every zoom, with legacy crops preserved until edited. The library now admits 250 unique photos and projects support 30 pages. The user subsequently reported the photo-library migration applied; do not rerun SQL from this note. See `PROJECT_CONTEXT.md` and `README.md` for current behaviour and `VERIFICATION.md` for current checks. Below is the original package history, not current deployment status.

Prepared locally on 13 September 2026. Both requested features are implemented on top of the preceding client safety release. All 136 tests, typecheck, lint and production build passed. Nothing was deployed; no live service, browser session or credentials were used. One additive migration is prepared for review only.

## Photo zoom

Select a photo and move its slider below 0%. Zero remains the historic fill-frame size; positive values zoom in and negative values shrink the full original proportionally. Below zero the image is centred. Exposed areas show the page's existing background, including within overlapping frames. Frames, gutters and borders do not change.

For a 3:1 panorama in a square, fill size crops the sides. At -50%, more of those sides appear while the top and bottom edges move inward. At about -66.67%, the complete image fits; the slider continues farther out for extra surrounding space. Its minimum adapts to the image/frame proportions. The existing +300% maximum is unchanged.

Saved zoom is still a scale factor, with 1 as fill size; existing valid values at or above 1 render as before. No crop data rewrite or crop migration is needed. Editor, thumbnails and JPEG exports use the same drawing function. Below-baseline zoom survives autosave, cloud metadata and portable-backup restore. Older app code cannot render the new below-baseline values correctly, so refresh active clients before editing them across devices.

## Project photos and suggestions

1. Open a project and choose **Add photos to library**. Photos do not need a frame first. Existing assigned originals appear automatically.
2. Local analysis shows progress; unavailable photos remain listed as **Awaiting analysis**. Connect Drive or restore bytes, then retry when needed. Analysis can reuse a previously cached palette/preview without the original currently loaded.
3. Choose **Suggest arrangements**. Review up to three distinct options: **Colour harmony**, **Best fit** and **Balanced mix**. Each shows page previews, a brief explanation and any photos that cannot be placed. Expand a card to see remaining pages.
4. Choose **Apply as new project** explicitly. A new project retains the complete library and has fresh project/page identities. The original project and its crops remain untouched. New assignments start at centred fill size and can be edited normally, including negative zoom.

In the editor, select a frame and use **Use in selected frame** on a library photo to place it manually. Removing or replacing an assignment, changing layout or deleting a page keeps the original accessible in the library. This focused feature does not add library-original deletion or automatic byte cleanup.

## How recommendations work

No AI model or external analysis service is used. A browser worker decodes one uncropped preview at a time, samples up to 96 pixels on its longest edge and extracts up to five weighted dominant colours, perceptual brightness and saturation. Weighted OKLab palette distance distinguishes mixed palettes that a single average RGB would hide. Derived palette data and small thumbnails are cached per account/photo/version; they are not project metadata or a source of library membership.

The deterministic heuristic jointly chooses photo groups and eligible existing templates. It resolves each frame using the project's output dimensions and that template's gutter/insets, then estimates the original area cropped at fill size. Different weights favour colour compatibility, fit or layout variety. Compatible panorama groups favour horizontal stacked frames when those offer better fit. Custom templates must match the format, pass existing geometry validation and have 1–12 frames.

Every original is used at most once per proposal. All originals are accounted for as placed or explicitly unplaced. New independent imports and analysis are capped at 200 originals; the existing limit of 20 pages applies. Larger existing libraries are retained. Fewer than three proposals are shown when no additional meaningfully different, reasonably scored result is available. Rearranging identical pages or changing only template names does not count as a distinct option.

This is a bounded heuristic, not a globally optimal or subject-aware crop engine. Unsupported Worker/OffscreenCanvas environments keep photos intact and retain manual placement. The synthetic 200-photo test is not a physical-device performance guarantee. Suggestions can use cached previews while full-resolution originals remain unavailable; export still needs originals.

Technical references: [W3C CSS Color 4 conversion reference](https://www.w3.org/TR/css-color-4/#color-conversion-code), [Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers), [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) and [worker image decoding](https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/createImageBitmap).

## Persistence and review-only schema change

Supabase remains authoritative for project structure, assignments, crops and the independent photo library. Drive stores originals/previews only; browser storage and analysis are caches. Missing bytes or failed analysis never mean that the user deleted a photo. Explicit assignment deletion still uses the existing exact deletion-intent path and does not remove its library original.

The existing project_assets schema requires page/frame placement. Independent cloud originals therefore need one additive projects.photo_library JSONB column under existing owner policies and revision checks. The proposed SQL is in supabase/migrations/20260913180000_add_project_photo_library.sql. It has **not been executed**. Review PHOTO_LIBRARY_MIGRATION_REVIEW.md before any separately authorized deployment. No existing migrations, dependencies or lockfiles changed; no migration changes existing asset rows.

The client reads older schemas and can save assigned-only projects without the column. A project containing unassigned originals fails closed with a setup message before page/asset writes if the column is missing. It remains in the workspace for backup. This includes originals displaced by removal/replacement. Install and verify the reviewed column before making the full workflow available to signed-in users.

Portable backups include unassigned originals and explicitly list missing bytes. This app reads older backup files; do not use an older app to restore a new library-containing backup. As before, a backup cannot contain bytes that were never downloaded or uploaded. The existing 256 MB backup cap remains.

Future Drive uploads carry project/blob recovery hints; assigned uploads also carry page/frame IDs when appropriate. Existing files are not rewritten, and applying a suggestion can reuse immutable files whose hints describe an older placement. Never use those hints as a current manifest or to infer historic crops.

## Verification and remaining limits

- 136 offline automated tests in 16 files passed, including the existing fresh-device/explicit-deletion regressions and 26 additional tests.
- TypeScript, ESLint and the production build passed, including the module worker bundle.
- New tests cover below-baseline panorama geometry/rendering/save/restore, weighted palettes and group selection, actual frame/gutter fit, distinct proposals, unique complete photo accounting, unavailable photos, validated new-copy application, library merge/cloud/backup paths, older schema compatibility, worker/cache cancellation and a synthetic 200-photo case.
- Tests use fabricated metadata/bytes and mocked external/browser boundaries. Canvas assertions verify calls and geometry; no browser pixel, physical-device, real OAuth/Drive or deployed-policy acceptance test was performed. No existing assets were seeded, reset or modified by tests.

The previously documented A02 cross-device child-write race is **not fixed**. Project and child REST writes are not a single transaction. Transactional saves, pagination/completeness and other audit recommendations remain separate work.

For later acceptance in an authorized test environment, verify a fresh cache before Drive connection, library-only metadata after reload on a second client, retry after Drive connects, explicit frame deletion with the original retained, two distinct proposal previews followed by explicit new-copy application, and a panorama's editor/thumbnail/export appearance after saving negative zoom. Review the additive migration first; no live validation is claimed here.

## Islands remains a separate manual recovery

No current Islands data was inspected or repaired. The fix and library cannot recreate missing historic frame mappings/crops. Later, with explicitly authorized live connectors, preserve database/Drive evidence and the original device cache, look for a surviving local mapping or isolated historical database restore, and reconstruct only into a separate recovery copy. If no mapping survives, the user must choose placements/crops from verified originals manually. Old Drive files lack the new hints; even newer hints can be stale. Follow the separate ISLANDS_RECOVERY.md guide without deleting originals or guessing historic order.

## Source package

scuri-zoom-arrangements.zip contains the complete source under scuri-main/. The companion patch is incremental against the preceding scuri-client-safety-backups.zip, not the original uploaded archive. Apply it in a clean separate checkout for review. The external SCURI_ZOOM_ARRANGEMENTS.md includes packaging verification and ZOOM_ARRANGEMENTS_CHECKSUMS.sha256 provides integrity hashes. Generated build output, dependencies, Git metadata and private environment files are excluded.
