# Evidence index

[START_HERE](../../START_HERE.md) owns current status. This directory contains small, sanitized handoff records that travel with the repository. Raw logs, screenshots, synthetic fixtures, credentials and private project photos are not required to understand the release and are not committed here.

| Record | Scope |
| --- | --- |
| [Local text tools](2026-09-26-text-tools.md) | New implementation checks and isolated synthetic Chrome QA; not deployed, migration not run |
| [PR #29 production](2026-09-20-production.md) | Fresh GitHub/Vercel release identity plus clearly labelled recorded implementation, build and smoke checks |
| [Documentation audit](2026-09-20-documentation-audit.md) | Baseline preservation, documentation-only validation, Drive read-backs and review publication status |
| [Historical context](../history/PROJECT_CONTEXT_THROUGH_2026-09-20.md) | Product decisions, earlier implementations and dated releases, including the previously local-only PR #29 notes |
| [Historical verification](../history/VERIFICATION_THROUGH_2026-09-20.md) | Earlier test counts/package checks; not current verification |

GitHub source/PR links are public. Vercel dashboard and Drive document links may require existing owner access; their dated read-back summaries are portable evidence, not a promise that another session can open them. A repository migration file does not prove it ran live. The user-reported Supabase migration is explicitly not independently reverified.

## Legacy local artifacts

Earlier handoffs depended on sibling output folders and external ZIP/patch companions. Those paths are replaced with artifact names and this index in the archives. **Names are provenance, not working links or files a new session must obtain.** Historical statements that a note was “local only” remain in their dated archive; relevant release facts are now committed in the production record and historical context.

- PR #29 raw test/build output and the release/source verification JSON were available locally and inspected during this audit. Their sanitized findings are in [the production record](2026-09-20-production.md). The empty typecheck/lint logs do not themselves prove successful exits; the release notes supply that recorded claim.
- The 19 September photo-library browser report and other prior implementation/release artifacts may still be present on the original computer. Unless expressly included in the production/audit record, their contents were **not independently revalidated** by this task. Recorded older metrics remain historical in the checklist/archive.
- Original external package companions such as `SCURI_CLIENT_RELEASE.md`, `SCURI_ZOOM_ARRANGEMENTS.md`, `SCURI_UPLOAD_CHECKPOINT_FIX.md`, ZIP/patch packages and checksum files are not committed repository evidence. Their original availability is not guaranteed. Relevant decisions/check results are preserved in [CLIENT_RELEASE](../../CLIENT_RELEASE.md), [ZOOM_ARRANGEMENTS_RELEASE](../../ZOOM_ARRANGEMENTS_RELEASE.md), [UPLOAD_CHECKPOINT_FIX](../../UPLOAD_CHECKPOINT_FIX.md) and the historical verification archive. No checksum or package-reconstruction claim is made here.
- Previous browser screenshots, generated photo sets and old Drive before/after exports are not portable attachments. This task preserves the timeline's historical text and verifies the four new Drive read-backs; it does not claim to reproduce the older browser session.

When adding evidence, state the date, exact source identity, command/result or visible status, observation method and limits. If original evidence is unavailable, say so and retain the historical claim as a claim. Do not silently turn an old note into fresh proof.
