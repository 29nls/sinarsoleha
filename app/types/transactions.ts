import type { PaymentMethod } from './cashier'

export type TransactionStatus = 'completed' | 'voided'

export interface TransactionListFilters {
  dateFrom: string
  dateTo: string
  receiptSearch: string
  status: TransactionStatus | ''
  paymentMethod: PaymentMethod | ''
  /** Owner-only: filter by cashier_id */
  cashierId: string
}

export interface TransactionListParams extends TransactionListFilters {
  page: number
  pageSize: number
}

export interface TransactionListRow {
  id: string
  receiptNo: string
  businessDate: string
  cashierId: string
  cashierName: string
  itemCount: number
  subtotal: number
  discountAmount: number
  grandTotal: number
  paymentMethod: string
  status: string
  createdAt: string
}

export interface TransactionListResult {
  rows: TransactionListRow[]
  total: number
}

export interface VoidSaleResult {
  transaction_id: string
  receipt_no: string
  status: string
  grand_total: number
  voided_at: string
  restored_items: number
  already_processed: boolean
}

export const STATUS_LABELS: Record<string, string> = {
  completed: 'Selesai',
  voided: 'Dibatalkan',
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  other: 'Lainnya',
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method
}

export function emptyFilters(): TransactionListFilters {
  return {
    dateFrom: '',
    dateTo: '',
    receiptSearch: '',
    status: '',
    paymentMethod: '',
    cashierId: '',
  }
}

const VOID_REASON_MIN = 1
const VOID_REASON_MAX = 500

export function validateVoidReason(reason: string): string | null {
  const trimmed = reason.trim()
  if (trimmed.length < VOID_REASON_MIN) return 'Alasan pembatalan wajib diisi.'
  if (trimmed.length > VOID_REASON_MAX) return `Alasan maksimal ${VOID_REASON_MAX} karakter.`
  return null
}

export function describeTransactionError(message: string): string {
  if (message.includes('VOID_REASON_REQUIRED')) return 'Alasan pembatalan wajib diisi.'
  if (message.includes('VOID_REASON_TOO_LONG')) return 'Alasan pembatalan terlalu panjang (maks 500 karakter).'
  if (message.includes('TRANSACTION_NOT_FOUND')) return 'Transaksi tidak ditemukan.'
  if (message.includes('VOID_ITEM_WITHOUT_PRODUCT')) return 'Produk pada item transaksi tidak ditemukan.'
  if (message.includes('STOCK_UNKNOWN')) return 'Stok produk belum diketahui.'
  if (message.includes('PRODUCT_NOT_FOUND')) return 'Produk tidak ditemukan.'
  if (message.includes('permission denied') || message.includes('row-level security')) {
    return 'Anda tidak memiliki izin untuk operasi ini.'
  }
  return message.replace(/^[A-Z_]+:\s*/, '').trim() || 'Operasi gagal.'
}
