-- 0016 — Realtime stock broadcast (POS-03, NFR-04, DB-16, ADR-009)
--
-- Setiap perubahan stok pada public.products memancarkan pesan Broadcast ke
-- topic `store:stock`. Payload sengaja minimal: hanya identitas produk dan
-- saldo. Tidak ada harga beli, pelanggan, atau pembayaran.
--
-- Realtime hanya sinkronisasi tampilan. Checkout tetap memvalidasi stok di
-- database, jadi pesan yang hilang atau terlambat tidak pernah menjadi
-- otorisasi.

create or replace function private.broadcast_product_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Local/CI Postgres (PGlite) has no Realtime schema. Hosted Supabase always
  -- has it; skipping there would only hide a real misconfiguration, so the
  -- guard is limited to the absence of the function itself.
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is null then
    return null;
  end if;

  -- Hanya perubahan saldo yang menarik bagi kasir. Update nama/harga tidak
  -- boleh membanjiri channel.
  if new.stock_on_hand is not distinct from old.stock_on_hand
     and new.stock_version is not distinct from old.stock_version then
    return null;
  end if;

  -- Produk tanpa opname (stock_on_hand NULL) tidak punya saldo untuk
  -- disiarkan; klien tetap menampilkan "belum diopname".
  if new.stock_on_hand is null then
    return null;
  end if;

  perform realtime.send(
    jsonb_build_object(
      'product_id', new.id,
      'sku', new.sku,
      'stock_on_hand', new.stock_on_hand,
      'stock_version', new.stock_version
    ),
    'stock_changed',
    'store:stock',
    true
  );

  return null;
end;
$$;

revoke all on function private.broadcast_product_stock() from public;

drop trigger if exists products_broadcast_stock on public.products;

create trigger products_broadcast_stock
after update of stock_on_hand, stock_version on public.products
for each row execute function private.broadcast_product_stock();

-- Realtime Authorization: hanya sesi terautentikasi yang boleh membaca topic
-- ini. Pesan dikirim sebagai private broadcast, jadi anon tidak dapat
-- berlangganan walau mengetahui nama topic.
do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages tidak ada; policy Realtime dilewati.';
    return;
  end if;

  execute 'drop policy if exists "stock topic readable by authenticated" on realtime.messages';
  execute $policy$
    create policy "stock topic readable by authenticated"
    on realtime.messages
    for select
    to authenticated
    using (
      realtime.messages.extension = 'broadcast'
      and (select realtime.topic()) = 'store:stock'
    )
  $policy$;
end;
$$;
