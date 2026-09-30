# Repository and Drive documentation refresh — 26 September 2026

Documentation-only follow-up after the [text-tools release](2026-09-26-text-release.md). The user requested all Scuri documentation updated. Existing [PR #31](https://github.com/NewGhee98/scuri/pull/31), branch `docs/text-release-record`, is used for the repository changes and remains open and unmerged. The four existing Drive documents were edited in place; no new copies or sharing permissions were created.

## Fresh baseline

- Local checkout started clean at `e53819a7c1802792e35329ec48acd58cdafc17bc`, the release-record documentation commit. Its tree matched the previously published PR #31 head `8c9cc62527a6927fdf2ee023c69e1e6de23ebc97` (`1d70680dbbf99beb37a17950d69ec3e842a59319`). Local and browser-published ancestry differs; compare full trees, not short commit IDs.
- Public GitHub API read at **10:18:19 UTC**: main remained [`5446dd3706ef2b206d141c9ef06dfa8bc2e1689f`](https://github.com/NewGhee98/scuri/commit/5446dd3706ef2b206d141c9ef06dfa8bc2e1689f), tree `999f5bd60dd027e4cdfbd4a5b1bcf5f53cb5aae1`. PR #31 remained open/unmerged at the expected head; older [PR #14](https://github.com/NewGhee98/scuri/pull/14) also remained open and was not assessed for merge.
- Authenticated [Vercel production detail](https://vercel.com/nugee/scuri/8KQocDzx1muqMTuVCzoJVkGWthk6) read at **10:14 UTC**: Ready / Production / Current, source main `5446dd3`, with [scuri.vercel.app](https://scuri.vercel.app) assigned. No production deployment or configuration change was performed by this refresh. The existing branch integration can create an automatic Preview when documentation is published.

## Current summaries and history

START_HERE remains the canonical current-status summary; README covers product/setup; PROJECT_CONTEXT owns technical invariants; VERIFICATION and the release checklist distinguish recorded checks from outstanding acceptance. The current sections identify PR #30 as live, PR #31 as separate review work, and the reusable-template text migration as applied with bounded release evidence. An obsolete README anchor and an older ambiguous verification sentence were corrected.

Drive summaries now cover movable text, Cinzel/Cormorant Garamond/Inter, one style per box, spacing/colour/size, gesture separation, draft commit rules, proportional export, the additive migration and current limits. Older PR #29 and PR #28 observations remain dated history. The former current statements saying PR #29 was latest and no handoff PR had been published were replaced in place. Drive links point to PR #31's START_HERE and technical documents while it is unmerged; they explicitly identify the review branch.

The 20 September audit and both repository historical archives were retained. The timeline's earlier chronological text from August 5 through the PR #29 record and preservation limits was compared before/after and retained in order. The earlier audit is explicitly labelled historical, rather than being presented as today's verification.

## Drive read-backs

Each document was exported before editing, updated at its existing ID, copied/exported again and compared with the intended complete normalized text. All four matched. Each showed **Saved to Drive** and **Private to only me** after editing; no sharing control was used.

| Existing document | Verified result |
| --- | --- |
| [Product Overview](https://docs.google.com/document/d/1R1yIt6UgGGTSJAnbp1wzg6ZZTLNyseoxrXUeJtdug3s/edit) | Current release, workflow, text controls, boundaries and handoff links saved/read back |
| [Status & Roadmap](https://docs.google.com/document/d/1NnVgZOhONDBdp9_tZMU2mngKThWCbRVT6K-xNOqbi2g/edit) | Shipped text, open documentation PR, acceptance and separately scoped backlog saved/read back |
| [Upcoming Features](https://docs.google.com/document/d/1MoA7dIhztuWHU3lsp4ljRJa9EU6OgCBAumSu6KLH_HA/edit) | Text identified as shipped; device/cross-device acceptance and unapproved ideas remain separate |
| [Change Timeline](https://docs.google.com/document/d/1EzYIQcQbDIdQ-Rzzr38FwE7vnDpavuda2tsc5_JuuBw/edit) | New 26 September release/documentation events saved; earlier dated text preserved |

The first Overview paste reused Google Docs' internal clipboard identifier and did not update the text. The read-back detected that; removing the stale clipboard identifier and replacing the content produced the exact intended read-back. No successful update was inferred from the initial paste alone. Raw exports stay local; this sanitized record is the portable evidence.

## Validation and unchanged boundaries

Validation at **10:24 UTC** checked **24 Markdown documents, 349 Markdown links/anchors and 41 inline source references**, with no missing targets, warnings or whitespace errors. The managed AGENTS block and historical repository files remained unchanged; all changed paths are Markdown. All **34 public URLs** checked with HTTP HEAD returned success. The other 31 links are authenticated Drive/Vercel or local/setup references: the four documents and current production were checked in the browser, older deployment links remain historical provenance, and setup destinations do not prove live configuration. Publication must match the checked local full tree. No credentials, private project photos or bulky browser exports are committed.

**Not rerun:** application tests, typecheck, lint, production build, signed-in app journeys or database queries. The **533 tests / 41 files** and other implementation checks remain recorded release evidence. This task does not add new engineering acceptance.

No application code, dependencies, SQL, migrations, service settings, saved projects, placements, crops or original files were changed. Missing bytes remain distinct from deletion intent. Nontransactional cross-device child writes, physical-iPad and real two-device text acceptance, direct Google-picker configuration/flows, interrupted upload resume, colour-managed printing and historical Islands recovery remain unresolved or unverified as previously documented. The template-text migration's recorded preservation read-back does not verify unrelated Supabase or Google configuration. Documentation completion does not authorize addressing those items.
