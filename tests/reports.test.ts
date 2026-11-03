import { describe, expect, it } from 'vitest'
import {
  addDays,
  csvFileName,
  describeReportError,
  firstOfMonth,
  normalizeRange,
  rangeForPreset,
  roundMoney,
  roundQuantity,
  salesTotals,
  summarizeSales,
  toCsv,
} from '../app/types/reports'
import type { SalesReportRow } from '../app/types/reports'

function row(overrides: Partial<SalesReportRow> = {}): SalesReportRow {
  return {
    id: 't-1',
    receiptNo: 'SS-20261104-0001',
    businessDate: '2026-11-04',
    cashierId: 'u-1',
    subtotal: 100000,
    discountAmount: 5000,
    grandTotal: 95000,
    paymentMethod: 'cash',
    status: 'completed',
    createdAt: '2026-11-04T03:00:00Z',
    ...overrides,
  }
}

describe('report ranges', () => {
  it('anchors presets on the Jakarta business day', () => {
    expect(rangeForPreset('today', '2026-11-04')).toEqual({
      from: '2026-11-04',
      to: '2026-11-04',
    })
    expect(rangeForPreset('7d', '2026-11-04')).toEqual({
      from: '2026-10-29',
      to: '2026-11-04',
    })
    expect(rangeForPreset('30d', '2026-11-04')).toEqual({
      from: '2026-10-06',
      to: '2026-11-04',
    })
    expect(rangeForPreset('month', '2026-11-04')).toEqual({
      from: '2026-11-01',
      to: '2026-11-04',
    })
  })

  it('crosses a month boundary when subtracting days', () => {
    expect(addDays('2026-11-02', -3)).toBe('2026-10-30')
    expect(firstOfMonth('2026-11-04')).toBe('2026-11-01')
  })

  it('swaps a reversed range instead of rejecting it', () => {
    expect(normalizeRange({ from: '2026-11-04', to: '2026-11-01' })).toEqual({
      from: '2026-11-01',
      to: '2026-11-04',
    })
    expect(normalizeRange({ from: '2026-11-01', to: '2026-11-04' })).toEqual({
      from: '2026-11-01',
      to: '2026-11-04',
    })
  })

})

describe('sales aggregation', () => {
  it('groups by business date and splits payment methods', () => {
    const summary = summarizeSales([
      row({ id: 'a', paymentMethod: 'cash', grandTotal: 50000 }),
      row({ id: 'b', paymentMethod: 'qris', grandTotal: 30000, subtotal: 30000, discountAmount: 0 }),
      row({ id: 'c', paymentMethod: 'split', grandTotal: 20000, subtotal: 20000, discountAmount: 0 }),
    ])

    expect(summary).toHaveLength(1)
    expect(summary[0]).toMatchObject({
      businessDate: '2026-11-04',
      transactionCount: 3,
      grossSales: 150000,
      discountTotal: 5000,
      netSales: 100000,
      cashTotal: 50000,
      qrisTotal: 30000,
      otherTotal: 20000,
    })
    expect(summary[0]?.averageSale).toBeCloseTo(33333.333, 3)
  })

  it('sorts days newest first', () => {
    const summary = summarizeSales([
      row({ id: 'a', businessDate: '2026-11-01' }),
      row({ id: 'b', businessDate: '2026-11-04' }),
    ])
    expect(summary.map((day) => day.businessDate)).toEqual(['2026-11-04', '2026-11-01'])
  })

  it('never divides by zero for an empty period', () => {
    expect(salesTotals([]).averageSale).toBe(0)
    expect(summarizeSales([])).toEqual([])
  })

  it('counts voided notes only when they are part of the rows', () => {
    const totals = salesTotals([row({ status: 'voided' })])
    expect(totals.transactionCount).toBe(1)
    expect(totals.netSales).toBe(95000)
  })

  it('rounds money and quantity to the database precision', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3)
    expect(roundMoney(1234.567)).toBe(1234.57)
    expect(roundQuantity(1.23456)).toBe(1.235)
  })
})

describe('csv export', () => {
  it('quotes commas, quotes and newlines', () => {
    const csv = toCsv(['A', 'B'], [['x,y', 'kata "kutip"'], ['baris\nbaru', null]])
    expect(csv.split('\r\n')[0]).toBe('A,B')
    expect(csv).toContain('"x,y"')
    expect(csv).toContain('"kata ""kutip"""')
    expect(csv).toContain('"baris\nbaru"')
  })

  it('leaves unknown numbers as an empty cell, not zero', () => {
    const csv = toCsv(['Nilai'], [[null], [undefined], [0]])
    expect(csv.split('\r\n')).toEqual(['Nilai', '', '', '0'])
  })

  it('builds a stable file name from the range', () => {
    expect(csvFileName('ringkasan-penjualan', { from: '2026-11-01', to: '2026-11-04' }))
      .toBe('ringkasan-penjualan-2026-11-01_2026-11-04.csv')
  })
})

describe('report errors', () => {
  it('translates permission and session failures', () => {
    expect(describeReportError(new Error('permission denied for table transactions')))
      .toBe('Anda tidak memiliki izin untuk membaca laporan ini.')
    expect(describeReportError(new Error('JWT expired')))
      .toBe('Sesi Anda berakhir. Masuk kembali.')
  })

  it('strips an error code prefix and falls back', () => {
    expect(describeReportError(new Error('REPORT_FAILED: Coba lagi'))).toBe('Coba lagi')
    expect(describeReportError(null)).toBe('Gagal memuat laporan.')
  })
})
