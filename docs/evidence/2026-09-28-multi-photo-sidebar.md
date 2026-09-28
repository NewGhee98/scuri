# Multi-photo placement, Untagged and docked controls

Verified locally on **28 September 2026**. Application/test source **9072aed**,
branch `codex/multi-photo-editor-sidebar`, based on clean PR #40 handoff
`e63999a`. **Not published or deployed.** Production remains last verified as
PR #40 / `0b417e1` at 22:12–22:13 UTC; this implementation made no live changes.

## Behavior

- From a page frame, choose Scuri photos and tap multiple thumbnails. Numbered
  badges show selection order; Add N photos confirms the whole batch. Preview
  remains available, including selecting/deselecting from the opened photo.
- The first selection goes in the tapped frame. Remaining selections fill empty
  frames in layout order, wrapping from the end to the beginning. Existing
  placements outside the tapped destination are preserved. Capacity is visible
  and enforced. One-frame pages retain a simple single selection/confirmation.
- Filters, cancellation, reopening and a new destination clear pending choices.
  Hidden rows cannot be submitted. If capacity shrinks, confirmation disables
  instead of silently dropping photos. The batch revalidates destination,
  composition, account, membership, duplicate aliases and capacity before save.
  It is adopted once and can be undone in one step. Failed validation or local
  persistence cannot partially apply the batch. Same-original replacement keeps
  its existing crop; backup acknowledgements do not invalidate a selection.
- Untagged means no custom labels, independent of Hero/Good/Other. It is mutually
  exclusive with named label filters and combines with ranks, usage, search,
  color and proportions. Unranked remains a separate filter.
- Controls reserve space on the right at 700px and wider, including iPad/coarse
  touch; on narrow phones they dock below the page. Lock controls keeps the dock
  open during canvas editing and page navigation within the tab. Unlocked canvas
  clicks or Escape dismiss it; Hide/Close always works. Completed click handling
  avoids changing the stage midway through a crop gesture. The setting resets
  on reload and never enters saved projects. Fit follows the available stage.

## Validation

- **694 tests / 54 files passed** with the full Vitest suite.
- Standalone TypeScript, full ESLint, production build and diff checks passed.
- Focused batch tests cover wrapping, occupied/metadata-only placement and crop
  preservation, explicit replacement, same-photo aliases, stale destinations,
  late backup checkpoints, capacity, missing photos and all-or-none behavior.
  Production-handler tests cover one save/Undo, double submission and failed
  storage. Picker rendering tests cover tap order, cancellation/filter resets,
  changing destinations and reduced capacity. Sidebar tests cover lock state,
  explicit dismissal, keyboard and pointer handling.
- `scripts/qa-multi-photo-sidebar.mjs` passed against the local production build
  using five generated JPEGs in isolated Chrome with touch support and all
  external origins blocked. It exercised normal UI import, Untagged plus Hero,
  multi-photo selection, capacity, cancellation, tap order, one Undo, occupied
  crop preservation and reload. All original SHA-256 hashes stayed unchanged.
- Browser geometry and screenshots at **1180x820**, **820x1180** and **390x844**
  verified that controls do not cover the stage and Fit stays inside it. Lock,
  hide, unlocked dismissal and page navigation passed. The phone confirmation
  footer stayed reachable. Small thumbnails plus Custom order retained usable
  image area, label badges, Preview and ordering controls.
- Final browser run reported **zero page errors and zero external requests**.
  Raw report and screenshots remain in the sibling `multi-photo-sidebar-qa`
  artifact folder. Independent source review found no material remaining issue.

## Boundaries

No migration, service configuration, original-byte changes, existing-project
repair or deployment. Page layout/export geometry and other photo crops remain
unchanged by the sidebar. Synthetic desktop touch and viewport checks do not
certify physical iPad Safari/PWA, keyboard behavior or real two-device sync;
those acceptance checks remain outstanding. Existing cloud-save limitations
remain separate. The temporary local test server was stopped after validation.
