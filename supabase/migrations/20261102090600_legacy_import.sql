-- 0007 — legacy import staging
-- Original text is preserved. Candidates are suggestions only; no migration
-- or trigger assigns a SKU automatically.

create table public.legacy_import_runs (
  id uuid primary key default gen_random_uuid(),
  source_filename text not null,
  source_sha256 text not null,
  status text not null default 'running',
  total_rows integer not null default 0,
  matched_rows integer not null default 0,
  ambiguous_rows integer not null default 0,
  unmatched_rows integer not null default 0,
  imported_by uuid references public.profiles(id) on delete restrict,
  notes text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint legacy_import_runs_status_valid check (
    status in ('running', 'completed', 'failed', 'rolled_back')
  ),
  constraint legacy_import_runs_counts_nonnegative check (
    total_rows >= 0 and matched_rows >= 0 and ambiguous_rows >= 0 and unmatched_rows >= 0
  ),
  constraint legacy_import_runs_source_not_blank check (
    btrim(source_filename) <> '' and btrim(source_sha256) <> ''
  )
);

create table public.legacy_transactions_raw (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.legacy_import_runs(id) on delete cascade,
  source_row_number integer not null,
  legacy_transaction_id_raw text,
  business_date_raw text,
  timestamp_raw text,
  cashier_name_raw text,
  subtotal_raw text,
  discount_raw text,
  total_raw text,
  payment_method_raw text,
  parsed_business_date date,
  parsed_total numeric(14,2),
  parse_status text not null default 'pending',
  confidence numeric(3,2),
  mismatch_flags text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint legacy_transactions_raw_unique unique (run_id, source_row_number),
  constraint legacy_transactions_raw_status_valid check (
    parse_status in ('pending', 'parsed', 'needs_review', 'rejected')
  ),
  constraint legacy_transactions_raw_confidence_range check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  ),
  constraint legacy_transactions_raw_row_positive check (source_row_number > 0)
);

create table public.legacy_transaction_items_raw (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.legacy_import_runs(id) on delete cascade,
  header_raw_id bigint references public.legacy_transactions_raw(id) on delete cascade,
  source_row_number integer not null,
  product_name_raw text not null,
  quantity_raw text,
  unit_price_raw text,
  line_total_raw text,
  parsed_quantity numeric(14,3),
  parsed_unit_price numeric(14,2),
  parsed_line_total numeric(14,2),
  candidate_product_id uuid references public.products(id) on delete restrict,
  candidate_confidence numeric(3,2),
  match_status text not null default 'unmatched',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint legacy_transaction_items_raw_unique unique (run_id, source_row_number),
  constraint legacy_transaction_items_raw_name_not_blank check (btrim(product_name_raw) <> ''),
  constraint legacy_transaction_items_raw_status_valid check (
    match_status in ('unmatched', 'suggested', 'confirmed', 'rejected')
  ),
  constraint legacy_transaction_items_raw_confidence_range check (
    candidate_confidence is null or (candidate_confidence >= 0 and candidate_confidence <= 1)
  ),
  constraint legacy_transaction_items_raw_candidate_rule check (
    candidate_product_id is null
    or match_status in ('suggested', 'confirmed')
  ),
  constraint legacy_transaction_items_raw_row_positive check (source_row_number > 0)
);

create index legacy_transactions_raw_run_idx
  on public.legacy_transactions_raw (run_id, parse_status);
create index legacy_transaction_items_raw_run_idx
  on public.legacy_transaction_items_raw (run_id, match_status);
create index legacy_transaction_items_raw_candidate_idx
  on public.legacy_transaction_items_raw (candidate_product_id)
  where candidate_product_id is not null;
