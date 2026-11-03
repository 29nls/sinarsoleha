import { beforeEach, describe, expect, it } from 'vitest'
import { effectScope } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import {
  addToCart,
  buildCheckoutPayload,
  businessDateJakarta,
  cashChangeCents,
  changeQuantity,
  decimalScaleError,
  describeCashierError,
  lineTotalCents,
  paymentModeDefaults,
  paymentsTotalCents,
  sellability,
  toCents,
  validatePayments,
  validateQuantity,
} from '../app/utils/cashier'
import { useCashierStore } from '../app/stores/cashier'
import { can } from '../app/utils/permissions'
import { mapReceiptRow } from '../app/utils/receipt'
import { useCashierSearch } from '../app/composables/useCashierSearch'

function product(overrides = {}) {
  return {
    id: 'p1',
    sku: 'SKU-1',
    name: 'Produk Uji',
    categoryName: 'Kategori',
    unitId: 1,
    unitLabel: 'Pcs',
    unitCode: 'PCS',
    decimalScale: 0,
    salePrice: 5000,
    stockOnHand: 10,
    isActive: true,
    ...overrides,
  }
}

function cash(id, amountCents, receivedCents) {
  return { id, method: 'cash', amountCents, cashReceivedCents: receivedCents }
}

function receipt() {
  return {
    transactionId: 'tx-1',
    receiptNo: 'SS-20261103-0001',
    businessDate: '2026-11-03',
    cashierName: 'Kasir Uji',
    status: 'completed',
    subtotal: 5000,
    discountAmount: 0,
    grandTotal: 5000,
    createdAt: '2026-11-03T10:00:00Z',
    items: [],
    payments: [],
  }
}

describe('sellability', () => {
  it('keeps unknown stock unknown and blocks it', () => {
    expect(sellability(product({ stockOnHand: null }))).toBe('stock_unknown')
  })

  it('blocks missing price, inactive and empty stock', () => {
    expect(sellability(product({ salePrice: null }))).toBe('price_missing')
    expect(sellability(product({ isActive: false }))).toBe('inactive')
    expect(sellability(product({ stockOnHand: 0 }))).toBe('out_of_stock')
    expect(sellability(product())).toBe('available')
  })
})

describe('cart', () => {
  it('aggregates duplicate products instead of adding a second row', () => {
    const first = addToCart([], product())
    const second = addToCart(first.lines, product())
    expect(second.lines).toHaveLength(1)
    expect(second.lines[0].quantity).toBe(2)
  })

  it('rejects quantities above visible stock and unknown stock', () => {
    const result = addToCart([], product(), 11)
    expect(result.error).toContain('Stok tersedia')
    expect(addToCart([], product({ stockOnHand: null })).error).toContain('belum diopname')
  })

  it('validates unit decimal scale', () => {
    const meter = product({ decimalScale: 3, unitLabel: 'Meter' })
    expect(validateQuantity('2.5', meter).quantity).toBe(2.5)
    expect(validateQuantity('2.5555', meter).error).toContain('3 angka desimal')
    expect(decimalScaleError(1.5, 0)).toContain('tidak menerima')
    expect(validateQuantity('0', meter).error).toContain('lebih besar dari nol')
  })

  it('updates and removes lines without touching the source array', () => {
    const start = addToCart([], product()).lines
    const changed = changeQuantity(start, 'p1', '3')
    const removed = changeQuantity(changed.lines, 'p1', '0')
    expect(changed.lines[0].quantity).toBe(3)
    expect(changed.error).toBeNull()
    expect(removed.error).toContain('lebih besar dari nol')
    expect(start[0].quantity).toBe(1)
  })

  it('computes line and cart totals in integer cents', () => {
    const meter = product({ id: 'p2', decimalScale: 3, salePrice: 1250.5 })
    expect(lineTotalCents(meter, 2.5)).toBe(312625)
    expect(lineTotalCents(product(), 2)).toBe(1000000)
    expect(toCents('10.005')).toBe(1001)
  })
})

