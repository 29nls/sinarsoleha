import type {
  CatalogProduct,
  ProductFormErrors,
  ProductFormValues,
  ProductReviewStatus,
} from '~/types/catalog'

const REVIEW_LABELS: Record<ProductReviewStatus, string> = {
  verified: 'Terverifikasi',
  stock_unknown: 'Stok belum diketahui',
  negative_opening_stock: 'Stok awal negatif',
  price_missing: 'Harga jual belum tersedia',
  review_required: 'Perlu pemeriksaan',
}

const ISSUE_LABELS: Record<string, string> = {
  stock_unknown: 'Stok belum diketahui',
  negative_stock: 'Stok negatif',
  sale_price_missing: 'Harga jual belum tersedia',
  purchase_cost_missing: 'Harga beli belum tersedia',
  sale_below_cost: 'Harga jual di bawah harga beli',
  category_unmapped: 'Kategori belum dipetakan',
  unit_unmapped: 'Satuan belum dipetakan',
  duplicate_name: 'Nama produk duplikat',
  other: 'Perlu pemeriksaan',
}

export type StockState = 'unknown' | 'negative' | 'empty' | 'low' | 'available'

export function reviewStatusLabel(value: string): string {
  return REVIEW_LABELS[value as ProductReviewStatus] ?? 'Perlu pemeriksaan'
}

export function issueLabel(code: string, detail?: string | null): string {
  const label = ISSUE_LABELS[code] ?? 'Perlu pemeriksaan'
  return code === 'other' && detail ? `${label}: ${detail}` : label
}

export function stockState(
  stock: number | null,
  threshold: number | null,
): StockState {
  if (stock === null) return 'unknown'
  if (stock < 0) return 'negative'
  if (stock === 0) return 'empty'
  if (threshold !== null && stock <= threshold) return 'low'
  return 'available'
}

export function stockStateLabel(state: StockState): string {
  switch (state) {
    case 'unknown':
      return 'Belum diketahui'
    case 'negative':
      return 'Stok negatif'
    case 'empty':
      return 'Stok habis'
    case 'low':
      return 'Stok rendah'
    default:
      return 'Tersedia'
  }
}

export function normalizeSearch(value: string): string {
  return value.trim()
}

function quotePostgrestValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

/**
 * PostgREST OR filter for exact SKU, SKU prefix, and name contains.
 * Values are quoted so commas and parentheses in a product name cannot
 * inject another filter.
 */
export function buildProductSearchFilter(input: string): string | null {
  const term = normalizeSearch(input)
  if (!term) return null
  const sku = term.toUpperCase()
  const name = escapeLike(term.toLowerCase())
  return [
    `sku_normalized.eq.${quotePostgrestValue(sku)}`,
    `sku_normalized.like.${quotePostgrestValue(`${sku}%`)}`,
    `normalized_name.ilike.${quotePostgrestValue(`%${name}%`)}`,
  ].join(',')
}

export function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

export function validateProductForm(values: ProductFormValues): ProductFormErrors {
  const errors: ProductFormErrors = {}
  const sku = values.sku.trim()
  const name = values.name.trim()

  if (!sku) errors.sku = 'SKU wajib diisi.'
  else if (sku.length > 64) errors.sku = 'SKU maksimal 64 karakter.'

  if (!name) errors.name = 'Nama produk wajib diisi.'
  else if (name.length > 200) errors.name = 'Nama produk maksimal 200 karakter.'

  if (!values.unitId) errors.unitId = 'Satuan wajib dipilih.'

  const salePrice = parseOptionalNumber(values.salePrice)
  if (values.salePrice.trim() && salePrice === null) {
    errors.salePrice = 'Harga jual harus berupa angka.'
  } else if (salePrice !== null && salePrice < 0) {
    errors.salePrice = 'Harga jual tidak boleh negatif.'
  }

  const threshold = parseOptionalNumber(values.lowStockThreshold)
  if (values.lowStockThreshold.trim() && threshold === null) {
    errors.lowStockThreshold = 'Batas stok harus berupa angka.'
  } else if (threshold !== null && threshold < 0) {
    errors.lowStockThreshold = 'Batas stok tidak boleh negatif.'
  }

  return errors
}

