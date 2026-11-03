/**
 * Admin user management (Phase 9).
 *
 * The database only exposes `profiles`: there is no readable email column and
 * `auth.users` is not reachable from the browser. The UI therefore identifies
 * an account by name plus a short id, and never pretends an email exists.
 *
 * Writes go through `public.admin_upsert_profile`, which re-checks the owner
 * role, refuses to demote the last active owner, and writes an audit row.
 * Everything here is presentation logic only.
 */
import { ROLES, ROLE_LABELS, type Role } from '~/types/database'

export const USER_ROLES = ROLES

export const USER_ROLE_LABELS = ROLE_LABELS

/** Mirrors the `profiles_full_name_not_blank` check and RPC length limit. */
export const FULL_NAME_MAX_LENGTH = 120

export interface UserRow {
  id: string
  fullName: string
  role: Role
  isActive: boolean
  activatedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface UserDraft {
  fullName: string
  role: Role
  isActive: boolean
}

export function roleLabel(role: string): string {
  return ROLE_LABELS[role as Role] ?? role
}

/** Short, stable handle for an account whose email is not readable. */
export function shortUserId(id: string): string {
  return id.slice(0, 8)
}

/**
 * A name is required, trimmed, and capped at 120 characters. Returning the
 * message instead of a boolean keeps the form error text in one place.
 */
export function validateFullName(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed === '') return 'Nama wajib diisi.'
  if (trimmed.length > FULL_NAME_MAX_LENGTH) {
    return `Nama maksimal ${FULL_NAME_MAX_LENGTH} karakter.`
  }
  return null
}

export function toDraft(row: UserRow): UserDraft {
  return { fullName: row.fullName, role: row.role, isActive: row.isActive }
}

/**
 * True when the draft would deactivate or demote the only active owner.
 * The RPC still enforces this; the flag only lets the form explain it first.
 */
export function isLastActiveOwner(row: UserRow, rows: readonly UserRow[]): boolean {
  if (row.role !== 'owner' || !row.isActive) return false
  return !rows.some((other) => other.id !== row.id && other.role === 'owner' && other.isActive)
}

export function describeUsersError(cause: unknown): string {
  const raw = cause instanceof Error
    ? cause.message
    : typeof cause === 'string'
      ? cause
      : ''
  const message = raw.toLowerCase()

  if (message.includes('last_owner')) {
    return 'Tidak boleh menonaktifkan atau menurunkan owner aktif terakhir.'
  }
  if (message.includes('invalid_role')) return 'Peran tidak dikenal.'
  if (message.includes('invalid_full_name')) {
    return `Nama wajib diisi, maksimal ${FULL_NAME_MAX_LENGTH} karakter.`
  }
  if (message.includes('profile_not_found')) {
    return 'Profil tidak ditemukan. Muat ulang daftar pengguna.'
  }
  if (message.includes('user_required')) return 'Pengguna tidak dipilih.'
  if (message.includes('owner_required') || message.includes('forbidden')) {
    return 'Hanya owner yang dapat mengelola pengguna.'
  }
  if (message.includes('permission denied') || message.includes('row-level security')) {
    return 'Anda tidak memiliki izin untuk mengelola pengguna.'
  }
  if (message.includes('jwt') || message.includes('not authenticated')) {
    return 'Sesi Anda berakhir. Masuk kembali.'
  }

  const stripped = raw.replace(/^[A-Z_]+:\s*/, '').trim()
  return stripped || 'Gagal memuat data pengguna.'
}
