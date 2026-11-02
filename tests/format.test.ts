import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime, formatQuantity, formatRupiah } from '../app/utils/format'

describe('formatters', () => {
  it('renders rupiah without decimals and with Indonesian separators', () => {
    const value = formatRupiah(175000).replace(/\s/g, ' ')
    expect(value).toContain('Rp')
    expect(value).toContain('175.000')
  })

  it('keeps unknown money and quantities visibly unknown', () => {
    expect(formatRupiah(null)).toBe('—')
    expect(formatRupiah(undefined)).toBe('—')
    expect(formatQuantity(null)).toBe('—')
  })

  it('supports fractional quantities for metre-based units', () => {
    expect(formatQuantity(2.5)).toBe('2,5')
    expect(formatQuantity(12)).toBe('12')
  })

  it('formats timestamps in the Jakarta business timezone', () => {
    // 2026-10-31T17:30:00Z is 1 November 2026, 00:30 in Asia/Jakarta.
    expect(formatDate('2026-10-31T17:30:00Z')).toContain('2026')
    expect(formatDateTime('2026-10-31T17:30:00Z')).toContain('00.30')
    expect(formatDate('not-a-date')).toBe('—')
  })
})
