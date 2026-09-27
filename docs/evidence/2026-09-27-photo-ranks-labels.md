# Photo ranks and reusable labels — local verification

Date: **27 September 2026**. Implementation source:
`86c9744bd37de757ec27ba948778c217bf1c9db3` on
`codex/photo-ranks-labels`, based on `aeaedd4`.
This record is local implementation evidence, **not a deployment**.
No live project, provider configuration, migration or remote repository was
changed. The last recorded production release remains PR #35; it was not
re-audited for this feature.

## Behaviour and preservation

- Photo info has Hero / Good / Other beside a label field. Unranked is the
  initial state and the way to clear a rank. Assigned ranks have small gallery
  badges; Unranked is also a filter.
- Enter or Add applies a trimmed, whitespace-normalized, lowercase label.
  The field suggests project labels on focus, narrows while typing, offers
  existing labels or a new one, and excludes labels already applied to that
  photo. Multiple removable chips retain the existing UI style.
- Rank, label, filename, usage, colour and proportion filters combine.
  Multiple ranks are alternatives; multiple labels must all match.
- Select photos / Select all shown enables bulk rank changes, rank clearing
  and additive labels. Each photo retains its own existing labels. Filter
  changes clear selection and filtered-out photos cannot be edited implicitly.
- Metadata is optional, project-owned JSON inside the existing photo library.
  No rank is inferred for old projects or imports. Explicit null/empty-array
  clears survive merges. Placements, crops, original identities and upload
  references remain separate. No database migration is required.

## Automated checks

Node **v24.19.0**, installed locked dependencies, Windows PowerShell. Commands
were run directly through Node because npm was not on this shell's PATH.
The local Vitest config changes only the disposable cache directory.

| Check | Command | Result |
| --- | --- | --- |
| Full regression suite | `node node_modules/vitest/vitest.mjs run --config vitest.local.config.mts` | Exit 0; **589 tests / 44 files** |
| Typecheck | `node node_modules/typescript/bin/tsc --noEmit` | Exit 0 |
| Full lint | `node node_modules/eslint/bin/eslint.js . --ignore-pattern artifacts/ --ignore-pattern vitest.local.config.mts` | Exit 0 |
| Production build | `node node_modules/next/dist/bin/next build --webpack` | Exit 0; compiled, TypeScript checked and static routes generated |
| Diff whitespace | `git diff --check` | Exit 0 |

The 17 added cases exercise actual editing/filter/history/validation helpers
and cache, cloud and ZIP save/read paths:

- Legacy/unranked defaults and invalid metadata rejection; normalized labels,
  duplicates, no-op edits, project isolation with shared original keys,
  additive bulk changes and duplicate-group aliases.
- Combined Hero + Temple + Unused + search/orientation/colour, multiple-label
  intersection, Unranked, and nonmutating filtering.
- Undo/Redo of ranks and labels, preserving later upload checkpoints and crops.
- Local storage reload and in-memory Supabase project JSON write/read; assigned
  row identity, crop and backup counts retained without deletion.
- Explicit clears from another device, older-client field omissions retained
  and marked dirty, stale pulls, protected local recovery and edits during an
  in-flight acknowledgement.
- Missing-schema refusal before child writes, including null and empty-array
  metadata; portable ZIP backup/restore with fresh identities and retained
  ranks, labels and crops.

Existing import, original-recovery, resumable-backup, lost-save/conflict,
deletion-protection, placement and native-gallery-scroll regressions also pass.
No real Supabase/Drive calls occur in these tests. The focused first run exposed
an order-sensitive assertion against an existing remote-library merge order;
comparison was corrected to stable photo identity, and the complete suite then
passed. No application behaviour was altered to satisfy that assertion.

## Browser checks

The production build ran on a fresh local origin, `127.0.0.1:3016`, with no
public Supabase or Google configuration. All projects and six generated PNGs
were synthetic. Chrome was controlled through the supported browser tool.
Initial workspace was empty. These are desktop checks at **1180×820 landscape**
and **820×1180 portrait** CSS viewport sizes, not physical iPad Safari evidence.

Observed through the actual UI:

1. Import six files; all initially unranked. Set Hero on Temple 01, enter
   ` Temple `, add NIGHT, then TEMPLE; only one `temple` chip exists.
2. Open Temple 02: focus suggests `night` and `temple`. Typing TEM narrows
   suggestions; selecting temple reuses it. Add people and choose Good.
3. Select the two photos, bulk set Hero and add japan then travel. Both remain
   selected for consecutive additions. Temple 01 retains night; Temple 02
   retains people.
4. Remove travel on Temple 01, clear its rank, then restore Hero. Chips and
   rank controls stay visible and usable in portrait and landscape.
5. Hero + temple + Unused returns two photos; adding filename search
   `Temple 02` returns one. Clear that photo's rank and all labels while it is
   being inspected: the viewer stays open with Outside current filters;
   returning to the gallery shows zero matching photos.
6. Reload the app and reopen the project: Temple 01 retains Hero plus japan,
   night and temple. Temple 02 remains Unranked with no labels. Unranked
   filtering returns five.
7. Select all five shown unranked photos and set Other. They leave that filter;
   changing filters clears the selection. Select two and bulk Clear rank:
   their badges disappear and the other ranks remain.
8. Place Temple 01 on a Full frame page and set photo zoom to -25% (0.75).
   Change its rank and add city, then close the library: the crop remains -25%
   and the page remains filled. Undo both metadata edits restores Hero and
   removes city. Hero + temple + Unused now returns zero; Used returns one.
9. Create another project: its label filter has no suggestions from the first
   project. No application-origin errors were returned in the captured console
   sample; only unrelated extension warnings appeared.

Screenshots are local, ignored artifacts under `artifacts/photo-metadata-qa/`:
`photo-info-landscape.png`, `photo-info-portrait.png` and
`combined-filters-portrait.png`. They show synthetic data only and are not
required to understand this portable record. A browser backup download was
invoked, but the tool did not receive a download event; native download
acceptance is not claimed. ZIP creation/inspection/restore passed in automated
tests.

## Remaining acceptance

- Physical iPad Safari: touch/Pencil, virtual-keyboard Enter/Return, focus,
  suggestion scrolling, rotation with the keyboard open, large-library
  scrolling, suspension and native download/share behaviour.
- An authorized disposable signed-in project across two real devices:
  ranks/labels and clears, offline/reconnect, edits during saves and concurrent
  backup, with original references and independent crops retained.
- Refresh old deployed clients before editing new metadata. Existing
  non-transactional parent/page/asset writes remain a separate limitation.

No live release is implied by a passing build or this record.
