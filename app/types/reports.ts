/**
 * Report read models (Phase 6 / RPT-01…RPT-06).
 *
 * Semua laporan dihitung dari baris yang sudah ada di database; tidak ada
 * tabel agregat baru. Karena PostgREST tidak bisa menjumlahkan lintas baris,
 * layanan mengambil baris terpaginasi lalu meringkasnya di klien.
 *
 * Margin/laba kotor sengaja tidak dihitung: PRD §5.5 melarang menyajikan
 * margin historis sebagai angka akurat selama purchase_cost belum lengkap
 * dan belum ada histori biaya per tanggal.
 */

export type ReportRangePreset = 'today' | '7d' | '30d' | 'month' | 'custom'

export interface ReportRange {
  from: string
  to: string
}

/** Batas baris yang diambil sekali muat; laporan tidak boleh menggantung. */
export const REPORT_ROW_LIMIT = 5000

export interface SalesReportFilters {
  from: string
  to: string
}

export interface SalesReportRow {
  id: string
  receiptNo: string
  businessDate: string
  cashierId: string
  subtotal: number
  discountAmount: number
  grandTotal: number
  paymentMethod: string
  status: string
  createdAt: string
}

export interface DailySummaryRow {
  businessDate: string
  transactionCount: number
  grossSales: number
  discountTotal: number
  netSales: number
  cashTotal: number
  qrisTotal: number
  otherTotal: number
  averageSale: number
}

export interface SalesReportResult {
  rows: SalesReportRow[]
  total: number
  truncated: boolean
  summary: DailySummaryRow[]
  totals: {
    transactionCount: number
    grossSales: number
    discountTotal: number
    netSales: number
    cashTotal: number
    qrisTotal: number
    otherTotal: number
    averageSale: number
  }
}

export interface ProductSalesRow {
  key: string
  sku: string
  productName: string
  unitLabel: string
  quantitySold: number
  grossSales: number
  lineDiscount: number
  netSales: number
  transactionCount: number
}

export interface ProductSalesReportResult {
  rows: ProductSalesRow[]
  transactionCount: number
  truncated: boolean
}

export type ExceptionCategory =
  | 'stock_unknown'
  | 'negative_stock'
  | 'sale_price_missing'
  | 'purchase_cost_missing'
  | 'review_pending'
  | 'legacy_mismatch'

export const EXCEPTION_CATEGORY_LABELS: Record<ExceptionCategory, string> = {
  stock_unknown: 'Stok belum diketahui',
  negative_stock: 'Stok negatif',
  sale_price_missing: 'Harga jual kosong',
  purchase_cost_missing: 'Harga beli kosong',
  review_pending: 'Mapping belum tervalidasi',
  legacy_mismatch: 'Transaksi legacy tidak cocok',
}

export interface ExceptionRow {
  id: string
  category: ExceptionCategory
  sku: string
  label: string
  detail: string | null
  reference: string | null
  referencePath: string | null
  createdAt: string | null
}

export interface ExceptionReportResult {
  rows: ExceptionRow[]
  counts: Record<ExceptionCategory, number>
  truncated: boolean
}

// ---------------------------------------------------------------------------
// Rentang tanggal (zona Asia/Jakarta)
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` untuk "hari ini" menurut jam Jakarta, bukan jam server. */
export function jakartaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function addDays(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00+07:00`)
  base.setUTCDate(base.getUTCDate() + days)
  return jakartaToday(base)
}

export function firstOfMonth(date: string): string {
  return `${date.slice(0, 8)}01`
}

/** Preset rentang; `month` berarti awal bulan berjalan sampai hari ini. */
export function rangeForPreset(preset: ReportRangePreset, today = jakartaToday()): ReportRange {
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case '7d':
      return { from: addDays(today, -6), to: today }
    case '30d':
      return { from: addDays(today, -29), to: today }
    case 'month':
      return { from: firstOfMonth(today), to: today }
    default:
      return { from: today, to: today }
  }
}

