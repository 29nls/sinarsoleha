-- 0012 — product master import (Phase 3B)
-- Isolated staging for the 1.361-row PART MASTER workbook. It does not reuse
-- the legacy transaction staging tables, and it never writes stock.
--
-- Flow (owner-only, RPC-only writes):
--   begin_product_import        open or resume one run per source checksum
--   stage_product_import_rows   idempotent staged batch, unit resolved by code
--   import_product_import_row   one ready row -> private.upsert_product
--   finish_product_import       close the run with recomputed counters
--
-- stock_on_hand stays NULL: the catalog RPC in 20261102090900_rpc_catalog.sql
-- does not accept stock fields, and no movement is inserted here.

create table public.product_import_runs (
  id uuid primary key default gen_random_uuid(),
  source_filename text not null,
  source_worksheet text not null,
  source_sha256 text not null,
  source_row_count integer not null default 0,
  status text not null default 'running',
  total_rows integer not null default 0,
  ready_rows integer not null default 0,
  review_rows integer not null default 0,
  rejected_rows integer not null default 0,
  imported_rows integer not null default 0,
  imported_by uuid references public.profiles(id) on delete restrict,
  notes text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint product_import_runs_status_valid check (
    status in ('running', 'completed', 'failed', 'rolled_back')
  ),
  constraint product_import_runs_counts_nonnegative check (
    source_row_count >= 0 and total_rows >= 0 and ready_rows >= 0
    and review_rows >= 0 and rejected_rows >= 0 and imported_rows >= 0
  ),
  constraint product_import_runs_source_not_blank check (
    btrim(source_filename) <> '' and btrim(source_worksheet) <> ''
  ),
  constraint product_import_runs_checksum_valid check (source_sha256 ~ '^[0-9a-f]{64}$')
);

create table public.product_import_rows (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.product_import_runs(id) on delete cascade,
  source_row_number integer not null,
  raw_payload jsonb not null default '{}'::jsonb,
  sku_raw text,
  name_raw text,
  category_raw text,
  unit_raw text,
  sale_price_raw text,
  purchase_cost_raw text,
  stock_raw text,
  stock_formula text,
  normalized_sku text not null default '',
  normalized_name text not null default '',
  normalized_category text,
  unit_code text,
  category_id bigint references public.categories(id) on delete restrict,
  unit_id smallint references public.units_of_measure(id) on delete restrict,
  sale_price numeric(14,2),
  purchase_cost numeric(14,2),
  stock_source numeric(14,3),
  validation_status text not null default 'review',
  review_status text not null default 'review_required',
  issue_codes text[] not null default '{}',
  error_messages text[] not null default '{}',
  product_id uuid references public.products(id) on delete set null,
  imported_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_import_rows_unique unique (run_id, source_row_number),
  constraint product_import_rows_row_positive check (source_row_number > 0),
  constraint product_import_rows_status_valid check (
    validation_status in ('ready', 'review', 'rejected', 'imported', 'failed')
  ),
  constraint product_import_rows_review_status_valid check (
    review_status in (
      'verified', 'stock_unknown', 'negative_opening_stock',
      'price_missing', 'review_required'
    )
  ),
  constraint product_import_rows_sale_price_nonnegative check (
    sale_price is null or sale_price >= 0
  ),
  constraint product_import_rows_purchase_cost_nonnegative check (
    purchase_cost is null or purchase_cost >= 0
  ),
  constraint product_import_rows_imported_consistency check (
    (product_id is null and imported_at is null)
    or (product_id is not null and imported_at is not null)
  )
);

create trigger product_import_rows_set_updated_at
before update on public.product_import_rows
for each row execute function private.set_updated_at();

-- One run at a time per source file; a completed workbook cannot be re-imported
-- silently. Failed runs are reopened by begin_product_import, not duplicated.
create unique index product_import_runs_source_key
  on public.product_import_runs (source_sha256, source_worksheet)
  where status in ('running', 'completed', 'failed');

create index product_import_rows_run_status_idx
  on public.product_import_rows (run_id, validation_status);
create index product_import_rows_pending_idx
  on public.product_import_rows (run_id, source_row_number)
  where product_id is null;
create index product_import_rows_product_idx
  on public.product_import_rows (product_id)
  where product_id is not null;
create index product_import_rows_sku_idx
  on public.product_import_rows (normalized_sku);

alter table public.product_import_runs enable row level security;
alter table public.product_import_rows enable row level security;

