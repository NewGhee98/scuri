# Scuri — Project Context

_Last updated: 2026-08-12_

## How to use this file

This is the handoff / source-of-truth context for future Scuri chats and coding sessions.

At the start of a new Scuri chat:

1. Read this file first.
2. Verify any **live** GitHub, Vercel, or Supabase state before acting; branch heads, deployment IDs, PR status, environment variables, and migration state can change.
3. Preserve the product decisions below unless the user explicitly changes them.
4. After a meaningful release, architecture change, migration, or product decision, update this file.
5. Never paste secret keys, database passwords, JWT secrets, service-role keys, or access tokens into chat or commit them to Git.

---

## Product summary

**Scuri** is a web app for building photo layouts/projects and exporting them. The product is being shaped primarily around **iPad and desktop**, while still supporting iPhone use.

Core mental model:

**Projects → project pages/layouts → editor**

There is also a reusable **Templates** library for layouts that can be reused across projects.

GitHub repository:

- `https://github.com/NewGhee98/scuri`

Vercel production domain:

- `https://scuri.vercel.app`

---

## Ironclad product requirement: templates must persist across devices

Once a custom template is created and saved, it must become part of the user's general template library **persistently**, not just in local browser storage.

Expected behaviour:

- Create a template on iPhone.
- Sign in with the same account on iPad or desktop.
- The saved template is present there as well.
- Local drafts may exist before sign-in, but saved cloud templates must survive new browser/app instances and device changes.

This cross-device persistence requirement is one of the main reasons Supabase was introduced.

---

## Navigation / project UX decisions

The desired hierarchy is:

**Projects → Project → layouts/pages/templates → Editor**

Product decisions already agreed:

- A persistent top navigation should include **Projects**.
- Clicking **Projects** should always return to an overview of all current projects.
- Opening a project should show all layouts/pages currently in that project.
- A user can open any layout/page and edit it.
- Layouts/pages inside a project can be reordered.
- The project page should have an **Export all** action that exports every layout/page in the current order.
- Changes should autosave where safe and practical.
- Deletion should be allowed where it can be implemented safely.
- Optimise the interaction model primarily for **iPad / desktop**.
- The app should not trap the user in a newly created project; back/navigation actions must have coherent destinations.

---

## Templates feature

The templates release introduces:

- A Templates section in top navigation.
- Built-in reusable templates.
- Creation of custom templates.
- A personal **My templates** cloud library.
- Email magic-link sign-in through Supabase.
- Cross-device cloud synchronisation for saved templates.

Current UI has shown states including:

- `Cloud connection required` before Supabase variables were available.
- `Sign in for permanent cross-device templates` once the app could see Supabase configuration.
- `Synced as <user>` after successful email authentication.

### Upcoming template feature

- Allow images to be **resized / repositioned within a frame**.

Existing living backlog document:

- **Scuri — Upcoming Features**
- `https://docs.google.com/document/d/1MoA7dIhztuWHU3lsp4ljRJa9EU6OgCBAumSu6KLH_HA/edit`

Existing project history document:

- **Scuri — Change Timeline**
- `https://docs.google.com/document/d/1EzYIQcQbDIdQ-Rzzr38FwE7vnDpavuda2tsc5_JuuBw/edit`

Other Scuri project docs have also existed (for example Product Overview / Status & Roadmap); use them as supporting history, but this file should remain the concise technical/product handoff.

---

## GitHub / release workflow

Feature work has been developed on branches and deployed as Vercel Previews.

Relevant PR history:

- **PR #4** — iPhone/Safari drag-and-drop callout fix (`agent/fix-ios-drag-callout`). Closed as superseded by #6.
- **PR #5** — project/navigation work. Closed as superseded by #6.
- **PR #6** — cloud template designer / templates release (`agent/cloud-template-designer`). Squash-merged into `main` on 2026-08-12.

Important: commit IDs and exact PR heads can change during development. **Query GitHub/Vercel first rather than relying on old chat screenshots.**

Preferred release workflow:

1. Work on a feature branch.
2. Open/update PR.
3. Let Vercel create a **Preview** deployment.
4. Test the Preview thoroughly.
5. Merge the PR into `main` when approved.
6. Let Vercel deploy **Production automatically from `main`**.
7. Verify production after deployment.
8. Avoid manually promoting a feature-branch Preview to Production unless there is a deliberate reason.

---

## Safari / iPhone issue already addressed

An iPhone Safari bug caused native selection/drag actions such as Copy / Search-style callouts to appear while rearranging photos on the canvas.

The final #6 release retains the callout-suppression changes from PR #4. Physical iPhone verification remains useful for Safari-native gesture behaviour that cannot be fully reproduced by server/build checks.

---

## Supabase

### Project

Supabase project/resource:

- `supabase-teal-nest`

Vercel shows the Supabase integration connected to the `scuri` project.

### Correct browser environment variables

Scuri expects these exact variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

They have been manually created in Vercel for **Production and Preview** using the values supplied by the existing Supabase integration.

### Mis-prefixed integration variables

The original Vercel/Supabase connection created many variables with an incorrect custom prefix, resulting in names such as:

- `NEXT_PUBLIC_SUPABASE_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_NEXT_PUBLIC_SUPABASE_SUPABASE_URL`

It also created sensitive/server values with `NEXT_PUBLIC_` in their names, including variants corresponding to:

- Supabase secret key
- service-role key
- JWT secret
- Postgres password / connection details

