import { describe, expect, it, vi } from 'vitest'
import {
  loadExceptionReport,
  loadProductSalesReport,
  loadSalesReport,
  reportPaymentMethod,
} from '../app/services/reports'

type Result = { data: unknown; error: unknown; count?: number | null }

function queryClient(result: Result | Result[]) {
  const queue = Array.isArray(result) ? [...result] : [result]
  const calls: Array<[string, unknown[]]> = []
  const builders: Array<Record<string, unknown>> = []

  const makeBuilder = () => {
    const builder: Record<string, unknown> = {}
    const record = (name: string) => (...args: unknown[]) => {
      calls.push([name, args])
      return builder
    }
    for (const method of [
      'select', 'order', 'eq', 'neq', 'lt', 'is', 'gte', 'lte', 'or', 'limit', 'range',
    ]) {
      builder[method] = record(method)
    }
    builder.returns = vi.fn().mockImplementation(() => Promise.resolve(queue.shift() ?? result))
    builders.push(builder)
    return builder
  }

  const from = vi.fn().mockImplementation(() => makeBuilder())
  return { client: { from } as never, from, calls, builders }
}

describe('reportPaymentMethod', () => {
  it('marks a genuinely split payment', () => {
    expect(reportPaymentMethod([{ method: 'cash' }, { method: 'qris' }])).toBe('split')
  })

  it('returns the single method, or empty when there is none', () => {
    expect(reportPaymentMethod([{ method: 'qris' }, { method: 'qris' }])).toBe('qris')
    expect(reportPaymentMethod(null)).toBe('')
    expect(reportPaymentMethod([])).toBe('')
  })
})

describe('loadSalesReport', () => {
  it('filters completed notes inside the date range', async () => {
    const { client, from, calls } = queryClient({ data: [], error: null, count: 0 })

    await loadSalesReport(client, { from: '2026-11-01', to: '2026-11-04' })

    expect(from).toHaveBeenCalledWith('transactions')
    expect(calls).toContainEqual(['eq', ['status', 'completed']])
    expect(calls).toContainEqual(['gte', ['business_date', '2026-11-01']])
    expect(calls).toContainEqual(['lte', ['business_date', '2026-11-04']])
  })

  it('can include voided notes when explicitly requested', async () => {
    const { client, calls } = queryClient({ data: [], error: null, count: 0 })

    await loadSalesReport(client, { from: '', to: '' }, { status: 'all' })

    expect(calls.some(([name]) => name === 'eq')).toBe(false)
  })

  it('maps rows and aggregates the totals', async () => {
    const { client } = queryClient({
      data: [
        {
          id: 't-1',
          receipt_no: 'SS-20261104-0001',
          business_date: '2026-11-04',
          cashier_id: 'u-1',
          subtotal: '100000.00',
          discount_amount: '5000.00',
          grand_total: '95000.00',
          status: 'completed',
          created_at: '2026-11-04T03:00:00Z',
          payments: [{ method: 'cash' }],
        },
      ],
      error: null,
      count: 1,
    })

    const result = await loadSalesReport(client, { from: '2026-11-01', to: '2026-11-04' })

    expect(result.rows[0]).toMatchObject({
      receiptNo: 'SS-20261104-0001',
      paymentMethod: 'cash',
      grandTotal: 95000,
    })
    expect(result.totals).toMatchObject({
      transactionCount: 1,
      netSales: 95000,
      cashTotal: 95000,
    })
    expect(result.truncated).toBe(false)
  })

  it('reports truncation when the range holds more rows than the cap', async () => {
    const { client } = queryClient({
      data: [
        {
          id: 't-1',
          receipt_no: 'SS-20261104-0001',
          business_date: '2026-11-04',
          cashier_id: 'u-1',
          subtotal: 10,
          discount_amount: 0,
          grand_total: 10,
          status: 'completed',
          created_at: '2026-11-04T03:00:00Z',
          payments: [],
        },
      ],
      error: null,
      count: 900,
    })

    const result = await loadSalesReport(client, { from: '2026-01-01', to: '2026-11-04' })

    expect(result.truncated).toBe(true)
    expect(result.total).toBe(900)
  })

  it('throws a translated error', async () => {
    const { client } = queryClient({
      data: null,
      error: { message: 'permission denied for table transactions' },
      count: null,
    })

    await expect(loadSalesReport(client, { from: '', to: '' }))
      .rejects.toThrow('Anda tidak memiliki izin untuk membaca laporan ini.')
  })
})

