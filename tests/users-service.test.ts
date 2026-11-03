import { describe, expect, it, vi } from 'vitest'
import { adminUpsertProfile, listProfiles } from '../app/services/users'
import {
  describeUsersError,
  isLastActiveOwner,
  shortUserId,
  validateFullName,
} from '../app/types/users'

type Result = { data: unknown; error: unknown }

function selectClient(result: Result) {
  const calls: Array<[string, unknown[]]> = []
  const builder: Record<string, unknown> = {}
  const record = (name: string) => (...args: unknown[]) => {
    calls.push([name, args])
    return builder
  }
  for (const method of ['select', 'order', 'eq']) builder[method] = record(method)
  builder.returns = vi.fn().mockResolvedValue(result)

  return { client: { from: vi.fn().mockReturnValue(builder) } as never, calls }
}

function rpcClient(result: Result) {
  const rpc = vi.fn().mockResolvedValue(result)
  return { client: { rpc } as never, rpc }
}

const profileRow = {
  id: '11111111-2222-3333-4444-555555555555',
  full_name: 'Siti Aminah',
  role: 'cashier',
  is_active: true,
  activated_at: '2026-11-02T03:00:00Z',
  created_at: '2026-11-01T03:00:00Z',
  updated_at: '2026-11-03T03:00:00Z',
}

describe('listProfiles', () => {
  it('orders by name and maps snake_case into the view model', async () => {
    const { client, calls } = selectClient({ data: [profileRow], error: null })

    const rows = await listProfiles(client)

    expect(calls).toContainEqual(['order', ['full_name', { ascending: true }]])
    expect(rows[0]).toEqual({
      id: profileRow.id,
      fullName: 'Siti Aminah',
      role: 'cashier',
      isActive: true,
      activatedAt: profileRow.activated_at,
      createdAt: profileRow.created_at,
      updatedAt: profileRow.updated_at,
    })
  })

  it('falls back to cashier when the role drifted from the constraint', async () => {
    const { client } = selectClient({
      data: [{ ...profileRow, role: 'superadmin' }],
      error: null,
    })

    const rows = await listProfiles(client)

    expect(rows[0]?.role).toBe('cashier')
  })

  it('translates a permission error instead of leaking the Postgres message', async () => {
    const { client } = selectClient({
      data: null,
      error: { message: 'permission denied for table profiles' },
    })

    await expect(listProfiles(client)).rejects.toThrow(
      'Anda tidak memiliki izin untuk mengelola pengguna.',
    )
  })
})

describe('adminUpsertProfile', () => {
  it('sends the RPC argument names and trims the name', async () => {
    const { client, rpc } = rpcClient({ data: { ...profileRow, full_name: 'Budi' }, error: null })

    const updated = await adminUpsertProfile(client, profileRow.id, {
      fullName: '  Budi  ',
      role: 'owner',
      isActive: true,
    })

    expect(rpc).toHaveBeenCalledWith('admin_upsert_profile', {
      p_user_id: profileRow.id,
      p_full_name: 'Budi',
      p_role: 'owner',
      p_is_active: true,
    })
    expect(updated.fullName).toBe('Budi')
  })

  it('surfaces the last-owner guard as readable Indonesian', async () => {
    const { client } = rpcClient({
      data: null,
      error: { message: 'LAST_OWNER: Tidak boleh menonaktifkan owner aktif terakhir.' },
    })

    await expect(
      adminUpsertProfile(client, profileRow.id, {
        fullName: 'Siti Aminah',
        role: 'cashier',
        isActive: false,
      }),
    ).rejects.toThrow('Tidak boleh menonaktifkan atau menurunkan owner aktif terakhir.')
  })

  it('rejects a response without a profile instead of showing stale data', async () => {
    const { client } = rpcClient({ data: null, error: null })

    await expect(
      adminUpsertProfile(client, profileRow.id, {
        fullName: 'Siti Aminah',
        role: 'cashier',
        isActive: true,
      }),
    ).rejects.toThrow('Server tidak mengembalikan profil yang diperbarui.')
  })
})

describe('user helpers', () => {
  it('validates the name against the database constraint', () => {
    expect(validateFullName('   ')).toBe('Nama wajib diisi.')
    expect(validateFullName('a'.repeat(121))).toContain('maksimal 120')
    expect(validateFullName('  Budi  ')).toBeNull()
  })

  it('exposes a short id because email is not readable', () => {
    expect(shortUserId(profileRow.id)).toBe('11111111')
  })

  it('flags the only active owner', () => {
    const base = {
      id: profileRow.id,
      fullName: 'Siti Aminah',
      isActive: true,
      activatedAt: null,
      createdAt: profileRow.created_at,
      updatedAt: profileRow.updated_at,
    }
    const owner = { ...base, role: 'owner' as const }
    const cashier = { ...base, id: 'other', role: 'cashier' as const }

    expect(isLastActiveOwner(owner, [owner, cashier])).toBe(true)
    expect(isLastActiveOwner(owner, [owner, { ...cashier, role: 'owner' }])).toBe(false)
    expect(isLastActiveOwner({ ...owner, isActive: false }, [owner])).toBe(false)
  })

  it('maps every documented RPC error code', () => {
    expect(describeUsersError('INVALID_ROLE: Peran tidak dikenal.')).toBe('Peran tidak dikenal.')
    expect(describeUsersError('PROFILE_NOT_FOUND: Profil tidak ditemukan.')).toContain(
      'Profil tidak ditemukan',
    )
    expect(describeUsersError('OWNER_REQUIRED')).toBe('Hanya owner yang dapat mengelola pengguna.')
    expect(describeUsersError('network timeout')).toBe('network timeout')
  })
})
