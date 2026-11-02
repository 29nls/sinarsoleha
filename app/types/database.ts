export type Role = 'owner' | 'cashier' | 'inventory_staff'

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner / Admin',
  cashier: 'Kasir',
  inventory_staff: 'Staf Gudang',
}

/**
 * Generated Supabase types are not available yet (no linked project).
 * Only the table this phase reads is typed; Phase 2 replaces this file with
 * `supabase gen types typescript` output once migrations are applied.
 */
export interface ProfileRow {
  id: string
  full_name: string
  role: Role
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ProfileInsert {
  id: string
  full_name: string
  role?: Role
  is_active?: boolean
}

export interface ProfileUpdate {
  full_name?: string
  role?: Role
  is_active?: boolean
  updated_at?: string
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow
        Insert: ProfileInsert
        Update: ProfileUpdate
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
