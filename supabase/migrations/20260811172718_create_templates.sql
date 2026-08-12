create table if not exists public.templates (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 80),
  format_id text not null check (format_id in ('instagram-post', 'instagram-square', 'instagram-story')),
  background text not null default '#ffffff',
  frames jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'saved')),
  source_template_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.templates to authenticated;
alter table public.templates enable row level security;

create policy "Users can read their templates"
  on public.templates for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Users can create their templates"
  on public.templates for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "Users can update their templates"
  on public.templates for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "Users can delete their templates"
  on public.templates for delete to authenticated
  using ((select auth.uid()) = owner_id);

create index if not exists templates_owner_updated_idx
  on public.templates (owner_id, updated_at desc);