describe('payments', () => {
  it('accepts exact cash and computes change', () => {
    const payment = cash('a', 10000, 20000)
    expect(validatePayments([payment], 10000).error).toBeNull()
    expect(cashChangeCents([payment])).toBe(10000)
    expect(paymentsTotalCents([payment])).toBe(10000)
  })

  it('rejects short cash, wrong change source and non-cash cash fields', () => {
    expect(validatePayments([cash('a', 10000, 9000)], 10000).error).toContain('kurang')
    expect(
      validatePayments([{ id: 'b', method: 'qris', amountCents: 10000, cashReceivedCents: 10000 }], 10000)
        .error,
    ).toContain('non-tunai')
    expect(validatePayments([], 10000).error).toContain('belum diisi')
  })

  it('supports split payments only when the total matches', () => {
    const split = [cash('a', 4000, 5000), { id: 'b', method: 'qris', amountCents: 6000, cashReceivedCents: null }]
    expect(validatePayments(split, 10000).error).toBeNull()
    expect(cashChangeCents(split)).toBe(1000)
    expect(validatePayments(split, 11000).error).toContain('sama dengan total')
  })
})

describe('checkout payload', () => {
  it('sends only contract fields, zero discount and cent-safe amounts', () => {
    const payload = buildCheckoutPayload({
      idempotencyKey: 'key-1',
      businessDate: '2026-11-03',
      lines: [{ product: product(), quantity: 2 }],
      payments: [cash('a', 1000000, 2000000)],
    })

    expect(payload).toEqual({
      idempotency_key: 'key-1',
      business_date: '2026-11-03',
      customer_id: null,
      discount_amount: 0,
      items: [{ product_id: 'p1', quantity: 2 }],
      payments: [
        { method: 'cash', amount_applied: 10000, cash_received: 20000, cash_change: 10000 },
      ],
    })
    expect('cashier_id' in payload).toBe(false)
    expect('unit_price' in payload.items[0]).toBe(false)
  })

  it('omits cash fields for QRIS', () => {
    const payload = buildCheckoutPayload({
      idempotencyKey: 'key-2',
      businessDate: '2026-11-03',
      lines: [{ product: product(), quantity: 1 }],
      payments: [{ id: 'q', method: 'qris', amountCents: 500000, cashReceivedCents: null }],
    })
    expect(payload.payments[0]).toEqual({ method: 'qris', amount_applied: 5000 })
  })

  it('formats the Jakarta business date and maps backend errors', () => {
    expect(businessDateJakarta(new Date('2026-11-02T17:30:00Z'))).toBe('2026-11-03')
    expect(describeCashierError('INSUFFICIENT_STOCK: Stok PCS hanya 1.')).toContain('Stok berubah')
    expect(describeCashierError('PAYMENT_TOTAL_MISMATCH: x')).toContain('tidak sama')
    expect(describeCashierError('AUTH_REQUIRED: x')).toContain('Sesi berakhir')
  })
})

describe('authorization matrix', () => {
  it('allows owner and cashier to create sales, but not warehouse', () => {
    expect(can('owner', 'sale.create')).toBe(true)
    expect(can('cashier', 'sale.create')).toBe(true)
    expect(can('inventory_staff', 'sale.create')).toBe(false)
    expect(can(null, 'sale.create')).toBe(false)
  })
})

describe('search navigation', () => {
  it('moves the highlighted result with wraparound', () => {
    const scope = effectScope()
    const search = scope.run(() => useCashierSearch(async () => []))
    search.results.value = [product({ id: 'a' }), product({ id: 'b' })]

    expect(search.highlighted.value).toBe(0)
    search.move(1)
    expect(search.highlighted.value).toBe(1)
    search.move(1)
    expect(search.highlighted.value).toBe(0)
    search.move(-1)
    expect(search.highlighted.value).toBe(1)
    scope.stop()
  })
})

describe('receipt mapping', () => {
  it('uses the authoritative transaction snapshots and payment summary', () => {
    const detail = mapReceiptRow({
      id: 'tx-1',
      receipt_no: 'SS-20261103-0001',
      business_date: '2026-11-03',
      cashier_id: 'user-1',
      status: 'completed',
      subtotal: 35000,
      discount_amount: 0,
      grand_total: 35000,
      created_at: '2026-11-03T10:00:00Z',
      profiles: { full_name: 'Kasir Uji' },
      transaction_items: [
        {
          sku_snapshot: 'MEJA-01',
          product_name_snapshot: 'Meja Lipat',
          unit_label_snapshot: 'Pcs',
          quantity: 2,
          unit_price: 15000,
          line_discount_amount: 0,
          line_total: 30000,
        },
        {
          sku_snapshot: 'KURSI-01',
          product_name_snapshot: 'Kursi Kayu',
          unit_label_snapshot: 'Pcs',
          quantity: 1,
          unit_price: 5000,
          line_discount_amount: 0,
          line_total: 5000,
        },
      ],
      payments: [
        { method: 'cash', amount_applied: 20000, cash_received: 25000, cash_change: 5000 },
        { method: 'qris', amount_applied: 15000, cash_received: null, cash_change: 0 },
      ],
    })

    expect(detail.receiptNo).toBe('SS-20261103-0001')
    expect(detail.cashierName).toBe('Kasir Uji')
    expect(detail.items[0]).toMatchObject({ sku: 'MEJA-01', quantity: 2, lineTotal: 30000 })
    expect(detail.items[1]).toMatchObject({ name: 'Kursi Kayu', unitPrice: 5000 })
    expect(detail.payments).toEqual([
      { method: 'cash', amountApplied: 20000, cashReceived: 25000, cashChange: 5000 },
      { method: 'qris', amountApplied: 15000, cashReceived: null, cashChange: 0 },
    ])
    expect(detail.subtotal).toBe(35000)
    expect(detail.grandTotal).toBe(35000)
  })
})

