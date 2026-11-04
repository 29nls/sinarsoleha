#!/usr/bin/env node
/**
 * Read-only fixture inventory for the preview project.
 *
 * Answers one question per test product: which tables still point at it?
 * Nothing is written, deactivated, or deleted. The classification is derived
 * from those references so cleanup cannot be proposed from SKU prefixes alone.
 *
 *   node scripts/fixture-audit.mjs          # human-readable table
 *   node scripts/fixture-audit.mjs --json   # machine-readable, for the report
 *
 * Only TEST-* and HOST-* SKUs are inspected. Imported business products are
 * never selected.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const PREVIEW_REF = 'ptbllrugrjepdhhdkzxn'
const JSON_OUT = process.argv.includes('--json')

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

const accounts = JSON.parse(readFileSync('.tmp/phase2b-accounts.json', 'utf8'))
const owner = accounts.find((account) => account.role === 'owner')
if (!owner) throw new Error('owner account missing from .tmp/phase2b-accounts.json')

const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})
const { error: signInError } = await client.auth.signInWithPassword({
  email: owner.email,
  password: owner.password,
})
if (signInError) throw new Error(`owner sign-in failed: ${signInError.message}`)

function unwrap(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data ?? []
}

// ---------------------------------------------------------------- products ---

const products = unwrap(
  await client
    .from('products')
    .select('id, sku, name, is_active, stock_on_hand, stock_version, sale_price, import_review_status, created_at, updated_at')
    .or('sku.like.TEST-%,sku.like.HOST-%')
    .order('sku'),
  'products',
)

const ids = products.map((product) => product.id)
if (ids.length === 0) {
  console.log('No TEST-*/HOST-* products found.')
  process.exit(0)
}

// Every reference table is fetched once and grouped in memory; per-product
// count queries would be dozens of round trips for the same answer.
const [
  transactionItems,
  movements,
  opnameItems,
  discrepancyLogs,
  costs,
  aliases,
  auditLogs,
] = await Promise.all([
  client.from('transaction_items').select('product_id, transaction_id').in('product_id', ids),
  client
    .from('stock_movements')
    .select('product_id, movement_type, quantity_delta, created_at')
    .in('product_id', ids),
  client
    .from('stock_opname_items')
    .select('product_id, count_status, stock_opname_id, stock_opnames(opname_no, status)')
    .in('product_id', ids),
  client.from('stock_discrepancy_logs').select('product_id').in('product_id', ids),
  client.from('product_costs').select('product_id').in('product_id', ids),
  client.from('product_aliases').select('product_id').in('product_id', ids),
  client
    .from('audit_logs')
    .select('entity_id, action_key')
    .eq('entity_name', 'products')
    .in('entity_id', ids),
].map((promise, index) => promise.then((result) => unwrap(result, `reference query ${index}`))))

const transactionIds = [...new Set(transactionItems.map((row) => row.transaction_id))]
const payments = transactionIds.length
  ? unwrap(
      await client.from('payments').select('transaction_id').in('transaction_id', transactionIds),
      'payments',
    )
  : []

const group = (rows, field) => {
  const map = new Map()
  for (const row of rows) {
    const value = row[field]
    if (!map.has(value)) map.set(value, [])
    map.get(value).push(row)
  }
  return map
}

const byTransaction = group(transactionItems, 'product_id')
const byMovement = group(movements, 'product_id')
const byOpnameItem = group(opnameItems, 'product_id')
const byDiscrepancy = group(discrepancyLogs, 'product_id')
const byCost = group(costs, 'product_id')
const byAlias = group(aliases, 'product_id')
const byAudit = group(auditLogs, 'entity_id')
const paymentIds = new Set(payments.map((row) => row.transaction_id))