**Security note:** there is no evidence from the debugging session that these secret values were actually exposed to end users, and their values were not pasted into chat. However, they should not be used in client-side code. Once the connection is stable, clean up the integration configuration carefully so secrets do not carry misleading `NEXT_PUBLIC_` names. Do not delete/rotate blindly without first confirming what the deployed app and integration actually depend on.

### Vercel deployment behaviour

Environment-variable additions/changes require a new Vercel deployment/redeploy to be picked up by a Next.js build.

---

## Supabase Auth

Email magic-link authentication is enabled and has been tested successfully.

### URL configuration currently set

**Site URL**

- `https://scuri.vercel.app`

**Allowed redirect URLs**

- `https://scuri.vercel.app/**`
- `https://*-nugee.vercel.app/**`
- `http://localhost:3000/**` (local development)

Previously the Site URL was `http://localhost:3000` with no redirect allow-list, which caused successful magic-link authentication to redirect to localhost. That has been corrected.

Supabase's built-in email sender has a low testing quota, so avoid repeatedly requesting magic links while debugging.

---

## Supabase database state verified during the 2026-08-12 release

Live project `supabase-teal-nest` was verified **ACTIVE_HEALTHY**.

Live migration history matches the repository:

- `20260811172718_create_templates`
- `20260811172858_restrict_templates_to_authenticated`

The live `templates` table schema matches the app's queries. RLS is enabled and authenticated owner-only policies exist for SELECT, INSERT, UPDATE and DELETE.

A live ACL inspection showed broader **non-DML** table privileges than the release description originally implied. Owner-only RLS and DML access are correct, but privilege hardening should be reviewed separately before changing the database. No speculative privilege migration was applied during this release.

---

## Cross-device acceptance test

This remains the final user-device acceptance test for cloud templates:

1. Open Scuri on iPhone.
2. Sign in with email.
3. Create a custom template.
4. Save it.
5. Confirm it appears under **My templates**.
6. Open Scuri independently on iPad (or desktop) in a fresh browser/app instance.
7. Sign in with the same email.
8. Confirm the template appears without manual transfer.
9. Edit or create another template on the second device.
10. Return to the first device and use **Sync now** / refresh as appropriate.
11. Confirm the library converges correctly.
12. Confirm local project drafts are not unexpectedly lost or overwritten.

Only after this passes should the cloud-template feature be considered fully accepted on physical devices.

---

## Production vs Preview rule

Production should come from `main`. Feature branches should create Vercel Previews only.

Before future release work, explicitly verify:

- what commit `main` points to;
- what commit the active PR points to;
- what commit/branch the current Production deployment was built from;
- what Preview deployment corresponds to the active PR.

Do not infer this from old screenshots because deployment state changes over time.

---

## Release status — 2026-08-12

The cloud Templates release has been merged and deployed.

Verified live state after release:

- **PR #6** (`agent/cloud-template-designer`) was squash-merged into `main`.
- Release merge commit on `main`: `556518085bf3e259a0bb18466e5965f079a11120`.
- **Vercel Production** deployed automatically from that exact `main` commit; no feature-branch Preview was manually promoted.
- Production deployment `dpl_4p3aUsaEtRz31jAre7jE7StiYP8J` reached **READY** and `https://scuri.vercel.app` returned HTTP 200.
- The production Next.js build compiled successfully and completed TypeScript checking.
- No Vercel runtime error clusters were present in the post-release check window.
- **PR #4** and **PR #5** were closed as superseded by #6.
- Supabase project `supabase-teal-nest` was verified **ACTIVE_HEALTHY**.
- Live Supabase migration history matches the repository files.
- The live `templates` table schema matches the app queries, RLS is enabled, and owner-only SELECT/INSERT/UPDATE/DELETE policies are present for authenticated users.
- `@supabase/supabase-js` is pinned to `2.112.2`.
- Two final PR review issues were fixed before merge:
  - legacy project migration no longer risks clearing the only saved copy if the new localStorage write fails;
  - copying a built-in template now materialises its gutter/inset geometry so the custom copy keeps the same visual spacing.
- Two regression tests were added for those final fixes. The earlier 29-test suite had passed before those additions; the final Vercel production build passed, but the two newly added unit tests were not independently run in this connector-only session.

Still outstanding / requires user-device validation:

- Run the physical cross-device acceptance test using the same account on iPhone and iPad/desktop.
- Re-audit and carefully clean up the old mis-prefixed Vercel/Supabase environment-variable entries once the cross-device flow is confirmed. Do not delete or rotate secrets blindly.
- Review the broader non-DML table privileges separately before applying any privilege-hardening migration.

Going forward, treat `main` as the production source of truth and keep feature branches Preview-only unless there is an explicit reason to do otherwise.

---

## Product backlog / later ideas

Confirmed upcoming feature:

- Resize/reposition images within their frame.

Continue adding new ideas to the **Scuri — Upcoming Features** document and periodically summarise accepted product decisions into this context file.

---

## Guidance for future coding agents / chats

Before making changes:

- Read this file.
- Inspect the current repository and deployment state rather than relying on stale commit IDs.
- Prefer small, reviewable PRs and Preview deployments.
- Preserve existing user data and local drafts during cloud-sync changes.
- Keep Supabase secret/service-role credentials server-only; the client should use only the public URL + publishable key under the exact expected `NEXT_PUBLIC_` names.
- Do not weaken RLS as a shortcut.
- Treat iPad/desktop as the primary interaction target, while keeping iPhone behaviour usable.
- Cloud template persistence across devices is a non-negotiable acceptance criterion.
