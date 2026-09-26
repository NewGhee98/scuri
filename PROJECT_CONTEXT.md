# Scuri — technical project context

Implementation handoff updated **26 September 2026**, including text tools released through PR #30. Read [START_HERE](START_HERE.md) first for production state, separate work and priorities. This file describes the implementation; the bounded live release checks are in [release evidence](docs/evidence/2026-09-26-text-release.md). Detailed decisions and releases through PR #29 remain in the [historical context](docs/history/PROJECT_CONTEXT_THROUGH_2026-09-20.md).

## Product contract

Scuri is a photo-first web app for polished Instagram posts/carousels, primarily on iPad and desktop, with iPhone support and larger proportional JPEG exports. The hierarchy is Projects → project → pages → editor; reusable Templates form a separate library. Portrait, Square and Story formats are defined in [formats.ts](src/lib/formats.ts). A project's chosen format is fixed across its pages.

Photos enter the project library independently of placement. Users browse/filter/inspect, explicitly confirm a photo for a frame, edit independent crops and export ready/selected pages in order. Alternatives remain saved. Built-in/custom template filters also apply to Add page within project-format restrictions. Add-page intent is bound to the project and must create a new page; stale intents are rejected and must never become replacement actions.

Saved projects and custom templates are intended to follow the same signed-in account across devices. This requires cloud metadata and accessible backed-up originals; local-only edits or unbacked files are not a guaranteed permanent copy. Optional Drive connection is separate from email sign-in. See the cross-device limitation below before promising conflict-free saves.

Current limits are 250 unique library photos, 30 pages, 80 MiB per supported delivered JPEG/PNG/WebP, and 256 MiB portable ZIP backups. Older over-limit libraries remain visible. Share-sheet wording, Files providers and decode support depend on the device. Exact constants live in source; exact dependency versions and scripts live in [package.json](package.json) and [package-lock.json](package-lock.json).

## Storage authority

- **Supabase:** authoritative project identity, structure, page order, frame assignments/crops, library metadata, Drive references and reusable templates. Project rows use server revisions; child pages/assets are separate writes. The schema intends owner-only RLS and authenticated access. Existing live policies/grants were not inspected in this documentation task.
- **Google Drive:** untouched original bytes, derived previews/thumbnails and optional exports, using the existing `drive.file` permission. The folder tree and upload app properties are not a project manifest or current assignment database.
- **Browser:** local/offline project metadata, IndexedDB originals/derived caches, account-scoped session previews, resumable job state and derived colour analysis. Supabase absence or download failure must not erase cached placement metadata. Cache eviction/reinstallation is not a refresh procedure; refresh the app normally.

The original Drive-manifest design was superseded before the August project-sync merge. Do not restore it. Templates and projects share one Supabase session but remain distinct features. Schema/design records are in [supabase/migrations](supabase/migrations); local files are not proof of live migration state.

`projects.photo_library` is needed for unassigned library entries. The user reported it applied on 14 September with default `[]`, array constraint and unchanged RLS/grants/revision trigger; this has **not been independently reverified**. Reported applied timestamp `20260913224149` differs from committed `20260913180000`. See [migration review](PHOTO_LIBRARY_MIGRATION_REVIEW.md); do not reapply SQL or rename migration history as a documentation cleanup.

## Photo preservation and save path

**Missing local bytes are never deletion intent.** Empty IndexedDB, unavailable Drive tokens, failed image downloads or pending analysis must retain library entries, page/frame assignments and saved crops. A partially hydrated or empty local project must not delete a nonempty remote asset set.