revoke all on public.product_import_runs, public.product_import_rows from anon, authenticated;
grant select on public.product_import_runs to authenticated;
grant select on public.product_import_rows to authenticated;

create policy product_import_runs_select_owner on public.product_import_runs
for select to authenticated
using ((select private.has_role(array['owner'])));

create policy product_import_rows_select_owner on public.product_import_rows
for select to authenticated
using ((select private.has_role(array['owner'])));

-- ---------------------------------------------------------------------------
-- begin: open a run, or resume the running/failed run for the same source
-- ---------------------------------------------------------------------------
create or replace function private.begin_product_import(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_active_role(array['owner']);
  v_filename text;
  v_worksheet text;
  v_sha text;
  v_row_count integer;
  v_run public.product_import_runs%rowtype;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'INVALID_PAYLOAD: Payload impor tidak valid.';
  end if;

  v_filename := btrim(coalesce(p_payload ->> 'source_filename', ''));
  v_worksheet := btrim(coalesce(p_payload ->> 'source_worksheet', ''));
  v_sha := lower(btrim(coalesce(p_payload ->> 'source_sha256', '')));

  if v_filename = '' or v_worksheet = '' then
    raise exception using errcode = '22023', message = 'SOURCE_REQUIRED: Nama file dan worksheet wajib diisi.';
  end if;
  if v_sha !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'INVALID_CHECKSUM: SHA-256 sumber tidak valid.';
  end if;

  begin
    v_row_count := coalesce((p_payload ->> 'source_row_count')::integer, 0);
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'INVALID_ROW_COUNT: Jumlah baris sumber tidak valid.';
  end;
  if v_row_count < 0 then
    raise exception using errcode = '22023', message = 'INVALID_ROW_COUNT: Jumlah baris sumber tidak boleh negatif.';
  end if;

  select * into v_run
    from public.product_import_runs r
   where r.source_sha256 = v_sha
     and r.source_worksheet = v_worksheet
     and r.status in ('running', 'completed', 'failed')
   for update;

  if found then
    if v_run.status = 'completed' then
      raise exception using errcode = '23505', message = 'IMPORT_ALREADY_COMPLETED: Workbook ini sudah selesai diimpor.';
    end if;
    if v_run.status = 'failed' then
      update public.product_import_runs r
         set status = 'running', finished_at = null
       where r.id = v_run.id
       returning * into v_run;
      perform private.write_audit(
        v_actor, 'product_import.resume', 'product_import_runs', v_run.id::text, null, to_jsonb(v_run), null
      );
    end if;
    return to_jsonb(v_run);
  end if;

  insert into public.product_import_runs (
    source_filename, source_worksheet, source_sha256, source_row_count, imported_by, notes
  )
  values (
    v_filename, v_worksheet, v_sha, v_row_count, v_actor,
    nullif(btrim(coalesce(p_payload ->> 'notes', '')), '')
  )
  returning * into v_run;

  perform private.write_audit(
    v_actor, 'product_import.begin', 'product_import_runs', v_run.id::text, null, to_jsonb(v_run), null
  );

  return to_jsonb(v_run);
exception
  when unique_violation then
    select * into v_run
      from public.product_import_runs r
     where r.source_sha256 = v_sha
       and r.source_worksheet = v_worksheet
       and r.status in ('running', 'failed')
     order by r.started_at desc
     limit 1;
    if found then
      return to_jsonb(v_run);
    end if;
    raise;
end;
$$;

revoke all on function private.begin_product_import(jsonb) from public;

-- ---------------------------------------------------------------------------
-- stage: one atomic batch, idempotent on (run_id, source_row_number)
-- ---------------------------------------------------------------------------
create or replace function private.stage_product_import_rows(p_run_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_active_role(array['owner']);
  v_run public.product_import_runs%rowtype;
  v_requested integer;
  v_staged integer;
begin
  if p_run_id is null then
    raise exception using errcode = '22023', message = 'RUN_REQUIRED: Run impor wajib diisi.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode = '22023', message = 'INVALID_ROWS: Payload baris harus berupa array.';
  end if;
  v_requested := jsonb_array_length(p_rows);
  if v_requested < 1 or v_requested > 200 then
    raise exception using errcode = '22023', message = 'BATCH_SIZE: Satu batch harus berisi 1 sampai 200 baris.';
  end if;

  select * into v_run
    from public.product_import_runs r
   where r.id = p_run_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'RUN_NOT_FOUND: Run impor tidak ditemukan.';
  end if;
  if v_run.status <> 'running' then
    raise exception using errcode = '22023', message = 'IMPORT_NOT_RUNNING: Run impor sudah ditutup.';
  end if;

  insert into public.product_import_rows (
    run_id, source_row_number, raw_payload,
    sku_raw, name_raw, category_raw, unit_raw,
    sale_price_raw, purchase_cost_raw, stock_raw, stock_formula,
    normalized_sku, normalized_name, normalized_category, unit_code,
    category_id, unit_id,
    sale_price, purchase_cost, stock_source,
    validation_status, review_status, issue_codes, error_messages
  )
  select
    p_run_id,
    (item ->> 'source_row_number')::integer,
    coalesce(item -> 'raw_payload', '{}'::jsonb),
    nullif(btrim(item ->> 'sku_raw'), ''),
    nullif(btrim(item ->> 'name_raw'), ''),
    nullif(btrim(item ->> 'category_raw'), ''),
    nullif(btrim(item ->> 'unit_raw'), ''),
    nullif(btrim(item ->> 'sale_price_raw'), ''),
    nullif(btrim(item ->> 'purchase_cost_raw'), ''),
    nullif(btrim(item ->> 'stock_raw'), ''),
    nullif(btrim(item ->> 'stock_formula'), ''),
    btrim(coalesce(item ->> 'normalized_sku', '')),
    btrim(coalesce(item ->> 'normalized_name', '')),
    nullif(btrim(item ->> 'normalized_category'), ''),
    nullif(upper(btrim(item ->> 'unit_code')), ''),
    nullif(btrim(item ->> 'category_id'), '')::bigint,
    u.id,
    nullif(btrim(item ->> 'sale_price'), '')::numeric(14,2),
    nullif(btrim(item ->> 'purchase_cost'), '')::numeric(14,2),
    nullif(btrim(item ->> 'stock_source'), '')::numeric(14,3),
    coalesce(nullif(btrim(item ->> 'validation_status'), ''), 'review'),
    coalesce(nullif(btrim(item ->> 'review_status'), ''), 'review_required'),
    coalesce(array(select jsonb_array_elements_text(item -> 'issue_codes')), '{}'::text[]),
    coalesce(array(select jsonb_array_elements_text(item -> 'error_messages')), '{}'::text[])
  from jsonb_array_elements(p_rows) as item
  left join public.units_of_measure u on u.code = upper(btrim(item ->> 'unit_code'))
  on conflict (run_id, source_row_number) do update
    set raw_payload = excluded.raw_payload,
        sku_raw = excluded.sku_raw,
        name_raw = excluded.name_raw,
        category_raw = excluded.category_raw,
        unit_raw = excluded.unit_raw,
        sale_price_raw = excluded.sale_price_raw,
        purchase_cost_raw = excluded.purchase_cost_raw,
        stock_raw = excluded.stock_raw,
        stock_formula = excluded.stock_formula,
        normalized_sku = excluded.normalized_sku,
        normalized_name = excluded.normalized_name,
        normalized_category = excluded.normalized_category,
        unit_code = excluded.unit_code,
        category_id = excluded.category_id,
        unit_id = excluded.unit_id,
        sale_price = excluded.sale_price,
        purchase_cost = excluded.purchase_cost,
        stock_source = excluded.stock_source,
        validation_status = excluded.validation_status,
        review_status = excluded.review_status,
        issue_codes = excluded.issue_codes,
        error_messages = excluded.error_messages,
        updated_at = now()
  where public.product_import_rows.product_id is null;

  get diagnostics v_staged = row_count;

  return jsonb_build_object('staged', v_staged, 'requested', v_requested);
exception
  when foreign_key_violation then
    raise exception using errcode = '23503', message = 'CATEGORY_NOT_FOUND: Kategori staging tidak ditemukan.';
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'INVALID_ROW: Tipe data baris staging tidak valid.';
  when check_violation then
    raise exception using errcode = '23514', message = 'INVALID_ROW: Baris staging melanggar batas nilai.';
end;
$$;

revoke all on function private.stage_product_import_rows(uuid, jsonb) from public;

-- ---------------------------------------------------------------------------
-- import one ready row: atomic per row, never touches stock
-- ---------------------------------------------------------------------------
create or replace function private.import_product_import_row(
  p_run_id uuid,
  p_source_row_number integer
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
  v_existing public.products%rowtype;
  v_created jsonb;
  v_product_id uuid;
  v_message text;
begin
  if p_run_id is null or p_source_row_number is null then
    raise exception using errcode = '22023', message = 'ROW_REQUIRED: Run dan nomor baris wajib diisi.';
  end if;

  select * into v_run
    from public.product_import_runs r
   where r.id = p_run_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'RUN_NOT_FOUND: Run impor tidak ditemukan.';
  end if;
  if v_run.status <> 'running' then
    raise exception using errcode = '22023', message = 'IMPORT_NOT_RUNNING: Run impor sudah ditutup.';
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
    return jsonb_build_object(
      'status', 'imported',
      'already_imported', true,
      'product_id', v_row.product_id,
      'source_row_number', p_source_row_number
    );
  end if;

  if v_row.validation_status not in ('ready', 'failed') then
    raise exception using errcode = '22023', message = 'ROW_NOT_IMPORTABLE: Hanya baris ready yang boleh diimpor.';
  end if;
  if v_row.unit_id is null then
    raise exception using errcode = '22023', message = 'UNIT_UNMAPPED: Satuan baris belum dipetakan.';
  end if;
  if v_row.normalized_category is not null and v_row.category_id is null then
    raise exception using errcode = '22023', message = 'CATEGORY_UNMAPPED: Kategori baris belum dipetakan.';
  end if;

  select * into v_existing
    from public.products p
   where p.sku_normalized = v_row.normalized_sku;
  if found then
    v_message := format('SKU_ALREADY_EXISTS: SKU %s sudah ada di katalog; baris tidak ditimpa.', v_row.normalized_sku);
    update public.product_import_rows r
       set validation_status = 'rejected',
           error_messages = array_append(r.error_messages, v_message)
     where r.id = v_row.id;
    return jsonb_build_object(
      'status', 'rejected',
      'source_row_number', p_source_row_number,
      'message', v_message
    );
  end if;

  begin
    v_created := private.upsert_product(
      jsonb_build_object(
        'sku', coalesce(nullif(btrim(v_row.sku_raw), ''), v_row.normalized_sku),
        'name', v_row.normalized_name,
        'unit_id', v_row.unit_id,
        'sale_price', v_row.sale_price,
        'is_active', true,
        'import_review_status', v_row.review_status
      )
      || case
           when v_row.category_id is null then '{}'::jsonb
           else jsonb_build_object('category_id', v_row.category_id)
         end
    );
  exception
    when raise_exception or data_exception or integrity_constraint_violation or no_data_found then
      v_message := sqlerrm;
      update public.product_import_rows r
         set validation_status = 'failed',
             error_messages = array_append(r.error_messages, v_message)
       where r.id = v_row.id;
      return jsonb_build_object(
        'status', 'failed',
        'source_row_number', p_source_row_number,
        'message', v_message
      );
  end;

  v_product_id := (v_created ->> 'id')::uuid;

  if v_row.purchase_cost is not null then
    perform private.set_product_cost(v_product_id, v_row.purchase_cost);
  end if;

  insert into public.product_data_issues (product_id, issue_code, detail)
  select
    v_product_id,
    issue.code,
    case issue.code
      when 'stock_unknown' then
        'Stok operasional belum ditetapkan; nilai stok workbook tidak diimpor.'
      when 'negative_stock' then
        format('Stok sumber negatif (%s); saldo operasional tetap NULL sampai opname fisik.', v_row.stock_source)
      when 'sale_price_missing' then
        'Harga jual kosong pada workbook; tetap NULL sampai diisi owner.'
      when 'purchase_cost_missing' then
        'Harga beli kosong pada workbook; tetap NULL.'
      when 'sale_below_cost' then
        format('Harga jual %s di bawah harga beli %s pada workbook.', v_row.sale_price, v_row.purchase_cost)
      when 'category_unmapped' then
        'Kategori sumber tidak terpetakan.'
      when 'unit_unmapped' then
        'Satuan sumber tidak terpetakan.'
      when 'duplicate_name' then
        'Nama sama dengan produk lain setelah normalisasi.'
      else null
    end
  from unnest(v_row.issue_codes) as issue(code)
  where issue.code in (
    'stock_unknown', 'negative_stock', 'sale_price_missing', 'purchase_cost_missing',
    'sale_below_cost', 'category_unmapped', 'unit_unmapped', 'duplicate_name'
  )
  on conflict (product_id, issue_code) do nothing;

  update public.product_import_rows r
     set validation_status = 'imported',
         product_id = v_product_id,
         imported_at = now(),
         error_messages = '{}'
   where r.id = v_row.id;

  perform private.write_audit(
    v_actor,
    'product.import',
    'products',
    v_product_id::text,
    null,
    v_created,
    format('Phase 3B baris %s (run %s)', p_source_row_number, p_run_id)
  );

  return jsonb_build_object(
    'status', 'imported',
    'already_imported', false,
    'product_id', v_product_id,
    'source_row_number', p_source_row_number
  );
end;
$$;

revoke all on function private.import_product_import_row(uuid, integer) from public;

-- ---------------------------------------------------------------------------
-- finish: recompute counters and refuse a partial "completed"
-- ---------------------------------------------------------------------------
create or replace function private.finish_product_import(p_run_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_active_role(array['owner']);
  v_run public.product_import_runs%rowtype;
  v_total integer;
  v_ready integer;
  v_review integer;
  v_rejected integer;
  v_imported integer;
  v_pending integer;
begin
  if p_run_id is null then
    raise exception using errcode = '22023', message = 'RUN_REQUIRED: Run impor wajib diisi.';
  end if;
  if p_status is null or p_status not in ('completed', 'failed') then
    raise exception using errcode = '22023', message = 'INVALID_STATUS: Status akhir harus completed atau failed.';
  end if;

  select * into v_run
    from public.product_import_runs r
   where r.id = p_run_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'RUN_NOT_FOUND: Run impor tidak ditemukan.';
  end if;
  if v_run.status <> 'running' then
    if v_run.status = p_status then
      return to_jsonb(v_run);
    end if;
    raise exception using errcode = '22023', message = 'IMPORT_NOT_RUNNING: Run impor sudah ditutup.';
  end if;

  select
    count(*),
    count(*) filter (where validation_status in ('ready', 'imported', 'failed')),
    count(*) filter (where validation_status = 'review'),
    count(*) filter (where validation_status = 'rejected'),
    count(*) filter (where product_id is not null)
  into v_total, v_ready, v_review, v_rejected, v_imported
  from public.product_import_rows r
  where r.run_id = p_run_id;

  select count(*) into v_pending
    from public.product_import_rows r
   where r.run_id = p_run_id
     and r.product_id is null
     and r.validation_status in ('ready', 'failed');

  if p_status = 'completed' and v_pending > 0 then
    raise exception using errcode = '23514',
      message = format('IMPORT_INCOMPLETE: %s baris siap belum diimpor.', v_pending);
  end if;

  update public.product_import_runs r
     set status = p_status,
         finished_at = now(),
         total_rows = v_total,
         ready_rows = v_ready,
         review_rows = v_review,
         rejected_rows = v_rejected,
         imported_rows = v_imported
   where r.id = p_run_id
   returning * into v_run;

  perform private.write_audit(
    v_actor, 'product_import.finish', 'product_import_runs', p_run_id::text, null, to_jsonb(v_run), null
  );

  return to_jsonb(v_run);
end;
$$;

revoke all on function private.finish_product_import(uuid, text) from public;

-- ---------------------------------------------------------------------------
-- public wrappers (PostgREST)
-- ---------------------------------------------------------------------------
create or replace function public.begin_product_import(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.begin_product_import(p_payload);
$$;

revoke all on function public.begin_product_import(jsonb) from public, anon, authenticated;
grant execute on function public.begin_product_import(jsonb) to authenticated;

create or replace function public.stage_product_import_rows(p_run_id uuid, p_rows jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.stage_product_import_rows(p_run_id, p_rows);
$$;

revoke all on function public.stage_product_import_rows(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.stage_product_import_rows(uuid, jsonb) to authenticated;

create or replace function public.import_product_import_row(p_run_id uuid, p_source_row_number integer)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.import_product_import_row(p_run_id, p_source_row_number);
$$;

revoke all on function public.import_product_import_row(uuid, integer) from public, anon, authenticated;
grant execute on function public.import_product_import_row(uuid, integer) to authenticated;

create or replace function public.finish_product_import(p_run_id uuid, p_status text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.finish_product_import(p_run_id, p_status);
$$;

revoke all on function public.finish_product_import(uuid, text) from public, anon, authenticated;
grant execute on function public.finish_product_import(uuid, text) to authenticated;
