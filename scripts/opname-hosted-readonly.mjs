#!/usr/bin/env node
/**
 * Phase 5E.1 — read-only hosted regression for the Phase 5E opname read RPCs.
 *
 * Uses only sessions and items that already exist. It never calls
 * create/count/submit/approve/post/cancel and never writes a row.
 *
 *   npm run test:hosted:opname
 *
 * The full-catalog sessions created by Phase 5D were cancelled without posting,
 * so they are safe fixtures for pagination and summary checks. The 1,361
 * imported products remain untouched.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const PREVIEW_REF = 'ptbllrugrjepdhhdkzxn'

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
console.log(`target preview ${ref} — read-only`)

const accounts = JSON.parse(readFileSync('.tmp/phase2b-accounts.json', 'utf8'))
const byRole = Object.fromEntries(accounts.map((account) => [account.role, account]))

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

async function expectRejected(client, name, args, label) {
  const { error } = await client.rpc(name, args)
  assert(Boolean(error), `${label}: ${name} unexpectedly succeeded`)
  const text = `${error.code ?? ''} ${error.message ?? ''}`
  assert(
    /42501|permission denied/i.test(text),
    `${label}: expected 42501/permission denied, got "${text.trim()}"`,
  )
  return error
}

async function countRows(client, table) {
  const { count, error } = await client.from(table).select('id', { count: 'exact', head: true })
  if (error) throw new Error(`${table} count: ${error.message}`)
  return count ?? 0
}

// --------------------------------------------------------------------------- //
// Session and role preflight
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
  const { data: userData, error: userError } = await client.auth.getUser()
  assert(!userError && userData.user, `${label}: session unreadable`)
  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('role, is_active')
    .eq('id', userData.user.id)
    .single()
  assert(!profileError && profile, `${label}: profile unreadable`)
  roles[label] = { id: userData.user.id, ...profile }
}
assert(roles.owner.role === 'owner' && roles.owner.is_active, 'owner account is not an active owner')
assert(
  roles.warehouse.role === 'inventory_staff' && roles.warehouse.is_active,
  'warehouse account is not an active inventory_staff',
)
assert(roles.cashier.role === 'cashier' && roles.cashier.is_active, 'cashier account is not active')
assert(roles.inactive.is_active === false, 'inactive account is unexpectedly active')
console.log('accounts verified: owner, inventory_staff, cashier, inactive')

const before = {
  sessions: await countRows(owner, 'stock_opnames'),
  items: await countRows(owner, 'stock_opname_items'),
  movements: await countRows(owner, 'stock_movements'),
}

let session = null
let firstPage = null
const { data: cancelled, error: cancelledError } = await owner
  .from('stock_opnames')
  .select('id, opname_no, status, scope_note, created_at')
  .eq('status', 'cancelled')
  .order('created_at')
assert(!cancelledError, cancelledError?.message ?? 'cancelled session read failed')

for (const row of cancelled) {
  const page = await rpc(owner, 'list_stock_opname_items', {
    p_opname_id: row.id,
    p_limit: 1,
    p_offset: 0,
    p_filter: 'all',
    p_search: null,
  })
  if (Number(page.total) >= 1361) {
    session = { ...row, total: Number(page.total) }
    firstPage = page
    break
  }
}
assert(session, 'no cancelled session with at least 1,361 items was found')
assert(firstPage.items.length === 1, 'first page is unexpectedly empty')
console.log(`session ${session.opname_no} — ${session.total} items, status ${session.status}`)

// --------------------------------------------------------------------------- //
// Read RPCs
// --------------------------------------------------------------------------- //

await test('summary covers the whole session and matches submit blockers', async () => {
  const summary = await rpc(owner, 'get_stock_opname_summary', { p_opname_id: session.id })
  assert(Number(summary.item_count) === session.total, `item_count ${summary.item_count}`)
  assert(Number(summary.pending_count) === session.total, `pending_count ${summary.pending_count}`)
  assert(Number(summary.counted_count) === 0, `counted_count ${summary.counted_count}`)
  assert(Number(summary.needs_recount_count) === 0, `needs_recount ${summary.needs_recount_count}`)
  assert(Number(summary.posted_count) === 0, `posted_count ${summary.posted_count}`)
  assert(
    Number(summary.opening_balance_count) === session.total,
    `opening_balance_count ${summary.opening_balance_count}`,
  )
  assert(Number(summary.matching_count) === 0, `matching_count ${summary.matching_count}`)
  assert(Number(summary.discrepancy_count) === 0, `discrepancy ${summary.discrepancy_count}`)
  assert(Number(summary.blocker_count) === session.total, `blocker_count ${summary.blocker_count}`)
  assert(summary.ready_for_submit === false, 'an uncounted session is ready to submit')
})

for (const size of [50, 100, 250]) {
  await test(`pagination honours page size ${size} and returns full pages`, async () => {
    const first = await rpc(owner, 'list_stock_opname_items', {
      p_opname_id: session.id,
      p_limit: size,
      p_offset: 0,
      p_filter: 'all',
      p_search: null,
    })
    assert(Number(first.total) === session.total, `total ${first.total}`)
    assert(Number(first.limit) === size, `limit ${first.limit}`)
    assert(Number(first.offset) === 0, `offset ${first.offset}`)
    assert(first.items.length === Math.min(size, session.total), 'first page is short')

    const lastOffset = Math.floor((session.total - 1) / size) * size
    const last = await rpc(owner, 'list_stock_opname_items', {
      p_opname_id: session.id,
      p_limit: size,
      p_offset: lastOffset,
      p_filter: 'all',
      p_search: null,
    })
    assert(Number(last.offset) === lastOffset, `last offset ${last.offset}`)
    assert(last.items.length === session.total - lastOffset, 'last page is short')

    const middleOffset = Math.floor(lastOffset / 2 / size) * size
    const middle = await rpc(owner, 'list_stock_opname_items', {
      p_opname_id: session.id,
      p_limit: size,
      p_offset: middleOffset,
      p_filter: 'all',
      p_search: null,
    })
    assert(middle.items.length > 0, 'middle page is empty')
  })
}

await test('full walk returns every item once, ordered by SKU', async () => {
  const ids = []
  const skus = []
  for (let offset = 0; offset < session.total; offset += 250) {
    const page = await rpc(owner, 'list_stock_opname_items', {
      p_opname_id: session.id,
      p_limit: 250,
      p_offset: offset,
      p_filter: 'all',
      p_search: null,
    })
    assert(Number(page.total) === session.total, `page total ${page.total}`)
    assert(page.items.length <= 250, 'page returned more rows than requested')
    ids.push(...page.items.map((item) => item.id))
    skus.push(...page.items.map((item) => item.sku))
  }
  assert(ids.length === session.total, `walked ${ids.length} of ${session.total}`)
  assert(new Set(ids).size === session.total, 'pagination returned duplicate items')
  for (let index = 1; index < skus.length; index += 1) {
    if (skus[index - 1] > skus[index]) {
      throw new Error(`order broke at ${skus[index - 1]} -> ${skus[index]}`)
    }
  }
  console.log(`      walked ${ids.length} items in ${Math.ceil(session.total / 250)} pages`)
})

await test('search applies to the whole session, not just the page', async () => {
  const sample = firstPage.items[0]
  const term = sample.sku.slice(0, Math.max(4, Math.min(10, sample.sku.length))).toLowerCase()
  const result = await rpc(owner, 'list_stock_opname_items', {
    p_opname_id: session.id,
    p_limit: 50,
    p_offset: 0,
    p_filter: 'all',
    p_search: term,
  })
  assert(Number(result.total) >= 1, `search total ${result.total}`)
  assert(
    result.items.every(
      (item) =>
        item.sku.toLowerCase().includes(term) || item.product_name.toLowerCase().includes(term),
    ),
    'search returned a non-matching row',
  )
})

await test('status filters agree with the summary counters', async () => {
  const summary = await rpc(owner, 'get_stock_opname_summary', { p_opname_id: session.id })
  for (const [filter, expected] of [
    ['pending', Number(summary.pending_count)],
    ['recount', Number(summary.needs_recount_count)],
    ['difference', Number(summary.discrepancy_count)],
  ]) {
    const page = await rpc(owner, 'list_stock_opname_items', {
      p_opname_id: session.id,
      p_limit: 1,
      p_offset: 0,
      p_filter: filter,
      p_search: null,
    })
    assert(Number(page.total) === expected, `${filter} total ${page.total} != ${expected}`)
  }
})

await test('item context returns snapshot and current stock without mutation', async () => {
  const item = firstPage.items[0]
  // The list RPC deliberately returns only the snapshot quantity; the version
  // lives on the item row, so compare the context against that row.
  const { data: row, error: rowError } = await owner
    .from('stock_opname_items')
    .select('product_id, system_qty_snapshot, stock_version_snapshot, count_status')
    .eq('id', item.id)
    .single()
  assert(!rowError && row, rowError?.message ?? 'item row read failed')

  const context = await rpc(owner, 'get_stock_opname_item_context', { p_item_id: item.id })
  assert(context.item_id === item.id, 'wrong item id')
  assert(context.opname_id === session.id, 'wrong opname id')
  assert(context.product_id === row.product_id, 'wrong product id')
  assert(item.product_id === row.product_id, 'list and item row disagree on the product')
  assert(
    context.system_qty_snapshot === row.system_qty_snapshot,
    'snapshot quantity differs from the item row',
  )
  assert(
    Number(context.stock_version_snapshot) === Number(row.stock_version_snapshot),
    'snapshot version differs from the item row',
  )
  assert(context.count_status === row.count_status, 'count status differs')

  const { data: product, error } = await owner
    .from('products')
    .select('stock_on_hand, stock_version, is_active')
    .eq('id', item.product_id)
    .single()
  assert(!error && product, error?.message ?? 'product read failed')
  assert(Number(context.current_version) === Number(product.stock_version), 'current version differs')
  assert(
    (context.current_qty === null && product.stock_on_hand === null) ||
      Number(context.current_qty) === Number(product.stock_on_hand),
    'current quantity differs from the product',
  )
  assert(context.is_active === product.is_active, 'product active flag differs')
})

await test('recount context exposes both numbers for a needs_recount item', async () => {
  const { data: rows, error } = await owner
    .from('stock_opname_items')
    .select('id, count_status, system_qty_snapshot, stock_version_snapshot')
    .eq('count_status', 'needs_recount')
    .limit(1)
  assert(!error, error?.message ?? 'recount item read failed')
  assert(rows.length === 1, 'no needs_recount item exists in preview')
  const row = rows[0]
  const context = await rpc(owner, 'get_stock_opname_item_context', { p_item_id: row.id })
  assert(context.count_status === 'needs_recount', `status ${context.count_status}`)
  assert(
    Number(context.system_qty_snapshot) === Number(row.system_qty_snapshot),
    'recount snapshot differs',
  )
  assert(
    Number(context.stock_version_snapshot) === Number(row.stock_version_snapshot),
    'recount snapshot version differs',
  )
  assert('current_qty' in context && 'current_version' in context, 'current stock is missing')
})

await test('owner and staff may read; cashier, inactive and anon are rejected', async () => {
  const staffSummary = await rpc(staff, 'get_stock_opname_summary', { p_opname_id: session.id })
  assert(Number(staffSummary.item_count) === session.total, 'staff summary is wrong')

  const item = firstPage.items[0]
  for (const [label, client] of [
    ['cashier', cashier],
    ['inactive', inactive],
    ['anon', anon],
  ]) {
    await expectRejected(
      client,
      'get_stock_opname_summary',
      { p_opname_id: session.id },
      `${label} summary`,
    )
    await expectRejected(
      client,
      'list_stock_opname_items',
      { p_opname_id: session.id, p_limit: 1, p_offset: 0, p_filter: 'all', p_search: null },
      `${label} items`,
    )
    await expectRejected(
      client,
      'get_stock_opname_item_context',
      { p_item_id: item.id },
      `${label} context`,
    )
  }
})

await test('the read-only run wrote nothing', async () => {
  const after = {
    sessions: await countRows(owner, 'stock_opnames'),
    items: await countRows(owner, 'stock_opname_items'),
    movements: await countRows(owner, 'stock_movements'),
  }
  assert(after.sessions === before.sessions, `sessions ${before.sessions} -> ${after.sessions}`)
  assert(after.items === before.items, `items ${before.items} -> ${after.items}`)
  assert(after.movements === before.movements, `movements ${before.movements} -> ${after.movements}`)
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  for (const failure of failures) console.error(`  ${failure.name}: ${failure.message}`)
  process.exitCode = 1
}
