# Custom photo order and faster categorisation

Verified locally on **28 September 2026**. Application/test source:
`778f74092cb58685dc8e938ae065023e16712095`, branch
`codex/photo-library-controls`, based on clean handoff `6141f17`.
**Not published or deployed.** Production was last recorded as PR #39 /
`4be2984` at 11:16 UTC; it was not rechecked by this implementation task.

## Behaviour

- Custom order is available directly in the gallery toolbar and under View.
  Dedicated drag handles work with mouse/touch; typed positions commit on Enter
  or blur, with Escape restoring the displayed position. Positions are 1-based
  across the whole project, including when a filter hides some photos.
- Order belongs to project-photo metadata and participates in existing saves,
  backups and Undo/Redo. New imports append. Duplicate groups move together.
  Import order and filename order remain available. View selection itself is
  session-only; choose Custom order again after a reload.
- Opened photos show Hero, Good, Other and Unranked buttons plus label toggles
  and label creation on the right. The panel scrolls, stacks below on narrow
  phones, and hides with viewer controls. Info retains technical details.
- Holding a photo for 500ms starts multi-selection. Movement, scrolling, another
  pointer and cancellation stop the hold. Releasing the hold does not also open
  the viewer. Subsequent taps select more photos for existing bulk edits.
- Assigned rank remains top-left; custom label chips accumulate bottom-left.
  Overflow uses a +N more count; all label names remain in accessible text/title.

## Validation

All checks ran against synthetic/local data with external service settings blank.
The installed Node executable was used directly because npm was not on PATH.
Windows sandbox child-process restrictions required approved execution for the
test/build/browser workers; the initial blocked build did not modify services.

| Check | Result |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run` | 666 tests / 51 files passed |
| `node node_modules/typescript/bin/tsc --noEmit` | Passed |
| `node node_modules/eslint/bin/eslint.js .` and final changed-file lint | Passed |
| `node node_modules/next/dist/bin/next build --webpack` | Passed; static routes generated |
| `node scripts/qa-photo-controls.mjs <output>` | Passed, 12 unique synthetic photos, zero browser errors/external requests |
| `git diff --check` | Passed |

Regressions cover storage/cloud/portable-backup retention, explicit Undo clears
and redo, old-client omission recovery, late acknowledgements, stale cloud reads,
missing-schema rejection, protected local recovery, duplicate groups, new imports,
and preservation of original metadata, placements and independent crops. Existing
native-scroll tests still pass without feedback writes to scrollTop.

Browser checks exercised numeric order, mouse/touch drag, positions during search,
the numeric-blur-then-drag edge case, touch long-press with subsequent selection,
scroll cancellation, bulk rank, repeated labels, direct label toggling, hidden
controls and reload. Screenshots were inspected at 1180x820, 820x1180 and 390x844.
The initial browser runner reached reload but omitted reopening the project;
that runner navigation was corrected and the final complete run passed.

Raw generated screenshots and report stay outside Git. The portable runner
records `report.json`, `custom-order-labels.png` and the three category layouts.

## Boundaries and acceptance still needed

No migration, deployment, live project repair, cloud writes or original-file
change occurred. Original bytes and all existing project versions remain intact.
Physical iPad Safari/PWA, Pencil, momentum, virtual keyboard and a real two-device
round trip remain unverified. The existing nontransactional cloud-save limitation
is unchanged. Before release, recheck current production source and complete the
applicable release checklist within separately authorized release scope.
