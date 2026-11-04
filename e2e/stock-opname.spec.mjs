import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

/**
 * Phase 5D — stock opname browser E2E.
 *
 * Runs against the preview project through the real Nuxt UI. Owner, inventory
 * staff and cashier each get their own browser context; no shared storage state.
 *
 * Fixtures are created through the product RPC (stock NULL) and deactivated at
 * the end. Only TEST-OPN-E2E-* SKUs are touched; the 1,361 imported products
 * are never counted or posted.
 */

test.setTimeout(180_000)
test.describe.configure({ mode: 'serial' })

const env = {}
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
}
const SUPABASE_URL = (env.SUPABASE_URL || env.NUXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
const SUPABASE_KEY = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY

const accounts = JSON.parse(readFileSync(new URL('../.tmp/phase2b-accounts.json', import.meta.url), 'utf8'))
const byRole = Object.fromEntries(accounts.map((account) => [account.role, account]))

const RUN = Date.now().toString(36).toUpperCase()
const SKUS = {
  nullStock: `TEST-OPN-E2E-NULL-${RUN}`,
  zero: `TEST-OPN-E2E-ZERO-${RUN}`,
  known: `TEST-OPN-E2E-KNOWN-${RUN}`,
}

const state = {
  products: {},
  sessionId: '',
  knownSessionId: '',
  cancelledSessionId: '',
}

function makeClient() {
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

async function api(role) {
  const client = makeClient()
  const { error } = await client.auth.signInWithPassword({
    email: byRole[role].email,
    password: byRole[role].password,
  })
  if (error) throw new Error(`${role} sign-in failed: ${error.message}`)
  return client
}

async function login(page, role) {
  await page.goto('/login')
  await page.fill('#email', byRole[role].email)
  await page.fill('#password', byRole[role].password)
  await page.getByRole('button', { name: 'Masuk' }).click()
  await expect(page).toHaveURL(/\/(dashboard|cashier|products|stock-opname)/, { timeout: 25_000 })
}

/** Fill the count dialog and save. */
async function countItem(page, sku, qty, options = {}) {
  const row = page.locator('table tbody tr', { hasText: sku }).first()
  await expect(row).toBeVisible({ timeout: 20_000 })
  await row.getByRole('button', { name: /^(Hitung|Ubah)$/ }).click()

  const dialog = page.locator('dialog[open]')
  await expect(dialog.getByRole('heading', { name: 'Hitung fisik' })).toBeVisible()
  await dialog.locator('#physical-qty').fill(String(qty))

  if (options.reason) await dialog.locator('#reason-code').selectOption(options.reason)
  if (options.note !== undefined) await dialog.locator('#reason-note').fill(options.note)

  await dialog.getByRole('button', { name: 'Simpan hitungan' }).click()
  return dialog
}

/** Create a session scoped to the given SKUs through the create dialog. */
async function createSession(page, skus, note) {
  await page.goto('/stock-opname')
  await page.getByRole('button', { name: 'Sesi baru' }).click()

  const dialog = page.locator('dialog[open]')
  await expect(dialog.getByRole('heading', { name: 'Sesi opname baru' })).toBeVisible()
  await dialog.getByLabel('Produk terpilih').check()

  for (const sku of skus) {
    await dialog.locator('#scope-product-search').fill(sku)
    const option = dialog.locator('li', { hasText: sku }).first()
    await expect(option).toBeVisible({ timeout: 20_000 })
    const checkbox = option.getByRole('checkbox')
    if (!(await checkbox.isChecked())) await checkbox.check()
  }

  if (note) await dialog.locator('#scope-note').fill(note)
  await dialog.getByRole('button', { name: 'Buat sesi' }).click()

  await expect(page).toHaveURL(/\/stock-opname\/[0-9a-f-]{36}/, { timeout: 30_000 })
  const id = page.url().match(/\/stock-opname\/([0-9a-f-]{36})/)?.[1]
  if (!id) throw new Error('session id missing from the URL')
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 20_000 })
  return id
}

