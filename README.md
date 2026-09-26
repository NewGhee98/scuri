# Scuri

**New coding session: [START_HERE.md](START_HERE.md)** is the canonical current-status summary and reading order. This README covers usage and setup.

Scuri is a mobile-first photo-template editor for Instagram posts and stories. It is a focused alternative to the layout workflow in apps such as Unfold: start a project, build and reorder several template pages, design reusable layouts, adjust every crop and export the completed set.

All image selection, composition and export happens in the browser. Signing in makes both your custom templates and your projects (layouts, crops, page order and photo metadata) follow you across devices via Supabase. Google Drive, connected separately, stores the untouched full-resolution originals so a project opened on a new device does not depend on that device having ever seen the photos before.

## What works

The features below include **movable page text and reusable template text**, with Cinzel, Cormorant Garamond and Inter, colour, exact size/spacing and shared export rendering. Text tools shipped through PR #30; see [text tools](docs/TEXT_TOOLS.md).

- Instagram portrait posts at **1080 × 1350 (4:5)**.
- Instagram square posts at **1080 × 1080 (1:1)**.
- Instagram Stories at **1080 × 1920 (9:16)**.
- Data-defined utility and editorial templates for each format, plus four portrait panorama layouts.
- A project library with up to 250 unique photos and 30 ordered pages per project.
- Autosaved page drafts, page duplication and explicit page readiness.
- Touch drag reordering with accessible Earlier and Later controls.
- Single or multi-photo selection from Apple Photos, iOS Files and desktop file pickers.
- Explicit photo selection and Use confirmation for the tapped tile, followed by drag-to-swap tile rearranging.
- Fixed clipping frames with independent drag, pinch, mouse-wheel and slider zoom.
- A 0% fill-frame zoom baseline, exact percentage input and negative zoom. Photos can move on both axes at every zoom; Centre photo preserves zoom and Reset restores the centred 0% baseline.
- A project photo library independent of frame placement, with local palette analysis and up to three arrangement suggestions using existing layouts.
- Replace, reset and remove controls for each photograph.
- Adjustable background colour, borders and gutters.
- High-quality, exact-size single-page or batch JPEG export and Web Share support.
- Multi-image Apple share-sheet handoff plus a ZIP download fallback for Files.
- Local recovery of every project after navigation or refresh.
- Installable PWA shell with standalone display, offline caching and iOS metadata.
- A reusable Templates library with built-in and personal layouts.
- A template designer with overlapping frames, touch multi-selection, shared resizing, exact pixel sizing, ratio presets/locks, fixed-gap rows/stacks, separate minimum margins, snapping, layers and Undo/Redo.
- Passwordless email sign-in; cloud-synchronised templates and project state (layouts, crops, page order, photo metadata) protected by per-user row-level security.
- Optional Google Drive backup of full-resolution project photos, with lazy download on other devices.

## Privacy and storage architecture

Scuri splits storage across three layers, matched to what each is good at:

- **Supabase = source of truth for project state.** Project names, page order, template/layout identifiers, crop/zoom/positioning state, asset metadata and Google Drive file references live in Postgres, protected by owner-only row-level security, with server-generated timestamps and a revision counter used for optimistic concurrency (see `supabase/migrations/`). Custom template geometry syncs the same way and remains a separate table/feature.
- **Google Drive = high-resolution file warehouse.** Untouched full-resolution originals and optional saved exports live in a private `Scuri` folder in the signed-in user's own Drive, using the narrow `drive.file` scope. Scuri never uses a Drive-side manifest or folder structure as the authoritative project database - Drive can be disconnected or unavailable and project metadata remains visible.
- **Browser storage = local/offline cache.** `localStorage` holds the project library and lightweight settings; IndexedDB caches image blobs for fast, offline-capable editing. Storage failures remain visible, with retry and portable backup actions. Successful local saves can sync in the background once signed in and online; clearing browser data can still lose edits or originals that have not been backed up.
- Temporary object URLs for editing previews and generated exports, revoked when no longer needed.
- The Cache API, through the service worker, for the application shell only.

