import { describe, expect, it } from 'vitest'
import {
  classifyRow,
  mapUnit,
  normalizeCategory,
  normalizeName,
  normalizeSku,
  parseMoney,
  parseQuantity,
} from '../scripts/product-import-rules.mjs'

const baseRow = {
  sku: 'ELE-K001',
  name: 'Kipas Angin Dinding',
  category: 'ELEKTRONIK KIPAS ANGIN',
  unitCode: 'PCS',
  unitRaw: 'Pcs',
  salePrice: 175000,
  purchaseCost: 125000,
  stockSource: 9,
  salePriceError: null,
  purchaseCostError: null,
  stockError: null,
  duplicateSku: false,
  duplicateNameCandidate: false,
}

describe('SKU and text normalization', () => {
  it('compares SKUs case-insensitively after trimming', () => {
    expect(normalizeSku('  ele-k001 ')).toBe('ELE-K001')
    expect(normalizeSku('ELE-K001')).toBe(normalizeSku('ele-k001'))
  })

  it('keeps the original spelling while trimming and collapsing whitespace', () => {
    expect(normalizeName('  Kipas  Angin   Dinding ')).toBe('Kipas Angin Dinding')
    expect(normalizeCategory(' PERABOTAN  SARINGAN ')).toBe('PERABOTAN SARINGAN')
  })

  it('unifies raw unit spellings without converting quantities', () => {
    expect(mapUnit('Pcs')).toBe('PCS')
    expect(mapUnit('Pcs ')).toBe('PCS')
    expect(mapUnit('LUSIN')).toBe('LUSIN')
    expect(mapUnit('Lusin')).toBe('LUSIN')
    expect(mapUnit('Kilogram')).toBeNull()
  })

  it('collapses two raw category labels that only differ by a trailing space', () => {
    expect(normalizeCategory('PERABOTAN SARINGAN')).toBe(normalizeCategory('PERABOTAN SARINGAN '))
  })
})

describe('money and quantity parsing', () => {
  it('keeps missing money as null and never as zero', () => {
    expect(parseMoney('').value).toBeNull()
    expect(parseMoney(null).value).toBeNull()
    expect(parseMoney(0).value).toBe(0)
  })

  it('parses Indonesian currency formats', () => {
    expect(parseMoney('Rp 12.500').value).toBe(12500)
    expect(parseMoney('12.500,50').value).toBe(12500.5)
    expect(parseMoney('9500').value).toBe(9500)
  })

  it('rejects negative and over-precision money', () => {
    expect(parseMoney(-1).error).toBeTruthy()
    expect(parseMoney('12.500,555').error).toBeTruthy()
  })

  it('preserves negative stock values at three decimals', () => {
    expect(parseQuantity('-3').value).toBe(-3)
    expect(parseQuantity('1,25').value).toBe(1.25)
    expect(parseQuantity('').value).toBeNull()
    expect(parseQuantity('1,2345').error).toBeTruthy()
  })
})

describe('row classification', () => {
  it('marks a complete row ready with a stock_unknown issue', () => {
    const result = classifyRow(baseRow)
    expect(result.status).toBe('ready')
    expect(result.reviewStatus).toBe('stock_unknown')
    expect(result.issueCodes).toContain('stock_unknown')
    expect(result.errors).toEqual([])
  })

  it('keeps a missing selling price importable but flagged', () => {
    const result = classifyRow({ ...baseRow, salePrice: null })
    expect(result.status).toBe('ready')
    expect(result.reviewStatus).toBe('price_missing')
    expect(result.issueCodes).toContain('sale_price_missing')
  })

  it('flags negative source stock without importing it', () => {
    const result = classifyRow({ ...baseRow, stockSource: -3 })
    expect(result.status).toBe('ready')
    expect(result.reviewStatus).toBe('negative_opening_stock')
    expect(result.issueCodes).toEqual(['negative_stock'])
  })

  it('sends below-cost rows to review instead of importing them', () => {
    const result = classifyRow({ ...baseRow, salePrice: 9500, purchaseCost: 20000 })
    expect(result.status).toBe('review')
    expect(result.reviewStatus).toBe('review_required')
    expect(result.issueCodes).toContain('sale_below_cost')
  })

  it('rejects rows without SKU, name, or a known unit', () => {
    const result = classifyRow({ ...baseRow, sku: '', name: '', unitCode: null, unitRaw: 'Kilogram' })
    expect(result.status).toBe('rejected')
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['SKU_REQUIRED', 'NAME_REQUIRED', 'UNIT_UNMAPPED']),
    )
  })

  it('rejects duplicate SKUs and reviews duplicate names', () => {
    expect(classifyRow({ ...baseRow, duplicateSku: true }).status).toBe('rejected')
    const duplicateName = classifyRow({ ...baseRow, duplicateNameCandidate: true })
    expect(duplicateName.status).toBe('review')
    expect(duplicateName.issueCodes).toContain('duplicate_name')
  })

  it('reviews rows whose category cannot be mapped', () => {
    const result = classifyRow({ ...baseRow, category: '' })
    expect(result.status).toBe('review')
    expect(result.issueCodes).toContain('category_unmapped')
  })
})
