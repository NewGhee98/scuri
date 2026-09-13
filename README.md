# Scuri

Scuri is a mobile-first photo-template editor for Instagram posts and stories. It is a focused alternative to the layout workflow in apps such as Unfold: start a project, build and reorder several template pages, design reusable layouts, adjust every crop and export the completed set.

All image selection, composition and export happens in the browser. Signing in makes both your custom templates and your projects (layouts, crops, page order and photo metadata) follow you across devices via Supabase. Google Drive, connected separately, stores the untouched full-resolution originals so a project opened on a new device does not depend on that device having ever seen the photos before.

## What works

- Instagram portrait posts at **1080 × 1350 (4:5)**.
- Instagram square posts at **1080 × 1080 (1:1)**.
- Instagram Stories at **1080 × 1920 (9:16)**.
- Eight data-defined templates for each format, including one-, two-, three- and four-photo layouts.
- A local project library, with up to 20 ordered pages per project.
- Autosaved page drafts, page duplication and explicit page readiness.
- Touch drag reordering with accessible Earlier and Later controls.
- Single or multi-photo selection from Apple Photos, iOS Files and desktop file pickers.
- Automatic multi-photo filling from the tapped tile, followed by drag-to-swap tile rearranging.
- Fixed clipping frames with independent drag, pinch, mouse-wheel and slider zoom.
- A 0% fill-frame zoom baseline; negative zoom reveals the whole image and surrounding page background while keeping it centred. Positive zoom retains constrained panning.
- A project photo library independent of frame placement, with local palette analysis and up to three arrangement suggestions using existing layouts.
- Replace, reset and remove controls for each photograph.
- Adjustable background colour, borders and gutters.
- High-quality, exact-size single-page or batch JPEG export and Web Share support.
- Multi-image Apple share-sheet handoff plus a ZIP download fallback for Files.
- Local recovery of every project after navigation or refresh.
- Installable PWA shell with standalone display, offline caching and iOS metadata.
- A reusable Templates library with built-in and personal layouts.
- A constrained freeform template designer with overlapping frames, resize handles, snapping, alignment, distribution, layers, corner presets, backgrounds, undo and redo.
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
2. Choose a layout and fill the page. Select one photo for one tile, or select several to autofill the layout; use rearrange mode to drag photos between tiles. Changes autosave while editing.
3. Save the page, then add, duplicate, edit, delete or reorder pages from its project page.
4. Export one ready page or use **Export all** to export every completed page in order; drafts are skipped.
5. On iPhone or iPad, use **Save all to Photos / Share** and choose the multi-image save action in Apple’s share sheet. If file sharing is unavailable, use **Download ZIP to Files**.

**Plan an arrangement:** use **Add photos to library** on the project page, wait for local analysis, then select **Suggest arrangements**. Review Colour harmony, Best fit and Balanced mix when meaningfully different options are available. Each proposal lists any unplaced photos. **Apply as new project** preserves the current project and every library original. In the editor, a library photo can also be placed with **Use in selected frame**. Removing a frame assignment leaves the original in the library.

**Zoom out:** select a photo and move its zoom slider below 0%. The frame, border and gutter remain fixed; the original shrinks in proportion and is centred over the page background. The slider extends beyond the size needed to show the entire image. Existing saved fill/zoom crops retain their appearance. See [ZOOM_ARRANGEMENTS_RELEASE.md](ZOOM_ARRANGEMENTS_RELEASE.md) for behaviour, compatibility and verification limits.

## Local development

Requires Node.js 20.9 or newer. Node.js 22 LTS is recommended.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Copy `.env.example` to `.env.local` and add the two Supabase public values if you want to test account and cross-device template sync.

## Cloud setup

### Supabase (templates + projects)

1. Create or connect a Supabase project through the Vercel Marketplace.
2. The existing schema uses `20260811172718_create_templates.sql` and `20260811172858_restrict_templates_to_authenticated.sql` for templates, then `20260831120000_create_projects.sql` for projects/pages/assets. The new `20260913180000_add_project_photo_library.sql` is **prepared for review only**, not executed. Review [PHOTO_LIBRARY_MIGRATION_REVIEW.md](PHOTO_LIBRARY_MIGRATION_REVIEW.md) before installing it in an authorized environment. Independent, unassigned cloud photos require this additive column; the client keeps them locally and reports a setup error if it is absent.
3. Add these variables to Vercel Preview and Production:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

