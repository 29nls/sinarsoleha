import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'
import type { ReceiptDetail } from '~/types/cashier'
import type {
  TransactionListParams,
  TransactionListResult,
  TransactionListRow,
  VoidSaleResult,
} from '~/types/transactions'
import { describeTransactionError, paymentMethodLabel } from '~/types/transactions'
import { mapReceiptRow, type ReceiptRow } from '~/utils/receipt'

type Client = SupabaseClient<Database>

interface TransactionSelectRow {
  id: string
  receipt_no: string
  business_date: string
  cashier_id: string
  status: string
  subtotal: number
  discount_amount: number
  grand_total: number
  created_at: string
  transaction_items: Array<{ id: string }> | null
  payments: Array<{ method: string }> | null
}

const LIST_SELECT =
  'id, receipt_no, business_date, cashier_id, status, subtotal, discount_amount, grand_total, created_at, transaction_items(id), payments(method)'

function fail(error: { message: string }): never {
  throw new Error(describeTransactionError(error.message))
}

function primaryPaymentMethod(payments: Array<{ method: string }> | null): string {
  if (!payments || payments.length === 0) return ''
  const methods = new Set(payments.map((p) => p.method))
  if (methods.size > 1) return 'split'
  return payments[0]!.method
}

export async function listTransactions(
  client: Client,
  params: TransactionListParams,
): Promise<TransactionListResult> {
  let query = client
    .from('transactions')
    .select(LIST_SELECT, { count: 'exact' })
    .order('business_date', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })

  if (params.dateFrom) {
    query = query.gte('business_date', params.dateFrom)
  }
  if (params.dateTo) {
    query = query.lte('business_date', params.dateTo)
  }
  if (params.receiptSearch.trim()) {
    query = query.ilike('receipt_no', `%${escapeLike(params.receiptSearch.trim())}%`)
  }
  if (params.status) {
    query = query.eq('status', params.status)
  }
  if (params.cashierId) {
    query = query.eq('cashier_id', params.cashierId)
  }

  const from = (params.page - 1) * params.pageSize
  query = query.range(from, from + params.pageSize - 1)

  const { data, error, count } = await query.returns<TransactionSelectRow[]>()
  if (error) fail(error)

  let rows = (data ?? []).map((row): TransactionListRow => {
    const method = primaryPaymentMethod(row.payments)
    return {
      id: row.id,
      receiptNo: row.receipt_no,
      businessDate: row.business_date,
      cashierId: row.cashier_id,
      cashierName: '',
      itemCount: row.transaction_items?.length ?? 0,
      subtotal: row.subtotal,
      discountAmount: row.discount_amount,
      grandTotal: row.grand_total,
      paymentMethod: method,
      status: row.status,
      createdAt: row.created_at,
    }
  })

  // Client-side payment method filter (payments is nested, can't filter server-side without losing count accuracy)
  if (params.paymentMethod) {
    rows = rows.filter((r) => r.paymentMethod === params.paymentMethod)
  }

  return { rows, total: count ?? 0 }
}

const DETAIL_SELECT =
  `id, receipt_no, business_date, cashier_id, status, subtotal, discount_amount, grand_total, created_at,
   transaction_items(sku_snapshot, product_name_snapshot, unit_label_snapshot, quantity, unit_price, line_discount_amount, line_total),
   payments(method, amount_applied, cash_received, cash_change)`

export async function getTransactionDetail(
  client: Client,
  transactionId: string,
  currentUserName: string,
  currentUserId: string,
): Promise<ReceiptDetail> {
  const { data, error } = await client
    .from('transactions')
    .select(DETAIL_SELECT)
    .eq('id', transactionId)
    .single()

  if (error) fail(error)

  const row = data as unknown as ReceiptRow & { cashier_id: string }
  // Don't join profiles; use current user name if cashier matches, else fallback
  const receiptRow: ReceiptRow = {
    ...row,
    profiles: row.cashier_id === currentUserId
      ? { full_name: currentUserName }
      : null,
  }

  return mapReceiptRow(receiptRow)
}

export async function voidSale(
  client: Client,
  transactionId: string,
  reason: string,
): Promise<VoidSaleResult> {
  const { data, error } = await client.rpc('void_sale', {
    p_transaction_id: transactionId,
    p_reason: reason.trim(),
  })
  if (error) fail(error)
  const result = (typeof data === 'string' ? JSON.parse(data) : data) as VoidSaleResult
  return result
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}
