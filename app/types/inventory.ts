/**
 * Inventory read models (Phase 5C).
 *
 * Everything here is read-only: the ledger tables are immutable and only the
 * opname RPCs may write stock. These types therefore describe list rows for
 * balances, movements, and discrepancy logs.
 */

export const MOVEMENT_TYPES = [
  'opening_balance',
  'sale_out',
  'opname_adjustment',
  'manual_adjustment',
  'return_in',
  'purchase_in',
  'void_reversal',
] as const

export type MovementType = (typeof MOVEMENT_TYPES)[number]

export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  opening_balance: 'Saldo awal',
  sale_out: 'Penjualan',
  opname_adjustment: 'Penyesuaian opname',
  manual_adjustment: 'Koreksi manual',
  return_in: 'Retur masuk',
  purchase_in: 'Pembelian masuk',
  void_reversal: 'Pembatalan penjualan',
}

/** Positive movements add stock; the UI colours them differently. */
export const MOVEMENT_IN_TYPES: ReadonlySet<string> = new Set([
  'opening_balance',
  'return_in',
  'purchase_in',
  'void_reversal',
])

export function movementTypeLabel(type: string): string {
  return MOVEMENT_TYPE_LABELS[type] ?? type
}

/** A movement is inbound when its delta is positive, not only by type. */
export function isInboundMovement(row: { quantityDelta: number }): boolean {
  return row.quantityDelta > 0
}

/**
 * Filters that PostgREST can express against a single column, plus `low`.
 *
 * "Stok rendah" compares `stock_on_hand` with `low_stock_threshold`, which the
 * REST API cannot do column-to-column. The service scans the bounded catalog
 * once and filters in the browser, so totals stay correct; see
 * `listStockBalances`.
 */
export const STOCK_STATES = ['all', 'unknown', 'negative', 'empty', 'low'] as const

export type StockStateFilter = (typeof STOCK_STATES)[number]

