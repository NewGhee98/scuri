# Layouts

Layouts is a mobile-first, private photo-template editor for Instagram posts and stories. It is a focused alternative to the layout workflow in apps such as Unfold: choose a format, choose a template, add local photographs, adjust every crop and export a finished JPEG.

All image selection, composition and export happens in the browser. There is no account, backend, database service, analytics or photo upload.

## What works

- Instagram portrait posts at **1080 × 1350 (4:5)**.
- Instagram Stories at **1080 × 1920 (9:16)**.
- Eight data-defined templates for each format, including one-, two-, three- and four-photo layouts.
- Local selection from Apple Photos, iOS Files and desktop file pickers.
- Fixed clipping frames with independent drag, pinch, mouse-wheel and slider zoom.
- Cover fitting and constrained movement, so empty space cannot be dragged into a frame.
- Replace, reset and remove controls for each photograph.
- Adjustable background colour, borders and gutters.
- High-quality, exact-size JPEG preview, download and Web Share support.
- Local recovery of the active project after navigation or refresh.
- Installable PWA shell with standalone display, offline caching and iOS metadata.

## Privacy and browser storage

Photos never leave the device. The application uses:

- `localStorage` for lightweight project settings, crop positions and the selected layout.
- IndexedDB for the original local image blobs needed to recover an unfinished project after a refresh.
- Temporary object URLs for downscaled editing previews and generated exports. These are revoked when replaced or no longer needed.
- The Cache API, through the service worker, for the application shell—not for user photographs.

Use **Start new** to clear the active project and its stored photo blobs. Browser storage remains specific to the browser and device; an iPad project does not synchronise to an iPhone.

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

The unit tests cover format selection, export dimensions, template validation, normalised canvas scaling, cover-crop calculations, image-position constraints and zoom limits.

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
- `src/lib/export.ts` redraws the composition from original image blobs at the exact output dimensions.
- `src/components/editor-canvas.tsx` handles high-DPI rendering and touch, pointer, wheel and keyboard input.
- `src/components/layouts-app.tsx` owns the four-screen product flow and user-facing state.

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
- Projects do not synchronise between devices.
- HEIC availability depends on whether the browser can decode the selected file; the explicit supported types are JPEG, PNG and WebP.
- iOS memory pressure can still affect unusually large source files. Editing uses a downscaled preview, while export decodes originals one frame at a time.
- Browser share/download wording varies by iOS version. The generated JPEG preview remains available if the share sheet is unavailable.
- Automated browser E2E coverage is not included yet; the important non-visual logic has unit coverage.

## Short roadmap

1. Test export, refresh recovery and installation on physical iPhone and iPad hardware.
2. Add a constrained visual template creator with duplicate, resize, alignment guides and local “My Templates”.
3. Add JSON template import/export for moving layouts between devices without accounts.
4. Add optional square and landscape formats through the existing format definition system.
5. Consider an opt-in Google Photos source only after the local workflow is solid.