const rows = products.map((product) => {
  const txItems = byTransaction.get(product.id) ?? []
  const txIds = [...new Set(txItems.map((row) => row.transaction_id))]
  const movementRows = byMovement.get(product.id) ?? []
  const opnameRows = byOpnameItem.get(product.id) ?? []
  const discrepancyRows = byDiscrepancy.get(product.id) ?? []
  const auditRows = byAudit.get(product.id) ?? []

  const postedOpnameRows = opnameRows.filter((row) => row.stock_opnames?.status === 'posted')
  const immutable = {
    transactionItems: txItems.length,
    payments: txIds.filter((id) => paymentIds.has(id)).length,
    stockMovements: movementRows.length,
    postedOpnameItems: postedOpnameRows.length,
    discrepancyLogs: discrepancyRows.length,
  }
  const hasImmutableHistory =
    immutable.transactionItems > 0 ||
    immutable.stockMovements > 0 ||
    immutable.postedOpnameItems > 0 ||
    immutable.discrepancyLogs > 0

  const refs = {
    ...immutable,
    opnameItems: opnameRows.length,
    auditLogs: auditRows.length,
    productCosts: (byCost.get(product.id) ?? []).length,
    productAliases: (byAlias.get(product.id) ?? []).length,
  }
  const totalRefs = Object.values(refs).reduce((sum, value) => sum + value, 0)
  // Audit rows point at the product through a text column with no foreign key,
  // so they are reported but do not by themselves make a product "referenced".
  const fkRefs = totalRefs - refs.auditLogs

  let classification
  if (fkRefs === 0) classification = 'A'
  else if (hasImmutableHistory) classification = product.is_active ? 'C' : 'D'
  else classification = 'B'

  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    isActive: product.is_active,
    stockOnHand: product.stock_on_hand,
    stockVersion: product.stock_version,
    salePrice: product.sale_price,
    importReviewStatus: product.import_review_status,
    createdAt: product.created_at,
    updatedAt: product.updated_at,
    refs,
    totalRefs,
    classification,
    opnames: opnameRows.map((row) => ({
      opnameNo: row.stock_opnames?.opname_no ?? null,
      status: row.stock_opnames?.status ?? null,
      countStatus: row.count_status,
    })),
    movementTypes: [...new Set(movementRows.map((row) => row.movement_type))],
    lastMovementAt: movementRows.map((row) => row.created_at).sort().at(-1) ?? null,
    auditActions: [...new Set(auditRows.map((row) => row.action_key))],
    recommendation:
      classification === 'A'
        ? 'Tidak direferensikan; kandidat hapus fisik setelah approval. Default: nonaktifkan.'
        : classification === 'B'
          ? 'Punya referensi non-ledger; nonaktifkan, jangan hapus.'
          : 'Punya riwayat immutable; wajib diarsipkan (nonaktif), jangan hapus.',
  }
})

const summary = {
  target: ref,
  generatedAt: new Date().toISOString(),
  totals: {
    products: rows.length,
    active: rows.filter((row) => row.isActive).length,
    inactive: rows.filter((row) => !row.isActive).length,
    A: rows.filter((row) => row.classification === 'A').length,
    B: rows.filter((row) => row.classification === 'B').length,
    C: rows.filter((row) => row.classification === 'C').length,
    D: rows.filter((row) => row.classification === 'D').length,
  },
  rows,
}

if (JSON_OUT) {
  console.log(JSON.stringify(summary, null, 2))
  process.exit(0)
}

console.log(`target: preview ${ref}`)
console.log(`read-only; ${rows.length} TEST-*/HOST-* products\n`)
for (const row of rows) {
  console.log(
    `${row.classification}  ${row.sku.padEnd(30)} active=${String(row.isActive).padEnd(5)} ` +
      `stock=${String(row.stockOnHand ?? 'NULL').padEnd(6)} v=${row.stockVersion} ` +
      `tx=${row.refs.transactionItems} pay=${row.refs.payments} mv=${row.refs.stockMovements} ` +
      `op=${row.refs.opnameItems} log=${row.refs.discrepancyLogs} audit=${row.refs.auditLogs} ` +
      `cost=${row.refs.productCosts} alias=${row.refs.productAliases}`,
  )
  console.log(`    ${row.id}  ${row.name}`)
}
console.log(
  `\nA=${summary.totals.A} B=${summary.totals.B} C=${summary.totals.C} D=${summary.totals.D} ` +
    `(active ${summary.totals.active}, inactive ${summary.totals.inactive})`,
)
console.log('READ-ONLY — nothing written.')
