-- PREPARED FOR REVIEW ONLY. No live migration was run.
-- project_assets requires a page_id/frame_id, so it cannot represent unassigned
-- project photos without changing existing assignment constraints.
-- This additive field shares projects' owner RLS and revision gate. Old clients
-- omit it from updates and therefore leave it untouched. No assets are changed,
-- backfilled, deleted or repurposed. Existing assignments seed the library on read.
begin;

alter table public.projects
  add column if not exists photo_library jsonb not null default '[]'::jsonb
  check (jsonb_typeof(photo_library) = 'array');

comment on column public.projects.photo_library is
  'Original-photo metadata independent of placement: blobKey, dimensions, filename, MIME, size and Drive IDs. No image bytes or live Drive manifest. Clients preserve the union of known originals; frame deletion does not remove library membership.';

commit;
