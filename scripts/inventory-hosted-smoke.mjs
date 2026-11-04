#!/usr/bin/env node
/**
 * Phase 5D — hosted inventory validation (stock opname engine).
 *
 * Target: the disposable preview project only. Aborts on any other host.
 *
 *   node scripts/inventory-hosted-smoke.mjs            # read-only preflight
 *   node scripts/inventory-hosted-smoke.mjs --execute  # full run (writes)
 *
 * Only dedicated TEST-OPN-* products are created and changed. The 1,361
 * imported products (stock NULL) are never touched: every session below is
 * scoped by explicit product ids, and the full-catalog snapshot is cancelled
 * without posting.
 *
 * Credentials and JWTs are never printed. Fixture ids are written to
 * .tmp/phase5d-fixtures.json before the first stock mutation.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const PREVIEW_REF = 'ptbllrugrjepdhhdkzxn'
const EXECUTE = process.argv.includes('--execute')

const env = {}
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
}

const url = (env.SUPABASE_URL || env.NUXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY
if (!url || !key) throw new Error('SUPABASE_URL / publishable key missing from .env')

const ref = new URL(url).hostname.split('.')[0]
if (ref !== PREVIEW_REF) {
  console.error(`BLOCKED: target ${ref} is not preview ${PREVIEW_REF}`)
  process.exit(1)
}
console.log(`target preview ${ref} — mode ${EXECUTE ? 'EXECUTE' : 'PREFLIGHT (read-only)'}`)

const accounts = JSON.parse(readFileSync('.tmp/phase2b-accounts.json', 'utf8'))
const byRole = Object.fromEntries(accounts.map((a) => [a.role, a]))

const makeClient = () =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

async function login(role) {
  const account = byRole[role]
  if (!account) throw new Error(`account for role ${role} missing from .tmp/phase2b-accounts.json`)
  const client = makeClient()
  const { error } = await client.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  })
  if (error) throw new Error(`${role} sign-in failed: ${error.message}`)
  return client
}

// --------------------------------------------------------------------------- //
// Harness
// --------------------------------------------------------------------------- //

let passed = 0
let failed = 0
const failures = []

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
    failures.push({ name, message: error.message })
    console.error(`FAIL  ${name}`)
    console.error(`      ${error.message}`)
  }
}

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return typeof data === 'string' ? JSON.parse(data) : data
}

async function rpcError(client, name, args) {
  const { error } = await client.rpc(name, args)
  assert(Boolean(error), `${name}: expected rejection, but it succeeded`)
  return error
}

async function expectReject(label, client, name, args, fragment) {
  const error = await rpcError(client, name, args)
  if (fragment) {
    const text = `${error.code ?? ''} ${error.message}`
    assert(text.includes(fragment), `${label}: expected ${fragment}, got "${text}"`)
  }
  return error
}

async function waitUntil(timestamp) {
  const delay = timestamp - Date.now()
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
}

function stamp() {
  return Date.now().toString(36).toUpperCase()
}

// --------------------------------------------------------------------------- //
// Preflight
// --------------------------------------------------------------------------- //

const owner = await login('owner')
const staff = await login('warehouse')
const cashier = await login('cashier')
const inactive = await login('inactive')
const anon = makeClient()

const roles = {}
for (const [label, client] of [
  ['owner', owner],
  ['warehouse', staff],
  ['cashier', cashier],
  ['inactive', inactive],
]) {
  const user = await client.auth.getUser()
  const profile = await client
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.data.user.id)
    .maybeSingle()
  assert(profile.data, `${label}: profile unreadable`)
  roles[label] = { id: user.data.user.id, ...profile.data }
}
console.log(
  `accounts: owner=${roles.owner.role} staff=${roles.warehouse.role} cashier=${roles.cashier.role} inactive=${roles.inactive.role}/${roles.inactive.is_active ? 'active' : 'inactive'}`,
)

const units = await owner.from('units_of_measure').select('id, code, decimal_scale')
if (units.error) throw new Error(units.error.message)
const unitByCode = Object.fromEntries(units.data.map((u) => [u.code, u]))
assert(unitByCode.PCS, 'PCS unit missing')
assert(unitByCode.METER, 'METER unit missing')

if (!EXECUTE) {
  const catalog = await owner.from('products').select('id', { count: 'exact', head: true })
  const unknown = await owner
    .from('products')
    .select('id', { count: 'exact', head: true })
    .is('stock_on_hand', null)
  console.log(`catalog: ${catalog.count} products, ${unknown.count} with NULL stock`)
  console.log('preflight only — re-run with --execute to create fixtures and run the suite')
  process.exit(0)
}

// --------------------------------------------------------------------------- //
// Fixtures (created through the product RPC, so stock stays NULL)
// --------------------------------------------------------------------------- //

const RUN = stamp()
const FIXTURE_SKUS = {
  A: `TEST-OPN-A-${RUN}`,
  B: `TEST-OPN-B-${RUN}`,
  C: `TEST-OPN-C-${RUN}`,
  D: `TEST-OPN-D-${RUN}`,
  E: `TEST-OPN-E-${RUN}`,
  // F stays NULL for the whole run: the only product that can exercise the
  // "unknown stock needs opening_balance + note" guards after A and B are seeded.
  F: `TEST-OPN-F-${RUN}`,
}

const fixtures = {}
for (const [slot, sku] of Object.entries(FIXTURE_SKUS)) {
  const data = await rpc(owner, 'upsert_product', {
    p_payload: {
      sku,
      name: `TEST Opname ${slot} ${RUN}`,
      unit_id: slot === 'E' ? unitByCode.METER.id : unitByCode.PCS.id,
      sale_price: 5000,
      is_active: true,
    },
  })
  fixtures[slot] = { id: data.id, sku, unit: slot === 'E' ? 'METER' : 'PCS' }
}

mkdirSync('.tmp', { recursive: true })
writeFileSync('.tmp/phase5d-fixtures.json', JSON.stringify({ run: RUN, fixtures }, null, 2))
console.log('\nfixtures created (stock still NULL):')
for (const [slot, row] of Object.entries(fixtures)) {
  console.log(`  ${slot}  ${row.sku}  ${row.id}  unit=${row.unit}`)
}

// --------------------------------------------------------------------------- //
// Helpers that talk to real RPCs
// --------------------------------------------------------------------------- //

let sessionSeq = 0

async function createSession(client, label, productIds) {
  sessionSeq += 1
  const data = await rpc(client, 'create_stock_opname', {
    p_payload: {
      idempotency_key: randomUUID(),
      scope_note: `Phase 5D ${label}`,
      product_ids: productIds,
    },
  })
  return data
}

async function itemFor(opnameId, productId) {
  const { data, error } = await owner
    .from('stock_opname_items')
    .select('id, system_qty_snapshot, stock_version_snapshot, physical_qty, difference_qty, reason_code, count_status')
    .eq('stock_opname_id', opnameId)
    .eq('product_id', productId)
    .single()
  if (error) throw new Error(`item lookup: ${error.message}`)
  return data
}

async function count(client, itemId, qty, reason = '', note = '') {
  return rpc(client, 'record_stock_opname_count', {
    p_stock_opname_item_id: itemId,
    p_physical_qty: qty,
    p_reason_code: reason,
    p_reason_note: note,
  })
}

async function submit(client, opnameId) {
  return rpc(client, 'submit_stock_opname', { p_opname_id: opnameId })
}

async function approve(client, opnameId) {
  return rpc(client, 'approve_stock_opname', { p_opname_id: opnameId })
}

async function post(client, opnameId) {
  return rpc(client, 'post_stock_opname', { p_opname_id: opnameId })
}

async function cancel(client, opnameId, reason) {
  return rpc(client, 'cancel_stock_opname', { p_opname_id: opnameId, p_reason: reason })
}

async function productState(productId) {
  const { data, error } = await owner
    .from('products')
    .select('stock_on_hand, stock_version, is_active')
    .eq('id', productId)
    .single()
  if (error) throw new Error(`product read: ${error.message}`)
  return {
    stock: data.stock_on_hand === null ? null : Number(data.stock_on_hand),
    version: Number(data.stock_version),
    active: data.is_active,
  }
}

async function movementsOf(productId, opnameId) {
  const { data, error } = await owner
    .from('stock_movements')
    .select(
      'id, movement_type, quantity_delta, quantity_before, quantity_after, reason_code, actor_id, stock_opname_id, idempotency_key',
    )
    .eq('product_id', productId)
    .order('id')
  if (error) throw new Error(`movement read: ${error.message}`)
  return data.map((row) => ({
    ...row,
    quantity_delta: Number(row.quantity_delta),
    quantity_before: row.quantity_before === null ? null : Number(row.quantity_before),
    quantity_after: Number(row.quantity_after),
    mine: row.stock_opname_id === opnameId,
  }))
}

async function discrepancyLogs(opnameId) {
  const { data: items, error: itemError } = await owner
    .from('stock_opname_items')
    .select('id')
    .eq('stock_opname_id', opnameId)
  if (itemError) throw new Error(`item read: ${itemError.message}`)
  const itemIds = items.map((row) => row.id)
  if (itemIds.length === 0) return []

  const { data, error } = await owner
    .from('stock_discrepancy_logs')
    .select('stock_opname_item_id, revision, system_qty, physical_qty, difference_qty, reason_code, approved_by, created_by')
    .in('stock_opname_item_id', itemIds)
    .order('revision')
  if (error) throw new Error(`discrepancy read: ${error.message}`)
  return data.map((row) => ({
    ...row,
    system_qty: Number(row.system_qty),
    physical_qty: Number(row.physical_qty),
    difference_qty: Number(row.difference_qty),
    revision: Number(row.revision),
  }))
}

async function auditCount(actionKey, entityId) {
  const { count: value, error } = await owner
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('action_key', actionKey)
    .eq('entity_id', entityId)
  if (error) throw new Error(`audit read: ${error.message}`)
  return value ?? 0
}

// --------------------------------------------------------------------------- //
// 1. Seed known stock through a real opening balance
// --------------------------------------------------------------------------- //

const seed = await createSession(owner, 'seed', [fixtures.C.id, fixtures.D.id, fixtures.E.id])

await test('create: one row per scoped product, snapshot NULL preserved, stock untouched', async () => {
  const { count: items, error } = await owner
    .from('stock_opname_items')
    .select('id', { count: 'exact', head: true })
    .eq('stock_opname_id', seed.opname_id)
  assert(!error, error?.message ?? 'item count failed')
  assert(items === 3, `expected 3 items, got ${items}`)

  const itemC = await itemFor(seed.opname_id, fixtures.C.id)
  assert(itemC.system_qty_snapshot === null, 'NULL stock was not preserved in the snapshot')
  assert(Number(itemC.stock_version_snapshot) === 0, 'snapshot version is not 0')

  for (const slot of ['C', 'D', 'E']) {
    const state = await productState(fixtures[slot].id)
    assert(state.stock === null, `${slot}: create changed stock`)
  }
})

await test('create: retrying the same idempotency key returns the same session', async () => {
  const payload = {
    p_payload: { idempotency_key: randomUUID(), scope_note: 'Phase 5D retry', product_ids: [fixtures.B.id] },
  }
  const first = await rpc(owner, 'create_stock_opname', payload)
  const again = await rpc(owner, 'create_stock_opname', payload)
  assert(again.opname_id === first.opname_id, 'retry created a second session')
  assert(again.already_processed === true, 'retry was not marked already_processed')
  await cancel(owner, first.opname_id, 'Phase 5D retry fixture')
})

await test('count: stock on the seed session is written only after posting', async () => {
  const itemC = await itemFor(seed.opname_id, fixtures.C.id)
  await count(staff, itemC.id, 10, 'opening_balance', 'Saldo awal Phase 5D')
  const itemD = await itemFor(seed.opname_id, fixtures.D.id)
  await count(owner, itemD.id, 10, 'opening_balance', 'Saldo awal Phase 5D')
  const itemE = await itemFor(seed.opname_id, fixtures.E.id)
  await count(owner, itemE.id, 2.5, 'opening_balance', 'Saldo awal Phase 5D')

  for (const slot of ['C', 'D', 'E']) {
    const state = await productState(fixtures[slot].id)
    assert(state.stock === null, `${slot}: counting changed stock`)
  }
})

await test('approve: owner-only and never changes stock', async () => {
  await submit(staff, seed.opname_id)
  await expectReject('staff approve', staff, 'approve_stock_opname', { p_opname_id: seed.opname_id }, '42501')
  const before = await productState(fixtures.C.id)
  const approved = await approve(owner, seed.opname_id)
  assert(approved.status === 'approved', `status is ${approved.status}`)
  const after = await productState(fixtures.C.id)
  assert(after.stock === before.stock, 'approval changed stock')
})

await test('post: opening balances use quantity_before NULL and version +1', async () => {
  const result = await post(owner, seed.opname_id)
  assert(result.result === 'posted', `result is ${result.result}`)
  assert(Number(result.opening_balance_count) === 3, 'opening balance count is wrong')
  assert(Number(result.discrepancy_count) === 0, 'opening balances produced a discrepancy')

  for (const slot of ['C', 'D', 'E']) {
    const state = await productState(fixtures[slot].id)
    assert(state.stock !== null, `${slot}: stock still NULL after posting`)
    assert(state.version === 1, `${slot}: version is ${state.version}`)
    const mine = (await movementsOf(fixtures[slot].id, seed.opname_id)).filter((m) => m.mine)
    assert(mine.length === 1, `${slot}: expected one opening movement`)
    assert(mine[0].movement_type === 'opening_balance', `${slot}: wrong movement type`)
    assert(mine[0].quantity_before === null, `${slot}: quantity_before is not NULL`)
    assert(mine[0].quantity_after === mine[0].quantity_delta, `${slot}: delta does not match after`)
    assert(mine[0].reason_code === 'opening_balance', `${slot}: reason is not opening_balance`)
    assert(mine[0].actor_id === roles.owner.id, `${slot}: actor is wrong`)
  }

  const itemE = await itemFor(seed.opname_id, fixtures.E.id)
  assert(Number(itemE.physical_qty) === 2.5, 'decimal quantity was not stored')
})

// --------------------------------------------------------------------------- //
// 2. Opening balance — positive and zero
// --------------------------------------------------------------------------- //

await test('opening balance: positive quantity 25 on NULL stock', async () => {
  const session = await createSession(owner, 'opening positive', [fixtures.A.id])
  const item = await itemFor(session.opname_id, fixtures.A.id)
  assert(item.system_qty_snapshot === null, 'fixture A is not NULL-stock')
  await count(owner, item.id, 25, 'opening_balance', 'Saldo awal rak depan')
  await submit(owner, session.opname_id)
  await approve(owner, session.opname_id)
  await post(owner, session.opname_id)

  const state = await productState(fixtures.A.id)
  assert(state.stock === 25, `stock is ${state.stock}`)
  const mine = (await movementsOf(fixtures.A.id, session.opname_id)).filter((m) => m.mine)
  assert(mine.length === 1, 'expected one movement')
  assert(mine[0].quantity_before === null, 'quantity_before is not NULL')
  assert(mine[0].quantity_delta === 25, `delta is ${mine[0].quantity_delta}`)
  assert(mine[0].quantity_after === 25, 'quantity_after is wrong')
  assert((await discrepancyLogs(session.opname_id)).length === 0, 'an unknown baseline produced a discrepancy')
})

await test('opening balance: zero is allowed only for this exact case', async () => {
  const session = await createSession(owner, 'opening zero', [fixtures.B.id])
  const item = await itemFor(session.opname_id, fixtures.B.id)
  await count(owner, item.id, 0, 'opening_balance', 'Rak kosong, belum pernah tercatat')
  await submit(owner, session.opname_id)
  await approve(owner, session.opname_id)
  await post(owner, session.opname_id)

  const state = await productState(fixtures.B.id)
  assert(state.stock === 0, `stock is ${state.stock}`)
  const mine = (await movementsOf(fixtures.B.id, session.opname_id)).filter((m) => m.mine)
  assert(mine.length === 1, 'zero opening did not write a movement')
  assert(mine[0].quantity_delta === 0, 'delta is not 0')
  assert(mine[0].quantity_before === null, 'quantity_before is not NULL')
  assert(mine[0].quantity_after === 0, 'quantity_after is not 0')

  // A zero delta must stay impossible for any other movement type: the ledger
  // constraint only admits it for opening_balance, enforced in local group E.
  assert(mine[0].movement_type === 'opening_balance', 'the zero movement is not an opening balance')
})

// --------------------------------------------------------------------------- //
// 3. Known stock: no change, increase, decrease
// --------------------------------------------------------------------------- //

await test('known stock: no change writes nothing and leaves the item posted', async () => {
  const before = await movementsOf(fixtures.C.id, '')
  const session = await createSession(owner, 'no change', [fixtures.C.id])
  const item = await itemFor(session.opname_id, fixtures.C.id)
  assert(Number(item.system_qty_snapshot) === 10, 'snapshot is not 10')
  await count(owner, item.id, 10)
  await submit(owner, session.opname_id)
  await approve(owner, session.opname_id)
  const result = await post(owner, session.opname_id)
  assert(result.result === 'posted', 'no-change session was not posted')
  assert(Number(result.unchanged_count) === 1, 'unchanged count is wrong')
  assert(Number(result.discrepancy_count) === 0, 'no-change produced a discrepancy')

  const after = await movementsOf(fixtures.C.id, '')
  assert(after.length === before.length, 'no-change wrote a movement')
  assert((await discrepancyLogs(session.opname_id)).length === 0, 'no-change wrote a discrepancy log')

  const posted = await itemFor(session.opname_id, fixtures.C.id)
  assert(posted.count_status === 'posted', `item status is ${posted.count_status}`)
})

let increaseSession = ''

await test('known stock: increase 10 -> 13 writes +3 and one discrepancy', async () => {
  const session = await createSession(owner, 'increase', [fixtures.C.id])
  increaseSession = session.opname_id
  const item = await itemFor(session.opname_id, fixtures.C.id)
  await count(owner, item.id, 13, 'unrecorded_in', 'Barang masuk tanpa catatan')
  await submit(owner, session.opname_id)
  await approve(owner, session.opname_id)
  const result = await post(owner, session.opname_id)
  assert(result.result === 'posted', 'increase was not posted')

  const state = await productState(fixtures.C.id)
  assert(state.stock === 13, `stock is ${state.stock}`)
  assert(state.version === 2, `version is ${state.version}`)

  const mine = (await movementsOf(fixtures.C.id, session.opname_id)).filter((m) => m.mine)
  assert(mine.length === 1, 'expected one adjustment')
  assert(mine[0].movement_type === 'opname_adjustment', 'wrong movement type')
  assert(mine[0].quantity_delta === 3, `delta is ${mine[0].quantity_delta}`)
  assert(mine[0].quantity_before === 10, 'quantity_before is wrong')
  assert(mine[0].quantity_after === 13, 'quantity_after is wrong')

  const logs = await discrepancyLogs(session.opname_id)
  assert(logs.length === 1, `expected one discrepancy log, got ${logs.length}`)
  assert(logs[0].system_qty === 10 && logs[0].physical_qty === 13, 'log quantities are wrong')
  assert(logs[0].difference_qty === 3, 'log delta is wrong')
  assert(logs[0].approved_by === roles.owner.id, 'log has no approving owner')
})

await test('known stock: decrease 13 -> 11 writes -2 with a later revision', async () => {
  const session = await createSession(owner, 'decrease', [fixtures.C.id])
  const item = await itemFor(session.opname_id, fixtures.C.id)
  await count(owner, item.id, 11, 'broken_damaged', 'Pecah saat pemindahan')
  await submit(owner, session.opname_id)
  await approve(owner, session.opname_id)
  await post(owner, session.opname_id)

  const state = await productState(fixtures.C.id)
  assert(state.stock === 11, `stock is ${state.stock}`)

  const mine = (await movementsOf(fixtures.C.id, session.opname_id)).filter((m) => m.mine)
  assert(mine.length === 1, 'expected one adjustment')
  assert(mine[0].quantity_delta === -2, `delta is ${mine[0].quantity_delta}`)
  assert(mine[0].quantity_before === 13, 'quantity_before is wrong')
  assert(mine[0].quantity_after === 11, 'quantity_after is wrong')
  assert(mine[0].quantity_before + mine[0].quantity_delta === mine[0].quantity_after, 'arithmetic drifted')

  const logs = await discrepancyLogs(session.opname_id)
  assert(logs.length === 1, 'expected one discrepancy log')
  assert(logs[0].difference_qty === -2, 'log delta is wrong')
})

// --------------------------------------------------------------------------- //
// 4. Count validation and reason enforcement
// --------------------------------------------------------------------------- //

const validationSession = await createSession(owner, 'validation', [fixtures.C.id, fixtures.F.id])
const validationC = await itemFor(validationSession.opname_id, fixtures.C.id)
const validationF = await itemFor(validationSession.opname_id, fixtures.F.id)

await test('count guards: negative, precision, missing reason, other without note', async () => {
  await expectReject('negative', owner, 'record_stock_opname_count', {
    p_stock_opname_item_id: validationC.id,
    p_physical_qty: -1,
    p_reason_code: 'missing',
    p_reason_note: '',
  }, 'PHYSICAL_QTY_NEGATIVE')

  await expectReject('PCS decimal', owner, 'record_stock_opname_count', {
    p_stock_opname_item_id: validationC.id,
    p_physical_qty: 1.5,
    p_reason_code: 'missing',
    p_reason_note: '',
  }, 'INVALID_PRECISION')

  await expectReject('missing reason', owner, 'record_stock_opname_count', {
    p_stock_opname_item_id: validationC.id,
    p_physical_qty: 9,
    p_reason_code: '',
    p_reason_note: '',
  }, 'REASON_REQUIRED')

  await expectReject('other without note', owner, 'record_stock_opname_count', {
    p_stock_opname_item_id: validationC.id,
    p_physical_qty: 9,
    p_reason_code: 'other',
    p_reason_note: '',
  }, 'REASON_NOTE_REQUIRED')

  await expectReject('opening_balance on known stock', owner, 'record_stock_opname_count', {
    p_stock_opname_item_id: validationC.id,
    p_physical_qty: 9,
    p_reason_code: 'opening_balance',
    p_reason_note: 'salah alasan',
  }, 'REASON_INVALID')

  await expectReject('unknown reason', owner, 'record_stock_opname_count', {
    p_stock_opname_item_id: validationC.id,
    p_physical_qty: 9,
    p_reason_code: 'because',
    p_reason_note: '',
  }, 'INVALID_REASON')
})

await test('count guards: NULL stock needs opening_balance and a note', async () => {
  await expectReject('wrong reason for NULL stock', owner, 'record_stock_opname_count', {
    p_stock_opname_item_id: validationF.id,
    p_physical_qty: 3,
    p_reason_code: 'missing',
    p_reason_note: 'x',
  }, 'OPENING_BALANCE_REASON_REQUIRED')

  await expectReject('missing opening note', owner, 'record_stock_opname_count', {
    p_stock_opname_item_id: validationF.id,
    p_physical_qty: 3,
    p_reason_code: 'opening_balance',
    p_reason_note: '   ',
  }, 'OPENING_BALANCE_NOTE_REQUIRED')
})

await test('count authorization: staff may count, cashier and inactive may not', async () => {
  const counted = await count(staff, validationC.id, 11)
  assert(counted.count_status === 'counted', 'staff count was not stored')
  assert(counted.counted_by === roles.warehouse.id, 'counted_by is not the staff user')

  await expectReject('cashier count', cashier, 'record_stock_opname_count', {
    p_stock_opname_item_id: validationC.id,
    p_physical_qty: 11,
    p_reason_code: '',
    p_reason_note: '',
  }, '42501')

  await expectReject('inactive count', inactive, 'record_stock_opname_count', {
    p_stock_opname_item_id: validationC.id,
    p_physical_qty: 11,
    p_reason_code: '',
    p_reason_note: '',
  }, '42501')

  await expectReject('anon count', anon, 'record_stock_opname_count', {
    p_stock_opname_item_id: validationC.id,
    p_physical_qty: 11,
    p_reason_code: '',
    p_reason_note: '',
  }, '42501')
})

await test('submit: incomplete session is rejected with the blocker list', async () => {
  const error = await expectReject('incomplete submit', owner, 'submit_stock_opname', {
    p_opname_id: validationSession.opname_id,
  }, 'OPNAME_INCOMPLETE')
  assert(error.details && error.details.includes('item_id'), 'blocker detail is missing')
})

await cancel(owner, validationSession.opname_id, 'Phase 5D validation session selesai')

// --------------------------------------------------------------------------- //
// 5. Version conflict and recount (the 0020 fix)
// --------------------------------------------------------------------------- //

let conflictSession = ''

await test('conflict: a sale after the snapshot blocks posting and flags needs_recount', async () => {
  const session = await createSession(owner, 'conflict', [fixtures.D.id])
  conflictSession = session.opname_id
  const item = await itemFor(session.opname_id, fixtures.D.id)
  assert(Number(item.system_qty_snapshot) === 10, 'fixture D snapshot is not 10')
  await count(staff, item.id, 10)
  await submit(staff, session.opname_id)
  await approve(owner, session.opname_id)

  const sale = await rpc(cashier, 'complete_sale', {
    p_payload: {
      idempotency_key: randomUUID(),
      business_date: new Date().toISOString().slice(0, 10),
      discount_amount: 0,
      items: [{ product_id: fixtures.D.id, quantity: 1 }],
      payments: [{ method: 'cash', amount_applied: 5000, cash_received: 5000, cash_change: 0 }],
    },
  })
  assert(sale.transaction_id, 'the sale did not complete')

  const before = await productState(fixtures.D.id)
  assert(before.stock === 9 && before.version === 2, `D is ${before.stock}/v${before.version}`)

  const result = await post(owner, session.opname_id)
  assert(result.result === 'version_conflict', `result is ${result.result}`)
  assert(Array.isArray(result.conflicts) && result.conflicts.length === 1, 'conflict list is wrong')
  const conflict = result.conflicts[0]
  assert(conflict.sku === fixtures.D.sku, 'wrong product reported')
  // D entered this session at version 1 (set by the seed opening balance).
  assert(Number(conflict.snapshot_version) === 1, 'snapshot version is wrong')
  assert(Number(conflict.current_version) === 2, 'current version is wrong')
  assert(Number(conflict.snapshot_qty) === 10, 'snapshot qty is wrong')
  assert(Number(conflict.current_qty) === 9, 'current qty is wrong')

  const { data: opnameRow, error } = await owner
    .from('stock_opnames')
    .select('status, approved_by, approved_at')
    .eq('id', session.opname_id)
    .single()
  assert(!error, error?.message ?? 'opname read failed')
  assert(opnameRow.status === 'counting', `session is ${opnameRow.status}`)
  assert(opnameRow.approved_by === null && opnameRow.approved_at === null, 'approval metadata was not cleared')

  const flagged = await itemFor(session.opname_id, fixtures.D.id)
  assert(flagged.count_status === 'needs_recount', `item is ${flagged.count_status}`)

  const after = await productState(fixtures.D.id)
  assert(after.stock === 9 && after.version === 2, 'the conflict overwrote stock')
  assert((await movementsOf(fixtures.D.id, session.opname_id)).filter((m) => m.mine).length === 0, 'a stale movement was written')
  assert((await discrepancyLogs(session.opname_id)).length === 0, 'a stale discrepancy was written')
  assert((await auditCount('opname.post_conflict', session.opname_id)) === 1, 'post_conflict audit missing')
})

await test('recount: the snapshot is re-based so the session can post again', async () => {
  const item = await itemFor(conflictSession, fixtures.D.id)
  await count(staff, item.id, 9)

  const rebased = await itemFor(conflictSession, fixtures.D.id)
  assert(Number(rebased.system_qty_snapshot) === 9, `system snapshot is ${rebased.system_qty_snapshot}`)
  assert(Number(rebased.stock_version_snapshot) === 2, `version snapshot is ${rebased.stock_version_snapshot}`)
  assert(Number(rebased.difference_qty) === 0, `difference is ${rebased.difference_qty}`)
  assert(rebased.count_status === 'counted', 'needs_recount was not cleared')

  await submit(staff, conflictSession)
  await approve(owner, conflictSession)
  const result = await post(owner, conflictSession)
  assert(result.result === 'posted', `recount post returned ${result.result}`)

  const state = await productState(fixtures.D.id)
  assert(state.stock === 9, `stock is ${state.stock}`)
  assert(state.version === 2, 'a zero-delta recount bumped the version')
  assert((await movementsOf(fixtures.D.id, conflictSession)).filter((m) => m.mine).length === 0, 'a zero-delta recount wrote a movement')
})

// --------------------------------------------------------------------------- //
// 6. Concurrent posting
// --------------------------------------------------------------------------- //

await test('concurrent post: two owner clients produce exactly one posting', async () => {
  const session = await createSession(owner, 'concurrent post', [fixtures.A.id])
  const item = await itemFor(session.opname_id, fixtures.A.id)
  await count(owner, item.id, 30, 'unrecorded_in', 'Tambah stok rak depan')
  await submit(owner, session.opname_id)
  await approve(owner, session.opname_id)

  const ownerB = await login('owner')
  const ownerC = await login('owner')
  const start = Date.now() + 150
  const run = (client) => {
    const sent = Date.now()
    return post(client, session.opname_id).then((result) => ({ result, sent, received: Date.now() }))
  }

  const [a, b] = await Promise.all([
    waitUntil(start).then(() => run(ownerB)),
    waitUntil(start).then(() => run(ownerC)),
  ])
  const overlap = Math.max(a.sent, b.sent) <= Math.min(a.received, b.received)
  console.log(
    `      overlap=${overlap} results=${a.result.result}/${b.result.result} ` +
      `latency=${a.received - a.sent}ms/${b.received - b.sent}ms`,
  )
  assert(overlap, 'requests did not actually overlap; the result is not conclusive')

  const outcomes = [a.result.result, b.result.result].sort()
  assert(outcomes[0] === 'already_posted' && outcomes[1] === 'posted', `unexpected outcomes ${outcomes.join('/')}`)

  const mine = (await movementsOf(fixtures.A.id, session.opname_id)).filter((m) => m.mine)
  assert(mine.length === 1, `expected one movement, got ${mine.length}`)
  assert(mine[0].quantity_delta === 5, `delta is ${mine[0].quantity_delta}`)
  assert((await auditCount('opname.post', session.opname_id)) === 1, 'expected exactly one posting audit')

  const state = await productState(fixtures.A.id)
  assert(state.stock === 30, `stock is ${state.stock}`)
  assert(state.version === 2, `version is ${state.version}`)
})

// --------------------------------------------------------------------------- //
// 7. Cancel
// --------------------------------------------------------------------------- //

await test('cancel: owner only, reason required, posted sessions are final', async () => {
  const session = await createSession(owner, 'cancel', [fixtures.B.id])
  const item = await itemFor(session.opname_id, fixtures.B.id)
  await count(owner, item.id, 0)

  await expectReject('staff cancel', staff, 'cancel_stock_opname', {
    p_opname_id: session.opname_id,
    p_reason: 'staf tidak boleh',
  }, '42501')

  await expectReject('blank reason', owner, 'cancel_stock_opname', {
    p_opname_id: session.opname_id,
    p_reason: '   ',
  }, 'CANCEL_REASON_REQUIRED')

  const before = await productState(fixtures.B.id)
  const cancelled = await cancel(owner, session.opname_id, 'Phase 5D membatalkan sesi uji')
  assert(cancelled.status === 'cancelled', `status is ${cancelled.status}`)
  const after = await productState(fixtures.B.id)
  assert(after.stock === before.stock && after.version === before.version, 'cancelling changed stock')
  assert((await movementsOf(fixtures.B.id, session.opname_id)).filter((m) => m.mine).length === 0, 'cancelling wrote a movement')

  const again = await cancel(owner, session.opname_id, 'Phase 5D membatalkan sesi uji')
  assert(again.already_processed === true, 'repeat cancel is not idempotent')

  await expectReject('cancel a posted session', owner, 'cancel_stock_opname', {
    p_opname_id: conflictSession,
    p_reason: 'terlambat',
  }, 'OPNAME_POSTED')
})

// --------------------------------------------------------------------------- //
// 8. Role matrix on mutations
// --------------------------------------------------------------------------- //

await test('authorization: staff can create/count/submit but never approve, post or cancel', async () => {
  const session = await createSession(staff, 'staff scope', [fixtures.C.id])
  const item = await itemFor(session.opname_id, fixtures.C.id)
  await count(staff, item.id, 11)
  await submit(staff, session.opname_id)

  for (const [name, args] of [
    ['approve_stock_opname', { p_opname_id: session.opname_id }],
    ['post_stock_opname', { p_opname_id: session.opname_id }],
    ['cancel_stock_opname', { p_opname_id: session.opname_id, p_reason: 'x' }],
  ]) {
    await expectReject(`staff ${name}`, staff, name, args, '42501')
  }

  await cancel(owner, session.opname_id, 'Phase 5D staff scope selesai')
})

await test('authorization: cashier, inactive and anon cannot mutate inventory', async () => {
  for (const [label, client] of [
    ['cashier', cashier],
    ['inactive', inactive],
    ['anon', anon],
  ]) {
    await expectReject(`${label} create`, client, 'create_stock_opname', {
      p_payload: { product_ids: [fixtures.C.id] },
    }, '42501')
    await expectReject(`${label} approve`, client, 'approve_stock_opname', {
      p_opname_id: conflictSession,
    }, '42501')
    await expectReject(`${label} post`, client, 'post_stock_opname', {
      p_opname_id: conflictSession,
    }, '42501')
  }
})

// --------------------------------------------------------------------------- //
// 9. Realtime broadcast
// --------------------------------------------------------------------------- //

await test('realtime: one private broadcast with only the four approved fields', async () => {
  const events = []
  const channel = owner.channel('store:stock', { config: { private: true } })
  channel.on('broadcast', { event: 'stock_changed' }, (message) => {
    events.push(message.payload ?? message)
  })
  const subscribed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('channel did not reach SUBSCRIBED')), 20_000)
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer)
        resolve(status)
      }
    })
  })

  try {
    await subscribed
    const session = await createSession(owner, 'realtime', [fixtures.C.id])
    const item = await itemFor(session.opname_id, fixtures.C.id)
    await count(owner, item.id, 14, 'unrecorded_in', 'Uji broadcast')
    await submit(owner, session.opname_id)
    await approve(owner, session.opname_id)
    await post(owner, session.opname_id)

    const deadline = Date.now() + 15_000
    while (events.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    const mine = events.filter((event) => event && event.product_id === fixtures.C.id)
    assert(mine.length === 1, `expected one event for the fixture, got ${mine.length}`)
    const payload = mine[0]
    const required = ['product_id', 'sku', 'stock_on_hand', 'stock_version']
    for (const field of required) {
      assert(field in payload, `payload is missing ${field}`)
    }
    // Realtime adds its own message `id` to the delivered payload. Anything
    // else would mean the trigger leaked more than the stock display needs.
    const unexpected = Object.keys(payload).filter(
      (field) => !required.includes(field) && field !== 'id',
    )
    assert(unexpected.length === 0, `payload has unexpected keys: ${unexpected.join(',')}`)
    assert(payload.sku === fixtures.C.sku, 'payload SKU is wrong')
    assert(Number(payload.stock_on_hand) === 14, `payload stock is ${payload.stock_on_hand}`)
    assert(Number(payload.stock_version) === 4, `payload version is ${payload.stock_version}`)
    assert(!('purchase_cost' in payload) && !('customer_id' in payload), 'payload leaked a restricted field')
  } finally {
    await owner.removeChannel(channel)
  }
})

// --------------------------------------------------------------------------- //
// 10. Full-catalog snapshot performance (never posted)
// --------------------------------------------------------------------------- //

await test('scale: full-catalog snapshot is built server-side and stays unposted', async () => {
  const testRows = await owner
    .from('products')
    .select('id, sku')
    .or('sku.like.TEST-%,sku.like.HOST-%')
    .order('sku')
  assert(!testRows.error, testRows.error?.message ?? 'test product read failed')
  const exclude = testRows.data.map((row) => row.id)

  const total = await owner.from('products').select('id', { count: 'exact', head: true })
  const expected = (total.count ?? 0) - exclude.length

  const started = Date.now()
  const session = await rpc(owner, 'create_stock_opname', {
    p_payload: {
      idempotency_key: randomUUID(),
      scope_note: `Phase 5D katalog penuh ${RUN}`,
      exclude_product_ids: exclude,
    },
  })
  const elapsed = Date.now() - started

  const { count: items, error } = await owner
    .from('stock_opname_items')
    .select('id', { count: 'exact', head: true })
    .eq('stock_opname_id', session.opname_id)
  assert(!error, error?.message ?? 'item count failed')
  assert(items === expected, `expected ${expected} items, got ${items}`)

  // The detail read goes through PostgREST, which caps a response at 1000 rows.
  const page = await owner
    .from('stock_opname_items')
    .select('id')
    .eq('stock_opname_id', session.opname_id)
  assert(!page.error, page.error?.message ?? 'detail read failed')

  console.log(
    `      snapshot ${items} items in ${elapsed} ms; detail query returned ${page.data.length} rows`,
  )
  assert(elapsed < 15_000, `snapshot took ${elapsed} ms`)

  const cancelled = await cancel(owner, session.opname_id, 'Phase 5D uji performa, tidak diposting')
  assert(cancelled.status === 'cancelled', 'performance session was not cancelled')

  const { count: unposted } = await owner
    .from('stock_movements')
    .select('id', { count: 'exact', head: true })
    .eq('stock_opname_id', session.opname_id)
  assert((unposted ?? 0) === 0, 'the performance session wrote a movement')

  const nullStock = await owner
    .from('products')
    .select('id', { count: 'exact', head: true })
    .is('stock_on_hand', null)
  console.log(`      catalog now has ${nullStock.count} NULL-stock products`)
  assert((nullStock.count ?? 0) >= 1361, 'imported NULL-stock products were changed')
})

// --------------------------------------------------------------------------- //
// 11. Reconciliation
// --------------------------------------------------------------------------- //

await test('reconcile: every fixture balance equals its ledger and every row has an actor', async () => {
  const expected = { A: 30, B: 0, C: 14, D: 9, E: 2.5 }
  const neverPosted = { F: null }
  for (const [slot, balance] of Object.entries(expected)) {
    const state = await productState(fixtures[slot].id)
    assert(state.stock === balance, `${slot}: stock ${state.stock}, expected ${balance}`)

    const rows = await owner
      .from('stock_movements')
      .select('movement_type, quantity_delta, quantity_before, quantity_after, actor_id, idempotency_key')
      .eq('product_id', fixtures[slot].id)
    assert(!rows.error, rows.error?.message ?? 'movement read failed')
    const movements = rows.data.map((row) => ({ ...row, quantity_delta: Number(row.quantity_delta) }))

    const openings = movements.filter((row) => row.movement_type === 'opening_balance')
    assert(openings.length === 1, `${slot}: expected exactly one opening movement, got ${openings.length}`)
    assert(openings[0].quantity_before === null, `${slot}: opening is not NULL-based`)

    const sum = movements.reduce((total, row) => total + row.quantity_delta, 0)
    assert(sum === balance, `${slot}: ledger sum ${sum} vs ${balance}`)
    for (const row of movements) {
      assert(row.actor_id, `${slot}: movement ${row.idempotency_key} has no actor`)
      assert(
        Number(row.quantity_before ?? 0) + Number(row.quantity_delta) === Number(row.quantity_after),
        `${slot}: movement arithmetic drifted`,
      )
    }
    const keys = new Set(movements.map((row) => row.idempotency_key))
    assert(keys.size === movements.length, `${slot}: duplicate idempotency keys`)
  }

  const logs = await owner
    .from('stock_discrepancy_logs')
    .select('id, approved_by, created_by')
    .in('product_id', Object.values(fixtures).map((row) => row.id))
  assert(!logs.error, logs.error?.message ?? 'discrepancy read failed')
  for (const row of logs.data) {
    assert(row.approved_by && row.created_by, 'a discrepancy log is missing an actor')
  }

  for (const [slot, balance] of Object.entries(neverPosted)) {
    const state = await productState(fixtures[slot].id)
    assert(state.stock === balance, `${slot}: stock ${state.stock}, expected never-posted`)
    const rows = await owner
      .from('stock_movements')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', fixtures[slot].id)
    assert((rows.count ?? 0) === 0, `${slot}: an unposted fixture gained a movement`)
  }

  // One successful posting; the earlier conflict wrote opname.post_conflict.
  assert((await auditCount('opname.post', conflictSession)) === 1, 'posting audit count is wrong')
})

// --------------------------------------------------------------------------- //
// Cleanup: deactivate fixtures, never delete ledger history
// --------------------------------------------------------------------------- //

await test('cleanup: fixtures are deactivated and their history is kept', async () => {
  for (const [slot, row] of Object.entries(fixtures)) {
    await rpc(owner, 'upsert_product', {
      p_payload: {
        product_id: row.id,
        sku: row.sku,
        name: `TEST Opname ${slot} ${RUN}`,
        unit_id: slot === 'E' ? unitByCode.METER.id : unitByCode.PCS.id,
        sale_price: 5000,
        is_active: false,
      },
    })
    const state = await productState(row.id)
    assert(state.active === false, `${slot}: fixture is still active`)
  }

  const { count: movements } = await owner
    .from('stock_movements')
    .select('id', { count: 'exact', head: true })
    .in('product_id', Object.values(fixtures).map((row) => row.id))
  assert((movements ?? 0) > 0, 'fixture history was deleted')
})

const summary = {
  run: RUN,
  finishedAt: new Date().toISOString(),
  passed,
  failed,
  failures,
  fixtures,
}
writeFileSync('.tmp/phase5d-results.json', JSON.stringify(summary, null, 2))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
