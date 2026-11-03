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
import { randomUUID } from 'node:crypto'
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

async function asRoleCommit(role, userId, fn) {
  await db.exec('begin')
  try {
    if (role) await db.exec(`set local role ${role}`)
    if (userId) {
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
    }
    await fn()
    await db.exec('commit')
  } catch (error) {
    await db.exec('rollback').catch(() => {})
    throw error
  }
}

async function saleProduct(sku, options = {}) {
  const { price = 5000, stock = 10, active = true } = options
  const result = await db.query(
    `insert into public.products (sku, name, unit_id, sale_price, stock_on_hand, is_active)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [sku, `Produk ${sku}`, unitId, price, stock, active],
  )
  return result.rows[0].id
}

function cashPayload(productId, quantity, total, overrides = {}) {
  return {
    idempotency_key: randomUUID(),
    business_date: '2026-11-02',
    discount_amount: 0,
    items: [{ product_id: productId, quantity }],
    payments: [{ method: 'cash', amount_applied: total, cash_received: total, cash_change: 0 }],
    ...overrides,
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

      const noPrice = await db.query(`select public.upsert_product($1::jsonb) as p`, [
        JSON.stringify({
          sku: 'RPC-NULL-1',
          name: 'Produk Tanpa Harga',
          unit_id: unitId,
          sale_price: null,
        }),
      ])
      assert(noPrice.rows[0].p.sale_price === null, 'catalog RPC converted a null price to zero')

      await expectError('23505', () =>
        db.query(`select public.upsert_product($1::jsonb)`, [
          JSON.stringify({ sku: 'rpc-new-1', name: 'Duplikat', unit_id: unitId }),
        ]),
      )

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

  await test('owner manages categories through RPC with duplicate protection', async () => {
    await asRole('authenticated', OWNER, async () => {
      const created = await db.query(`select public.upsert_category($1::jsonb) as c`, [
        JSON.stringify({ name: 'Kategori RPC' }),
      ])
      assert(created.rows[0].c.name === 'Kategori RPC', 'category RPC did not create a category')
      assert(created.rows[0].c.is_active === true, 'new category is not active')

      await expectError('23505', () =>
        db.query(`select public.upsert_category($1::jsonb)`, [
          JSON.stringify({ name: '  kategori rpc  ' }),
        ]),
      )

      const updated = await db.query(`select public.upsert_category($1::jsonb) as c`, [
        JSON.stringify({ category_id: created.rows[0].c.id, name: 'Kategori RPC Edit', is_active: false }),
      ])
      assert(updated.rows[0].c.name === 'Kategori RPC Edit', 'category RPC did not rename')
      assert(updated.rows[0].c.is_active === false, 'category RPC did not deactivate')

      const audit = await db.query(
        `select count(*)::int as n from public.audit_logs
          where action_key = 'category.create' and entity_id = $1`,
        [String(created.rows[0].c.id)],
      )
      assert(audit.rows[0].n === 1, 'category.create was not audited')
    })
  })

  await test('cashier cannot mutate categories through RPC', async () => {
    await asRole('authenticated', CASHIER, async () => {
      await expectError('42501', () =>
        db.query(`select public.upsert_category($1::jsonb)`, [
          JSON.stringify({ name: 'Kasir Tidak Boleh' }),
        ]),
      )
    })
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

  const importSha = 'a'.repeat(64)
  let importRunId

  const importRow = (overrides) => ({
    raw_payload: { sumber: 'uji' },
    sku_raw: 'IMP-001',
    name_raw: 'Produk Impor Satu',
    category_raw: 'Kategori Uji',
    unit_raw: 'Pcs ',
    sale_price_raw: '25000',
    purchase_cost_raw: '1000',
    stock_raw: '-3',
    stock_formula: "ifna({'Stock'})",
    normalized_sku: 'IMP-001',
    normalized_name: 'Produk Impor Satu',
    normalized_category: 'Kategori Uji',
    unit_code: 'Pcs ',
    category_id: categoryId,
    sale_price: 25000,
    purchase_cost: 1000,
    stock_source: -3,
    validation_status: 'ready',
    review_status: 'negative_opening_stock',
    issue_codes: ['negative_stock'],
    error_messages: [],
    ...overrides,
  })

  await test('product import staging is owner-only and never public', async () => {
    await asRole('authenticated', CASHIER, async () => {
      await expectError('42501', () =>
        db.query(`select public.begin_product_import($1::jsonb)`, [
          JSON.stringify({ source_filename: 'x.xlsx', source_worksheet: 'PART MASTER', source_sha256: importSha }),
        ]),
      )
      const runs = await db.query('select count(*)::int as n from public.product_import_runs')
      assert(runs.rows[0].n === 0, 'cashier saw import runs')
      const rows = await db.query('select count(*)::int as n from public.product_import_rows')
      assert(rows.rows[0].n === 0, 'cashier saw staged import rows')
    })
    await asRole('anon', null, async () => {
      await expectError('42501', () => db.query('select count(*) from public.product_import_rows'))
    })
  })

  await test('product import run is created once per source checksum', async () => {
    await asRoleCommit('authenticated', OWNER, async () => {
      const first = await db.query(`select public.begin_product_import($1::jsonb) as r`, [
        JSON.stringify({
          source_filename: 'product-master.xlsx',
          source_worksheet: 'PART MASTER',
          source_sha256: importSha,
          source_row_count: 6,
        }),
      ])
      importRunId = first.rows[0].r.id
      assert(first.rows[0].r.status === 'running', 'new run is not running')

      const again = await db.query(`select public.begin_product_import($1::jsonb) as r`, [
        JSON.stringify({
          source_filename: 'product-master.xlsx',
          source_worksheet: 'PART MASTER',
          source_sha256: importSha,
          source_row_count: 6,
        }),
      ])
      assert(again.rows[0].r.id === importRunId, 'a second run was created for the same checksum')

      const count = await db.query('select count(*)::int as n from public.product_import_runs')
      assert(count.rows[0].n === 1, 'duplicate import runs exist')
    })
  })

  await test('staging batches are idempotent and resolve units by code', async () => {
    const batch = [
      importRow({ source_row_number: 901 }),
      importRow({
        source_row_number: 902,
        sku_raw: 'IMP-002',
        normalized_sku: 'IMP-002',
        name_raw: 'Produk Impor Dua',
        normalized_name: 'Produk Impor Dua',
        unit_raw: 'Lusin',
        unit_code: 'LUSIN',
        sale_price_raw: '',
        purchase_cost_raw: '',
        sale_price: null,
        purchase_cost: null,
        stock_raw: '',
        stock_source: null,
        review_status: 'price_missing',
        issue_codes: ['stock_unknown', 'sale_price_missing', 'purchase_cost_missing'],
      }),
      importRow({
        source_row_number: 903,
        sku_raw: 'IMP-003',
        normalized_sku: 'IMP-003',
        name_raw: 'Produk Review',
        normalized_name: 'Produk Review',
        validation_status: 'review',
        review_status: 'review_required',
        issue_codes: ['stock_unknown', 'duplicate_name'],
      }),
      importRow({
        source_row_number: 904,
        sku_raw: '',
        normalized_sku: '',
        name_raw: '',
        normalized_name: '',
        validation_status: 'rejected',
        review_status: 'review_required',
        issue_codes: [],
        error_messages: ['SKU_REQUIRED: SKU kosong.'],
      }),
      importRow({
        source_row_number: 905,
        sku_raw: 'tes-001',
        normalized_sku: 'TES-001',
        name_raw: 'Duplikat SKU Lama',
        normalized_name: 'Duplikat SKU Lama',
      }),
      importRow({
        source_row_number: 906,
        sku_raw: 'IMP-FAIL',
        normalized_sku: 'IMP-FAIL',
        name_raw: 'X'.repeat(201),
        normalized_name: 'X'.repeat(201),
      }),
    ]

    await asRoleCommit('authenticated', OWNER, async () => {
      const first = await db.query(`select public.stage_product_import_rows($1, $2::jsonb) as r`, [
        importRunId,
        JSON.stringify(batch),
      ])
      assert(first.rows[0].r.staged === 6, `expected 6 staged rows, got ${first.rows[0].r.staged}`)

      const again = await db.query(`select public.stage_product_import_rows($1, $2::jsonb) as r`, [
        importRunId,
        JSON.stringify(batch),
      ])
      assert(again.rows[0].r.staged === 6, 're-staging did not update the same six rows')

      const stored = await db.query(
        `select count(*)::int as n,
                count(*) filter (where unit_id is not null)::int as with_unit
           from public.product_import_rows where run_id = $1`,
        [importRunId],
      )
      assert(stored.rows[0].n === 6, 'staging did not stay at six rows')
      assert(stored.rows[0].with_unit === 6, 'unit code was not resolved for every row')

      const unit = await db.query(
        `select u.code from public.product_import_rows r
           join public.units_of_measure u on u.id = r.unit_id
          where r.run_id = $1 and r.source_row_number = 901`,
        [importRunId],
      )
      assert(unit.rows[0].code === 'PCS', 'trailing space in the unit was not normalized')
    })
  })

  await test('importing a ready row creates a product with NULL stock and issues', async () => {
    await asRoleCommit('authenticated', OWNER, async () => {
      const result = await db.query(
        `select public.import_product_import_row($1, 901) as r`,
        [importRunId],
      )
      assert(result.rows[0].r.status === 'imported', 'row 901 was not imported')
      assert(result.rows[0].r.already_imported === false, 'first import reported already_imported')

      const product = await db.query(
        `select id, sku, name, sale_price, stock_on_hand, stock_version, import_review_status
           from public.products where sku_normalized = 'IMP-001'`,
      )
      assert(product.rows.length === 1, 'imported product is missing')
      const row = product.rows[0]
      assert(row.sku === 'IMP-001', `unexpected SKU ${row.sku}`)
      assert(row.stock_on_hand === null, 'import wrote stock_on_hand')
      assert(Number(row.stock_version) === 0, 'import changed stock_version')
      assert(Number(row.sale_price) === 25000, 'sale price was not stored')
      assert(row.import_review_status === 'negative_opening_stock', 'review status was not stored')

      const cost = await db.query(
        `select purchase_cost from public.product_costs where product_id = $1`,
        [row.id],
      )
      assert(cost.rows.length === 1 && Number(cost.rows[0].purchase_cost) === 1000, 'cost was not stored')

      const issues = await db.query(
        `select issue_code from public.product_data_issues where product_id = $1 order by issue_code`,
        [row.id],
      )
      assert(
        issues.rows.map((item) => item.issue_code).join(',') === 'negative_stock',
        `unexpected issues ${issues.rows.map((item) => item.issue_code).join(',')}`,
      )

      const movements = await db.query(
        `select count(*)::int as n from public.stock_movements where product_id = $1`,
        [row.id],
      )
      assert(movements.rows[0].n === 0, 'import created a stock movement')

      const audit = await db.query(
        `select count(*)::int as n from public.audit_logs
          where action_key = 'product.import' and entity_id = $1`,
        [row.id],
      )
      assert(audit.rows[0].n === 1, 'product.import was not audited')
    })
  })

  await test('importing the same row twice is idempotent', async () => {
    await asRoleCommit('authenticated', OWNER, async () => {
      const again = await db.query(`select public.import_product_import_row($1, 901) as r`, [importRunId])
      assert(again.rows[0].r.already_imported === true, 'second import created work again')
      const count = await db.query(`select count(*)::int as n from public.products where sku_normalized = 'IMP-001'`)
      assert(count.rows[0].n === 1, 'idempotent import duplicated the product')
    })
  })

  await test('review and rejected rows cannot be imported', async () => {
    await asRoleCommit('authenticated', OWNER, async () => {
      await expectError('22023', () => db.query(`select public.import_product_import_row($1, 903)`, [importRunId]))
      await expectError('22023', () => db.query(`select public.import_product_import_row($1, 904)`, [importRunId]))
    })
  })

  await test('an existing SKU is rejected without overwriting the product', async () => {
    await asRoleCommit('authenticated', OWNER, async () => {
      const result = await db.query(`select public.import_product_import_row($1, 905) as r`, [importRunId])
      assert(result.rows[0].r.status === 'rejected', 'existing SKU was not rejected')
      const product = await db.query(`select name from public.products where sku_normalized = 'TES-001'`)
      assert(product.rows[0].name === 'Produk Uji', 'an existing product was overwritten')
      const staged = await db.query(
        `select validation_status from public.product_import_rows where run_id = $1 and source_row_number = 905`,
        [importRunId],
      )
      assert(staged.rows[0].validation_status === 'rejected', 'staged row was not marked rejected')
    })
  })

  await test('a failed row rolls back its product and can be retried', async () => {
    await asRoleCommit('authenticated', OWNER, async () => {
      const failed = await db.query(`select public.import_product_import_row($1, 906) as r`, [importRunId])
      assert(failed.rows[0].r.status === 'failed', 'invalid product name was not reported as failed')
      const product = await db.query(`select count(*)::int as n from public.products where sku_normalized = 'IMP-FAIL'`)
      assert(product.rows[0].n === 0, 'a failed row left a partial product behind')

      const retry = await db.query(`select public.stage_product_import_rows($1, $2::jsonb) as r`, [
        importRunId,
        JSON.stringify([
          importRow({
            source_row_number: 906,
            sku_raw: 'IMP-FAIL',
            normalized_sku: 'IMP-FAIL',
            name_raw: 'Produk Impor Retry',
            normalized_name: 'Produk Impor Retry',
            stock_raw: '',
            stock_source: null,
            review_status: 'stock_unknown',
            issue_codes: ['stock_unknown'],
          }),
        ]),
      ])
      assert(retry.rows[0].r.staged === 1, 'retry row was not re-staged')

      const imported = await db.query(`select public.import_product_import_row($1, 906) as r`, [importRunId])
      assert(imported.rows[0].r.status === 'imported', 'retry did not import the row')
      const exists = await db.query(`select count(*)::int as n from public.products where sku_normalized = 'IMP-FAIL'`)
      assert(exists.rows[0].n === 1, 'retry product is missing')
    })
  })

  await test('a partial run cannot be completed and a failed run resumes', async () => {
    await asRoleCommit('authenticated', OWNER, async () => {
      await expectError('23514', () =>
        db.query(`select public.finish_product_import($1, 'completed')`, [importRunId]),
      )
      const failed = await db.query(`select public.finish_product_import($1, 'failed') as r`, [importRunId])
      assert(failed.rows[0].r.status === 'failed', 'run was not closed as failed')

      const resumed = await db.query(`select public.begin_product_import($1::jsonb) as r`, [
        JSON.stringify({
          source_filename: 'product-master.xlsx',
          source_worksheet: 'PART MASTER',
          source_sha256: importSha,
          source_row_count: 6,
        }),
      ])
      assert(resumed.rows[0].r.id === importRunId, 'resume created a different run')
      assert(resumed.rows[0].r.status === 'running', 'resumed run is not running')
    })
  })

  await test('the import leaves operational stock untouched', async () => {
    await asRoleCommit('authenticated', OWNER, async () => {
      const missingPrice = await db.query(`select public.import_product_import_row($1, 902) as r`, [importRunId])
      assert(missingPrice.rows[0].r.status === 'imported', 'row 902 was not imported')

      const imported = await db.query(
        `select stock_on_hand, stock_version from public.products where sku_normalized in ('IMP-001', 'IMP-002', 'IMP-FAIL')`,
      )
      assert(imported.rows.length === 3, 'expected three imported products')
      for (const row of imported.rows) {
        assert(row.stock_on_hand === null, 'an imported product received stock')
        assert(Number(row.stock_version) === 0, 'an imported product received a stock version')
      }
      const withStock = await db.query('select count(*)::int as n from public.products where stock_on_hand is not null')
      assert(withStock.rows[0].n === 1, 'import changed the stock of unrelated products')
      const movements = await db.query('select count(*)::int as n from public.stock_movements')
      assert(movements.rows[0].n === 0, 'import created stock movements')

      const finished = await db.query(`select public.finish_product_import($1, 'completed') as r`, [importRunId])
      const run = finished.rows[0].r
      assert(run.status === 'completed', 'run was not completed')
      assert(run.total_rows === 6, `unexpected total_rows ${run.total_rows}`)
      assert(run.imported_rows === 3, `unexpected imported_rows ${run.imported_rows}`)
      assert(run.review_rows === 1, `unexpected review_rows ${run.review_rows}`)
      assert(run.rejected_rows === 2, `unexpected rejected_rows ${run.rejected_rows}`)

      await expectError('23505', () =>
        db.query(`select public.begin_product_import($1::jsonb)`, [
          JSON.stringify({
            source_filename: 'product-master.xlsx',
            source_worksheet: 'PART MASTER',
            source_sha256: importSha,
            source_row_count: 6,
          }),
        ]),
      )
    })
  })

  await test('cashier completes a sale with database price and stock', async () => {
    const productId = await saleProduct('SALE-001', { stock: 10, price: 5000 })
    const key = randomUUID()
    const payload = cashPayload(productId, 2, 10000, { idempotency_key: key })
    payload.payments = [{ method: 'cash', amount_applied: 10000, cash_received: 20000, cash_change: 10000 }]

    let sale
    await asRoleCommit('authenticated', CASHIER, async () => {
      const result = await db.query('select public.complete_sale($1::jsonb) as r', [JSON.stringify(payload)])
      sale = result.rows[0].r
    })

    assert(sale.status === 'completed', 'sale was not completed')
    assert(/^SS-20261102-[0-9]{4}$/.test(sale.receipt_no), `unexpected receipt ${sale.receipt_no}`)
    assert(Number(sale.subtotal) === 10000, 'subtotal is wrong')
    assert(Number(sale.grand_total) === 10000, 'grand total is wrong')
    assert(sale.already_processed === false, 'first sale reported already_processed')

    const product = await db.query('select stock_on_hand, stock_version from public.products where id = $1', [productId])
    assert(Number(product.rows[0].stock_on_hand) === 8, 'stock was not decremented')
    assert(Number(product.rows[0].stock_version) === 1, 'stock_version was not incremented')

    const item = await db.query(
      `select sku_snapshot, product_name_snapshot, unit_label_snapshot, quantity, unit_price,
              line_subtotal, line_discount_amount, line_total
         from public.transaction_items where transaction_id = $1`,
      [sale.transaction_id],
    )
    assert(item.rows.length === 1, 'item snapshot is missing')
    assert(item.rows[0].sku_snapshot === 'SALE-001', 'SKU snapshot is wrong')
    assert(item.rows[0].unit_label_snapshot === 'Pcs', 'unit label snapshot is wrong')
    assert(Number(item.rows[0].quantity) === 2, 'quantity snapshot is wrong')
    assert(Number(item.rows[0].unit_price) === 5000, 'price was not taken from the database')
    assert(Number(item.rows[0].line_subtotal) === 10000, 'line subtotal is wrong')
    assert(Number(item.rows[0].line_total) === 10000, 'line total is wrong')
    assert(Number(item.rows[0].line_discount_amount) === 0, 'line discount is not zero')

    const movement = await db.query(
      `select movement_type, quantity_delta, quantity_before, quantity_after, actor_id, idempotency_key
         from public.stock_movements where transaction_id = $1`,
      [sale.transaction_id],
    )
    assert(movement.rows.length === 1, 'sale_out movement is missing')
    assert(movement.rows[0].movement_type === 'sale_out', 'movement type is wrong')
    assert(Number(movement.rows[0].quantity_delta) === -2, 'movement delta is wrong')
    assert(Number(movement.rows[0].quantity_before) === 10, 'quantity_before is wrong')
    assert(Number(movement.rows[0].quantity_after) === 8, 'quantity_after is wrong')
    assert(movement.rows[0].actor_id === CASHIER, 'movement actor is not the cashier')
    assert(movement.rows[0].idempotency_key, 'movement idempotency key is missing')

    const payment = await db.query(
      'select method, amount_applied, cash_received, cash_change, payment_status from public.payments where transaction_id = $1',
      [sale.transaction_id],
    )
    assert(payment.rows[0].payment_status === 'confirmed', 'payment is not confirmed')
    assert(Number(payment.rows[0].cash_change) === 10000, 'cash change is wrong')

    const audit = await db.query(
      `select count(*)::int as n from public.audit_logs
        where action_key = 'sale.complete' and entity_id = $1`,
      [sale.transaction_id],
    )
    assert(audit.rows[0].n === 1, 'sale.complete was not audited')
  })

  await test('the same idempotency key returns the same sale', async () => {
    const productId = await saleProduct('SALE-002', { stock: 4, price: 5000 })
    const key = randomUUID()
    const payload = cashPayload(productId, 1, 5000, { idempotency_key: key })

    let first
    await asRoleCommit('authenticated', CASHIER, async () => {
      const result = await db.query('select public.complete_sale($1::jsonb) as r', [JSON.stringify(payload)])
      first = result.rows[0].r
    })

    let second
    await asRoleCommit('authenticated', CASHIER, async () => {
      const result = await db.query('select public.complete_sale($1::jsonb) as r', [JSON.stringify(payload)])
      second = result.rows[0].r
    })

    assert(second.transaction_id === first.transaction_id, 'retry created a different sale')
    assert(second.receipt_no === first.receipt_no, 'retry returned a different receipt')
    assert(second.already_processed === true, 'retry was not reported as idempotent')

    const stock = await db.query('select stock_on_hand from public.products where id = $1', [productId])
    assert(Number(stock.rows[0].stock_on_hand) === 3, 'retry decremented stock twice')
    const tx = await db.query('select count(*)::int as n from public.transactions where idempotency_key = $1', [key])
    assert(tx.rows[0].n === 1, 'retry created a duplicate transaction')
    const movements = await db.query('select count(*)::int as n from public.stock_movements where transaction_id = $1', [first.transaction_id])
    assert(movements.rows[0].n === 1, 'retry created a duplicate movement')
    const payments = await db.query('select count(*)::int as n from public.payments where transaction_id = $1', [first.transaction_id])
    assert(payments.rows[0].n === 1, 'retry created a duplicate payment')
  })

  await test('reusing a key with a different cart is rejected', async () => {
    const productId = await saleProduct('SALE-003', { stock: 5, price: 5000 })
    const key = randomUUID()
    const first = cashPayload(productId, 1, 5000, { idempotency_key: key })

    await asRoleCommit('authenticated', CASHIER, async () => {
      await db.query('select public.complete_sale($1::jsonb)', [JSON.stringify(first)])
    })

    const changed = cashPayload(productId, 2, 10000, { idempotency_key: key })
    await asRoleCommit('authenticated', CASHIER, async () => {
      await expectError('22023', () =>
        db.query('select public.complete_sale($1::jsonb)', [JSON.stringify(changed)]),
      )
    })

    const stock = await db.query('select stock_on_hand from public.products where id = $1', [productId])
    assert(Number(stock.rows[0].stock_on_hand) === 4, 'rejected reuse changed stock')
    const tx = await db.query('select count(*)::int as n from public.transactions where idempotency_key = $1', [key])
    assert(tx.rows[0].n === 1, 'rejected reuse created another transaction')
  })

  await test('checkout rejects malformed carts and discounts', async () => {
    const productId = await saleProduct('SALE-004', { stock: 5, price: 5000 })
    const base = cashPayload(productId, 1, 5000)

    await asRoleCommit('authenticated', CASHIER, async () => {
      await expectError('22023', () =>
        db.query('select public.complete_sale($1::jsonb)', [JSON.stringify({ ...base, items: [] })]),
      )
      await expectError('22023', () =>
        db.query('select public.complete_sale($1::jsonb)', [
          JSON.stringify({ ...base, items: [{ product_id: productId, quantity: 0 }] }),
        ]),
      )
      await expectError('22023', () =>
        db.query('select public.complete_sale($1::jsonb)', [
          JSON.stringify({ ...base, items: [{ product_id: productId, quantity: '1.2345' }] }),
        ]),
      )
      await expectError('22023', () =>
        db.query('select public.complete_sale($1::jsonb)', [
          JSON.stringify({
            ...base,
            items: [
              { product_id: productId, quantity: 1 },
              { product_id: productId, quantity: 1 },
            ],
            payments: [{ method: 'cash', amount_applied: 10000, cash_received: 10000, cash_change: 0 }],
          }),
        ]),
      )
      await expectError('22023', () =>
        db.query('select public.complete_sale($1::jsonb)', [JSON.stringify({ ...base, payments: [] })]),
      )
      await expectError('22023', () =>
        db.query('select public.complete_sale($1::jsonb)', [
          JSON.stringify({ ...base, payments: [{ method: 'transfer', amount_applied: 5000 }] }),
        ]),
      )
      await expectError('22023', () =>
        db.query('select public.complete_sale($1::jsonb)', [JSON.stringify({ ...base, discount_amount: 100 })]),
      )
      await expectError('22023', () =>
        db.query('select public.complete_sale($1::jsonb)', [JSON.stringify({ ...base, discount_amount: -1 })]),
      )
      await expectError('22023', () => {
        const { business_date: _ignored, ...withoutDate } = base
        return db.query('select public.complete_sale($1::jsonb)', [JSON.stringify(withoutDate)])
      })
      await expectError('P0002', () =>
        db.query('select public.complete_sale($1::jsonb)', [
          JSON.stringify({ ...base, items: [{ product_id: randomUUID(), quantity: 1 }] }),
        ]),
      )
    })

    const stock = await db.query('select stock_on_hand from public.products where id = $1', [productId])
    assert(Number(stock.rows[0].stock_on_hand) === 5, 'rejected carts changed stock')
  })

  await test('unsellable products and insufficient stock are rejected', async () => {
    const noStock = await saleProduct('SALE-005A', { stock: null, price: 5000 })
    const noPrice = await saleProduct('SALE-005B', { stock: 5, price: null })
    const inactive = await saleProduct('SALE-005C', { stock: 5, price: 5000, active: false })
    const lowStock = await saleProduct('SALE-005D', { stock: 1, price: 5000 })

    await asRoleCommit('authenticated', CASHIER, async () => {
      await expectError('22023', () =>
        db.query('select public.complete_sale($1::jsonb)', [JSON.stringify(cashPayload(noStock, 1, 5000))]),
      )
      await expectError('22023', () =>
        db.query('select public.complete_sale($1::jsonb)', [JSON.stringify(cashPayload(noPrice, 1, 5000))]),
      )
      await expectError('22023', () =>
        db.query('select public.complete_sale($1::jsonb)', [JSON.stringify(cashPayload(inactive, 1, 5000))]),
      )
      await expectError('22023', () =>
        db.query('select public.complete_sale($1::jsonb)', [JSON.stringify(cashPayload(lowStock, 2, 10000))]),
      )
    })

    const stock = await db.query('select stock_on_hand, stock_version from public.products where id = $1', [lowStock])
    assert(Number(stock.rows[0].stock_on_hand) === 1, 'failed sale changed stock')
    assert(Number(stock.rows[0].stock_version) === 0, 'failed sale changed stock_version')
    const movements = await db.query('select count(*)::int as n from public.stock_movements where product_id = $1', [lowStock])
    assert(movements.rows[0].n === 0, 'failed sale wrote a movement')
  })

  await test('payment arithmetic, cash change and QRIS are enforced', async () => {
    const cashProduct = await saleProduct('SALE-006A', { stock: 5, price: 5000 })
    const qrisProduct = await saleProduct('SALE-006B', { stock: 5, price: 5000 })
    const splitProduct = await saleProduct('SALE-006C', { stock: 5, price: 5000 })

    await asRoleCommit('authenticated', CASHIER, async () => {
      await expectError('23514', () =>
        db.query('select public.complete_sale($1::jsonb)', [
          JSON.stringify(cashPayload(cashProduct, 1, 5000, {
            payments: [{ method: 'cash', amount_applied: 4000, cash_received: 4000, cash_change: 0 }],
          })),
        ]),
      )
      await expectError('22023', () =>
        db.query('select public.complete_sale($1::jsonb)', [
          JSON.stringify(cashPayload(cashProduct, 1, 5000, {
            payments: [{ method: 'cash', amount_applied: 5000, cash_received: 10000, cash_change: 0 }],
          })),
        ]),
      )
      await expectError('22023', () =>
        db.query('select public.complete_sale($1::jsonb)', [
          JSON.stringify(cashPayload(qrisProduct, 1, 5000, {
            payments: [{ method: 'qris', amount_applied: 5000, cash_received: 5000, cash_change: 0 }],
          })),
        ]),
      )

      const qris = await db.query('select public.complete_sale($1::jsonb) as r', [
        JSON.stringify(cashPayload(qrisProduct, 1, 5000, {
          payments: [{ method: 'qris', amount_applied: 5000 }],
        })),
      ])
      assert(qris.rows[0].r.status === 'completed', 'QRIS sale was rejected')

      const split = await db.query('select public.complete_sale($1::jsonb) as r', [
        JSON.stringify(cashPayload(splitProduct, 1, 5000, {
          payments: [
            { method: 'cash', amount_applied: 2000, cash_received: 2000, cash_change: 0 },
            { method: 'qris', amount_applied: 3000 },
          ],
        })),
      ])
      assert(split.rows[0].r.status === 'completed', 'split payment was rejected')
    })

    const qrisPayment = await db.query(
      `select p.method, p.cash_received, p.cash_change from public.payments p
        join public.transactions t on t.id = p.transaction_id
       where t.business_date = '2026-11-02' and p.method = 'qris' order by p.created_at desc limit 1`,
    )
    assert(qrisPayment.rows.length === 1, 'QRIS payment row is missing')
    assert(qrisPayment.rows[0].cash_received === null, 'QRIS payment stored cash_received')
    assert(Number(qrisPayment.rows[0].cash_change) === 0, 'QRIS payment stored cash_change')

    const cashStock = await db.query('select stock_on_hand from public.products where id = $1', [cashProduct])
    assert(Number(cashStock.rows[0].stock_on_hand) === 5, 'unbalanced sale changed stock')
  })

  await test('only active owners and cashiers can complete sales', async () => {
    const productId = await saleProduct('SALE-007', { stock: 10, price: 5000 })

    await asRoleCommit('authenticated', WAREHOUSE, async () => {
      await expectError('42501', () =>
        db.query('select public.complete_sale($1::jsonb)', [JSON.stringify(cashPayload(productId, 1, 5000))]),
      )
    })
    await asRoleCommit('authenticated', INACTIVE, async () => {
      await expectError('42501', () =>
        db.query('select public.complete_sale($1::jsonb)', [JSON.stringify(cashPayload(productId, 1, 5000))]),
      )
    })
    await asRoleCommit('anon', null, async () => {
      await expectError('42501', () =>
        db.query('select public.complete_sale($1::jsonb)', [JSON.stringify(cashPayload(productId, 1, 5000))]),
      )
    })

    await asRoleCommit('authenticated', OWNER, async () => {
      const result = await db.query('select public.complete_sale($1::jsonb) as r', [
        JSON.stringify(cashPayload(productId, 1, 5000)),
      ])
      assert(result.rows[0].r.status === 'completed', 'owner could not complete a sale')
    })
  })

  await test('owner void restores stock exactly once', async () => {
    const productId = await saleProduct('SALE-008', { stock: 10, price: 5000 })
    let sale
    await asRoleCommit('authenticated', OWNER, async () => {
      const result = await db.query('select public.complete_sale($1::jsonb) as r', [
        JSON.stringify(cashPayload(productId, 3, 15000)),
      ])
      sale = result.rows[0].r
    })

    const afterSale = await db.query('select stock_on_hand from public.products where id = $1', [productId])
    assert(Number(afterSale.rows[0].stock_on_hand) === 7, 'sale did not decrement stock')

    await asRoleCommit('authenticated', CASHIER, async () => {
      await expectError('42501', () =>
        db.query('select public.void_sale($1, $2)', [sale.transaction_id, 'Kasir tidak boleh']),
      )
    })
    await asRoleCommit('authenticated', OWNER, async () => {
      await expectError('22023', () =>
        db.query('select public.void_sale($1, $2)', [sale.transaction_id, '   ']),
      )
    })

    let voided
    await asRoleCommit('authenticated', OWNER, async () => {
      const result = await db.query('select public.void_sale($1, $2) as r', [
        sale.transaction_id,
        'Salah input kasir',
      ])
      voided = result.rows[0].r
    })
    assert(voided.status === 'voided', 'transaction was not voided')
    assert(voided.already_processed === false, 'first void reported already_processed')
    assert(voided.restored_items === 1, 'void did not restore the sold item')

    const restored = await db.query('select stock_on_hand, stock_version from public.products where id = $1', [productId])
    assert(Number(restored.rows[0].stock_on_hand) === 10, 'void did not restore stock')
    assert(Number(restored.rows[0].stock_version) === 2, 'void did not bump stock_version')

    const reversals = await db.query(
      `select quantity_delta, actor_id from public.stock_movements
        where transaction_id = $1 and movement_type = 'void_reversal'`,
      [sale.transaction_id],
    )
    assert(reversals.rows.length === 1, 'void_reversal was not written exactly once')
    assert(Number(reversals.rows[0].quantity_delta) === 3, 'void_reversal delta is wrong')
    assert(reversals.rows[0].actor_id === OWNER, 'void_reversal actor is not the owner')

    let again
    await asRoleCommit('authenticated', OWNER, async () => {
      const result = await db.query('select public.void_sale($1, $2) as r', [
        sale.transaction_id,
        'Salah input kasir',
      ])
      again = result.rows[0].r
    })
    assert(again.already_processed === true, 'second void was not idempotent')
    assert(again.restored_items === 0, 'second void restored stock again')

    const stockAfter = await db.query('select stock_on_hand from public.products where id = $1', [productId])
    assert(Number(stockAfter.rows[0].stock_on_hand) === 10, 'second void changed stock')
    const reversalCount = await db.query(
      `select count(*)::int as n from public.stock_movements
        where transaction_id = $1 and movement_type = 'void_reversal'`,
      [sale.transaction_id],
    )
    assert(reversalCount.rows[0].n === 1, 'duplicate void_reversal exists')

    const tx = await db.query(
      'select status, voided_by, void_reason from public.transactions where id = $1',
      [sale.transaction_id],
    )
    assert(tx.rows[0].status === 'voided', 'transaction status is not voided')
    assert(tx.rows[0].voided_by === OWNER, 'voided_by is wrong')
    assert(tx.rows[0].void_reason === 'Salah input kasir', 'void_reason is wrong')

    const items = await db.query('select count(*)::int as n from public.transaction_items where transaction_id = $1', [sale.transaction_id])
    assert(items.rows[0].n === 1, 'void deleted transaction items')
    const payments = await db.query('select count(*)::int as n from public.payments where transaction_id = $1', [sale.transaction_id])
    assert(payments.rows[0].n === 1, 'void deleted payment history')
    const audit = await db.query(
      `select count(*)::int as n from public.audit_logs
        where action_key = 'sale.void' and entity_id = $1`,
      [sale.transaction_id],
    )
    assert(audit.rows[0].n === 1, 'sale.void was not audited')
  })

  await test('a second sale cannot oversell remaining stock', async () => {
    const productId = await saleProduct('SALE-009', { stock: 1, price: 1000 })
    let first
    await asRoleCommit('authenticated', CASHIER, async () => {
      const result = await db.query('select public.complete_sale($1::jsonb) as r', [
        JSON.stringify(cashPayload(productId, 1, 1000)),
      ])
      first = result.rows[0].r
    })

    const secondPayload = cashPayload(productId, 1, 1000)
    await asRoleCommit('authenticated', CASHIER, async () => {
      await expectError('22023', () =>
        db.query('select public.complete_sale($1::jsonb)', [JSON.stringify(secondPayload)]),
      )
    })

    const stock = await db.query('select stock_on_hand from public.products where id = $1', [productId])
    assert(Number(stock.rows[0].stock_on_hand) === 0, 'stock is not zero after the only successful sale')
    const movements = await db.query(
      `select count(*)::int as n from public.stock_movements
        where transaction_id = $1 and movement_type = 'sale_out'`,
      [first.transaction_id],
    )
    assert(movements.rows[0].n === 1, 'unexpected number of sale_out movements')
    const secondTx = await db.query('select count(*)::int as n from public.transactions where idempotency_key = $1', [secondPayload.idempotency_key])
    assert(secondTx.rows[0].n === 0, 'the rejected sale created a transaction')
  })

  await test('receipt numbers stay unique and sequential per business date', async () => {
    const productId = await saleProduct('SALE-010', { stock: 5, price: 2000 })
    const receipts = []
    await asRoleCommit('authenticated', CASHIER, async () => {
      for (let index = 0; index < 2; index += 1) {
        const result = await db.query('select public.complete_sale($1::jsonb) as r', [
          JSON.stringify(cashPayload(productId, 1, 2000)),
        ])
        receipts.push(result.rows[0].r.receipt_no)
      }
    })

    assert(receipts[0] !== receipts[1], 'two sales received the same receipt number')
    assert(/^SS-20261102-[0-9]{4}$/.test(receipts[0]), `unexpected receipt ${receipts[0]}`)
    const firstSeq = Number(receipts[0].slice(-4))
    const secondSeq = Number(receipts[1].slice(-4))
    assert(secondSeq === firstSeq + 1, 'receipt sequence did not increment by one')
  })
}

// ============================================================================
// Phase 5A — inventory engine (stock opname / opening balance)
// ============================================================================

async function opnameProduct(sku, options = {}) {
  const { stock = 10, version = 0, price = 5000, active = true } = options
  const result = await db.query(
    `insert into public.products
       (sku, name, unit_id, sale_price, stock_on_hand, stock_version, is_active)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [sku, `Produk ${sku}`, unitId, price, stock, version, active],
  )
  return result.rows[0].id
}

