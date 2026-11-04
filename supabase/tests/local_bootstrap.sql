-- Local-only shim. Supabase provides these roles, auth.users and auth.uid()
-- already; this file is never applied to a hosted project.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;

create table auth.users (
  id uuid primary key,
  email text,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Mirrors Supabase's auth.uid(): reads the verified JWT subject set by
-- PostgREST, never a client-supplied table column.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;

-- Local-only Realtime shim. Hosted Supabase ships the realtime schema,
-- realtime.send() and realtime.topic(); this records broadcasts so the stock
-- trigger can be asserted without a websocket.
create schema realtime;

create table realtime.messages (
  id bigint generated always as identity primary key,
  topic text not null,
  extension text not null default 'broadcast',
  event text not null,
  payload jsonb not null,
  private boolean not null default true,
  inserted_at timestamptz not null default now()
);

create or replace function realtime.send(
  payload jsonb,
  event text,
  topic text,
  private boolean default true
)
returns void
language sql
as $$
  insert into realtime.messages (payload, event, topic, private)
  values (payload, event, topic, private);
$$;

create or replace function realtime.topic()
returns text
language sql
stable
as $$
  select coalesce(current_setting('realtime.topic', true), '');
$$;

grant usage on schema realtime to authenticated;
grant select on realtime.messages to authenticated;