Deleting a signed-in project stops its queued sync, waits for an active save and records a Supabase deletion marker before removing it from the local library. Drive files and cached originals are retained; up to ten deleted projects can be restored as new copies during the same session. Sign in with the same account on another device to load its project metadata, then connect Google Drive to fetch originals lazily.

### Project workflow

1. Open the Projects overview, create a project and choose Portrait, Square or Story. Every page in that project uses the chosen output format.
2. Choose a layout and fill the page. Tap a tile, inspect a library photo and confirm Use; importing files adds them to the library without changing a placement. Use rearrange mode to drag photos between tiles. Changes autosave while editing.
3. Save the page, then add, duplicate, edit, delete or reorder pages from its project page.
4. Export one ready page, selected ready pages or every completed page in order; drafts are skipped and unselected alternatives remain saved.
5. On iPhone or iPad, use **Save all to Photos / Share** and choose the multi-image save action in Apple’s share sheet. If file sharing is unavailable, use **Download ZIP to Files**.

**Plan an arrangement:** use **Add photos to library** on the project page, wait for local analysis, then select **Suggest arrangements**. Review Colour harmony, Best fit and Balanced mix when meaningfully different options are available. Each proposal lists any unplaced photos. **Apply as new project** preserves the current project and every library original. In the editor, a library photo can also be placed with **Use in selected frame**. Removing a frame assignment leaves the original in the library.

**Position a photo:** select a photo and adjust its zoom slider or type an exact percentage. 0% is the fill-frame baseline; negative zoom shrinks the image in proportion. Drag at any zoom to position it, including when it exactly fits or is smaller than the frame. The frame clips the photo and exposed areas use the page background. Centre photo preserves zoom; Reset centres and restores 0%. Legacy crops render unchanged until an explicit edit. Zoom changes preserve deliberately chosen offsets; repeated placements retain independent crops.

**Inspect the design:** editor and template-designer Navigate mode pans/zooms the viewport independently of photo crop zoom, export resolution, saved geometry and Undo. Switch back to Edit to manipulate photos or frames. Selected frames use a subtle editing-only tint; optional fixed thirds/centre guides and Snap controls assist composition. Export preview uses originals, follows the chosen output settings and offers 100% detail. Advisory quality warnings do not block export. Larger exports scale the entire saved design proportionally.

**Build precise templates:** Select multiple, choose a matching Reference frame, apply exact ratio presets (including 40:9 and 768:115), then use Same width/height and Horizontal row/Vertical stack. Keep gaps consistent maintains the chosen gap while resizing; margins are separate minimum clearances. Centre group does not stretch frames to fill whitespace. Ratio locks and bounds are respected, and each committed action/gesture can be undone. Existing pages keep their own template snapshots when a reusable template changes. The built-in portrait picker includes exact five-strip Standard Pano and seven-strip Ultra Pano layouts plus their deliberately cropped borderless alternatives.

**Add text:** choose Text → Add text in a page or template. Type a title/caption, select its font, colour, size, letter/line spacing and alignment, then drag the box into position. Leave a text field to commit its draft; completed edits and moves support Undo. Text boxes have independent styles and remain proportional at larger exports. Navigate mode still controls the whole canvas. Existing photo configurations and text-free pages are unchanged.

## Current release and documentation — 26 September 2026

