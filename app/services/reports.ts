import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'
import type {
  DailySummaryRow,
  ExceptionCategory,
  ExceptionReportResult,
  ExceptionRow,
  ProductSalesReportResult,
  ProductSalesRow,
  SalesReportResult,
  SalesReportRow,
} from '~/types/reports'
import {
  EXCEPTION_CATEGORY_LABELS,
  REPORT_ROW_LIMIT,
  describeReportError,
  roundMoney,
  roundQuantity,
  salesTotals,
  summarizeSales,
} from '~/types/reports'

type Client = SupabaseClient<Database>

function fail(error: { message: string }): never {
  throw new Error(describeReportError(error.message))
}

interface TransactionReportRow {
  id: string
  receipt_no: string
  business_date: string
  cashier_id: string
  subtotal: number
  discount_amount: number
  grand_total: number
  status: string
  created_at: string
  payments: Array<{ method: string }> | null
}

const SALES_SELECT =
  'id, receipt_no, business_date, cashier_id, subtotal, discount_amount, grand_total, status, created_at, payments(method)'

/**
 * Payments can be split; the report shows the dominant method and marks a
 * genuinely mixed note as `split` instead of silently picking the first row.
 */
export function reportPaymentMethod(payments: Array<{ method: string }> | null): string {
  if (!payments || payments.length === 0) return ''
  const methods = [...new Set(payments.map((payment) => payment.method))]
  return methods.length > 1 ? 'split' : methods[0]!
}

export interface SalesReportOptions {
  /** `completed` (default) counts revenue; `all` also lists voided notes. */
  status?: 'completed' | 'voided' | 'all'
  limit?: number
}

/**
 * RPT-01 + RPT-02. Rows are fetched once (capped) and aggregated locally,
 * because PostgREST cannot GROUP BY. The cap is surfaced as `truncated` so a
 * busy range never looks complete when it is not.
 */
export async function loadSalesReport(
  client: Client,
  range: { from: string; to: string },
  options: SalesReportOptions = {},
): Promise<SalesReportResult> {
  const status = options.status ?? 'completed'
  const limit = Math.min(options.limit ?? REPORT_ROW_LIMIT, REPORT_ROW_LIMIT)

  let query = client
    .from('transactions')
    .select(SALES_SELECT, { count: 'exact' })
    .order('business_date', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })

  if (range.from) query = query.gte('business_date', range.from)
  if (range.to) query = query.lte('business_date', range.to)
  if (status !== 'all') query = query.eq('status', status)
  query = query.limit(limit)

  const { data, error, count } = await query.returns<TransactionReportRow[]>()
  if (error) fail(error)

  const rows = (data ?? []).map((row): SalesReportRow => ({
    id: row.id,
    receiptNo: row.receipt_no,
    businessDate: row.business_date,
    cashierId: row.cashier_id,
    subtotal: Number(row.subtotal),
    discountAmount: Number(row.discount_amount),
    grandTotal: Number(row.grand_total),
    paymentMethod: reportPaymentMethod(row.payments),
    status: row.status,
    createdAt: row.created_at,
  }))

  const total = count ?? rows.length
  return {
    rows,
    total,
    truncated: total > rows.length,
    summary: summarizeSales(rows),
    totals: salesTotals(rows),
  }
}

// ---------------------------------------------------------------------------
// RPT-03 — penjualan per produk
// ---------------------------------------------------------------------------

interface ItemReportRow {
  transaction_id: string
  product_id: string | null
  sku_snapshot: string
  product_name_snapshot: string
  unit_label_snapshot: string
  quantity: number
  line_subtotal: number
  line_discount_amount: number
  line_total: number
  transactions: { status: string; business_date: string } | null
}

const ITEM_SELECT =
  'transaction_id, product_id, sku_snapshot, product_name_snapshot, unit_label_snapshot, quantity, line_subtotal, line_discount_amount, line_total, transactions!inner(status, business_date)'

/**
 * RPT-03. Aggregates by `product_id` when the line is mapped, otherwise by the
 * SKU snapshot, so legacy lines without a product mapping are still counted
 * instead of disappearing from the report.
 */
export async function loadProductSalesReport(
  client: Client,
  range: { from: string; to: string },
  limit = REPORT_ROW_LIMIT,
): Promise<ProductSalesReportResult> {
  let query = client
    .from('transaction_items')
    .select(ITEM_SELECT, { count: 'exact' })
    .eq('transactions.status', 'completed')
    .order('business_date', { referencedTable: 'transactions', ascending: false })
    .limit(Math.min(limit, REPORT_ROW_LIMIT))

  if (range.from) query = query.gte('transactions.business_date', range.from)
  if (range.to) query = query.lte('transactions.business_date', range.to)

  const { data, error, count } = await query.returns<ItemReportRow[]>()
  if (error) fail(error)

  const lines = data ?? []
  const byProduct = new Map<string, ProductSalesRow & { transactionIds: Set<string> }>()

  for (const line of lines) {
    const key = line.product_id ?? `sku:${line.sku_snapshot}`
    const current = byProduct.get(key) ?? {
      key,
      sku: line.sku_snapshot,
      productName: line.product_name_snapshot,
      unitLabel: line.unit_label_snapshot,
      quantitySold: 0,
      grossSales: 0,
      lineDiscount: 0,
      netSales: 0,
      transactionCount: 0,
      transactionIds: new Set<string>(),
    }

    current.quantitySold += Number(line.quantity)
    current.grossSales += Number(line.line_subtotal)
    current.lineDiscount += Number(line.line_discount_amount)
    current.netSales += Number(line.line_total)
    current.transactionIds.add(line.transaction_id)

    byProduct.set(key, current)
  }

  const rows = [...byProduct.values()]
    .map((row) => ({
      key: row.key,
      sku: row.sku,
      productName: row.productName,
      unitLabel: row.unitLabel,
      quantitySold: roundQuantity(row.quantitySold),
      grossSales: roundMoney(row.grossSales),
      lineDiscount: roundMoney(row.lineDiscount),
      netSales: roundMoney(row.netSales),
      transactionCount: row.transactionIds.size,
    }))
    .sort((a, b) => b.netSales - a.netSales || a.sku.localeCompare(b.sku))

  const totalLines = count ?? lines.length
  return {
    rows,
    transactionCount: new Set(lines.map((line) => line.transaction_id)).size,
    truncated: totalLines > lines.length,
  }
}

