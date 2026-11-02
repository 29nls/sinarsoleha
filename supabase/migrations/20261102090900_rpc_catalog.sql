-- 0010 — catalog RPC
-- Owner-only. Never reads or writes stock_on_hand / stock_version.

create or replace function private.upsert_product(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_active_role(array['owner']);
  v_is_new boolean;
  v_id uuid;
  v_sku text;
  v_name text;
  v_category_id bigint;
  v_unit_id smallint;
  v_sale_price numeric(14,2);
  v_low_stock numeric(14,3);
  v_is_active boolean;
  v_review_status text;
  v_before public.products%rowtype;
  v_after public.products%rowtype;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'INVALID_PAYLOAD: Payload produk tidak valid.';
  end if;

  v_id := nullif(btrim(coalesce(p_payload ->> 'product_id', '')), '')::uuid;
  v_is_new := v_id is null;

  v_sku := btrim(coalesce(p_payload ->> 'sku', ''));
  v_name := btrim(coalesce(p_payload ->> 'name', ''));
  if v_sku = '' or char_length(v_sku) > 64 then
    raise exception using errcode = '22023', message = 'INVALID_SKU: SKU wajib diisi, maksimal 64 karakter.';
  end if;
  if v_name = '' or char_length(v_name) > 200 then
    raise exception using errcode = '22023', message = 'INVALID_NAME: Nama produk wajib diisi, maksimal 200 karakter.';
  end if;

  v_unit_id := nullif(p_payload ->> 'unit_id', '')::smallint;
  if v_unit_id is null then
    raise exception using errcode = '22023', message = 'UNIT_REQUIRED: Satuan wajib dipilih.';
  end if;
  if not exists (select 1 from public.units_of_measure u where u.id = v_unit_id) then
    raise exception using errcode = '23503', message = 'UNIT_NOT_FOUND: Satuan tidak ditemukan.';
  end if;

  v_category_id := nullif(p_payload ->> 'category_id', '')::bigint;
  if v_category_id is not null
     and not exists (select 1 from public.categories c where c.id = v_category_id) then
    raise exception using errcode = '23503', message = 'CATEGORY_NOT_FOUND: Kategori tidak ditemukan.';
  end if;

  v_sale_price := nullif(p_payload ->> 'sale_price', '')::numeric(14,2);
  if v_sale_price is not null and v_sale_price < 0 then
    raise exception using errcode = '22023', message = 'INVALID_SALE_PRICE: Harga jual tidak boleh negatif.';
  end if;

  v_low_stock := nullif(p_payload ->> 'low_stock_threshold', '')::numeric(14,3);
  if v_low_stock is not null and v_low_stock < 0 then
    raise exception using errcode = '22023', message = 'INVALID_LOW_STOCK: Batas stok rendah tidak boleh negatif.';
  end if;

  v_is_active := coalesce((p_payload ->> 'is_active')::boolean, true);
  v_review_status := coalesce(nullif(btrim(p_payload ->> 'import_review_status'), ''), 'verified');
  if v_review_status not in (
    'verified', 'stock_unknown', 'negative_opening_stock', 'price_missing', 'review_required'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_REVIEW_STATUS: Status review tidak dikenal.';
  end if;

  if v_is_new then
    insert into public.products (
      sku, name, category_id, unit_id, sale_price, low_stock_threshold,
      is_active, import_review_status, updated_by
    )
    values (
      v_sku, v_name, v_category_id, v_unit_id, v_sale_price, v_low_stock,
      v_is_active, v_review_status, v_actor
    )
    returning * into v_after;
  else
    select * into v_before
      from public.products p
     where p.id = v_id
       for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'PRODUCT_NOT_FOUND: Produk tidak ditemukan.';
    end if;

    update public.products p
       set sku = v_sku,
           name = v_name,
           category_id = v_category_id,
           unit_id = v_unit_id,
           sale_price = v_sale_price,
           low_stock_threshold = v_low_stock,
           is_active = v_is_active,
           import_review_status = v_review_status,
           updated_by = v_actor
     where p.id = v_id
     returning * into v_after;
  end if;

  perform private.write_audit(
    v_actor,
    case when v_is_new then 'product.create' else 'product.update' end,
    'products',
    v_after.id::text,
    case when v_is_new then null else to_jsonb(v_before) end,
    to_jsonb(v_after),
    null
  );

  return to_jsonb(v_after);
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'SKU_ALREADY_EXISTS: SKU sudah dipakai produk lain (perbandingan mengabaikan huruf besar/kecil).';
  when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
    raise exception using errcode = '22023', message = 'INVALID_PAYLOAD: Tipe data payload produk tidak valid.';
end;
$$;

revoke all on function private.upsert_product(jsonb) from public;

create or replace function private.set_product_cost(p_product_id uuid, p_purchase_cost numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_active_role(array['owner']);
  v_before public.product_costs%rowtype;
  v_after public.product_costs%rowtype;
begin
  if p_product_id is null then
    raise exception 'PRODUCT_REQUIRED' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products p where p.id = p_product_id) then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_purchase_cost is not null and p_purchase_cost < 0 then
    raise exception using errcode = '22023', message = 'INVALID_PURCHASE_COST: Harga beli tidak boleh negatif.';
  end if;

  select * into v_before from public.product_costs c where c.product_id = p_product_id;

  insert into public.product_costs (product_id, purchase_cost, updated_by)
  values (p_product_id, p_purchase_cost, v_actor)
  on conflict (product_id) do update
    set purchase_cost = excluded.purchase_cost,
        updated_by = excluded.updated_by,
        updated_at = now()
  returning * into v_after;

  perform private.write_audit(
    v_actor,
    'product.cost_update',
    'product_costs',
    p_product_id::text,
    case when v_before.product_id is null then null else to_jsonb(v_before) end,
    to_jsonb(v_after),
    null
  );

  return to_jsonb(v_after);
end;
$$;

revoke all on function private.set_product_cost(uuid, numeric) from public;

create or replace function public.upsert_product(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.upsert_product(p_payload);
$$;

revoke all on function public.upsert_product(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_product(jsonb) to authenticated;

create or replace function public.set_product_cost(p_product_id uuid, p_purchase_cost numeric)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.set_product_cost(p_product_id, p_purchase_cost);
$$;

revoke all on function public.set_product_cost(uuid, numeric) from public, anon, authenticated;
grant execute on function public.set_product_cost(uuid, numeric) to authenticated;
