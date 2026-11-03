import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'
import type {
  DiscrepancyParams,
  DiscrepancyRow,
  InventoryListResult,
  MovementParams,
  MovementRow,
  StockBalanceParams,
  StockBalanceRow,
} from '~/types/inventory'
import {
  actorLabel,
  describeInventoryError,
  endOfJakartaDay,
  startOfJakartaDay,
} from '~/types/inventory'

type Client = SupabaseClient<Database>

function fail(error: { message: string }): never {
  throw new Error(describeInventoryError(error.message))
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

function quoteValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** PostgREST OR filter over the embedded `products` relation. */
function productSearchFilter(term: string): string | null {
  const trimmed = term.trim()
  if (!trimmed) return null
  const escaped = escapeLike(trimmed.toLowerCase())
  return [
    `sku_normalized.ilike.${quoteValue(`%${escaped}%`)}`,
    `normalized_name.ilike.${quoteValue(`%${escaped}%`)}`,
  ].join(',')
}

interface ProductEmbed {
  sku: string
  name: string
  units_of_measure: { label: string; decimal_scale: number } | null
}

const BALANCE_SELECT =
  'id, sku, name, stock_on_hand, stock_version, low_stock_threshold, is_active, import_review_status, categories(name), units_of_measure(label, decimal_scale)'

interface BalanceSelectRow {
  id: string
  sku: string
  name: string
  stock_on_hand: number | null
  stock_version: number
  low_stock_threshold: number | null
  is_active: boolean
  import_review_status: string
  categories: { name: string } | null
  units_of_measure: { label: string; decimal_scale: number } | null
}

export async function listStockBalances(
  client: Client,
  params: StockBalanceParams,
): Promise<InventoryListResult<StockBalanceRow>> {
  let query = client
    .from('products')
    .select(BALANCE_SELECT, { count: 'exact' })
    .order('sku_normalized', { ascending: true })
    .order('name', { ascending: true })

  const term = params.search.trim()
  if (term) {
    const escaped = escapeLike(term.toLowerCase())
    query = query.or(
      [
        `sku_normalized.ilike.${quoteValue(`%${escaped}%`)}`,
        `normalized_name.ilike.${quoteValue(`%${escaped}%`)}`,
      ].join(','),
    )
  }

  // PostgREST cannot compare two columns, so "low stock" is not a server
  // filter. The table highlights those rows instead.
  if (params.state === 'unknown') query = query.is('stock_on_hand', null)
  if (params.state === 'negative') query = query.lt('stock_on_hand', 0)
  if (params.state === 'empty') query = query.eq('stock_on_hand', 0)

  const from = (params.page - 1) * params.pageSize
  query = query.range(from, from + params.pageSize - 1)

  const { data, error, count } = await query.returns<BalanceSelectRow[]>()
  if (error) fail(error)

  return {
    rows: (data ?? []).map((row) => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
      categoryName: row.categories?.name ?? null,
      unitLabel: row.units_of_measure?.label ?? '—',
      decimalScale: row.units_of_measure?.decimal_scale ?? 0,
      stockOnHand: row.stock_on_hand,
      stockVersion: Number(row.stock_version),
      lowStockThreshold: row.low_stock_threshold,
      isActive: row.is_active,
      reviewStatus: row.import_review_status,
    })),
    total: count ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Stock movements
// ---------------------------------------------------------------------------

const MOVEMENT_SELECT =
  'id, product_id, movement_type, quantity_delta, quantity_before, quantity_after, transaction_id, stock_opname_id, reason_code, reason_note, actor_id, created_at, products!inner(sku, name, units_of_measure(label, decimal_scale)), actor:profiles!stock_movements_actor_id_fkey(full_name)'

interface MovementSelectRow {
  id: number
  product_id: string
  movement_type: string
  quantity_delta: number
  quantity_before: number | null
  quantity_after: number
  transaction_id: string | null
  stock_opname_id: string | null
  reason_code: string | null
  reason_note: string | null
  actor_id: string
  created_at: string
  products: ProductEmbed
  actor: { full_name: string } | null
}

export async function listStockMovements(
  client: Client,
  params: MovementParams,
  currentUserId = '',
): Promise<InventoryListResult<MovementRow>> {
  let query = client
    .from('stock_movements')
    .select(MOVEMENT_SELECT, { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })

  const searchFilter = productSearchFilter(params.productSearch)
  if (searchFilter) {
    query = query.or(searchFilter, { referencedTable: 'products' })
  }
  if (params.movementType) query = query.eq('movement_type', params.movementType)
  if (params.dateFrom) {
    query = query.gte('created_at', startOfJakartaDay(params.dateFrom))
  }
  if (params.dateTo) {
    query = query.lte('created_at', endOfJakartaDay(params.dateTo))
  }

  const from = (params.page - 1) * params.pageSize
  query = query.range(from, from + params.pageSize - 1)

  const { data, error, count } = await query.returns<MovementSelectRow[]>()
  if (error) fail(error)

  return {
    rows: (data ?? []).map((row) => ({
      id: Number(row.id),
      productId: row.product_id,
      sku: row.products?.sku ?? '—',
      productName: row.products?.name ?? 'Produk tidak ditemukan',
      unitLabel: row.products?.units_of_measure?.label ?? '—',
      decimalScale: row.products?.units_of_measure?.decimal_scale ?? 0,
      movementType: row.movement_type,
      quantityDelta: Number(row.quantity_delta),
      quantityBefore: row.quantity_before === null ? null : Number(row.quantity_before),
      quantityAfter: Number(row.quantity_after),
      transactionId: row.transaction_id,
      stockOpnameId: row.stock_opname_id,
      reasonCode: row.reason_code,
      reasonNote: row.reason_note,
      actorId: row.actor_id,
      actorLabel: row.actor?.full_name ?? actorLabel(row.actor_id, currentUserId),
      createdAt: row.created_at,
    })),
    total: count ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Discrepancy logs
// ---------------------------------------------------------------------------

const DISCREPANCY_SELECT =
  'id, stock_opname_item_id, revision, product_id, system_qty, physical_qty, difference_qty, reason_code, reason_note, created_by, approved_by, created_at, products!inner(sku, name, units_of_measure(label, decimal_scale)), creator:profiles!stock_discrepancy_logs_created_by_fkey(full_name), approver:profiles!stock_discrepancy_logs_approved_by_fkey(full_name)'

interface DiscrepancySelectRow {
  id: number
  stock_opname_item_id: string
  revision: number
  product_id: string
  system_qty: number
  physical_qty: number
  difference_qty: number
  reason_code: string
  reason_note: string | null
  created_by: string
  approved_by: string | null
  created_at: string
  products: ProductEmbed
  creator: { full_name: string } | null
  approver: { full_name: string } | null
}

export async function listStockDiscrepancies(
  client: Client,
  params: DiscrepancyParams,
  currentUserId = '',
): Promise<InventoryListResult<DiscrepancyRow>> {
  let query = client
    .from('stock_discrepancy_logs')
    .select(DISCREPANCY_SELECT, { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })

  const searchFilter = productSearchFilter(params.productSearch)
  if (searchFilter) {
    query = query.or(searchFilter, { referencedTable: 'products' })
  }
  if (params.reasonCode) query = query.eq('reason_code', params.reasonCode)
  if (params.dateFrom) {
    query = query.gte('created_at', startOfJakartaDay(params.dateFrom))
  }
  if (params.dateTo) {
    query = query.lte('created_at', endOfJakartaDay(params.dateTo))
  }

  const from = (params.page - 1) * params.pageSize
  query = query.range(from, from + params.pageSize - 1)

  const { data, error, count } = await query.returns<DiscrepancySelectRow[]>()
  if (error) fail(error)

  return {
    rows: (data ?? []).map((row) => ({
      id: Number(row.id),
      stockOpnameItemId: row.stock_opname_item_id,
      revision: Number(row.revision),
      productId: row.product_id,
      sku: row.products?.sku ?? '—',
      productName: row.products?.name ?? 'Produk tidak ditemukan',
      unitLabel: row.products?.units_of_measure?.label ?? '—',
      decimalScale: row.products?.units_of_measure?.decimal_scale ?? 0,
      systemQty: Number(row.system_qty),
      physicalQty: Number(row.physical_qty),
      differenceQty: Number(row.difference_qty),
      reasonCode: row.reason_code,
      reasonNote: row.reason_note,
      createdBy: row.created_by,
      createdByLabel: row.creator?.full_name ?? actorLabel(row.created_by, currentUserId),
      approvedBy: row.approved_by,
      approvedByLabel: row.approved_by
        ? row.approver?.full_name ?? actorLabel(row.approved_by, currentUserId)
        : null,
      createdAt: row.created_at,
    })),
    total: count ?? 0,
  }
}
