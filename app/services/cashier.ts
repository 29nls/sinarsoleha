import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'
import type {
  CashierProduct,
  CheckoutPayload,
  CheckoutResult,
  ReceiptDetail,
} from '~/types/cashier'
import { buildProductSearchFilter, describeCatalogError } from '~/utils/catalog'
import { CASHIER_SEARCH_LIMIT, describeCashierError } from '~/utils/cashier'
import { mapReceiptRow } from '~/utils/receipt'

type Client = SupabaseClient<Database>

interface CashierProductRow {
  id: string
  sku: string
  name: string
  unit_id: number
  sale_price: number | null
  stock_on_hand: number | null
  is_active: boolean
  categories: { name: string } | null
  units_of_measure: { label: string; code: string; decimal_scale: number } | null
}

const PRODUCT_SELECT =
  'id, sku, name, unit_id, sale_price, stock_on_hand, is_active, categories(name), units_of_measure(label, code, decimal_scale)'

function mapProduct(row: CashierProductRow): CashierProduct {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    categoryName: row.categories?.name ?? null,
    unitId: row.unit_id,
    unitLabel: row.units_of_measure?.label ?? '—',
    unitCode: row.units_of_measure?.code ?? '',
    decimalScale: row.units_of_measure?.decimal_scale ?? 0,
    salePrice: row.sale_price,
    stockOnHand: row.stock_on_hand,
    isActive: row.is_active,
  }
}

export async function searchCashierProducts(
  client: Client,
  term: string,
): Promise<CashierProduct[]> {
  const search = term.trim()
  if (!search) return []

  let query = client
    .from('products')
    .select(PRODUCT_SELECT)
    .order('sku_normalized', { ascending: true })
    .limit(CASHIER_SEARCH_LIMIT)

  const filter = buildProductSearchFilter(search)
  if (filter) query = query.or(filter)

  const { data, error } = await query.returns<CashierProductRow[]>()
  if (error) throw new Error(describeCatalogError(error.message))
  return (data ?? []).map(mapProduct)
}

export async function getCashierProducts(
  client: Client,
  ids: string[],
): Promise<CashierProduct[]> {
  if (ids.length === 0) return []
  const { data, error } = await client
    .from('products')
    .select(PRODUCT_SELECT)
    .in('id', ids)
    .returns<CashierProductRow[]>()
  if (error) throw new Error(describeCatalogError(error.message))
  return (data ?? []).map(mapProduct)
}

export async function completeSale(
  client: Client,
  payload: CheckoutPayload,
): Promise<CheckoutResult> {
  const { data, error } = await client.rpc('complete_sale', {
    p_payload: payload as never,
  })
  if (error) {
    const failure = new Error(describeCashierError(error.message)) as Error & {
      code?: string
      raw?: string
    }
    failure.code = error.code
    failure.raw = error.message
    throw failure
  }
  const result = (typeof data === 'string' ? JSON.parse(data) : data) as CheckoutResult
  return result
}

export async function getReceipt(client: Client, transactionId: string): Promise<ReceiptDetail> {
  const { data, error } = await client
    .from('transactions')
    .select(
      `id, receipt_no, business_date, cashier_id, status, subtotal, discount_amount, grand_total, created_at,
       profiles:profiles!transactions_cashier_id_fkey(full_name),
       transaction_items(sku_snapshot, product_name_snapshot, unit_label_snapshot, quantity, unit_price, line_discount_amount, line_total),
       payments(method, amount_applied, cash_received, cash_change)`,
    )
    .eq('id', transactionId)
    .single()

  if (error) throw new Error(describeCatalogError(error.message))

  const row = data as unknown as {
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
    transaction_items: Array<{
      sku_snapshot: string
      product_name_snapshot: string
      unit_label_snapshot: string
      quantity: number
      unit_price: number
      line_discount_amount: number
      line_total: number
    }>
    payments: Array<{
      method: string
      amount_applied: number
      cash_received: number | null
      cash_change: number
    }>
  }

  return mapReceiptRow(row)
}
