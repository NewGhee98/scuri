# Page and template text

Released through [PR #30](https://github.com/NewGhee98/scuri/pull/30), 26 September 2026. [START_HERE](../START_HERE.md) owns release status; [implementation checks](evidence/2026-09-26-text-tools.md) and [production evidence](evidence/2026-09-26-text-release.md) distinguish the tested scopes.

## User workflow

In the page editor, choose **Text → Add text**. In the template designer, choose **Text → Add text** to create reusable starting text. Each box has one style, supports multiple lines, and can be moved over photos or into page margins without moving a photo frame. Up to 20 boxes, each with up to 2,000 characters, are supported.

- Fonts: **Cinzel**, **Cormorant Garamond**, **Inter**. Regular, Medium, Semibold and Bold; real italic faces for Cormorant and Inter. Cinzel has no italic face, so that control is disabled.
- Exact numeric fields and sliders: font size (reference canvas pixels), letter spacing (pixels), line spacing (font-size multiplier), opacity and box width. Colour and optional rectangular background apply to the whole box.
- Left/centre/right alignment, duplicate, delete, centre on page and bring forward within the text layers. All text sits above the photos. Rotation, rich text within a box, text masks and text behind photos are outside this release.
- In **Edit** mode, drag a text box or use arrow keys (1 reference pixel; Shift = 10). Snap gives gentle page edge/centre alignment, horizontal box-edge/centre alignment and other box-top alignment. Alt bypasses it. Move limits keep the box within the page when it fits. Text made taller than the page is clipped and the selected box reports overflow; it is never silently shrunk.
- **Navigate** retains exclusive ownership of canvas pan/pinch. Text mode disables photo crop/zoom/frame movement; switching back to Photos/Frames retains the viewport. Selection and viewport changes are not composition edits.

Typing and colour changes commit when leaving the field; numeric fields commit on Enter or blur. Sliders and drag gestures preview while moving and commit at gesture end. Each committed change is undoable. Escape cancels a text draft or drag; pointer cancellation/navigation cancels a drag. A draft still being typed is not a durable save: leave the field before closing/reloading. Undo history remains session-only, as for photos.

## Geometry and rendering

[`TextBox`](../src/lib/types.ts) stores an ID, text, normalized `x`, `y`, `width`, font ID, reference-pixel font size/tracking, line-height multiplier, weight, italic, alignment, colour, opacity and optional background. Height is derived from the loaded font and wrapping. Text is independent of frame geometry, insets, photo zoom and crop metadata.

[`text.ts`](../src/lib/text.ts) is the single layout/drawing implementation used by the editor overlay, template/page thumbnails and original-based export preview/JPEG export. Wrapping is measured at reference dimensions before output scaling. Explicit glyph runs apply nonzero tracking consistently; zero tracking uses the browser's whole-line kerning. Newlines and grapheme-safe hard wrapping are supported. The page clips artwork; selection tint, focus, labels and snapping lines are separate editing UI.

Changing output dimensions scales position, font size, spacing and background geometry together. Viewport zoom does not change these values or request original photo bytes. Export continues to load original photos on demand. It waits for the exact bundled fonts and reports a retryable failure rather than silently exporting a substitute face. Browser/OS rasterization can differ slightly; complex-script shaping and glyphs outside the bundled faces have not been certified.

Fonts are served from the app's own origin and load on use. Sources and licence notices are in [public/fonts](../public/fonts/README.md). Keep existing versioned font bytes stable: changing a face can change saved line breaks, and the service worker caches static files. A future font update needs a separate compatibility decision and new asset names.

## Persistence and release prerequisite

Page text lives in `page.templateSnapshot.textLayers`, using the existing `project_pages.template_snapshot` JSON. Local serialization, cloud push/pull, project copies, Undo and portable backup restore preserve it. **No project/page/asset schema change is required.** Legacy snapshots without the optional field render exactly as before. New pages clone reusable defaults; changing a reusable template later does not edit an existing page. An intentional photo-layout change keeps that page's existing text (including an explicitly empty list).

Reusable template rows have dedicated columns for frames and background and no general template snapshot. They need one additive JSON field to sync text across devices. Migration [20260925170000_add_template_text_layers.sql](../supabase/migrations/20260925170000_add_template_text_layers.sql) adds `templates.text_layers jsonb NOT NULL DEFAULT '[]'` with an array constraint. **Applied and verified on 26 September under the release authorization**, with that exact version in migration history. Read-back confirmed the type, default, not-null and array constraint; existing template content, projects/pages/assets and template RLS/grants were unchanged. Do not rerun it merely because the original SQL file retains its preparation-time review comment. `IF NOT EXISTS` alone is not verification of an existing column's properties.

Reads work against the older schema. Old templates that omit text can still save. Saving a template with text (or an explicit empty array clearing its last box) includes the new column and verifies the returned metadata. If the column is absent or text cannot be confirmed, the local copy remains unsynced and the error is shown; there is no retry that silently drops text. Fake transports cover these paths, not live Supabase.

Refresh editing devices before using new text features. Older clients do not render text and may omit new template metadata. The existing nontransactional cross-device save limitation remains. Missing image bytes are never deletion intent; text editing must preserve every unavailable placement, original reference and independent crop. The release's only schema change is the additive template field above. Drive originals and historical Islands recovery remain untouched.

## Outstanding acceptance

Physical iPad Air 11-inch M2 Safari: virtual keyboard/blur commit, native colour picker, touch targets on small text at reduced Fit scale, text dragging while magnified, Navigate pinch, orientation, suspension, cold/offline font cache and native share sheet. Template/project round trips across two updated devices also remain pending. The migration and public deployment checks do not establish these outcomes.
