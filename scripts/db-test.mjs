#!/usr/bin/env node
/**
 * Database integration tests for Phase 2.
 *
 * Uses PGlite (PostgreSQL compiled to WASM), so it runs without Docker, a
 * native server or administrator rights. Applies the local Supabase auth shim,
 * every migration in order, then exercises RLS, RPC, constraints and audit
 * behaviour as anon / inactive / cashier / warehouse / owner roles.
 *
 * Run: npm run test:db
 * This is a real PostgreSQL engine, but it is not a hosted Supabase project:
 * PostgREST, GoTrue and multi-session concurrency are not exercised here.
 */
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()

const OWNER = '11111111-1111-4111-8111-111111111111'
const CASHIER = '22222222-2222-4222-8222-222222222222'
const WAREHOUSE = '33333333-3333-4333-8333-333333333333'
const INACTIVE = '44444444-4444-4444-8444-444444444444'
const NO_PROFILE = '55555555-5555-4555-8555-555555555555'
const EXTRA = '66666666-6666-4666-8666-666666666666'
const BOOT = '77777777-7777-4777-8777-777777777777'

const PRODUCT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PRODUCT_NULL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const db = new PGlite({ extensions: { pg_trgm } })
let unitId
let categoryId
let passed = 0
let failed = 0

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function expectError(expectedCode, fn) {
  await db.exec('savepoint expect_error')
  try {
    await fn()
  } catch (error) {
    await db.exec('rollback to savepoint expect_error')
    await db.exec('release savepoint expect_error')
    if (error.code !== expectedCode) {
      throw new Error(`expected SQLSTATE ${expectedCode}, got ${error.code ?? 'none'}: ${error.message}`)
    }
    return
  }
  await db.exec('release savepoint expect_error')
  throw new Error(`expected SQLSTATE ${expectedCode}, but the statement succeeded`)
}

