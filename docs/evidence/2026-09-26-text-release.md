# Text tools production release — 26 September 2026

The user explicitly requested deployment after the local implementation handoff. [PR #30](https://github.com/NewGhee98/scuri/pull/30) was merged into main; this record documents actual release actions, separately from [earlier local checks](2026-09-26-text-tools.md). Publication of this record is documentation-only and leaves the tested application unchanged.

## Source and deployment

- Tested local source: `c4b7bd7ade8055ab486585612db09aa4bb84dace`, based on preserved documentation commit `b206a1e`. The prior application tree matched PR #29.
- Published branch source: [`75603a6294092cd1209c17afa97b8cece0e8f563`](https://github.com/NewGhee98/scuri/commit/75603a6294092cd1209c17afa97b8cece0e8f563). Public GitHub API comparison at **09:41:41 UTC** confirmed all 53 changed files and the **entire tree** match the local source: `999f5bd60dd027e4cdfbd4a5b1bcf5f53cb5aae1`.
- [Vercel preview](https://vercel.com/nugee/scuri/8E3TNW88L4xGaGXmL6wpPoYHVcvz) completed successfully. GitHub showed two successful checks and no merge conflict before merge.
- Production merge: [`5446dd3706ef2b206d141c9ef06dfa8bc2e1689f`](https://github.com/NewGhee98/scuri/commit/5446dd3706ef2b206d141c9ef06dfa8bc2e1689f). A fresh main comparison at **09:48:05 UTC** confirmed the same complete tree.
- [Vercel production](https://vercel.com/nugee/scuri/8KQocDzx1muqMTuVCzoJVkGWthk6) finished at **09:47:27 UTC**, build duration 33 seconds. Authenticated dashboard read-back showed **Ready / Production / Current**, source `5446dd3`, with [scuri.vercel.app](https://scuri.vercel.app) assigned, during 09:47–09:50 UTC verification.
- Public smoke check at **09:48:58 UTC**: HTTP 200, title Scuri, 11 JS/CSS files available, text-tool and retained-feature markers present. All five font files returned the exact tested local bytes (Cinzel; Cormorant regular/italic; Inter regular/italic). This is asset/source verification, not a signed-in editing journey.

The earlier local **533 tests / 41 files, typecheck, lint and production build** were not redundantly rerun during publication; source equality carries those results to the release. Vercel independently built preview and production. No dependency or application-code changes were made during release.

## Additive database prerequisite

Used the authenticated Supabase SQL editor for the existing `supabase-teal-nest` project. Before changing it, read-only queries confirmed `templates.text_layers` absent and migration version `20260925170000` absent. Applied the committed additive column/constraint in a transaction with short lock/statement timeouts, recording `20260925170000_add_template_text_layers` in migration history in the same transaction. No UPDATE or DELETE was issued against application data.

Read-back confirmed `jsonb`, `NOT NULL`, default `'[]'::jsonb`, array-only check, one matching migration record, and no nonempty text values on existing templates. All pre-existing templates retained their previous content; project/page/asset row counts and full-row fingerprints were identical before and after. The portable record deliberately omits private record content and identifiers. Existing template RLS remained enabled; policy expressions and grants matched their preflight values. This verifies preservation, not a comprehensive security review of those inherited grants.

An initial SQL editor replacement did not replace the whole draft and returned a syntax error before any change. The corrected draft was copied back and compared exactly before execution. The transaction then returned Success, and the independent schema/data read-back above confirmed its outcome. The original migration file keeps its preparation-time review comment as provenance; it is no longer evidence of unapplied status.

## Limits and handoff

No saved user project was opened/edited for deployment verification. No photo original, Drive file, existing crop or placement was changed; no historical Islands repair was attempted. Other Supabase settings, Google API/consent/origin configuration and secret hygiene were not audited. Physical iPad Safari, native touch/keyboard/share behaviour and real two-device text persistence remain outstanding. Nontransactional project-child saves remain a separate known limitation.

At the release checkpoint, the portable documentation handoff previously held locally was included in PR #30. The four Drive summaries had not yet been edited for text tools; their then-latest update was the [20 September documentation audit](2026-09-20-documentation-audit.md). **Subsequent event:** the [26 September documentation refresh](2026-09-26-documentation-refresh.md) updated and read back all four, preserving history and private sharing. That later task did not repeat the release or migration.
