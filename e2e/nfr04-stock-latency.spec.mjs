import { test, expect, chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * NFR-04 — two real browsers, one stock change.
 *
 * Cashier A checks out a product; cashier B, sitting on the cashier page with
 * the same product in its search results, must see the new balance without
 * reloading. The measured budget is 2 seconds from the moment the sale is
 * committed in PostgreSQL to the moment B's cell shows the new number.
 *
 * This is a display-sync guarantee only: checkout always revalidates stock in
 * the database, so a late message can never oversell.
 */
test.setTimeout(180_000)

const accounts = JSON.parse(readFileSync(new URL('../.tmp/phase2b-accounts.json', import.meta.url), 'utf8'))
const byRole = Object.fromEntries(accounts.map((account) => [account.role, account]))
const cashierA = byRole.cashier
const cashierB = byRole.cashier_b

// A dedicated fixture with enough stock for a repeatable run.
const SKU = 'TEST-TXN-PAY-001'

const BUDGET_MS = 2_000

async function login(page, account) {
  await page.goto('/login')
  await page.fill('#email', account.email)
  await page.fill('#password', account.password)
  await page.getByRole('button', { name: 'Masuk' }).click()
  await expect(page).toHaveURL(/\/(dashboard|cashier|products)/, { timeout: 25_000 })
}

async function openCashier(page, account) {
  await login(page, account)
  await page.goto('/cashier')
  await expect(page.getByRole('heading', { name: 'Kasir', exact: true })).toBeVisible({ timeout: 25_000 })
}

function stockCell(page) {
  return page.locator('table tbody tr', { hasText: SKU }).first().locator('td').nth(5)
}

test('NFR-04: a sale in browser A reaches browser B in under 2 seconds', async () => {
  const browser = await chromium.launch()

  // Two independent contexts: separate storage, separate sessions, exactly
  // like two physical tills.
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  try {
    await openCashier(pageA, cashierA)
    await openCashier(pageB, cashierB)

    // B must actually be subscribed; without the private channel the whole
    // measurement is meaningless.
    await expect(pageB.getByText('Stok live')).toBeVisible({ timeout: 25_000 })

    // Both tills show the same product and the same starting balance.
    await pageB.fill('#cashier-search', SKU)
    const rowB = pageB.locator('table tbody tr', { hasText: SKU }).first()
    await expect(rowB).toBeVisible({ timeout: 20_000 })
    const beforeText = (await stockCell(pageB).textContent())?.trim() ?? ''
    const before = Number(beforeText.replace(/\./g, '').replace(',', '.'))
    expect(Number.isFinite(before)).toBe(true)
    expect(before).toBeGreaterThan(0)

    // A rings up one unit and pays cash.
    await pageA.fill('#cashier-search', SKU)
    const rowA = pageA.locator('table tbody tr', { hasText: SKU }).first()
    await expect(rowA).toBeVisible({ timeout: 20_000 })
    await rowA.getByRole('button', { name: 'Tambah' }).click()
    await pageA.fill('#cash-received', '50000')

    // Start the clock when the sale is submitted; stop it when B's cell
    // actually renders the new balance. The RPC round trip is inside the
    // measurement, so the number is an honest end-to-end figure.
    const started = Date.now()
    await pageA.getByRole('button', { name: 'Bayar & simpan' }).click()
    const receipt = pageA.getByRole('dialog', { name: /^Nota / })
    await expect(receipt).toBeVisible({ timeout: 30_000 })

    await expect(stockCell(pageB)).toHaveText(String(before - 1), { timeout: BUDGET_MS })
    const elapsed = Date.now() - started

    console.log(`      NFR-04: stok ${before} -> ${before - 1} terlihat di browser B dalam ${elapsed} ms`)
    expect(elapsed, `Realtime butuh ${elapsed} ms, melebihi budget ${BUDGET_MS} ms`).toBeLessThan(BUDGET_MS)

    // No reload happened: the page is still the same document and B's search
    // term is untouched.
    await expect(pageB).toHaveURL(/\/cashier$/)
    await expect(pageB.locator('#cashier-search')).toHaveValue(SKU)

    await receipt.getByRole('button', { name: 'Tutup' }).click()
  } finally {
    await contextA.close()
    await contextB.close()
    await browser.close()
  }
})
