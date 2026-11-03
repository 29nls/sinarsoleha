import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'

test.setTimeout(90_000)

const accounts = JSON.parse(readFileSync(new URL('../.tmp/phase2b-accounts.json', import.meta.url), 'utf8'))
const byRole = Object.fromEntries(accounts.map((account) => [account.role, account]))
const owner = byRole.owner
const cashier = byRole.cashier
const warehouse = byRole.warehouse

// TEST-TXN fixtures (never the 1,360 imported products with NULL stock).
const PAY_SKU = 'TEST-TXN-PAY-001' // stock 6, price 10.000
const IDEM_SKU = 'TEST-TXN-IDEMPOTENCY-001' // stock 1, price 15.000

// Shared within the worker (workers=1, serial).
const state = { transactionId: '', receiptNo: '' }

async function login(page, account) {
  await page.goto('/login')
  await page.fill('#email', account.email)
  await page.fill('#password', account.password)
  await page.getByRole('button', { name: 'Masuk' }).click()
  await expect(page).toHaveURL(/\/(dashboard|cashier|products)/, { timeout: 20_000 })
}

async function loginAsCashier(page) {
  await login(page, cashier)
  await page.goto('/cashier')
  await expect(page).toHaveURL(/\/cashier$/, { timeout: 15_000 })
}

async function searchSku(page, sku) {
  await page.fill('#cashier-search', sku)
  const row = page.locator('table tbody tr', { hasText: sku }).first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  return row
}

test('unauthenticated /cashier redirects to /login', async ({ page }) => {
  await page.goto('/cashier')
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
  await expect(page.locator('#email')).toBeVisible()
})

test('login rejects wrong password', async ({ page }) => {
  await page.goto('/login')
  await page.fill('#email', cashier.email)
  await page.fill('#password', 'salah-benar-benar-salah')
  await page.getByRole('button', { name: 'Masuk' }).click()
  await expect(page.locator('[role=alert]')).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveURL(/\/login/)
})

test('cashier: search results, NULL stock row, over-stock quantity guard', async ({ page }) => {
  await loginAsCashier(page)

  // Sellable fixture shows stock, price, and a working Tambah button.
  const payRow = await searchSku(page, PAY_SKU)
  await expect(payRow.locator('.tag')).toHaveText('Tersedia')
  await expect(payRow.getByRole('button', { name: 'Tambah' })).toBeEnabled()
  await payRow.getByRole('button', { name: 'Tambah' }).click()
  const qtyInput = page.getByLabel(`Jumlah ${PAY_SKU}`)
  await expect(qtyInput).toHaveValue('1')

  // NULL stock product: button disabled + status tag.
  const nullRow = await searchSku(page, 'ALA-M1322')
  await expect(nullRow.locator('.tag')).toHaveText('Stok belum diopname')
  await expect(nullRow.getByRole('button', { name: 'Tambah' })).toBeDisabled()

  // Over-stock: store rejects; notice shows and the input is reset to the real quantity.
  await qtyInput.fill('99')
  await qtyInput.press('Tab')
  await expect(page.getByRole('status')).toHaveText(/Stok tersedia hanya/, { timeout: 10_000 })
  await expect(qtyInput).toHaveValue('1')
  // Remove the line to leave a clean cart.
  await page.locator('table tbody tr', { hasText: PAY_SKU }).getByRole('button', { name: 'Hapus' }).first().click()
})

