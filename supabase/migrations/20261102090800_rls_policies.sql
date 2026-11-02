-- 0009 — RLS, grants, and policies
-- Order matters: RLS first, then revoke, then the minimum grants, then policies.
-- Only active profiles pass private.has_role; anon has no table grants at all.

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.units_of_measure enable row level security;
alter table public.products enable row level security;
alter table public.product_costs enable row level security;
alter table public.product_aliases enable row level security;
alter table public.product_price_tiers enable row level security;
alter table public.product_data_issues enable row level security;
alter table public.customers enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_items enable row level security;
alter table public.payments enable row level security;
alter table public.document_counters enable row level security;
alter table public.stock_opnames enable row level security;
alter table public.stock_opname_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_discrepancy_logs enable row level security;
alter table public.legacy_import_runs enable row level security;
alter table public.legacy_transactions_raw enable row level security;
alter table public.legacy_transaction_items_raw enable row level security;
alter table public.feature_flags enable row level security;
alter table public.audit_logs enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Reads required by the app. Writes are RPC-only unless stated otherwise.
grant select on public.profiles to authenticated;
grant select on public.categories to authenticated;
grant select on public.units_of_measure to authenticated;
grant select on public.products to authenticated;
grant select on public.product_costs to authenticated;
grant select on public.product_aliases to authenticated;
grant select on public.product_price_tiers to authenticated;
grant select on public.product_data_issues to authenticated;
grant select on public.customers to authenticated;
grant select on public.transactions to authenticated;
grant select on public.transaction_items to authenticated;
grant select on public.payments to authenticated;
grant select on public.stock_opnames to authenticated;
grant select on public.stock_opname_items to authenticated;
grant select on public.stock_movements to authenticated;
grant select on public.stock_discrepancy_logs to authenticated;
grant select on public.legacy_import_runs to authenticated;
grant select on public.legacy_transactions_raw to authenticated;
grant select on public.legacy_transaction_items_raw to authenticated;
grant select on public.feature_flags to authenticated;
grant select on public.audit_logs to authenticated;

-- Reference data is the only direct owner write path in this phase.
grant insert, update, delete on public.categories to authenticated;
grant insert, update, delete on public.units_of_measure to authenticated;
grant usage on sequence public.categories_id_seq to authenticated;
grant usage on sequence public.units_of_measure_id_seq to authenticated;

-- Profiles: self or owner can read. No direct write grant.
create policy profiles_select_self_or_owner on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or (select private.has_role(array['owner']))
);

create policy categories_select_staff on public.categories
for select to authenticated
using (
  (select private.has_role(array['owner', 'cashier', 'inventory_staff']))
  and (is_active = true or (select private.has_role(array['owner'])))
);

create policy categories_owner_write on public.categories
for all to authenticated
using ((select private.has_role(array['owner'])))
with check ((select private.has_role(array['owner'])));

create policy units_select_staff on public.units_of_measure
for select to authenticated
using (
  (select private.has_role(array['owner', 'cashier', 'inventory_staff']))
  and (is_active = true or (select private.has_role(array['owner'])))
);

create policy units_owner_write on public.units_of_measure
for all to authenticated
using ((select private.has_role(array['owner'])))
with check ((select private.has_role(array['owner'])));

create policy products_select_staff on public.products
for select to authenticated
using (
  (select private.has_role(array['owner', 'cashier', 'inventory_staff']))
  and (
    is_active = true
    or (select private.has_role(array['owner', 'inventory_staff']))
  )
);

create policy product_costs_select_owner on public.product_costs
for select to authenticated
using ((select private.has_role(array['owner'])));

create policy product_aliases_select_staff on public.product_aliases
for select to authenticated
using ((select private.has_role(array['owner', 'cashier', 'inventory_staff'])));

create policy product_price_tiers_select_owner on public.product_price_tiers
for select to authenticated
using ((select private.has_role(array['owner'])));

create policy product_data_issues_select_owner on public.product_data_issues
for select to authenticated
using ((select private.has_role(array['owner'])));

create policy customers_select_owner_or_cashier on public.customers
for select to authenticated
using ((select private.has_role(array['owner', 'cashier'])));

create policy transactions_select_own_or_owner on public.transactions
for select to authenticated
using (
  (select private.has_role(array['owner', 'cashier']))
  and (
    cashier_id = (select auth.uid())
    or (select private.has_role(array['owner']))
  )
);

create policy transaction_items_select_own_or_owner on public.transaction_items
for select to authenticated
using (
  exists (
    select 1
    from public.transactions t
    where t.id = transaction_items.transaction_id
      and (select private.has_role(array['owner', 'cashier']))
      and (
        t.cashier_id = (select auth.uid())
        or (select private.has_role(array['owner']))
      )
  )
);

create policy payments_select_own_or_owner on public.payments
for select to authenticated
using (
  exists (
    select 1
    from public.transactions t
    where t.id = payments.transaction_id
      and (select private.has_role(array['owner', 'cashier']))
      and (
        t.cashier_id = (select auth.uid())
        or (select private.has_role(array['owner']))
      )
  )
);

create policy stock_opnames_select_staff on public.stock_opnames
for select to authenticated
using ((select private.has_role(array['owner', 'inventory_staff'])));

create policy stock_opname_items_select_staff on public.stock_opname_items
for select to authenticated
using ((select private.has_role(array['owner', 'inventory_staff'])));

create policy stock_movements_select_staff on public.stock_movements
for select to authenticated
using ((select private.has_role(array['owner', 'inventory_staff'])));

create policy stock_discrepancy_logs_select_staff on public.stock_discrepancy_logs
for select to authenticated
using ((select private.has_role(array['owner', 'inventory_staff'])));

create policy legacy_import_runs_select_owner on public.legacy_import_runs
for select to authenticated
using ((select private.has_role(array['owner'])));

create policy legacy_transactions_raw_select_owner on public.legacy_transactions_raw
for select to authenticated
using ((select private.has_role(array['owner'])));

create policy legacy_transaction_items_raw_select_owner on public.legacy_transaction_items_raw
for select to authenticated
using ((select private.has_role(array['owner'])));

create policy feature_flags_select_staff on public.feature_flags
for select to authenticated
using ((select private.has_role(array['owner', 'cashier', 'inventory_staff'])));

create policy audit_logs_select_owner on public.audit_logs
for select to authenticated
using ((select private.has_role(array['owner'])));

-- document_counters has RLS enabled and no policy: RPC-only.
