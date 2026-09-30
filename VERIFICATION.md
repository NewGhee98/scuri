# Scuri verification

[START_HERE](START_HERE.md) is the canonical current-status handoff. The text application release was verified on **26 September 2026, 09:47–09:50 UTC** as [PR #30](https://github.com/NewGhee98/scuri/pull/30), source [`5446dd3`](https://github.com/NewGhee98/scuri/commit/5446dd3706ef2b206d141c9ef06dfa8bc2e1689f), [Vercel Ready / Production / Current at verification](https://vercel.com/nugee/scuri/8KQocDzx1muqMTuVCzoJVkGWthk6). Source equality, public assets and the applied additive migration are recorded in [release evidence](docs/evidence/2026-09-26-text-release.md). The later publication of this record changes documentation only.

## Evidence and scope

**Text implementation, 26 September:** **533 tests in 41 files, standalone typecheck, lint and the normal production build passed** on `feat/page-text`. The [text verification record](docs/evidence/2026-09-26-text-tools.md) includes synthetic Chrome editing/export checks and documentation validation. Publication did not change application code or rerun those local checks: the complete tested tree matched the GitHub branch and merged main, and Vercel independently built preview and production successfully. The additive template text migration was applied and verified. The table below remains dated PR #29/documentation evidence.

| Evidence | Status |
| --- | --- |
| PR #29 release tests | **Recorded 20 September:** 512 passing tests in 39 files; typecheck, lint and production build passed. Application checks were **not rerun** during the documentation task. |
| Scroll regression/desktop QA | Recorded six component regressions plus isolated Chrome with 120 synthetic photos and two populated pages at landscape/portrait CSS viewport sizes. Native scroll, restoration, filters and zero eager original loads checked. Not physical-iPad evidence. |
| Public release smoke test | Recorded HTTP 200, 11 loaded JS/CSS assets and 55 retained feature markers after release. Not an authenticated project round trip. Not rerun for this documentation task. |
| Release audit on 20 September | GitHub main/merged PR source and tree read afresh; authenticated Vercel current deployment and production domain read afresh. Local application source tree matched production at that audit's start. The 25 September implementation checkpoint rechecked GitHub only; the subsequent 26 September release checked Vercel as recorded above. |
| Documentation-only checks | Link/reference validation, consistent status/boundaries, archived history, managed AGENTS block, docs-only diff and Drive read-backs are recorded in the [documentation audit](docs/evidence/2026-09-20-documentation-audit.md). |

**Documentation refresh, 26 September:** the same PR #30 / `5446dd3` remained current in fresh GitHub/Vercel read-backs at 10:14–10:18 UTC. All four Drive summaries were updated in place and their complete normalized content read back, with private sharing and earlier timeline content preserved. Repository links/anchors, source references, current-status consistency, historical files and documentation-only scope were checked; see the [refresh evidence](docs/evidence/2026-09-26-documentation-refresh.md). [PR #31](https://github.com/NewGhee98/scuri/pull/31) remains open and unmerged. Application tests, typecheck, lint, build and live database queries were **not rerun** for this documentation-only refresh.

The [portable production record](docs/evidence/2026-09-20-production.md) distinguishes available logs from previously recorded successful exits and explains source equivalence. [Historical verification](docs/history/VERIFICATION_THROUGH_2026-09-20.md) retains prior packages/counts. The [evidence index](docs/evidence/README.md) discloses missing/nonportable source artifacts. Do not present a historical count or an empty command log as a new successful test run.

## Run the application checks

Use a disposable local checkout/test profile, a Node runtime compatible with [package-lock.json](package-lock.json), and the scripts in [package.json](package.json). Installation uses the committed lockfile; do not update dependencies merely to reproduce a check.

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run build
```

`build` uses the repository's configured webpack production path. Record the tested Git commit/working diff, runtime, command exit status and date. Unit tests use synthetic/in-memory adapters; they must not seed, reset or delete existing project assets. For local browser QA, leave all public Supabase/Google environment values blank, use a fresh browser profile and follow the [release checklist](docs/PROJECT_PHOTOS_RELEASE_CHECKLIST.md). A build must never be treated as a migration or deployment command.

```bash
npm run start -- --port 3005
node scripts/qa-photo-library.mjs <artifact-directory>
```

The browser helper requires installed `playwright` and `sharp`, or the documented `SCURI_BROWSER_RUNTIME` path to those packages. It blocks external origins and creates synthetic photos; it is an optional acceptance runner, not proof of real device/provider behaviour. Keep bulky generated images/browser artifacts outside Git. See the checklist for its full scope and recorded 19 September metrics.

## Regression areas to preserve

- Fresh-device/Drive-disconnected metadata and unavailable photos, preflight protection, explicit deletion, stale acknowledgements, upload checkpoints and duplicate-safe backup resume.
- Add page in populated projects, stale project-bound intents, filter parity/combined filters and nonmutating browsing/cancel.
- Exact panorama frame proportions, normalized geometry, gutters/borders, negative zoom, legacy/free-position compatibility, both-axis dragging, centre/reset/Undo and repeated placements.
- Editor/thumbnail/preview/export shared geometry, proportional larger output, original-quality preview, advisory quality check and no viewport/selection state in saved compositions.
- Navigation versus photo/frame gestures at reduced/enlarged viewport scales, cancellation, touch hit areas, ratio locks, coordinated resize, fixed/zero gaps, margins and reusable-template snapshots.
- Native gallery scroll without feedback writes, delayed state/height-only changes, deliberate restoration/reset, library identity, derived caches and zero eager original downloads.
- Optional page/template text: exact bundled faces, shared wrapping/spacing at each output size, draft/commit/cancel/Undo, scaled dragging, independent snapshots, missing-byte preservation and local/cloud/backup round trips. Missing template schema must retain local text, never report a text-dropping save as synced.

## Outstanding acceptance

Use the [Project photos release checklist](docs/PROJECT_PHOTOS_RELEASE_CHECKLIST.md) for detailed cases. These are **outstanding**, not failures proved by the documentation task:

1. Physical iPad Air 11-inch M2 Safari: momentum scrolling, Pencil/touch/pinch, keyboard/focus, virtual keyboard, orientation, memory/suspension and native Files/Photos/share sheets. Confirm the reported iPadOS version when testing. Desktop viewport emulation does not certify this.
2. An explicitly authorized disposable project across two signed-in devices: independent Supabase/Drive connection; complete saved layout/assignment/crop/library metadata; lazy image restoration; cached-preview edit followed by original hydration; offline/reconnect and interrupted backup checkpoints. Test explicit placement deletion without deleting originals and preserve all existing user projects. Parent/child writes remain nontransactional even if a sample round trip passes.
3. Read-only live setup inspection followed by separately authorized corrections if needed: Supabase schema/RLS/grants/revision behaviour; auth redirects/SMTP; Google Picker/Drive/Photos API, consent, scopes and exact origins; appropriate public versus private environment values. The user-reported photo_library migration/timestamp alignment is not fresh verification.
4. Real picker cancellation/denial/multiselect/expiry and source bytes; lost upload responses/session expiry/resume; live account changes and quotas. Never infer these from mocks.
5. Colour-managed print output and physical print sizing are not certified. Historical Islands recovery remains separate; old Drive files/new hints cannot establish lost assignments or crops.

No current test result authorizes live data repair, service changes, migrations, PR merge or deployment. Publishing a branch may automatically trigger Vercel Preview; clarify that scope when deployment is forbidden.
