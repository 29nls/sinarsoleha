-- ============================================================================
-- Toko Sinar Soleha - POS Web (starter schema)
-- Target: Supabase PostgreSQL
-- Scope: relational core, stock ledger, opname, payment records, feature flags,
--        and RLS starter policies.
-- Not included by design: Supabase Storage, Supabase Edge Functions.
--
-- IMPORTANT:
-- 1) Review and apply through versioned Supabase migrations, not ad-hoc edits.
-- 2) All stock mutations and sale posting should be exposed through tightly
--    validated PostgreSQL RPC functions (SECURITY DEFINER in private schema).
-- 3) Do not grant browser clients direct UPDATE on products.stock_on_hand or
--    direct INSERT/UPDATE/DELETE on immutable ledgers.
-- 4) Do not store payment gateway secrets in feature_flags.config.
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------- identity and reference data ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('owner', 'cashier', 'inventory_staff')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id bigint generated always as identity primary key,
  name text not null,
  normalized_name text generated always as (lower(btrim(name))) stored,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (normalized_name)
);

create table if not exists public.units_of_measure (
  id smallint generated always as identity primary key,
  code text not null unique,
  label text not null,
  decimal_scale smallint not null default 0 check (decimal_scale between 0 and 3),
  is_active boolean not null default true
);

