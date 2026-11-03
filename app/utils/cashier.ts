import type {
  CartLine,
  CashierProduct,
  CheckoutPayload,
  PaymentDraft,
  PaymentMethod,
  Sellability,
} from '../types/cashier'

export const CASHIER_SEARCH_LIMIT = 12

export function sellability(product: CashierProduct): Sellability {
  if (!product.isActive) return 'inactive'
  if (product.salePrice === null) return 'price_missing'
  if (product.stockOnHand === null) return 'stock_unknown'
  if (product.stockOnHand <= 0) return 'out_of_stock'
  return 'available'
}

export function sellabilityLabel(state: Sellability): string {
  switch (state) {
    case 'inactive':
      return 'Produk tidak aktif'
    case 'price_missing':
      return 'Harga belum tersedia'
    case 'stock_unknown':
      return 'Stok belum diopname'
    case 'out_of_stock':
      return 'Stok habis'
    default:
      return 'Tersedia'
  }
}

export function isSellable(product: CashierProduct): boolean {
  return sellability(product) === 'available'
}

/** Money is kept in integer cents; the database still recomputes every total. */
export function toCents(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'string' ? Number(value.replace(',', '.')) : value
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed * 100)
}

export function centsToAmount(cents: number): number {
  return Math.round(cents) / 100
}

export function lineTotalCents(product: CashierProduct, quantity: number): number {
  if (product.salePrice === null) return 0
  return Math.round(product.salePrice * 100 * quantity)
}

export function cartSubtotalCents(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + lineTotalCents(line.product, line.quantity), 0)
}

export function quantityStep(scale: number): number {
  return scale > 0 ? 0.001 : 1
}

