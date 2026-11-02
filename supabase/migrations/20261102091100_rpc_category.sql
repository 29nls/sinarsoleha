-- 0011 — category RPC
-- Categories remain readable to active staff. This RPC is the controlled owner
-- write path so renames/deactivations are audited and duplicate names are
-- rejected consistently. It never hard-deletes a category.

create or replace function private.upsert_category(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_active_role(array['owner']);
  v_is_new boolean;
  v_id bigint;
  v_name text;
  v_is_active boolean;
  v_before public.categories%rowtype;
  v_after public.categories%rowtype;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'INVALID_PAYLOAD: Payload kategori tidak valid.';
  end if;

  v_id := nullif(btrim(coalesce(p_payload ->> 'category_id', '')), '')::bigint;
  v_is_new := v_id is null;

  v_name := btrim(coalesce(p_payload ->> 'name', ''));
  if v_name = '' or char_length(v_name) > 120 then
    raise exception using errcode = '22023', message = 'INVALID_CATEGORY_NAME: Nama kategori wajib diisi, maksimal 120 karakter.';
  end if;

  v_is_active := coalesce((p_payload ->> 'is_active')::boolean, true);

  if v_is_new then
    insert into public.categories (name, is_active)
    values (v_name, v_is_active)
    returning * into v_after;
  else
    select * into v_before
      from public.categories c
     where c.id = v_id
       for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'CATEGORY_NOT_FOUND: Kategori tidak ditemukan.';
    end if;

    update public.categories c
       set name = v_name,
           is_active = v_is_active
     where c.id = v_id
     returning * into v_after;
  end if;

  perform private.write_audit(
    v_actor,
    case when v_is_new then 'category.create' else 'category.update' end,
    'categories',
    v_after.id::text,
    case when v_is_new then null else to_jsonb(v_before) end,
    to_jsonb(v_after),
    null
  );

  return to_jsonb(v_after);
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'CATEGORY_ALREADY_EXISTS: Nama kategori sudah dipakai (perbandingan mengabaikan huruf besar/kecil).';
  when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
    raise exception using errcode = '22023', message = 'INVALID_PAYLOAD: Tipe data payload kategori tidak valid.';
end;
$$;

revoke all on function private.upsert_category(jsonb) from public;

create or replace function public.upsert_category(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.upsert_category(p_payload);
$$;

revoke all on function public.upsert_category(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_category(jsonb) to authenticated;