async function stockFromInventory(page, sku) {
  await page.goto(`/inventory/movements?product=${encodeURIComponent(sku)}`)
  const row = page.locator('table tbody tr', { hasText: sku }).first()
  await expect(row).toBeVisible({ timeout: 25_000 })
  return row
}

/** The balance and discrepancy pages filter through an input, not a query param. */
async function searchBalance(page, sku) {
  await page.goto('/inventory')
  await page.locator('#balance-search').fill(sku)
  const row = page.locator('table tbody tr', { hasText: sku }).first()
  await expect(row).toBeVisible({ timeout: 25_000 })
  return row
}

async function searchDiscrepancies(page, sku) {
  await page.goto('/inventory/discrepancies')
  await page.locator('#discrepancy-search').fill(sku)
  return page.locator('table tbody tr', { hasText: sku }).first()
}

let ownerPage
let staffPage
let cashierPage

test.beforeAll(async ({ browser }) => {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('.env is missing Supabase credentials')

  const owner = await api('owner')
  const units = await owner.from('units_of_measure').select('id, code').eq('code', 'PCS').single()
  if (units.error) throw new Error(units.error.message)

  for (const [key, sku] of Object.entries(SKUS)) {
    const created = await owner.rpc('upsert_product', {
      p_payload: {
        sku,
        name: `TEST Opname E2E ${key} ${RUN}`,
        unit_id: units.data.id,
        sale_price: 5000,
        is_active: true,
      },
    })
    if (created.error) throw new Error(`fixture ${sku}: ${created.error.message}`)
    const product = typeof created.data === 'string' ? JSON.parse(created.data) : created.data
    state.products[key] = { id: product.id, sku }
  }

  ownerPage = await browser.newPage()
  staffPage = await browser.newPage()
  cashierPage = await browser.newPage()

  await login(staffPage, 'warehouse')
  await login(ownerPage, 'owner')
  await login(cashierPage, 'cashier')
})

test.afterAll(async () => {
  try {
    const owner = await api('owner')
    for (const product of Object.values(state.products)) {
      await owner.rpc('upsert_product', {
        p_payload: {
          product_id: product.id,
          sku: product.sku,
          name: `TEST Opname E2E ${product.sku}`,
          unit_id: (await owner.from('units_of_measure').select('id').eq('code', 'PCS').single()).data.id,
          sale_price: 5000,
          is_active: false,
        },
      })
    }
  } finally {
    await ownerPage?.close()
    await staffPage?.close()
    await cashierPage?.close()
  }
})

test('SCR 1 — cashier cannot open /stock-opname', async () => {
  await cashierPage.goto('/stock-opname')
  await expect(cashierPage.getByText('Anda tidak memiliki izin')).toBeVisible({ timeout: 20_000 })
})

test('SCR 2 — inventory staff creates a session scoped to the fixtures', async () => {
  const id = await createSession(
    staffPage,
    [SKUS.nullStock, SKUS.zero, SKUS.known],
    `Phase 5D E2E ${RUN}`,
  )
  state.sessionId = id
  const rows = staffPage.locator('table tbody tr')
  await expect(rows).toHaveCount(3)
  await expect(staffPage.locator('table tbody tr', { hasText: SKUS.nullStock })).toBeVisible()
})

test('SCR 4 — a NULL-stock count demands an opening-balance note', async () => {
  const dialog = await countItem(staffPage, SKUS.nullStock, 25, {
    reason: 'opening_balance',
    note: '   ',
  })
  await expect(dialog.locator('[role=alert]')).toHaveText('Catatan wajib diisi untuk saldo awal.')
  await dialog.getByRole('button', { name: 'Batal' }).click()
})

test('SCR 3 — staff counts a NULL-stock item and records opening balance', async () => {
  await countItem(staffPage, SKUS.nullStock, 25, {
    reason: 'opening_balance',
    note: 'Saldo awal rak depan',
  })
  const row = staffPage.locator('table tbody tr', { hasText: SKUS.nullStock }).first()
  await expect(row).toContainText('25')
  await expect(row).toContainText('Saldo awal')
})