describe('cashier store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('defaults cash payment to the cart total and validates checkout', () => {
    const store = useCashierStore()
    store.addProduct(product())
    expect(store.payments).toHaveLength(1)
    expect(store.payments[0].amountCents).toBe(500000)
    expect(store.canCheckout).toBe(true)
  })

  it('keeps one idempotency key and payload while a request is unknown', () => {
    const store = useCashierStore()
    store.addProduct(product())
    const payload = store.beginCheckout()
    expect(payload).not.toBeNull()
    expect(store.status).toBe('submitting')
    expect(store.beginCheckout()).toBeNull()

    store.fail('Koneksi terputus.', true)
    expect(store.status).toBe('unknown')
    expect(store.lines).toHaveLength(1)
    expect(store.locked).toBe(true)

    const retry = store.retryCheckout()
    expect(retry.idempotency_key).toBe(payload.idempotency_key)
    expect(retry.items).toEqual(payload.items)
  })

  it('clears the cart only after a confirmed result and rotates the key', () => {
    const store = useCashierStore()
    store.addProduct(product())
    const previousKey = store.idempotencyKey
    const payload = store.beginCheckout()
    store.complete(
      { transaction_id: 'tx-1', receipt_no: 'SS-20261103-0001', business_date: '2026-11-03', subtotal: 5000, discount_amount: 0, grand_total: 5000, status: 'completed', already_processed: false },
      receipt(),
    )

    expect(store.lines).toHaveLength(0)
    expect(store.receipt?.receiptNo).toBe('SS-20261103-0001')
    expect(store.idempotencyKey).not.toBe(previousKey)
    expect(payload.idempotency_key).toBe(previousKey)
  })

  it('requires QRIS confirmation and preserves the cart on payment errors', () => {
    const store = useCashierStore()
    store.addProduct(product())
    store.setPaymentMode('qris')
    expect(store.qrisNeedsConfirmation).toBe(true)
    expect(store.beginCheckout()).toBeNull()
    expect(store.error).toContain('QRIS')
    expect(store.lines).toHaveLength(1)

    store.setQrisConfirmed(true)
    expect(store.canCheckout).toBe(true)
    const payload = store.beginCheckout()
    expect(payload.payments[0].method).toBe('qris')
  })

  it('aggregates duplicates and refreshes stock without dropping the line', () => {
    const store = useCashierStore()
    store.addProduct(product())
    store.addProduct(product())
    expect(store.lines).toHaveLength(1)
    expect(store.lines[0].quantity).toBe(2)

    store.replaceProductStock(new Map([['p1', product({ stockOnHand: 1 })]]))
    expect(store.lines[0].product.stockOnHand).toBe(1)
    expect(store.lines[0].quantity).toBe(2)
    expect(store.stockError).toContain('SKU-1')
    expect(store.canCheckout).toBe(false)
  })

  it('rejects over-stock edits and keeps the previous quantity', () => {
    const store = useCashierStore()
    store.addProduct(product())
    const error = store.setQuantity('p1', '11')
    expect(error).toContain('Stok tersedia')
    expect(store.lines[0].quantity).toBe(1)
  })

  it('builds split defaults from the remaining amount', () => {
    const store = useCashierStore()
    store.addProduct(product())
    expect(paymentModeDefaults('cash', 500000)[0].amountCents).toBe(500000)
    store.setPaymentMode('split')
    store.addSplitPayment('cash')
    expect(store.payments[0].amountCents).toBe(500000)
    expect(store.paidCents).toBe(500000)
    expect(store.canCheckout).toBe(true)
  })
})
