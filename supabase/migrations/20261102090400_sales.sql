-- 0005 — sales, payments, deferred balance check, receipt counters

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  receipt_no text not null,
  legacy_transaction_id text,
  idempotency_key uuid,
  business_date date not null,
  cashier_id uuid not null references public.profiles(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'completed',
  subtotal numeric(14,2) not null,
  discount_amount numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null,
  reconciliation_status text not null default 'matched',
  created_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles(id) on delete restrict,
  void_reason text,
  note text,
  constraint transactions_receipt_no_key unique (receipt_no),
  constraint transactions_legacy_id_key unique (legacy_transaction_id),
  constraint transactions_idempotency_key_key unique (idempotency_key),
  constraint transactions_status_valid check (status in ('completed', 'voided')),
  constraint transactions_reconciliation_valid check (
    reconciliation_status in ('matched', 'legacy_mismatch', 'reviewed')
  ),
  constraint transactions_amounts_nonnegative check (
    subtotal >= 0 and discount_amount >= 0 and grand_total >= 0
  ),
  constraint transactions_discount_within_subtotal check (discount_amount <= subtotal),
  -- Legacy rows may preserve a historical mismatch; new rows must add up.
  constraint transactions_total_consistent check (
    legacy_transaction_id is not null
    or grand_total = subtotal - discount_amount
  ),
  constraint transactions_void_consistency check (
    status <> 'voided'
    or (voided_at is not null and voided_by is not null and nullif(btrim(void_reason), '') is not null)
  ),
  constraint transactions_receipt_format check (
    legacy_transaction_id is not null
    or receipt_no ~ '^SS-[0-9]{8}-[0-9]{4}$'
  )
);

create table public.transaction_items (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete restrict,
  product_id uuid references public.products(id) on delete restrict,
  sku_snapshot text not null,
  product_name_snapshot text not null,
  unit_label_snapshot text not null,
  quantity numeric(14,3) not null,
  unit_price numeric(14,2) not null,
  line_discount_amount numeric(14,2) not null default 0,
  line_subtotal numeric(14,2) not null,
  line_total numeric(14,2) not null,
  created_at timestamptz not null default now(),
  constraint transaction_items_quantity_positive check (quantity > 0),
  constraint transaction_items_price_nonnegative check (unit_price >= 0),
  constraint transaction_items_discount_nonnegative check (line_discount_amount >= 0),
  constraint transaction_items_amounts_nonnegative check (line_subtotal >= 0 and line_total >= 0),
  constraint transaction_items_discount_within_subtotal check (line_discount_amount <= line_subtotal),
  constraint transaction_items_line_total_consistent check (
    line_total = line_subtotal - line_discount_amount
  )
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete restrict,
  method text not null,
  amount_applied numeric(14,2) not null,
  cash_received numeric(14,2),
  cash_change numeric(14,2) not null default 0,
  provider_code text,
  provider_reference text,
  payment_status text not null default 'confirmed',
  created_at timestamptz not null default now(),
  constraint payments_method_valid check (method in ('cash', 'qris', 'other')),
  constraint payments_status_valid check (
    payment_status in ('pending', 'confirmed', 'failed', 'refunded')
  ),
  constraint payments_amount_nonnegative check (amount_applied >= 0),
  constraint payments_change_nonnegative check (cash_change >= 0),
  constraint payments_cash_consistency check (
    method <> 'cash'
    or (
      cash_received is not null
      and cash_received >= 0
      and cash_received - cash_change = amount_applied
    )
  ),
  constraint payments_non_cash_no_change check (method = 'cash' or cash_change = 0)
);

create table public.document_counters (
  scope text not null,
  business_date date not null,
  last_value integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint document_counters_pkey primary key (scope, business_date),
  constraint document_counters_scope_valid check (scope in ('receipt', 'opname')),
  constraint document_counters_value_nonnegative check (last_value >= 0)
);

-- Daily counter with a row lock. Two cashiers never receive the same number.
create or replace function private.next_document_number(p_scope text, p_business_date date)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value integer;
  v_prefix text;
begin
  if p_scope is null or p_scope not in ('receipt', 'opname') then
    raise exception 'INVALID_DOCUMENT_SCOPE' using errcode = '22023';
  end if;
  if p_business_date is null then
    raise exception 'INVALID_BUSINESS_DATE' using errcode = '22023';
  end if;

  insert into public.document_counters (scope, business_date, last_value)
  values (p_scope, p_business_date, 1)
  on conflict (scope, business_date) do update
    set last_value = public.document_counters.last_value + 1,
        updated_at = now()
  returning last_value into v_value;

  if v_value > 9999 then
    raise exception using errcode = '22003', message = 'DOCUMENT_COUNTER_EXHAUSTED: Nomor dokumen harian sudah mencapai batas 9999.';
  end if;

  v_prefix := case p_scope when 'receipt' then 'SS' else 'OP' end;
  return format('%s-%s-%s', v_prefix, to_char(p_business_date, 'YYYYMMDD'), lpad(v_value::text, 4, '0'));
end;
$$;

revoke all on function private.next_document_number(text, date) from public;

-- Deferred check: payments may be inserted after the header, but at COMMIT
-- the confirmed payments must equal grand_total exactly.
create or replace function private.assert_transaction_balanced(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total numeric(14,2);
  v_status text;
  v_paid numeric(14,2);
begin
  if p_transaction_id is null then
    return;
  end if;

  select t.grand_total, t.status
    into v_total, v_status
    from public.transactions t
   where t.id = p_transaction_id;

  if not found then
    return;
  end if;
  if v_status = 'voided' then
    return;
  end if;

  select coalesce(sum(p.amount_applied), 0)
    into v_paid
    from public.payments p
   where p.transaction_id = p_transaction_id
     and p.payment_status = 'confirmed';

  if v_paid <> v_total then
    raise exception using errcode = '23514', message = format('PAYMENT_TOTAL_MISMATCH: Pembayaran Rp%s tidak sama dengan total nota Rp%s.', v_paid, v_total);
  end if;
end;
$$;

create or replace function private.check_payment_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.assert_transaction_balanced(old.transaction_id);
    return null;
  end if;

  perform private.assert_transaction_balanced(new.transaction_id);
  if tg_op = 'UPDATE' and old.transaction_id is distinct from new.transaction_id then
    perform private.assert_transaction_balanced(old.transaction_id);
  end if;
  return null;
end;
$$;

create constraint trigger payments_balance_after_change
after insert or update or delete on public.payments
deferrable initially deferred
for each row execute function private.check_payment_balance();

create or replace function private.check_transaction_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_transaction_balanced(new.id);
  return null;
end;
$$;

create constraint trigger transactions_balance_after_change
after insert or update of grand_total, status on public.transactions
deferrable initially deferred
for each row execute function private.check_transaction_balance();

create index transactions_business_date_idx on public.transactions (business_date desc);
create index transactions_cashier_date_idx on public.transactions (cashier_id, business_date desc);
create index transaction_items_transaction_idx on public.transaction_items (transaction_id);
create index transaction_items_product_idx on public.transaction_items (product_id);
create index payments_transaction_idx on public.payments (transaction_id);
