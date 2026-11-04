#!/usr/bin/env node
/**
 * Phase 5F §4.3 / §4.7 — read-only readiness check for INVENTORY_STAFF_B.
 *
 * Verifies that a second inventory_staff account exists, can read the opname
 * surface, and is still denied the owner-only surface. It never creates,
 * counts, submits, approves, posts, or cancels anything.
 *
 *   node scripts/opname-staff-b-readiness.mjs
 *
 * Credentials for the new account are read from .tmp/phase5f-staff-b.json
 * (gitignored), never from this file:
 *
 *   { "email": "…", "password": "…" }
 *
 * The owner-only RPC probes use a nil UUID. Every owner-only RPC checks the
 * caller's role before it touches a row, so a staff caller is rejected without
 * any lookup or write. The script also proves the counts did not move.
 */
import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const PREVIEW_REF = 'ptbllrugrjepdhhdkzxn'
const STAFF_B_PATH = '.tmp/phase5f-staff-b.json'
const NIL_UUID = '00000000-0000-0000-0000-000000000000'

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

const makeClient = () =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

async function login(label, credentials) {
  const client = makeClient()
  const { error } = await client.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  })
  if (error) throw new Error(`${label} sign-in failed: ${error.message}`)
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
// Preflight
// --------------------------------------------------------------------------- //

const accounts = JSON.parse(readFileSync('.tmp/phase2b-accounts.json', 'utf8'))
const ownerAccount = accounts.find((account) => account.role === 'owner')
const staffAAccount = accounts.find((account) => account.role === 'warehouse')
assert(ownerAccount, 'owner account missing from .tmp/phase2b-accounts.json')
assert(staffAAccount, 'warehouse account missing from .tmp/phase2b-accounts.json')

const owner = await login('owner', ownerAccount)
const staffA = await login('staff A', staffAAccount)

const staffB = existsSync(STAFF_B_PATH)
  ? await login('staff B', JSON.parse(readFileSync(STAFF_B_PATH, 'utf8')))
  : null

const before = {
  sessions: await countRows(owner, 'stock_opnames'),
  items: await countRows(owner, 'stock_opname_items'),
  movements: await countRows(owner, 'stock_movements'),
  products: await countRows(owner, 'products'),
}

// --------------------------------------------------------------------------- //
// Tests
// --------------------------------------------------------------------------- //

await test('staff B credentials exist and the account can sign in', async () => {
  assert(staffB, `missing ${STAFF_B_PATH}; create INVENTORY_STAFF_B first`)
  const { data, error } = await staffB.auth.getUser()
  assert(!error && data.user, 'staff B session is unreadable')
})

await test('staff B has an active inventory_staff profile', async () => {
  assert(staffB, 'staff B client unavailable')
  const { data, error } = await staffB
    .from('profiles')
    .select('id, full_name, role, is_active')
    .single()
  assert(!error, `profile read failed: ${error?.message}`)
  assert(data.role === 'inventory_staff', `role is ${data.role}, expected inventory_staff`)
  assert(data.is_active === true, 'staff B profile is not active')
  console.log(`      ${data.full_name ?? '(no name)'} — ${data.id}`)
})

await test('two distinct active inventory_staff accounts exist', async () => {
  const { data, error } = await owner
    .from('profiles')
    .select('id, role, is_active')
    .eq('role', 'inventory_staff')
    .eq('is_active', true)
  assert(!error, `profiles read failed: ${error?.message}`)
  assert(data.length >= 2, `only ${data.length} active inventory_staff, expected at least 2`)
  assert(new Set(data.map((row) => row.id)).size === data.length, 'duplicate profile ids')
  console.log(`      ${data.length} active inventory_staff`)
})

await test('staff B may read the opname surface', async () => {
  assert(staffB, 'staff B client unavailable')
  const { data: sessions, error } = await staffB
    .from('stock_opnames')
    .select('id, opname_no, status')
    .limit(1)
  assert(!error, `opname list read failed: ${error?.message}`)
  assert(Array.isArray(sessions), 'opname list did not return rows')

  if (sessions.length === 0) return
  const session = sessions[0]
  const summary = await rpc(staffB, 'get_stock_opname_summary', { p_opname_id: session.id })
  assert(Number(summary.item_count) >= 0, 'summary item_count is missing')
  const page = await rpc(staffB, 'list_stock_opname_items', {
    p_opname_id: session.id,
    p_limit: 1,
    p_offset: 0,
    p_filter: 'all',
    p_search: null,
  })
  assert(Array.isArray(page.items), 'item page is missing')
})

await test('staff B cannot manage users', async () => {
  assert(staffB, 'staff B client unavailable')
  const { data, error } = await staffB.from('profiles').select('id').neq('id', NIL_UUID)
  // RLS limits staff to their own profile row; it must never see everyone.
  assert(!error, `profile list failed: ${error?.message}`)
  assert(data.length <= 1, `staff B can read ${data.length} profiles, expected only its own`)
})

await test('staff B is denied approve, post and cancel', async () => {
  assert(staffB, 'staff B client unavailable')
  await expectRejected(
    staffB,
    'approve_stock_opname',
    { p_opname_id: NIL_UUID },
    'staff B approve',
  )
  await expectRejected(
    staffB,
    'post_stock_opname',
    { p_opname_id: NIL_UUID },
    'staff B post',
  )
  await expectRejected(
    staffB,
    'cancel_stock_opname',
    { p_opname_id: NIL_UUID, p_reason: 'readiness probe' },
    'staff B cancel',
  )
})

await test('staff A and staff B are separate sessions', async () => {
  assert(staffB, 'staff B client unavailable')
  const { data: a } = await staffA.auth.getUser()
  const { data: b } = await staffB.auth.getUser()
  assert(a.user && b.user, 'one of the staff sessions is unreadable')
  assert(a.user.id !== b.user.id, 'staff A and staff B are the same user')
})

await test('the readiness run wrote nothing', async () => {
  const after = {
    sessions: await countRows(owner, 'stock_opnames'),
    items: await countRows(owner, 'stock_opname_items'),
    movements: await countRows(owner, 'stock_movements'),
    products: await countRows(owner, 'products'),
  }
  for (const table of Object.keys(before)) {
    assert(
      after[table] === before[table],
      `${table} changed: ${before[table]} -> ${after[table]}`,
    )
  }
})

// --------------------------------------------------------------------------- //
// Result
// --------------------------------------------------------------------------- //

console.log('')
if (failed > 0) {
  console.error(`${passed} passed, ${failed} failed`)
  for (const failure of failures) console.error(`  - ${failure.name}: ${failure.message}`)
  process.exit(1)
}
console.log(`${passed} passed, 0 failed`)
console.log('READY: staff B verified for Phase 5F.')
