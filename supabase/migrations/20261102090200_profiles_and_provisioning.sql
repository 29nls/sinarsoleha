-- 0003 — profiles and auth provisioning
-- New Auth users receive a cashier profile that is inactive until an owner
-- activates it. Role is never read from user_metadata.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'cashier',
  is_active boolean not null default false,
  activated_at timestamptz,
  activated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_not_blank check (btrim(full_name) <> ''),
  constraint profiles_role_valid check (role in ('owner', 'cashier', 'inventory_staff')),
  constraint profiles_activated_at_consistency check (is_active = false or activated_at is not null)
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create index profiles_role_active_idx on public.profiles (role) where is_active = true;

-- Authorization helper. SECURITY DEFINER so RLS policies can read profiles
-- without granting clients a second path to that table. Role comes from the
-- database row, never from user_metadata or a client-supplied claim.
create or replace function private.has_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and p.role = any (p_roles)
  );
$$;

revoke all on function private.has_role(text[]) from public;
grant execute on function private.has_role(text[]) to authenticated;

-- Used only inside SECURITY DEFINER mutations. Raises instead of returning a
-- boolean so a forgotten check cannot silently continue.
create or replace function private.require_active_role(p_roles text[])
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED: Sesi tidak valid. Masuk kembali.';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_user_id
      and p.is_active = true
      and p.role = any (p_roles)
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN: Peran akun ini tidak diizinkan untuk operasi tersebut.';
  end if;

  return v_user_id;
end;
$$;

revoke all on function private.require_active_role(text[]) from public;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  v_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
  if v_name is null then
    v_name := nullif(split_part(coalesce(new.email, ''), '@', 1), '');
  end if;
  if v_name is null then
    v_name := 'Pengguna Baru';
  end if;

  insert into public.profiles (id, full_name, role, is_active)
  values (new.id, left(v_name, 120), 'cashier', false)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

-- Backfill accounts that existed before this migration. They stay inactive.
insert into public.profiles (id, full_name, role, is_active)
select
  u.id,
  left(
    coalesce(
      nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), ''),
      nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
      'Pengguna Baru'
    ),
    120
  ),
  'cashier',
  false
from auth.users u
on conflict (id) do nothing;