1. [storage.ts](src/lib/storage.ts) loads local project metadata; [project-sync.ts](src/lib/project-sync.ts) pulls Supabase structure and assignments independently of bytes. Known metadata is retained/unioned where omission is unsafe.
2. [project-photos.ts](src/lib/project-photos.ts) hydrates photos from cache/Drive. Unavailable assets remain represented with their identities and crop metadata. Active/open pages reconcile arriving cloud metadata; late hydration or save acknowledgements must not replace newer edits with stale empty in-memory pages.
3. [layouts-app.tsx](src/components/layouts-app.tsx) coordinates editor state, local autosave and the [sync queue](src/lib/sync-queue.ts). Serialization must preserve known metadata even when a photo cannot render. Editing from a cached preview survives later original hydration.
4. Before any cloud write, `pushProjectToCloud` reads remote assets and validates preservation. A failed preflight stops the save. Assignment/page removal needs explicit, scoped deletion intent; absence from local memory is insufficient. Intent is acknowledged only for the successfully saved operation, so failures/retries cannot silently drop it.
5. Existing asset identities and known Drive references survive replacements, swaps, protection recovery and late acknowledgements. Upload checkpoints are merged by stable photo identity without discarding current edits or cloud references. See [historical root-cause trace](PHOTO_SYNC_FIX.md) and [checkpoint review](UPLOAD_CHECKPOINT_FIX.md).

Removing a frame placement leaves its original accessible in the library. Exact-byte duplicate consolidation produces one library identity while preserving every placement and independent crop; it never deletes Drive originals. Project deletion records a cloud deletion marker and retains original bytes. Session restore/backup import creates new copies rather than overwriting an existing project. Originals must not be evicted by derived-cache quota recovery.

New Drive uploads can carry project/page/frame/blob-key hints where applicable. Existing files need not have those properties; reused files can describe an older placement. Hints cannot recover exact historical order or crops. [Islands recovery](ISLANDS_RECOVERY.md) remains a separate authorized investigation; neither surviving originals nor complete historical mappings have been freshly established by this task.

### Cross-device save limitation

The parent revision gate and a queue within one app do **not** make the project, pages and assets transactional. Separate REST requests can be interrupted or interleaved after revision checks; a pull can see inconsistent children. Detected revision conflicts preserve local edits as a labelled conflicted copy, but that mechanism does not prevent every interleaving. Transactional writes and consistent reads need separate engineering review. Retries or successful deployment are not proof this risk is solved.

## Rendering and editing rules

- Frame rectangles are normalized to the design's reference canvas. Shared geometry resolves gutters/insets; export scales the whole design, including frames, borders, gaps and crops. Do not add spacing twice or resize the saved composition when changing output resolution.
- Built-in portrait panoramas comprise exact five-strip **40:9** and seven-strip **768:115** stacks, plus five/seven-strip borderless variants. Exact stacks use matching frame geometry at 0% photo zoom. Borderless variants deliberately use different frame ratios and crop slightly. All use the existing renderer; no panorama-specific image stretching.
- Photo 0% is cover/fill-frame size. Negative zoom shrinks proportionally and may expose page background. Positive, zero and negative zoom allow both-axis movement inside a fixed clipping frame. Centre photo preserves zoom; Reset restores centred 0%. Gentle snapping respects Snap and can be dragged through.
- Legacy crop position values retain their historical interpretation. Optional free-position centre offsets, expressed in frame dimensions, opt into unrestricted placement and persist through zoom changes. Repeated placements remain independent; missing original bytes must not reset position. Inspect [crop.ts](src/lib/crop.ts) and [types.ts](src/lib/types.ts) before changing this contract.
- The shared drawing path fills exposed frame areas with the page background, including overlaps. Editor, thumbnails, original-based export preview and JPEG export use the same composition geometry; larger exports scale it proportionally.
- Canvas viewport magnification is separate from photo zoom and export settings. **Navigate** owns canvas pan/pinch; **Edit** owns the existing photo/frame interactions. Switching modes retains the view. Pointer/drag distances must account for viewport scale. Viewport state never enters saved compositions or Undo.
- Selection uses a subtle editing-only tint; keyboard focus is distinguishable. Handles, fixed thirds/centre guides and snapping guides remain editing overlays. Clean previews, thumbnails and exports omit them. Selection, browsing and viewport changes alone must not autosave a composition edit.
- Template multi-selection has a clear reference frame, shared/numeric resizing and exact ratio locks. Same width/height adjusts the other dimension when locked. Explicit rows/stacks retain chosen gaps (including zero); outer margins are separate minimum clearances. Constraints clamp/explain rather than distort ratios or change gutters. Unrelated freeform frames stay independent. Every committed edit/continuous gesture is undoable.
- Each project page owns a template snapshot. Saving or deleting a reusable template must not rewrite existing pages, frames or crops. Optional editor metadata remains backwards-compatible.
- **Text tools, released in PR #30:** page/template Text mode adds movable, multiline boxes with Cinzel, Cormorant Garamond or Inter, one style per box. Numeric/slider size, tracking, line spacing, width, opacity, colour/background and alignment use reference canvas units. Shared text layout/drawing preserves wrapping and proportions in editor, thumbnails and larger original-based exports. Bundled fonts must load before exporting text. Text stays above photos; editing adornments never enter output.
- Text is optional `templateSnapshot.textLayers` metadata on pages, preserving legacy snapshots and independent page copies. It needs no project schema change. The additive `templates.text_layers` migration was **applied and read back on 26 September** for reusable templates; old-schema errors on other deployments retain a local unsynced copy rather than drop text. Selection, draft previews and viewport changes do not autosave; completed field/gesture edits are undoable. See [text rules and schema](docs/TEXT_TOOLS.md).

