-- Projects, pages and assets: Supabase becomes the source of truth for
-- project structure/state. Google Drive stores only the untouched
-- full-resolution originals and optional exports (see src/lib/project-sync.ts
-- and src/lib/google-drive.ts). This is additive and does not touch the
-- existing public.templates table or its policies.

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

create table if not exists public.projects (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 120),
  format_id text not null check (format_id in ('instagram-post', 'instagram-square', 'instagram-story')),
  active_page_id uuid,
  drive_folder_id text,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on column public.projects.revision is
  'Server-controlled optimistic-concurrency counter. Clients must send the
   revision they last synced as part of their update predicate; a write that
   does not match the current row is rejected by RLS/the WHERE clause rather
   than silently applied, and bumped automatically by set_project_revision().';

alter table public.projects enable row level security;

create policy "Users can read their projects"
  on public.projects for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Users can create their projects"
  on public.projects for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "Users can update their projects"
  on public.projects for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "Users can delete their projects"
  on public.projects for delete to authenticated
  using ((select auth.uid()) = owner_id);

create index if not exists projects_owner_updated_idx
  on public.projects (owner_id, updated_at desc)
  where deleted_at is null;

-- Every UPDATE bumps revision/updated_at server-side, ignoring whatever the
-- client sent for those two columns. Clients detect a stale write because
-- their `.eq('revision', expectedRevision)` predicate then matches zero rows.
create or replace function public.set_project_revision()
returns trigger
language plpgsql
as $$
begin
  new.revision = old.revision + 1;
  new.updated_at = now();
  new.owner_id = old.owner_id; -- ownership never transfers via an update
  new.created_at = old.created_at;
  return new;
end;
$$;

drop trigger if exists projects_set_revision on public.projects;
create trigger projects_set_revision
  before update on public.projects
  for each row
  execute function public.set_project_revision();

-- ---------------------------------------------------------------------------
-- project_pages
-- ---------------------------------------------------------------------------

create table if not exists public.project_pages (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  position integer not null default 0,
  template_id text not null,
  template_snapshot jsonb,
  background text not null default '#ffffff',
  gutter integer not null default 0,
  selected_frame_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_pages enable row level security;

create policy "Users can read their project pages"
  on public.project_pages for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Users can create their project pages"
  on public.project_pages for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "Users can update their project pages"
  on public.project_pages for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "Users can delete their project pages"
  on public.project_pages for delete to authenticated
  using ((select auth.uid()) = owner_id);

create index if not exists project_pages_project_position_idx
  on public.project_pages (project_id, position);

create or replace function public.touch_project_page()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists project_pages_touch on public.project_pages;
create trigger project_pages_touch
  before update on public.project_pages
  for each row
  execute function public.touch_project_page();

-- ---------------------------------------------------------------------------
-- project_assets
-- ---------------------------------------------------------------------------

create table if not exists public.project_assets (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  page_id uuid not null references public.project_pages(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  frame_id text not null,
  blob_key text not null,
  drive_file_id text,
  drive_preview_id text,
  source_filename text,
  mime_type text,
  width integer,
  height integer,
  file_size bigint,
  crop jsonb not null default '{"positionX":0,"positionY":0,"zoom":1}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (page_id, frame_id)
);

alter table public.project_assets enable row level security;

create policy "Users can read their project assets"
  on public.project_assets for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Users can create their project assets"
  on public.project_assets for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "Users can update their project assets"
  on public.project_assets for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "Users can delete their project assets"
  on public.project_assets for delete to authenticated
  using ((select auth.uid()) = owner_id);

create index if not exists project_assets_project_idx
  on public.project_assets (project_id);

create or replace function public.touch_project_asset()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists project_assets_touch on public.project_assets;
create trigger project_assets_touch
  before update on public.project_assets
  for each row
  execute function public.touch_project_asset();

-- ---------------------------------------------------------------------------
-- Lock down anon access, matching the existing templates table.
-- ---------------------------------------------------------------------------

revoke all privileges on table public.projects from anon;
revoke all privileges on table public.project_pages from anon;
revoke all privileges on table public.project_assets from anon;

grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.project_pages to authenticated;
grant select, insert, update, delete on public.project_assets to authenticated;
