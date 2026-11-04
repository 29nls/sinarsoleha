import { describe, expect, it } from 'vitest'
import { ADJUSTMENT_REASONS, validateAdjustment } from '../app/types/inventory'

const base = {
  stockOnHand: 10,
  delta: '-2',
  reasonCode: 'broken_damaged',
  reasonNote: 'Pecah saat dipajang',
  decimalScale: 0,
}

describe('manual stock adjustment validation', () => {
  it('accepts a valid decrease and a valid increase', () => {
    expect(validateAdjustment(base)).toBeNull()
    expect(validateAdjustment({ ...base, delta: '2.5', decimalScale: 1 })).toBeNull()
  })

  it('refuses unknown stock, zero and non numeric input', () => {
    expect(validateAdjustment({ ...base, stockOnHand: null })).toContain('Stok Opname')
    expect(validateAdjustment({ ...base, delta: '0' })).toContain('tidak boleh nol')
    expect(validateAdjustment({ ...base, delta: '  ' })).toContain('wajib diisi')
    expect(validateAdjustment({ ...base, delta: 'abc' })).toContain('harus berupa angka')
  })

  it('refuses a result below zero and precision beyond the unit scale', () => {
    expect(validateAdjustment({ ...base, delta: '-11' })).toContain('negatif')
    expect(validateAdjustment({ ...base, delta: '-1.5' })).toContain('desimal')
    expect(validateAdjustment({ ...base, delta: '-1.55', decimalScale: 1 })).toContain('1 angka desimal')
  })

  it('requires a known reason and a note', () => {
    expect(validateAdjustment({ ...base, reasonCode: '' })).toContain('Pilih alasan')
    expect(validateAdjustment({ ...base, reasonCode: 'opening_balance' })).toContain('Pilih alasan')
    expect(validateAdjustment({ ...base, reasonNote: '   ' })).toContain('Catatan')
    expect(validateAdjustment({ ...base, reasonNote: 'x'.repeat(501) })).toContain('500')
  })

  it('never offers opening_balance as a manual reason', () => {
    expect(ADJUSTMENT_REASONS).not.toContain('opening_balance')
    expect(ADJUSTMENT_REASONS).toContain('other')
  })
})
