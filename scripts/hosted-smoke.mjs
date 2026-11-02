#!/usr/bin/env node
/**
 * Hosted Supabase Phase 2B smoke test.
 *
 * Requires .env (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) and a local-only
 * .tmp/phase2b-accounts.json created by the Phase 2B setup script. The file
 * contains preview-only test credentials and must never be committed.
 *
 * This test uses only the publishable key and real user sessions. It does not
 * use service_role. It creates one category and one product, activates the
 * cashier and warehouse test accounts, and leaves that test data in the
 * disposable preview project.
 *
 * Run: node scripts/hosted-smoke.mjs
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const envText = fs.readFileSync('.env', 'utf8')
const env = {}
for (const line of envText.split(/\r?\n/)) {
  const t = line.trim()
  if (!t || t.startsWith('#') || !t.includes('=')) continue
  const i = t.indexOf('=')
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}
const url = env.SUPABASE_URL || env.NUXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY
if (!url || !key) throw new Error('Supabase URL/key missing from .env')

const accounts = JSON.parse(fs.readFileSync('.tmp/phase2b-accounts.json', 'utf8'))
const byRole = Object.fromEntries(accounts.map((account) => [account.role, account]))
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}

let passed = 0
let failed = 0
let skipped = 0

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

function skip(name) {
  skipped += 1
  console.log(`SKIP  ${name}`)
}

function clientFor() {
  return createClient(url, key, options)
}

async function signIn(account) {
  const client = clientFor()
  const { data, error } = await client.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  })
  if (error) throw new Error(`${account.role} sign-in failed: ${error.message}`)
  if (!data.session) throw new Error(`${account.role} sign-in returned no session`)
  return client
}

async function expectError(label, promise) {
  const { error } = await promise
  assert(Boolean(error), `${label}: expected an error, but the request succeeded`)
  return error
}

async function expectRows(label, promise) {
  const { data, error } = await promise
  assert(!error, `${label}: ${error?.message ?? 'unknown error'}`)
  assert(Array.isArray(data) && data.length > 0, `${label}: expected at least one row`)
  return data
}

async function expectEmpty(label, promise) {
  const { data, error } = await promise
  assert(!error, `${label}: ${error?.message ?? 'unknown error'}`)
  assert(Array.isArray(data) && data.length === 0, `${label}: expected zero rows`)
  return data
}

const stamp = Date.now().toString(36)
const anon = clientFor()

await test('anonymous cannot read products', async () => {
  const { error } = await anon.from('products').select('id').limit(1)
  assert(Boolean(error), 'anonymous product read succeeded')
})

await test('anonymous cannot invoke privileged RPC', async () => {
  const { error } = await anon.rpc('upsert_product', { p_payload: {} })
  assert(Boolean(error), 'anonymous RPC succeeded')
})

const owner = await signIn(byRole.owner)

await test('owner login returns an active owner profile', async () => {
  const { data, error } = await owner
    .from('profiles')
    .select('id, role, is_active')
    .eq('id', byRole.owner.id)
    .single()
  assert(!error, error?.message ?? 'profile read failed')
  assert(data.role === 'owner', `role is ${data.role}`)
  assert(data.is_active === true, 'owner is inactive')
})

await test('owner activates cashier and warehouse profiles through RPC', async () => {
  const cashier = await owner.rpc('admin_upsert_profile', {
    p_user_id: byRole.cashier.id,
    p_full_name: byRole.cashier.full_name,
    p_role: 'cashier',
    p_is_active: true,
  })
  assert(!cashier.error, cashier.error?.message ?? 'cashier activation failed')
  assert(cashier.data.is_active === true, 'cashier was not activated')

  const warehouse = await owner.rpc('admin_upsert_profile', {
    p_user_id: byRole.warehouse.id,
    p_full_name: byRole.warehouse.full_name,
    p_role: 'inventory_staff',
    p_is_active: true,
  })
  assert(!warehouse.error, warehouse.error?.message ?? 'warehouse activation failed')
  assert(warehouse.data.role === 'inventory_staff', 'warehouse role was not applied')
})

await test('owner cannot deactivate the last active owner', async () => {
  const { error } = await owner.rpc('admin_upsert_profile', {
    p_user_id: byRole.owner.id,
    p_full_name: byRole.owner.full_name,
    p_role: 'owner',
    p_is_active: false,
  })
  assert(Boolean(error), 'last owner deactivation succeeded')
})

const category = await owner
  .from('categories')
  .insert({ name: `Phase 2B ${stamp}` })
  .select('id')
  .single()
if (category.error) throw new Error(`category setup failed: ${category.error.message}`)
const categoryId = category.data.id

const unit = await owner.from('units_of_measure').select('id, code').eq('code', 'PCS').single()
if (unit.error) throw new Error(`unit lookup failed: ${unit.error.message}`)
const unitId = unit.data.id

const sku = `HOST-${stamp}`.toUpperCase()
let productId

await test('owner creates a product through RPC without changing stock', async () => {
  const { data, error } = await owner.rpc('upsert_product', {
    p_payload: {
      sku,
      name: `Hosted Smoke ${stamp}`,
      category_id: categoryId,
      unit_id: unitId,
      sale_price: 12500,
      stock_on_hand: 999,
      is_active: true,
    },
  })
  assert(!error, error?.message ?? 'product create failed')
  const product = typeof data === 'string' ? JSON.parse(data) : data
  assert(product.sku === sku, `unexpected SKU ${product.sku}`)
  assert(product.stock_on_hand === null, 'catalog RPC set stock_on_hand from payload')
  assert(Number(product.stock_version) === 0, 'catalog RPC changed stock_version')
  productId = product.id
})

await test('owner updates a product through RPC without changing stock', async () => {
  const { data, error } = await owner.rpc('upsert_product', {
    p_payload: {
      product_id: productId,
      sku,
      name: `Hosted Smoke ${stamp} Updated`,
      category_id: categoryId,
      unit_id: unitId,
      sale_price: 13000,
      stock_on_hand: 777,
      is_active: true,
    },
  })
  assert(!error, error?.message ?? 'product update failed')
  const product = typeof data === 'string' ? JSON.parse(data) : data
  assert(product.stock_on_hand === null, 'catalog update set stock_on_hand')
  assert(Number(product.stock_version) === 0, 'catalog update changed stock_version')

  const stored = await owner
    .from('products')
    .select('stock_on_hand, stock_version, name')
    .eq('id', productId)
    .single()
  assert(!stored.error, stored.error?.message ?? 'product read failed')
  assert(stored.data.stock_on_hand === null, 'stored stock_on_hand is not null')
  assert(Number(stored.data.stock_version) === 0, 'stored stock_version changed')
})

await test('owner can set purchase cost and read it', async () => {
  const cost = await owner.rpc('set_product_cost', {
    p_product_id: productId,
    p_purchase_cost: 3000,
  })
  assert(!cost.error, cost.error?.message ?? 'cost RPC failed')
  const rows = await expectRows(
    'owner cost read',
    owner.from('product_costs').select('purchase_cost').eq('product_id', productId),
  )
  assert(Number(rows[0].purchase_cost) === 3000, 'stored cost is wrong')
})

await test('owner can update a feature flag', async () => {
  const { error } = await owner.rpc('set_feature_flag', {
    p_feature_key: 'hardware.thermal_printer',
    p_enabled: false,
    p_public_config: {},
  })
  assert(!error, error?.message ?? 'feature flag RPC failed')
})

await test('product RPC rejects invalid SKU, unit, category, and missing name', async () => {
  await expectError(
    'blank SKU',
    owner.rpc('upsert_product', {
      p_payload: { sku: '   ', name: 'Blank SKU', unit_id: unitId },
    }),
  )
  await expectError(
    'invalid unit',
    owner.rpc('upsert_product', {
      p_payload: { sku: `BAD-UNIT-${stamp}`, name: 'Bad Unit', unit_id: 999999 },
    }),
  )
  await expectError(
    'invalid category',
    owner.rpc('upsert_product', {
      p_payload: {
        sku: `BAD-CAT-${stamp}`,
        name: 'Bad Category',
        unit_id: unitId,
        category_id: 999999,
      },
    }),
  )
  await expectError(
    'missing name',
    owner.rpc('upsert_product', {
      p_payload: { sku: `BAD-NAME-${stamp}`, unit_id: unitId },
    }),
  )
})

await test('catalog RPC writes are audited', async () => {
  const rows = await expectRows(
    'audit read',
    owner.from('audit_logs').select('action_key, entity_id').eq('entity_id', productId),
  )
  assert(
    rows.some((row) => row.action_key === 'product.create'),
    'product.create audit missing',
  )
  assert(
    rows.some((row) => row.action_key === 'product.update'),
    'product.update audit missing',
  )
})

const cashier = await signIn(byRole.cashier)

await test('cashier reads the catalog but not purchase costs', async () => {
  await expectRows('cashier product read', cashier.from('products').select('id, sku').limit(5))
  await expectEmpty('cashier cost read', cashier.from('product_costs').select('product_id'))
})

await test('cashier cannot write products or stock directly', async () => {
  await expectError(
    'cashier product insert',
    cashier.from('products').insert({ sku: `CASH-${stamp}`, name: 'Cashier', unit_id: unitId }),
  )
  await expectError(
    'cashier product update',
    cashier.from('products').update({ name: 'Cashier edit' }).eq('id', productId),
  )
  await expectError(
    'cashier stock update',
    cashier.from('products').update({ stock_on_hand: 0 }).eq('id', productId),
  )
})

await test('cashier cannot call owner RPCs even with owner metadata', async () => {
  await expectError(
    'cashier product RPC',
    cashier.rpc('upsert_product', {
      p_payload: { sku: `CASH-RPC-${stamp}`, name: 'Cashier RPC', unit_id: unitId },
    }),
  )
  await expectError(
    'cashier cost RPC',
    cashier.rpc('set_product_cost', { p_product_id: productId, p_purchase_cost: 1 }),
  )
  await expectError(
    'cashier admin RPC',
    cashier.rpc('admin_upsert_profile', {
      p_user_id: byRole.cashier.id,
      p_full_name: byRole.cashier.full_name,
      p_role: 'owner',
      p_is_active: true,
    }),
  )
  await expectError(
    'cashier feature flag RPC',
    cashier.rpc('set_feature_flag', {
      p_feature_key: 'hardware.thermal_printer',
      p_enabled: true,
      p_public_config: {},
    }),
  )
})

const warehouse = await signIn(byRole.warehouse)

await test('warehouse reads catalog but not costs', async () => {
  const profile = await warehouse
    .from('profiles')
    .select('role, is_active')
    .eq('id', byRole.warehouse.id)
    .single()
  assert(!profile.error, profile.error?.message ?? 'warehouse profile read failed')
  assert(profile.data.role === 'inventory_staff', 'warehouse role is wrong')
  await expectRows('warehouse product read', warehouse.from('products').select('id').limit(5))
  await expectEmpty('warehouse cost read', warehouse.from('product_costs').select('product_id'))
})

await test('warehouse cannot elevate itself or call owner RPCs', async () => {
  await expectError(
    'warehouse self-role update',
    warehouse.from('profiles').update({ role: 'owner' }).eq('id', byRole.warehouse.id),
  )
  await expectError(
    'warehouse admin RPC',
    warehouse.rpc('admin_upsert_profile', {
      p_user_id: byRole.warehouse.id,
      p_full_name: byRole.warehouse.full_name,
      p_role: 'owner',
      p_is_active: true,
    }),
  )
  await expectError(
    'warehouse product RPC',
    warehouse.rpc('upsert_product', {
      p_payload: { sku: `WARE-RPC-${stamp}`, name: 'Warehouse RPC', unit_id: unitId },
    }),
  )
})

const inactive = await signIn(byRole.inactive)

await test('inactive account can authenticate but cannot act', async () => {
  const profile = await inactive
    .from('profiles')
    .select('role, is_active')
    .eq('id', byRole.inactive.id)
    .single()
  assert(!profile.error, profile.error?.message ?? 'inactive profile read failed')
  assert(profile.data.is_active === false, 'inactive profile is active')
  await expectEmpty('inactive product read', inactive.from('products').select('id').limit(5))
  await expectEmpty('inactive cost read', inactive.from('product_costs').select('product_id'))
  await expectError(
    'inactive admin RPC',
    inactive.rpc('admin_upsert_profile', {
      p_user_id: byRole.inactive.id,
      p_full_name: byRole.inactive.full_name,
      p_role: 'cashier',
      p_is_active: true,
    }),
  )
})

await test('invalid credentials are rejected', async () => {
  const bad = clientFor()
  const { error } = await bad.auth.signInWithPassword({
    email: byRole.cashier.email,
    password: `${byRole.cashier.password}-wrong`,
  })
  assert(Boolean(error), 'invalid password sign-in succeeded')
})

await test('owner session refresh and restoration work', async () => {
  const refreshed = await owner.auth.refreshSession()
  assert(!refreshed.error, refreshed.error?.message ?? 'refresh failed')
  assert(refreshed.data.session, 'refresh returned no session')

  const restored = clientFor()
  const set = await restored.auth.setSession({
    access_token: refreshed.data.session.access_token,
    refresh_token: refreshed.data.session.refresh_token,
  })
  assert(!set.error, set.error?.message ?? 'setSession failed')
  const user = await restored.auth.getUser()
  assert(!user.error, user.error?.message ?? 'getUser failed')
  assert(user.data.user?.id === byRole.owner.id, 'restored user is wrong')
})

await test('owner logout clears the session', async () => {
  const { error } = await owner.auth.signOut()
  assert(!error, error?.message ?? 'signOut failed')
  const session = await owner.auth.getSession()
  assert(session.data.session === null, 'session still present after logout')
})

skip('expired access token (requires waiting for JWT TTL or a controlled token)')

console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`)
if (failed > 0) process.exitCode = 1