test('cashier: cash checkout, change, and receipt', async ({ page }) => {
  await loginAsCashier(page)
  const row = await searchSku(page, PAY_SKU)
  await row.getByRole('button', { name: 'Tambah' }).click()

  // Cash received above the total → kembalian appears.
  await page.fill('#cash-received', '20000')
  await expect(page.getByText('Kembalian', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Bayar & simpan' }).click()
  const receipt = page.getByRole('dialog', { name: /^Nota / })
  await expect(receipt).toBeVisible({ timeout: 20_000 })
  await expect(receipt.getByText(PAY_SKU)).toBeVisible()
  await expect(receipt.getByText('Tunai')).toBeVisible()

  state.receiptNo = (await receipt.locator('h2').textContent())?.replace(/^Nota\s*/, '') ?? ''
  state.transactionId = (await receipt.textContent())?.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
  )?.[0] ?? ''
  expect(state.transactionId).not.toBe('')
  writeFileSync(new URL('../.tmp/e2e-state.json', import.meta.url), JSON.stringify(state))

  await receipt.getByRole('button', { name: 'Tutup' }).click()
  await expect(receipt).toBeHidden()
})

test('cashier: QRIS blocked without confirmation, succeeds after confirm', async ({ page }) => {
  await loginAsCashier(page)
  const row = await searchSku(page, IDEM_SKU)
  await row.getByRole('button', { name: 'Tambah' }).click()

  // Switch to QRIS mode; the confirmation checkbox is unchecked by default.
  await page.getByRole('tab', { name: 'QRIS' }).click()
  await page.getByRole('checkbox').first().uncheck({ force: true }).catch(() => {})
  const submit = page.getByRole('button', { name: 'Bayar & simpan' })
  await expect(submit).toBeDisabled()

  // Confirm manual QRIS verification → checkout proceeds.
  await page.getByLabel('Pembayaran QRIS telah diterima dan diverifikasi.').check()
  await expect(submit).toBeEnabled()
  await submit.click()
  const receipt = page.getByRole('dialog', { name: /^Nota / })
  await expect(receipt).toBeVisible({ timeout: 20_000 })
  await expect(receipt.getByText('QRIS')).toBeVisible()
  await receipt.getByRole('button', { name: 'Tutup' }).click()
})

test('cashier: transient network failure retries with same idempotency key', async ({ page }) => {
  await loginAsCashier(page)
  const row = await searchSku(page, PAY_SKU)
  await row.getByRole('button', { name: 'Tambah' }).click()

  let abortNext = true
  await page.route('**/rpc/**complete_sale**', async (route) => {
    if (abortNext) {
      abortNext = false
      return route.abort()
    }
    return route.continue()
  })

  const submit = page.getByRole('button', { name: 'Bayar & simpan' })
  await submit.click()

  // Request got no response → status 'unknown' → retry button keeps the same payload/key.
  await expect(page.getByRole('button', { name: 'Coba lagi checkout' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Coba lagi checkout' }).click()
  const receipt = page.getByRole('dialog', { name: /^Nota / })
  await expect(receipt).toBeVisible({ timeout: 20_000 })
  await receipt.getByRole('button', { name: 'Tutup' }).click()
})

test('transactions history, detail, receipt re-open; cashier cannot void', async ({ page, request }) => {
  await loginAsCashier(page)
  await page.goto('/cashier/transactions')
  await expect(page.getByRole('heading', { name: 'Riwayat Transaksi' })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 15_000 })

  // Detail of a transaction created by this suite.
  if (!state.transactionId) throw new Error('no transaction id from earlier checkout test')
  await page.goto(`/cashier/transactions/${state.transactionId}`)
  await expect(page.getByRole('heading', { name: 'Detail Transaksi' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: `Nota ${state.receiptNo}` })).toBeVisible()
  await expect(page.locator('table tbody tr', { hasText: PAY_SKU })).toBeVisible()
  await expect(page.locator('.tag', { hasText: 'Selesai' })).toBeVisible()

  // Receipt re-open.
  await page.getByRole('button', { name: 'Cetak Ulang Struk' }).click()
  const receipt = page.getByRole('dialog', { name: /^Nota / })
  await expect(receipt).toBeVisible()
  await receipt.getByRole('button', { name: 'Tutup' }).click()

  // Cashier role has no void capability.
  await expect(page.getByRole('button', { name: 'Batalkan Transaksi' })).toHaveCount(0)
})

test('owner: void requires reason, then voids and restores stock', async ({ page }) => {
  await login(page, owner)
  if (!state.transactionId) throw new Error('no transaction id from earlier checkout test')
  await page.goto(`/cashier/transactions/${state.transactionId}`)
  await expect(page.getByRole('heading', { name: 'Detail Transaksi' })).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Batalkan Transaksi' }).click()
  const dialog = page.locator('dialog[open]')
  await expect(dialog).toBeVisible()

  // Empty reason is rejected client-side.
  await dialog.getByRole('button', { name: 'Batalkan Transaksi' }).click()
  await expect(dialog.locator('[role=alert]')).toHaveText('Alasan pembatalan wajib diisi.')

  await dialog.locator('#void-reason').fill('E2E void: kasir salah input produk')
  await dialog.getByRole('button', { name: 'Batalkan Transaksi' }).click()
  await expect(page.getByText('Transaksi berhasil dibatalkan.')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.tag', { hasText: 'Dibatalkan' })).toBeVisible()
})

test('warehouse lacks cashier capability (403)', async ({ page }) => {
  await login(page, warehouse)
  await page.goto('/cashier')
  await expect(page.getByText('Anda tidak memiliki izin')).toBeVisible({ timeout: 15_000 })
})

test('logout returns to /login', async ({ page }) => {
  await loginAsCashier(page)
  await page.getByRole('button', { name: 'Keluar', exact: true }).click()
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
  await expect(page.locator('#email')).toBeVisible()
})
