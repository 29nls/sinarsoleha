import { describe, expect, it } from 'vitest'
import {
  allowedReasons,
  blockerCount,
  countStatusLabel,
  describeOpnameError,
  isOpnameCancellable,
  isOpnameEditable,
  isOpnameFinal,
  opnameReasonLabel,
  opnameStatusLabel,
  reasonRequirement,
  validateCancelReason,
  validateCount,
  validateScopeNote,
} from '../app/types/opname'

describe('opname status helpers', () => {
  it('labels every database status in Indonesian', () => {
    expect(opnameStatusLabel('counting')).toBe('Menghitung')
    expect(opnameStatusLabel('submitted')).toBe('Menunggu persetujuan')
    expect(opnameStatusLabel('posted')).toBe('Terposting')
    expect(opnameStatusLabel('cancelled')).toBe('Dibatalkan')
    expect(countStatusLabel('needs_recount')).toBe('Perlu hitung ulang')
  })

  it('falls back to the raw value for an unknown status', () => {
    expect(opnameStatusLabel('archived')).toBe('archived')
    expect(countStatusLabel('archived')).toBe('archived')
  })

  it('labels reason codes and renders a dash for null', () => {
    expect(opnameReasonLabel('broken_damaged')).toBe('Rusak')
    expect(opnameReasonLabel('unrecorded_in')).toBe('Masuk tanpa catatan')
    expect(opnameReasonLabel(null)).toBe('—')
  })

  it('treats posted and cancelled as final', () => {
    expect(isOpnameFinal('posted')).toBe(true)
    expect(isOpnameFinal('cancelled')).toBe(true)
    expect(isOpnameFinal('approved')).toBe(false)
  })

  it('only allows counting while the session is in counting', () => {
    expect(isOpnameEditable('counting')).toBe(true)
    expect(isOpnameEditable('submitted')).toBe(false)
    expect(isOpnameEditable('approved')).toBe(false)
  })

  it('allows cancelling anything that is not final', () => {
    expect(isOpnameCancellable('counting')).toBe(true)
    expect(isOpnameCancellable('submitted')).toBe(true)
    expect(isOpnameCancellable('approved')).toBe(true)
    expect(isOpnameCancellable('posted')).toBe(false)
    expect(isOpnameCancellable('cancelled')).toBe(false)
  })
})

describe('scope note and cancel reason validation', () => {
  it('accepts notes at the 500 character limit', () => {
    expect(validateScopeNote('a'.repeat(500))).toBeNull()
  })

  it('rejects notes beyond the limit', () => {
    expect(validateScopeNote('a'.repeat(501))).toContain('500')
  })

  it('requires a non-blank cancel reason', () => {
    expect(validateCancelReason('   ')).toBe('Alasan pembatalan wajib diisi.')
    expect(validateCancelReason('Salah pilih kategori')).toBeNull()
    expect(validateCancelReason('a'.repeat(501))).toContain('500')
  })
})

describe('count reason requirements', () => {
  it('always demands an opening balance reason when stock is unknown', () => {
    expect(reasonRequirement(null, 10)).toBe('opening_balance')
    expect(reasonRequirement(null, null)).toBe('opening_balance')
  })

  it('demands a reason only when the count differs', () => {
    expect(reasonRequirement(10, 10)).toBe('none')
    expect(reasonRequirement(10, 9)).toBe('difference')
    expect(reasonRequirement(10, null)).toBe('none')
  })

  it('restricts reason choices to opening_balance for unknown stock', () => {
    expect(allowedReasons(null)).toEqual(['opening_balance'])
    expect(allowedReasons(5)).not.toContain('opening_balance')
    expect(allowedReasons(5)).toContain('missing')
  })
})