test('SCR 5 — zero physical quantity is accepted', async () => {
  await countItem(staffPage, SKUS.zero, 0, {
    reason: 'opening_balance',
    note: 'Rak kosong, belum pernah tercatat',
  })
  const row = staffPage.locator('table tbody tr', { hasText: SKUS.zero }).first()
  await expect(row).toContainText('0')
})

test('SCR 6 — the third fixture is seeded with an opening balance of 10', async () => {
  await countItem(staffPage, SKUS.known, 10, {
    reason: 'opening_balance',
    note: 'Saldo awal gudang',
  })
  const row = staffPage.locator('table tbody tr', { hasText: SKUS.known }).first()
  await expect(row).toContainText('10')
  await expect(row).toContainText('Saldo awal')
})

test('SCR 7 — staff submits the completed session', async () => {
  await staffPage.getByRole('button', { name: 'Submit untuk persetujuan' }).click()
  await expect(staffPage.locator('.tag', { hasText: 'Menunggu persetujuan' }).first()).toBeVisible({
    timeout: 20_000,
  })
  await expect(staffPage.getByText('Menunggu persetujuan owner')).toBeVisible()
})

test('SCR 8 — owner approves the submitted session', async () => {
  await ownerPage.goto(`/stock-opname/${state.sessionId}`)
  await ownerPage.getByRole('button', { name: 'Setujui sesi' }).click()
  await expect(ownerPage.locator('.tag', { hasText: 'Disetujui' }).first()).toBeVisible({ timeout: 20_000 })
})

test('SCR 9 — owner posts the session', async () => {
  await ownerPage.getByRole('button', { name: 'Posting penyesuaian stok' }).click()
  await ownerPage.getByRole('button', { name: 'Ya, posting sekarang' }).click()
  await expect(ownerPage.getByRole('heading', { name: 'Posting selesai' })).toBeVisible({ timeout: 30_000 })
  await expect(ownerPage.locator('.tag', { hasText: 'Terposting' }).first()).toBeVisible()
})

test('SCR 10 — the new balances appear in the inventory page', async () => {
  const row = await searchBalance(ownerPage, SKUS.nullStock)
  await expect(row).toContainText('25')
})

test('SCR 11 — movement history shows the opening balance', async () => {
  const row = await stockFromInventory(ownerPage, SKUS.zero)
  await expect(row).toContainText('Saldo awal')
  await expect(row).toContainText('0')
})

test('SCR 12 — opening balances never create a discrepancy row', async () => {
  await searchDiscrepancies(ownerPage, SKUS.nullStock)
  await expect(ownerPage.locator('table').first()).toHaveAttribute('aria-busy', 'false', {
    timeout: 25_000,
  })
  await expect(ownerPage.locator('table tbody tr', { hasText: SKUS.nullStock })).toHaveCount(0)
  await expect(ownerPage.locator('#discrepancy-search')).toHaveValue(SKUS.nullStock)
})