export const STOCK_STATE_FILTER_LABELS: Record<StockStateFilter, string> = {
  all: 'Semua saldo',
  unknown: 'Stok belum diketahui',
  negative: 'Stok negatif',
  empty: 'Stok habis',
  low: 'Stok rendah (≤ batas)',
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface StockBalanceRow {
  id: string
  sku: string
  name: string
  categoryName: string | null
  unitLabel: string
  decimalScale: number
  stockOnHand: number | null
  stockVersion: number
  lowStockThreshold: number | null
  isActive: boolean
  reviewStatus: string
}

export interface MovementRow {
  id: number
  productId: string
  sku: string
  productName: string
  unitLabel: string
  decimalScale: number
  movementType: string
  quantityDelta: number
  quantityBefore: number | null
  quantityAfter: number
  transactionId: string | null
  stockOpnameId: string | null
  reasonCode: string | null
  reasonNote: string | null
  actorId: string
  actorLabel: string
  createdAt: string
}

export interface DiscrepancyRow {
  id: number
  stockOpnameItemId: string
  revision: number
  productId: string
  sku: string
  productName: string
  unitLabel: string
  decimalScale: number
  systemQty: number
  physicalQty: number
  differenceQty: number
  reasonCode: string
  reasonNote: string | null
  createdBy: string
  createdByLabel: string
  approvedBy: string | null
  approvedByLabel: string | null
  createdAt: string
}

// ---------------------------------------------------------------------------
// Filters and params
// ---------------------------------------------------------------------------

export interface StockBalanceFilters {
  state: StockStateFilter
}

export interface StockBalanceParams extends StockBalanceFilters {
  search: string
  page: number
  pageSize: number
}

export interface MovementFilters {
  movementType: MovementType | ''
  dateFrom: string
  dateTo: string
}

export interface MovementParams extends MovementFilters {
  productSearch: string
  page: number
  pageSize: number
}

export interface DiscrepancyFilters {
  reasonCode: string
  dateFrom: string
  dateTo: string
}

export interface DiscrepancyParams extends DiscrepancyFilters {
  productSearch: string
  page: number
  pageSize: number
}

export interface InventoryListResult<TRow> {
  rows: TRow[]
  total: number
}

export function emptyStockBalanceFilters(): StockBalanceFilters {
  return { state: 'all' }
}

export function emptyMovementFilters(): MovementFilters {
  return { movementType: '', dateFrom: '', dateTo: '' }
}

export function emptyDiscrepancyFilters(): DiscrepancyFilters {
  return { reasonCode: '', dateFrom: '', dateTo: '' }
}

/**
 * Actor names are only readable by the owner (`profiles_select_self_or_owner`),
 * so staff sees their own name and a short id for anyone else instead of
 * pretending the movement has no actor.
 */
export function actorLabel(actorId: string | null, currentUserId: string): string {
  if (!actorId) return '—'
  if (actorId === currentUserId) return 'Anda'
  return `Staf ${actorId.slice(0, 8)}`
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

const ERROR_MESSAGES: Array<[string, string]> = [
  ['STOCK_LEDGER_IMMUTABLE', 'Ledger stok tidak dapat diubah; buat movement koreksi baru.'],
  ['PRODUCT_NOT_FOUND', 'Produk tidak ditemukan.'],
  ['OPNAME_NOT_FOUND', 'Sesi opname tidak ditemukan.'],
  ['STOCK_UNKNOWN', 'Saldo produk belum diketahui; catat lewat opname saldo awal.'],
  ['STOCK_NEGATIVE', 'Koreksi ini membuat saldo menjadi negatif.'],
  ['DELTA_ZERO', 'Jumlah koreksi tidak boleh nol.'],
  ['DELTA_REQUIRED', 'Jumlah koreksi wajib diisi.'],
  ['REASON_REQUIRED', 'Alasan koreksi wajib dipilih.'],
  ['REASON_INVALID', 'Saldo awal hanya dapat dicatat lewat opname.'],
  ['INVALID_REASON', 'Alasan koreksi tidak dikenal.'],
  ['REASON_NOTE_REQUIRED', 'Catatan alasan wajib diisi.'],
  ['REASON_NOTE_TOO_LONG', 'Catatan alasan maksimal 500 karakter.'],
  ['INVALID_PRECISION', 'Jumlah melebihi presisi satuan produk.'],
  ['IDEMPOTENCY_KEY_REUSED', 'Koreksi ini sudah pernah dikirim dengan isi berbeda.'],
]

export function describeInventoryError(cause: unknown): string {
  const raw = cause instanceof Error
    ? cause.message
    : typeof cause === 'string'
      ? cause
      : ''

  for (const [code, message] of ERROR_MESSAGES) {
    if (raw.includes(code)) return message
  }

  if (raw.includes('permission denied') || raw.includes('row-level security')) {
    return 'Anda tidak memiliki izin untuk melihat data inventaris.'
  }
  if (raw.includes('JWT') || raw.includes('not authenticated')) {
    return 'Sesi Anda berakhir. Masuk kembali.'
  }

  const stripped = raw.replace(/^[A-Z_]+:\s*/, '').trim()
  return stripped || 'Gagal memuat data inventaris.'
}

/** `YYYY-MM-DD` in Jakarta time becomes the first instant of that day. */
export function startOfJakartaDay(date: string): string {
  return `${date}T00:00:00+07:00`
}

/** Inclusive end of day, so a same-day range still matches. */
export function endOfJakartaDay(date: string): string {
  return `${date}T23:59:59.999+07:00`
}

// ---------------------------------------------------------------------------
// Manual adjustment (Phase 11)
// ---------------------------------------------------------------------------

/** `opening_balance` is deliberately absent: NULL stock goes through opname. */
export const ADJUSTMENT_REASONS = [
  'broken_damaged',
  'missing',
  'input_error',
  'unrecorded_out',
  'unrecorded_in',
  'unit_conversion',
  'other',
] as const

export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number]

export interface AdjustmentInput {
  stockOnHand: number | null
  delta: string
  reasonCode: string
  reasonNote: string
  decimalScale: number
}

export interface AdjustmentResult {
  productId: string
  sku: string
  stockBefore: number
  stockAfter: number
  delta: number
  stockVersion: number
  movementId: number
  alreadyProcessed: boolean
}

/**
 * Mirrors `private.adjust_stock` so the dialog can fail fast. The delta is
 * signed: a negative value removes stock, a positive one adds it.
 */
export function validateAdjustment(input: AdjustmentInput): string | null {
  if (input.stockOnHand === null) {
    return 'Saldo produk belum diketahui; catat lewat Stok Opname sebagai saldo awal.'
  }

  const raw = input.delta.trim().replace(',', '.')
  if (raw === '') return 'Jumlah koreksi wajib diisi.'

  const delta = Number(raw)
  if (!Number.isFinite(delta)) return 'Jumlah koreksi harus berupa angka.'
  if (delta === 0) return 'Jumlah koreksi tidak boleh nol.'

  const scale = Number.isInteger(input.decimalScale) ? input.decimalScale : 0
  const factor = 10 ** scale
  if (Math.round(delta * factor) / factor !== delta) {
    return scale === 0
      ? 'Satuan produk ini tidak mendukung angka desimal.'
      : `Satuan produk ini hanya mendukung ${scale} angka desimal.`
  }

  if (input.stockOnHand + delta < 0) {
    return `Koreksi ini membuat saldo menjadi ${input.stockOnHand + delta}; saldo tidak boleh negatif.`
  }

  if (!(ADJUSTMENT_REASONS as readonly string[]).includes(input.reasonCode)) {
    return 'Pilih alasan koreksi.'
  }

  const note = input.reasonNote.trim()
  if (note === '') return 'Catatan alasan wajib diisi.'
  if (note.length > 500) return 'Catatan alasan maksimal 500 karakter.'

  return null
}