-- Product row is intentionally safe to SELECT from the cashier UI.
-- stock_on_hand remains NULL until a verified opening count/balance exists.
-- Purchase cost is isolated in product_costs and is not exposed to cashier RLS.
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  normalized_name text generated always as (lower(btrim(name))) stored,
  category_id bigint references public.categories(id) on delete restrict,
  unit_id smallint not null references public.units_of_measure(id) on delete restrict,
  sale_price numeric(14,2),
  stock_on_hand numeric(14,3) default null,
  stock_version bigint not null default 0,
  low_stock_threshold numeric(14,3),
  is_active boolean not null default true,
  import_review_status text not null default 'verified'
    check (import_review_status in ('verified', 'stock_unknown', 'negative_opening_stock', 'price_missing', 'review_required')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.product_costs (
  product_id uuid primary key references public.products(id) on delete cascade,
  purchase_cost numeric(14,2),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

-- Aliases support controlled matching of legacy Detail_Barang names to SKUs.
create table if not exists public.product_aliases (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  alias_name text not null,
  normalized_alias text generated always as (lower(btrim(alias_name))) stored,
  source text not null default 'manual' check (source in ('manual', 'legacy_import', 'barcode')),
  created_at timestamptz not null default now(),
  unique (normalized_alias)
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  display_name text,
  phone text,
  created_at timestamptz not null default now()
);

-- Optional price tiers. Current workbook supplies one Harga Jual only; keep
-- wholesale disabled until the owner approves tier rules and prices.
create table if not exists public.product_price_tiers (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  tier_key text not null check (tier_key in ('retail', 'wholesale')),
  min_quantity numeric(14,3) not null default 1 check (min_quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  is_active boolean not null default true,
  unique (product_id, tier_key, min_quantity)
);

-- ---------- sales ----------
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  receipt_no text not null unique,
  legacy_transaction_id text unique,
  idempotency_key uuid unique,
  business_date date not null,
  cashier_id uuid not null references public.profiles(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'completed' check (status in ('completed', 'voided')),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  grand_total numeric(14,2) not null check (grand_total >= 0),
  reconciliation_status text not null default 'matched'
    check (reconciliation_status in ('matched', 'legacy_mismatch', 'reviewed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles(id) on delete set null,
  void_reason text,
  note text,
  check (status <> 'voided' or (voided_at is not null and void_reason is not null))
);

create table if not exists public.transaction_items (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete restrict,
  product_id uuid references public.products(id) on delete restrict,
  sku_snapshot text not null,
  product_name_snapshot text not null,
  unit_label_snapshot text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  line_discount_amount numeric(14,2) not null default 0 check (line_discount_amount >= 0),
  line_subtotal numeric(14,2) not null check (line_subtotal >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

-- amount_applied is the amount allocated to settle the invoice.
-- cash_received/cash_change preserve physical cash-tender details.
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete restrict,
  method text not null check (method in ('cash', 'qris', 'other')),
  amount_applied numeric(14,2) not null check (amount_applied >= 0),
  cash_received numeric(14,2),
  cash_change numeric(14,2) not null default 0 check (cash_change >= 0),
  provider_code text,
  provider_reference text,
  payment_status text not null default 'confirmed' check (payment_status in ('pending', 'confirmed', 'failed', 'refunded')),
  created_at timestamptz not null default now(),
  check ((method <> 'cash') or (cash_received is not null and cash_received >= amount_applied))
);

-- ---------- inventory and stock opname ----------
create table if not exists public.stock_opnames (
  id uuid primary key default gen_random_uuid(),
  opname_no text not null unique,
  status text not null default 'draft'
    check (status in ('draft', 'counting', 'submitted', 'approved', 'posted', 'cancelled')),
  scope_note text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  submitted_at timestamptz,
  approved_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz,
  posted_by uuid references public.profiles(id) on delete restrict,
  posted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_opname_items (
  id uuid primary key default gen_random_uuid(),
  stock_opname_id uuid not null references public.stock_opnames(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  system_qty_snapshot numeric(14,3),
  stock_version_snapshot bigint not null,
  physical_qty numeric(14,3),
  difference_qty numeric(14,3) generated always as (physical_qty - system_qty_snapshot) stored,
  reason_code text,
  reason_note text,
  counted_by uuid references public.profiles(id) on delete set null,
  counted_at timestamptz,
  unique (stock_opname_id, product_id),
  check (
    physical_qty is null
    or (
      system_qty_snapshot is null
      and reason_code = 'opening_balance'
      and nullif(btrim(reason_note), '') is not null
    )
    or (
      system_qty_snapshot is not null
      and (physical_qty = system_qty_snapshot or (
        reason_code is not null
        and (reason_code <> 'other' or nullif(btrim(reason_note), '') is not null)
      ))
    )
  )
);

create table if not exists public.stock_movements (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type text not null check (movement_type in ('opening_balance', 'sale_out', 'opname_adjustment', 'manual_adjustment', 'return_in', 'purchase_in', 'void_reversal')),
  quantity_delta numeric(14,3) not null,
  quantity_before numeric(14,3),
  quantity_after numeric(14,3) not null,
  transaction_id uuid references public.transactions(id) on delete restrict,
  stock_opname_id uuid references public.stock_opnames(id) on delete restrict,
  reason_code text,
  reason_note text,
  actor_id uuid references public.profiles(id) on delete set null,
  idempotency_key uuid unique,
  created_at timestamptz not null default now(),
  check (
    (transaction_id is not null and stock_opname_id is null)
    or (transaction_id is null and stock_opname_id is not null)
    or (transaction_id is null and stock_opname_id is null)
  )
);

create table if not exists public.stock_discrepancy_logs (
  id bigint generated always as identity primary key,
  stock_opname_item_id uuid not null unique references public.stock_opname_items(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  system_qty numeric(14,3) not null,
  physical_qty numeric(14,3) not null,
  difference_qty numeric(14,3) not null,
  reason_code text not null,
  reason_note text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  approved_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (difference_qty <> 0),
  check (reason_code <> 'other' or nullif(btrim(reason_note), '') is not null)
);

-- ---------- modular settings / audit ----------
create table if not exists public.feature_flags (
  feature_key text primary key,
  enabled boolean not null default false,
  public_config jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action_key text not null,
  entity_name text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz not null default now()
);

-- ---------- indexes ----------
create index if not exists products_category_idx on public.products(category_id);
create index if not exists products_active_sku_idx on public.products(is_active, sku);
create index if not exists products_name_trgm_idx on public.products using gin (name gin_trgm_ops);
create index if not exists transactions_business_date_idx on public.transactions(business_date desc);
create index if not exists transactions_cashier_date_idx on public.transactions(cashier_id, business_date desc);
create index if not exists transaction_items_product_idx on public.transaction_items(product_id);
create index if not exists stock_movements_product_created_idx on public.stock_movements(product_id, created_at desc);
create index if not exists stock_opname_status_idx on public.stock_opnames(status, created_at desc);
create index if not exists stock_discrepancy_product_created_idx on public.stock_discrepancy_logs(product_id, created_at desc);

-- ---------- role helper ----------
-- Security-definer helper is kept in non-exposed schema and pins search_path.
create or replace function private.has_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active = true
      and p.role = any (p_roles)
  );
$$;
revoke all on function private.has_role(text[]) from public;
grant execute on function private.has_role(text[]) to authenticated;

-- ---------- enable RLS ----------
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.units_of_measure enable row level security;
alter table public.products enable row level security;
alter table public.product_costs enable row level security;
alter table public.product_aliases enable row level security;
alter table public.customers enable row level security;
alter table public.product_price_tiers enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_items enable row level security;
alter table public.payments enable row level security;
alter table public.stock_opnames enable row level security;
alter table public.stock_opname_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_discrepancy_logs enable row level security;
alter table public.feature_flags enable row level security;
alter table public.audit_logs enable row level security;

-- No anonymous access. Start from least privilege, then grant required reads.
revoke all on all tables in schema public from anon, authenticated;

grant select on public.categories, public.units_of_measure, public.products,
  public.product_aliases, public.product_price_tiers, public.feature_flags to authenticated;
grant select on public.profiles, public.transactions, public.transaction_items,
  public.payments, public.stock_opnames, public.stock_opname_items,
  public.stock_movements, public.stock_discrepancy_logs, public.audit_logs to authenticated;
grant select on public.product_costs to authenticated;
grant update (full_name, role, is_active, updated_at) on public.profiles to authenticated;
grant insert, update, delete on public.categories, public.units_of_measure to authenticated;
grant insert, update, delete on public.product_costs, public.product_aliases, public.product_price_tiers to authenticated;
grant update on public.feature_flags to authenticated;

-- Profiles: self-read; owner can inspect/manage role records through controlled admin path.
create policy profiles_read_self_or_owner on public.profiles
for select to authenticated
using (id = (select auth.uid()) or (select private.has_role(array['owner'])));
create policy profiles_owner_update on public.profiles
for update to authenticated
using ((select private.has_role(array['owner'])))
with check ((select private.has_role(array['owner'])));

-- Reference data and catalog are readable only by active authenticated users.
create policy categories_read_active on public.categories
for select to authenticated using ((select private.has_role(array['owner', 'cashier', 'inventory_staff']))
  and (is_active = true or (select private.has_role(array['owner']))));
create policy categories_owner_all on public.categories
for all to authenticated
using ((select private.has_role(array['owner'])))
with check ((select private.has_role(array['owner'])));

create policy units_read_active on public.units_of_measure
for select to authenticated using ((select private.has_role(array['owner', 'cashier', 'inventory_staff']))
  and (is_active = true or (select private.has_role(array['owner']))));
create policy units_owner_all on public.units_of_measure
for all to authenticated
using ((select private.has_role(array['owner'])))
with check ((select private.has_role(array['owner'])));

create policy products_read_active on public.products
for select to authenticated
using ((select private.has_role(array['owner', 'cashier', 'inventory_staff']))
  and (is_active = true or (select private.has_role(array['owner', 'inventory_staff']))));
-- Product metadata updates can be granted through a separate RPC/admin workflow.
-- Do not grant direct stock_on_hand or stock_version updates to browser roles.

create policy product_costs_owner_read on public.product_costs
for select to authenticated using ((select private.has_role(array['owner'])));
create policy product_costs_owner_manage on public.product_costs
for all to authenticated using ((select private.has_role(array['owner'])))
with check ((select private.has_role(array['owner'])));

create policy product_aliases_read on public.product_aliases
for select to authenticated using ((select private.has_role(array['owner', 'cashier', 'inventory_staff'])));
create policy product_aliases_owner_manage on public.product_aliases
for all to authenticated using ((select private.has_role(array['owner'])))
with check ((select private.has_role(array['owner'])));

create policy customers_staff_read on public.customers
for select to authenticated using ((select private.has_role(array['owner', 'cashier'])));

create policy price_tiers_staff_read on public.product_price_tiers
for select to authenticated using ((select private.has_role(array['owner', 'cashier'])));
create policy price_tiers_owner_manage on public.product_price_tiers
for all to authenticated using ((select private.has_role(array['owner'])))
with check ((select private.has_role(array['owner'])));

-- Headers and children: cashier sees own records; owner sees all.
create policy transactions_read_own_or_owner on public.transactions
for select to authenticated
using ((select private.has_role(array['owner', 'cashier']))
  and (cashier_id = (select auth.uid()) or (select private.has_role(array['owner']))));

create policy transaction_items_read_own_or_owner on public.transaction_items
for select to authenticated
using (exists (
  select 1 from public.transactions t
  where t.id = transaction_items.transaction_id
    and (select private.has_role(array['owner', 'cashier']))
    and (t.cashier_id = (select auth.uid()) or (select private.has_role(array['owner'])))
));

create policy payments_read_own_or_owner on public.payments
for select to authenticated
using (exists (
  select 1 from public.transactions t
  where t.id = payments.transaction_id
    and (select private.has_role(array['owner', 'cashier']))
    and (t.cashier_id = (select auth.uid()) or (select private.has_role(array['owner'])))
));

create policy stock_opnames_staff_read on public.stock_opnames
for select to authenticated
using ((select private.has_role(array['owner', 'inventory_staff'])));

create policy stock_opname_items_staff_read on public.stock_opname_items
for select to authenticated
using ((select private.has_role(array['owner', 'inventory_staff'])));

create policy stock_movements_staff_read on public.stock_movements
for select to authenticated
using ((select private.has_role(array['owner', 'inventory_staff'])));

create policy stock_discrepancy_staff_read on public.stock_discrepancy_logs
for select to authenticated
using ((select private.has_role(array['owner', 'inventory_staff'])));

create policy feature_flags_staff_read on public.feature_flags
for select to authenticated using ((select private.has_role(array['owner', 'cashier', 'inventory_staff'])));
create policy feature_flags_owner_update on public.feature_flags
for update to authenticated
using ((select private.has_role(array['owner'])))
with check ((select private.has_role(array['owner'])));

create policy audit_logs_owner_read on public.audit_logs
for select to authenticated using ((select private.has_role(array['owner'])));

-- Explicitly do not create browser INSERT/UPDATE/DELETE grants on:
-- transactions, transaction_items, payments, stock_opnames, stock_opname_items,
-- stock_movements, stock_discrepancy_logs, audit_logs, products.stock_on_hand.
-- NULL stock means unknown and must block checkout; the first verified count
-- posts an opening_balance movement with quantity_before NULL.
-- Implement RPCs such as private.complete_sale(...) and private.post_stock_opname(...)
-- after validating caller role, price/discount limits, stock availability,
-- idempotency_key, stock_version_snapshot, and all payment allocations.
-- Grant EXECUTE on only the required RPC entry points to authenticated.

-- Seed standardized units. Review/merge variants before importing historical data.
insert into public.units_of_measure (code, label, decimal_scale)
values
  ('PCS', 'Pcs', 0), ('LUSIN', 'Lusin', 0), ('METER', 'Meter', 3),
  ('ROLL', 'Roll', 0), ('SET', 'Set', 0), ('PAX', 'Pax', 0),
  ('PACK', 'Pack', 0), ('KARUNG', 'Karung', 0)
on conflict (code) do nothing;

-- Feature flags: manual input is always the baseline; optional adapters default off.
insert into public.feature_flags (feature_key, enabled, public_config)
values
  ('hardware.thermal_printer', false, '{}'::jsonb),
  ('hardware.barcode_scanner', false, '{}'::jsonb),
  ('payment.qris_gateway', false, '{}'::jsonb)
on conflict (feature_key) do nothing;

-- End of starter schema. Test all RLS allow/deny paths and RPC contracts before go-live.