The text application release was verified on **26 September 2026, 09:47–09:50 UTC** as [PR #30](https://github.com/NewGhee98/scuri/pull/30), source [`5446dd3`](https://github.com/NewGhee98/scuri/commit/5446dd3706ef2b206d141c9ef06dfa8bc2e1689f), with [Vercel Ready / Production / Current at verification](https://vercel.com/nugee/scuri/8KQocDzx1muqMTuVCzoJVkGWthk6) serving [scuri.vercel.app](https://scuri.vercel.app). Prior photo, template, viewport and scrolling changes remain included. Publishing this release record changes documentation only.

[START_HERE.md](START_HERE.md) owns current status, nondeployed work and priorities. [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) owns implementation and preservation rules; [CURRENT_TASK.md](CURRENT_TASK.md) records active work. [VERIFICATION.md](VERIFICATION.md), the [portable release evidence](docs/evidence/2026-09-20-production.md) and [release checklist](docs/PROJECT_PHOTOS_RELEASE_CHECKLIST.md) distinguish recorded results from fresh checks and outstanding acceptance. Previous release decisions remain in [dated history](docs/history/PROJECT_CONTEXT_THROUGH_2026-09-20.md).

The additive `templates.text_layers` migration was applied and verified for this release; page text uses existing snapshot JSON. Existing template content, projects/pages/assets and template RLS/grants were preserved. See [production and migration evidence](docs/evidence/2026-09-26-text-release.md). Drive summaries were not refreshed for this text release; their last recorded update is the 20 September documentation audit.

Drive documentation: [Product Overview](https://docs.google.com/document/d/1R1yIt6UgGGTSJAnbp1wzg6ZZTLNyseoxrXUeJtdug3s/edit), [Status & Roadmap](https://docs.google.com/document/d/1NnVgZOhONDBdp9_tZMU2mngKThWCbRVT6K-xNOqbi2g/edit), [Upcoming Features](https://docs.google.com/document/d/1MoA7dIhztuWHU3lsp4ljRJa9EU6OgCBAumSu6KLH_HA/edit), and [Change Timeline](https://docs.google.com/document/d/1EzYIQcQbDIdQ-Rzzr38FwE7vnDpavuda2tsc5_JuuBw/edit). These are product/status summaries; the repository owns technical handoff detail. Sharing remains private. The documentation audit records their read-back status.

## Local development

Use a Node.js runtime compatible with the locked dependencies. [package.json](package.json) defines scripts and direct dependencies; [package-lock.json](package-lock.json) records exact resolved versions and engine requirements. Avoid independent version lists in handoff documents.

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Copy `.env.example` to `.env.local` and add the two Supabase public values if you want to test account and cross-device template sync.

## Cloud setup

Reference procedure for a separately authorized setup task. Existing live schema, RLS/grants, auth, Google API/consent/origin settings and environment values were **not reverified by the documentation audit**. Inspect before changing anything; this guide does not authorize configuration changes or migrations. Expected public variable names are in [.env.example](.env.example).

### Supabase (templates + projects)

1. Create or connect a Supabase project through the Vercel Marketplace.
2. The existing schema uses `20260811172718_create_templates.sql` and `20260811172858_restrict_templates_to_authenticated.sql` for templates, then `20260831120000_create_projects.sql` for projects/pages/assets. Independent, unassigned cloud photos require `projects.photo_library`. On 14 September the user relayed a live connector confirmation that the column and its array constraint were applied under migration `20260913224149_add_project_photo_library`; this session did not independently query Supabase. The repository still contains the earlier `20260913180000_add_project_photo_library.sql` filename. Do not run it again merely to reconcile names. See [PHOTO_LIBRARY_MIGRATION_REVIEW.md](PHOTO_LIBRARY_MIGRATION_REVIEW.md) for the additive design. This library rebuild requires no new migration.
3. Add these variables to Vercel Preview and Production:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

4. In Supabase Auth URL Configuration, set the production Scuri address as the Site URL and add the Vercel preview wildcard as an allowed redirect URL.
5. Email sign-in is enough for a private test account. Configure custom SMTP before opening registration to general users.

The existing tables enable row-level security. Authenticated users can only read and mutate rows whose `owner_id` matches their Supabase user ID. The photo library column uses the existing projects policies and revision gate; it introduces no policy changes. Templates and projects are separate tables/features that share one sign-in.

### Google Drive (full-resolution photo backup)

Google Drive is optional - Scuri works and projects still sync (metadata only) without it. Connecting it lets full-resolution originals follow a project to another device.

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project, then enable the **Google Drive API** (APIs & Services → Library).
2. Configure the **OAuth consent screen** (APIs & Services → OAuth consent screen). Add the scope `https://www.googleapis.com/auth/drive.file`. While the app is in Testing mode, add every Google account you'll sign in with as a test user.
3. Create credentials → **OAuth client ID** → Application type **Web application**.
4. Under **Authorized JavaScript origins**, add every origin Scuri is actually served from, for example:
   - `http://localhost:3000` (local development)
   - `https://scuri.vercel.app` (production)

   Google does **not** accept wildcards here, unlike Supabase's redirect allow-list, so per-branch Vercel Preview URLs cannot be pre-authorized. Add a specific preview origin only if you rely on a stable one; otherwise Google Drive connect will not work on ephemeral Preview deployments - Supabase project sync still will.
5. Leave **Authorized redirect URIs** empty. Scuri uses Google Identity Services' token client (a popup-based flow keyed to the JavaScript origin), not a redirect-based OAuth flow, so no redirect URI is used.
6. Copy the generated **Client ID** (ends in `.apps.googleusercontent.com`) into:

```bash
NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

Add it to `.env.local` for development and to Vercel Production (and, if you added a stable Preview origin in step 4, Preview).

## Quality checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The PR #29 release record on 20 September reports **512 tests across 39 files passed**, including gallery scroll ownership/restoration, coordinated template geometry and Undo, viewport navigation, legacy/free crops, proportional exports, library/backup persistence, fresh-device safety and explicit deletion. Typecheck, ESLint and the production build were also recorded as passing. These application checks were not rerun during the documentation-only audit. See [VERIFICATION.md](VERIFICATION.md) for dated checks and limits; automated tests do not certify physical iPad or live cloud behaviour.

## Production

```bash
npm run build
npm start
```

The app requires a secure HTTPS origin for production PWA and Web Share behaviour. Localhost is treated as secure during development.

## Deploy to Vercel

For a separately authorized release. Git integration can create Preview deployments for branch pushes as well as Production deployments for main; a documentation-only PR is not automatically exempt. Check the integration before publishing when deployment is forbidden.

1. Import the GitHub repository into Vercel.
2. Keep the detected **Next.js** framework preset and default build settings.
3. Deploy. Local editing works without environment variables; cross-device project and template metadata require Supabase, and original-photo backup/retrieval requires Google Drive configuration.
4. Every subsequent push to the production branch will create a new deployment.

The application uses no Vercel-specific runtime features and can be hosted on any platform that supports a standard Next.js production build.

## Install on iPhone or iPad

1. Deploy the application to an HTTPS address.
2. Open that address in **Safari**.
3. Tap Safari’s **Share** button.
4. Choose **Add to Home Screen**. If it is hidden, use **Edit Actions** to add it.
5. Leave **Open as Web App** enabled and tap **Add**.

Repeat this on each device, then connect the same account (and, for full-resolution photos, the same Google Drive account) to see your projects there too.

## Architecture

- `src/config/product.ts` is the single place to change the temporary product name and description.
- `src/lib/formats.ts` defines output formats independently of the interface.
- `src/lib/templates.ts` contains the built-in data-driven template library.
- `src/lib/custom-templates.ts` owns local template caching, Supabase authentication and cloud synchronisation.
- `src/lib/crop.ts` owns shared cover-fit, photo zoom, legacy-crop compatibility and free-position maths.
- `src/lib/image.ts` validates, decodes and downscales photographs for responsive editing.
- `src/lib/photo-sources.ts` defines photo source handling; `src/lib/google-photo-import.ts` implements the optional direct Google picker integrations, subject to external configuration.
- `src/lib/storage.ts` stores the project library metadata and local image blobs (the local/offline cache).
- `src/lib/supabase-client.ts` is the single shared Supabase client/auth session used by both `custom-templates.ts` and `project-sync.ts`.
- `src/lib/project-sync.ts` owns Supabase project/page/asset persistence: pulling and pushing a project, the revision-based optimistic-concurrency push, the safe conflict policy, the cloud/local merge policy and derived sync status.
- `src/lib/google-drive.ts` owns Google Drive OAuth and the private per-project folder tree for full-resolution originals, previews and exports - a file warehouse only, not a source of truth.
- `src/lib/project.ts` owns page readiness, page limits, multi-photo fill order and reorder logic.
- `src/lib/export.ts` redraws the composition from original image blobs at the exact output dimensions.
- `src/components/editor-canvas.tsx` handles high-DPI rendering and touch, pointer, wheel and keyboard input.
- `src/components/template-designer.tsx` and `src/lib/template-layout.ts` provide the bounds-aware freeform/arranged template editor, exact sizing and optional editing metadata.
- `src/components/composition-thumbnail.tsx` renders live page thumbnails without uploading or flattening the project.
- `src/components/project-page-card.tsx` provides page actions and touch reordering.
- `src/components/project-library-card.tsx` provides project previews, metadata and library actions.
- `src/components/layouts-app.tsx` owns the project library, project, format, template, editor and export flows.

The photo editor uses the browser’s maintained Canvas 2D API directly. The template designer manipulates only lightweight normalised frame geometry; project pages store a layout snapshot so later template edits or deletion cannot change existing work.

## Add another template

Templates use normalised coordinates, where `0` is the top or left edge and `1` is the bottom or right edge. Add a new layout object to the `layouts` array in `src/lib/templates.ts`:

```ts
{
  slug: "example-trio",
  name: "Example trio",
  defaultGutter: 24,
  frames: [
    frame("photo-1", 0, 0, 1, 0.6),
    frame("photo-2", 0, 0.6, 0.5, 0.4),
    frame("photo-3", 0.5, 0.6, 0.5, 0.4),
  ],
}
```

That single object is expanded for all current formats. The same editor, thumbnail renderer, persistence and exporter work without another React component. Run the tests after adding a template; validation catches duplicate IDs and frames outside the canvas.

## Known limitations

- Frames are rectangular and non-rotated, but may overlap and use rounded corners.
- A project's Supabase row and its pages/assets rows are written as separate requests. An interruption can leave partially saved content, and two devices can interleave child writes after the revision check. The client queue serializes saves within one running app only. A transactional cloud write and a consistent read are still required; automatic retries do not guarantee recovery from every interleaving.
- When the revision check detects a concurrent edit, local edits are preserved as a separate, clearly labelled "(conflicted copy)" project. There is no field-level merge, and this check does not cover every interleaving described above.
- A project deleted on a device that is offline or signed out is *not* queued for cloud deletion; deletion there is blocked (with a message) until that device can reach Supabase, rather than silently deleting locally while orphaning the cloud copy.
- Google Drive's "Authorized JavaScript origins" do not support wildcards, so Drive connect only works on origins you explicitly authorize (see Cloud setup above) - typically production and localhost, not every ephemeral Vercel Preview URL. Supabase project sync is unaffected.
- If a project is deleted on another device while a signed-out/offline device still holds unsynced edits to it, reconnecting recreates it as a new project (suffixed "(recovered)") rather than restoring the exact original id.
- Use **Download project backup** to save a portable `.scuri.zip` file before clearing browser data. Missing originals are disclosed; restore the needed originals to this device before making a complete portable backup. **Restore backup** previews the package and restores it as a new project. Packages are limited to 256 MiB.
- HEIC availability depends on whether the browser can decode the selected file; the explicit supported types are JPEG, PNG and WebP.
- iOS memory pressure can still affect unusually large source files. Editing uses a downscaled preview, while export decodes originals one frame at a time.
- Browser share/download wording varies by iOS version. The generated JPEG preview remains available if the share sheet is unavailable.
- The local synthetic browser check is `scripts/qa-photo-library.mjs`; physical iPad, OS file providers and signed-in Google pickers still need the release acceptance checks in `docs/PROJECT_PHOTOS_RELEASE_CHECKLIST.md`.

## Short roadmap

1. Run the cross-device acceptance test in [VERIFICATION.md](VERIFICATION.md#outstanding-acceptance) and the [release checklist](docs/PROJECT_PHOTOS_RELEASE_CHECKLIST.md) on physical iPad and laptop hardware (this needs a real Supabase session and Google account - not something that can be verified from an automated build).
2. Design and review a transactional project/pages/assets save and consistent read to address the known cross-device race above.
3. Extend portable backups with larger streaming packages and persistent project history after the transactional sync work.
4. Consider landscape formats through the existing format definition system.
5. Inspect the Google Picker API/origin configuration and complete signed-in source-import acceptance before advertising direct Google imports as verified. Any necessary service changes need separate authorization.

## Project photos

The project library admits up to **250 unique photos**, independently of **30 saved pages**. Repeat placements share originals and retain independent crops. Older libraries above the limit remain visible. Browse in the full-screen library, filter/search filenames, inspect a complete photo, then explicitly choose **Use this photo** for the frame that opened the picker. Browsing and inspection never edit a crop. Export selected pages to keep alternative layouts in the project.

Device Photos/Files and supported folders use the native chooser, including installed Files providers. JPEG, PNG and WebP remain supported, up to 80 MiB per delivered file. Exact-byte duplicates reuse the existing library identity. Visually similar files or identical filenames are not enough. Older files without verified fingerprints may require **Find duplicates**. Original files in Drive are never deleted by library consolidation.

Direct Google Drive import uses Google Picker with the existing `drive.file` OAuth permission. Set `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY` and `NEXT_PUBLIC_GOOGLE_PICKER_APP_ID` (the numeric Cloud project number), enable the Google Picker and Drive APIs, and authorise the exact app origins. Google Photos import uses the separate Photos Picker API and `photospicker.mediaitems.readonly` scope; optionally set a separate `NEXT_PUBLIC_GOOGLE_PHOTOS_CLIENT_ID`. Configure consent and any required public-app verification. An app deployment alone does not enable these services. See the [Drive Picker guide](https://developers.google.com/workspace/drive/picker/guides/overview) and [Photos setup guide](https://developers.google.com/photos/overview/configure-your-app). No private API keys or refresh tokens belong in public environment variables.

Photos selection opens Google's picker, then downloads the selected full media into Scuri's normal intake queue. It never uses a provider thumbnail as an original or changes source files. Delivered bytes are retained unchanged; a provider may itself convert media or remove metadata. Google Photos download URLs are temporary and are not saved in projects. Expired/denied downloads remain retryable without losing completed imports. See [Google's download behaviour](https://developers.google.com/photos/picker/guides/media-items).

Metadata saving runs independently of serial Drive backup. Each original/preview/thumbnail has a reserved Drive ID accepted through the Supabase revision gate before upload. Local resumable journals contain session URLs but no OAuth tokens. Retries query the existing ID/session, never overwrite an existing original, and checkpoint each completed rendition separately. Local quota recovery evicts only derived caches; intake pauses if an original still cannot be durably stored. Keep the app open while uploading; iPadOS suspension and browser storage eviction remain limitations.

Gallery/editor previews are disposable account-scoped caches, up to 640px; original detail and JPEG export load originals on demand. The library never downloads all originals just to populate its gallery. Preview rendition upgrades retain in-use URLs, with compressed and estimated decoded memory budgets. The separate derived IndexedDB database is additive; no SQL migration or original-store rewrite is needed. Keep Scuri updated on all devices: old clients may discard optional new library fields or reject 30-page portable backups. Portable ZIP backups retain the **256 MiB limit**, with an early size check.
