-- 0004 — catalog
-- stock_on_hand stays nullable: unknown stock is not zero. It is only ever
-- changed by inventory RPCs, never by the catalog RPC or direct client writes.

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  sku_normalized text generated always as (upper(btrim(sku))) stored,
  name text not null,
  normalized_name text generated always as (lower(btrim(name))) stored,
  category_id bigint references public.categories(id) on delete restrict,
  unit_id smallint not null references public.units_of_measure(id) on delete restrict,
  sale_price numeric(14,2),
  stock_on_hand numeric(14,3),
  stock_version bigint not null default 0,
  low_stock_threshold numeric(14,3),
  is_active boolean not null default true,
  import_review_status text not null default 'verified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint products_sku_canonical check (sku = btrim(sku) and char_length(sku) between 1 and 64),
  constraint products_sku_normalized_key unique (sku_normalized),
  constraint products_name_canonical check (name = btrim(name) and char_length(name) between 1 and 200),
  constraint products_sale_price_nonnegative check (sale_price is null or sale_price >= 0),
  constraint products_stock_version_nonnegative check (stock_version >= 0),
  constraint products_low_stock_nonnegative check (low_stock_threshold is null or low_stock_threshold >= 0),
  constraint products_import_review_status_valid check (
    import_review_status in (
      'verified', 'stock_unknown', 'negative_opening_stock',
      'price_missing', 'review_required'
    )
  )
);

create trigger products_set_updated_at
before update on public.products
for each row execute function private.set_updated_at();

create table public.product_costs (
  product_id uuid primary key references public.products(id) on delete cascade,
  purchase_cost numeric(14,2),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint product_costs_nonnegative check (purchase_cost is null or purchase_cost >= 0)
);

create trigger product_costs_set_updated_at
before update on public.product_costs
for each row execute function private.set_updated_at();

create table public.product_aliases (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  alias_name text not null,
  normalized_alias text generated always as (lower(btrim(alias_name))) stored,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  constraint product_aliases_name_not_blank check (btrim(alias_name) <> ''),
  constraint product_aliases_source_valid check (source in ('manual', 'legacy_import', 'barcode')),
  constraint product_aliases_normalized_key unique (normalized_alias)
);

create table public.product_price_tiers (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  tier_key text not null,
  min_quantity numeric(14,3) not null default 1,
  unit_price numeric(14,2) not null,
  is_active boolean not null default true,
  constraint product_price_tiers_key_valid check (tier_key in ('retail', 'wholesale')),
  constraint product_price_tiers_min_quantity_positive check (min_quantity > 0),
  constraint product_price_tiers_unit_price_nonnegative check (unit_price >= 0),
  constraint product_price_tiers_unique unique (product_id, tier_key, min_quantity)
);

-- One row per independent data quality issue, so a SKU can be both
-- stock_unknown and sale_price_missing. Resolution keeps the history.
create table public.product_data_issues (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  issue_code text not null,
  detail text,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint product_data_issues_code_valid check (
    issue_code in (
      'stock_unknown', 'negative_stock', 'sale_price_missing',
      'purchase_cost_missing', 'sale_below_cost', 'category_unmapped',
      'unit_unmapped', 'duplicate_name', 'other'
    )
  ),
  constraint product_data_issues_other_detail check (
    issue_code <> 'other' or nullif(btrim(detail), '') is not null
  ),
  constraint product_data_issues_unique unique (product_id, issue_code)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  display_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger customers_set_updated_at
before update on public.customers
for each row execute function private.set_updated_at();

create index products_category_idx on public.products (category_id);
create index products_active_sku_idx on public.products (is_active, sku_normalized);
create index products_name_trgm_idx on public.products using gin (normalized_name extensions.gin_trgm_ops);
create index product_aliases_product_idx on public.product_aliases (product_id);
create index product_data_issues_unresolved_idx
  on public.product_data_issues (product_id) where resolved_at is null;
