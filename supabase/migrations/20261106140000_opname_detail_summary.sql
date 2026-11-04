-- 0021 — Phase 5E: aggregate summary for a stock opname session
--
-- Why: `getOpnameDetail` used to fetch every item of a session in one PostgREST
-- request. PostgREST caps a response at 1,000 rows, so a full-catalog session
-- (1,361 items) silently lost 361 rows and every derived counter in the UI
-- (pending / counted / needs_recount / discrepancy / opening balance) was
-- computed from the truncated list.
--
-- Pagination fixes the row transfer, but it must not become the source of the
-- global counters: a page can never answer "how many items are still pending".
-- This function aggregates the whole session inside the database and returns a
-- single small JSON object, so the UI shows exact totals regardless of which
-- page is open.
--
-- Security: SECURITY INVOKER, so RLS on `stock_opname_items` still applies to
-- the caller. `private.require_active_role` additionally rejects inactive
-- accounts and roles outside owner/inventory_staff, mirroring every other
-- opname entry point. `search_path = ''` and fully qualified names.
--
-- Additive only: no table, column, constraint or policy changes.

create or replace function public.get_stock_opname_summary(p_opname_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_opname public.stock_opnames%rowtype;
  v_total integer;
  v_pending integer;
  v_counted integer;
  v_recount integer;
  v_posted integer;
  v_opening integer;
  v_matching integer;
  v_discrepancy integer;
  v_blockers integer;
begin
  -- SECURITY INVOKER cannot call `private.require_active_role` (EXECUTE is
  -- revoked from every client role); `private.has_role` is the one helper
  -- granted to authenticated, and it already requires an active profile.
  if not private.has_role(array['owner', 'inventory_staff']) then
    raise exception using errcode = '42501', message = 'FORBIDDEN: Peran akun ini tidak diizinkan untuk operasi tersebut.';
  end if;

  if p_opname_id is null then
    raise exception using errcode = '22023', message = 'OPNAME_REQUIRED: p_opname_id wajib diisi.';
  end if;

  -- Reading through RLS: a caller who cannot see the session gets no row.
  select * into v_opname
    from public.stock_opnames o
   where o.id = p_opname_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'OPNAME_NOT_FOUND: Sesi opname tidak ditemukan.';
  end if;

  select
    count(*)::int,
    count(*) filter (where i.count_status = 'pending')::int,
    count(*) filter (where i.count_status in ('counted', 'posted'))::int,
    count(*) filter (where i.count_status = 'needs_recount')::int,
    count(*) filter (where i.count_status = 'posted')::int,
    count(*) filter (where i.system_qty_snapshot is null)::int,
    count(*) filter (
      where i.system_qty_snapshot is not null
        and i.physical_qty is not null
        and i.difference_qty = 0
    )::int,
    count(*) filter (where i.difference_qty <> 0)::int
    into v_total, v_pending, v_counted, v_recount, v_posted, v_opening, v_matching, v_discrepancy
    from public.stock_opname_items i
   where i.stock_opname_id = p_opname_id;

  -- Blocker rule inlined instead of calling private.opname_blockers: this
  -- function is SECURITY INVOKER and `authenticated` holds no EXECUTE on the
  -- private helper. The predicate is the same one submit/approve enforce.
  select count(*)::int into v_blockers
    from public.stock_opname_items i
   where i.stock_opname_id = p_opname_id
     and (
       i.count_status in ('pending', 'needs_recount')
       or i.physical_qty is null
       or (
         i.system_qty_snapshot is null
         and (i.reason_code is distinct from 'opening_balance'
              or nullif(btrim(coalesce(i.reason_note, '')), '') is null)
       )
       or (
         i.system_qty_snapshot is not null
         and i.physical_qty <> i.system_qty_snapshot
         and (
           i.reason_code is null
           or i.reason_code = 'opening_balance'
           or (i.reason_code = 'other' and nullif(btrim(coalesce(i.reason_note, '')), '') is null)
         )
       )
     );

  return jsonb_build_object(
    'opname_id', v_opname.id,
    'opname_no', v_opname.opname_no,
    'status', v_opname.status,
    'scope_note', v_opname.scope_note,
    'created_at', v_opname.created_at,
    'submitted_at', v_opname.submitted_at,
    'approved_at', v_opname.approved_at,
    'posted_at', v_opname.posted_at,
    'cancelled_at', v_opname.cancelled_at,
    'cancelled_reason', v_opname.cancelled_reason,
    'item_count', v_total,
    'pending_count', v_pending,
    'counted_count', v_counted,
    'needs_recount_count', v_recount,
    'posted_count', v_posted,
    'opening_balance_count', v_opening,
    'matching_count', v_matching,
    'discrepancy_count', v_discrepancy,
    'blocker_count', v_blockers,
    'ready_for_submit', v_total > 0 and v_blockers = 0
  );
end;
$$;

revoke all on function public.get_stock_opname_summary(uuid) from public, anon, authenticated;
grant execute on function public.get_stock_opname_summary(uuid) to authenticated;
