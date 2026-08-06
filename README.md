# Layouts

Layouts is a mobile-first, private photo-template editor for Instagram posts and stories. It is a focused alternative to the layout workflow in apps such as Unfold: start a project, build and reorder several template pages, adjust every crop and export the completed set.

All image selection, composition and export happens in the browser. There is no account, backend, database service, analytics or photo upload.

## What works

- Instagram portrait posts at **1080 × 1350 (4:5)**.
- Instagram Stories at **1080 × 1920 (9:16)**.
- Eight data-defined templates for each format, including one-, two-, three- and four-photo layouts.
- Local multi-page projects with up to 20 ordered pages.
- Autosaved page drafts, page duplication and explicit page readiness.
- Touch drag reordering with accessible Earlier and Later controls.
- Local selection from Apple Photos, iOS Files and desktop file pickers.
- Fixed clipping frames with independent drag, pinch, mouse-wheel and slider zoom.
- Cover fitting and constrained movement, so empty space cannot be dragged into a frame.
- Replace, reset and remove controls for each photograph.
- Adjustable background colour, borders and gutters.
- High-quality, exact-size single-page or batch JPEG export and Web Share support.
- Multi-image Apple share-sheet handoff plus a ZIP download fallback for Files.
- Local recovery of the entire active project after navigation or refresh.
- Installable PWA shell with standalone display, offline caching and iOS metadata.

## Privacy and browser storage

Photos never leave the device. The application uses:

- `localStorage` for lightweight project settings, page order, crop positions and template choices.
- IndexedDB for the local image blobs needed to recover every project page after a refresh.
- Temporary object URLs for downscaled editing previews and generated exports. These are revoked when replaced or no longer needed.
- The Cache API, through the service worker, for the application shell—not for user photographs.

Use **Start new** to clear the active project, all its pages and its stored photo blobs. The app automatically migrates a previously saved single composition into page 1 of a multi-page project. Browser storage remains specific to the browser and device; an iPad project does not synchronise to an iPhone.

### Project workflow

1. Choose Post or Story. Every page in a project uses that output format.
2. Choose a layout and fill the page. Changes autosave while editing.
3. Save the page, then add, duplicate, edit, delete or reorder pages from the project overview.
4. Export one ready page or export the complete ordered project.
5. On iPhone or iPad, use **Save all to Photos / Share** and choose the multi-image save action in Apple’s share sheet. If file sharing is unavailable, use **Download ZIP to Files**.

## Local development

Requires Node.js 20.9 or newer. Node.js 22 LTS is recommended.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Quality checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The unit tests cover format selection, export dimensions, template validation, normalised canvas scaling, cover-crop calculations, image-position constraints, zoom limits, page readiness, reordering and migration from the previous single-page storage format.

## Production

```bash
npm run build
npm start
```

The app requires a secure HTTPS origin for production PWA and Web Share behaviour. Localhost is treated as secure during development.

## Deploy to Vercel

1. Import the GitHub repository into Vercel.
2. Keep the detected **Next.js** framework preset and default build settings.
3. Deploy. No environment variables or paid services are required.
4. Every subsequent push to the production branch will create a new deployment.

The application uses no Vercel-specific runtime features and can be hosted on any platform that supports a standard Next.js production build.

## Install on iPhone or iPad

1. Deploy the application to an HTTPS address.
2. Open that address in **Safari**.
3. Tap Safari’s **Share** button.
4. Choose **Add to Home Screen**. If it is hidden, use **Edit Actions** to add it.
5. Leave **Open as Web App** enabled and tap **Add**.

Repeat this on each device. The Home Screen icon launches Layouts in standalone mode without normal Safari tabs or the address bar.

## Architecture

- `src/config/product.ts` is the single place to change the temporary product name and description.
- `src/lib/formats.ts` defines output formats independently of the interface.
- `src/lib/templates.ts` contains the data-driven template library.
- `src/lib/crop.ts` owns pure scaling, cover-fit, zoom and movement-constraint maths.
- `src/lib/image.ts` validates, decodes and downscales photographs for responsive editing.
- `src/lib/photo-sources.ts` defines the current local picker and the extension point for a later Google Photos source.
- `src/lib/storage.ts` stores project metadata and local image blobs.
- `src/lib/project.ts` owns page readiness, page limits and reorder logic.
- `src/lib/export.ts` redraws the composition from original image blobs at the exact output dimensions.
- `src/components/editor-canvas.tsx` handles high-DPI rendering and touch, pointer, wheel and keyboard input.
- `src/components/composition-thumbnail.tsx` renders live page thumbnails without uploading or flattening the project.
- `src/components/project-page-card.tsx` provides page actions and touch reordering.
- `src/components/layouts-app.tsx` owns the project, format, template, editor and export flows.

The editor uses the browser’s maintained Canvas 2D API directly. That keeps the drawing/export model small, avoids server rendering of image data and prevents template frames from becoming draggable objects.

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

That single object is expanded for both current formats. The same editor, thumbnail renderer, persistence and exporter work without another React component. Run the tests after adding a template; validation catches duplicate IDs and frames outside the canvas.

## Known limitations

- V1 supports rectangular, non-rotated frames only.
- There is no visual in-app template creator yet; templates are added as data in code.
- The current release keeps one autosaved project at a time; **Start new** replaces it.
- Projects do not synchronise between devices.
- There is not yet a portable project backup/import file, so clearing Safari website data can remove the autosaved project.
- HEIC availability depends on whether the browser can decode the selected file; the explicit supported types are JPEG, PNG and WebP.
- iOS memory pressure can still affect unusually large source files. Editing uses a downscaled preview, while export decodes originals one frame at a time.
- Browser share/download wording varies by iOS version. The generated JPEG preview remains available if the share sheet is unavailable.
- Automated browser E2E coverage is not included yet; the important non-visual logic has unit coverage.

## Short roadmap

1. Test multi-image share, refresh recovery, touch reordering and installation on physical iPhone and iPad hardware.
2. Add a portable project backup/import file for moving complete projects between devices without accounts.
3. Add a constrained visual template creator with duplicate, resize, alignment guides and local “My Templates”.
4. Add JSON template import/export for moving custom layouts between devices.
5. Add optional square and landscape formats through the existing format definition system.
6. Consider an opt-in Google Photos source only after the local workflow is solid.
