import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'
import { isRole, type Role } from '~/types/database'
import type { UserDraft, UserRow } from '~/types/users'
import { describeUsersError } from '~/types/users'

type Client = SupabaseClient<Database>

const PROFILE_SELECT = 'id, full_name, role, is_active, activated_at, created_at, updated_at'

interface ProfileSelectRow {
  id: string
  full_name: string
  role: string
  is_active: boolean
  activated_at: string | null
  created_at: string
  updated_at: string
}

function toUserRow(row: ProfileSelectRow): UserRow {
  return {
    id: row.id,
    fullName: row.full_name,
    // The table constraint allows only three roles; anything else means the
    // schema drifted and the row must not be rendered as an unknown role.
    role: isRole(row.role) ? row.role : ('cashier' satisfies Role),
    isActive: row.is_active,
    activatedAt: row.activated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Owner-only read: `profiles_select_self_or_owner` returns every profile to an
 * active owner and only the caller's own row to everyone else.
 */
export async function listProfiles(client: Client): Promise<UserRow[]> {
  const { data, error } = await client
    .from('profiles')
    .select(PROFILE_SELECT)
    .order('full_name', { ascending: true })
    .returns<ProfileSelectRow[]>()

  if (error) throw new Error(describeUsersError(error.message))
  return (data ?? []).map(toUserRow)
}

/**
 * Name, role, and active flag only. Email and password are managed by Supabase
 * Auth; this RPC cannot create an account, so a missing profile stays missing.
 */
export async function adminUpsertProfile(
  client: Client,
  userId: string,
  draft: UserDraft,
): Promise<UserRow> {
  const { data, error } = await client.rpc('admin_upsert_profile', {
    p_user_id: userId,
    p_full_name: draft.fullName.trim(),
    p_role: draft.role,
    p_is_active: draft.isActive,
  })

  if (error) throw new Error(describeUsersError(error.message))
  if (!data || typeof data !== 'object') {
    throw new Error('Server tidak mengembalikan profil yang diperbarui.')
  }

  const row = data as unknown as ProfileSelectRow
  if (!row.id) throw new Error('Server tidak mengembalikan profil yang diperbarui.')
  return toUserRow(row)
}
