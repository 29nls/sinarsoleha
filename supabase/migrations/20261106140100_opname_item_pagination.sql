-- 0022 — Phase 5E: paginated, deterministic item listing for a stock opname
--
-- Why an RPC instead of `.from('stock_opname_items').range()`: the operator
-- sorts by SKU, which lives on `products`. PostgREST cannot order a table by a
-- column of an embedded to-one relation reliably, and ordering by `product_id`
-- (a UUID) would produce a stable but meaningless order for a human counting
-- shelves. Joining inside the database gives one deterministic order:
-- `sku ASC, id ASC` — `id` is the unique tie-breaker, so pages never overlap or
-- skip a row even when two products share a SKU.
--
-- The function also filters and searches server-side, so "pending only" and
-- "search" work across the whole session instead of the loaded page.
--
-- Security: SECURITY INVOKER (RLS applies), owner/inventory_staff only,
-- `search_path = ''`, no dynamic SQL. Read-only.
--
-- Additive only: no table, column, constraint or policy changes.

create or replace function public.list_stock_opname_items(
  p_opname_id uuid,
  p_limit integer default 50,
  p_offset integer default 0,
  p_filter text default 'all',
  p_search text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 250);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_filter text := coalesce(nullif(btrim(coalesce(p_filter, '')), ''), 'all');
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_total integer;
  v_items jsonb;
begin
  if not private.has_role(array['owner', 'inventory_staff']) then
    raise exception using errcode = '42501', message = 'FORBIDDEN: Peran akun ini tidak diizinkan untuk operasi tersebut.';
  end if;

  if p_opname_id is null then
    raise exception using errcode = '22023', message = 'OPNAME_REQUIRED: p_opname_id wajib diisi.';
  end if;

  if v_filter not in ('all', 'pending', 'recount', 'difference') then
    raise exception using errcode = '22023', message = 'INVALID_FILTER: Filter item tidak dikenal.';
  end if;

  if not exists (select 1 from public.stock_opnames o where o.id = p_opname_id) then
    raise exception using errcode = 'P0002', message = 'OPNAME_NOT_FOUND: Sesi opname tidak ditemukan.';
  end if;

  -- Count first so the UI can render "x–y dari total" without a second call.
  select count(*)::int into v_total
    from public.stock_opname_items i
    join public.products p on p.id = i.product_id
   where i.stock_opname_id = p_opname_id
     and (
       v_filter = 'all'
       or (v_filter = 'pending' and i.count_status = 'pending')
       or (v_filter = 'recount' and i.count_status = 'needs_recount')
       or (v_filter = 'difference' and coalesce(i.difference_qty, 0) <> 0)
     )
     and (
       v_search is null
       or p.sku ilike '%' || v_search || '%'
       or p.name ilike '%' || v_search || '%'
     );

  select coalesce(jsonb_agg(row order by sort_sku, sort_id), '[]'::jsonb)
    into v_items
    from (
      select
        jsonb_build_object(
          'id', i.id,
          'product_id', i.product_id,
          'sku', p.sku,
          'product_name', p.name,
          'unit_label', coalesce(u.label, ''),
          'decimal_scale', coalesce(u.decimal_scale, 0),
          'is_active', p.is_active,
          'system_qty_snapshot', i.system_qty_snapshot,
          'physical_qty', i.physical_qty,
          'difference_qty', i.difference_qty,
          'reason_code', i.reason_code,
          'reason_note', i.reason_note,
          'count_status', i.count_status,
          'counted_at', i.counted_at
        ) as row,
        p.sku as sort_sku,
        i.id as sort_id
        from public.stock_opname_items i
        join public.products p on p.id = i.product_id
        left join public.units_of_measure u on u.id = p.unit_id
       where i.stock_opname_id = p_opname_id
         and (
           v_filter = 'all'
           or (v_filter = 'pending' and i.count_status = 'pending')
           or (v_filter = 'recount' and i.count_status = 'needs_recount')
           or (v_filter = 'difference' and coalesce(i.difference_qty, 0) <> 0)
         )
         and (
           v_search is null
           or p.sku ilike '%' || v_search || '%'
           or p.name ilike '%' || v_search || '%'
         )
       order by p.sku asc, i.id asc
       limit v_limit
      offset v_offset
    ) page;

  return jsonb_build_object(
    'opname_id', p_opname_id,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'filter', v_filter,
    'search', v_search,
    'items', v_items
  );
end;
$$;

revoke all on function public.list_stock_opname_items(uuid, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.list_stock_opname_items(uuid, integer, integer, text, text) to authenticated;
