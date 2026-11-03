-- 0014 — Phase 4A transaction engine
-- Authoritative checkout and void. Prices, discounts, totals, stock, receipt
-- numbers and cashier identity are resolved inside PostgreSQL. The browser
-- payload only supplies product ids, quantities, payments and an idempotency key.

alter table public.transactions
  add column request_fingerprint text;

alter table public.transactions
  add constraint transactions_request_fingerprint_format
  check (request_fingerprint is null or request_fingerprint ~ '^[0-9a-f]{32}$');

comment on column public.transactions.request_fingerprint is
  'md5 of the normalized checkout request; rejects idempotency key reuse with a different cart.';

create or replace function private.sale_response(p_tx public.transactions, p_already boolean)
returns jsonb
language sql
set search_path = ''
as $$
  select jsonb_build_object(
    'transaction_id', p_tx.id,
    'receipt_no', p_tx.receipt_no,
    'business_date', p_tx.business_date,
    'subtotal', p_tx.subtotal,
    'discount_amount', p_tx.discount_amount,
    'grand_total', p_tx.grand_total,
    'status', p_tx.status,
    'already_processed', p_already
  );
$$;

revoke all on function private.sale_response(public.transactions, boolean) from public;

-- Checkout. All rows are locked in product_id order before any write, so two
-- cashiers can never sell the same remaining unit. Any error rolls back header,
-- items, payments, movements, stock and audit together.
create or replace function private.complete_sale(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_key uuid;
  v_business_date date;
  v_customer_id uuid;
  v_discount numeric(14,2) := 0;
  v_items jsonb;
  v_payments jsonb;
  v_item jsonb;
  v_pay jsonb;
  v_rec record;
  v_idx integer;
  v_count integer;
  v_id uuid;
  v_qty numeric(14,3);
  v_ids uuid[] := '{}';
  v_qtys numeric[] := '{}';
  v_methods text[] := '{}';
  v_amounts numeric[] := '{}';
  v_receiveds numeric[] := '{}';
  v_changes numeric[] := '{}';
  v_sku text;
  v_name text;
  v_unit text;
  v_scale smallint;
  v_price numeric(14,2);
  v_stock numeric(14,3);
  v_version bigint;
  v_active boolean;
  v_after numeric(14,3);
  v_line numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_pay_total numeric(14,2) := 0;
  v_method text;
  v_amount numeric(14,2);
  v_received numeric(14,2);
  v_change numeric(14,2);
  v_receipt text;
  v_tx_id uuid;
  v_fingerprint text;
  v_items_fp jsonb;
  v_payments_fp jsonb;
  v_existing public.transactions%rowtype;
begin
  v_actor := private.require_active_role(array['owner', 'cashier']);

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'INVALID_PAYLOAD: Payload checkout harus berupa objek JSON.';
  end if;

  if nullif(btrim(coalesce(p_payload ->> 'idempotency_key', '')), '') is null then
    raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REQUIRED: idempotency_key wajib diisi.';
  end if;
  begin
    v_key := (p_payload ->> 'idempotency_key')::uuid;
  exception
    when invalid_text_representation then
      raise exception using errcode = '22023', message = 'INVALID_IDEMPOTENCY_KEY: idempotency_key harus UUID.';
  end;

  if nullif(btrim(coalesce(p_payload ->> 'business_date', '')), '') is null then
    raise exception using errcode = '22023', message = 'BUSINESS_DATE_REQUIRED: business_date wajib diisi.';
  end if;
  begin
    v_business_date := (p_payload ->> 'business_date')::date;
  exception
    when others then
      raise exception using errcode = '22023', message = 'INVALID_BUSINESS_DATE: business_date harus tanggal YYYY-MM-DD.';
  end;
  -- Timezone-safe guard: a WIB business date may be one day ahead of UTC.
  if v_business_date > current_date + 1 then
    raise exception using errcode = '22023', message = 'BUSINESS_DATE_FUTURE: Tanggal bisnis tidak boleh di masa depan.';
  end if;

  if nullif(btrim(coalesce(p_payload ->> 'customer_id', '')), '') is null then
    v_customer_id := null;
  else
    begin
      v_customer_id := (p_payload ->> 'customer_id')::uuid;
    exception
      when invalid_text_representation then
        raise exception using errcode = '22023', message = 'INVALID_CUSTOMER_ID: customer_id harus UUID.';
    end;
    if not exists (select 1 from public.customers c where c.id = v_customer_id) then
      raise exception using errcode = 'P0002', message = 'CUSTOMER_NOT_FOUND: Pelanggan tidak ditemukan.';
    end if;
  end if;

  if nullif(btrim(coalesce(p_payload ->> 'discount_amount', '')), '') is not null then
    if (p_payload ->> 'discount_amount') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
      raise exception using errcode = '22023', message = 'INVALID_DISCOUNT: Diskon harus angka tidak negatif dengan maksimal 2 desimal.';
    end if;
    v_discount := (p_payload ->> 'discount_amount')::numeric(14,2);
  end if;
  if v_discount < 0 then
    raise exception using errcode = '22023', message = 'INVALID_DISCOUNT: Diskon tidak boleh negatif.';
  end if;
  -- No approved discount policy exists (no app_settings table, no per-role
  -- limit). Nonzero discounts stay rejected until the owner defines one.
  if v_discount > 0 then
    raise exception using errcode = '22023', message = 'DISCOUNT_NOT_CONFIGURED: Diskon belum diaktifkan; tidak ada batas diskon yang disetujui owner.';
  end if;

  v_items := p_payload -> 'items';
  if v_items is null or jsonb_typeof(v_items) <> 'array' then
    raise exception using errcode = '22023', message = 'ITEMS_REQUIRED: items harus berupa array.';
  end if;
  v_count := jsonb_array_length(v_items);
  if v_count = 0 then
    raise exception using errcode = '22023', message = 'ITEMS_EMPTY: Keranjang tidak boleh kosong.';
  end if;
  if v_count > 200 then
    raise exception using errcode = '22023', message = 'ITEMS_TOO_MANY: Maksimal 200 baris per transaksi.';
  end if;

  for v_idx in 0 .. v_count - 1 loop
    v_item := v_items -> v_idx;
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = '22023', message = 'INVALID_ITEM: Setiap item harus berupa objek.';
    end if;

    if nullif(btrim(coalesce(v_item ->> 'product_id', '')), '') is null then
      raise exception using errcode = '22023', message = 'PRODUCT_REQUIRED: product_id wajib diisi pada setiap item.';
    end if;
    begin
      v_id := (v_item ->> 'product_id')::uuid;
    exception
      when invalid_text_representation then
        raise exception using errcode = '22023', message = 'INVALID_PRODUCT_ID: product_id harus UUID.';
    end;

    if nullif(btrim(coalesce(v_item ->> 'quantity', '')), '') is null then
      raise exception using errcode = '22023', message = 'QUANTITY_REQUIRED: quantity wajib diisi pada setiap item.';
    end if;
    if (v_item ->> 'quantity') !~ '^[0-9]+(\.[0-9]{1,3})?$' then
      raise exception using errcode = '22023', message = 'INVALID_QUANTITY: quantity harus angka positif dengan maksimal 3 desimal.';
    end if;
    v_qty := (v_item ->> 'quantity')::numeric(14,3);
    if v_qty <= 0 then
      raise exception using errcode = '22023', message = 'INVALID_QUANTITY: quantity harus lebih besar dari nol.';
    end if;

    if v_id = any (v_ids) then
      raise exception using errcode = '22023', message = 'DUPLICATE_PRODUCT: Produk yang sama tidak boleh muncul dua kali; gabungkan quantity-nya.';
    end if;
    v_ids := array_append(v_ids, v_id);
    v_qtys := array_append(v_qtys, v_qty);
  end loop;

  v_payments := p_payload -> 'payments';
  if v_payments is null or jsonb_typeof(v_payments) <> 'array' then
    raise exception using errcode = '22023', message = 'PAYMENTS_REQUIRED: payments harus berupa array.';
  end if;
  v_count := jsonb_array_length(v_payments);
  if v_count = 0 then
    raise exception using errcode = '22023', message = 'PAYMENTS_EMPTY: Pembayaran tidak boleh kosong.';
  end if;
  if v_count > 10 then
    raise exception using errcode = '22023', message = 'PAYMENTS_TOO_MANY: Maksimal 10 baris pembayaran.';
  end if;

  for v_idx in 0 .. v_count - 1 loop
    v_pay := v_payments -> v_idx;
    if jsonb_typeof(v_pay) <> 'object' then
      raise exception using errcode = '22023', message = 'INVALID_PAYMENT: Setiap pembayaran harus berupa objek.';
    end if;

    v_method := lower(btrim(coalesce(v_pay ->> 'method', '')));
    if v_method not in ('cash', 'qris', 'other') then
      raise exception using errcode = '22023', message = 'INVALID_PAYMENT_METHOD: Metode pembayaran harus cash, qris, atau other.';
    end if;

    if nullif(btrim(coalesce(v_pay ->> 'amount_applied', '')), '') is null
       or (v_pay ->> 'amount_applied') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
      raise exception using errcode = '22023', message = 'INVALID_PAYMENT_AMOUNT: amount_applied harus angka tidak negatif dengan maksimal 2 desimal.';
    end if;
    v_amount := (v_pay ->> 'amount_applied')::numeric(14,2);
    if v_amount <= 0 then
      raise exception using errcode = '22023', message = 'INVALID_PAYMENT_AMOUNT: amount_applied harus lebih besar dari nol.';
    end if;

    if v_method = 'cash' then
      if nullif(btrim(coalesce(v_pay ->> 'cash_received', '')), '') is null
         or (v_pay ->> 'cash_received') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
        raise exception using errcode = '22023', message = 'CASH_RECEIVED_REQUIRED: Pembayaran tunai wajib menyertakan cash_received.';
      end if;
      if nullif(btrim(coalesce(v_pay ->> 'cash_change', '')), '') is null
         or (v_pay ->> 'cash_change') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
        raise exception using errcode = '22023', message = 'CASH_CHANGE_REQUIRED: Pembayaran tunai wajib menyertakan cash_change.';
      end if;
      v_received := (v_pay ->> 'cash_received')::numeric(14,2);
      v_change := (v_pay ->> 'cash_change')::numeric(14,2);
      if v_received < v_amount then
        raise exception using errcode = '22023', message = 'CASH_RECEIVED_TOO_LOW: Uang diterima lebih kecil dari jumlah yang dibayarkan.';
      end if;
      if v_change <> v_received - v_amount then
        raise exception using errcode = '22023', message = 'CASH_CHANGE_MISMATCH: cash_change harus sama dengan cash_received - amount_applied.';
      end if;
    else
      if nullif(btrim(coalesce(v_pay ->> 'cash_received', '')), '') is not null then
        raise exception using errcode = '22023', message = 'UNEXPECTED_CASH_RECEIVED: Pembayaran non-tunai tidak boleh menyertakan cash_received.';
      end if;
      v_received := null;
      v_change := 0;
    end if;

    v_pay_total := v_pay_total + v_amount;
    v_methods := array_append(v_methods, v_method);
    v_amounts := array_append(v_amounts, v_amount);
    v_receiveds := array_append(v_receiveds, v_received);
    v_changes := array_append(v_changes, v_change);
  end loop;

  select jsonb_agg(
           jsonb_build_object('product_id', t.id, 'quantity', trim_scale(t.qty))
           order by t.id
         )
    into v_items_fp
    from unnest(v_ids, v_qtys) as t(id, qty);

  select jsonb_agg(
           jsonb_build_object(
             'method', t.method,
             'amount_applied', trim_scale(t.amount),
             'cash_received', case when t.received is null then null else trim_scale(t.received) end,
             'cash_change', trim_scale(t.change)
           )
           order by t.method, t.amount, t.received nulls first, t.change
         )
    into v_payments_fp
    from unnest(v_methods, v_amounts, v_receiveds, v_changes) as t(method, amount, received, change);

  v_fingerprint := md5(
    jsonb_build_object(
      'business_date', v_business_date,
      'customer_id', v_customer_id,
      'discount_amount', trim_scale(v_discount),
      'items', coalesce(v_items_fp, '[]'::jsonb),
      'payments', coalesce(v_payments_fp, '[]'::jsonb)
    )::text
  );

  select * into v_existing
    from public.transactions t
   where t.idempotency_key = v_key;

  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED: Kunci ini sudah dipakai untuk keranjang yang berbeda.';
    end if;
    return private.sale_response(v_existing, true);
  end if;

  -- Lock every product in a deterministic order before any write.
  for v_rec in
    select x.id, x.qty
      from unnest(v_ids, v_qtys) as x(id, qty)
     order by x.id
  loop
    v_id := v_rec.id;
    v_qty := v_rec.qty;

    select p.sku, p.name, p.sale_price, p.stock_on_hand, p.stock_version, p.is_active, u.label, u.decimal_scale
      into v_sku, v_name, v_price, v_stock, v_version, v_active, v_unit, v_scale
      from public.products p
      join public.units_of_measure u on u.id = p.unit_id
     where p.id = v_id
       for update of p;

    if not found then
      raise exception using errcode = 'P0002', message = format('PRODUCT_NOT_FOUND: Produk %s tidak ditemukan.', v_id);
    end if;
    if not v_active then
      raise exception using errcode = '22023', message = format('PRODUCT_INACTIVE: Produk %s sedang nonaktif.', v_sku);
    end if;
    if v_price is null then
      raise exception using errcode = '22023', message = format('SALE_PRICE_MISSING: Produk %s belum punya harga jual.', v_sku);
    end if;
    if v_stock is null then
      raise exception using errcode = '22023', message = format('STOCK_UNKNOWN: Stok produk %s belum diketahui; selesaikan opname dulu.', v_sku);
    end if;
    if v_scale = 0 and v_qty <> trunc(v_qty) then
      raise exception using errcode = '22023', message = format('INVALID_QUANTITY_UNIT: Satuan produk %s tidak menerima pecahan.', v_sku);
    end if;
    if v_qty > v_stock then
      raise exception using errcode = '22023', message = format('INSUFFICIENT_STOCK: Stok %s hanya %s, diminta %s.', v_sku, v_stock, v_qty);
    end if;

    v_line := round(v_price * v_qty, 2);
    v_subtotal := v_subtotal + v_line;
  end loop;

  -- Re-check after waiting on the locks: a concurrent retry with the same key
  -- may have committed while this session was blocked.
  select * into v_existing
    from public.transactions t
   where t.idempotency_key = v_key;
  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED: Kunci ini sudah dipakai untuk keranjang yang berbeda.';
    end if;
    return private.sale_response(v_existing, true);
  end if;

  if v_pay_total <> v_subtotal then
    raise exception using errcode = '23514', message = format(
      'PAYMENT_TOTAL_MISMATCH: Pembayaran Rp%s tidak sama dengan total nota Rp%s.', v_pay_total, v_subtotal
    );
  end if;

  v_receipt := private.next_document_number('receipt', v_business_date);

  begin
    insert into public.transactions (
      receipt_no, idempotency_key, business_date, cashier_id, customer_id,
      status, subtotal, discount_amount, grand_total, reconciliation_status,
      request_fingerprint
    )
    values (
      v_receipt, v_key, v_business_date, v_actor, v_customer_id,
      'completed', v_subtotal, 0, v_subtotal, 'matched',
      v_fingerprint
    )
    returning id into v_tx_id;
  exception
    when unique_violation then
      select * into v_existing
        from public.transactions t
       where t.idempotency_key = v_key;
      if found and v_existing.request_fingerprint = v_fingerprint then
        return private.sale_response(v_existing, true);
      end if;
      raise exception using errcode = '23505', message = 'CHECKOUT_CONFLICT: Nomor nota atau kunci idempotensi bentrok; ulangi permintaan.';
  end;

  for v_rec in
    select x.id, x.qty
      from unnest(v_ids, v_qtys) as x(id, qty)
     order by x.id
  loop
    v_id := v_rec.id;
    v_qty := v_rec.qty;

    select p.sku, p.name, p.sale_price, p.stock_on_hand, u.label
      into v_sku, v_name, v_price, v_stock, v_unit
      from public.products p
      join public.units_of_measure u on u.id = p.unit_id
     where p.id = v_id;

    v_line := round(v_price * v_qty, 2);
    v_after := v_stock - v_qty;

    insert into public.transaction_items (
      transaction_id, product_id, sku_snapshot, product_name_snapshot, unit_label_snapshot,
      quantity, unit_price, line_discount_amount, line_subtotal, line_total
    )
    values (
      v_tx_id, v_id, v_sku, v_name, v_unit,
      v_qty, v_price, 0, v_line, v_line
    );

    insert into public.stock_movements (
      product_id, movement_type, quantity_delta, quantity_before, quantity_after,
      transaction_id, actor_id, idempotency_key
    )
    values (
      v_id, 'sale_out', -v_qty, v_stock, v_after,
      v_tx_id, v_actor, md5(v_tx_id::text || ':sale_out:' || v_id::text)::uuid
    );

    update public.products p
       set stock_on_hand = v_after,
           stock_version = v_version + 1,
           updated_by = v_actor
     where p.id = v_id;
  end loop;

  for v_idx in 1 .. array_length(v_methods, 1) loop
    insert into public.payments (
      transaction_id, method, amount_applied, cash_received, cash_change, payment_status
    )
    values (
      v_tx_id, v_methods[v_idx], v_amounts[v_idx], v_receiveds[v_idx], v_changes[v_idx], 'confirmed'
    );
  end loop;

  perform private.write_audit(
    v_actor,
    'sale.complete',
    'transactions',
    v_tx_id::text,
    null,
    jsonb_build_object(
      'receipt_no', v_receipt,
      'business_date', v_business_date,
      'cashier_id', v_actor,
      'subtotal', v_subtotal,
      'discount_amount', 0,
      'grand_total', v_subtotal,
      'item_count', array_length(v_ids, 1),
      'payment_count', array_length(v_methods, 1),
      'idempotency_key', v_key
    ),
    null
  );

  select * into v_existing from public.transactions t where t.id = v_tx_id;
  return private.sale_response(v_existing, false);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'INVALID_PAYLOAD: Tipe data payload checkout tidak valid.';
end;
$$;

revoke all on function private.complete_sale(jsonb) from public;

-- Void. Owner-only, reason mandatory, stock restored exactly once. Payments
-- stay untouched: refund handling is outside this phase, so the transaction is
-- marked voided without claiming money was returned.
create or replace function private.void_sale(p_transaction_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_tx public.transactions%rowtype;
  v_reason text;
  v_rec record;
  v_stock numeric(14,3);
  v_version bigint;
  v_after numeric(14,3);
  v_items integer := 0;
begin
  v_actor := private.require_active_role(array['owner']);

  if p_transaction_id is null then
    raise exception using errcode = '22023', message = 'TRANSACTION_REQUIRED: p_transaction_id wajib diisi.';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception using errcode = '22023', message = 'VOID_REASON_REQUIRED: Alasan void wajib diisi.';
  end if;
  if char_length(v_reason) > 500 then
    raise exception using errcode = '22023', message = 'VOID_REASON_TOO_LONG: Alasan void maksimal 500 karakter.';
  end if;

  select * into v_tx
    from public.transactions t
   where t.id = p_transaction_id
     for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'TRANSACTION_NOT_FOUND: Nota tidak ditemukan.';
  end if;

  if v_tx.status = 'voided' then
    return jsonb_build_object(
      'transaction_id', v_tx.id,
      'receipt_no', v_tx.receipt_no,
      'status', v_tx.status,
      'grand_total', v_tx.grand_total,
      'voided_at', v_tx.voided_at,
      'restored_items', 0,
      'already_processed', true
    );
  end if;

  if exists (
    select 1
      from public.transaction_items ti
     where ti.transaction_id = p_transaction_id
       and ti.product_id is null
  ) then
    raise exception using errcode = '22023', message = 'VOID_ITEM_WITHOUT_PRODUCT: Nota berisi item tanpa produk; void tidak dapat memulihkan stok.';
  end if;

  for v_rec in
    select ti.product_id, sum(ti.quantity) as quantity
      from public.transaction_items ti
     where ti.transaction_id = p_transaction_id
     group by ti.product_id
     order by ti.product_id
  loop
    select p.stock_on_hand, p.stock_version
      into v_stock, v_version
      from public.products p
     where p.id = v_rec.product_id
       for update;

    if not found then
      raise exception using errcode = 'P0002', message = format('PRODUCT_NOT_FOUND: Produk %s tidak ditemukan.', v_rec.product_id);
    end if;
    if v_stock is null then
      raise exception using errcode = '22023', message = 'STOCK_UNKNOWN: Stok produk tidak diketahui; void tidak dapat memulihkan saldo.';
    end if;

    v_after := v_stock + v_rec.quantity;

    insert into public.stock_movements (
      product_id, movement_type, quantity_delta, quantity_before, quantity_after,
      transaction_id, actor_id, idempotency_key
    )
    values (
      v_rec.product_id, 'void_reversal', v_rec.quantity, v_stock, v_after,
      p_transaction_id, v_actor, md5(p_transaction_id::text || ':void_reversal:' || v_rec.product_id::text)::uuid
    );

    update public.products p
       set stock_on_hand = v_after,
           stock_version = v_version + 1,
           updated_by = v_actor
     where p.id = v_rec.product_id;

    v_items := v_items + 1;
  end loop;

  update public.transactions t
     set status = 'voided',
         voided_at = now(),
         voided_by = v_actor,
         void_reason = v_reason
   where t.id = p_transaction_id
   returning * into v_tx;

  perform private.write_audit(
    v_actor,
    'sale.void',
    'transactions',
    p_transaction_id::text,
    jsonb_build_object('status', 'completed', 'grand_total', v_tx.grand_total),
    jsonb_build_object('status', 'voided', 'reason', v_reason, 'restored_items', v_items),
    v_reason
  );

  return jsonb_build_object(
    'transaction_id', v_tx.id,
    'receipt_no', v_tx.receipt_no,
    'status', v_tx.status,
    'grand_total', v_tx.grand_total,
    'voided_at', v_tx.voided_at,
    'restored_items', v_items,
    'already_processed', false
  );
end;
$$;

revoke all on function private.void_sale(uuid, text) from public;

create or replace function public.complete_sale(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.complete_sale(p_payload);
$$;

revoke all on function public.complete_sale(jsonb) from public, anon, authenticated;
grant execute on function public.complete_sale(jsonb) to authenticated;

create or replace function public.void_sale(p_transaction_id uuid, p_reason text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.void_sale(p_transaction_id, p_reason);
$$;

revoke all on function public.void_sale(uuid, text) from public, anon, authenticated;
grant execute on function public.void_sale(uuid, text) to authenticated;
