/**
 * Stock opname domain types.
 *
 * The shapes below mirror what the Phase 5A RPCs return (see
 * `docs/11-inventory-engine.md`). They are hand-written rather than derived from
 * `Database` because the RPCs return `jsonb`, which the generated types expose
 * as an opaque `Json`.
 */

export const OPNAME_STATUSES = [
  'draft',
  'counting',
  'submitted',
  'approved',
  'posted',
  'cancelled',
] as const

export type OpnameStatus = (typeof OPNAME_STATUSES)[number]

export const COUNT_STATUSES = ['pending', 'counted', 'needs_recount', 'posted'] as const

export type CountStatus = (typeof COUNT_STATUSES)[number]

/** Reason codes accepted by `record_stock_opname_count`. */
export const OPNAME_REASONS = [
  'broken_damaged',
  'missing',
  'input_error',
  'unrecorded_out',
  'unrecorded_in',
  'unit_conversion',
  'opening_balance',
  'other',
] as const

export type OpnameReason = (typeof OPNAME_REASONS)[number]

export const OPNAME_STATUS_LABELS: Record<string, string> = {
  draft: 'Draf',
  counting: 'Menghitung',
  submitted: 'Menunggu persetujuan',
  approved: 'Disetujui',
  posted: 'Terposting',
  cancelled: 'Dibatalkan',
}

export const COUNT_STATUS_LABELS: Record<string, string> = {
  pending: 'Belum dihitung',
  counted: 'Sudah dihitung',
  needs_recount: 'Perlu hitung ulang',
  posted: 'Terposting',
}

export const OPNAME_REASON_LABELS: Record<string, string> = {
  broken_damaged: 'Rusak',
  missing: 'Hilang',
  input_error: 'Salah input',
  unrecorded_out: 'Keluar tanpa catatan',
  unrecorded_in: 'Masuk tanpa catatan',
  unit_conversion: 'Konversi satuan',
  opening_balance: 'Saldo awal',
  other: 'Lainnya',
}

export function opnameStatusLabel(status: string): string {
  return OPNAME_STATUS_LABELS[status] ?? status
}

export function countStatusLabel(status: string): string {
  return COUNT_STATUS_LABELS[status] ?? status
}

export function opnameReasonLabel(reason: string | null): string {
  if (!reason) return '—'
  return OPNAME_REASON_LABELS[reason] ?? reason
}

/** Statuses whose stock has already moved; the UI must never offer edits. */
export function isOpnameFinal(status: string): boolean {
  return status === 'posted' || status === 'cancelled'
}

export function isOpnameEditable(status: string): boolean {
  return status === 'counting'
}

/**
 * A session can only be cancelled while it is unfinished. Posting is final and
 * the database rejects `posted` cancellations with `OPNAME_POSTED`.
 */
export function isOpnameCancellable(status: string): boolean {
  return !isOpnameFinal(status)
}

// ---------------------------------------------------------------------------
// RPC payloads and responses
// ---------------------------------------------------------------------------

export interface CreateOpnameInput {
  idempotencyKey: string
  scopeNote: string
  productIds: string[]
  categoryId: number | null
  excludeProductIds: string[]
}

export interface OpnameSummary {
  opnameId: string
  opnameNo: string
  status: string
  scopeNote: string | null
  submittedAt: string | null
  approvedAt: string | null
  postedAt: string | null
  cancelledAt: string | null
  itemCount: number
  alreadyProcessed: boolean
}

export interface OpnameConflict {
  item_id: string
  product_id: string
  sku: string
  snapshot_version: number
  current_version: number
  snapshot_qty: number | null
  current_qty: number | null
}

export interface PostOpnameResult extends OpnameSummary {
  result: 'posted' | 'version_conflict'
  conflicts: OpnameConflict[]
  unchangedCount: number
  openingBalanceCount: number
  discrepancyCount: number
  deltaTotal: number
}

