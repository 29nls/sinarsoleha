-- 0015 — Phase 5A inventory engine: stock opname workflow
-- Additive only. Reuses stock_opnames / stock_opname_items / stock_movements /
-- stock_discrepancy_logs. All privileged work happens in private SECURITY DEFINER
-- functions wrapped by public RPCs. No client ever updates products.stock_on_hand.

-- 1. Retry-safe creation: one client key maps to at most one session.
alter table public.stock_opnames
  add column creation_key uuid;

alter table public.stock_opnames
  add constraint stock_opnames_creation_key_key unique (creation_key);

comment on column public.stock_opnames.creation_key is
  'Client idempotency key for create_stock_opname; a retry returns the same session.';

-- 2. Opening balance may legitimately be zero. The ledger still rejects a zero
-- delta for every other movement type. quantity_before must be NULL (unknown
-- stock) and quantity_after must be 0, so only the opening-balance-at-zero case
-- is admitted.
alter table public.stock_movements
  drop constraint stock_movements_delta_nonzero;

alter table public.stock_movements
  add constraint stock_movements_delta_nonzero check (
    quantity_delta <> 0
    or (
      movement_type = 'opening_balance'
      and quantity_before is null
      and quantity_after = 0
      and quantity_delta = 0
      and reason_code = 'opening_balance'
    )
  );

-- 3. A session cancelled while still counting was never submitted, so it has no
-- submitted_at. The original constraint only exempted draft/counting, which made
-- cancelling a counting session impossible. Widen it to the cancelled terminal
-- state; every other status still requires a submission timestamp.
alter table public.stock_opnames
  drop constraint stock_opnames_submitted_consistency;

alter table public.stock_opnames
  add constraint stock_opnames_submitted_consistency check (
    status in ('draft', 'counting', 'cancelled') or submitted_at is not null
  );

-- 3b. Partial index for the counting screen: only unfinished items are scanned.
create index stock_opname_items_open_idx
  on public.stock_opname_items (stock_opname_id, count_status)
  where count_status in ('pending', 'needs_recount');

-- The unique constraint above already provides the lookup index for creation_key;
-- no separate index is needed.

-- 4. Shared response builder so every RPC returns the same shape.
create or replace function private.opname_response(
  p_opname public.stock_opnames,
  p_extra jsonb default '{}'::jsonb
)
returns jsonb
language sql
set search_path = ''
as $$
  select jsonb_build_object(
    'opname_id', p_opname.id,
    'opname_no', p_opname.opname_no,
    'status', p_opname.status,
    'scope_note', p_opname.scope_note,
    'submitted_at', p_opname.submitted_at,
    'approved_at', p_opname.approved_at,
    'posted_at', p_opname.posted_at,
    'cancelled_at', p_opname.cancelled_at
  ) || coalesce(p_extra, '{}'::jsonb);
$$;

revoke all on function private.opname_response(public.stock_opnames, jsonb) from public;

