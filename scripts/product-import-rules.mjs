/**
 * Pure rules for the Phase 3B product master import.
 *
 * No I/O and no Supabase client here, so the dry-run, the importer and the
 * unit tests all share one implementation of parsing and classification.
 */

export const WORKSHEET = 'PART MASTER'
export const HEADER_ROW = 2
export const FIRST_DATA_ROW = 3

/** Canonical unit codes seeded in migration 20261102090100_reference_data.sql. */
export const UNIT_CODES = ['PCS', 'LUSIN', 'METER', 'ROLL', 'SET', 'PAX', 'PACK', 'KARUNG']

/** issue_code values allowed by public.product_data_issues. */
const ISSUE_CODES = new Set([
  'stock_unknown',
  'negative_stock',
  'sale_price_missing',
  'purchase_cost_missing',
  'sale_below_cost',
  'category_unmapped',
  'unit_unmapped',
  'duplicate_name',
])

/** Allowed import_review_status values in public.products. */
const REVIEW_STATUSES = new Set([
  'verified',
  'stock_unknown',
  'negative_opening_stock',
  'price_missing',
  'review_required',
])

/**
 * ExcelJS returns numbers, strings, null, or an object for formulas and rich
 * text. The cached result is the only value Excel stored for a formula cell.
 */
export function cellText(cell) {
  const value = cell?.value
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object' && 'result' in value) {
    const result = value.result
    if (result === null || result === undefined) return ''
    if (typeof result === 'object' && 'error' in result) return String(result.error)
    return typeof result === 'number' ? String(result) : String(result)
  }
  if (Array.isArray(value.richText)) return value.richText.map((part) => part.text ?? '').join('')
  if (typeof value.text === 'string') return value.text
  return String(value)
}

export function cellResult(cell) {
  const value = cell?.value
  if (value !== null && typeof value === 'object' && 'result' in value) return value.result
  return value
}

