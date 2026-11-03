import type { PaymentMethod, ReceiptDetail } from '../types/cashier'

export interface ReceiptRow {
  id: string
  receipt_no: string
  business_date: string
  cashier_id: string
  status: string
  subtotal: number
  discount_amount: number
  grand_total: number
  created_at: string
  profiles: { full_name: string } | null
  transaction_items:
    | Array<{
        sku_snapshot: string
        product_name_snapshot: string
        unit_label_snapshot: string
        quantity: number
        unit_price: number
        line_discount_amount: number
        line_total: number
      }>
    | null
  payments:
    | Array<{
        method: string
        amount_applied: number
        cash_received: number | null
        cash_change: number
      }>
    | null
}

export function mapReceiptRow(row: ReceiptRow): ReceiptDetail {
  return {
    transactionId: row.id,
    receiptNo: row.receipt_no,
    businessDate: row.business_date,
    cashierName: row.profiles?.full_name ?? '',
    status: row.status,
    subtotal: row.subtotal,
    discountAmount: row.discount_amount,
    grandTotal: row.grand_total,
    createdAt: row.created_at,
    items: (row.transaction_items ?? []).map((item) => ({
      sku: item.sku_snapshot,
      name: item.product_name_snapshot,
      unit: item.unit_label_snapshot,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      lineDiscount: item.line_discount_amount,
      lineTotal: item.line_total,
    })),
    payments: (row.payments ?? []).map((payment) => ({
      method: payment.method as PaymentMethod,
      amountApplied: payment.amount_applied,
      cashReceived: payment.cash_received,
      cashChange: payment.cash_change,
    })),
  }
}