-- 5. CREATE. The browser sends only scope; product snapshots are inserted
-- server-side with INSERT ... SELECT so a 1,360-row catalog costs one statement.
create or replace function private.create_stock_opname(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_key uuid;
  v_note text;
  v_ids uuid[];
  v_exclude uuid[];
  v_category bigint;
  v_opname public.stock_opnames%rowtype;
  v_count integer;
  v_no text;
begin
  v_actor := private.require_active_role(array['owner', 'inventory_staff']);

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'INVALID_PAYLOAD: Payload opname wajib berupa objek JSON.';
  end if;

  begin
    v_key := nullif(p_payload ->> 'idempotency_key', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'INVALID_IDEMPOTENCY_KEY: idempotency_key harus UUID.';
  end;

  if v_key is not null then
    select * into v_opname
      from public.stock_opnames o
     where o.creation_key = v_key;

    if found then
      select count(*)::int into v_count
        from public.stock_opname_items i
       where i.stock_opname_id = v_opname.id;

      return private.opname_response(v_opname, jsonb_build_object(
        'item_count', v_count,
        'already_processed', true
      ));
    end if;
  end if;

  v_note := nullif(btrim(coalesce(p_payload ->> 'scope_note', '')), '');
  if v_note is not null and char_length(v_note) > 500 then
    raise exception using errcode = '22023', message = 'SCOPE_NOTE_TOO_LONG: Catatan cakupan maksimal 500 karakter.';
  end if;

  begin
    v_category := nullif(p_payload ->> 'category_id', '')::bigint;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'INVALID_CATEGORY: category_id tidak valid.';
  end;

  if p_payload ? 'product_ids' and jsonb_typeof(p_payload -> 'product_ids') = 'array' then
    select coalesce(array_agg(distinct x.value::uuid), '{}'::uuid[])
      into v_ids
      from jsonb_array_elements_text(p_payload -> 'product_ids') as x(value);
  else
    v_ids := '{}'::uuid[];
  end if;

  if p_payload ? 'exclude_product_ids' and jsonb_typeof(p_payload -> 'exclude_product_ids') = 'array' then
    select coalesce(array_agg(distinct x.value::uuid), '{}'::uuid[])
      into v_exclude
      from jsonb_array_elements_text(p_payload -> 'exclude_product_ids') as x(value);
  else
    v_exclude := '{}'::uuid[];
  end if;

  if v_category is not null and not exists (
    select 1 from public.categories c where c.id = v_category
  ) then
    raise exception using errcode = 'P0002', message = 'CATEGORY_NOT_FOUND: Kategori tidak ditemukan.';
  end if;

  v_no := private.next_document_number('opname', current_date);

  insert into public.stock_opnames (opname_no, status, scope_note, created_by, creation_key)
  values (v_no, 'counting', v_note, v_actor, v_key)
  returning * into v_opname;

  -- Snapshot in one statement. Inactive products are included: they can still
  -- hold physical stock. NULL stock stays NULL (unknown, not zero).
  insert into public.stock_opname_items (
    stock_opname_id, product_id, system_qty_snapshot, stock_version_snapshot
  )
  select v_opname.id, p.id, p.stock_on_hand, p.stock_version
    from public.products p
   where (cardinality(v_ids) = 0 or p.id = any (v_ids))
     and (v_category is null or p.category_id = v_category)
     and not (p.id = any (v_exclude))
   order by p.id;

  get diagnostics v_count = row_count;

  if v_count = 0 then
    raise exception using errcode = '22023', message = 'OPNAME_EMPTY: Tidak ada produk yang cocok dengan cakupan opname.';
  end if;

  perform private.write_audit(
    v_actor,
    'opname.create',
    'stock_opnames',
    v_opname.id::text,
    null,
    jsonb_build_object(
      'opname_no', v_opname.opname_no,
      'status', v_opname.status,
      'item_count', v_count,
      'scope_note', v_note,
      'selected_products', cardinality(v_ids),
      'excluded_products', cardinality(v_exclude),
      'category_id', v_category
    ),
    v_note
  );

  return private.opname_response(v_opname, jsonb_build_object(
    'item_count', v_count,
    'already_processed', false
  ));
end;
$$;

revoke all on function private.create_stock_opname(jsonb) from public;

-- 6. COUNT. Counting never touches stock or the ledger. The table check
-- constraints already enforce the reason rules; this function validates the
-- unit precision and the session state, and records the authenticated actor.
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

  v_reason := nullif(btrim(coalesce(p_reason_code, '')), '');
  v_note := nullif(btrim(coalesce(p_reason_note, '')), '');
  v_system := v_item.system_qty_snapshot;

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

  update public.stock_opname_items i
     set physical_qty = v_physical,
         reason_code = v_reason,
         reason_note = v_note,
         count_status = 'counted',
         counted_by = v_actor,
         counted_at = now()
   where i.id = v_item.id
   returning * into v_item;

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

-- 7. Shared completeness gate. Returns a jsonb array of problems; empty means
-- the session may move forward. Used by submit and re-checked by approve.
create or replace function private.opname_blockers(p_opname_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', i.id,
           'product_id', i.product_id,
           'sku', p.sku,
           'count_status', i.count_status,
           'physical_qty', i.physical_qty
         ) order by p.sku), '[]'::jsonb)
    from public.stock_opname_items i
    join public.products p on p.id = i.product_id
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
$$;

