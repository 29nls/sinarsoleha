-- 0017 — Phase 11: manual stock adjustment (adjust_stock)
-- Additive only: one private function plus its public wrapper. Stock still only
-- moves through the ledger; clients never update products.stock_on_hand.
--
-- Contract: docs/04-rpc-contracts.md §5. `p_idempotency_key` is an optional
-- additive parameter (default NULL) so a retried request cannot post twice.

create or replace function private.adjust_stock(
  p_product_id uuid,
  p_delta numeric,
  p_reason_code text,
  p_reason_note text,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_product public.products%rowtype;
  v_reason text;
  v_note text;
  v_scale smallint;
  v_delta numeric(14,3);
  v_before numeric(14,3);
  v_after numeric(14,3);
  v_version bigint;
  v_movement_id bigint;
  v_existing public.stock_movements%rowtype;
begin
  v_actor := private.require_active_role(array['owner', 'inventory_staff']);

  if p_product_id is null then
    raise exception using errcode = '22023', message = 'PRODUCT_REQUIRED: p_product_id wajib diisi.';
  end if;

  if p_delta is null then
    raise exception using errcode = '22023', message = 'DELTA_REQUIRED: p_delta wajib diisi.';
  end if;

  if p_delta = 0 then
    raise exception using errcode = '22023', message = 'DELTA_ZERO: Koreksi stok tidak boleh bernilai nol.';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason_code, '')), '');
  v_note := nullif(btrim(coalesce(p_reason_note, '')), '');

  if v_reason is null then
    raise exception using errcode = '22023', message = 'REASON_REQUIRED: reason_code wajib diisi.';
  end if;

  if v_reason not in (
    'broken_damaged', 'missing', 'input_error', 'unrecorded_out',
    'unrecorded_in', 'unit_conversion', 'opening_balance', 'other'
  ) then
    raise exception using errcode = '22023', message = format('INVALID_REASON: reason_code %s tidak dikenal.', v_reason);
  end if;

  -- opening_balance means "stock was unknown"; an adjustment always starts from
  -- a known balance, so that reason belongs to opname only.
  if v_reason = 'opening_balance' then
    raise exception using errcode = '22023', message = 'REASON_INVALID: opening_balance hanya untuk opname produk berstok NULL.';
  end if;

  -- The ledger constraint requires a note for every manual_adjustment, so the
  -- message is explicit here instead of surfacing a raw check violation.
  if v_note is null then
    raise exception using errcode = '22023', message = 'REASON_NOTE_REQUIRED: Catatan alasan wajib diisi untuk koreksi manual.';
  end if;

  if char_length(v_note) > 500 then
    raise exception using errcode = '22023', message = 'REASON_NOTE_TOO_LONG: Catatan alasan maksimal 500 karakter.';
  end if;

  -- Retry path: the same key returns the movement already written instead of
  -- applying the delta again.
  if p_idempotency_key is not null then
    select * into v_existing
      from public.stock_movements m
     where m.idempotency_key = p_idempotency_key;

    if found then
      if v_existing.product_id <> p_product_id
         or v_existing.quantity_delta <> p_delta
         or v_existing.movement_type <> 'manual_adjustment' then
        raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED: Kunci ini sudah dipakai untuk koreksi yang berbeda.';
      end if;

      return jsonb_build_object(
        'product_id', v_existing.product_id,
        'sku', (select p.sku from public.products p where p.id = v_existing.product_id),
        'stock_before', v_existing.quantity_before,
        'stock_after', v_existing.quantity_after,
        'delta', v_existing.quantity_delta,
        'reason_code', v_existing.reason_code,
        'reason_note', v_existing.reason_note,
        'movement_id', v_existing.id,
        'already_processed', true
      );
    end if;
  end if;

  select * into v_product
    from public.products p
   where p.id = p_product_id
     for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PRODUCT_NOT_FOUND: Produk tidak ditemukan.';
  end if;

  if v_product.stock_on_hand is null then
    raise exception using errcode = '22023', message = 'STOCK_UNKNOWN: Saldo produk belum diketahui; catat lewat opname saldo awal, bukan koreksi manual.';
  end if;

  select u.decimal_scale into v_scale
    from public.units_of_measure u
   where u.id = v_product.unit_id;

  v_delta := round(p_delta, coalesce(v_scale, 0));

  if v_delta <> p_delta then
    raise exception using errcode = '22023', message = format('INVALID_PRECISION: Satuan produk hanya mendukung %s angka desimal.', coalesce(v_scale, 0));
  end if;

  if v_delta = 0 then
    raise exception using errcode = '22023', message = 'DELTA_ZERO: Koreksi stok tidak boleh bernilai nol setelah pembulatan.';
  end if;

  v_before := v_product.stock_on_hand;
  v_after := v_before + v_delta;
  v_version := v_product.stock_version;

  if v_after < 0 then
    raise exception using errcode = '22023', message = format('STOCK_NEGATIVE: Koreksi menghasilkan saldo negatif (%s).', v_after);
  end if;

  insert into public.stock_movements (
    product_id, movement_type, quantity_delta, quantity_before, quantity_after,
    reason_code, reason_note, actor_id, idempotency_key
  )
  values (
    p_product_id, 'manual_adjustment', v_delta, v_before, v_after,
    v_reason, v_note, v_actor, p_idempotency_key
  )
  returning id into v_movement_id;

  update public.products p
     set stock_on_hand = v_after,
         stock_version = v_version + 1,
         updated_by = v_actor
   where p.id = p_product_id;

  perform private.write_audit(
    v_actor, 'stock.adjust', 'products', p_product_id::text,
    jsonb_build_object('stock_on_hand', v_before, 'stock_version', v_version),
    jsonb_build_object(
      'stock_on_hand', v_after,
      'stock_version', v_version + 1,
      'delta', v_delta,
      'reason_code', v_reason,
      'movement_id', v_movement_id
    ),
    v_note
  );

  return jsonb_build_object(
    'product_id', p_product_id,
    'sku', v_product.sku,
    'stock_before', v_before,
    'stock_after', v_after,
    'delta', v_delta,
    'stock_version', v_version + 1,
    'reason_code', v_reason,
    'reason_note', v_note,
    'movement_id', v_movement_id,
    'already_processed', false
  );
end;
$$;

revoke all on function private.adjust_stock(uuid, numeric, text, text, uuid) from public;

-- Public wrapper: same thin SECURITY DEFINER pass-through as the opname RPCs.
create or replace function public.adjust_stock(
  p_product_id uuid,
  p_delta numeric,
  p_reason_code text,
  p_reason_note text,
  p_idempotency_key uuid default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.adjust_stock(p_product_id, p_delta, p_reason_code, p_reason_note, p_idempotency_key);
$$;

revoke all on function public.adjust_stock(uuid, numeric, text, text, uuid) from public, anon, authenticated;
grant execute on function public.adjust_stock(uuid, numeric, text, text, uuid) to authenticated;
