import type { Database as GeneratedDatabase } from '../../types/database.generated'

/**
 * Generated from the migrated schema with
 * `npx supabase gen types typescript --linked` after the 23 migrations.
 * `npm run gen:types` reproduces the same schema offline via PGlite.
 * Never edit types/database.generated.ts by hand.
 */
export type Database = GeneratedDatabase

export const ROLES = ['owner', 'cashier', 'inventory_staff'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner / Admin',
  cashier: 'Kasir',
  inventory_staff: 'Staf Gudang',
}

type GeneratedProfileRow = Database['public']['Tables']['profiles']['Row']

/**
 * The database constrains role to the three values above, but generated types
 * expose it as string. Narrow it once at the store boundary instead of
 * trusting an unchecked cast.
 */
export type ProfileRow = Omit<GeneratedProfileRow, 'role'> & { role: Role }
export type ProfileInsert = Omit<
  Database['public']['Tables']['profiles']['Insert'],
  'role'
> & { role?: Role }
export type ProfileUpdate = Omit<
  Database['public']['Tables']['profiles']['Update'],
  'role'
> & { role?: Role }

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}