export function parseQuantityInput(raw: string | number): number | null {
  const text = String(raw).trim().replace(',', '.')
  if (!text) return null
  if (!/^\d+(\.\d+)?$/.test(text)) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

export function validateQuantity(
  raw: string | number,
  product: CashierProduct,
): { quantity: number | null; error: string | null } {
  const quantity = parseQuantityInput(raw)
  if (quantity === null) return { quantity: null, error: 'Jumlah harus berupa angka positif.' }
  if (quantity <= 0) return { quantity: null, error: 'Jumlah harus lebih besar dari nol.' }
  const scaleError = decimalScaleError(quantity, product.decimalScale)
  if (scaleError) return { quantity: null, error: scaleError }
  if (product.stockOnHand === null) {
    return { quantity: null, error: 'Stok produk belum diketahui; selesaikan opname dulu.' }
  }
  if (quantity > product.stockOnHand) {
    return { quantity: null, error: `Stok tersedia hanya ${formatQty(product.stockOnHand)}.` }
  }
  return { quantity, error: null }
}

export function decimalScaleError(quantity: number, scale: number): string | null {
  const factor = 10 ** scale
  if (Math.abs(quantity * factor - Math.round(quantity * factor)) > 1e-9) {
    return scale === 0
      ? 'Satuan ini tidak menerima jumlah pecahan.'
      : `Jumlah maksimal ${scale} angka desimal.`
  }
  return null
}

function formatQty(value: number): string {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(value)
}

export function addToCart(
  lines: CartLine[],
  product: CashierProduct,
  quantity = 1,
): { lines: CartLine[]; error: string | null } {
  const state = sellability(product)
  if (state !== 'available') return { lines, error: sellabilityLabel(state) }

  const existing = lines.find((line) => line.product.id === product.id)
  const nextQuantity = (existing?.quantity ?? 0) + quantity
  const validation = validateQuantity(nextQuantity, product)
  if (validation.error) return { lines, error: validation.error }

  if (existing) {
    return {
      lines: lines.map((line) =>
        line.product.id === product.id ? { ...line, quantity: nextQuantity } : line,
      ),
      error: null,
    }
  }
  return { lines: [...lines, { product, quantity: nextQuantity }], error: null }
}

export function changeQuantity(
  lines: CartLine[],
  productId: string,
  raw: string | number,
): { lines: CartLine[]; error: string | null } {
  const line = lines.find((item) => item.product.id === productId)
  if (!line) return { lines, error: 'Baris keranjang tidak ditemukan.' }
  const validation = validateQuantity(raw, line.product)
  if (validation.error || validation.quantity === null) {
    return { lines, error: validation.error ?? 'Jumlah tidak valid.' }
  }
  return {
    lines: lines.map((item) =>
      item.product.id === productId ? { ...item, quantity: validation.quantity as number } : item,
    ),
    error: null,
  }
}

export function removeFromCart(lines: CartLine[], productId: string): CartLine[] {
  return lines.filter((line) => line.product.id !== productId)
}

export function paymentAmountCents(payment: PaymentDraft): number {
  return Math.max(0, Math.round(payment.amountCents))
}

export function paymentsTotalCents(payments: PaymentDraft[]): number {
  return payments.reduce((sum, payment) => sum + paymentAmountCents(payment), 0)
}

export function cashChangeCents(payments: PaymentDraft[]): number {
  return payments.reduce((sum, payment) => {
    if (payment.method !== 'cash' || payment.cashReceivedCents === null) return sum
    return sum + Math.max(0, payment.cashReceivedCents - payment.amountCents)
  }, 0)
}

export function validatePayments(
  payments: PaymentDraft[],
  totalCents: number,
): { error: string | null } {
  if (payments.length === 0) return { error: 'Pembayaran belum diisi.' }
  if (totalCents <= 0) return { error: 'Total nota belum tersedia.' }

  for (const payment of payments) {
    if (!['cash', 'qris', 'other'].includes(payment.method)) {
      return { error: 'Metode pembayaran tidak dikenal.' }
    }
    if (payment.amountCents <= 0) return { error: 'Nominal pembayaran harus lebih dari nol.' }
    if (payment.method === 'cash') {
      if (payment.cashReceivedCents === null) {
        return { error: 'Uang tunai yang diterima wajib diisi.' }
      }
      if (payment.cashReceivedCents < payment.amountCents) {
        return { error: 'Uang tunai yang diterima kurang dari nominal pembayaran.' }
      }
    } else if (payment.cashReceivedCents !== null) {
      return { error: 'Pembayaran non-tunai tidak boleh memakai uang tunai.' }
    }
  }

  if (paymentsTotalCents(payments) !== totalCents) {
    return { error: 'Total pembayaran harus sama dengan total nota.' }
  }
  return { error: null }
}

export function paymentModeDefaults(mode: 'cash' | 'qris', totalCents: number): PaymentDraft[] {
  if (totalCents <= 0) return []
  const id = createId()
  if (mode === 'cash') {
    return [{ id, method: 'cash', amountCents: totalCents, cashReceivedCents: totalCents }]
  }
  return [{ id, method: 'qris', amountCents: totalCents, cashReceivedCents: null }]
}

export function createId(): string {
  return globalThis.crypto.randomUUID()
}

export function buildCheckoutPayload(input: {
  idempotencyKey: string
  businessDate: string
  lines: CartLine[]
  payments: PaymentDraft[]
}): CheckoutPayload {
  return {
    idempotency_key: input.idempotencyKey,
    business_date: input.businessDate,
    customer_id: null,
    discount_amount: 0,
    items: input.lines.map((line) => ({
      product_id: line.product.id,
      quantity: Number(line.quantity.toFixed(3)),
    })),
    payments: input.payments.map((payment) => {
      if (payment.method === 'cash') {
        return {
          method: 'cash',
          amount_applied: centsToAmount(payment.amountCents),
          cash_received: centsToAmount(payment.cashReceivedCents ?? 0),
          cash_change: centsToAmount(
            Math.max(0, (payment.cashReceivedCents ?? 0) - payment.amountCents),
          ),
        }
      }
      return {
        method: payment.method,
        amount_applied: centsToAmount(payment.amountCents),
      }
    }),
  }
}

export function businessDateJakarta(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

const ERROR_MESSAGES: Array<[string, string]> = [
  ['INSUFFICIENT_STOCK', 'Stok berubah saat checkout. Keranjang dipertahankan; periksa stok terbaru lalu coba lagi.'],
  ['STOCK_UNKNOWN', 'Stok produk belum diketahui. Selesaikan opname sebelum menjual produk ini.'],
  ['SALE_PRICE_MISSING', 'Harga jual produk belum tersedia.'],
  ['PRODUCT_INACTIVE', 'Produk sudah dinonaktifkan.'],
  ['PRODUCT_NOT_FOUND', 'Produk tidak ditemukan.'],
  ['PAYMENT_TOTAL_MISMATCH', 'Total pembayaran tidak sama dengan total nota.'],
  ['CASH_RECEIVED_TOO_LOW', 'Uang tunai yang diterima kurang dari nominal pembayaran.'],
  ['CASH_CHANGE_MISMATCH', 'Kembalian tidak sesuai dengan uang yang diterima.'],
  ['INVALID_QUANTITY', 'Jumlah barang tidak valid.'],
  ['INVALID_QUANTITY_UNIT', 'Satuan produk ini tidak menerima jumlah pecahan.'],
  ['DUPLICATE_PRODUCT', 'Produk yang sama tidak boleh muncul dua kali.'],
  ['DISCOUNT_NOT_CONFIGURED', 'Diskon belum diaktifkan oleh owner.'],
  ['IDEMPOTENCY_KEY_REUSED', 'Kunci checkout ini sudah dipakai untuk keranjang berbeda. Muat ulang keranjang.'],
  ['AUTH_REQUIRED', 'Sesi berakhir. Masuk kembali.'],
  ['JWT expired', 'Sesi berakhir. Masuk kembali.'],
  ['PGRST301', 'Sesi berakhir. Masuk kembali.'],
  ['FORBIDDEN', 'Peran akun ini tidak diizinkan melakukan checkout.'],
  ['BUSINESS_DATE', 'Tanggal bisnis tidak valid.'],
  ['permission denied', 'Anda tidak memiliki izin untuk operasi ini.'],
]

export function describeCashierError(message: string): string {
  const found = ERROR_MESSAGES.find(([key]) => message.includes(key))
  if (found) return found[1]
  return message.replace(/^[A-Z_]+:\s*/, '').trim() || 'Checkout gagal. Coba lagi.'
}
