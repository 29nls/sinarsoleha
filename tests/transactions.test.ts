import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import {
  emptyFilters,
  validateVoidReason,
  statusLabel,
  paymentMethodLabel,
  describeTransactionError,
} from '~/types/transactions'
import { mapReceiptRow } from '~/utils/receipt'
import TransactionTable from '~/components/transactions/TransactionTable.vue'

// --- helpers & types ---

function txnRow(overrides = {}) {
  return {
    id: 'tx-1',
    receiptNo: 'SS-20261103-0001',
    businessDate: '2026-11-03',
    cashierId: 'u1',
    cashierName: 'Kasir Uji',
    itemCount: 3,
    subtotal: 15000,
    discountAmount: 0,
    grandTotal: 15000,
    paymentMethod: 'cash',
    status: 'completed',
    createdAt: '2026-11-03T10:00:00Z',
    ...overrides,
  }
}

// --- Type helpers & validation ---

describe('emptyFilters', () => {
  it('returns blank filter defaults', () => {
    const f = emptyFilters()
    expect(f.dateFrom).toBe('')
    expect(f.dateTo).toBe('')
    expect(f.receiptSearch).toBe('')
    expect(f.status).toBe('')
    expect(f.paymentMethod).toBe('')
    expect(f.cashierId).toBe('')
  })
})

describe('validateVoidReason', () => {
  it('rejects empty reason', () => {
    expect(validateVoidReason('')).toContain('wajib')
    expect(validateVoidReason('   ')).toContain('wajib')
  })

  it('accepts valid reason', () => {
    expect(validateVoidReason('Salah input')).toBeNull()
  })

  it('rejects reason over 500 chars', () => {
    expect(validateVoidReason('x'.repeat(501))).toContain('500')
  })

  it('accepts exactly 500 chars', () => {
    expect(validateVoidReason('x'.repeat(500))).toBeNull()
  })
})

describe('statusLabel', () => {
  it('maps known statuses', () => {
    expect(statusLabel('completed')).toBe('Selesai')
    expect(statusLabel('voided')).toBe('Dibatalkan')
  })

  it('falls back to raw value for unknown', () => {
    expect(statusLabel('pending')).toBe('pending')
  })
})

describe('paymentMethodLabel', () => {
  it('maps known methods', () => {
    expect(paymentMethodLabel('cash')).toBe('Tunai')
    expect(paymentMethodLabel('qris')).toBe('QRIS')
    expect(paymentMethodLabel('other')).toBe('Lainnya')
  })
})

describe('describeTransactionError', () => {
  it('maps known RPC errors', () => {
    expect(describeTransactionError('VOID_REASON_REQUIRED')).toContain('wajib')
    expect(describeTransactionError('TRANSACTION_NOT_FOUND')).toContain('tidak ditemukan')
    expect(describeTransactionError('permission denied')).toContain('izin')
  })

  it('strips error prefix from unknown messages', () => {
    expect(describeTransactionError('UNKNOWN_CODE: details')).toBe('details')
  })
})

// --- mapReceiptRow for history detail (profiles: null) ---

describe('mapReceiptRow for history detail', () => {
  it('uses fallback cashier name when profiles is null', () => {
    const row = {
      id: 'tx-1',
      receipt_no: 'SS-20261103-0001',
      business_date: '2026-11-03',
      cashier_id: 'u1',
      status: 'completed',
      subtotal: 5000,
      discount_amount: 0,
      grand_total: 5000,
      created_at: '2026-11-03T10:00:00Z',
      profiles: null,
      transaction_items: [
        {
          sku_snapshot: 'SKU-1',
          product_name_snapshot: 'Produk A',
          unit_label_snapshot: 'Pcs',
          quantity: 2,
          unit_price: 2500,
          line_discount_amount: 0,
          line_total: 5000,
        },
      ],
      payments: [
        { method: 'cash', amount_applied: 5000, cash_received: 5000, cash_change: 0 },
      ],
    }
    const detail = mapReceiptRow(row)
    expect(detail.cashierName).toBe('')
    expect(detail.items).toHaveLength(1)
    expect(detail.items[0].sku).toBe('SKU-1')
    expect(detail.items[0].name).toBe('Produk A')
    expect(detail.payments[0].method).toBe('cash')
    expect(detail.grandTotal).toBe(5000)
  })

  it('handles null nested arrays gracefully', () => {
    const row = {
      id: 'tx-2',
      receipt_no: 'SS-20261103-0002',
      business_date: '2026-11-03',
      cashier_id: 'u1',
      status: 'completed',
      subtotal: 0,
      discount_amount: 0,
      grand_total: 0,
      created_at: '2026-11-03T10:00:00Z',
      profiles: null,
      transaction_items: null,
      payments: null,
    }
    const detail = mapReceiptRow(row)
    expect(detail.items).toEqual([])
    expect(detail.payments).toEqual([])
  })
})

// --- TransactionTable SSR ---

const baseProps = {
  rows: [],
  loading: false,
  error: null as string | null,
  page: 1,
  pageSize: 25,
  total: 0,
  isOwner: false,
}

async function renderTable(overrides: Partial<typeof baseProps> = {}): Promise<string> {
  const app = createSSRApp({
    render: () => h(TransactionTable, { ...baseProps, ...overrides }),
  })
  return renderToString(app)
}

describe('TransactionTable', () => {
  it('renders loading state', async () => {
    const html = await renderTable({ loading: true })
    expect(html).toContain('Memuat transaksi')
    expect(html).not.toContain('Tidak ada transaksi')
  })

  it('renders empty state', async () => {
    const html = await renderTable()
    expect(html).toContain('Tidak ada transaksi yang cocok')
  })

  it('renders error state', async () => {
    const html = await renderTable({ error: 'Koneksi gagal' })
    expect(html).toContain('Koneksi gagal')
  })

  it('renders a transaction row', async () => {
    const html = await renderTable({ rows: [txnRow()], total: 1 })
    expect(html).toContain('SS-20261103-0001')
    expect(html).toContain('15.000')
    expect(html).toContain('Selesai')
    expect(html).toContain('Tunai')
    expect(html).toContain('Detail')
  })

  it('renders voided status with danger tag', async () => {
    const html = await renderTable({ rows: [txnRow({ status: 'voided' })], total: 1 })
    expect(html).toContain('Dibatalkan')
    expect(html).toContain('tag-danger')
  })
})
