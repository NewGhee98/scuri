# Start here — Scuri

Canonical current-status handoff. Updated **26 September 2026** for the verified text-tools release and repository/Drive documentation refresh. A new session needs this repository, not the originating conversation or a particular computer. Recheck live release evidence before a later release or service change.

## Product and workflow

Scuri creates polished photo posts and carousels for Instagram, with larger proportional JPEG exports for other uses. It is designed primarily for **iPad and desktop**, with iPhone support. The reported acceptance device is an iPad Air 11-inch M2; its reported iPadOS version still needs confirmation during physical testing.

Create/open a fixed-format project → import photos into its independent library → choose built-in/custom page templates → place photos and adjust their independent crops → preview at the chosen output settings → export ready/selected pages. Reusable templates are separate from project-page snapshots. The library supports 250 unique photos and projects support 30 pages; portable ZIP backups remain limited to 256 MiB.

## Authority and preservation

| Layer | Owns |
| --- | --- |
| Supabase | Project structure, page order, library metadata, frame assignments, crops, Drive references and reusable templates |
| Google Drive | Untouched original image bytes, derived previews/thumbnails and optional exports; **no authoritative project manifest** |
| Browser | Local/offline metadata and byte caches, derived analysis and session previews; not the permanent source of truth |

**Unavailable bytes are never deletion intent.** Empty IndexedDB, an unrestored Drive token, failed downloads or pending analysis must retain library entries, placements and crop metadata. Only explicit scoped user actions may remove assignments/pages. Repeated placements retain independent crops; duplicate consolidation retains placements and does not delete Drive originals. See [technical invariants](PROJECT_CONTEXT.md#photo-preservation-and-save-path).

## Verified production

GitHub, authenticated Vercel and public-site release checks on **26 September 2026, 09:47–09:50 UTC** confirmed the release below. The documentation refresh rechecked GitHub and Vercel at **10:14–10:18 UTC**: the same application remained current; no new production deployment was made.

- [PR #30 — Movable text and consistent export typography](https://github.com/NewGhee98/scuri/pull/30) is merged.
- Application release source: [`5446dd3706ef2b206d141c9ef06dfa8bc2e1689f`](https://github.com/NewGhee98/scuri/commit/5446dd3706ef2b206d141c9ef06dfa8bc2e1689f).
- [Vercel deployment 8KQocDzx1muqMTuVCzoJVkGWthk6](https://vercel.com/nugee/scuri/8KQocDzx1muqMTuVCzoJVkGWthk6): **Ready / Production / Current at verification**, serving [scuri.vercel.app](https://scuri.vercel.app). Subsequent publication of this release record changes documentation only.

This includes Cinzel, Cormorant Garamond and Inter text tools, PR #28's coordinated template tools and PR #29's native-scrolling fix. The complete merged tree matched tested local commit `c4b7bd7`. **533 tests / 41 files, typecheck, lint and build passed earlier on 26 September**; the release task verified exact source equality, successful Vercel builds, HTTP 200, 11 JS/CSS assets and byte equality for all five font files. The additive `templates.text_layers` migration was applied and read back; existing composition/asset fingerprints and template policies/grants stayed unchanged. See the [release record](docs/evidence/2026-09-26-text-release.md). The [PR #29 record](docs/evidence/2026-09-20-production.md) remains historical evidence.

## Work outside production

- [PR #31 — documentation refresh](https://github.com/NewGhee98/scuri/pull/31), branch `docs/text-release-record`, is **open and unmerged**. It records PR #30, the migration and the four updated Drive summaries. Until merge, use this branch's handoff for current release wording. Publishing this documentation branch can create an automatic Vercel Preview; it does not replace production or change application code.
- `feat/page-text` is released through PR #30. See [text handoff](docs/TEXT_TOOLS.md), [implementation checks](docs/evidence/2026-09-26-text-tools.md) and [release verification](docs/evidence/2026-09-26-text-release.md). Local and browser-published commit IDs differ; complete tree equality establishes source equivalence.
- `docs/portable-handoff`: prior documentation commit `b206a1e` and branch remain preserved locally; their content was included in PR #30. The user's release authorization resolved the previous publication hold. The [20 September audit](docs/evidence/2026-09-20-documentation-audit.md) remains history. All four Drive summaries were updated and read back on **26 September**, with historical content and private sharing retained; see the [documentation refresh record](docs/evidence/2026-09-26-documentation-refresh.md).
- Before the documentation work, local application HEAD `3639dd3` had the **same full tree** as production. The pre-existing publication/release narrative was incorporated in [dated history](docs/history/PROJECT_CONTEXT_THROUGH_2026-09-20.md), not discarded.
- [PR #14 — Add client safety backups and undo](https://github.com/NewGhee98/scuri/pull/14) was still open at release inspection. It is older branch work, **not approved for merging or assumed to add missing features**. Compare it with current main before any future decision.
- Other machines, private drafts and uninspected branches have not been audited by the text task.

## Limitations and next priorities

1. **Cross-device save limitation:** parent revision checks and a per-app queue do not make separate project/page/asset REST writes atomic. Interrupted or interleaved child writes and inconsistent reads remain possible. Transactional save/consistent-read work requires a separate design and approval.
2. **Acceptance still outstanding:** physical iPad Safari scrolling, touch/Pencil/pinch, memory, virtual keyboard, share sheets; real two-device saves, OAuth, direct Google pickers and interrupted backup resume. New text controls also need [physical-device and two-device acceptance](docs/TEXT_TOOLS.md). Deployment and desktop tests do not certify these. Use the [release checklist](docs/PROJECT_PHOTOS_RELEASE_CHECKLIST.md).
3. **Live configuration scope:** this release verified only the new template text column/constraint/default, its migration record and unchanged template policies/grants. Other Supabase configuration, Google API/consent/origin settings and secret/environment hygiene remain unverified. The user previously reported `photo_library` applied with a different migration timestamp; [do not rerun SQL to align its filename](PHOTO_LIBRARY_MIGRATION_REVIEW.md).
4. **Historical Islands loss:** prevention is shipped; exact lost assignments/crops cannot be inferred from original bytes or new Drive upload hints. No recovery is established. Follow the [separate recovery procedure](ISLANDS_RECOVERY.md) only with explicit live-data authorization.
5. Larger pixel exports are available; colour-managed print preparation is not certified. Streaming backups, persistent history, landscape formats and screenshot-to-template assistance remain ideas for separate review, not approved implementation scope.

## Reading order

1. **This file** — current status, authority and boundaries.
2. [CURRENT_TASK.md](CURRENT_TASK.md) and `git status` — active work and unrelated changes to preserve.
3. [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) — implementation, invariants, source map and handoff maintenance.
4. [VERIFICATION.md](VERIFICATION.md) → [release checklist](docs/PROJECT_PHOTOS_RELEASE_CHECKLIST.md) — commands, recorded evidence and outstanding acceptance.
5. [README.md](README.md) — product usage, local setup and the four Drive summaries. Consult [dated history](docs/history/PROJECT_CONTEXT_THROUGH_2026-09-20.md) and [evidence index](docs/evidence/README.md) when needed.

Exact dependencies/scripts belong to [package.json](package.json); resolved versions belong to [package-lock.json](package-lock.json). Do not maintain a competing technology-version list here. Repository documents own technical detail; Drive owns consistent product/status summaries. Historical notes and checklists are evidence or future procedures, not authorization to migrate, repair data, change service configuration or deploy.
