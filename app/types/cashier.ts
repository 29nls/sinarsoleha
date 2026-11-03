export interface CashierProduct {
  id: string
  sku: string
  name: string
  categoryName: string | null
  unitId: number
  unitLabel: string
  unitCode: string
  decimalScale: number
  salePrice: number | null
  stockOnHand: number | null
  isActive: boolean
}

export type Sellability =
  | 'available'
  | 'inactive'
  | 'price_missing'
  | 'stock_unknown'
  | 'out_of_stock'

export interface CartLine {
  product: CashierProduct
  quantity: number
}

export type PaymentMethod = 'cash' | 'qris' | 'other'
export type PaymentMode = 'cash' | 'qris' | 'split'

export interface PaymentDraft {
  id: string
  method: PaymentMethod
  amountCents: number
  cashReceivedCents: number | null
}

export interface CheckoutPayload {
  idempotency_key: string
  business_date: string
  customer_id: null
  discount_amount: number
  items: Array<{ product_id: string; quantity: number }>
  payments: Array<{
    method: PaymentMethod
    amount_applied: number
    cash_received?: number
    cash_change?: number
  }>
}

export interface CheckoutResult {
  transaction_id: string
  receipt_no: string
  business_date: string
  subtotal: number
  discount_amount: number
  grand_total: number
  status: string
  already_processed: boolean
}

export interface ReceiptLine {
  sku: string
  name: string
  unit: string
  quantity: number
  unitPrice: number
  lineDiscount: number
  lineTotal: number
}

export interface ReceiptPayment {
  method: PaymentMethod
  amountApplied: number
  cashReceived: number | null
  cashChange: number
}

export interface ReceiptDetail {
  transactionId: string
  receiptNo: string
  businessDate: string
  cashierName: string
  status: string
  subtotal: number
  discountAmount: number
  grandTotal: number
  createdAt: string | null
  items: ReceiptLine[]
  payments: ReceiptPayment[]
}
