import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  CartLine,
  CashierProduct,
  CheckoutPayload,
  CheckoutResult,
  PaymentDraft,
  PaymentMode,
  PaymentMethod,
  ReceiptDetail,
} from '../types/cashier'
import type { StockBroadcast } from '../utils/stock'
import {
  addToCart,
  buildCheckoutPayload,
  businessDateJakarta,
  cashChangeCents,
  cartSubtotalCents,
  changeQuantity,
  createId,
  paymentModeDefaults,
  paymentsTotalCents,
  removeFromCart,
  validatePayments,
} from '../utils/cashier'

export type CheckoutStatus = 'idle' | 'submitting' | 'unknown' | 'error' | 'completed'

export const useCashierStore = defineStore('cashier', () => {
  const lines = ref<CartLine[]>([])
  const payments = ref<PaymentDraft[]>([])
  const paymentMode = ref<PaymentMode>('cash')
  const qrisConfirmed = ref(false)
  const status = ref<CheckoutStatus>('idle')
  const error = ref<string | null>(null)
  const receipt = ref<ReceiptDetail | null>(null)
  const selectedProductId = ref<string | null>(null)
  const idempotencyKey = ref(createId())
  const lastAttempt = ref<{ key: string; payload: CheckoutPayload } | null>(null)
  const stockVersions = new Map<string, number>()

  const subtotalCents = computed(() => cartSubtotalCents(lines.value))
  const paidCents = computed(() => paymentsTotalCents(payments.value))
  const remainingCents = computed(() => Math.max(0, subtotalCents.value - paidCents.value))
  const changeCents = computed(() => cashChangeCents(payments.value))
  const itemCount = computed(() => lines.value.reduce((sum, line) => sum + line.quantity, 0))
  const lineCount = computed(() => lines.value.length)
  const locked = computed(() => status.value === 'submitting' || status.value === 'unknown')
  const hasQris = computed(() => payments.value.some((payment) => payment.method === 'qris'))
  const qrisNeedsConfirmation = computed(() => hasQris.value && !qrisConfirmed.value)
  const stockError = computed(() => {
    for (const line of lines.value) {
      if (!line.product.isActive) {
        return `Produk ${line.product.sku} sudah tidak aktif.`
      }
      if (line.product.stockOnHand === null) {
        return `Stok ${line.product.sku} belum diopname.`
      }
      if (line.quantity > line.product.stockOnHand) {
        return `Stok ${line.product.sku} tinggal ${line.product.stockOnHand}; kurangi jumlahnya.`
      }
    }
    return null
  })

  const paymentError = computed(
    () => validatePayments(payments.value, subtotalCents.value).error,
  )
  const canCheckout = computed(
    () =>
      lines.value.length > 0 &&
      !locked.value &&
      paymentError.value === null &&
      stockError.value === null &&
      !qrisNeedsConfirmation.value,
  )

  function syncSimplePayment() {
    if (paymentMode.value === 'split') return
    payments.value = paymentModeDefaults(paymentMode.value, subtotalCents.value)
  }

  function touch() {
    if (locked.value) return
    idempotencyKey.value = createId()
    lastAttempt.value = null
    error.value = null
    if (status.value !== 'submitting' && status.value !== 'unknown') status.value = 'idle'
  }

  function addProduct(product: CashierProduct, quantity = 1): string | null {
    if (locked.value) return 'Checkout sedang diproses.'
    const result = addToCart(lines.value, product, quantity)
    if (result.error) return result.error
    lines.value = result.lines
    // Seed the guard with the version this row was read at, so a message that
    // was already in flight before the search cannot overwrite it.
    if (typeof product.stockVersion === 'number') {
      stockVersions.set(product.id, product.stockVersion)
    }
    selectedProductId.value = product.id
    syncSimplePayment()
    touch()
    return null
  }

  function setQuantity(productId: string, raw: string | number): string | null {
    if (locked.value) return 'Checkout sedang diproses.'
    const result = changeQuantity(lines.value, productId, raw)
    if (result.error) return result.error
    lines.value = result.lines
    syncSimplePayment()
    touch()
    return null
  }

  function incrementLine(productId: string): string | null {
    const line = lines.value.find((item) => item.product.id === productId)
    if (!line) return 'Baris keranjang tidak ditemukan.'
    return setQuantity(productId, line.quantity + 1)
  }

  function decrementLine(productId: string): string | null {
    const line = lines.value.find((item) => item.product.id === productId)
    if (!line) return 'Baris keranjang tidak ditemukan.'
    return setQuantity(productId, line.quantity - 1)
  }

  function removeLine(productId: string) {
    if (locked.value) return
    lines.value = removeFromCart(lines.value, productId)
    if (selectedProductId.value === productId) selectedProductId.value = null
    if (lines.value.length === 0) payments.value = []
    else syncSimplePayment()
    touch()
  }

  function clearCart() {
    if (locked.value) return
    lines.value = []
    payments.value = []
    paymentMode.value = 'cash'
    qrisConfirmed.value = false
    selectedProductId.value = null
    receipt.value = null
    touch()
  }

  function replaceProductStock(products: Map<string, CashierProduct>) {
    lines.value = lines.value.map((line) => {
      const fresh = products.get(line.product.id)
      if (!fresh) return line
      // The refetch is newer than every broadcast seen so far; remembering its
      // version stops a late message from undoing the fresh read.
      if (typeof fresh.stockVersion === 'number') {
        stockVersions.set(fresh.id, fresh.stockVersion)
      }
      // Refresh availability only. The cart keeps the price the cashier saw;
      // the database remains the authority and may return a different total.
      return {
        ...line,
        product: {
          ...line.product,
          stockOnHand: fresh.stockOnHand,
          isActive: fresh.isActive,
        },
      }
    })
  }

  /**
   * Applies one Realtime stock message (POS-03). Only the balance changes; the
   * price stays as the cashier saw it and checkout still validates the
   * database. An older or repeated `stock_version` is ignored so a delayed
   * message cannot roll the display back.
   */
  function applyStockChange(event: StockBroadcast): boolean {
    const known = stockVersions.get(event.productId)
    if (known !== undefined && known >= event.stockVersion) return false
    stockVersions.set(event.productId, event.stockVersion)

    let changed = false
    lines.value = lines.value.map((line) => {
      if (line.product.id !== event.productId) return line
      if (line.product.stockOnHand === event.stockOnHand) return line
      changed = true
      return { ...line, product: { ...line.product, stockOnHand: event.stockOnHand } }
    })
    return changed
  }

  /** The channel does not replay missed messages, so a refetch resets the
   * version guard: the database read is newer than anything remembered. */
  function resetStockVersions() {
    stockVersions.clear()
  }

  function selectLine(productId: string | null) {
    selectedProductId.value = productId
  }

  function setPaymentMode(mode: PaymentMode) {
    if (locked.value) return
    paymentMode.value = mode
    if (mode === 'split') {
      payments.value = []
      qrisConfirmed.value = false
    } else {
      payments.value = paymentModeDefaults(mode, subtotalCents.value)
      qrisConfirmed.value = false
    }
    touch()
  }

  function setCashPayment(id: string, patch: Partial<Pick<PaymentDraft, 'amountCents' | 'cashReceivedCents'>>) {
    if (locked.value) return
    payments.value = payments.value.map((payment) =>
      payment.id === id ? { ...payment, ...patch } : payment,
    )
    touch()
  }

  function addSplitPayment(method: PaymentMethod) {
    if (locked.value) return
    const remaining = Math.max(0, subtotalCents.value - paymentsTotalCents(payments.value))
    if (remaining <= 0) return
    payments.value = [
      ...payments.value,
      {
        id: createId(),
        method,
        amountCents: remaining,
        cashReceivedCents: method === 'cash' ? remaining : null,
      },
    ]
    qrisConfirmed.value = false
    touch()
  }

  function removePayment(id: string) {
    if (locked.value) return
    payments.value = payments.value.filter((payment) => payment.id !== id)
    qrisConfirmed.value = false
    touch()
  }

  function setQrisConfirmed(value: boolean) {
    if (locked.value) return
    qrisConfirmed.value = value
  }

  function beginCheckout(): CheckoutPayload | null {
    if (locked.value) return null
    if (lines.value.length === 0) {
      error.value = 'Keranjang masih kosong.'
      status.value = 'error'
      return null
    }
    if (lastAttempt.value) {
      status.value = 'submitting'
      error.value = null
      return lastAttempt.value.payload
    }
    const validation = validatePayments(payments.value, subtotalCents.value)
    if (validation.error) {
      error.value = validation.error
      status.value = 'error'
      return null
    }
    if (qrisNeedsConfirmation.value) {
      error.value = 'Konfirmasi bahwa pembayaran QRIS sudah diterima dan diverifikasi.'
      status.value = 'error'
      return null
    }
    if (stockError.value) {
      error.value = stockError.value
      status.value = 'error'
      return null
    }
    const payload = buildCheckoutPayload({
      idempotencyKey: idempotencyKey.value,
      businessDate: businessDateJakarta(),
      lines: lines.value,
      payments: payments.value,
    })
    lastAttempt.value = { key: idempotencyKey.value, payload }
    status.value = 'submitting'
    error.value = null
    return payload
  }

  function retryCheckout(): CheckoutPayload | null {
    if (!lastAttempt.value || status.value === 'submitting') return null
    status.value = 'submitting'
    error.value = null
    return lastAttempt.value.payload
  }

  function fail(message: string, unknownRequest = false) {
    error.value = message
    status.value = unknownRequest ? 'unknown' : 'error'
    if (!unknownRequest) {
      lastAttempt.value = null
      idempotencyKey.value = createId()
    }
  }

  function complete(result: CheckoutResult, detail: ReceiptDetail) {
    receipt.value = { ...detail, receiptNo: result.receipt_no, status: result.status }
    status.value = 'completed'
    error.value = null
    lines.value = []
    payments.value = []
    paymentMode.value = 'cash'
    qrisConfirmed.value = false
    selectedProductId.value = null
    lastAttempt.value = null
    idempotencyKey.value = createId()
  }

  function dismissError() {
    if (status.value === 'error') {
      status.value = 'idle'
      error.value = null
    }
  }

  return {
    lines,
    payments,
    paymentMode,
    qrisConfirmed,
    status,
    error,
    receipt,
    selectedProductId,
    idempotencyKey,
    subtotalCents,
    paidCents,
    remainingCents,
    changeCents,
    itemCount,
    lineCount,
    locked,
    qrisNeedsConfirmation,
    stockError,
    paymentError,
    canCheckout,
    addProduct,
    setQuantity,
    incrementLine,
    decrementLine,
    removeLine,
    clearCart,
    replaceProductStock,
    applyStockChange,
    resetStockVersions,
    selectLine,
    setPaymentMode,
    setCashPayment,
    addSplitPayment,
    removePayment,
    setQrisConfirmed,
    beginCheckout,
    retryCheckout,
    fail,
    complete,
    dismissError,
  }
})
