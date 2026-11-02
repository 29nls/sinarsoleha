-- 0006 — inventory: opname, immutable ledger, discrepancy history

create table public.stock_opnames (
  id uuid primary key default gen_random_uuid(),
  opname_no text not null,
  status text not null default 'draft',
  scope_note text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  submitted_at timestamptz,
  approved_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz,
  posted_by uuid references public.profiles(id) on delete restrict,
  posted_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete restrict,
  cancelled_at timestamptz,
  cancelled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stock_opnames_no_key unique (opname_no),
  constraint stock_opnames_status_valid check (
    status in ('draft', 'counting', 'submitted', 'approved', 'posted', 'cancelled')
  ),
  constraint stock_opnames_submitted_consistency check (
    status in ('draft', 'counting') or submitted_at is not null
  ),
  constraint stock_opnames_approved_consistency check (
    status not in ('approved', 'posted')
    or (approved_by is not null and approved_at is not null)
  ),
  constraint stock_opnames_posted_consistency check (
    status <> 'posted' or (posted_by is not null and posted_at is not null)
  ),
  constraint stock_opnames_cancelled_consistency check (
    status <> 'cancelled'
    or (
      cancelled_by is not null
      and cancelled_at is not null
      and nullif(btrim(cancelled_reason), '') is not null
    )
  )
);

create trigger stock_opnames_set_updated_at
before update on public.stock_opnames
for each row execute function private.set_updated_at();

create or replace function private.guard_opname_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if old.status in ('posted', 'cancelled') then
    raise exception using errcode = '42501', message = 'OPNAME_IMMUTABLE: Sesi opname yang sudah posted/cancelled tidak dapat diubah.';
  end if;

  if not (
    (old.status = 'draft' and new.status in ('counting', 'cancelled'))
    or (old.status = 'counting' and new.status in ('submitted', 'cancelled'))
    or (old.status = 'submitted' and new.status in ('approved', 'counting', 'cancelled'))
    or (old.status = 'approved' and new.status in ('posted', 'counting', 'cancelled'))
  ) then
    raise exception using errcode = '23514', message = format('INVALID_OPNAME_TRANSITION: Transisi status opname %s -> %s tidak diizinkan.', old.status, new.status);
  end if;

  return new;
end;
$$;

create trigger stock_opnames_guard_transition
before update on public.stock_opnames
for each row execute function private.guard_opname_status_transition();

create or replace function private.guard_opname_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('posted', 'cancelled') then
    raise exception using errcode = '42501', message = 'OPNAME_IMMUTABLE: Sesi opname yang sudah posted/cancelled tidak dapat diubah atau dihapus.';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger stock_opnames_immutable
before update or delete on public.stock_opnames
for each row execute function private.guard_opname_immutable();

