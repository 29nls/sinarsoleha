-- 0001 — extensions, private schema, helpers, default privileges
-- Applied to a fresh database; the starter SQL was reference only.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- New objects must never inherit API access. Explicit grants follow in 0009.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Role helpers are created in 0003, after public.profiles exists. PostgreSQL
-- validates SQL function bodies at creation time, so they cannot live here.