async function asRole(role, userId, fn) {
  await db.exec('begin')
  try {
    if (role) await db.exec(`set local role ${role}`)
    if (userId) {
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
    }
    await fn()
  } finally {
    await db.exec('rollback')
  }
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

async function seed() {
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values
       ($1, 'owner@test.local', '{"full_name":"Owner Uji"}'),
       ($2, 'kasir@test.local', '{"full_name":"Kasir Uji"}'),
       ($3, 'gudang@test.local', '{"full_name":"Gudang Uji"}'),
       ($4, 'nonaktif@test.local', '{"full_name":"Nonaktif Uji"}'),
       ($5, 'tanpa@test.local', '{"full_name":"Tanpa Profil"}')`,
    [OWNER, CASHIER, WAREHOUSE, INACTIVE, NO_PROFILE],
  )

  await db.query(
    `update public.profiles
        set role = 'owner', is_active = true, activated_at = now()
      where id = $1`,
    [OWNER],
  )
  await db.query(
    `update public.profiles
        set role = 'cashier', is_active = true, activated_at = now()
      where id = $1`,
    [CASHIER],
  )
  await db.query(
    `update public.profiles
        set role = 'inventory_staff', is_active = true, activated_at = now()
      where id = $1`,
    [WAREHOUSE],
  )
  await db.query(`delete from public.profiles where id = $1`, [NO_PROFILE])

  const category = await db.query(
    `insert into public.categories (name) values ('Kategori Uji') returning id`,
  )
  categoryId = category.rows[0].id

  const unit = await db.query(`select id from public.units_of_measure where code = 'PCS'`)
  unitId = unit.rows[0].id

  await db.query(
    `insert into public.products
       (id, sku, name, category_id, unit_id, sale_price, stock_on_hand, stock_version)
     values
       ($1, 'TES-001', 'Produk Uji', $3, $4, 5000, 10, 0),
       ($2, 'TES-NULL', 'Produk Tanpa Stok', $3, $4, null, null, 0)`,
    [PRODUCT, PRODUCT_NULL, categoryId, unitId],
  )

  await db.query(
    `insert into public.product_costs (product_id, purchase_cost, updated_by)
     values ($1, 3000, $2)`,
    [PRODUCT, OWNER],
  )
}

async function runTests() {
  await test('TEST 1 — anon cannot read protected data', async () => {
    await asRole('anon', null, async () => {
      await expectError('42501', () => db.query('select count(*) from public.products'))
      await expectError('42501', () => db.query(`select public.upsert_product('{}'::jsonb)`))
    })
  })

  await test('TEST 2 — authenticated without a profile is denied', async () => {
    await asRole('authenticated', NO_PROFILE, async () => {
      const result = await db.query('select count(*)::int as n from public.products')
      assert(result.rows[0].n === 0, 'a profile-less user saw products')
      await expectError('42501', () => db.query(`select public.upsert_product('{}'::jsonb)`))
    })
  })

  await test('TEST 3 — inactive account cannot act but can read its own profile', async () => {
    await asRole('authenticated', INACTIVE, async () => {
      const products = await db.query('select count(*)::int as n from public.products')
      assert(products.rows[0].n === 0, 'inactive account saw products')
      const profiles = await db.query('select count(*)::int as n from public.profiles')
      assert(profiles.rows[0].n === 1, 'inactive account could not read its own profile')
      await expectError('42501', () => db.query(`select public.upsert_product('{}'::jsonb)`))
    })
  })

  await test('TEST 4 — cashier cannot create or edit products directly', async () => {
    await asRole('authenticated', CASHIER, async () => {
      await expectError('42501', () =>
        db.query(`insert into public.products (sku, name, unit_id) values ('CASH-1', 'X', $1)`, [
          unitId,
        ]),
      )
      await expectError('42501', () =>
        db.query(`update public.products set name = 'X' where id = $1`, [PRODUCT]),
      )
    })
  })

  await test('TEST 5 — cashier cannot update stock directly', async () => {
    await asRole('authenticated', CASHIER, async () => {
      await expectError('42501', () =>
        db.query(`update public.products set stock_on_hand = 0 where id = $1`, [PRODUCT]),
      )
    })
  })

  await test('TEST 6 — warehouse cannot assign itself owner', async () => {
    await asRole('authenticated', WAREHOUSE, async () => {
      await expectError('42501', () =>
        db.query(`update public.profiles set role = 'owner' where id = $1`, [WAREHOUSE]),
      )
      await expectError('42501', () =>
        db.query(`select public.admin_upsert_profile($1, 'Gudang Uji', 'owner', true)`, [
          WAREHOUSE,
        ]),
      )
    })
  })

  await test('TEST 7 — owner manages products through RPC without touching stock', async () => {
    await asRole('authenticated', OWNER, async () => {
      const created = await db.query(`select public.upsert_product($1::jsonb) as p`, [
        JSON.stringify({
          sku: 'RPC-NEW-1',
          name: 'Produk RPC',
          category_id: categoryId,
          unit_id: unitId,
          sale_price: 12500,
          stock_on_hand: 999,
          is_active: true,
        }),
      ])
      assert(created.rows[0].p.sku === 'RPC-NEW-1', 'RPC did not return the new product')
      assert(created.rows[0].p.stock_on_hand === null, 'catalog RPC created stock from a payload')
      assert(Number(created.rows[0].p.stock_version) === 0, 'catalog RPC changed stock_version')

      const updated = await db.query(`select public.upsert_product($1::jsonb) as p`, [
        JSON.stringify({
          product_id: PRODUCT,
          sku: 'TES-001',
          name: 'Produk Uji Edit',
          category_id: categoryId,
          unit_id: unitId,
          sale_price: 5000,
          stock_on_hand: 999,
          is_active: true,
        }),
      ])
      assert(updated.rows[0].p.name === 'Produk Uji Edit', 'RPC did not update the name')

      const cost = await db.query(`select public.set_product_cost($1, 4500) as c`, [PRODUCT])
      assert(Number(cost.rows[0].c.purchase_cost) === 4500, 'cost RPC failed')

      await db.exec('reset role')
      const stored = await db.query(
        `select stock_on_hand, stock_version, name from public.products where id = $1`,
        [PRODUCT],
      )
      assert(Number(stored.rows[0].stock_on_hand) === 10, 'catalog RPC changed stock_on_hand')
      assert(Number(stored.rows[0].stock_version) === 0, 'catalog RPC changed stock_version')

      const audit = await db.query(
        `select count(*)::int as n from public.audit_logs
          where action_key = 'product.create' and entity_id = $1`,
        [created.rows[0].p.id],
      )
      assert(audit.rows[0].n === 1, 'product.create was not audited')
    })
  })

  await test('TEST 8 — user_metadata cannot escalate privileges', async () => {
    await db.exec('begin')
    try {
      await db.query(`update auth.users set raw_user_meta_data = '{"role":"owner"}' where id = $1`, [
        CASHIER,
      ])
      await db.exec('set local role authenticated')
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [CASHIER])

      const isOwner = await db.query(`select private.has_role(array['owner']) as ok`)
      assert(isOwner.rows[0].ok === false, 'metadata role escalated authorization')

      const costs = await db.query('select count(*)::int as n from public.product_costs')
      assert(costs.rows[0].n === 0, 'cashier read purchase costs')
    } finally {
      await db.exec('rollback')
    }
  })

  await test('TEST 9 — stock ledger arithmetic is enforced', async () => {
    await db.exec('begin')
    try {
      await expectError('23514', () =>
        db.query(
          `insert into public.stock_movements
             (product_id, movement_type, quantity_delta, quantity_before, quantity_after,
              reason_code, reason_note, actor_id)
           values ($1, 'manual_adjustment', -1, 10, 8, 'input_error', 'uji', $2)`,
          [PRODUCT, OWNER],
        ),
      )

      const valid = await db.query(
        `insert into public.stock_movements
           (product_id, movement_type, quantity_delta, quantity_before, quantity_after,
            reason_code, reason_note, actor_id)
         values ($1, 'manual_adjustment', -1, 10, 9, 'input_error', 'uji', $2)
         returning id`,
        [PRODUCT, OWNER],
      )
      assert(valid.rows.length === 1, 'valid movement was rejected')
    } finally {
      await db.exec('rollback')
    }
  })

  await test('TEST 10 — transactions cannot commit with inconsistent payments', async () => {
    await db.exec('begin')
    const tx = await db.query(
      `insert into public.transactions
         (receipt_no, business_date, cashier_id, subtotal, discount_amount, grand_total)
       values ('SS-20261102-9001', '2026-11-02', $1, 100, 0, 100)
       returning id`,
      [CASHIER],
    )
    await db.query(
      `insert into public.payments
         (transaction_id, method, amount_applied, cash_received, cash_change)
       values ($1, 'cash', 90, 90, 0)`,
      [tx.rows[0].id],
    )

    let commitError
    try {
      await db.exec('commit')
    } catch (error) {
      commitError = error
    }
    if (!commitError) throw new Error('commit succeeded with 90 paid against a 100 total')
    if (commitError.code !== '23514') {
      throw new Error(`expected 23514, got ${commitError.code}: ${commitError.message}`)
    }
    try {
      await db.exec('rollback')
    } catch {
      /* failed COMMIT already ended the transaction */
    }

    await db.exec('begin')
    const ok = await db.query(
      `insert into public.transactions
         (receipt_no, business_date, cashier_id, subtotal, discount_amount, grand_total)
       values ('SS-20261102-9002', '2026-11-02', $1, 100, 0, 100)
       returning id`,
      [CASHIER],
    )
    await db.query(
      `insert into public.payments
         (transaction_id, method, amount_applied, cash_received, cash_change)
       values ($1, 'cash', 100, 100, 0)`,
      [ok.rows[0].id],
    )
    await db.exec('commit')
  })

  await test('TEST 11 — SKU uniqueness ignores case and surrounding spaces', async () => {
    await db.exec('begin')
    try {
      await db.query(`insert into public.products (sku, name, unit_id) values ('Case-Test-1', 'Case', $1)`, [
        unitId,
      ])
      await expectError('23505', () =>
        db.query(`insert into public.products (sku, name, unit_id) values ('case-test-1', 'Case 2', $1)`, [
          unitId,
        ]),
      )
      await expectError('23514', () =>
        db.query(`insert into public.products (sku, name, unit_id) values (' Spaced-SKU ', 'Spaced', $1)`, [
          unitId,
        ]),
      )
    } finally {
      await db.exec('rollback')
    }
  })

  await test('TEST 12 — posted stock opname records cannot be modified', async () => {
    await db.exec('begin')
    try {
      const opname = await db.query(
        `insert into public.stock_opnames
           (opname_no, status, created_by, submitted_at, approved_by, approved_at, posted_by, posted_at)
         values ('OP-TEST-1', 'posted', $1, now(), $1, now(), $1, now())
         returning id`,
        [OWNER],
      )
      await expectError('42501', () =>
        db.query(
          `insert into public.stock_opname_items
             (stock_opname_id, product_id, system_qty_snapshot, stock_version_snapshot,
              physical_qty, reason_code, count_status, counted_by, counted_at)
           values ($1, $2, 10, 0, 8, 'input_error', 'counted', $3, now())`,
          [opname.rows[0].id, PRODUCT, OWNER],
        ),
      )
      await expectError('42501', () =>
        db.query(`update public.stock_opnames set scope_note = 'x' where id = $1`, [
          opname.rows[0].id,
        ]),
      )
    } finally {
      await db.exec('rollback')
    }
  })

  await test('TEST 13 — document numbers are sequential and scope-checked', async () => {
    const first = await db.query(`select private.next_document_number('receipt', '2026-11-02') as n`)
    const second = await db.query(`select private.next_document_number('receipt', '2026-11-02') as n`)
    const third = await db.query(`select private.next_document_number('receipt', '2026-11-02') as n`)
    assert(first.rows[0].n === 'SS-20261102-0001', `unexpected first number ${first.rows[0].n}`)
    assert(second.rows[0].n === 'SS-20261102-0002', `unexpected second number ${second.rows[0].n}`)
    assert(third.rows[0].n === 'SS-20261102-0003', `unexpected third number ${third.rows[0].n}`)
    await db.exec('begin')
    await expectError('22023', () =>
      db.query(`select private.next_document_number('bogus', '2026-11-02')`),
    )
    await db.exec('rollback')
  })

  await test('provisioning creates an inactive cashier profile', async () => {
    await db.exec('begin')
    try {
      await db.query(
        `insert into auth.users (id, email, raw_user_meta_data)
         values ($1, 'baru@test.local', '{"full_name":"Siti Baru"}')`,
        [EXTRA],
      )
      const profile = await db.query(
        `select role, is_active, full_name from public.profiles where id = $1`,
        [EXTRA],
      )
      assert(profile.rows.length === 1, 'profile was not provisioned')
      assert(profile.rows[0].role === 'cashier', 'new profile role is not cashier')
      assert(profile.rows[0].is_active === false, 'new profile was active without approval')
      assert(profile.rows[0].full_name === 'Siti Baru', 'profile name was not copied')

      await db.exec('set local role authenticated')
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [EXTRA])
      await expectError('42501', () => db.query(`select public.upsert_product('{}'::jsonb)`))
    } finally {
      await db.exec('rollback')
    }
  })

  await test('first-owner bootstrap works once and is not client-executable', async () => {
    await db.exec('begin')
    try {
      await db.query(
        `insert into auth.users (id, email, raw_user_meta_data)
         values ($1, 'boot@test.local', '{"full_name":"Boot Owner"}')`,
        [BOOT],
      )
      await db.query(
        `update public.profiles set role = 'cashier', is_active = false where id = $1`,
        [OWNER],
      )

      const booted = await db.query(`select private.bootstrap_owner($1) as p`, [BOOT])
      assert(booted.rows[0].p.role === 'owner', 'bootstrap did not assign owner')
      assert(booted.rows[0].p.is_active === true, 'bootstrap did not activate the owner')

      await expectError('23514', () => db.query(`select private.bootstrap_owner($1)`, [BOOT]))

      const grant = await db.query(
        `select has_function_privilege('authenticated', 'private.bootstrap_owner(uuid)', 'EXECUTE') as allowed`,
      )
      assert(grant.rows[0].allowed === false, 'authenticated can execute bootstrap_owner')
    } finally {
      await db.exec('rollback')
    }
  })

  await test('owner activates users and cannot remove the last owner', async () => {
    await asRole('authenticated', OWNER, async () => {
      const activated = await db.query(
        `select public.admin_upsert_profile($1, 'Nonaktif Uji', 'cashier', true) as p`,
        [INACTIVE],
      )
      assert(activated.rows[0].p.is_active === true, 'owner could not activate a user')

      await expectError('23514', () =>
        db.query(`select public.admin_upsert_profile($1, 'Owner Uji', 'owner', false)`, [OWNER]),
      )

      await db.exec('reset role')
      await db.exec('set local role authenticated')
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [INACTIVE])
      const products = await db.query('select count(*)::int as n from public.products')
      assert(products.rows[0].n >= 1, 'activated user still cannot read products')
    })
  })

  await test('feature flags are owner-managed', async () => {
    await asRole('authenticated', CASHIER, async () => {
      await expectError('42501', () =>
        db.query(`select public.set_feature_flag('hardware.thermal_printer', true, '{}'::jsonb)`),
      )
    })
    await asRole('authenticated', OWNER, async () => {
      const result = await db.query(
        `select public.set_feature_flag('hardware.thermal_printer', true, '{}'::jsonb) as f`,
      )
      assert(result.rows[0].f.enabled === true, 'owner could not update a feature flag')
    })
  })

  await test('purchase costs stay owner-only', async () => {
    await asRole('authenticated', CASHIER, async () => {
      const result = await db.query('select count(*)::int as n from public.product_costs')
      assert(result.rows[0].n === 0, 'cashier saw purchase costs')
    })
    await asRole('authenticated', OWNER, async () => {
      const result = await db.query('select count(*)::int as n from public.product_costs')
      assert(result.rows[0].n === 1, 'owner could not read purchase costs')
    })
  })

  await test('new public tables inherit no API grants', async () => {
    await db.exec('begin')
    try {
      await db.exec('create table public.priv_probe (id int)')
      const result = await db.query(
        `select has_table_privilege('anon', 'public.priv_probe', 'SELECT') as anon,
                has_table_privilege('authenticated', 'public.priv_probe', 'SELECT') as auth`,
      )
      assert(result.rows[0].anon === false, 'anon inherited a default grant')
      assert(result.rows[0].auth === false, 'authenticated inherited a default grant')
    } finally {
      await db.exec('rollback')
    }
  })

  await test('audit log is append-only', async () => {
    await db.exec('begin')
    try {
      const inserted = await db.query(
        `insert into public.audit_logs (action_key, entity_name, entity_id)
         values ('test.audit', 'test', '1') returning id`,
      )
      await expectError('42501', () =>
        db.query(`update public.audit_logs set reason = 'x' where id = $1`, [inserted.rows[0].id]),
      )
      await expectError('42501', () =>
        db.query(`delete from public.audit_logs where id = $1`, [inserted.rows[0].id]),
      )
    } finally {
      await db.exec('rollback')
    }
  })
}

async function main() {
  const bootstrap = await readFile(path.join(ROOT, 'supabase', 'tests', 'local_bootstrap.sql'), 'utf8')
  await db.exec(bootstrap)
  console.log('Applied local Supabase auth shim.')

  const migrationDir = path.join(ROOT, 'supabase', 'migrations')
  const files = (await readdir(migrationDir)).filter((file) => file.endsWith('.sql')).sort()
  if (files.length === 0) throw new Error('No migration files found.')

  for (const file of files) {
    const sql = await readFile(path.join(migrationDir, file), 'utf8')
    try {
      await db.exec(sql)
    } catch (error) {
      error.message = `${file}: ${error.message}`
      throw error
    }
    console.log(`Applied ${file}`)
  }

  await seed()
  await runTests()

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

try {
  await main()
} catch (error) {
  console.error('\nDatabase test run aborted:')
  console.error(error.message ?? error)
  if (error.stack) console.error(error.stack)
  process.exitCode = 1
} finally {
  await db.close().catch(() => {})
}
