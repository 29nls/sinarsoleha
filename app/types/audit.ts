/**
 * Audit log read model (Phase 9).
 *
 * `audit_logs` is append-only and readable by active owners only
 * (`audit_logs_select_owner`). There is no RPC: the policy already limits rows,
 * and adding a function would only widen the reviewed surface.
 */
import { toCsv, type CsvValue } from '~/types/reports'

/** Keys are taken from the actual `private.write_audit` call sites. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'profile.admin_update': 'Ubah profil',
  'profile.bootstrap_owner': 'Bootstrap owner',
  'feature_flag.update': 'Ubah fitur',
  'category.create': 'Buat kategori',
  'category.update': 'Ubah kategori',
  'product.create': 'Buat produk',
  'product.update': 'Ubah produk',
  'product.cost_update': 'Ubah harga beli',
  'product.import': 'Impor produk',
  'product_import.begin': 'Mulai impor produk',
  'product_import.finish': 'Selesaikan impor produk',
  'product_import.resume': 'Lanjutkan impor produk',
  'opname.create': 'Buat opname',
  'opname.submit': 'Ajukan opname',
  'opname.approve': 'Setujui opname',
  'opname.post': 'Posting opname',
  'opname.post_conflict': 'Konflik posting opname',
  'opname.cancel': 'Batalkan opname',
  'sale.complete': 'Selesaikan penjualan',
  'sale.void': 'Batalkan penjualan',
}

export function auditActionLabel(actionKey: string): string {
  return AUDIT_ACTION_LABELS[actionKey] ?? actionKey
}

export interface AuditRow {
  id: number
  actorId: string | null
  actorLabel: string
  actionKey: string
  entityName: string
  entityId: string | null
  reason: string | null
  createdAt: string
  beforeData: unknown
  afterData: unknown
}

export interface AuditFilters {
  actionKey: string
  entityName: string
  dateFrom: string
  dateTo: string
}

export interface AuditParams extends AuditFilters {
  page: number
  pageSize: number
}

export interface AuditListResult {
  rows: AuditRow[]
  total: number
}

export function emptyAuditFilters(): AuditFilters {
  return { actionKey: '', entityName: '', dateFrom: '', dateTo: '' }
}

/** Compact one-line diff for the table; full JSON stays in the detail toggle. */
export function summarizeAuditData(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value !== 'object') return String(value)
  try {
    const json = JSON.stringify(value)
    return json.length > 160 ? `${json.slice(0, 157)}…` : json
  } catch {
    return '—'
  }
}

export function auditCsv(rows: readonly AuditRow[]): string {
  const headers = ['Waktu', 'Pelaku', 'Aksi', 'Entitas', 'ID entitas', 'Alasan', 'Data sesudah']
  const body: CsvValue[][] = rows.map((row) => [
    row.createdAt,
    row.actorLabel,
    row.actionKey,
    row.entityName,
    row.entityId,
    row.reason,
    row.afterData === null || row.afterData === undefined ? null : JSON.stringify(row.afterData),
  ])
  return toCsv(headers, body)
}

export function describeAuditError(cause: unknown): string {
  const raw = cause instanceof Error
    ? cause.message
    : typeof cause === 'string'
      ? cause
      : ''
  const message = raw.toLowerCase()
  if (message.includes('permission denied') || message.includes('row-level security')) {
    return 'Hanya owner yang dapat membaca audit log.'
  }
  if (message.includes('jwt') || message.includes('not authenticated')) {
    return 'Sesi Anda berakhir. Masuk kembali.'
  }
  return raw || 'Gagal memuat audit log.'
}
