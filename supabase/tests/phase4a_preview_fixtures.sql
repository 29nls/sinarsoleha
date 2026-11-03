-- Phase 4A preview fixtures.
-- RUN ONLY on the disposable preview project (ref ptbllrugrjepdhhdkzxn).
-- NEVER run against production, and never point these SKUs at imported products.
--
-- Creates three TEST products with known stock and matching opening_balance
-- movements (posted opname, snapshot NULL). Run once in the Supabase SQL
-- Editor as the project owner. Re-running is safe while the fixtures still
-- have their initial stock; it will not create a second opening movement.
-- After a hosted test run, stock has changed: do not re-run this file to reset
-- it. Delete/reseed the fixtures deliberately or use a fresh fixture suffix.

begin;

do $$
begin
  if not exists (select 1 from public.profiles where role = 'owner' and is_active) then
    raise exception 'FIXTURE_OWNER_MISSING: aktifkan akun owner sebelum membuat fixture.';
  end if;
end;
$$;

insert into public.products (id, sku, name, unit_id, sale_price, stock_on_hand, stock_version, is_active)
select v.id, v.sku, v.name, u.id, v.price, v.stock, 0, true
from (values
  ('a1000000-0000-4000-8000-000000000001'::uuid, 'TEST-TXN-RACE-001', 'TEST Race Produk', 10000::numeric, 1::numeric),
  ('a1000000-0000-4000-8000-000000000002'::uuid, 'TEST-TXN-IDEMPOTENCY-001', 'TEST Idempotency Produk', 15000::numeric, 5::numeric),
  ('a1000000-0000-4000-8000-000000000003'::uuid, 'TEST-TXN-PAY-001', 'TEST Payment Produk', 10000::numeric, 10::numeric)
) as v(id, sku, name, price, stock)
cross join public.units_of_measure u
where u.code = 'PCS'
on conflict (id) do nothing;

insert into public.stock_opnames (
  id, opname_no, status, scope_note, created_by, submitted_at, approved_by, approved_at
)
select
  'a2000000-0000-4000-8000-000000000001'::uuid,
  'OP-TEST-4A-001',
  'approved',
  'Fixture Phase 4A preview',
  p.id,
  now(),
  p.id,
  now()
from public.profiles p
where p.role = 'owner' and p.is_active
order by p.created_at
limit 1
on conflict (id) do nothing;

insert into public.stock_opname_items (
  stock_opname_id, product_id, system_qty_snapshot, stock_version_snapshot,
  physical_qty, reason_code, reason_note, count_status, counted_by, counted_at
)
select
  o.id,
  p.id,
  null,
  0,
  p.stock_on_hand,
  'opening_balance',
  'Fixture Phase 4A preview',
  'posted',
  o.created_by,
  now()
from public.stock_opnames o
join public.products p
  on p.id in (
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'a1000000-0000-4000-8000-000000000002'::uuid,
    'a1000000-0000-4000-8000-000000000003'::uuid
  )
where o.id = 'a2000000-0000-4000-8000-000000000001'::uuid
  and o.status = 'approved'
on conflict (stock_opname_id, product_id) do nothing;

update public.stock_opnames
   set status = 'posted',
       posted_by = created_by,
       posted_at = now()
 where id = 'a2000000-0000-4000-8000-000000000001'::uuid
   and status = 'approved';

insert into public.stock_movements (
  product_id, movement_type, quantity_delta, quantity_before, quantity_after,
  stock_opname_id, actor_id, idempotency_key
)
select
  p.id,
  'opening_balance',
  p.stock_on_hand,
  null,
  p.stock_on_hand,
  o.id,
  o.created_by,
  v.key
from (values
  ('a1000000-0000-4000-8000-000000000001'::uuid, 'a3000000-0000-4000-8000-000000000001'::uuid),
  ('a1000000-0000-4000-8000-000000000002'::uuid, 'a3000000-0000-4000-8000-000000000002'::uuid),
  ('a1000000-0000-4000-8000-000000000003'::uuid, 'a3000000-0000-4000-8000-000000000003'::uuid)
) as v(product_id, key)
join public.products p on p.id = v.product_id
join public.stock_opnames o on o.id = 'a2000000-0000-4000-8000-000000000001'::uuid
where p.stock_on_hand is not null
  and p.stock_on_hand > 0
  and not exists (
    select 1 from public.stock_movements m
     where m.stock_opname_id = o.id and m.product_id = p.id
  )
on conflict (idempotency_key) do nothing;

commit;