describe('loadProductSalesReport', () => {
  it('joins completed transactions and filters the business date', async () => {
    const { client, from, calls } = queryClient({ data: [], error: null, count: 0 })

    await loadProductSalesReport(client, { from: '2026-11-01', to: '2026-11-04' })

    expect(from).toHaveBeenCalledWith('transaction_items')
    expect(calls).toContainEqual(['eq', ['transactions.status', 'completed']])
    expect(calls).toContainEqual(['gte', ['transactions.business_date', '2026-11-01']])
    expect(calls).toContainEqual(['lte', ['transactions.business_date', '2026-11-04']])
  })

  it('aggregates lines by product and counts distinct notes', async () => {
    const base = {
      product_id: 'p-1',
      sku_snapshot: 'BERAS-5',
      product_name_snapshot: 'Beras 5 kg',
      unit_label_snapshot: 'Karung',
      transactions: { status: 'completed', business_date: '2026-11-04' },
    }
    const { client } = queryClient({
      data: [
        { ...base, transaction_id: 't-1', quantity: '2.000', line_subtotal: '200000', line_discount_amount: '0', line_total: '200000' },
        { ...base, transaction_id: 't-2', quantity: '1.500', line_subtotal: '150000', line_discount_amount: '10000', line_total: '140000' },
      ],
      error: null,
      count: 2,
    })

    const result = await loadProductSalesReport(client, { from: '', to: '' })

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      sku: 'BERAS-5',
      quantitySold: 3.5,
      grossSales: 350000,
      lineDiscount: 10000,
      netSales: 340000,
      transactionCount: 2,
    })
    expect(result.transactionCount).toBe(2)
  })

  it('keeps unmapped legacy lines separate by SKU snapshot', async () => {
    const { client } = queryClient({
      data: [
        {
          transaction_id: 't-1',
          product_id: null,
          sku_snapshot: 'LEGACY-1',
          product_name_snapshot: 'Item lama',
          unit_label_snapshot: 'Pcs',
          quantity: 1,
          line_subtotal: 1000,
          line_discount_amount: 0,
          line_total: 1000,
          transactions: { status: 'completed', business_date: '2026-11-04' },
        },
      ],
      error: null,
      count: 1,
    })

    const result = await loadProductSalesReport(client, { from: '', to: '' })

    expect(result.rows[0]?.key).toBe('sku:LEGACY-1')
    expect(result.rows[0]?.sku).toBe('LEGACY-1')
  })
})

describe('loadExceptionReport', () => {
  it('collects catalog exceptions and legacy mismatches', async () => {
    const { client } = queryClient([
      {
        data: [
          {
            id: 'p-1',
            sku: 'BERAS-5',
            name: 'Beras 5 kg',
            stock_on_hand: null,
            sale_price: null,
            import_review_status: 'review_required',
            created_at: '2026-11-01T00:00:00Z',
            product_costs: { purchase_cost: null },
          },
        ],
        error: null,
        count: 1,
      },
      {
        data: [
          {
            id: 't-1',
            receipt_no: 'SS-20261104-0001',
            business_date: '2026-11-04',
            reconciliation_status: 'legacy_mismatch',
          },
        ],
        error: null,
        count: 1,
      },
    ])

    const result = await loadExceptionReport(client)

    expect(result.counts.stock_unknown).toBe(1)
    expect(result.counts.negative_stock).toBe(0)
    expect(result.counts.sale_price_missing).toBe(1)
    expect(result.counts.purchase_cost_missing).toBe(1)
    expect(result.counts.review_pending).toBe(1)
    expect(result.counts.legacy_mismatch).toBe(1)
    expect(result.rows.find((row) => row.category === 'legacy_mismatch')?.referencePath)
      .toBe('/cashier/transactions/t-1')
    expect(result.truncated).toBe(false)
  })

  it('treats a negative balance as negative, not unknown', async () => {
    const { client } = queryClient([
      {
        data: [
          {
            id: 'p-2',
            sku: 'NEG-1',
            name: 'Stok negatif',
            stock_on_hand: -2,
            sale_price: 1000,
            import_review_status: 'verified',
            created_at: '2026-11-01T00:00:00Z',
            product_costs: { purchase_cost: 500 },
          },
        ],
        error: null,
        count: 1,
      },
      { data: [], error: null, count: 0 },
    ])

    const result = await loadExceptionReport(client)

    expect(result.counts.negative_stock).toBe(1)
    expect(result.counts.stock_unknown).toBe(0)
    expect(result.rows).toHaveLength(1)
  })

  it('flags a missing cost row as an unknown cost', async () => {
    const { client } = queryClient([
      {
        data: [
          {
            id: 'p-3',
            sku: 'NOCOST-1',
            name: 'Tanpa biaya',
            stock_on_hand: 5,
            sale_price: 2000,
            import_review_status: 'verified',
            created_at: '2026-11-01T00:00:00Z',
            product_costs: null,
          },
        ],
        error: null,
        count: 1,
      },
      { data: [], error: null, count: 0 },
    ])

    const result = await loadExceptionReport(client)

    expect(result.counts.purchase_cost_missing).toBe(1)
  })
})