export interface CountItemResult {
  itemId: string
  opnameId: string
  productId: string
  systemQtySnapshot: number | null
  physicalQty: number | null
  differenceQty: number | null
  reasonCode: string | null
  countStatus: string
  countedBy: string | null
  countedAt: string | null
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export interface OpnameListRow {
  id: string
  opnameNo: string
  status: string
  scopeNote: string | null
  createdAt: string
  submittedAt: string | null
  approvedAt: string | null
  postedAt: string | null
  cancelledAt: string | null
  itemCount: number
  countedCount: number
  /** Items flagged `needs_recount` after a version conflict. */
  recountCount: number
}

export interface OpnameListParams {
  page: number
  pageSize: number
  status: OpnameStatus | ''
  search: string
}

export interface OpnameListResult {
  rows: OpnameListRow[]
  total: number
}

export interface OpnameItemRow {
  id: string
  productId: string
  sku: string
  productName: string
  unitLabel: string
  decimalScale: number
  isActive: boolean
  systemQtySnapshot: number | null
  physicalQty: number | null
  differenceQty: number | null
  reasonCode: string | null
  reasonNote: string | null
  countStatus: string
  countedAt: string | null
}

export interface OpnameDetail {
  id: string
  opnameNo: string
  status: string
  scopeNote: string | null
  createdAt: string
  submittedAt: string | null
  approvedAt: string | null
  postedAt: string | null
  cancelledAt: string | null
  cancelledReason: string | null
  items: OpnameItemRow[]
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const SCOPE_NOTE_MAX = 500
export const CANCEL_REASON_MAX = 500

export function validateScopeNote(note: string): string | null {
  if (note.trim().length > SCOPE_NOTE_MAX) {
    return `Catatan cakupan maksimal ${SCOPE_NOTE_MAX} karakter.`
  }
  return null
}

export function validateCancelReason(reason: string): string | null {
  const trimmed = reason.trim()
  if (trimmed.length === 0) return 'Alasan pembatalan wajib diisi.'
  if (trimmed.length > CANCEL_REASON_MAX) {
    return `Alasan pembatalan maksimal ${CANCEL_REASON_MAX} karakter.`
  }
  return null
}

/**
 * Whether a physical count needs a reason code.
 *
 * `null` system stock means the balance was never known, so the only valid
 * reason is `opening_balance` and a note is mandatory. A known balance only
 * needs a reason when the physical count differs from it.
 */
export function reasonRequirement(
  systemQty: number | null,
  physicalQty: number | null,
): 'opening_balance' | 'difference' | 'none' {
  if (systemQty === null) return 'opening_balance'
  if (physicalQty === null) return 'none'
  return physicalQty === systemQty ? 'none' : 'difference'
}

/** Reasons a known-stock discrepancy may use. `opening_balance` is excluded. */
export function allowedReasons(systemQty: number | null): OpnameReason[] {
  if (systemQty === null) return ['opening_balance']
  return OPNAME_REASONS.filter((reason) => reason !== 'opening_balance')
}

export interface CountValidationInput {
  systemQty: number | null
  physicalQty: string
  reasonCode: string
  reasonNote: string
  decimalScale: number
}

/** Mirrors the RPC guards so the form fails fast instead of round-tripping. */
export function validateCount(input: CountValidationInput): string | null {
  const raw = input.physicalQty.trim()
  if (raw === '') return 'Jumlah fisik wajib diisi.'

  const physical = Number(raw.replace(',', '.'))
  if (!Number.isFinite(physical)) return 'Jumlah fisik harus berupa angka.'
  if (physical < 0) return 'Jumlah fisik tidak boleh negatif.'

  const scale = Number.isInteger(input.decimalScale) ? input.decimalScale : 0
  const factor = 10 ** scale
  if (Math.round(physical * factor) / factor !== physical) {
    return scale === 0
      ? 'Satuan produk ini tidak mendukung angka desimal.'
      : `Satuan produk ini hanya mendukung ${scale} angka desimal.`
  }

  const requirement = reasonRequirement(input.systemQty, physical)
  const reason = input.reasonCode.trim()
  const note = input.reasonNote.trim()

  if (requirement === 'opening_balance') {
    if (reason !== 'opening_balance') return 'Stok sistem belum diketahui; pilih alasan Saldo awal.'
    if (note === '') return 'Catatan wajib diisi untuk saldo awal.'
    return null
  }

  if (requirement === 'difference') {
    if (reason === '') return 'Selisih stok wajib memiliki alasan.'
    if (reason === 'opening_balance') {
      return 'Saldo awal hanya untuk produk yang stok sistemnya belum diketahui.'
    }
    if (reason === 'other' && note === '') return 'Alasan Lainnya wajib disertai catatan.'
  }

  return null
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

const ERROR_MESSAGES: Array<[string, string]> = [
  ['OPNAME_NOT_FOUND', 'Sesi opname tidak ditemukan.'],
  ['OPNAME_ITEM_NOT_FOUND', 'Item opname tidak ditemukan.'],
  ['OPNAME_EMPTY', 'Tidak ada produk yang cocok dengan cakupan opname.'],
  ['OPNAME_INCOMPLETE', 'Masih ada item yang belum lengkap.'],
  ['OPNAME_POSTED', 'Sesi yang sudah terposting tidak dapat dibatalkan.'],
  ['OPNAME_ITEM_POSTED', 'Item ini sudah terposting.'],
  ['OPNAME_NOT_COUNTING', 'Sesi ini tidak sedang dalam tahap penghitungan.'],
  ['OPNAME_NOT_SUBMITTED', 'Sesi ini belum disubmit, jadi belum bisa disetujui.'],
  ['OPENING_BALANCE_REASON_REQUIRED', 'Stok sistem belum diketahui; gunakan alasan Saldo awal.'],
  ['OPENING_BALANCE_NOTE_REQUIRED', 'Catatan wajib diisi untuk saldo awal.'],
  ['REASON_REQUIRED', 'Selisih stok wajib memiliki alasan.'],
  ['REASON_INVALID', 'Alasan saldo awal hanya untuk produk tanpa stok sistem.'],
  ['REASON_NOTE_REQUIRED', 'Alasan Lainnya wajib disertai catatan.'],
  ['PHYSICAL_QTY_REQUIRED', 'Jumlah fisik wajib diisi.'],
  ['PHYSICAL_QTY_NEGATIVE', 'Jumlah fisik tidak boleh negatif.'],
  ['INVALID_PRECISION', 'Jumlah fisik melebihi presisi satuan produk.'],
  ['SCOPE_NOTE_TOO_LONG', 'Catatan cakupan maksimal 500 karakter.'],
  ['CATEGORY_NOT_FOUND', 'Kategori tidak ditemukan.'],
  ['CANCEL_REASON_REQUIRED', 'Alasan pembatalan wajib diisi.'],
  ['INVALID_IDEMPOTENCY_KEY', 'Kunci idempotensi tidak valid.'],
]

/**
 * Turn a Postgres/RPC error into a sentence an operator can act on. The
 * database message is the source of truth; this only translates known codes.
 */
export function describeOpnameError(cause: unknown): string {
  const raw = cause instanceof Error
    ? cause.message
    : typeof cause === 'string'
      ? cause
      : ''

  for (const [code, message] of ERROR_MESSAGES) {
    if (raw.includes(code)) return message
  }

  if (raw.includes('permission denied') || raw.includes('row-level security')) {
    return 'Anda tidak memiliki izin untuk operasi ini.'
  }
  if (raw.includes('JWT') || raw.includes('not authenticated')) {
    return 'Sesi Anda berakhir. Masuk kembali.'
  }

  const stripped = raw.replace(/^[A-Z_]+:\s*/, '').trim()
  return stripped || 'Operasi opname gagal.'
}

/**
 * Blockers arrive as a JSON array inside the error `detail` field. Surfacing a
 * count is enough for the UI; the list lives on the session page.
 */
export function blockerCount(detail: unknown): number {
  if (typeof detail !== 'string') return 0
  try {
    const parsed = JSON.parse(detail)
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}
