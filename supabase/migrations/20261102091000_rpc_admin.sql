-- 0011 — profile administration, first-owner bootstrap, feature flags
-- No self-service owner registration exists. The bootstrap function has no
-- EXECUTE grant and is intended for the SQL editor / postgres only.

create or replace function private.admin_upsert_profile(
  p_user_id uuid,
  p_full_name text,
  p_role text,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_active_role(array['owner']);
  v_before public.profiles%rowtype;
  v_after public.profiles%rowtype;
  v_name text;
begin
  if p_user_id is null then
    raise exception 'USER_REQUIRED' using errcode = '22023';
  end if;
  if p_role is null or p_role not in ('owner', 'cashier', 'inventory_staff') then
    raise exception using errcode = '22023', message = 'INVALID_ROLE: Peran tidak dikenal.';
  end if;
  v_name := btrim(coalesce(p_full_name, ''));
  if v_name = '' or char_length(v_name) > 120 then
    raise exception using errcode = '22023', message = 'INVALID_FULL_NAME: Nama wajib diisi, maksimal 120 karakter.';
  end if;
  if p_is_active is null then
    raise exception 'INVALID_ACTIVE_FLAG' using errcode = '22023';
  end if;

  select * into v_before
    from public.profiles p
   where p.id = p_user_id
     for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_NOT_FOUND: Profil tidak ditemukan.';
  end if;

  if v_before.role = 'owner'
     and v_before.is_active = true
     and (p_role <> 'owner' or p_is_active = false)
     and not exists (
       select 1
       from public.profiles other
       where other.role = 'owner'
         and other.is_active = true
         and other.id <> p_user_id
     ) then
    raise exception using errcode = '23514', message = 'LAST_OWNER: Tidak boleh menonaktifkan atau menurunkan owner aktif terakhir.';
  end if;

  update public.profiles p
     set full_name = v_name,
         role = p_role,
         is_active = p_is_active,
         activated_at = case
           when p_is_active = true and v_before.is_active = false then now()
           else p.activated_at
         end,
         activated_by = case
           when p_is_active = true and v_before.is_active = false then v_actor
           else p.activated_by
         end
   where p.id = p_user_id
   returning * into v_after;

  perform private.write_audit(
    v_actor,
    'profile.admin_update',
    'profiles',
    p_user_id::text,
    to_jsonb(v_before),
    to_jsonb(v_after),
    null
  );

  return to_jsonb(v_after);
end;
$$;

revoke all on function private.admin_upsert_profile(uuid, text, text, boolean) from public;

create or replace function private.bootstrap_owner(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
begin
  if p_user_id is null then
    raise exception 'USER_REQUIRED' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.profiles p where p.role = 'owner' and p.is_active = true
  ) then
    raise exception using errcode = '23514', message = 'OWNER_EXISTS: Sudah ada owner aktif. Gunakan admin_upsert_profile.';
  end if;

  select * into v_profile
    from public.profiles p
   where p.id = p_user_id
     for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_NOT_FOUND: Profil tidak ditemukan.';
  end if;

  update public.profiles p
     set role = 'owner',
         is_active = true,
         activated_at = now(),
         activated_by = null
   where p.id = p_user_id
   returning * into v_profile;

  perform private.write_audit(
    null,
    'profile.bootstrap_owner',
    'profiles',
    p_user_id::text,
    null,
    to_jsonb(v_profile),
    'Bootstrap owner pertama'
  );

  return to_jsonb(v_profile);
end;
$$;

revoke all on function private.bootstrap_owner(uuid) from public, anon, authenticated;

create or replace function private.set_feature_flag(
  p_feature_key text,
  p_enabled boolean,
  p_public_config jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_active_role(array['owner']);
  v_before public.feature_flags%rowtype;
  v_after public.feature_flags%rowtype;
begin
  if p_feature_key is null or btrim(p_feature_key) = '' then
    raise exception 'FEATURE_KEY_REQUIRED' using errcode = '22023';
  end if;
  if p_enabled is null then
    raise exception 'ENABLED_REQUIRED' using errcode = '22023';
  end if;
  if p_public_config is null or jsonb_typeof(p_public_config) <> 'object' then
    raise exception using errcode = '22023', message = 'INVALID_CONFIG: Konfigurasi harus berupa objek JSON.';
  end if;

  select * into v_before
    from public.feature_flags f
   where f.feature_key = p_feature_key
     for update;
  if not found then
    raise exception 'FEATURE_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.feature_flags f
     set enabled = p_enabled,
         public_config = p_public_config,
         updated_by = v_actor
   where f.feature_key = p_feature_key
   returning * into v_after;

  perform private.write_audit(
    v_actor,
    'feature_flag.update',
    'feature_flags',
    p_feature_key,
    to_jsonb(v_before),
    to_jsonb(v_after),
    null
  );

  return to_jsonb(v_after);
end;
$$;

revoke all on function private.set_feature_flag(text, boolean, jsonb) from public;

create or replace function public.admin_upsert_profile(
  p_user_id uuid,
  p_full_name text,
  p_role text,
  p_is_active boolean
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.admin_upsert_profile(p_user_id, p_full_name, p_role, p_is_active);
$$;

revoke all on function public.admin_upsert_profile(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_upsert_profile(uuid, text, text, boolean) to authenticated;

create or replace function public.set_feature_flag(
  p_feature_key text,
  p_enabled boolean,
  p_public_config jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.set_feature_flag(p_feature_key, p_enabled, p_public_config);
$$;

revoke all on function public.set_feature_flag(text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.set_feature_flag(text, boolean, jsonb) to authenticated;
