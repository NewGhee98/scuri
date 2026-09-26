-- REVIEW ONLY: additive support for reusable text placeholders.
-- Page instances use project_pages.template_snapshot; no project/asset changes.
-- Apply through the normal migration review process before releasing template text.
alter table public.templates
  add column if not exists text_layers jsonb not null default '[]'::jsonb
  constraint templates_text_layers_array check (jsonb_typeof(text_layers) = 'array');
-- Existing owner-only RLS/grants are unchanged. No originals or assets are touched.
