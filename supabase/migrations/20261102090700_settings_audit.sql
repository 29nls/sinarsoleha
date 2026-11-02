-- 0008 — feature flags and audit log foundation

create table public.feature_flags (
  feature_key text primary key,
  enabled boolean not null default false,
  public_config jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint feature_flags_key_not_blank check (btrim(feature_key) <> ''),
  constraint feature_flags_config_object check (jsonb_typeof(public_config) = 'object')
);

create trigger feature_flags_set_updated_at
before update on public.feature_flags
for each row execute function private.set_updated_at();

insert into public.feature_flags (feature_key, enabled, public_config)
values
  ('hardware.thermal_printer', false, '{}'::jsonb),
  ('hardware.barcode_scanner', false, '{}'::jsonb),
  ('payment.qris_gateway', false, '{}'::jsonb)
on conflict (feature_key) do nothing;

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action_key text not null,
  entity_name text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz not null default now(),
  constraint audit_logs_action_not_blank check (btrim(action_key) <> ''),
  constraint audit_logs_entity_not_blank check (btrim(entity_name) <> '')
);

create or replace function private.write_audit(
  p_actor_id uuid,
  p_action_key text,
  p_entity_name text,
  p_entity_id text,
  p_before jsonb,
  p_after jsonb,
  p_reason text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (
    actor_id, action_key, entity_name, entity_id, before_data, after_data, reason
  )
  values (
    p_actor_id, p_action_key, p_entity_name, p_entity_id, p_before, p_after, p_reason
  );
$$;

revoke all on function private.write_audit(uuid, text, text, text, jsonb, jsonb, text) from public;

create or replace function private.block_audit_log_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'AUDIT_LOG_IMMUTABLE: Audit log bersifat append-only.';
end;
$$;

create trigger audit_logs_immutable
before update or delete on public.audit_logs
for each row execute function private.block_audit_log_mutation();

create index audit_logs_entity_idx on public.audit_logs (entity_name, entity_id);
create index audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index audit_logs_actor_created_at_idx on public.audit_logs (actor_id, created_at desc);
