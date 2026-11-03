#!/usr/bin/env node
/**
 * Hosted Phase 4A transaction smoke test.
 *
 * Target: the disposable preview project only. Aborts on any other host.
 * Requires:
 *   - migration 20261103110000 applied to preview;
 *   - supabase/tests/phase4a_preview_fixtures.sql already run;
 *   - owner, cashier and a second independent cashier account.
 *
 * The second cashier is read from TEST_CASHIER_B_EMAIL / TEST_CASHIER_B_PASSWORD,
 * or from .tmp/phase2b-accounts.json as role "cashier_b".
 * Credentials and JWTs are never printed.
 *
 * Run: npm run test:hosted:transactions
 */
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const PREVIEW_REF = 'ptbllrugrjepdhhdkzxn'
const FIXTURES = {
  race: { sku: 'TEST-TXN-RACE-001', price: 10000, stock: 1 },
  idem: { sku: 'TEST-TXN-IDEMPOTENCY-001', price: 15000, stock: 5 },
  pay: { sku: 'TEST-TXN-PAY-001', price: 10000, stock: 10 },
}

const env = {}
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
}

const url = (env.SUPABASE_URL || env.NUXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY
if (!url || !key) throw new Error('SUPABASE_URL / publishable key tidak ada di .env')

const ref = new URL(url).hostname.split('.')[0]
if (ref !== PREVIEW_REF) {
  console.error(`BLOCKED: target ${ref} bukan preview ${PREVIEW_REF}. Tes hosted tidak dijalankan.`)
  process.exit(1)
}
console.log(`Target preview ${ref}`)

const accounts = JSON.parse(readFileSync('.tmp/phase2b-accounts.json', 'utf8'))
const byRole = Object.fromEntries(accounts.map((account) => [account.role, account]))
const cashierBAccount =
  env.TEST_CASHIER_B_EMAIL && env.TEST_CASHIER_B_PASSWORD
    ? { email: env.TEST_CASHIER_B_EMAIL, password: env.TEST_CASHIER_B_PASSWORD }
    : byRole.cashier_b

if (!cashierBAccount) {
  console.error('BLOCKED: akun kasir kedua belum ada.')
  console.error('Buat user kasir kedua di preview, aktifkan lewat owner, lalu simpan sebagai role "cashier_b"')
  console.error('di .tmp/phase2b-accounts.json atau set TEST_CASHIER_B_EMAIL / TEST_CASHIER_B_PASSWORD.')
  process.exit(1)
}

const makeClient = () =>
  createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })

async function login(account, label) {
  const client = makeClient()
  const { error } = await client.auth.signInWithPassword({ email: account.email, password: account.password })
  if (error) throw new Error(`${label}: login gagal: ${error.message}`)
  return client
}

const owner = await login(byRole.owner, 'owner')
const cashierA = await login(byRole.cashier, 'cashier_a')
const cashierB = await login(cashierBAccount, 'cashier_b')

const migration = await owner.from('transactions').select('request_fingerprint').limit(1)
if (migration.error) {
  console.error(`BLOCKED: migrasi 4A belum aktif (${migration.error.code} ${migration.error.message}).`)
  process.exit(1)
}

const fixtureRows = await owner
  .from('products')
  .select('id, sku, name, unit_id, sale_price, stock_on_hand, stock_version, is_active')
  .in('sku', Object.values(FIXTURES).map((item) => item.sku))
if (fixtureRows.error) throw new Error(fixtureRows.error.message)

const bySku = Object.fromEntries((fixtureRows.data ?? []).map((row) => [row.sku, row]))
for (const [name, expected] of Object.entries(FIXTURES)) {
  const row = bySku[expected.sku]
  if (!row) {
    console.error(`BLOCKED: fixture ${expected.sku} tidak ada. Jalankan supabase/tests/phase4a_preview_fixtures.sql.`)
    process.exit(1)
  }
  if (Number(row.stock_on_hand) !== expected.stock || Number(row.sale_price) !== expected.price) {
    console.error(
      `BLOCKED: fixture ${expected.sku} tidak pada state awal (stok ${row.stock_on_hand}, harga ${row.sale_price}).`,
    )
    console.error('Fixture sudah terpakai atau diubah; buat ulang fixture sebelum mengulang tes.')
    process.exit(1)
  }
  FIXTURES[name] = { ...expected, id: row.id, name: row.name, unit_id: row.unit_id }
}