## Library, import and export

The full-screen Project photos gallery has a virtualized list and separate inspection view. Native scrolling owns momentum: remembered offsets are observations, not commands to write `scrollTop` after every scroll. Delayed state echoes, preview hydration and height-only resize must not rewind scrolling. Explicit resets, actual row reflow and first visible-dialog restoration have distinct paths. [photo-library-gallery.tsx](src/components/photo-library-gallery.tsx) and its regressions cover this PR #29 correction.

Local uncropped small previews produce weighted dominant palettes in perceptual colour space, brightness/saturation and source proportions. Suggest arrangements scores colour, crop fit and layout variety using actual frame dimensions. Each photo appears at most once per proposal; unavailable photos remain awaiting analysis, and unplaced photos are disclosed. Preview is nonmutating; **Apply as new project** preserves the existing arrangement/library. This uses no AI/external analysis service.

Import is separate from placement. Native Photos/Files/providers feed a durable intake queue. Optional Google Drive/Photos pickers need independent API/consent/origin configuration and signed-in acceptance; code availability is not proof they work live. Delivered original bytes are retained, although a source provider may have converted them before delivery. Temporary provider URLs are not persisted as originals.

Metadata saving is separate from serial Drive backup. Reserved file IDs are accepted through the revision gate before upload; original, preview and thumbnail transfers checkpoint separately. Resumable journals contain session URLs, not OAuth tokens. Retries reuse IDs/sessions and must not upload an original again after a completed checkpoint. Browser suspension and eviction remain limitations.

Account-scoped gallery/editor previews (up to 640px) and derived cache budgets keep navigation lightweight. Opening/zooming a canvas never eagerly downloads every original. Original detail, export preview and JPEG export use original bytes on demand; missing originals are reported rather than silently substituted with low-resolution previews. Quality warnings assess original size against crop/zoom/final frame pixels and do not prevent export. Export preview follows output settings and has meaningful 100% inspection. Larger JPEGs do not imply a certified colour-managed/CMYK print workflow.

Portable backups disclose missing bytes and restore as a new project. ZIPs remain capped at 256 MiB; streaming/larger packages and persistent version history are proposed work, not shipped guarantees. Older clients can omit optional new metadata or reject newer page limits; refresh all editing devices normally before using new features.

## Source map