export function productToForm(product: CatalogProduct | null): ProductFormValues {
  if (!product) {
    return {
      productId: null,
      sku: '',
      name: '',
      categoryId: null,
      unitId: 0,
      salePrice: '',
      lowStockThreshold: '',
      isActive: true,
      reviewStatus: 'verified',
    }
  }
  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    categoryId: product.categoryId,
    unitId: product.unitId,
    salePrice: product.salePrice === null ? '' : String(product.salePrice),
    lowStockThreshold:
      product.lowStockThreshold === null ? '' : String(product.lowStockThreshold),
    isActive: product.isActive,
    reviewStatus: product.reviewStatus,
  }
}

/**
 * Build the RPC payload. Stock fields are deliberately absent: catalog writes
 * must never move inventory. reviewStatus is passed back so editing a product
 * does not silently reset its import review mark.
 */
export function buildProductRpcPayload(values: ProductFormValues) {
  return {
    product_id: values.productId,
    sku: values.sku.trim(),
    name: values.name.trim(),
    category_id: values.categoryId,
    unit_id: values.unitId,
    sale_price: parseOptionalNumber(values.salePrice),
    low_stock_threshold: parseOptionalNumber(values.lowStockThreshold),
    is_active: values.isActive,
    import_review_status: values.reviewStatus || 'verified',
  }
}

export function productPayloadFromCatalog(
  product: CatalogProduct,
  overrides: Partial<{ isActive: boolean }> = {},
) {
  return buildProductRpcPayload({
    productId: product.id,
    sku: product.sku,
    name: product.name,
    categoryId: product.categoryId,
    unitId: product.unitId,
    salePrice: product.salePrice === null ? '' : String(product.salePrice),
    lowStockThreshold:
      product.lowStockThreshold === null ? '' : String(product.lowStockThreshold),
    isActive: overrides.isActive ?? product.isActive,
    reviewStatus: product.reviewStatus,
  })
}

export function describeCatalogError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Operasi gagal.'
  if (message.includes('SKU_ALREADY_EXISTS')) {
    return 'SKU sudah dipakai produk lain. Perbandingan mengabaikan huruf besar/kecil.'
  }
  if (message.includes('CATEGORY_ALREADY_EXISTS')) {
    return 'Nama kategori sudah dipakai. Perbandingan mengabaikan huruf besar/kecil.'
  }
  if (message.includes('CATEGORY_NOT_FOUND')) return 'Kategori tidak ditemukan.'
  if (message.includes('UNIT_NOT_FOUND')) return 'Satuan tidak ditemukan.'
  if (message.includes('PRODUCT_NOT_FOUND')) return 'Produk tidak ditemukan.'
  if (message.includes('INVALID_SKU')) return 'SKU tidak valid.'
  if (message.includes('INVALID_NAME')) return 'Nama produk tidak valid.'
  if (message.includes('INVALID_SALE_PRICE')) return 'Harga jual tidak valid.'
  if (message.includes('INVALID_LOW_STOCK')) return 'Batas stok tidak valid.'
  if (message.includes('INVALID_CATEGORY_NAME')) return 'Nama kategori tidak valid.'
  if (message.includes('INVALID_PURCHASE_COST')) return 'Harga beli tidak valid.'
  if (message.includes('permission denied') || message.includes('row-level security')) {
    return 'Anda tidak memiliki izin untuk operasi ini.'
  }
  return message.replace(/^[A-Z_]+:\s*/, '')
}

export function pageCount(total: number, pageSize: number): number {
  if (total <= 0) return 1
  return Math.max(1, Math.ceil(total / pageSize))
}

export function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(1, page), pageCount(total, pageSize))
}

export function createDebouncer<T>(delayMs: number, callback: (value: T) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null

  function cancel() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function schedule(value: T) {
    cancel()
    timer = setTimeout(() => {
      timer = null
      callback(value)
    }, delayMs)
  }

  return { schedule, cancel }
}