async function rpcAs(role, userId, sql, params = []) {
  let value
  await asRoleCommit(role, userId, async () => {
    const result = await db.query(sql, params)
    value = result.rows[0].r
  })
  return value
}

async function expectRpcError(code, role, userId, sql, params = []) {
  await asRole(role, userId, async () => {
    await expectError(code, () => db.query(sql, params))
  })
}

const createOpname = (payload, role = 'authenticated', userId = OWNER) =>
  rpcAs(role, userId, 'select public.create_stock_opname($1::jsonb) as r', [JSON.stringify(payload)])

const countItem = (itemId, qty, reason, note, role = 'authenticated', userId = OWNER) =>
  rpcAs(role, userId, 'select public.record_stock_opname_count($1,$2,$3,$4) as r', [
    itemId,
    qty,
    reason,
    note,
  ])

async function opnameItem(opnameId, productId) {
  const result = await db.query(
    `select id, count_status from public.stock_opname_items
      where stock_opname_id = $1 and product_id = $2`,
    [opnameId, productId],
  )
  return result.rows[0]
}

async function productState(productId) {
  const result = await db.query(
    `select stock_on_hand, stock_version from public.products where id = $1`,
    [productId],
  )
  return result.rows[0]
}

async function runOpnameTests() {
  // ===== GROUP A — AUTHORIZATION =====

  await test('A1 — anonymous callers cannot reach any opname RPC', async () => {
    await expectRpcError('42501', 'anon', null, 'select public.create_stock_opname($1::jsonb)', [
      JSON.stringify({}),
    ])
    await expectRpcError('42501', 'anon', null, 'select public.post_stock_opname($1)', [PRODUCT])
    await expectRpcError('42501', 'anon', null, 'select public.cancel_stock_opname($1,$2)', [
      PRODUCT,
      'x',
    ])
  })

  await test('A2 — inactive and cashier accounts are rejected', async () => {
    await expectRpcError('42501', 'authenticated', INACTIVE, 'select public.create_stock_opname($1::jsonb)', [
      JSON.stringify({}),
    ])
    await expectRpcError('42501', 'authenticated', CASHIER, 'select public.create_stock_opname($1::jsonb)', [
      JSON.stringify({}),
    ])
    await expectRpcError('42501', 'authenticated', NO_PROFILE, 'select public.submit_stock_opname($1)', [
      PRODUCT,
    ])
  })

  await test('A3 — inventory staff may create and count', async () => {
    const productId = await opnameProduct('OPN-A3', { stock: 5 })
    const session = await createOpname({ product_ids: [productId] }, 'authenticated', WAREHOUSE)
    assert(session.status === 'counting', 'staff creation did not start in counting')
    const item = await opnameItem(session.opname_id, productId)
    const counted = await countItem(item.id, 4, 'missing', null, 'authenticated', WAREHOUSE)
    assert(counted.count_status === 'counted', 'staff count was not recorded')
    assert(counted.counted_by === WAREHOUSE, 'count did not record the staff actor')
  })

  await test('A4 — inventory staff cannot approve, post or cancel', async () => {
    const productId = await opnameProduct('OPN-A4', { stock: 5 })
    const session = await createOpname({ product_ids: [productId] })
    const item = await opnameItem(session.opname_id, productId)
    await countItem(item.id, 5, null, null)
    await rpcAs('authenticated', OWNER, 'select public.submit_stock_opname($1) as r', [session.opname_id])

    await expectRpcError('42501', 'authenticated', WAREHOUSE, 'select public.approve_stock_opname($1)', [
      session.opname_id,
    ])
    await expectRpcError('42501', 'authenticated', WAREHOUSE, 'select public.post_stock_opname($1)', [
      session.opname_id,
    ])
    await expectRpcError('42501', 'authenticated', WAREHOUSE, 'select public.cancel_stock_opname($1,$2)', [
      session.opname_id,
      'batal',
    ])
    await expectRpcError('42501', 'authenticated', CASHIER, 'select public.approve_stock_opname($1)', [
      session.opname_id,
    ])
  })

  // ===== GROUP B — SESSION =====

  await test('B1 — full catalog snapshot is created server-side', async () => {
    const before = await db.query('select count(*)::int as n from public.products')
    const session = await createOpname({ scope_note: 'Opname penuh' })
    assert(session.item_count === before.rows[0].n, 'snapshot did not cover every product')
    assert(/^OP-[0-9]{8}-[0-9]{4}$/.test(session.opname_no), `unexpected opname no ${session.opname_no}`)
    const rows = await db.query(
      `select count(*)::int as n, count(distinct product_id)::int as d
         from public.stock_opname_items where stock_opname_id = $1`,
      [session.opname_id],
    )
    assert(rows.rows[0].n === rows.rows[0].d, 'duplicate products in the snapshot')
  })

  await test('B2 — selected scope, category scope and explicit exclusions', async () => {
    const a = await opnameProduct('OPN-B2A', { stock: 3 })
    const b = await opnameProduct('OPN-B2B', { stock: 4 })
    const selected = await createOpname({ product_ids: [a, b], exclude_product_ids: [b] })
    assert(selected.item_count === 1, 'explicit exclusion was not honoured')

    const byCategory = await createOpname({ category_id: categoryId })
    const listed = await db.query(
      `select count(*)::int as n from public.stock_opname_items where stock_opname_id = $1`,
      [byCategory.opname_id],
    )
    assert(listed.rows[0].n === byCategory.item_count, 'category snapshot mismatch')
    assert(byCategory.item_count >= 2, 'category scope returned too few products')
  })

  await test('B3 — snapshots preserve NULL stock and the current version', async () => {
    const known = await opnameProduct('OPN-B3K', { stock: 7, version: 3 })
    const session = await createOpname({ product_ids: [known, PRODUCT_NULL] })
    const rows = await db.query(
      `select product_id, system_qty_snapshot, stock_version_snapshot
         from public.stock_opname_items where stock_opname_id = $1 order by product_id`,
      [session.opname_id],
    )
    const nullRow = rows.rows.find((row) => row.product_id === PRODUCT_NULL)
    const knownRow = rows.rows.find((row) => row.product_id === known)
    assert(nullRow.system_qty_snapshot === null, 'NULL stock was coerced')
    assert(Number(knownRow.system_qty_snapshot) === 7, 'known stock snapshot wrong')
    assert(Number(knownRow.stock_version_snapshot) === 3, 'stock version snapshot wrong')

    const state = await productState(PRODUCT_NULL)
    assert(state.stock_on_hand === null, 'creating an opname modified stock')
  })

  await test('B4 — inactive products are included in a full snapshot', async () => {
    const inactive = await opnameProduct('OPN-B4', { stock: 2, active: false })
    const session = await createOpname({})
    const item = await opnameItem(session.opname_id, inactive)
    assert(item, 'inactive product was dropped from the full snapshot')
  })

  await test('B5 — create is retry-safe and rejects an empty scope', async () => {
    const productId = await opnameProduct('OPN-B5', { stock: 1 })
    const key = randomUUID()
    const first = await createOpname({ product_ids: [productId], idempotency_key: key })
    const second = await createOpname({ product_ids: [productId], idempotency_key: key })
    assert(first.opname_id === second.opname_id, 'retry created a second session')
    assert(second.already_processed === true, 'retry was not flagged as already processed')

    await expectRpcError('22023', 'authenticated', OWNER, 'select public.create_stock_opname($1::jsonb)', [
      JSON.stringify({ product_ids: [randomUUID()] }),
    ])
  })

  await test('B6 — invalid status transitions are rejected', async () => {
    const productId = await opnameProduct('OPN-B6', { stock: 3 })
    const session = await createOpname({ product_ids: [productId] })
    await expectRpcError('22023', 'authenticated', OWNER, 'select public.approve_stock_opname($1)', [
      session.opname_id,
    ])
    await expectRpcError('22023', 'authenticated', OWNER, 'select public.post_stock_opname($1)', [
      session.opname_id,
    ])
    await expectRpcError('22023', 'authenticated', OWNER, 'select public.submit_stock_opname($1)', [
      session.opname_id,
    ])
  })

  // ===== GROUP C — COUNT =====

  await test('C1 — count validates quantity, precision and reason rules', async () => {
    const pcs = await opnameProduct('OPN-C1', { stock: 10 })
    const session = await createOpname({ product_ids: [pcs] })
    const item = await opnameItem(session.opname_id, pcs)

    await expectRpcError('22023', 'authenticated', OWNER, 'select public.record_stock_opname_count($1,$2,$3,$4)', [
      item.id, -1, 'missing', null,
    ])
    await expectRpcError('22023', 'authenticated', OWNER, 'select public.record_stock_opname_count($1,$2,$3,$4)', [
      item.id, 1.5, 'missing', null,
    ])
    await expectRpcError('22023', 'authenticated', OWNER, 'select public.record_stock_opname_count($1,$2,$3,$4)', [
      item.id, 8, null, null,
    ])
    await expectRpcError('22023', 'authenticated', OWNER, 'select public.record_stock_opname_count($1,$2,$3,$4)', [
      item.id, 8, 'other', null,
    ])
    await expectRpcError('22023', 'authenticated', OWNER, 'select public.record_stock_opname_count($1,$2,$3,$4)', [
      item.id, 8, 'bogus', null,
    ])
    await expectRpcError('22023', 'authenticated', OWNER, 'select public.record_stock_opname_count($1,$2,$3,$4)', [
      item.id, 8, 'opening_balance', 'salah',
    ])

    const equal = await countItem(item.id, 10, null, null)
    assert(equal.count_status === 'counted', 'matching count was rejected')
    assert(Number(equal.difference_qty) === 0, 'difference should be zero')
  })

  await test('C2 — NULL stock requires an opening_balance reason and note', async () => {
    const session = await createOpname({ product_ids: [PRODUCT_NULL] })
    const item = await opnameItem(session.opname_id, PRODUCT_NULL)
    assert(item.count_status === 'pending', 'new item is not pending')

    await expectRpcError('22023', 'authenticated', OWNER, 'select public.record_stock_opname_count($1,$2,$3,$4)', [
      item.id, 0, null, null,
    ])
    await expectRpcError('22023', 'authenticated', OWNER, 'select public.record_stock_opname_count($1,$2,$3,$4)', [
      item.id, 0, 'missing', null,
    ])
    await expectRpcError('22023', 'authenticated', OWNER, 'select public.record_stock_opname_count($1,$2,$3,$4)', [
      item.id, 0, 'opening_balance', null,
    ])

    const counted = await countItem(item.id, 0, 'opening_balance', 'Stok awal kosong')
    assert(Number(counted.physical_qty) === 0, 'zero opening count was not accepted')
    assert(counted.reason_code === 'opening_balance', 'reason was not preserved')
  })

  await test('C3 — counting never touches stock or the ledger', async () => {
    const productId = await opnameProduct('OPN-C3', { stock: 6 })
    const session = await createOpname({ product_ids: [productId] })
    const item = await opnameItem(session.opname_id, productId)
    await countItem(item.id, 2, 'broken_damaged', 'Pecah')
    const state = await productState(productId)
    assert(Number(state.stock_on_hand) === 6, 'count changed product stock')
    assert(Number(state.stock_version) === 0, 'count changed the stock version')
    const movements = await db.query(
      'select count(*)::int as n from public.stock_movements where stock_opname_id = $1',
      [session.opname_id],
    )
    assert(movements.rows[0].n === 0, 'count wrote a stock movement')
  })

  await test('C4 — recount is allowed while counting and blocked after submit', async () => {
    const productId = await opnameProduct('OPN-C4', { stock: 9 })
    const session = await createOpname({ product_ids: [productId] })
    const item = await opnameItem(session.opname_id, productId)
    await countItem(item.id, 8, 'missing', null)
    const recount = await countItem(item.id, 7, 'missing', null)
    assert(Number(recount.physical_qty) === 7, 'recount did not overwrite the physical qty')
    await rpcAs('authenticated', OWNER, 'select public.submit_stock_opname($1) as r', [session.opname_id])
    await expectRpcError('22023', 'authenticated', OWNER, 'select public.record_stock_opname_count($1,$2,$3,$4)', [
      item.id, 5, 'missing', null,
    ])
  })

  // ===== GROUP D — APPROVAL =====

  await test('D1 — submit rejects an incomplete session', async () => {
    const a = await opnameProduct('OPN-D1A', { stock: 5 })
    const b = await opnameProduct('OPN-D1B', { stock: 6 })
    const session = await createOpname({ product_ids: [a, b] })
    const itemA = await opnameItem(session.opname_id, a)
    await countItem(itemA.id, 5, null, null)
    await expectRpcError('22023', 'authenticated', OWNER, 'select public.submit_stock_opname($1)', [
      session.opname_id,
    ])
    const status = await db.query('select status from public.stock_opnames where id = $1', [session.opname_id])
    assert(status.rows[0].status === 'counting', 'failed submit still moved the session')
  })

  await test('D2 — a needs_recount item blocks submission', async () => {
    const productId = await opnameProduct('OPN-D2', { stock: 4 })
    const session = await createOpname({ product_ids: [productId] })
    const item = await opnameItem(session.opname_id, productId)
    await countItem(item.id, 4, null, null)
    await db.query(`update public.stock_opname_items set count_status = 'needs_recount' where id = $1`, [
      item.id,
    ])
    await expectRpcError('22023', 'authenticated', OWNER, 'select public.submit_stock_opname($1)', [
      session.opname_id,
    ])
  })

  await test('D3 — owner approves a complete session without touching stock', async () => {
    const productId = await opnameProduct('OPN-D3', { stock: 8 })
    const session = await createOpname({ product_ids: [productId] })
    const item = await opnameItem(session.opname_id, productId)
    await countItem(item.id, 7, 'missing', null)
    await rpcAs('authenticated', WAREHOUSE, 'select public.submit_stock_opname($1) as r', [session.opname_id])

    const approved = await rpcAs('authenticated', OWNER, 'select public.approve_stock_opname($1) as r', [
      session.opname_id,
    ])
    assert(approved.status === 'approved', 'session was not approved')
    assert(approved.approved_at, 'approved_at was not recorded')
    const state = await productState(productId)
    assert(Number(state.stock_on_hand) === 8, 'approval changed stock')
    const movements = await db.query(
      'select count(*)::int as n from public.stock_movements where stock_opname_id = $1',
      [session.opname_id],
    )
    assert(movements.rows[0].n === 0, 'approval wrote a movement')
  })

  // ===== GROUP E — POSTING =====

  await test('E1 — known stock increase posts one adjustment and one log', async () => {
    const productId = await opnameProduct('OPN-E1', { stock: 10 })
    const session = await createOpname({ product_ids: [productId] })
    const item = await opnameItem(session.opname_id, productId)
    await countItem(item.id, 14, 'unrecorded_in', 'Temuan')
    await rpcAs('authenticated', OWNER, 'select public.submit_stock_opname($1) as r', [session.opname_id])
    await rpcAs('authenticated', OWNER, 'select public.approve_stock_opname($1) as r', [session.opname_id])
    const result = await rpcAs('authenticated', OWNER, 'select public.post_stock_opname($1) as r', [
      session.opname_id,
    ])
    assert(result.status === 'posted', 'session was not posted')
    assert(result.discrepancy_count === 1, 'wrong discrepancy count')

    const state = await productState(productId)
    assert(Number(state.stock_on_hand) === 14, 'stock was not raised to the physical count')
    assert(Number(state.stock_version) === 1, 'stock version did not increment')

    const movement = await db.query(
      `select movement_type, quantity_delta, quantity_before, quantity_after, reason_code
         from public.stock_movements where stock_opname_id = $1`,
      [session.opname_id],
    )
    assert(movement.rows.length === 1, 'expected exactly one movement')
    const row = movement.rows[0]
    assert(row.movement_type === 'opname_adjustment', 'wrong movement type')
    assert(Number(row.quantity_delta) === 4, 'wrong delta')
    assert(Number(row.quantity_before) === 10, 'wrong quantity_before')
    assert(Number(row.quantity_after) === 14, 'wrong quantity_after')

    const log = await db.query(
      `select revision, system_qty, physical_qty, difference_qty, reason_code, approved_by
         from public.stock_discrepancy_logs where stock_opname_item_id = $1`,
      [item.id],
    )
    assert(log.rows.length === 1, 'expected one discrepancy log')
    assert(Number(log.rows[0].system_qty) === 10 && Number(log.rows[0].physical_qty) === 14, 'log quantities wrong')
    assert(Number(log.rows[0].difference_qty) === 4, 'log difference wrong')
    assert(log.rows[0].approved_by === OWNER, 'approver not recorded on the log')
  })

  await test('E2 — known stock decrease and no-change items', async () => {
    const down = await opnameProduct('OPN-E2D', { stock: 10 })
    const same = await opnameProduct('OPN-E2S', { stock: 5 })
    const session = await createOpname({ product_ids: [down, same] })
    const downItem = await opnameItem(session.opname_id, down)
    const sameItem = await opnameItem(session.opname_id, same)
    await countItem(downItem.id, 6, 'broken_damaged', 'Rusak')
    await countItem(sameItem.id, 5, null, null)
    await rpcAs('authenticated', OWNER, 'select public.submit_stock_opname($1) as r', [session.opname_id])
    await rpcAs('authenticated', OWNER, 'select public.approve_stock_opname($1) as r', [session.opname_id])
    await rpcAs('authenticated', OWNER, 'select public.post_stock_opname($1) as r', [session.opname_id])

    assert(Number((await productState(down)).stock_on_hand) === 6, 'decrease was not applied')
    assert(Number((await productState(same)).stock_on_hand) === 5, 'unchanged product moved')

    const movements = await db.query(
      `select product_id from public.stock_movements where stock_opname_id = $1`,
      [session.opname_id],
    )
    assert(movements.rows.length === 1, 'a no-change item wrote a movement')
    assert(movements.rows[0].product_id === down, 'movement attached to the wrong product')

    const statuses = await db.query(
      `select product_id, count_status from public.stock_opname_items where stock_opname_id = $1`,
      [session.opname_id],
    )
    assert(statuses.rows.every((row) => row.count_status === 'posted'), 'items were not marked posted')
  })

  await test('E3 — opening balance with a positive quantity', async () => {
    const productId = await opnameProduct('OPN-E3', { stock: null })
    const session = await createOpname({ product_ids: [productId] })
    const item = await opnameItem(session.opname_id, productId)
    await countItem(item.id, 12, 'opening_balance', 'Saldo awal toko')
    await rpcAs('authenticated', OWNER, 'select public.submit_stock_opname($1) as r', [session.opname_id])
    await rpcAs('authenticated', OWNER, 'select public.approve_stock_opname($1) as r', [session.opname_id])
    const result = await rpcAs('authenticated', OWNER, 'select public.post_stock_opname($1) as r', [
      session.opname_id,
    ])
    assert(result.opening_balance_count === 1, 'opening balance was not counted')

    const state = await productState(productId)
    assert(Number(state.stock_on_hand) === 12, 'opening balance did not set stock')
    assert(Number(state.stock_version) === 1, 'opening balance did not bump the version')

    const movement = await db.query(
      `select movement_type, quantity_before, quantity_delta, quantity_after, reason_code
         from public.stock_movements where stock_opname_id = $1`,
      [session.opname_id],
    )
    const row = movement.rows[0]
    assert(row.movement_type === 'opening_balance', 'wrong movement type')
    assert(row.quantity_before === null, 'opening balance must not invent a previous quantity')
    assert(Number(row.quantity_delta) === 12 && Number(row.quantity_after) === 12, 'opening arithmetic wrong')
    assert(row.reason_code === 'opening_balance', 'wrong reason on the opening movement')

    const logs = await db.query(
      'select count(*)::int as n from public.stock_discrepancy_logs where stock_opname_item_id = $1',
      [item.id],
    )
    assert(logs.rows[0].n === 0, 'opening balance wrote a discrepancy log')
  })

  await test('E4 — opening balance of exactly zero is posted and ledgered', async () => {
    const productId = await opnameProduct('OPN-E4', { stock: null })
    const session = await createOpname({ product_ids: [productId] })
    const item = await opnameItem(session.opname_id, productId)
    await countItem(item.id, 0, 'opening_balance', 'Belum ada stok fisik')
    await rpcAs('authenticated', OWNER, 'select public.submit_stock_opname($1) as r', [session.opname_id])
    await rpcAs('authenticated', OWNER, 'select public.approve_stock_opname($1) as r', [session.opname_id])
    await rpcAs('authenticated', OWNER, 'select public.post_stock_opname($1) as r', [session.opname_id])

    const state = await productState(productId)
    assert(Number(state.stock_on_hand) === 0, 'zero opening balance was not written')
    assert(Number(state.stock_version) === 1, 'version did not increment for a zero opening')

    const movement = await db.query(
      `select quantity_before, quantity_delta, quantity_after, reason_code
         from public.stock_movements where stock_opname_id = $1`,
      [session.opname_id],
    )
    assert(movement.rows.length === 1, 'zero opening balance did not write a movement')
    assert(Number(movement.rows[0].quantity_delta) === 0, 'delta should be zero')
    assert(movement.rows[0].quantity_before === null, 'quantity_before must stay NULL')
    assert(movement.rows[0].reason_code === 'opening_balance', 'reason missing on zero opening')
  })

  await test('E5 — the ledger still rejects a zero delta for other movement types', async () => {
    await db.exec('begin')
    try {
      await expectError('23514', () =>
        db.query(
          `insert into public.stock_movements
             (product_id, movement_type, quantity_delta, quantity_before, quantity_after, reason_code, actor_id)
           values ($1, 'manual_adjustment', 0, 5, 5, 'input_error', $2)`,
          [PRODUCT, OWNER],
        ),
      )
      await expectError('23514', () =>
        db.query(
          `insert into public.stock_movements
             (product_id, movement_type, quantity_delta, quantity_before, quantity_after, reason_code, actor_id)
           values ($1, 'manual_adjustment', 0, null, 0, 'opening_balance', $2)`,
          [PRODUCT, OWNER],
        ),
      )
    } finally {
      await db.exec('rollback')
    }
  })

  await test('E6 — posting is idempotent and writes a single audit event', async () => {
    const productId = await opnameProduct('OPN-E6', { stock: 3 })
    const session = await createOpname({ product_ids: [productId] })
    const item = await opnameItem(session.opname_id, productId)
    await countItem(item.id, 2, 'missing', null)
    await rpcAs('authenticated', OWNER, 'select public.submit_stock_opname($1) as r', [session.opname_id])
    await rpcAs('authenticated', OWNER, 'select public.approve_stock_opname($1) as r', [session.opname_id])
    const first = await rpcAs('authenticated', OWNER, 'select public.post_stock_opname($1) as r', [
      session.opname_id,
    ])
    const second = await rpcAs('authenticated', OWNER, 'select public.post_stock_opname($1) as r', [
      session.opname_id,
    ])
    assert(first.already_processed === false, 'first post was flagged as a replay')
    assert(second.already_processed === true, 'replay was not detected')
    assert(Number((await productState(productId)).stock_on_hand) === 2, 'replay changed stock again')
    const movements = await db.query(
      'select count(*)::int as n from public.stock_movements where stock_opname_id = $1',
      [session.opname_id],
    )
    assert(movements.rows[0].n === 1, 'replay wrote another movement')
    const audits = await db.query(
      `select count(*)::int as n from public.audit_logs
        where action_key = 'opname.post' and entity_id = $1`,
      [session.opname_id],
    )
    assert(audits.rows[0].n === 1, 'expected exactly one opname.post audit event')
  })

  // ===== GROUP F — VERSION CONFLICT =====

  await test('F1 — a stale snapshot blocks posting and returns to counting', async () => {
    const productId = await opnameProduct('OPN-F1', { stock: 20 })
    const untouched = await opnameProduct('OPN-F1B', { stock: 8 })
    const session = await createOpname({ product_ids: [productId, untouched] })
    const staleItem = await opnameItem(session.opname_id, productId)
    const cleanItem = await opnameItem(session.opname_id, untouched)
    await countItem(staleItem.id, 18, 'missing', 'Hilang')
    await countItem(cleanItem.id, 8, null, null)
    await rpcAs('authenticated', OWNER, 'select public.submit_stock_opname($1) as r', [session.opname_id])
    await rpcAs('authenticated', OWNER, 'select public.approve_stock_opname($1) as r', [session.opname_id])

    // A cashier sells the product after the snapshot was taken.
    await asRoleCommit('authenticated', CASHIER, async () => {
      await db.query('select public.complete_sale($1::jsonb) as r', [
        JSON.stringify(cashPayload(productId, 2, 10000)),
      ])
    })

    const result = await rpcAs('authenticated', OWNER, 'select public.post_stock_opname($1) as r', [
      session.opname_id,
    ])
    assert(result.result === 'version_conflict', `expected a conflict, got ${result.result}`)
    assert(result.conflicts.length === 1, 'expected exactly one conflicting product')
    const conflict = result.conflicts[0]
    assert(conflict.product_id === productId, 'wrong product reported as conflicting')
    assert(Number(conflict.snapshot_version) === 0, 'snapshot version missing')
    assert(Number(conflict.current_version) === 1, 'current version missing')
    assert(Number(conflict.snapshot_qty) === 20, 'snapshot qty missing')
    assert(Number(conflict.current_qty) === 18, 'current qty missing')

    // The conflict markers must survive: no exception was raised.
    const opname = await db.query(
      'select status, approved_by, approved_at from public.stock_opnames where id = $1',
      [session.opname_id],
    )
    assert(opname.rows[0].status === 'counting', 'session did not return to counting')
    assert(opname.rows[0].approved_by === null, 'approval was not cleared')
    assert(opname.rows[0].approved_at === null, 'approved_at was not cleared')

    const staleAfter = await opnameItem(session.opname_id, productId)
    assert(staleAfter.count_status === 'needs_recount', 'conflicting item was not flagged')
    const cleanAfter = await opnameItem(session.opname_id, untouched)
    assert(cleanAfter.count_status === 'counted', 'unaffected item was modified')

    // The sale's stock stands; the opname never overwrote it.
    assert(Number((await productState(productId)).stock_on_hand) === 18, 'conflict overwrote stock')
    assert(Number((await productState(untouched)).stock_on_hand) === 8, 'clean item was partially posted')

    const movements = await db.query(
      'select count(*)::int as n from public.stock_movements where stock_opname_id = $1',
      [session.opname_id],
    )
    assert(movements.rows[0].n === 0, 'a stale movement was written')
    const logs = await db.query(
      'select count(*)::int as n from public.stock_discrepancy_logs where stock_opname_item_id = $1',
      [staleItem.id],
    )
    assert(logs.rows[0].n === 0, 'a stale discrepancy log was written')
  })

  await test('F2 — recounting after a conflict posts the fresh count', async () => {
    const productId = await opnameProduct('OPN-F2', { stock: 30 })
    const session = await createOpname({ product_ids: [productId] })
    let item = await opnameItem(session.opname_id, productId)
    await countItem(item.id, 25, 'missing', null)
    await rpcAs('authenticated', OWNER, 'select public.submit_stock_opname($1) as r', [session.opname_id])
    await rpcAs('authenticated', OWNER, 'select public.approve_stock_opname($1) as r', [session.opname_id])

    await asRoleCommit('authenticated', CASHIER, async () => {
      await db.query('select public.complete_sale($1::jsonb) as r', [
        JSON.stringify(cashPayload(productId, 5, 25000)),
      ])
    })

    const conflict = await rpcAs('authenticated', OWNER, 'select public.post_stock_opname($1) as r', [
      session.opname_id,
    ])
    assert(conflict.result === 'version_conflict', 'conflict was not detected')

    // The session is counting again, so the count can be refreshed against the
    // new physical reality and re-submitted.
    item = await opnameItem(session.opname_id, productId)
    await countItem(item.id, 24, 'missing', null)
    await rpcAs('authenticated', OWNER, 'select public.submit_stock_opname($1) as r', [session.opname_id])
    const approved = await rpcAs('authenticated', OWNER, 'select public.approve_stock_opname($1) as r', [
      session.opname_id,
    ])
    assert(approved.status === 'approved', 're-approval after recount failed')
  })

  // ===== GROUP G — IMMUTABILITY =====

  await test('G1 — posted sessions, items, movements and logs are immutable', async () => {
    const productId = await opnameProduct('OPN-G1', { stock: 6 })
    const session = await createOpname({ product_ids: [productId] })
    const item = await opnameItem(session.opname_id, productId)
    await countItem(item.id, 5, 'missing', null)
    await rpcAs('authenticated', OWNER, 'select public.submit_stock_opname($1) as r', [session.opname_id])
    await rpcAs('authenticated', OWNER, 'select public.approve_stock_opname($1) as r', [session.opname_id])
    await rpcAs('authenticated', OWNER, 'select public.post_stock_opname($1) as r', [session.opname_id])

    await expectRpcError('22023', 'authenticated', OWNER, 'select public.cancel_stock_opname($1,$2)', [
      session.opname_id,
      'terlambat',
    ])

    await db.exec('begin')
    try {
      await expectError('42501', () =>
        db.query(`update public.stock_opnames set scope_note = 'x' where id = $1`, [session.opname_id]),
      )
      await expectError('42501', () =>
        db.query(`update public.stock_opname_items set physical_qty = 99 where id = $1`, [item.id]),
      )
      await expectError('42501', () =>
        db.query(`update public.stock_movements set reason_note = 'x' where stock_opname_id = $1`, [
          session.opname_id,
        ]),
      )
      await expectError('42501', () =>
        db.query(`delete from public.stock_movements where stock_opname_id = $1`, [session.opname_id]),
      )
      await expectError('42501', () =>
        db.query(`update public.stock_discrepancy_logs set physical_qty = 99 where stock_opname_item_id = $1`, [
          item.id,
        ]),
      )
      await expectError('42501', () =>
        db.query(`delete from public.stock_discrepancy_logs where stock_opname_item_id = $1`, [item.id]),
      )
    } finally {
      await db.exec('rollback')
    }
  })

  await test('G2 — a cancelled session is final and never changes stock', async () => {
    const productId = await opnameProduct('OPN-G2', { stock: 11 })
    const session = await createOpname({ product_ids: [productId] })
    const item = await opnameItem(session.opname_id, productId)
    await countItem(item.id, 4, 'missing', null)

    await expectRpcError('22023', 'authenticated', OWNER, 'select public.cancel_stock_opname($1,$2)', [
      session.opname_id,
      '   ',
    ])
    const cancelled = await rpcAs('authenticated', OWNER, 'select public.cancel_stock_opname($1,$2) as r', [
      session.opname_id,
      'Salah input',
    ])
    assert(cancelled.status === 'cancelled', 'session was not cancelled')
    assert(Number((await productState(productId)).stock_on_hand) === 11, 'cancel changed stock')

    const replay = await rpcAs('authenticated', OWNER, 'select public.cancel_stock_opname($1,$2) as r', [
      session.opname_id,
      'Salah input',
    ])
    assert(replay.already_processed === true, 'cancel replay was not idempotent')

    // The audit row must record the status the session actually had, not the
    // post-update value (v_opname is overwritten by RETURNING *).
    const cancelAudit = await db.query(
      `select before_data ->> 'status' as before_status
         from public.audit_logs
        where entity_id = $1 and action_key = 'opname.cancel'`,
      [session.opname_id],
    )
    assert(cancelAudit.rows.length === 1, 'cancel did not write exactly one audit row')
    assert(cancelAudit.rows[0].before_status === 'counting', `cancel audit recorded ${cancelAudit.rows[0].before_status}`)

    await expectRpcError('22023', 'authenticated', OWNER, 'select public.record_stock_opname_count($1,$2,$3,$4)', [
      item.id, 9, 'missing', null,
    ])
    await expectRpcError('22023', 'authenticated', OWNER, 'select public.submit_stock_opname($1)', [
      session.opname_id,
    ])
    await expectRpcError('22023', 'authenticated', OWNER, 'select public.approve_stock_opname($1)', [
      session.opname_id,
    ])
  })

  // ===== GROUP H — SCALE & REPLAY =====

  await test('H1 — a full snapshot of ~1,360 products stays a single statement', async () => {
    const bulk = []
    for (let index = 0; index < 1360; index += 1) {
      bulk.push(`('BULK-${String(index).padStart(5, '0')}', 'Produk Bulk ${index}', ${index % 7 === 0 ? 'null' : index % 50}, ${index % 3})`)
    }
    await db.exec(
      `insert into public.products (sku, name, unit_id, sale_price, stock_on_hand, stock_version)
       values ${bulk.map((row) => row.replace(/^(\('BULK-[0-9]+', '[^']+'), /, `$1, '${unitId}', 1000, `)).join(',')}`,
    )

    const before = await db.query('select count(*)::int as n from public.products')
    const started = Date.now()
    const session = await createOpname({ scope_note: 'Uji skala 1360' })
    const elapsed = Date.now() - started
    assert(session.item_count === before.rows[0].n, 'bulk snapshot missed products')
    assert(session.item_count >= 1360, `expected >=1360 items, got ${session.item_count}`)
    assert(elapsed < 15000, `bulk snapshot too slow: ${elapsed} ms`)
    console.log(`      bulk snapshot: ${session.item_count} items in ${elapsed} ms`)
  })

  await test('H2 — submit and approve replays are idempotent', async () => {
    const productId = await opnameProduct('OPN-H2', { stock: 4 })
    const session = await createOpname({ product_ids: [productId] })
    const item = await opnameItem(session.opname_id, productId)
    await countItem(item.id, 4, null, null)

    const first = await rpcAs('authenticated', OWNER, 'select public.submit_stock_opname($1) as r', [
      session.opname_id,
    ])
    const replay = await rpcAs('authenticated', OWNER, 'select public.submit_stock_opname($1) as r', [
      session.opname_id,
    ])
    assert(first.already_processed === false, 'first submit flagged as replay')
    assert(replay.already_processed === true, 'submit replay was not detected')

    await rpcAs('authenticated', OWNER, 'select public.approve_stock_opname($1) as r', [session.opname_id])
    const approveReplay = await rpcAs('authenticated', OWNER, 'select public.approve_stock_opname($1) as r', [
      session.opname_id,
    ])
    assert(approveReplay.already_processed === true, 'approve replay was not detected')
    const audits = await db.query(
      `select count(*)::int as n from public.audit_logs
        where entity_id = $1 and action_key in ('opname.submit','opname.approve')`,
      [session.opname_id],
    )
    assert(audits.rows[0].n === 2, 'replays duplicated audit events')
  })

  await test('G3 — direct stock writes are still denied to clients', async () => {
    await expectRpcError('42501', 'authenticated', OWNER, 'update public.products set stock_on_hand = 1 where id = $1', [
      PRODUCT,
    ])
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
  await runOpnameTests()

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
