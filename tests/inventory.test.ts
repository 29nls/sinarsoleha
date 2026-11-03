import { describe, expect, it } from 'vitest'
import {
  actorLabel,
  describeInventoryError,
  endOfJakartaDay,
  emptyDiscrepancyFilters,
  emptyMovementFilters,
  emptyStockBalanceFilters,
  isInboundMovement,
  movementTypeLabel,
  startOfJakartaDay,
} from '../app/types/inventory'

describe('inventory labels', () => {
  it('labels every movement type', () => {
    expect(movementTypeLabel('sale_out')).toBe('Penjualan')
    expect(movementTypeLabel('opname_adjustment')).toBe('Penyesuaian opname')
    expect(movementTypeLabel('void_reversal')).toBe('Pembatalan penjualan')
  })

  it('falls back to the raw type', () => {
    expect(movementTypeLabel('transfer')).toBe('transfer')
  })

  it('detects inbound movements from the delta, not the type', () => {
    expect(isInboundMovement({ quantityDelta: 3 })).toBe(true)
    expect(isInboundMovement({ quantityDelta: -3 })).toBe(false)
  })
})

describe('actor labels', () => {
  it('names the current user and shortens everyone else', () => {
    expect(actorLabel('11111111-2222-3333-4444-555555555555', '11111111-2222-3333-4444-555555555555'))
      .toBe('Anda')
    expect(actorLabel('abcdefgh-2222-3333-4444-555555555555', 'other')).toBe('Staf abcdefgh')
  })

  it('renders a dash when the actor is missing', () => {
    expect(actorLabel(null, 'x')).toBe('—')
  })
})

describe('empty filters', () => {
  it('returns a fresh object each time', () => {
    const first = emptyMovementFilters()
    const second = emptyMovementFilters()
    expect(first).toEqual({ movementType: '', dateFrom: '', dateTo: '' })
    expect(first).not.toBe(second)
    expect(emptyStockBalanceFilters()).toEqual({ state: 'all' })
    expect(emptyDiscrepancyFilters()).toEqual({ reasonCode: '', dateFrom: '', dateTo: '' })
  })
})

describe('Jakarta day boundaries', () => {
  it('expands a date into an inclusive +07:00 range', () => {
    expect(startOfJakartaDay('2026-11-04')).toBe('2026-11-04T00:00:00+07:00')
    expect(endOfJakartaDay('2026-11-04')).toBe('2026-11-04T23:59:59.999+07:00')
  })
})

describe('describeInventoryError', () => {
  it('translates known codes', () => {
    expect(describeInventoryError(new Error('STOCK_LEDGER_IMMUTABLE: nope')))
      .toBe('Ledger stok tidak dapat diubah; buat movement koreksi baru.')
  })

  it('translates permission errors', () => {
    expect(describeInventoryError('permission denied for table stock_movements'))
      .toBe('Anda tidak memiliki izin untuk melihat data inventaris.')
  })

  it('strips a leading code from an unknown message', () => {
    expect(describeInventoryError('SOMETHING: Gagal membaca')).toBe('Gagal membaca')
  })

  it('falls back when the cause is not an error', () => {
    expect(describeInventoryError(null)).toBe('Gagal memuat data inventaris.')
  })
})