test('SCR 6b — a known-stock adjustment is posted with a mandatory reason', async () => {
  const id = await createSession(ownerPage, [SKUS.known], `Koreksi ${RUN}`)
  state.knownSessionId = id

  const row = ownerPage.locator('table tbody tr', { hasText: SKUS.known }).first()
  await row.getByRole('button', { name: /^(Hitung|Ubah)$/ }).click()
  const dialog = ownerPage.locator('dialog[open]')
  await dialog.locator('#physical-qty').fill('13')
  await dialog.getByRole('button', { name: 'Simpan hitungan' }).click()
  await expect(dialog.locator('[role=alert]')).toHaveText('Selisih stok wajib memiliki alasan.')

  await dialog.locator('#reason-code').selectOption('unrecorded_in')
  await dialog.getByRole('button', { name: 'Simpan hitungan' }).click()
  await expect(row).toContainText('+3', { timeout: 20_000 })

  await ownerPage.getByRole('button', { name: 'Submit untuk persetujuan' }).click()
  await expect(ownerPage.locator('.tag', { hasText: 'Menunggu persetujuan' }).first()).toBeVisible({
    timeout: 20_000,
  })
  await ownerPage.getByRole('button', { name: 'Setujui sesi' }).click()
  await ownerPage.getByRole('button', { name: 'Posting penyesuaian stok' }).click()
  await ownerPage.getByRole('button', { name: 'Ya, posting sekarang' }).click()
  await expect(ownerPage.getByRole('heading', { name: 'Posting selesai' })).toBeVisible({ timeout: 30_000 })

  // A session opened after the balance is known needs no reason when the
  // physical count matches the system quantity exactly.
  await createSession(ownerPage, [SKUS.known], `Tanpa selisih ${RUN}`)
  const equal = ownerPage.locator('table tbody tr', { hasText: SKUS.known }).first()
  await equal.getByRole('button', { name: /^(Hitung|Ubah)$/ }).click()
  const equalDialog = ownerPage.locator('dialog[open]')
  await equalDialog.locator('#physical-qty').fill('13')
  await expect(equalDialog.locator('#reason-code')).toHaveCount(0)
  await equalDialog.getByRole('button', { name: 'Batal' }).click()

  await ownerPage.getByRole('button', { name: 'Batalkan sesi' }).click()
  const cancelDialog = ownerPage.locator('dialog[open]')
  await cancelDialog.locator('#cancel-reason').fill('Phase 5D E2E: sesi tanpa selisih')
  await cancelDialog.getByRole('button', { name: 'Batalkan sesi' }).click()
  await expect(ownerPage.locator('.tag', { hasText: 'Dibatalkan' }).first()).toBeVisible({ timeout: 25_000 })
})

test('SCR 12b — the discrepancy report lists the +3 adjustment', async () => {
  const row = await searchDiscrepancies(ownerPage, SKUS.known)
  await expect(row).toBeVisible({ timeout: 25_000 })
  await expect(row).toContainText('Masuk tanpa catatan')
  await expect(row).toContainText('+3')
})

test('SCR 13 — a posted session cannot be edited', async () => {
  await ownerPage.goto(`/stock-opname/${state.sessionId}`)
  // The "locked" notice is intentionally hidden for posted sessions; the tag and
  // the absence of every mutating control are the real assertions.
  await expect(ownerPage.locator('.tag', { hasText: 'Terposting' }).first()).toBeVisible({
    timeout: 20_000,
  })
  await expect(ownerPage.getByRole('button', { name: /^(Hitung|Ubah)$/ })).toHaveCount(0)
  await expect(ownerPage.getByRole('button', { name: 'Submit untuk persetujuan' })).toHaveCount(0)
  await expect(ownerPage.getByRole('button', { name: 'Setujui sesi' })).toHaveCount(0)
  await expect(ownerPage.getByRole('button', { name: 'Batalkan sesi' })).toHaveCount(0)
})

test('SCR 14 — a cancelled session never changes stock', async () => {
  const id = await createSession(ownerPage, [SKUS.nullStock], `Batal ${RUN}`)
  state.cancelledSessionId = id
  const row = ownerPage.locator('table tbody tr', { hasText: SKUS.nullStock }).first()
  await row.getByRole('button', { name: /^(Hitung|Ubah)$/ }).click()
  const dialog = ownerPage.locator('dialog[open]')
  await dialog.locator('#physical-qty').fill('99')
  // 99 differs from the known 25, so the client demands a reason before saving.
  await dialog.locator('#reason-code').selectOption('unrecorded_in')
  await dialog.locator('#reason-note').fill('Akan dibatalkan')
  await dialog.getByRole('button', { name: 'Simpan hitungan' }).click()
  await expect(dialog).toBeHidden({ timeout: 20_000 })

  await ownerPage.getByRole('button', { name: 'Batalkan sesi' }).click()
  const cancelDialog = ownerPage.locator('dialog[open]')
  await cancelDialog.getByRole('button', { name: 'Batalkan sesi' }).click()
  await expect(cancelDialog.locator('[role=alert]')).toHaveText('Alasan pembatalan wajib diisi.')
  await cancelDialog.locator('#cancel-reason').fill('Phase 5D E2E: batalkan sesi uji')
  await cancelDialog.getByRole('button', { name: 'Batalkan sesi' }).click()

  await expect(ownerPage.locator('.tag', { hasText: 'Dibatalkan' }).first()).toBeVisible({ timeout: 25_000 })

  const balance = await searchBalance(ownerPage, SKUS.nullStock)
  await expect(balance).toContainText('25')
})