/** Rentang terbalik dibalik, bukan ditolak: filter tanggal bukan validasi form. */
export function normalizeRange(range: ReportRange): ReportRange {
  if (!range.from || !range.to) return range
  return range.from <= range.to ? range : { from: range.to, to: range.from }
}

// ---------------------------------------------------------------------------
// Agregasi
// ---------------------------------------------------------------------------

export function summarizeSales(rows: SalesReportRow[]): DailySummaryRow[] {
  const byDate = new Map<string, DailySummaryRow>()

  for (const row of rows) {
    const current = byDate.get(row.businessDate) ?? {
      businessDate: row.businessDate,
      transactionCount: 0,
      grossSales: 0,
      discountTotal: 0,
      netSales: 0,
      cashTotal: 0,
      qrisTotal: 0,
      otherTotal: 0,
      averageSale: 0,
    }

    current.transactionCount += 1
    current.grossSales += row.subtotal
    current.discountTotal += row.discountAmount
    current.netSales += row.grandTotal
    if (row.paymentMethod === 'cash') current.cashTotal += row.grandTotal
    else if (row.paymentMethod === 'qris') current.qrisTotal += row.grandTotal
    else current.otherTotal += row.grandTotal

    byDate.set(row.businessDate, current)
  }

  const summary = [...byDate.values()].sort((a, b) => b.businessDate.localeCompare(a.businessDate))
  for (const row of summary) {
    row.averageSale = row.transactionCount === 0 ? 0 : row.netSales / row.transactionCount
  }
  return summary
}

export function salesTotals(rows: SalesReportRow[]): SalesReportResult['totals'] {
  const totals = {
    transactionCount: rows.length,
    grossSales: 0,
    discountTotal: 0,
    netSales: 0,
    cashTotal: 0,
    qrisTotal: 0,
    otherTotal: 0,
    averageSale: 0,
  }

  for (const row of rows) {
    totals.grossSales += row.subtotal
    totals.discountTotal += row.discountAmount
    totals.netSales += row.grandTotal
    if (row.paymentMethod === 'cash') totals.cashTotal += row.grandTotal
    else if (row.paymentMethod === 'qris') totals.qrisTotal += row.grandTotal
    else totals.otherTotal += row.grandTotal
  }

  totals.averageSale = totals.transactionCount === 0 ? 0 : totals.netSales / totals.transactionCount
  return totals
}

/** Pembulatan 2 desimal untuk uang, menghindari 0.30000000000000004 di UI. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Pembulatan 3 desimal untuk kuantitas (numeric(14,3)). */
export function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

export function describeReportError(cause: unknown): string {
  const raw = cause instanceof Error
    ? cause.message
    : typeof cause === 'string'
      ? cause
      : ''

  if (raw.includes('permission denied') || raw.includes('row-level security')) {
    return 'Anda tidak memiliki izin untuk membaca laporan ini.'
  }
  if (raw.includes('JWT') || raw.includes('not authenticated')) {
    return 'Sesi Anda berakhir. Masuk kembali.'
  }

  const stripped = raw.replace(/^[A-Z_]+:\s*/, '').trim()
  return stripped || 'Gagal memuat laporan.'
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export type CsvValue = string | number | null | undefined

/**
 * CSV dibuat di browser (PRD: tanpa Supabase Storage). Nilai yang mengandung
 * pemisah, kutip, atau baris baru di-quote; `null` menjadi sel kosong supaya
 * angka yang tidak diketahui tidak terbaca sebagai nol di spreadsheet.
 */
export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const escape = (value: CsvValue): string => {
    if (value === null || value === undefined) return ''
    const text = String(value)
    return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }

  return [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n')
}

/** Nama berkas stabil: `laporan-penjualan-2026-11-01_2026-11-04.csv`. */
export function csvFileName(prefix: string, range: ReportRange): string {
  return `${prefix}-${range.from || 'awal'}_${range.to || 'akhir'}.csv`
}
