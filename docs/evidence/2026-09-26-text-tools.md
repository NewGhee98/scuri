# Local text tools verification — 26 September 2026

## Source and scope

Tested the local `feat/page-text` working diff based on documentation commit `b206a1e2e76fd0ba3968771ae4d511ae3cf8eb44`. The prior application tree matches PR #29. Public GitHub main was read again on 25 September 2026 at 16:54:34 UTC: `24075d1e4c8cd6dfc2936d77332f8cd3793bf268`, tree `32ab55a98d801320f0bc92e44f54c32da6f90c66`. [Main source](https://github.com/NewGhee98/scuri/commit/24075d1e4c8cd6dfc2936d77332f8cd3793bf268), [PR #29](https://github.com/NewGhee98/scuri/pull/29).

This is local implementation evidence, not a production result. No branch push, PR, merge, deployment, SQL execution, live data repair or original-file modification occurred. Vercel, Drive documents and live Supabase configuration were not inspected in this task. The earlier documentation commit and branch were retained; their publication question is recorded in [START_HERE](../../START_HERE.md).

## Checks actually run

The installed repository tools were invoked through the bundled Node executable (recorded runtime v24.19.0); these are the same entry points as the package scripts. No dependency or lockfile change was needed. The normal Next webpack build ran its TypeScript worker; the constrained-runtime typecheck bypass was not enabled.

| Command entry point | Result on 26 September |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run` | Exit 0: **533 tests, 41 files**. Final run began 10:18:16 local time. |
| `node node_modules/typescript/bin/tsc --noEmit` | Exit 0, rerun after the final production build. |
| `node node_modules/eslint/bin/eslint.js .` | Exit 0, no warnings or errors. |
| `node node_modules/next/dist/bin/next build --webpack` | Exit 0: optimized build, TypeScript, static generation and build traces completed; `/`, `/_not-found`, `/manifest.webmanifest` generated. |

New regressions cover multiline wrapping/tracking/alignment, reference-space rendering at thumbnail/1×/2×/3× sizes, drag coordinate conversion at 0.25×/1×/3×, snap release, bounds, font readiness/failure, validation, independent styles, local/cloud metadata round trips (including JSONB object-key reordering and rejection of altered text), portable restore, Undo/Redo, native control event timing, cancelled draft/blur, fresh-device missing-image preservation, and independent page/template snapshots. All service tests use synthetic data and fake transports. Existing panorama, crop, upload checkpoint, gallery scroll and Add page tests remain included.

## Desktop Chrome observations

Used an isolated localhost origin with all public Supabase/Google configuration values explicitly blank. QA used one generated 6400 × 1440 panorama and local test project/template entries only. No signed-in/live project was opened or changed. Browser viewport overrides were restored afterwards.

- Cinzel multiline title, exact 64px sizing/tracking, centre, Undo/Redo and dragging at 100% canvas view. Position changed by the expected 60/90 reference pixels. Reload/reopening preserved the text and styles.
- Duplicated caption with independent Cormorant Garamond italic styling/70% opacity; switched that box to Inter. Native colour value/blur committed an undoable light caption. The automated colour-field fill alone did not exercise the native change handler; the accessibility control did. A queued preview/blur regression separately covers the state timing risk.
- Synthetic panorama at -75% photo zoom, light and dark page backgrounds, text over the photo and exposed background. Photo placement/crop remained independent of text editing.
- Original-based clean JPEG preview at **1080 × 1350** and **2160 × 2700**, including 100% detail at 2×. Text proportion, position and wrapping agreed, without selection tint, labels or guides. This exercised the shared JPEG renderer via preview, not the native download/share-sheet workflow.
- Editor text controls inspected at **1180 × 820** and **820 × 1180** CSS viewport sizes. Desktop browser sizing is not an iPad simulator or Safari/touch acceptance.
- Added Cinzel “New Season” to a copy of Gallery border in the template designer; clean preview omitted selection controls. Local save showed the accurate cloud-unavailable notice, and the saved library thumbnail displayed the title.
- Final captured Chrome warning/error log was empty. This is a bounded observation, not certification of every browser path.

## Limits and release review

Physical iPad Safari, native touch/pinch/virtual keyboard/colour picker, suspension/offline fonts, original share/download flows and real two-device sync remain outstanding. See [text rules and acceptance](../TEXT_TOOLS.md). No live schema state is inferred from unit tests or this build.

Page text uses existing snapshot JSON. Reusable template text needs the **review-only, unapplied** additive [templates.text_layers migration](../../supabase/migrations/20260925170000_add_template_text_layers.sql). Missing-column/invalid-response paths retain local text and refuse a false sync success. Review target schema, apply only with authorization, and test with disposable new data before a later release. Refresh older editing clients; existing nontransactional cross-device saves and historical Islands recovery limitations remain.

Raw console/test output was observed during the task; this small sanitized record is the portable evidence. Synthetic JPEGs, screenshots, private images, credentials and machine-specific runtime paths are intentionally excluded.

Documentation validation checked 138 local file/heading references across nine current documents with no failures. Final staged review contains only the intended source/tests, bundled fonts and licences, additive review-only SQL and documentation. No dependency, service configuration, private photo or generated build artifact is included. The final whitespace check passed after removing trailing spaces from the supplied licence notices; font bytes remain unmodified.
