-- 0019 — Phase 12: resolve a product import review row
-- Additive only: one private function plus its public wrapper. It closes the
-- gap left by 0012: `product_import_rows.reviewed_by`/`reviewed_at` existed but
-- no function ever wrote them, so a `review` row could never leave that state
-- (import_product_import_row only accepts `ready`/`failed`).
--
-- Contract: docs/04-rpc-contracts.md §6.
--   approve — owner supplies the corrected prices, the row becomes `ready` and
--             is then imported through the existing import_product_import_row.
--   reject  — the row becomes `rejected` with a required reason.
--
-- A completed run is reopened (`running`) so the corrected row can be imported
-- and the run closed again through finish_product_import, which recomputes the
-- counters. Stock is never touched here.

create or replace function private.resolve_product_import_review(
  p_run_id uuid,
  p_source_row_number integer,
  p_action text,
  p_sale_price numeric default null,
  p_purchase_cost numeric default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_active_role(array['owner']);
  v_run public.product_import_runs%rowtype;
  v_row public.product_import_rows%rowtype;
  v_before jsonb;
  v_action text;
  v_reason text;
  v_sale numeric(14,2);
  v_cost numeric(14,2);
  v_issues text[];
  v_review_status text;
begin
  if p_run_id is null or p_source_row_number is null then
    raise exception using errcode = '22023', message = 'ROW_REQUIRED: Run dan nomor baris wajib diisi.';
  end if;

  v_action := lower(btrim(coalesce(p_action, '')));
  if v_action not in ('approve', 'reject') then
    raise exception using errcode = '22023', message = 'INVALID_ACTION: Aksi harus approve atau reject.';
  end if;

  select * into v_run
    from public.product_import_runs r
   where r.id = p_run_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'RUN_NOT_FOUND: Run impor tidak ditemukan.';
  end if;

  select * into v_row
    from public.product_import_rows r
   where r.run_id = p_run_id
     and r.source_row_number = p_source_row_number
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ROW_NOT_FOUND: Baris staging tidak ditemukan.';
  end if;

  if v_row.product_id is not null then
    raise exception using errcode = '22023', message = 'ROW_ALREADY_IMPORTED: Baris ini sudah menjadi produk.';
  end if;
  if v_row.validation_status <> 'review' then
    raise exception using errcode = '22023',
      message = format('ROW_NOT_IN_REVIEW: Baris berstatus %s, bukan review.', v_row.validation_status);
  end if;

  v_before := to_jsonb(v_row);

  if v_action = 'reject' then
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    if v_reason is null then
      raise exception using errcode = '22023', message = 'REASON_REQUIRED: Alasan penolakan wajib diisi.';
    end if;
    if char_length(v_reason) > 500 then
      raise exception using errcode = '22023', message = 'REASON_TOO_LONG: Alasan maksimal 500 karakter.';
    end if;

    update public.product_import_rows r
       set validation_status = 'rejected',
           review_status = 'review_required',
           error_messages = array_append(r.error_messages, v_reason),
           reviewed_by = v_actor,
           reviewed_at = now()
     where r.id = v_row.id
     returning * into v_row;
  else
    -- Missing means "keep the staged value"; an explicit NULL is not a way to
    -- blank a price here. The owner corrects numbers, not erases them.
    v_sale := coalesce(p_sale_price, v_row.sale_price);
    v_cost := coalesce(p_purchase_cost, v_row.purchase_cost);

    if v_sale is null then
      raise exception using errcode = '22023', message = 'SALE_PRICE_REQUIRED: Harga jual wajib diisi sebelum baris diimpor.';
    end if;
    if v_sale < 0 or (v_cost is not null and v_cost < 0) then
      raise exception using errcode = '22023', message = 'INVALID_PRICE: Harga tidak boleh negatif.';
    end if;
    -- The whole point of the review is a price the owner stands behind: a row
    -- that is still sold below cost cannot be approved.
    if v_cost is not null and v_sale < v_cost then
      raise exception using errcode = '22023',
        message = format('SALE_BELOW_COST: Harga jual %s masih di bawah harga beli %s.', v_sale, v_cost);
    end if;

    -- Recompute only the price issues; every other code (stock, category,
    -- duplicate name) still describes the source row and is kept as-is.
    select coalesce(array_agg(code order by code), '{}'::text[])
      into v_issues
      from unnest(v_row.issue_codes) as code
     where code not in ('sale_below_cost', 'sale_price_missing');
    if v_cost is null then
      v_issues := array_append(v_issues, 'purchase_cost_missing');
    end if;

    -- Mirrors reviewStatusFor() in scripts/product-import-rules.mjs: negative
    -- opening stock wins over an unknown balance, and price is already known.
    if v_row.stock_source is not null and v_row.stock_source < 0 then
      v_review_status := 'negative_opening_stock';
    else
      v_review_status := 'stock_unknown';
    end if;

    update public.product_import_rows r
       set sale_price = v_sale,
           purchase_cost = v_cost,
           validation_status = 'ready',
           review_status = v_review_status,
           issue_codes = v_issues,
           error_messages = '{}',
           reviewed_by = v_actor,
           reviewed_at = now()
     where r.id = v_row.id
     returning * into v_row;
  end if;

  -- A completed run must accept the corrected row, so reopen it; the counters
  -- are recomputed by finish_product_import when the owner closes it again.
  if v_run.status = 'completed' then
    update public.product_import_runs r
       set status = 'running',
           finished_at = null
     where r.id = v_run.id
     returning * into v_run;

    perform private.write_audit(
      v_actor, 'product_import.resume', 'product_import_runs', v_run.id::text,
      null, to_jsonb(v_run), 'Dibuka kembali untuk menyelesaikan baris review'
    );
  elsif v_run.status = 'failed' then
    update public.product_import_runs r
       set status = 'running',
           finished_at = null
     where r.id = v_run.id
     returning * into v_run;
  end if;

  perform private.write_audit(
    v_actor, 'product_import.review', 'product_import_rows', v_row.id::text,
    v_before, to_jsonb(v_row),
    format('Baris %s: %s', p_source_row_number, v_action)
  );

  return jsonb_build_object(
    'status', v_row.validation_status,
    'action', v_action,
    'source_row_number', v_row.source_row_number,
    'sale_price', v_row.sale_price,
    'purchase_cost', v_row.purchase_cost,
    'review_status', v_row.review_status,
    'run_status', v_run.status
  );
end;
$$;

revoke all on function private.resolve_product_import_review(uuid, integer, text, numeric, numeric, text) from public;

create or replace function public.resolve_product_import_review(
  p_run_id uuid,
  p_source_row_number integer,
  p_action text,
  p_sale_price numeric default null,
  p_purchase_cost numeric default null,
  p_reason text default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.resolve_product_import_review(
    p_run_id, p_source_row_number, p_action, p_sale_price, p_purchase_cost, p_reason
  );
$$;

revoke all on function public.resolve_product_import_review(uuid, integer, text, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.resolve_product_import_review(uuid, integer, text, numeric, numeric, text) to authenticated;
