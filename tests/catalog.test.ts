import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildProductRpcPayload,
  buildProductSearchFilter,
  clampPage,
  createDebouncer,
  describeCatalogError,
  pageCount,
  stockState,
  validateProductForm,
} from '~/utils/catalog'
import type { ProductFormValues } from '~/types/catalog'

const baseForm: ProductFormValues = {
  productId: null,
  sku: 'TES-001',
  name: 'Produk Uji',
  categoryId: 1,
  unitId: 1,
  salePrice: '',
  lowStockThreshold: '',
  isActive: true,
  reviewStatus: 'verified',
}

describe('product form validation', () => {
  it('allows an unknown selling price and keeps it null in the RPC payload', () => {
    expect(validateProductForm(baseForm)).toEqual({})
    const payload = buildProductRpcPayload(baseForm)
    expect(payload.sale_price).toBeNull()
    expect(payload.low_stock_threshold).toBeNull()
    expect(payload.import_review_status).toBe('verified')
  })

  it('requires SKU, name, and unit and rejects negative numbers', () => {
    const errors = validateProductForm({
      ...baseForm,
      sku: ' ',
      name: '',
      unitId: 0,
      salePrice: '-1',
      lowStockThreshold: '-2.5',
    })
    expect(errors.sku).toBeTruthy()
    expect(errors.name).toBeTruthy()
    expect(errors.unitId).toBeTruthy()
    expect(errors.salePrice).toBeTruthy()
    expect(errors.lowStockThreshold).toBeTruthy()
  })

  it('rejects text that is not a number instead of treating it as zero', () => {
    const errors = validateProductForm({ ...baseForm, salePrice: 'gratis' })
    expect(errors.salePrice).toBeTruthy()
    expect(buildProductRpcPayload({ ...baseForm, salePrice: 'gratis' }).sale_price).toBeNull()
  })

  it('never includes stock fields in a catalog write', () => {
    const payload = buildProductRpcPayload(baseForm)
    expect(payload).not.toHaveProperty('stock_on_hand')
    expect(payload).not.toHaveProperty('stock_version')
    expect(payload).not.toHaveProperty('quantity_before')
    expect(payload).not.toHaveProperty('quantity_after')
  })

  it('preserves an existing import review status when editing', () => {
    const payload = buildProductRpcPayload({
      ...baseForm,
      productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      reviewStatus: 'stock_unknown',
    })
    expect(payload.import_review_status).toBe('stock_unknown')
    expect(payload.product_id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  })
})

describe('stock display rules', () => {
  it('does not turn unknown stock into zero', () => {
    expect(stockState(null, 5)).toBe('unknown')
    expect(stockState(0, 5)).toBe('empty')
  })

  it('flags negative and low stock', () => {
    expect(stockState(-2, 5)).toBe('negative')
    expect(stockState(3, 5)).toBe('low')
    expect(stockState(6, 5)).toBe('available')
  })
})

describe('search filter', () => {
  it('builds exact SKU, prefix, and name contains filters', () => {
    const filter = buildProductSearchFilter(' ele-k001 ')
    expect(filter).toContain('sku_normalized.eq."ELE-K001"')
    expect(filter).toContain('sku_normalized.like."ELE-K001%"')
    expect(filter).toContain('normalized_name.ilike."%ele-k001%"')
  })

  it('quotes commas and escapes like wildcards', () => {
    const filter = buildProductSearchFilter('meja, 50%')
    expect(filter).toContain('"MEJA, 50%"')
    expect(filter).toContain('meja, 50\\\\%')
  })

  it('returns null for an empty search', () => {
    expect(buildProductSearchFilter('   ')).toBeNull()
  })
})

describe('pagination', () => {
  it('computes stable page counts and clamps invalid pages', () => {
    expect(pageCount(0, 50)).toBe(1)
    expect(pageCount(1361, 50)).toBe(28)
    expect(pageCount(1361, 25)).toBe(55)
    expect(clampPage(0, 1361, 50)).toBe(1)
    expect(clampPage(99, 1361, 50)).toBe(28)
  })
})

describe('search debounce', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs once with the latest value after the delay', () => {
    vi.useFakeTimers()
    const received: string[] = []
    const debouncer = createDebouncer<string>(150, (value) => received.push(value))

    debouncer.schedule('a')
    debouncer.schedule('ab')
    debouncer.schedule('abc')
    expect(received).toEqual([])

    vi.advanceTimersByTime(149)
    expect(received).toEqual([])
    vi.advanceTimersByTime(1)
    expect(received).toEqual(['abc'])
  })

  it('cancels a pending search', () => {
    vi.useFakeTimers()
    const callback = vi.fn()
    const debouncer = createDebouncer<string>(150, callback)
    debouncer.schedule('old')
    debouncer.cancel()
    vi.advanceTimersByTime(150)
    expect(callback).not.toHaveBeenCalled()
  })
})

describe('database error messages', () => {
  it('explains duplicate SKU and category errors', () => {
    expect(describeCatalogError(new Error('SKU_ALREADY_EXISTS: duplicate'))).toContain('SKU sudah dipakai')
    expect(describeCatalogError(new Error('CATEGORY_ALREADY_EXISTS: duplicate'))).toContain(
      'Nama kategori sudah dipakai',
    )
  })
})