create table public.stock_opname_items (
  id uuid primary key default gen_random_uuid(),
  stock_opname_id uuid not null references public.stock_opnames(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  system_qty_snapshot numeric(14,3),
  stock_version_snapshot bigint not null,
  physical_qty numeric(14,3),
  difference_qty numeric(14,3) generated always as (physical_qty - system_qty_snapshot) stored,
  reason_code text,
  reason_note text,
  count_status text not null default 'pending',
  counted_by uuid references public.profiles(id) on delete set null,
  counted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stock_opname_items_unique unique (stock_opname_id, product_id),
  constraint stock_opname_items_version_nonnegative check (stock_version_snapshot >= 0),
  constraint stock_opname_items_status_valid check (
    count_status in ('pending', 'counted', 'needs_recount', 'posted')
  ),
  constraint stock_opname_items_reason_valid check (
    reason_code is null
    or reason_code in (
      'broken_damaged', 'missing', 'input_error', 'unrecorded_out',
      'unrecorded_in', 'unit_conversion', 'opening_balance', 'other'
    )
  ),
  constraint stock_opname_items_physical_rule check (
    physical_qty is null
    or (
      system_qty_snapshot is null
      and reason_code = 'opening_balance'
      and nullif(btrim(reason_note), '') is not null
    )
    or (
      system_qty_snapshot is not null
      and (
        physical_qty = system_qty_snapshot
        or (
          reason_code is not null
          and (reason_code <> 'other' or nullif(btrim(reason_note), '') is not null)
        )
      )
    )
  ),
  constraint stock_opname_items_count_consistency check (
    (count_status = 'pending' and physical_qty is null)
    or (
      count_status in ('counted', 'needs_recount', 'posted')
      and physical_qty is not null
      and counted_by is not null
      and counted_at is not null
    )
  )
);

create trigger stock_opname_items_set_updated_at
before update on public.stock_opname_items
for each row execute function private.set_updated_at();

create or replace function private.guard_opname_item_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_op = 'DELETE' then
    select o.status into v_status
      from public.stock_opnames o
     where o.id = old.stock_opname_id;
  else
    select o.status into v_status
      from public.stock_opnames o
     where o.id = new.stock_opname_id;
  end if;

  if v_status in ('posted', 'cancelled') then
    raise exception using errcode = '42501', message = 'OPNAME_IMMUTABLE: Item opname pada sesi posted/cancelled tidak dapat diubah.';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger stock_opname_items_guard_write
before insert or update or delete on public.stock_opname_items
for each row execute function private.guard_opname_item_write();

create table public.stock_movements (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type text not null,
  quantity_delta numeric(14,3) not null,
  quantity_before numeric(14,3),
  quantity_after numeric(14,3) not null,
  transaction_id uuid references public.transactions(id) on delete restrict,
  stock_opname_id uuid references public.stock_opnames(id) on delete restrict,
  reason_code text,
  reason_note text,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key uuid,
  created_at timestamptz not null default now(),
  constraint stock_movements_idempotency_key_key unique (idempotency_key),
  constraint stock_movements_type_valid check (
    movement_type in (
      'opening_balance', 'sale_out', 'opname_adjustment', 'manual_adjustment',
      'return_in', 'purchase_in', 'void_reversal'
    )
  ),
  constraint stock_movements_delta_nonzero check (quantity_delta <> 0),
  constraint stock_movements_arithmetic check (
    quantity_before is null or quantity_before + quantity_delta = quantity_after
  ),
  constraint stock_movements_reason_valid check (
    reason_code is null
    or reason_code in (
      'broken_damaged', 'missing', 'input_error', 'unrecorded_out',
      'unrecorded_in', 'unit_conversion', 'opening_balance', 'other'
    )
  ),
  constraint stock_movements_reference_rule check (
    (movement_type in ('sale_out', 'void_reversal')
      and transaction_id is not null and stock_opname_id is null)
    or (movement_type in ('opname_adjustment', 'opening_balance')
      and transaction_id is null and stock_opname_id is not null)
    or (movement_type in ('manual_adjustment', 'return_in', 'purchase_in')
      and transaction_id is null and stock_opname_id is null)
  ),
  constraint stock_movements_manual_reason check (
    movement_type <> 'manual_adjustment'
    or (reason_code is not null and nullif(btrim(reason_note), '') is not null)
  ),
  constraint stock_movements_other_note check (
    reason_code is distinct from 'other' or nullif(btrim(reason_note), '') is not null
  )
);

create or replace function private.block_stock_ledger_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'STOCK_LEDGER_IMMUTABLE: Ledger stok tidak boleh diubah atau dihapus; buat movement koreksi baru.';
end;
$$;

create trigger stock_movements_immutable
before update or delete on public.stock_movements
for each row execute function private.block_stock_ledger_mutation();

create table public.stock_discrepancy_logs (
  id bigint generated always as identity primary key,
  stock_opname_item_id uuid not null references public.stock_opname_items(id) on delete restrict,
  revision integer not null default 1,
  product_id uuid not null references public.products(id) on delete restrict,
  system_qty numeric(14,3) not null,
  physical_qty numeric(14,3) not null,
  difference_qty numeric(14,3) not null,
  reason_code text not null,
  reason_note text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  approved_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint stock_discrepancy_logs_unique unique (stock_opname_item_id, revision),
  constraint stock_discrepancy_logs_revision_positive check (revision > 0),
  constraint stock_discrepancy_logs_difference_nonzero check (difference_qty <> 0),
  constraint stock_discrepancy_logs_arithmetic check (
    difference_qty = physical_qty - system_qty
  ),
  constraint stock_discrepancy_logs_reason_valid check (
    reason_code in (
      'broken_damaged', 'missing', 'input_error', 'unrecorded_out',
      'unrecorded_in', 'unit_conversion', 'opening_balance', 'other'
    )
  ),
  constraint stock_discrepancy_logs_other_note check (
    reason_code <> 'other' or nullif(btrim(reason_note), '') is not null
  )
);

create trigger stock_discrepancy_logs_immutable
before update or delete on public.stock_discrepancy_logs
for each row execute function private.block_stock_ledger_mutation();

create index stock_opnames_status_idx on public.stock_opnames (status, created_at desc);
create index stock_opname_items_product_idx on public.stock_opname_items (product_id);
create index stock_movements_product_created_idx on public.stock_movements (product_id, created_at desc);
create index stock_movements_transaction_idx on public.stock_movements (transaction_id);
create index stock_discrepancy_product_created_idx
  on public.stock_discrepancy_logs (product_id, created_at desc);
