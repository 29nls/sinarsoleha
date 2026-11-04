-- 0020 — Phase 5D: rebase the opname snapshot on recount
--
-- Defect fixed: post_stock_opname compares products.stock_version with
-- stock_opname_items.stock_version_snapshot. A version conflict marks the item
-- needs_recount and returns the session to `counting`, but nothing ever
-- refreshed that snapshot, so every later post saw the same stale version and
-- returned `version_conflict` again — the recount loop could never terminate.
--
-- record_stock_opname_count now re-reads the product when the item is flagged
-- needs_recount and re-bases BOTH snapshots to the current stock and version.
-- That is the correct semantics for a recount: the operator is counting against
-- the stock the system holds now, not against the pre-sale figure, so the
-- difference (and therefore the ledger movement) is computed from the fresh
-- system quantity.
--
-- Additive only: one `create or replace` of a private function. No table, column
-- or constraint changes. The public wrapper is untouched.

create or replace function private.record_stock_opname_count(
  p_stock_opname_item_id uuid,
  p_physical_qty numeric,
  p_reason_code text,
  p_reason_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_item public.stock_opname_items%rowtype;
  v_status text;
  v_reason text;
  v_note text;
  v_scale smallint;
  v_physical numeric(14,3);
  v_system numeric(14,3);
  v_rebase boolean := false;
  v_snapshot_version bigint;
begin
  v_actor := private.require_active_role(array['owner', 'inventory_staff']);

  if p_stock_opname_item_id is null then
    raise exception using errcode = '22023', message = 'ITEM_REQUIRED: p_stock_opname_item_id wajib diisi.';
  end if;

  select i.* into v_item
    from public.stock_opname_items i
   where i.id = p_stock_opname_item_id
     for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'OPNAME_ITEM_NOT_FOUND: Item opname tidak ditemukan.';
  end if;

  select o.status into v_status
    from public.stock_opnames o
   where o.id = v_item.stock_opname_id
     for update;

  if v_status not in ('counting') then
    raise exception using errcode = '22023', message = format('OPNAME_NOT_COUNTING: Sesi berstatus %s tidak dapat dihitung.', v_status);
  end if;

  if v_item.count_status = 'posted' then
    raise exception using errcode = '22023', message = 'OPNAME_ITEM_POSTED: Item sudah diposting.';
  end if;

  if p_physical_qty is null then
    raise exception using errcode = '22023', message = 'PHYSICAL_QTY_REQUIRED: Jumlah fisik wajib diisi.';
  end if;

  if p_physical_qty < 0 then
    raise exception using errcode = '22023', message = 'PHYSICAL_QTY_NEGATIVE: Jumlah fisik tidak boleh negatif.';
  end if;

  select u.decimal_scale into v_scale
    from public.products p
    join public.units_of_measure u on u.id = p.unit_id
   where p.id = v_item.product_id;

  v_physical := round(p_physical_qty, coalesce(v_scale, 0));

  if v_physical <> p_physical_qty then
    raise exception using errcode = '22023', message = format('INVALID_PRECISION: Satuan produk hanya mendukung %s angka desimal.', coalesce(v_scale, 0));
  end if;

  v_system := v_item.system_qty_snapshot;

  -- A needs_recount item was stale when posting was attempted. Re-base the
  -- snapshot to what the product holds now, otherwise the next post keeps
  -- failing on the same old version. Read without a lock: a sale landing right
  -- after this read simply produces a fresh conflict on the next post, which is
  -- safer than introducing an item→product lock ordering against post_stock_opname.
  if v_item.count_status = 'needs_recount' then
    select p.stock_on_hand, p.stock_version
      into v_system, v_snapshot_version
      from public.products p
     where p.id = v_item.product_id;

    if not found then
      raise exception using errcode = 'P0002', message = 'PRODUCT_NOT_FOUND: Produk item opname tidak ditemukan.';
    end if;

    v_rebase := true;
  end if;

  v_reason := nullif(btrim(coalesce(p_reason_code, '')), '');
  v_note := nullif(btrim(coalesce(p_reason_note, '')), '');

  if v_reason is not null and v_reason not in (
    'broken_damaged', 'missing', 'input_error', 'unrecorded_out',
    'unrecorded_in', 'unit_conversion', 'opening_balance', 'other'
  ) then
    raise exception using errcode = '22023', message = format('INVALID_REASON: reason_code %s tidak dikenal.', v_reason);
  end if;

  if v_system is null then
    if v_reason is distinct from 'opening_balance' then
      raise exception using errcode = '22023', message = 'OPENING_BALANCE_REASON_REQUIRED: Stok sistem belum diketahui; gunakan reason_code opening_balance.';
    end if;
    if v_note is null then
      raise exception using errcode = '22023', message = 'OPENING_BALANCE_NOTE_REQUIRED: Catatan wajib diisi untuk saldo awal.';
    end if;
  else
    if v_physical = v_system then
      v_reason := null;
      v_note := null;
    else
      if v_reason is null then
        raise exception using errcode = '22023', message = 'REASON_REQUIRED: Selisih stok wajib memiliki reason_code.';
      end if;
      if v_reason = 'opening_balance' then
        raise exception using errcode = '22023', message = 'REASON_INVALID: opening_balance hanya untuk produk dengan stok sistem NULL.';
      end if;
      if v_reason = 'other' and v_note is null then
        raise exception using errcode = '22023', message = 'REASON_NOTE_REQUIRED: reason_code other wajib disertai catatan.';
      end if;
    end if;
  end if;

  if v_rebase then
    update public.stock_opname_items i
       set physical_qty = v_physical,
           reason_code = v_reason,
           reason_note = v_note,
           count_status = 'counted',
           counted_by = v_actor,
           counted_at = now(),
           system_qty_snapshot = v_system,
           stock_version_snapshot = v_snapshot_version
     where i.id = v_item.id
     returning * into v_item;
  else
    update public.stock_opname_items i
       set physical_qty = v_physical,
           reason_code = v_reason,
           reason_note = v_note,
           count_status = 'counted',
           counted_by = v_actor,
           counted_at = now()
     where i.id = v_item.id
     returning * into v_item;
  end if;

  return jsonb_build_object(
    'item_id', v_item.id,
    'opname_id', v_item.stock_opname_id,
    'product_id', v_item.product_id,
    'system_qty_snapshot', v_item.system_qty_snapshot,
    'physical_qty', v_item.physical_qty,
    'difference_qty', v_item.difference_qty,
    'reason_code', v_item.reason_code,
    'count_status', v_item.count_status,
    'counted_by', v_item.counted_by,
    'counted_at', v_item.counted_at
  );
end;
$$;

revoke all on function private.record_stock_opname_count(uuid, numeric, text, text) from public;