4. In Supabase Auth URL Configuration, set the production Scuri address as the Site URL and add the Vercel preview wildcard as an allowed redirect URL.
5. Email sign-in is enough for a private test account. Configure custom SMTP before opening registration to general users.

The existing tables enable row-level security. Authenticated users can only read and mutate rows whose `owner_id` matches their Supabase user ID. The proposed photo library column shares the existing projects policies and revision gate; it introduces no policy changes. Templates and projects are separate tables/features that happen to share one sign-in.

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

The 136 offline tests include crop/rendering and below-baseline save/restore, palette grouping, panorama/template matching, distinct proposals, complete placement accounting, unavailable photos, safe application as a copy, optional-column compatibility, library/backup persistence, and the existing fresh-device and explicit-deletion safety regressions. See [VERIFICATION.md](VERIFICATION.md) for the checks and their limits.

## Production

```bash
npm run build
npm start
```

The app requires a secure HTTPS origin for production PWA and Web Share behaviour. Localhost is treated as secure during development.

## Deploy to Vercel

1. Import the GitHub repository into Vercel.
2. Keep the detected **Next.js** framework preset and default build settings.
3. Deploy. Projects work without environment variables; cross-device templates require the Supabase variables above.
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
- `src/lib/crop.ts` owns pure scaling, cover-fit, zoom and movement-constraint maths.
- `src/lib/image.ts` validates, decodes and downscales photographs for responsive editing.
- `src/lib/photo-sources.ts` defines the current local picker and the extension point for a later Google Photos source.
- `src/lib/storage.ts` stores the project library metadata and local image blobs (the local/offline cache).
- `src/lib/supabase-client.ts` is the single shared Supabase client/auth session used by both `custom-templates.ts` and `project-sync.ts`.
- `src/lib/project-sync.ts` owns Supabase project/page/asset persistence: pulling and pushing a project, the revision-based optimistic-concurrency push, the safe conflict policy, the cloud/local merge policy and derived sync status.
- `src/lib/google-drive.ts` owns Google Drive OAuth and the private per-project folder tree for full-resolution originals, previews and exports - a file warehouse only, not a source of truth.
- `src/lib/project.ts` owns page readiness, page limits, multi-photo fill order and reorder logic.
- `src/lib/export.ts` redraws the composition from original image blobs at the exact output dimensions.
- `src/components/editor-canvas.tsx` handles high-DPI rendering and touch, pointer, wheel and keyboard input.
- `src/components/template-designer.tsx` provides the constrained freeform layout editor.
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
- Use **Download project backup** to save a portable `.scuri.zip` file before clearing browser data. Missing originals are disclosed, so wait for photos to load for a complete backup. **Restore backup** previews the package and restores it as a new project. Packages are limited to 256 MB.
- HEIC availability depends on whether the browser can decode the selected file; the explicit supported types are JPEG, PNG and WebP.
- iOS memory pressure can still affect unusually large source files. Editing uses a downscaled preview, while export decodes originals one frame at a time.
- Browser share/download wording varies by iOS version. The generated JPEG preview remains available if the share sheet is unavailable.
- Automated browser E2E coverage is not included yet; the important non-visual logic (including project sync/conflict/merge behaviour) has unit coverage.

## Short roadmap

1. Run the full cross-device acceptance test in `CLAUDE_START_HERE.md` on physical iPad and laptop hardware (this needs a real Supabase session and Google account - not something that can be verified from an automated build).
2. Design and review a transactional project/pages/assets save and consistent read to address the known cross-device race above.
3. Extend portable backups with larger streaming packages and persistent project history after the transactional sync work.
4. Consider landscape formats through the existing format definition system.
5. Consider an opt-in Google Photos source only after the local workflow is solid.