revoke all on function private.opname_blockers(uuid) from public;

-- 8. SUBMIT. Staff or owner; nothing is written unless every item is complete.
create or replace function private.submit_stock_opname(p_opname_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_opname public.stock_opnames%rowtype;
  v_blockers jsonb;
  v_items integer;
begin
  v_actor := private.require_active_role(array['owner', 'inventory_staff']);

  if p_opname_id is null then
    raise exception using errcode = '22023', message = 'OPNAME_REQUIRED: p_opname_id wajib diisi.';
  end if;

  select * into v_opname
    from public.stock_opnames o
   where o.id = p_opname_id
     for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'OPNAME_NOT_FOUND: Sesi opname tidak ditemukan.';
  end if;

  if v_opname.status = 'submitted' then
    select count(*)::int into v_items from public.stock_opname_items i where i.stock_opname_id = p_opname_id;
    return private.opname_response(v_opname, jsonb_build_object('item_count', v_items, 'already_processed', true));
  end if;

  if v_opname.status <> 'counting' then
    raise exception using errcode = '22023', message = format('OPNAME_NOT_COUNTING: Sesi berstatus %s tidak dapat disubmit.', v_opname.status);
  end if;

  v_blockers := private.opname_blockers(p_opname_id);
  if jsonb_array_length(v_blockers) > 0 then
    raise exception using errcode = '22023', message = 'OPNAME_INCOMPLETE: Masih ada item belum lengkap.', detail = v_blockers::text;
  end if;

  update public.stock_opnames o
     set status = 'submitted', submitted_at = now()
   where o.id = p_opname_id
   returning * into v_opname;

  select count(*)::int into v_items from public.stock_opname_items i where i.stock_opname_id = p_opname_id;

  perform private.write_audit(
    v_actor, 'opname.submit', 'stock_opnames', p_opname_id::text,
    jsonb_build_object('status', 'counting'),
    jsonb_build_object('status', 'submitted', 'item_count', v_items),
    null
  );

  return private.opname_response(v_opname, jsonb_build_object('item_count', v_items, 'already_processed', false));
end;
$$;

revoke all on function private.submit_stock_opname(uuid) from public;

-- 9. APPROVE. Owner only. Approval never touches stock or the ledger.
create or replace function private.approve_stock_opname(p_opname_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_opname public.stock_opnames%rowtype;
  v_blockers jsonb;
  v_items integer;
  v_diffs integer;
begin
  v_actor := private.require_active_role(array['owner']);

  if p_opname_id is null then
    raise exception using errcode = '22023', message = 'OPNAME_REQUIRED: p_opname_id wajib diisi.';
  end if;

  select * into v_opname
    from public.stock_opnames o
   where o.id = p_opname_id
     for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'OPNAME_NOT_FOUND: Sesi opname tidak ditemukan.';
  end if;

  if v_opname.status = 'approved' then
    select count(*)::int into v_items from public.stock_opname_items i where i.stock_opname_id = p_opname_id;
    return private.opname_response(v_opname, jsonb_build_object('item_count', v_items, 'already_processed', true));
  end if;

  if v_opname.status <> 'submitted' then
    raise exception using errcode = '22023', message = format('OPNAME_NOT_SUBMITTED: Sesi berstatus %s tidak dapat disetujui.', v_opname.status);
  end if;

  v_blockers := private.opname_blockers(p_opname_id);
  if jsonb_array_length(v_blockers) > 0 then
    raise exception using errcode = '22023', message = 'OPNAME_INCOMPLETE: Masih ada item belum lengkap.', detail = v_blockers::text;
  end if;

  update public.stock_opnames o
     set status = 'approved', approved_by = v_actor, approved_at = now()
   where o.id = p_opname_id
   returning * into v_opname;

  select count(*)::int,
         count(*) filter (where i.difference_qty is distinct from 0)::int
    into v_items, v_diffs
    from public.stock_opname_items i
   where i.stock_opname_id = p_opname_id;

  perform private.write_audit(
    v_actor, 'opname.approve', 'stock_opnames', p_opname_id::text,
    jsonb_build_object('status', 'submitted'),
    jsonb_build_object('status', 'approved', 'item_count', v_items, 'discrepancy_count', v_diffs),
    null
  );

  return private.opname_response(v_opname, jsonb_build_object(
    'item_count', v_items,
    'discrepancy_count', v_diffs,
    'already_processed', false
  ));
end;
$$;

revoke all on function private.approve_stock_opname(uuid) from public;

-- 10. POST. The only function allowed to change stock from an opname.
-- Version conflicts are returned as a structured non-success result, never as an
-- exception: an exception would roll back the needs_recount markers. Only the
-- conflict branch writes state; a clean run posts everything atomically.
create or replace function private.post_stock_opname(p_opname_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_opname public.stock_opnames%rowtype;
  v_conflicts jsonb;
  v_items integer := 0;
  v_moved integer := 0;
  v_openings integer := 0;
  v_diffs integer := 0;
  v_delta_total numeric(14,3) := 0;
  v_rec record;
  v_stock numeric(14,3);
  v_version bigint;
  v_after numeric(14,3);
  v_delta numeric(14,3);
  v_revision integer;
  v_movement_id bigint;
  v_posted_at timestamptz := now();
begin
  v_actor := private.require_active_role(array['owner']);

  if p_opname_id is null then
    raise exception using errcode = '22023', message = 'OPNAME_REQUIRED: p_opname_id wajib diisi.';
  end if;

  select * into v_opname
    from public.stock_opnames o
   where o.id = p_opname_id
     for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'OPNAME_NOT_FOUND: Sesi opname tidak ditemukan.';
  end if;

  if v_opname.status = 'posted' then
    select count(*)::int,
           coalesce(sum(i.difference_qty), 0)
      into v_items, v_delta_total
      from public.stock_opname_items i
     where i.stock_opname_id = p_opname_id;
    return private.opname_response(v_opname, jsonb_build_object(
      'item_count', v_items,
      'delta_total', v_delta_total,
      'already_processed', true,
      'result', 'already_posted'
    ));
  end if;

  if v_opname.status <> 'approved' then
    raise exception using errcode = '22023', message = format('OPNAME_NOT_APPROVED: Sesi berstatus %s tidak dapat diposting.', v_opname.status);
  end if;

  -- Lock every affected product in deterministic product_id order. Products are
  -- locked only inside this transaction, never during the counting period.
  perform 1
     from public.products p
    where p.id in (select i.product_id from public.stock_opname_items i where i.stock_opname_id = p_opname_id)
    order by p.id
    for update;

  -- Detect staleness against the snapshot taken at creation.
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', x.id,
           'product_id', x.product_id,
           'sku', x.sku,
           'snapshot_version', x.stock_version_snapshot,
           'current_version', x.stock_version,
           'snapshot_qty', x.system_qty_snapshot,
           'current_qty', x.stock_on_hand
         ) order by x.sku), '[]'::jsonb)
    into v_conflicts
    from (
      select i.id, i.product_id, p.sku, i.stock_version_snapshot, p.stock_version,
             i.system_qty_snapshot, p.stock_on_hand
        from public.stock_opname_items i
        join public.products p on p.id = i.product_id
       where i.stock_opname_id = p_opname_id
         and p.stock_version <> i.stock_version_snapshot
    ) x;

  if jsonb_array_length(v_conflicts) > 0 then
    update public.stock_opname_items i
       set count_status = 'needs_recount'
     where i.stock_opname_id = p_opname_id
       and i.product_id in (
         select (c ->> 'product_id')::uuid
           from jsonb_array_elements(v_conflicts) c
       );

    update public.stock_opnames o
       set status = 'counting',
           approved_by = null,
           approved_at = null
     where o.id = p_opname_id
     returning * into v_opname;

    perform private.write_audit(
      v_actor, 'opname.post_conflict', 'stock_opnames', p_opname_id::text,
      jsonb_build_object('status', 'approved'),
      jsonb_build_object('status', 'counting', 'conflict_count', jsonb_array_length(v_conflicts)),
      null
    );

    return private.opname_response(v_opname, jsonb_build_object(
      'result', 'version_conflict',
      'conflicts', v_conflicts,
      'already_processed', false
    ));
  end if;

  -- Completeness is revalidated here: nothing may be posted half-counted.
  if jsonb_array_length(private.opname_blockers(p_opname_id)) > 0 then
    raise exception using errcode = '22023', message = 'OPNAME_INCOMPLETE: Masih ada item belum lengkap.';
  end if;

  for v_rec in
    select i.*, p.stock_on_hand, p.stock_version, p.sku
      from public.stock_opname_items i
      join public.products p on p.id = i.product_id
     where i.stock_opname_id = p_opname_id
     order by i.product_id
  loop
    v_items := v_items + 1;
    v_stock := v_rec.stock_on_hand;
    v_version := v_rec.stock_version;

    if v_rec.system_qty_snapshot is null then
      -- Opening balance: unknown previous stock, so quantity_before is NULL.
      v_after := v_rec.physical_qty;
      insert into public.stock_movements (
        product_id, movement_type, quantity_delta, quantity_before, quantity_after,
        stock_opname_id, reason_code, reason_note, actor_id, idempotency_key
      )
      values (
        v_rec.product_id, 'opening_balance', v_after, null, v_after,
        p_opname_id, 'opening_balance', v_rec.reason_note, v_actor,
        md5(p_opname_id::text || ':opening_balance:' || v_rec.product_id::text)::uuid
      )
      returning id into v_movement_id;

      v_openings := v_openings + 1;
      v_delta_total := v_delta_total + v_after;
    else
      v_delta := v_rec.physical_qty - v_rec.system_qty_snapshot;

      if v_delta = 0 then
        v_moved := v_moved + 1;
        update public.stock_opname_items i
           set count_status = 'posted'
         where i.id = v_rec.id;
        continue;
      end if;

      v_after := v_rec.physical_qty;
      insert into public.stock_movements (
        product_id, movement_type, quantity_delta, quantity_before, quantity_after,
        stock_opname_id, reason_code, reason_note, actor_id, idempotency_key
      )
      values (
        v_rec.product_id, 'opname_adjustment', v_delta, v_rec.system_qty_snapshot, v_after,
        p_opname_id, v_rec.reason_code, v_rec.reason_note, v_actor,
        md5(p_opname_id::text || ':opname_adjustment:' || v_rec.product_id::text)::uuid
      )
      returning id into v_movement_id;

      select coalesce(max(d.revision), 0) + 1 into v_revision
        from public.stock_discrepancy_logs d
       where d.stock_opname_item_id = v_rec.id;

      insert into public.stock_discrepancy_logs (
        stock_opname_item_id, revision, product_id, system_qty, physical_qty,
        difference_qty, reason_code, reason_note, created_by, approved_by, created_at
      )
      values (
        v_rec.id, v_revision, v_rec.product_id, v_rec.system_qty_snapshot, v_rec.physical_qty,
        v_delta, v_rec.reason_code, v_rec.reason_note, v_rec.counted_by, v_actor, v_posted_at
      );

      v_diffs := v_diffs + 1;
      v_delta_total := v_delta_total + v_delta;
    end if;

    update public.products p
       set stock_on_hand = v_after,
           stock_version = v_version + 1,
           updated_by = v_actor
     where p.id = v_rec.product_id;

    update public.stock_opname_items i
       set count_status = 'posted'
     where i.id = v_rec.id;
  end loop;

  update public.stock_opnames o
     set status = 'posted', posted_by = v_actor, posted_at = v_posted_at
   where o.id = p_opname_id
   returning * into v_opname;

  perform private.write_audit(
    v_actor, 'opname.post', 'stock_opnames', p_opname_id::text,
    jsonb_build_object('status', 'approved'),
    jsonb_build_object(
      'status', 'posted',
      'item_count', v_items,
      'opening_balance_count', v_openings,
      'discrepancy_count', v_diffs,
      'delta_total', v_delta_total
    ),
    null
  );

  return private.opname_response(v_opname, jsonb_build_object(
    'result', 'posted',
    'item_count', v_items,
    'unchanged_count', v_moved,
    'opening_balance_count', v_openings,
    'discrepancy_count', v_diffs,
    'delta_total', v_delta_total,
    'already_processed', false
  ));