describe('validateCount', () => {
  const base = {
    systemQty: 10 as number | null,
    physicalQty: '10',
    reasonCode: '',
    reasonNote: '',
    decimalScale: 0,
  }

  it('accepts a matching count without a reason', () => {
    expect(validateCount(base)).toBeNull()
  })

  it('rejects an empty count', () => {
    expect(validateCount({ ...base, physicalQty: '  ' })).toBe('Jumlah fisik wajib diisi.')
  })

  it('rejects non-numeric input', () => {
    expect(validateCount({ ...base, physicalQty: 'sepuluh' })).toContain('angka')
  })

  it('rejects negative quantities', () => {
    expect(validateCount({ ...base, physicalQty: '-1' })).toContain('negatif')
  })

  it('accepts a comma as the decimal separator', () => {
    expect(validateCount({ ...base, systemQty: 1.5, physicalQty: '1,5', decimalScale: 3 }))
      .toBeNull()
  })

  it('enforces the unit decimal scale', () => {
    expect(validateCount({ ...base, systemQty: 1, physicalQty: '1.25', decimalScale: 0 }))
      .toContain('desimal')
    expect(validateCount({ ...base, systemQty: 1, physicalQty: '1.25', decimalScale: 1 }))
      .toContain('1 angka desimal')
    // A matching count at the allowed scale needs no reason.
    expect(validateCount({ ...base, systemQty: 1.25, physicalQty: '1.25', decimalScale: 2 }))
      .toBeNull()
    // The same number is a discrepancy against a whole-number balance.
    expect(validateCount({ ...base, systemQty: 1, physicalQty: '1.25', decimalScale: 2 }))
      .toBe('Selisih stok wajib memiliki alasan.')
  })

  it('requires a reason for a discrepancy', () => {
    expect(validateCount({ ...base, physicalQty: '8' }))
      .toBe('Selisih stok wajib memiliki alasan.')
  })

  it('rejects opening_balance for a known balance', () => {
    expect(validateCount({ ...base, physicalQty: '8', reasonCode: 'opening_balance' }))
      .toContain('Saldo awal hanya untuk')
  })

  it('requires a note when the reason is other', () => {
    expect(validateCount({ ...base, physicalQty: '8', reasonCode: 'other' }))
      .toBe('Alasan Lainnya wajib disertai catatan.')
    expect(validateCount({
      ...base,
      physicalQty: '8',
      reasonCode: 'other',
      reasonNote: 'Salah input kemarin',
    })).toBeNull()
  })

  it('forces opening_balance and a note for unknown stock', () => {
    expect(validateCount({ ...base, systemQty: null, physicalQty: '4' }))
      .toBe('Stok sistem belum diketahui; pilih alasan Saldo awal.')
    expect(validateCount({
      ...base,
      systemQty: null,
      physicalQty: '4',
      reasonCode: 'opening_balance',
    })).toBe('Catatan wajib diisi untuk saldo awal.')
    expect(validateCount({
      ...base,
      systemQty: null,
      physicalQty: '4',
      reasonCode: 'opening_balance',
      reasonNote: 'Hitung awal rak baru',
    })).toBeNull()
  })

  it('clears the reason requirement when the count matches a known balance', () => {
    expect(validateCount({
      ...base,
      physicalQty: '10',
      reasonCode: 'opening_balance',
    })).toBeNull()
  })
})

describe('describeOpnameError', () => {
  it('translates known database codes', () => {
    expect(describeOpnameError(new Error('OPNAME_INCOMPLETE: Masih ada item belum lengkap.')))
      .toBe('Masih ada item yang belum lengkap.')
    expect(describeOpnameError('OPNAME_POSTED: Sesi yang sudah diposting tidak dapat dibatalkan.'))
      .toBe('Sesi yang sudah terposting tidak dapat dibatalkan.')
    expect(describeOpnameError(new Error('OPENING_BALANCE_NOTE_REQUIRED: Catatan wajib diisi.')))
      .toBe('Catatan wajib diisi untuk saldo awal.')
  })

  it('explains permission and session failures', () => {
    expect(describeOpnameError(new Error('permission denied for table stock_opnames')))
      .toBe('Anda tidak memiliki izin untuk operasi ini.')
    expect(describeOpnameError(new Error('JWT expired')))
      .toBe('Sesi Anda berakhir. Masuk kembali.')
  })

  it('strips an unknown code prefix but keeps the message', () => {
    expect(describeOpnameError(new Error('SOMETHING_ELSE: Coba lagi nanti.')))
      .toBe('Coba lagi nanti.')
  })

  it('falls back to a generic sentence', () => {
    expect(describeOpnameError(null)).toBe('Operasi opname gagal.')
    expect(describeOpnameError(new Error(''))).toBe('Operasi opname gagal.')
  })
})

describe('blockerCount', () => {
  it('counts blockers in the error detail payload', () => {
    expect(blockerCount('[{"item_id":"a"},{"item_id":"b"}]')).toBe(2)
    expect(blockerCount('[]')).toBe(0)
  })

  it('returns zero for unusable detail', () => {
    expect(blockerCount(null)).toBe(0)
    expect(blockerCount('not json')).toBe(0)
    expect(blockerCount({})).toBe(0)
  })
})