test('SCR 15 — a stale snapshot shows the recount panel instead of posting', async () => {
  const id = await createSession(ownerPage, [SKUS.known], `Konflik ${RUN}`)

  const row = ownerPage.locator('table tbody tr', { hasText: SKUS.known }).first()
  await row.getByRole('button', { name: /^(Hitung|Ubah)$/ }).click()
  const dialog = ownerPage.locator('dialog[open]')
  await dialog.locator('#physical-qty').fill('13')
  await dialog.getByRole('button', { name: 'Simpan hitungan' }).click()

  await ownerPage.getByRole('button', { name: 'Submit untuk persetujuan' }).click()
  await expect(ownerPage.locator('.tag', { hasText: 'Menunggu persetujuan' }).first()).toBeVisible({
    timeout: 20_000,
  })
  await ownerPage.getByRole('button', { name: 'Setujui sesi' }).click()
  await expect(ownerPage.locator('.tag', { hasText: 'Disetujui' }).first()).toBeVisible({ timeout: 20_000 })

  // A sale lands after the snapshot: 13 -> 12 on a new stock version.
  const cashier = await api('cashier')
  const sale = await cashier.rpc('complete_sale', {
    p_payload: {
      idempotency_key: randomUUID(),
      business_date: new Date().toISOString().slice(0, 10),
      discount_amount: 0,
      items: [{ product_id: state.products.known.id, quantity: 1 }],
      payments: [{ method: 'cash', amount_applied: 5000, cash_received: 5000, cash_change: 0 }],
    },
  })
  expect(sale.error).toBeFalsy()

  await ownerPage.getByRole('button', { name: 'Posting penyesuaian stok' }).click()
  await ownerPage.getByRole('button', { name: 'Ya, posting sekarang' }).click()

  await expect(ownerPage.getByRole('heading', { name: 'Stok berubah saat menghitung' })).toBeVisible({
    timeout: 30_000,
  })
  await expect(ownerPage.locator('.tag', { hasText: 'Menghitung' }).first()).toBeVisible()
  await expect(ownerPage.locator('#opname-conflict-title')).toBeVisible()
  await expect(ownerPage.locator('.tag', { hasText: 'Perlu hitung ulang' }).first()).toBeVisible()

  // The recount against the new system quantity can be posted again. Scope to the
  // items table: the conflict panel renders its own table with the same SKU.
  const item = ownerPage
    .locator('section[aria-labelledby="opname-items-title"] table tbody tr', { hasText: SKUS.known })
    .first()
  await item.getByRole('button', { name: /^(Hitung|Ubah)$/ }).click()
  const recount = ownerPage.locator('dialog[open]')
  await recount.locator('#physical-qty').fill('12')
  // The detail page still shows the pre-sale snapshot (13), so the client asks
  // for a reason here. The server re-bases the snapshot to 12 and discards it,
  // because the difference becomes zero. Recorded as a known UX wart.
  if ((await recount.locator('#reason-code').count()) > 0) {
    await recount.locator('#reason-code').selectOption('unrecorded_in')
  }
  await recount.getByRole('button', { name: 'Simpan hitungan' }).click()
  await expect(recount).toBeHidden({ timeout: 20_000 })

  await ownerPage.getByRole('button', { name: 'Submit untuk persetujuan' }).click()
  await expect(ownerPage.locator('.tag', { hasText: 'Menunggu persetujuan' }).first()).toBeVisible({
    timeout: 20_000,
  })
  await ownerPage.getByRole('button', { name: 'Setujui sesi' }).click()
  await ownerPage.getByRole('button', { name: 'Posting penyesuaian stok' }).click()
  await ownerPage.getByRole('button', { name: 'Ya, posting sekarang' }).click()
  await expect(ownerPage.getByRole('heading', { name: 'Posting selesai' })).toBeVisible({ timeout: 30_000 })

  const balance = await searchBalance(ownerPage, SKUS.known)
  await expect(balance).toContainText('12')
})
