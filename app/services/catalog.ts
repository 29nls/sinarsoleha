import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'
import type {
  CatalogProduct,
  CategoryOption,
  ProductIssue,
  ProductListParams,
  ProductListResult,
  UnitOption,
} from '~/types/catalog'
import { buildProductSearchFilter, describeCatalogError } from '~/utils/catalog'

type Client = SupabaseClient<Database>

interface ProductSelectRow {
  id: string
  sku: string
  name: string
  category_id: number | null
  unit_id: number
  sale_price: number | null
  stock_on_hand: number | null
  low_stock_threshold: number | null
  is_active: boolean
  import_review_status: string
  categories: { name: string } | null
  units_of_measure: { label: string; code: string } | null
}

const PRODUCT_SELECT =
  'id, sku, name, category_id, unit_id, sale_price, stock_on_hand, low_stock_threshold, is_active, import_review_status, categories(name), units_of_measure(label, code)'

function fail(error: { message: string }): never {
  throw new Error(describeCatalogError(error.message))
}

export async function listProducts(
  client: Client,
  params: ProductListParams,
): Promise<ProductListResult> {
  let query = client
    .from('products')
    .select(PRODUCT_SELECT, { count: 'exact' })
    .order('sku_normalized', { ascending: true })
    .order('name', { ascending: true })

  const searchFilter = buildProductSearchFilter(params.search)
  if (searchFilter) query = query.or(searchFilter)
  if (params.categoryId !== null) query = query.eq('category_id', params.categoryId)
  if (params.unitId !== null) query = query.eq('unit_id', params.unitId)
  if (params.active !== 'all') query = query.eq('is_active', params.active === 'active')
  if (params.missingPrice) query = query.is('sale_price', null)
  if (params.unknownStock) query = query.is('stock_on_hand', null)
  if (params.negativeStock) query = query.lt('stock_on_hand', 0)
  if (params.reviewStatus === 'review') {
    query = query.neq('import_review_status', 'verified')
  } else if (params.reviewStatus) {
    query = query.eq('import_review_status', params.reviewStatus)
  }

  const from = (params.page - 1) * params.pageSize
  query = query.range(from, from + params.pageSize - 1)

  const { data, error, count } = await query.returns<ProductSelectRow[]>()
  if (error) fail(error)

  return {
    products: (data ?? []).map((row) => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
      categoryId: row.category_id,
      categoryName: row.categories?.name ?? null,
      unitId: row.unit_id,
      unitLabel: row.units_of_measure?.label ?? '—',
      unitCode: row.units_of_measure?.code ?? '',
      salePrice: row.sale_price,
      stockOnHand: row.stock_on_hand,
      lowStockThreshold: row.low_stock_threshold,
      isActive: row.is_active,
      reviewStatus: row.import_review_status,
      purchaseCost: null,
      issues: [],
    })),
    total: count ?? 0,
  }
}

export async function listProductCosts(
  client: Client,
  productIds: string[],
): Promise<Map<string, number | null>> {
  if (productIds.length === 0) return new Map()
  const { data, error } = await client
    .from('product_costs')
    .select('product_id, purchase_cost')
    .in('product_id', productIds)
  if (error) fail(error)
  return new Map((data ?? []).map((row) => [row.product_id, row.purchase_cost]))
}

export async function listProductIssues(
  client: Client,
  productIds: string[],
): Promise<Map<string, ProductIssue[]>> {
  if (productIds.length === 0) return new Map()
  const { data, error } = await client
    .from('product_data_issues')
    .select('product_id, issue_code, detail')
    .in('product_id', productIds)
    .is('resolved_at', null)
  if (error) fail(error)

  const result = new Map<string, ProductIssue[]>()
  for (const row of data ?? []) {
    const current = result.get(row.product_id) ?? []
    current.push({ code: row.issue_code, detail: row.detail })
    result.set(row.product_id, current)
  }
  return result
}

export async function listCategories(client: Client): Promise<CategoryOption[]> {
  const { data, error } = await client
    .from('categories')
    .select('id, name, is_active')
    .order('name', { ascending: true })
  if (error) fail(error)
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    isActive: row.is_active,
  }))
}

export async function listUnits(client: Client): Promise<UnitOption[]> {
  const { data, error } = await client
    .from('units_of_measure')
    .select('id, code, label, is_active')
    .order('label', { ascending: true })
  if (error) fail(error)
  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    label: row.label,
    isActive: row.is_active,
  }))
}

export async function upsertProduct(
  client: Client,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await client.rpc('upsert_product', {
    p_payload: payload as never,
  })
  if (error) fail(error)
}

export async function setProductCost(
  client: Client,
  productId: string,
  purchaseCost: number | null,
): Promise<void> {
  const { error } = await client.rpc('set_product_cost', {
    p_product_id: productId,
    p_purchase_cost: purchaseCost as never,
  })
  if (error) fail(error)
}

export async function upsertCategory(
  client: Client,
  payload: Record<string, unknown>,
): Promise<CategoryOption> {
  const { data, error } = await client.rpc('upsert_category', {
    p_payload: payload as never,
  })
  if (error) fail(error)
  const row = (typeof data === 'string' ? JSON.parse(data) : data) as {
    id: number
    name: string
    is_active: boolean
  }
  return { id: row.id, name: row.name, isActive: row.is_active }
}

export function applyOwnerDetails(
  products: CatalogProduct[],
  costs: Map<string, number | null>,
  issues: Map<string, ProductIssue[]>,
): CatalogProduct[] {
  return products.map((product) => ({
    ...product,
    purchaseCost: costs.get(product.id) ?? null,
    issues: issues.get(product.id) ?? [],
  }))
}
