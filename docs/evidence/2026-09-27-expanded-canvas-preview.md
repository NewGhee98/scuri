# Expanded editor and full-screen export preview

Date: **27 September 2026**. Application source **68572e99d8700a2de691e992f18e065f778a051b**
on **codex/expanded-canvas-preview**, based on c43fa96. This is a local implementation
and verification record, **not a deployment**. The last recorded production
release remains PR #36; production was not re-audited or changed for this task.

## Behaviour

- The page editor uses the remaining dynamic viewport. A compact toolbar retains
  Pages, Undo/Redo, Project photos, Preview and Export. Instructions live in Help;
  backup counts, local-save errors/retry and project sync live in Status.
- Controls start collapsed. Wide desktop views can open a 320px side panel;
  widths up to 1366px and coarse-pointer devices use a modal drawer. Controls
  keep 44px touch targets, focus containment, Escape/close and safe-area insets.
- Fit measures the actual canvas stage with ResizeObserver. Panel changes and
  rotation recalculate Fit; manual zoom retains the inspected centre. View
  transforms do not enter the saved page, crop state, Undo or export settings.
- Ordinary preview has compact output controls. Closing Photo quality check,
  or its toolbar button, unmounts the entire quality column. Reopening restores it.
- Full screen opens a full-viewport native dialog, using the exact already-rendered
  export JPEG for the current page, without relying on the browser Fullscreen API.
  The complete page fits against a neutral background with its intentional borders.
  No app chrome, guides or controls appear initially. Tap or H reveals/hides
  Close, page arrows, Fit, 100% and Hide controls. Tab can reveal the controls;
  Escape closes the viewer. Pointer pinch and pan inspect image detail.
- Full-screen browsing has an independent page cursor and bounded image request.
  The ordinary preview remains mounted, retaining page, output width, quality-panel
  state, zoom and pan. Closing releases the full-screen image and restores focus.
  Cancelled/late renders cannot appear under a different page; failed original
  loading retains an exit and does not replace an assigned photo with a blank.

## Checks

Node v24.19.0, existing locked dependencies, PowerShell. The local Vitest config
changes only the disposable cache directory. Public Supabase/Google environment
values were blank for the browser build; cloud services were not used.

| Check | Result |
| --- | --- |
| Full suite: node node_modules/vitest/vitest.mjs run --config vitest.local.config.mts | Exit 0; **597 tests / 45 files** |
| Standalone typecheck: node node_modules/typescript/bin/tsc --noEmit | Exit 0 |
| Full lint: node node_modules/eslint/bin/eslint.js . --ignore-pattern artifacts/ --ignore-pattern vitest.local.config.mts | Exit 0; changed preview/test files linted again after final refinement |
| Production build: node node_modules/next/dist/bin/next build --webpack | Exit 0; compiled, TypeScript checked, static routes generated |
| git diff --check | Exit 0 |

Eight added tests run real component callbacks/effects with controlled hook hosts:
responsive Fit, tap versus drag/pinch, pointer cancellation/resize, quality-column
removal, borrowed rendered-image identity, independent navigation/restoration,
stale async results, missing originals and nested-dialog cancellation. Existing
crop/frame/text/export, persistence, sync, backup, recovery and ranking regressions
remain passing. These tests use synthetic/in-memory adapters, not live cloud writes.
The build caught nullable request typing during the independent-view refinement;
that was corrected before the final successful checks. TypeScript now excludes
artifacts, preventing earlier local publication bundles from being compiled as app
source. No dependencies, schema, renderer, crop algorithm or backup queue changed.

## Browser evidence

Desktop Chrome, local production build at 127.0.0.1:3016, using the prior isolated
synthetic QA project and generated Temple PNG. The test page has an intentional
-25% photo zoom and visible borders. A second synthetic page was duplicated for
navigation and given a different background; the original page's crop was retained.
No real project was opened. **These are CSS viewport emulation checks, not iPad
Safari, touch hardware or installed-app acceptance.**

| Observation | Result |
| --- | --- |
| Editor at 1180 x 820 landscape | Workspace fills viewport; canvas stage 1180 x 715.2; complete square page about 691 x 691 |
| Editor at 820 x 1180 portrait | Complete page 796 x 796, centred; toolbar and 44px controls remain reachable |
| Desktop panel at 1400 x 1300 | Open: stage width 1080/page width 1056; closed: stage width 1400/page width 1171; Fit recalculated |
| Quality collapse at 820px width | Stage expands from 540 to 820; fitted page expands from 516 to 796 |
| Clean viewer in landscape | Complete page 820 x 820, centred at x=180; controls hidden |
| Clean viewer in portrait | Complete page 820 x 820, centred at y=180; controls hidden |
| Actual export identity | Ordinary and initial full-screen image src use the same rendered JPEG object URL |
| Navigation and Close | Previous/Next work; Close restores entry page, selected 2x output and quality-panel state |
| View preservation | Ordinary 2x-export inspection retained the exact translate(-634px, -795px) scale(1) transform after browsing another page |
| Gestures and keys | Pointer pan, tap reveal/hide, 100%, Fit, H and Escape checked; two-pointer pinch checked by automated gesture tests |
| Local reload | Both synthetic pages, six photos, -25% crop and separate page backgrounds retained |
| Console | No app errors observed; unrelated browser-extension warnings were present |

The four original screenshot files and their checksum manifest are local task
artifacts under artifacts/expanded-canvas-preview, delivered with the task reply.
Raw screenshots are not committed, following the repository evidence convention.

| Screenshot | Pixels | SHA-256 |
| --- | --- | --- |
| editor-ipad-landscape.jpg | 1180 x 820 | 8d595a5d1772d5e0864b7bceacdbf84b32cb0f46a74391f729f7788f7a944e89 |
| editor-ipad-portrait.jpg | 820 x 1180 | 33ee75cf36f55d01801ff712d681bd1ce6b7b5332eefacdd4ac2a50ed6bb1d31 |
| fullscreen-ipad-landscape.jpg | 1180 x 820 | 57642a7c8cf1f64640020a6a56795cd0497145a1e97e2ac59bfd8a842a873f43 |
| fullscreen-ipad-portrait.jpg | 820 x 1180 | 28cb55589199cda99ebb95675ce549d07edbfe4c2f7fab13489823c096b452fe |

## Device acceptance still required

- Physical iPad Safari and installed Scuri: portrait/landscape rotation, safe areas,
  browser-bar changes and opening/closing drawers and nested preview dialogs.
- Real two-finger pinch/pan, tap recognition, Fit, focus/VoiceOver and the on-screen
  keyboard with photo/text controls. Desktop pointer emulation is not this evidence.
- Large original images and high-resolution exports on the iPad's memory budget.
  Existing authenticated cross-device/Drive acceptance remains separate; no claim
  is made that this display change completes those earlier device/service tests.
