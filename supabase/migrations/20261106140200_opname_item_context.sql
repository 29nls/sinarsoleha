-- 0023 — Phase 5E: authoritative context for the recount dialog
--
-- Why: after `post_stock_opname` reports a version conflict the item is marked
-- `needs_recount`, but the detail page still holds the snapshot that was taken
-- when the session was created. Opening the recount dialog from that object
-- showed a stale `system_qty_snapshot` (e.g. 13 while the product already held
-- 12), so the operator was asked to justify a difference the database would
-- discard during the rebase.
--
-- This read-only function returns, for one item, BOTH numbers side by side:
--   * `system_qty_snapshot` / `stock_version_snapshot` — what the session holds
--   * `current_qty` / `current_version`              — what the product holds now
-- plus the unit precision the form needs. The UI can therefore label each
-- number honestly instead of presenting the snapshot as current stock.
--
-- This is a hint for the operator, not the authority: another cashier may sell
-- the product right after this call. `record_stock_opname_count` still rebases
-- inside its own transaction and its response is what the UI stores.
--
-- Security: SECURITY INVOKER (RLS applies), owner/inventory_staff only,
-- `search_path = ''`. Read-only.

create or replace function public.get_stock_opname_item_context(p_item_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_item public.stock_opname_items%rowtype;
  v_opname_status text;
  v_product public.products%rowtype;
  v_unit public.units_of_measure%rowtype;
begin
  if not private.has_role(array['owner', 'inventory_staff']) then
    raise exception using errcode = '42501', message = 'FORBIDDEN: Peran akun ini tidak diizinkan untuk operasi tersebut.';
  end if;

  if p_item_id is null then
    raise exception using errcode = '22023', message = 'ITEM_REQUIRED: p_stock_opname_item_id wajib diisi.';
  end if;

  select * into v_item
    from public.stock_opname_items i
   where i.id = p_item_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'OPNAME_ITEM_NOT_FOUND: Item opname tidak ditemukan.';
  end if;

  select o.status into v_opname_status
    from public.stock_opnames o
   where o.id = v_item.stock_opname_id;

  select * into v_product
    from public.products p
   where p.id = v_item.product_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'PRODUCT_NOT_FOUND: Produk item opname tidak ditemukan.';
  end if;

  select * into v_unit
    from public.units_of_measure u
   where u.id = v_product.unit_id;

  return jsonb_build_object(
    'item_id', v_item.id,
    'opname_id', v_item.stock_opname_id,
    'opname_status', v_opname_status,
    'product_id', v_item.product_id,
    'sku', v_product.sku,
    'product_name', v_product.name,
    'is_active', v_product.is_active,
    'unit_label', coalesce(v_unit.label, ''),
    'decimal_scale', coalesce(v_unit.decimal_scale, 0),
    'system_qty_snapshot', v_item.system_qty_snapshot,
    'stock_version_snapshot', v_item.stock_version_snapshot,
    'current_qty', v_product.stock_on_hand,
    'current_version', v_product.stock_version,
    'physical_qty', v_item.physical_qty,
    'reason_code', v_item.reason_code,
    'reason_note', v_item.reason_note,
    'count_status', v_item.count_status,
    'counted_at', v_item.counted_at
  );
end;
$$;

revoke all on function public.get_stock_opname_item_context(uuid) from public, anon, authenticated;
grant execute on function public.get_stock_opname_item_context(uuid) to authenticated;