| Concern | Entry points |
| --- | --- |
| App flow, Add-page intent, autosave | [layouts-app.tsx](src/components/layouts-app.tsx), [project.ts](src/lib/project.ts) |
| Local cache, hydration, cloud save | [storage.ts](src/lib/storage.ts), [project-photos.ts](src/lib/project-photos.ts), [project-sync.ts](src/lib/project-sync.ts), [sync-queue.ts](src/lib/sync-queue.ts) |
| Library identity, backup, original intake | [project-photo-library.ts](src/lib/project-photo-library.ts), [project-photo-backup.ts](src/lib/project-photo-backup.ts), [photo-import-queue.ts](src/lib/photo-import-queue.ts), [image.ts](src/lib/image.ts) |
| Gallery, inspection, derived caches | [photo-library-gallery.tsx](src/components/photo-library-gallery.tsx), [photo-library-view.ts](src/lib/photo-library-view.ts), [photo-inspection.ts](src/lib/photo-inspection.ts), [photo-preview-cache.ts](src/lib/photo-preview-cache.ts), [photo-cache-storage.ts](src/lib/photo-cache-storage.ts) |
| Templates and coordinated geometry | [templates.ts](src/lib/templates.ts), [template-designer.tsx](src/components/template-designer.tsx), [template-layout.ts](src/lib/template-layout.ts), [custom-templates.ts](src/lib/custom-templates.ts) |
| Crop, frames, viewport, drawing | [crop.ts](src/lib/crop.ts), [page-frames.ts](src/lib/page-frames.ts), [canvas-viewport.ts](src/lib/canvas-viewport.ts), [draw-photo.ts](src/lib/draw-photo.ts), [editor-canvas.tsx](src/components/editor-canvas.tsx), [composition-thumbnail.tsx](src/components/composition-thumbnail.tsx) |
| Text layout, editing, fonts | [text.ts](src/lib/text.ts), [text-layer.tsx](src/components/text-layer.tsx), [text-tools.tsx](src/components/text-tools.tsx), [text-thumbnail.tsx](src/components/text-thumbnail.tsx), [font sources](public/fonts/README.md), [text handoff](docs/TEXT_TOOLS.md) |
| Export and recovery copies | [export.ts](src/lib/export.ts), [export-settings.ts](src/lib/export-settings.ts), [project-backup.ts](src/lib/project-backup.ts), [project-history.ts](src/lib/project-history.ts) |
| Suggestions and analysis | [arrangements.ts](src/lib/arrangements.ts), [arrangement.worker.ts](src/lib/arrangement.worker.ts), [photo-palette.ts](src/lib/photo-palette.ts), [photo-analysis-client.ts](src/lib/photo-analysis-client.ts) |
| External services | [supabase-client.ts](src/lib/supabase-client.ts), [google-drive.ts](src/lib/google-drive.ts), [drive-resumable.ts](src/lib/drive-resumable.ts), [google-photo-import.ts](src/lib/google-photo-import.ts), [.env.example](.env.example) |

## Verification and unknowns

[START_HERE](START_HERE.md) records the verified PR #30 application release. [VERIFICATION](VERIFICATION.md) separates the historical 512-test release, [533-test text implementation checks](docs/evidence/2026-09-26-text-tools.md) and [production/migration checks](docs/evidence/2026-09-26-text-release.md). [The checklist](docs/PROJECT_PHOTOS_RELEASE_CHECKLIST.md) covers physical iPad, live two-device sync, provider imports, resume and share sheets; [text acceptance](docs/TEXT_TOOLS.md#outstanding-acceptance) adds the new controls. Desktop CSS viewport checks and fake cloud transports do not certify these.

The user's reported device is iPad Air 11-inch M2, model MUWG3NF/A, iPadOS 26.5.2; confirm the OS during physical acceptance. Supabase schema/RLS/grants, auth/SMTP/redirect settings, Google origins/consent/APIs and environment/secret hygiene are unverified in this task. Historical configuration observations stay in the archive. Never commit secret values or infer a service audit from a successful Vercel build.

## Handoff maintenance

1. Start at START_HERE, inspect Git status and CURRENT_TASK, then reconcile them with the current user request. Preserve unrelated changes; do not automatically resume an old task against new instructions.
2. Keep CURRENT_TASK short: active scope, completed work, remaining work/blockers. Clear active notes when the authorized task is complete; durable results belong in dated evidence/history.
3. Update current sections in place when behaviour or release state changes. Keep one canonical current status in START_HERE and link to it. Historical “not deployed” snapshots remain explicitly dated history.
4. Record verification date, source commit, PR/deployment links and what was actually checked. Separate local tests, public smoke checks, authenticated release inspection and real data/device acceptance.
5. Keep technical detail in the repository. The four [Drive summaries](README.md#current-release-and-documentation--20-september-2026) should link back and agree; preserve their history and sharing. Commit small sanitized evidence summaries, not private photos, credentials or machine-only paths.
6. Documentation, checklist steps and old approvals are not authorization to migrate, repair live data, change services or deploy. A branch push can trigger an automatic Vercel Preview; respect the current publication/deployment scope.
