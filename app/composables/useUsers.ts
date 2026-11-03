import { computed, shallowRef } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'
import type { UserDraft, UserRow } from '~/types/users'
import { isLastActiveOwner } from '~/types/users'
import { adminUpsertProfile, listProfiles } from '~/services/users'

type Client = SupabaseClient<Database>

/**
 * User administration state. Small on purpose: the list is a few dozen rows,
 * so there is no paging and no caching layer between the RPC and the table.
 */
export function useUsers(client: Client) {
  const rows = shallowRef<UserRow[]>([])
  const loading = shallowRef(false)
  const saving = shallowRef<string | null>(null)
  const error = shallowRef<string | null>(null)
  const loaded = shallowRef(false)

  const activeCount = computed(() => rows.value.filter((row) => row.isActive).length)
  const ownerCount = computed(
    () => rows.value.filter((row) => row.role === 'owner' && row.isActive).length,
  )

  let requestId = 0

  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return
    const current = ++requestId
    loading.value = true
    error.value = null
    try {
      const result = await listProfiles(client)
      if (current !== requestId) return
      rows.value = result
      loaded.value = true
    } catch (cause) {
      if (current !== requestId) return
      error.value = cause instanceof Error ? cause.message : 'Gagal memuat data pengguna.'
      rows.value = []
    } finally {
      if (current === requestId) loading.value = false
    }
  }

  function lastOwner(row: UserRow): boolean {
    return isLastActiveOwner(row, rows.value)
  }

  /**
   * Returns null on success or a message on failure, so the caller can keep the
   * dialog open and show the reason next to the field it belongs to.
   */
  async function save(row: UserRow, draft: UserDraft): Promise<string | null> {
    saving.value = row.id
    error.value = null
    try {
      const updated = await adminUpsertProfile(client, row.id, draft)
      rows.value = rows.value
        .map((item) => (item.id === updated.id ? updated : item))
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'id'))
      return null
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Gagal menyimpan pengguna.'
      error.value = message
      return message
    } finally {
      saving.value = null
    }
  }

  return { rows, loading, saving, error, loaded, activeCount, ownerCount, load, save, lastOwner }
}
