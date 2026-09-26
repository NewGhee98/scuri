# Start here — Scuri

Canonical current-status handoff. Updated **26 September 2026** for local text tools; production was last verified on 20 September. A new session needs this repository, not the originating conversation or a particular computer. Recheck live release evidence before a later release or service change.

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

Fresh GitHub and authenticated Vercel inspection on **20 September 2026, 20:07–20:11 UTC** confirmed:

- [PR #29 — Project photos scrolling and documentation](https://github.com/NewGhee98/scuri/pull/29) is merged.
- Production source: [`24075d1e4c8cd6dfc2936d77332f8cd3793bf268`](https://github.com/NewGhee98/scuri/commit/24075d1e4c8cd6dfc2936d77332f8cd3793bf268).
- [Vercel deployment G6GijpLztNtqiQNT966cjQms2S7Z](https://vercel.com/nugee/scuri/G6GijpLztNtqiQNT966cjQms2S7Z): **Ready / Production / Current**, serving [scuri.vercel.app](https://scuri.vercel.app).

This includes PR #28's coordinated template tools and PR #29's native-scrolling fix. The full release tree matches the previously tested source. **512 tests / 39 files, typecheck, lint and build are recorded release results.** A public GitHub read on **25 September at 16:54:34 UTC** still returned this main commit/tree; Vercel was not rechecked in the text task. See the [portable production record](docs/evidence/2026-09-20-production.md) and [verification guide](VERIFICATION.md) for separate local text results.

## Work outside production

- `feat/page-text`: locally implemented movable text boxes and reusable template defaults, with Cinzel, Cormorant Garamond and Inter. See [text handoff](docs/TEXT_TOOLS.md) and [local verification](docs/evidence/2026-09-26-text-tools.md). **Not pushed, no PR, not deployed.** The additive reusable-template text migration is prepared for review and has not run.
- `docs/portable-handoff`: prior documentation-only commit `b206a1e` remains preserved and is the text branch's base. Its publication question remains unresolved because a branch push can trigger Vercel Preview. **No documentation PR has been published.** See the [documentation audit](docs/evidence/2026-09-20-documentation-audit.md). A future release must include/reconcile this documentation ancestry as well as the text feature.
- Before the documentation work, local application HEAD `3639dd3` had the **same full tree** as production. The pre-existing publication/release narrative was incorporated in [dated history](docs/history/PROJECT_CONTEXT_THROUGH_2026-09-20.md), not discarded.
- [PR #14 — Add client safety backups and undo](https://github.com/NewGhee98/scuri/pull/14) was still open at inspection. It is older branch work, **not approved for merging or assumed to add missing features**. Compare it with current main before any future decision. No other open PR was returned before this documentation PR was prepared.
- Other machines, private drafts and uninspected branches have not been audited by the text task.

## Limitations and next priorities

1. **Cross-device save limitation:** parent revision checks and a per-app queue do not make separate project/page/asset REST writes atomic. Interrupted or interleaved child writes and inconsistent reads remain possible. Transactional save/consistent-read work requires a separate design and approval.
2. **Acceptance still outstanding:** physical iPad Safari scrolling, touch/Pencil/pinch, memory, virtual keyboard, share sheets; real two-device saves, OAuth, direct Google pickers and interrupted backup resume. New text controls also need [physical-device acceptance and migration review](docs/TEXT_TOOLS.md). Deployment and desktop tests do not certify these. Use the [release checklist](docs/PROJECT_PHOTOS_RELEASE_CHECKLIST.md).
3. **Unknown live configuration:** Supabase schema/RLS/grants, Google API/consent/origin settings and secret/environment hygiene were not inspected in this task. The user previously reported `photo_library` applied with a different migration timestamp; [do not rerun SQL to align its filename](PHOTO_LIBRARY_MIGRATION_REVIEW.md).
4. **Historical Islands loss:** prevention is shipped; exact lost assignments/crops cannot be inferred from original bytes or new Drive upload hints. No recovery is established. Follow the [separate recovery procedure](ISLANDS_RECOVERY.md) only with explicit live-data authorization.
5. Larger pixel exports are available; colour-managed print preparation is not certified. Streaming backups, persistent history, landscape formats and screenshot-to-template assistance remain ideas for separate review, not approved implementation scope.

## Reading order

1. **This file** — current status, authority and boundaries.
2. [CURRENT_TASK.md](CURRENT_TASK.md) and `git status` — active work and unrelated changes to preserve.
3. [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) — implementation, invariants, source map and handoff maintenance.
4. [VERIFICATION.md](VERIFICATION.md) → [release checklist](docs/PROJECT_PHOTOS_RELEASE_CHECKLIST.md) — commands, recorded evidence and outstanding acceptance.
5. [README.md](README.md) — product usage, local setup and the four Drive summaries. Consult [dated history](docs/history/PROJECT_CONTEXT_THROUGH_2026-09-20.md) and [evidence index](docs/evidence/README.md) when needed.

Exact dependencies/scripts belong to [package.json](package.json); resolved versions belong to [package-lock.json](package-lock.json). Do not maintain a competing technology-version list here. Repository documents own technical detail; Drive owns consistent product/status summaries. Historical notes and checklists are evidence or future procedures, not authorization to migrate, repair data, change service configuration or deploy.