export function collapseWhitespace(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

export function normalizeSku(rawSku) {
  return collapseWhitespace(rawSku).toUpperCase()
}

export function normalizeName(rawName) {
  return collapseWhitespace(rawName)
}

/** Categories keep their original spelling and case; only whitespace changes. */
export function normalizeCategory(rawCategory) {
  return collapseWhitespace(rawCategory)
}

export function mapUnit(rawUnit) {
  const code = collapseWhitespace(rawUnit).toUpperCase()
  return UNIT_CODES.includes(code) ? code : null
}

function parseLocalizedNumber(input) {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') return Number.isFinite(input) ? input : Number.NaN
  let text = String(input).trim()
  if (text === '') return null
  text = text.replace(/^rp\.?\s*/i, '').replace(/[\s\u00a0]/g, '')
  if (text.includes('.') && text.includes(',')) {
    const decimal = text.lastIndexOf(',') > text.lastIndexOf('.') ? ',' : '.'
    const grouping = decimal === ',' ? '.' : ','
    text = text.split(grouping).join('').replace(decimal, '.')
  } else if (text.includes('.')) {
    text = /^-?\d{1,3}(\.\d{3})+$/.test(text) ? text.split('.').join('') : text
  } else if (text.includes(',')) {
    text = /^-?\d{1,3}(,\d{3})+$/.test(text) ? text.split(',').join('') : text.replace(',', '.')
  }
  return text === '' ? null : Number(text)
}

function decimalScale(value) {
  const text = String(value)
  if (text.includes('e') || text.includes('E')) return 4
  if (!text.includes('.')) return 0
  return text.split('.')[1].length
}

/**
 * Money is numeric(14,2). Missing stays null; negative and over-precision
 * values are rejected instead of being rounded or coerced to zero.
 */
export function parseMoney(input) {
  const value = parseLocalizedNumber(input)
  if (value === null) return { value: null, error: null }
  if (!Number.isFinite(value)) return { value: null, error: 'Nilai uang tidak dapat dibaca.' }
  if (value < 0) return { value: null, error: 'Nilai uang negatif tidak diizinkan.' }
  if (decimalScale(value) > 2) return { value: null, error: 'Nilai uang melebihi 2 desimal.' }
  return { value: Math.round(value * 100) / 100, error: null }
}

/** Stock/quantity is numeric(14,3); negative source stock is preserved. */
export function parseQuantity(input) {
  const value = parseLocalizedNumber(input)
  if (value === null) return { value: null, error: null }
  if (!Number.isFinite(value)) return { value: null, error: 'Nilai kuantitas tidak dapat dibaca.' }
  if (decimalScale(value) > 3) return { value: null, error: 'Nilai kuantitas melebihi 3 desimal.' }
  return { value: Math.round(value * 1000) / 1000, error: null }
}

/** Review label precedence: price, then negative opening stock, then unknown. */
export function reviewStatusFor(issueCodes) {
  const codes = new Set(issueCodes)
  if (codes.has('review_required_row')) return 'review_required'
  if (codes.has('sale_price_missing')) return 'price_missing'
  if (codes.has('negative_stock')) return 'negative_opening_stock'
  return 'stock_unknown'
}

export function issueCodesFor({ salePriceMissing, purchaseCostMissing, stockSource, saleBelowCost, categoryMissing, duplicateName }) {
  const codes = []
  if (stockSource === null) codes.push('stock_unknown')
  else if (stockSource < 0) codes.push('negative_stock')
  else codes.push('stock_unknown')
  if (salePriceMissing) codes.push('sale_price_missing')
  if (purchaseCostMissing) codes.push('purchase_cost_missing')
  if (saleBelowCost) codes.push('sale_below_cost')
  if (categoryMissing) codes.push('category_unmapped')
  if (duplicateName) codes.push('duplicate_name')
  return codes.filter((code) => ISSUE_CODES.has(code))
}

export function isReviewStatus(value) {
  return REVIEW_STATUSES.has(value)
}

/**
 * One source row in, one classified row out. status:
 *   ready    — required fields valid, importable
 *   review   — needs an owner decision before import
 *   rejected — violates a mandatory constraint
 */
export function classifyRow(row) {
  const errors = []
  if (!row.sku) errors.push({ field: 'sku', code: 'SKU_REQUIRED', message: 'SKU kosong.' })
  if (!row.name) errors.push({ field: 'name', code: 'NAME_REQUIRED', message: 'Nama produk kosong.' })
  if (row.sku.length > 64) errors.push({ field: 'sku', code: 'SKU_TOO_LONG', message: 'SKU melebihi 64 karakter.' })
  if (row.name.length > 200) errors.push({ field: 'name', code: 'NAME_TOO_LONG', message: 'Nama melebihi 200 karakter.' })
  if (!row.unitCode) errors.push({ field: 'unit', code: 'UNIT_UNMAPPED', message: `Satuan "${row.unitRaw}" tidak dikenal.` })
  if (row.salePriceError) errors.push({ field: 'sale_price', code: 'SALE_PRICE_INVALID', message: row.salePriceError })
  if (row.purchaseCostError) errors.push({ field: 'purchase_cost', code: 'PURCHASE_COST_INVALID', message: row.purchaseCostError })
  if (row.stockError) errors.push({ field: 'stock', code: 'STOCK_INVALID', message: row.stockError })
  if (row.duplicateSku) errors.push({ field: 'sku', code: 'DUPLICATE_SKU', message: 'SKU duplikat (mengabaikan huruf besar/kecil).' })

  const issueCodes = issueCodesFor({
    salePriceMissing: row.salePrice === null,
    purchaseCostMissing: row.purchaseCost === null,
    stockSource: row.stockSource,
    saleBelowCost: row.salePrice !== null && row.purchaseCost !== null && row.salePrice < row.purchaseCost,
    categoryMissing: !row.category,
    duplicateName: row.duplicateNameCandidate,
  })

  let status = 'ready'
  const reviewReasons = []
  if (errors.length > 0) status = 'rejected'
  else if (row.duplicateNameCandidate) {
    status = 'review'
    reviewReasons.push('Nama produk sama dengan baris lain setelah normalisasi.')
  } else if (!row.category) {
    status = 'review'
    reviewReasons.push('Kategori tidak dapat dipetakan.')
  } else if (row.salePrice !== null && row.purchaseCost !== null && row.salePrice < row.purchaseCost) {
    status = 'review'
    reviewReasons.push('Harga jual di bawah harga beli; perlu keputusan owner.')
  }

  const reviewStatus = status === 'rejected' ? 'review_required' : reviewStatusFor(
    status === 'review' ? [...issueCodes, 'review_required_row'] : issueCodes,
  )

  return {
    status,
    reviewStatus: isReviewStatus(reviewStatus) ? reviewStatus : 'review_required',
    issueCodes,
    errors,
    reviewReasons,
  }
}

export function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
