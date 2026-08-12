Scuri — Project Context
Last updated: 2026-08-12
How to use this file
This is the handoff / source-of-truth context for future Scuri chats and coding sessions.
At the start of a new Scuri chat:
Read this file first.
Verify any live GitHub, Vercel, or Supabase state before acting; branch heads, deployment IDs, PR status, environment variables, and migration state can change.
Preserve the product decisions below unless the user explicitly changes them.
After a meaningful release, architecture change, migration, or product decision, update this file.
Never paste secret keys, database passwords, JWT secrets, service-role keys, or access tokens into chat or commit them to Git.
---
Product summary
Scuri is a web app for building photo layouts/projects and exporting them. The product is being shaped primarily around iPad and desktop, while still supporting iPhone use.
Core mental model:
Projects → project pages/layouts → editor
There is also a reusable Templates library for layouts that can be reused across projects.
GitHub repository:
`https://github.com/NewGhee98/scuri`
Vercel production domain:
`https://scuri.vercel.app`
---
Ironclad product requirement: templates must persist across devices
Once a custom template is created and saved, it must become part of the user's general template library persistently, not just in local browser storage.
Expected behaviour:
Create a template on iPhone.
Sign in with the same account on iPad or desktop.
The saved template is present there as well.
Local drafts may exist before sign-in, but saved cloud templates must survive new browser/app instances and device changes.
This cross-device persistence requirement is one of the main reasons Supabase was introduced.
---
Navigation / project UX decisions
The desired hierarchy is:
Projects → Project → layouts/pages/templates → Editor
Product decisions already agreed:
A persistent top navigation should include Projects.
Clicking Projects should always return to an overview of all current projects.
Opening a project should show all layouts/pages currently in that project.
A user can open any layout/page and edit it.
Layouts/pages inside a project can be reordered.
The project page should have an Export all action that exports every layout/page in the current order.
Changes should autosave where safe and practical.
Deletion should be allowed where it can be implemented safely.
Optimise the interaction model primarily for iPad / desktop.
The app should not trap the user in a newly created project; back/navigation actions must have coherent destinations.
---
Templates feature
The templates release introduces:
A Templates section in top navigation.
Built-in reusable templates.
Creation of custom templates.
A personal My templates cloud library.
Email magic-link sign-in through Supabase.
Cross-device cloud synchronisation for saved templates.
Current UI has shown states including:
`Cloud connection required` before Supabase variables were available.
`Sign in for permanent cross-device templates` once the app could see Supabase configuration.
`Synced as <user>` after successful email authentication.
Upcoming template feature
Allow images to be resized / repositioned within a frame.
Existing living backlog document:
Scuri — Upcoming Features
`https://docs.google.com/document/d/1MoA7dIhztuWHU3lsp4ljRJa9EU6OgCBAumSu6KLH_HA/edit`
Existing project history document:
Scuri — Change Timeline
`https://docs.google.com/document/d/1EzYIQcQbDIdQ-Rzzr38FwE7vnDpavuda2tsc5_JuuBw/edit`
Other Scuri project docs have also existed (for example Product Overview / Status & Roadmap); use them as supporting history, but this file should remain the concise technical/product handoff.
---
GitHub / release workflow
Feature work has been developed on branches and deployed as Vercel Previews.
Relevant PR history:
PR #4 — iPhone/Safari drag-and-drop callout fix (`agent/fix-ios-drag-callout`).
PR #5 — project/navigation work.
PR #6 — cloud template designer / templates release (`agent/cloud-template-designer`), intended to supersede #4 and #5.
Important: commit IDs and exact PR heads have changed during development. Previous chats mentioned multiple heads (for example `1da2267` and later `8aa0959`). Do not treat old commit IDs in this file as current truth. Query GitHub/Vercel first.
Preferred release workflow:
Work on a feature branch.
Open/update PR.
Let Vercel create a Preview deployment.
Test the Preview thoroughly.
Merge the PR into `main` when approved.
Let Vercel deploy Production automatically from `main`.
Verify production after deployment.
Avoid manually promoting a feature-branch Preview to Production unless there is a deliberate reason.
A prior audit reported PR #6 as mergeable and locally healthy (TypeScript, ESLint, tests and production build passing), but these checks must be re-run/re-verified before a real merge.
---
Safari / iPhone issue already addressed
An iPhone Safari bug caused native selection/drag actions such as Copy / Search-style callouts to appear while rearranging photos on the canvas.
PR #4 addressed this behaviour and had a READY preview in a prior session. PR #6 was intended to supersede this work, so verify the fix remains present in the final PR #6/main code before closing the older PR.
---
Supabase
Project
Supabase project/resource:
`supabase-teal-nest`
Vercel shows the Supabase integration connected to the `scuri` project.
Correct browser environment variables
Scuri expects these exact variables:
`NEXT_PUBLIC_SUPABASE_URL`
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
They have been manually created in Vercel for Production and Preview using the values supplied by the existing Supabase integration.
Mis-prefixed integration variables
The original Vercel/Supabase connection created many variables with an incorrect custom prefix, resulting in names such as:
`NEXT_PUBLIC_SUPABASE_SUPABASE_URL`
`NEXT_PUBLIC_SUPABASE_SUPABASE_PUBLISHABLE_KEY`
`NEXT_PUBLIC_NEXT_PUBLIC_SUPABASE_SUPABASE_URL`
It also created sensitive/server values with `NEXT_PUBLIC_` in their names, including variants corresponding to:
Supabase secret key
service-role key
JWT secret
Postgres password / connection details
Security note: there is no evidence from the debugging session that these secret values were actually exposed to end users, and their values were not pasted into chat. However, they should not be used in client-side code. Once the connection is stable, clean up the integration configuration carefully so secrets do not carry misleading `NEXT_PUBLIC_` names. Do not delete/rotate blindly without first confirming what the deployed app and integration actually depend on.
Vercel deployment behaviour
Environment-variable additions/changes require a new Vercel deployment/redeploy to be picked up by a Next.js build.
A Preview was successfully redeployed after adding the correct variables, and the Templates page changed from `Cloud connection required` to the sign-in UI. This proved the app could see the Supabase public configuration.
---
Supabase Auth
Email magic-link authentication is enabled and has been tested successfully.
URL configuration currently set
Site URL
`https://scuri.vercel.app`
Allowed redirect URLs
`https://scuri.vercel.app/**`
`https://*-nugee.vercel.app/**`
`http://localhost:3000/**` (local development)
Previously the Site URL was `http://localhost:3000` with no redirect allow-list, which caused successful magic-link authentication to redirect to localhost. That has been corrected.
A later phone test successfully returned to Scuri and the Templates UI showed the user as signed in / synced.
Supabase's built-in email sender has a low testing quota, so avoid repeatedly requesting magic links while debugging.
---
Current cloud-sync problem to resolve
After successful sign-in on a phone, Scuri showed:
> Cloud templates could not be loaded. Your local drafts are unchanged.
At the same time, the Templates screen showed the user as synced/authenticated.
This proves:
Vercel → Supabase public config is working.
Supabase Auth is working.
Magic-link redirects are working.
A valid user session exists in Scuri.
The remaining failure is therefore in the database read/write layer (schema/table, migration, RLS/policies, or app/schema mismatch), not the basic Supabase connection or email auth.
Immediate next diagnostic
Open Supabase → Table Editor and verify whether a `templates` table exists.
If `templates` does not exist: apply the prepared Scuri migration rather than creating an ad-hoc table by hand.
If `templates` does exist: inspect its schema and Row Level Security policies and compare them with the code's expected columns/queries.
Do not assume migration state from old chat notes; verify the live Supabase project first.
Migration drift note from a prior audit
A prior audit reported a possible repository/Supabase migration-history mismatch:
Repository reportedly had `20260810_create_templates.sql`.
Supabase reportedly recorded applied versions named approximately:
`20260811172718_create_templates`
`20260811172858_restrict_templates_to_authenticated`
The audit recommended aligning the repository migration filenames/content with the applied Supabase history so future migration tooling does not report false drift.
This has not been re-verified in the current debugging session. Treat it as a lead, not current truth.
---
Required RLS / data ownership behaviour
Cloud templates must be private to their signed-in owner.
Expected policy behaviour:
Authenticated users can read their own templates.
Authenticated users can insert templates owned by themselves.
Authenticated users can update their own templates.
Authenticated users can safely delete their own templates if deletion is enabled.
Users must not be able to read or mutate another user's templates.
Never solve a client access problem by shipping a Supabase secret/service-role key to the browser or disabling RLS globally.
---
Cross-device acceptance test
Once the database layer is fixed, perform this exact end-to-end test:
Open Scuri on iPhone.
Sign in with email.
Create a custom template.
Save it.
Confirm it appears under My templates.
Open Scuri independently on iPad (or desktop) in a fresh browser/app instance.
Sign in with the same email.
Confirm the template appears without manual transfer.
Edit or create another template on the second device.
Return to the first device and use Sync now / refresh as appropriate.
Confirm the library converges correctly.
Confirm local project drafts are not unexpectedly lost or overwritten.
Only after this passes should the cloud-template feature be considered complete.
---
Production vs Preview caution
During testing, a successful sign-in was observed on the production domain `scuri.vercel.app` even though much of the templates work originated on a Preview/feature branch.
Before release work, explicitly verify:
what commit `main` points to;
what commit PR #6 points to;
what commit/branch the current Production deployment was built from;
what Preview deployment corresponds to PR #6.
Do not infer this from old screenshots because the deployment state changes over time.
---
Open release tasks
The current order of operations should be:
Diagnose/fix the `Cloud templates could not be loaded` database error.
Verify `templates` schema and migrations in live Supabase.
Verify/repair RLS ownership policies if necessary.
Run the cross-device iPhone ↔ iPad/desktop acceptance test.
Re-audit the Vercel environment-variable configuration and remove the erroneous custom-prefix setup safely.
Re-run TypeScript, ESLint, tests and production build.
Re-check PR #6 and migration drift against live GitHub/Supabase.
Test a fresh Vercel Preview.
Merge the final PR to `main` only after approval.
Let Vercel deploy Production from `main`.
Verify production sign-in, cloud sync, template creation, editing and deletion.
Close older PRs only once their fixes are confirmed present in the merged code.
---
Product backlog / later ideas
Confirmed upcoming feature:
Resize/reposition images within their frame.
Continue adding new ideas to the Scuri — Upcoming Features document and periodically summarise accepted product decisions into this context file.
---
Guidance for future coding agents / chats
Before making changes:
Read this file.
Inspect the current repository and deployment state rather than relying on stale commit IDs.
Prefer small, reviewable PRs and Preview deployments.
Preserve existing user data and local drafts during cloud-sync changes.
Keep Supabase secret/service-role credentials server-only; the client should use only the public URL + publishable key under the exact expected `NEXT_PUBLIC_` names.
Do not weaken RLS as a shortcut.
Treat iPad/desktop as the primary interaction target, while keeping iPhone behaviour usable.
Cloud template persistence across devices is a non-negotiable acceptance criterion.
