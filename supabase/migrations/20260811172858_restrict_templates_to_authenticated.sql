revoke all privileges on table public.templates from anon;

grant select, insert, update, delete
  on table public.templates
  to authenticated;