end;
$$;

revoke all on function private.post_stock_opname(uuid) from public;

-- 11. CANCEL. Unfinished sessions only; cancelling never touches stock.
create or replace function private.cancel_stock_opname(p_opname_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_opname public.stock_opnames%rowtype;
  v_reason text;
  v_previous_status text;
begin
  v_actor := private.require_active_role(array['owner']);

  if p_opname_id is null then
    raise exception using errcode = '22023', message = 'OPNAME_REQUIRED: p_opname_id wajib diisi.';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception using errcode = '22023', message = 'CANCEL_REASON_REQUIRED: Alasan pembatalan wajib diisi.';
  end if;
  if char_length(v_reason) > 500 then
    raise exception using errcode = '22023', message = 'CANCEL_REASON_TOO_LONG: Alasan pembatalan maksimal 500 karakter.';
  end if;

  select * into v_opname
    from public.stock_opnames o
   where o.id = p_opname_id
     for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'OPNAME_NOT_FOUND: Sesi opname tidak ditemukan.';
  end if;

  if v_opname.status = 'cancelled' then
    return private.opname_response(v_opname, jsonb_build_object('already_processed', true));
  end if;

  if v_opname.status = 'posted' then
    raise exception using errcode = '22023', message = 'OPNAME_POSTED: Sesi yang sudah diposting tidak dapat dibatalkan.';
  end if;

  -- Capture the pre-update status: the UPDATE below overwrites v_opname, and the
  -- audit trail must record what the session actually was before cancellation.
  v_previous_status := v_opname.status;

  update public.stock_opnames o
     set status = 'cancelled',
         cancelled_by = v_actor,
         cancelled_at = now(),
         cancelled_reason = v_reason
   where o.id = p_opname_id
   returning * into v_opname;

  perform private.write_audit(
    v_actor, 'opname.cancel', 'stock_opnames', p_opname_id::text,
    jsonb_build_object('status', v_previous_status),
    jsonb_build_object('status', 'cancelled', 'reason', v_reason),
    v_reason
  );

  return private.opname_response(v_opname, jsonb_build_object('already_processed', false));
end;
$$;

revoke all on function private.cancel_stock_opname(uuid, text) from public;

-- 12. Public wrappers. Thin SECURITY DEFINER pass-throughs, same pattern as
-- complete_sale/void_sale. anon and PUBLIC keep no EXECUTE grant.
create or replace function public.create_stock_opname(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.create_stock_opname(p_payload);
$$;

revoke all on function public.create_stock_opname(jsonb) from public, anon, authenticated;
grant execute on function public.create_stock_opname(jsonb) to authenticated;

create or replace function public.record_stock_opname_count(
  p_stock_opname_item_id uuid,
  p_physical_qty numeric,
  p_reason_code text,
  p_reason_note text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.record_stock_opname_count(p_stock_opname_item_id, p_physical_qty, p_reason_code, p_reason_note);
$$;

revoke all on function public.record_stock_opname_count(uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function public.record_stock_opname_count(uuid, numeric, text, text) to authenticated;

create or replace function public.submit_stock_opname(p_opname_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.submit_stock_opname(p_opname_id);
$$;

revoke all on function public.submit_stock_opname(uuid) from public, anon, authenticated;
grant execute on function public.submit_stock_opname(uuid) to authenticated;

create or replace function public.approve_stock_opname(p_opname_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.approve_stock_opname(p_opname_id);
$$;

revoke all on function public.approve_stock_opname(uuid) from public, anon, authenticated;
grant execute on function public.approve_stock_opname(uuid) to authenticated;

create or replace function public.post_stock_opname(p_opname_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.post_stock_opname(p_opname_id);
$$;

revoke all on function public.post_stock_opname(uuid) from public, anon, authenticated;
grant execute on function public.post_stock_opname(uuid) to authenticated;

create or replace function public.cancel_stock_opname(p_opname_id uuid, p_reason text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.cancel_stock_opname(p_opname_id, p_reason);
$$;

revoke all on function public.cancel_stock_opname(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_stock_opname(uuid, text) to authenticated;