// ---------------------------------------------------------------------------
// RPT-06 — exception data
// ---------------------------------------------------------------------------

interface ProductExceptionRow {
  id: string
  sku: string
  name: string
  stock_on_hand: number | null
  sale_price: number | null
  import_review_status: string
  created_at: string
  product_costs: { purchase_cost: number | null } | null
}

const PRODUCT_EXCEPTION_SELECT =
  'id, sku, name, stock_on_hand, sale_price, import_review_status, created_at, product_costs(purchase_cost)'

interface TransactionExceptionRow {
  id: string
  receipt_no: string
  business_date: string
  reconciliation_status: string
}

const EMPTY_COUNTS = (): Record<ExceptionCategory, number> => ({
  stock_unknown: 0,
  negative_stock: 0,
  sale_price_missing: 0,
  purchase_cost_missing: 0,
  review_pending: 0,
  legacy_mismatch: 0,
})

function productExceptionRow(
  row: ProductExceptionRow,
  category: ExceptionCategory,
  detail: string | null,
): ExceptionRow {
  return {
    id: `${category}:${row.id}`,
    category,
    sku: row.sku,
    label: row.name,
    detail,
    reference: null,
    referencePath: null,
    createdAt: row.created_at,
  }
}

/**
 * RPT-06. Owner-only by capability: `product_costs` RLS hides purchase cost
 * from everyone else, so this report is never offered to staff.
 *
 * The report reads the same facts the catalog page shows, plus transactions
 * whose legacy reconciliation never matched. It does not invent a "missing
 * cost" row for products that simply have no `product_costs` entry — those
 * are reported as missing too, because the cost is unknown either way.
 */
export async function loadExceptionReport(
  client: Client,
  limit = REPORT_ROW_LIMIT,
): Promise<ExceptionReportResult> {
  const capped = Math.min(limit, REPORT_ROW_LIMIT)

  const [productsResult, transactionsResult] = await Promise.all([
    client
      .from('products')
      .select(PRODUCT_EXCEPTION_SELECT, { count: 'exact' })
      .order('sku_normalized', { ascending: true })
      .limit(capped)
      .returns<ProductExceptionRow[]>(),
    client
      .from('transactions')
      .select('id, receipt_no, business_date, reconciliation_status', { count: 'exact' })
      .neq('reconciliation_status', 'matched')
      .order('business_date', { ascending: false })
      .limit(capped)
      .returns<TransactionExceptionRow[]>(),
  ])

  if (productsResult.error) fail(productsResult.error)
  if (transactionsResult.error) fail(transactionsResult.error)

  const rows: ExceptionRow[] = []
  const counts = EMPTY_COUNTS()

  for (const product of productsResult.data ?? []) {
    if (product.stock_on_hand === null) {
      rows.push(productExceptionRow(product, 'stock_unknown', 'Saldo belum pernah dihitung.'))
      counts.stock_unknown += 1
    } else if (Number(product.stock_on_hand) < 0) {
      rows.push(productExceptionRow(product, 'negative_stock', 'Saldo negatif perlu opname ulang.'))
      counts.negative_stock += 1
    }

    if (product.sale_price === null) {
      rows.push(productExceptionRow(product, 'sale_price_missing', 'Produk tidak dapat dijual.'))
      counts.sale_price_missing += 1
    }

    if (product.product_costs?.purchase_cost === null || product.product_costs?.purchase_cost === undefined) {
      rows.push(productExceptionRow(product, 'purchase_cost_missing', 'Margin tidak dapat dihitung.'))
      counts.purchase_cost_missing += 1
    }

    if (product.import_review_status !== 'verified') {
      rows.push(
        productExceptionRow(
          product,
          'review_pending',
          `Status impor: ${product.import_review_status}.`,
        ),
      )
      counts.review_pending += 1
    }
  }

  for (const transaction of transactionsResult.data ?? []) {
    rows.push({
      id: `legacy:${transaction.id}`,
      category: 'legacy_mismatch',
      sku: transaction.receipt_no,
      label: 'Transaksi legacy',
      detail:
        transaction.reconciliation_status === 'reviewed'
          ? 'Sudah ditinjau, masih ditandai tidak cocok.'
          : 'Total legacy tidak cocok dengan rincian.',
      reference: transaction.receipt_no,
      referencePath: `/cashier/transactions/${transaction.id}`,
      createdAt: transaction.business_date,
    })
    counts.legacy_mismatch += 1
  }

  const productTotal = productsResult.count ?? productsResult.data?.length ?? 0
  const transactionTotal = transactionsResult.count ?? transactionsResult.data?.length ?? 0

  return {
    rows,
    counts,
    truncated: productTotal > capped || transactionTotal > capped,
  }
}

export { EXCEPTION_CATEGORY_LABELS }
export type { DailySummaryRow }