let passed = 0
let failed = 0
const created = []

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function test(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS  ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL  ${name}`)
    console.error(`      ${error.message}`)
  }
}

const today = new Date().toISOString().slice(0, 10)
const payload = (product, quantity, total, extra = {}) => ({
  idempotency_key: randomUUID(),
  business_date: today,
  discount_amount: 0,
  items: [{ product_id: product.id, quantity }],
  payments: [{ method: 'cash', amount_applied: total, cash_received: total, cash_change: 0 }],
  ...extra,
})

async function stockOf(product) {
  const row = await owner.from('products').select('stock_on_hand, stock_version').eq('id', product.id).single()
  if (row.error) throw new Error(row.error.message)
  return { stock: Number(row.data.stock_on_hand), version: Number(row.data.stock_version) }
}

async function runRace(client, body) {
  const started = Date.now()
  const result = await client.rpc('complete_sale', { p_payload: body })
  return { result, started, ended: Date.now() }
}

function expectError(result, code, fragment) {
  assert(result.error, 'permintaan seharusnya ditolak tetapi berhasil')
  assert(result.error.code === code, `kode error ${result.error.code}, diharapkan ${code}: ${result.error.message}`)
  if (fragment) assert(result.error.message.includes(fragment), `pesan error tidak memuat ${fragment}`)
}

await test('cashier A and cashier B are independent sessions', async () => {
  const a = await cashierA.auth.getUser()
  const b = await cashierB.auth.getUser()
  assert(a.data.user && b.data.user, 'sesi kasir tidak valid')
  assert(a.data.user.id !== b.data.user.id, 'kedua sesi memakai user yang sama')
})

await test('concurrent stock=1 race produces exactly one sale', async () => {
  const before = await stockOf(FIXTURES.race)
  assert(before.stock === 1, `stok awal race ${before.stock}`)
  const bodyA = payload(FIXTURES.race, 1, 10000, { idempotency_key: randomUUID() })
  const bodyB = payload(FIXTURES.race, 1, 10000, { idempotency_key: randomUUID() })

  const [a, b] = await Promise.all([runRace(cashierA, bodyA), runRace(cashierB, bodyB)])
  const overlap = Math.max(a.started, b.started) <= Math.min(a.ended, b.ended)
  const results = [
    { body: bodyA, ...a },
    { body: bodyB, ...b },
  ]
  const wins = results.filter((item) => !item.result.error)
  const losses = results.filter((item) => item.result.error)
  console.log(
    `      race: overlap=${overlap} win=${wins.length} lose=${losses.length} ` +
      `latencyA=${a.ended - a.started}ms latencyB=${b.ended - b.started}ms`,
  )
  assert(overlap, 'request tidak benar-benar tumpang tindih; hasil tidak konklusif')
  assert(wins.length === 1, `diharapkan 1 penjualan sukses, didapat ${wins.length}`)
  assert(losses.length === 1, `diharapkan 1 penjualan gagal, didapat ${losses.length}`)
  expectError(losses[0].result, '22023', 'INSUFFICIENT_STOCK')

  const winner = wins[0]
  created.push({ id: winner.result.data.transaction_id, product: FIXTURES.race })

  const after = await stockOf(FIXTURES.race)
  assert(after.stock === 0, `stok akhir race ${after.stock}, diharapkan 0`)
  assert(after.version === 1, `stock_version race ${after.version}, diharapkan 1`)

  const tx = await owner.from('transactions').select('id, receipt_no, status, grand_total').in('idempotency_key', [
    bodyA.idempotency_key,
    bodyB.idempotency_key,
  ])
  assert(tx.data.length === 1, `transaksi race ${tx.data.length}, diharapkan 1`)
  assert(tx.data[0].status === 'completed', 'transaksi race tidak completed')

  const movement = await owner
    .from('stock_movements')
    .select('movement_type, quantity_delta, quantity_before, quantity_after')
    .eq('transaction_id', tx.data[0].id)
  assert(movement.data.length === 1, `movement race ${movement.data.length}, diharapkan 1`)
  assert(movement.data[0].movement_type === 'sale_out', 'movement race bukan sale_out')
  assert(Number(movement.data[0].quantity_delta) === -1, 'delta race bukan -1')
  assert(Number(movement.data[0].quantity_after) === 0, 'quantity_after race bukan 0')
})

await test('idempotent retry returns the same sale and decrements stock once', async () => {
  const body = payload(FIXTURES.idem, 1, 15000)
  const first = await cashierA.rpc('complete_sale', { p_payload: body })
  assert(!first.error, `sale gagal: ${first.error?.message}`)
  const second = await cashierA.rpc('complete_sale', { p_payload: body })
  assert(!second.error, `retry gagal: ${second.error?.message}`)
  assert(second.data.transaction_id === first.data.transaction_id, 'retry membuat transaksi berbeda')
  assert(second.data.receipt_no === first.data.receipt_no, 'retry membuat nota berbeda')
  assert(second.data.already_processed === true, 'retry tidak idempoten')

  created.push({ id: first.data.transaction_id, product: FIXTURES.idem })
  const stock = await stockOf(FIXTURES.idem)
  assert(stock.stock === 4, `stok idempotency ${stock.stock}, diharapkan 4`)
  const tx = await owner.from('transactions').select('id').eq('idempotency_key', body.idempotency_key)
  assert(tx.data.length === 1, 'retry membuat transaksi ganda')
  const payments = await owner.from('payments').select('id').eq('transaction_id', first.data.transaction_id)
  assert(payments.data.length === 1, 'retry membuat payment ganda')
  const movements = await owner.from('stock_movements').select('id').eq('transaction_id', first.data.transaction_id)
  assert(movements.data.length === 1, 'retry membuat movement ganda')
})

await test('the same key with a different cart is rejected', async () => {
  const body = payload(FIXTURES.idem, 1, 15000)
  const first = await cashierA.rpc('complete_sale', { p_payload: body })
  assert(!first.error, `sale gagal: ${first.error?.message}`)

  const changed = { ...body, items: [{ product_id: FIXTURES.idem.id, quantity: 2 }], payments: [{ method: 'cash', amount_applied: 30000, cash_received: 30000, cash_change: 0 }] }
  const reuse = await cashierA.rpc('complete_sale', { p_payload: changed })
  expectError(reuse, '22023', 'IDEMPOTENCY_KEY_REUSED')
  const stock = await stockOf(FIXTURES.idem)
  assert(stock.stock === 3, `stok setelah penolakan ${stock.stock}, diharapkan 3`)
})

await test('two concurrent requests with the same key create one sale', async () => {
  const body = payload(FIXTURES.idem, 1, 15000)
  const [a, b] = await Promise.all([runRace(cashierA, body), runRace(cashierB, body)])
  assert(!a.result.error, `sesi A gagal: ${a.result.error?.message}`)
  assert(!b.result.error, `sesi B gagal: ${b.result.error?.message}`)
  assert(a.result.data.transaction_id === b.result.data.transaction_id, 'dua transaksi untuk kunci yang sama')
  created.push({ id: a.result.data.transaction_id, product: FIXTURES.idem })

  const tx = await owner.from('transactions').select('id').eq('idempotency_key', body.idempotency_key)
  assert(tx.data.length === 1, 'transaksi ganda untuk kunci yang sama')
  const stock = await stockOf(FIXTURES.idem)
  assert(stock.stock === 2, `stok setelah duplikat paralel ${stock.stock}, diharapkan 2`)
})

await test('owner void restores stock once and keeps history', async () => {
  const target = created.find((item) => item.product === FIXTURES.idem)
  assert(target, 'transaksi idempotency tidak tercatat')

  const denied = await cashierA.rpc('void_sale', { p_transaction_id: target.id, p_reason: 'kasir tidak boleh' })
  expectError(denied, '42501')

  const empty = await owner.rpc('void_sale', { p_transaction_id: target.id, p_reason: '   ' })
  expectError(empty, '22023', 'VOID_REASON_REQUIRED')

  const before = await stockOf(FIXTURES.idem)
  const voided = await owner.rpc('void_sale', { p_transaction_id: target.id, p_reason: 'Uji void hosted' })
  assert(!voided.error, `void gagal: ${voided.error?.message}`)
  assert(voided.data.status === 'voided', 'status bukan voided')
  assert(voided.data.restored_items === 1, 'jumlah item dipulihkan bukan 1')

  const after = await stockOf(FIXTURES.idem)
  assert(after.stock === before.stock + 1, 'stok tidak dipulihkan tepat satu')
  const movement = await owner
    .from('stock_movements')
    .select('movement_type, quantity_delta')
    .eq('transaction_id', target.id)
    .eq('movement_type', 'void_reversal')
  assert(movement.data.length === 1, 'void_reversal tidak tepat satu')
  assert(Number(movement.data[0].quantity_delta) === 1, 'delta void_reversal bukan +1')

  const again = await owner.rpc('void_sale', { p_transaction_id: target.id, p_reason: 'Uji void hosted' })
  assert(!again.error, `void ulang gagal: ${again.error?.message}`)
  assert(again.data.already_processed === true, 'void ulang tidak idempoten')
  const stockAfter = await stockOf(FIXTURES.idem)
  assert(stockAfter.stock === after.stock, 'void ulang mengubah stok')

  const items = await owner.from('transaction_items').select('id').eq('transaction_id', target.id)
  const payments = await owner.from('payments').select('id').eq('transaction_id', target.id)
  assert(items.data.length === 1, 'item transaksi hilang setelah void')
  assert(payments.data.length === 1, 'payment hilang setelah void')
  const audit = await owner
    .from('audit_logs')
    .select('id')
    .eq('action_key', 'sale.void')
    .eq('entity_id', target.id)
  assert(audit.data.length === 1, 'audit sale.void tidak ada')
})

await test('cash, QRIS and split payments reconcile', async () => {
  const cases = [
    { label: 'cash exact', payments: [{ method: 'cash', amount_applied: 10000, cash_received: 10000, cash_change: 0 }] },
    { label: 'cash overpay', payments: [{ method: 'cash', amount_applied: 10000, cash_received: 20000, cash_change: 10000 }] },
    { label: 'qris', payments: [{ method: 'qris', amount_applied: 10000 }] },
    {
      label: 'split',
      payments: [
        { method: 'cash', amount_applied: 4000, cash_received: 4000, cash_change: 0 },
        { method: 'qris', amount_applied: 6000 },
      ],
    },
  ]

  for (const item of cases) {
    const body = payload(FIXTURES.pay, 1, 10000, { payments: item.payments })
    const result = await cashierA.rpc('complete_sale', { p_payload: body })
    assert(!result.error, `${item.label} gagal: ${result.error?.message}`)
    created.push({ id: result.data.transaction_id, product: FIXTURES.pay })
    const paid = await owner.from('payments').select('amount_applied').eq('transaction_id', result.data.transaction_id)
    const total = paid.data.reduce((sum, row) => sum + Number(row.amount_applied), 0)
    assert(total === 10000, `${item.label}: total pembayaran ${total}`)
  }

  const stock = await stockOf(FIXTURES.pay)
  assert(stock.stock === 6, `stok payment ${stock.stock}, diharapkan 6`)
})

await test('invalid payments are rejected without writing', async () => {
  const invalid = [
    { label: 'underpay', payments: [{ method: 'cash', amount_applied: 9000, cash_received: 9000, cash_change: 0 }], code: '23514' },
    { label: 'wrong change', payments: [{ method: 'cash', amount_applied: 10000, cash_received: 20000, cash_change: 5000 }], code: '22023' },
    { label: 'bad method', payments: [{ method: 'transfer', amount_applied: 10000 }], code: '22023' },
    { label: 'missing payment', payments: [], code: '22023' },
  ]
  for (const item of invalid) {
    const body = payload(FIXTURES.pay, 1, 10000, { payments: item.payments })
    const result = await cashierA.rpc('complete_sale', { p_payload: body })
    expectError(result, item.code)
    const tx = await owner.from('transactions').select('id').eq('idempotency_key', body.idempotency_key)
    assert(tx.data.length === 0, `${item.label} menulis transaksi`)
  }
  const stock = await stockOf(FIXTURES.pay)
  assert(stock.stock === 6, 'pembayaran invalid mengubah stok')
})

await test('role authorization matches the contract', async () => {
  const anon = makeClient()
  expectError(await anon.rpc('complete_sale', { p_payload: {} }), '42501')
  expectError(await anon.rpc('void_sale', { p_transaction_id: randomUUID(), p_reason: 'x' }), '42501')

  const warehouse = await login(byRole.warehouse, 'warehouse')
  expectError(await warehouse.rpc('complete_sale', { p_payload: {} }), '42501')
  const inactive = await login(byRole.inactive, 'inactive')
  expectError(await inactive.rpc('complete_sale', { p_payload: {} }), '42501')
})

await test('ledger, totals and audit reconcile for every test sale', async () => {
  const receipts = new Set()
  for (const item of created) {
    const tx = await owner
      .from('transactions')
      .select('id, receipt_no, subtotal, discount_amount, grand_total, status')
      .eq('id', item.id)
      .single()
    assert(!tx.error, tx.error?.message)
    assert(!receipts.has(tx.data.receipt_no), `nomor nota ganda ${tx.data.receipt_no}`)
    receipts.add(tx.data.receipt_no)
    assert(Number(tx.data.grand_total) === Number(tx.data.subtotal) - Number(tx.data.discount_amount), 'total tidak konsisten')

    const lines = await owner
      .from('transaction_items')
      .select('quantity, unit_price, line_subtotal, line_discount_amount, line_total')
      .eq('transaction_id', item.id)
    let subtotal = 0
    for (const line of lines.data) {
      const expected = Math.round(Number(line.unit_price) * Number(line.quantity) * 100) / 100
      assert(Number(line.line_subtotal) === expected, 'line_subtotal tidak sama dengan harga x qty')
      assert(Number(line.line_total) === Number(line.line_subtotal) - Number(line.line_discount_amount), 'line_total tidak konsisten')
      subtotal += Number(line.line_subtotal)
    }
    assert(subtotal === Number(tx.data.subtotal), 'jumlah line_subtotal tidak sama dengan subtotal')

    const payments = await owner.from('payments').select('amount_applied').eq('transaction_id', item.id)
    const paid = payments.data.reduce((sum, row) => sum + Number(row.amount_applied), 0)
    assert(paid === Number(tx.data.grand_total), 'jumlah pembayaran tidak sama dengan grand_total')

    if (tx.data.status === 'completed') {
      const movements = await owner
        .from('stock_movements')
        .select('quantity_delta, quantity_before, quantity_after, movement_type')
        .eq('transaction_id', item.id)
      for (const movement of movements.data) {
        assert(
          Number(movement.quantity_before) + Number(movement.quantity_delta) === Number(movement.quantity_after),
          'aritmetika movement salah',
        )
      }
    }
  }

  const balances = await Promise.all([stockOf(FIXTURES.race), stockOf(FIXTURES.idem), stockOf(FIXTURES.pay)])
  assert(balances[0].stock === 0, `saldo race ${balances[0].stock}`)
  assert(balances[1].stock === 3, `saldo idempotency ${balances[1].stock}`)
  assert(balances[2].stock === 6, `saldo payment ${balances[2].stock}`)

  const completes = await owner
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('action_key', 'sale.complete')
  assert((completes.count ?? 0) >= created.length, 'audit sale.complete kurang dari jumlah penjualan')
})

console.log(`\n${passed} passed, ${failed} failed`)
console.log('Fixture tetap aktif; histori tes tidak dihapus. Nonaktifkan manual setelah review bila needed.')
if (failed > 0) process.exitCode = 1
