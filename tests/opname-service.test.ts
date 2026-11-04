import { describe, expect, it, vi } from 'vitest'
import {
  approveOpname,
  cancelOpname,
  createOpname,
  getOpnameDetail,
  getOpnameItemContext,
  getOpnameItemsPage,
  listOpnames,
  postOpname,
  recordOpnameCount,
  submitOpname,
} from '../app/services/opname'

type RpcResult = {
  data: unknown
  error: { message: string; details?: string | null } | null
}

function rpcClient(result: RpcResult) {
  const rpc = vi.fn().mockResolvedValue(result)
  return { client: { rpc } as never, rpc }
}

describe('createOpname', () => {
  it('sends only the fields the caller set', async () => {
    const { client, rpc } = rpcClient({
      data: {
        opname_id: 'o-1',
        opname_no: 'OPN-1',
        status: 'counting',
        item_count: 12,
        already_processed: false,
      },
      error: null,
    })

    const result = await createOpname(client, {
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      scopeNote: '  Rak depan  ',
      productIds: [],
      categoryId: 4,
      excludeProductIds: [],
    })

    expect(rpc).toHaveBeenCalledWith('create_stock_opname', {
      p_payload: {
        idempotency_key: '11111111-1111-4111-8111-111111111111',
        scope_note: 'Rak depan',
        category_id: 4,
      },
    })
    expect(result).toMatchObject({ opnameId: 'o-1', opnameNo: 'OPN-1', itemCount: 12 })
  })

  it('includes selected and excluded products when present', async () => {
    const { client, rpc } = rpcClient({ data: { opname_id: 'o-2' }, error: null })

    await createOpname(client, {
      idempotencyKey: 'key',
      scopeNote: '',
      productIds: ['p-1', 'p-2'],
      categoryId: null,
      excludeProductIds: ['p-3'],
    })

    expect(rpc.mock.calls[0]?.[1].p_payload).toEqual({
      idempotency_key: 'key',
      product_ids: ['p-1', 'p-2'],
      exclude_product_ids: ['p-3'],
    })
  })

  it('surfaces a translated error instead of returning data', async () => {
    const { client } = rpcClient({
      data: null,
      error: { message: 'OPNAME_EMPTY: Tidak ada produk yang cocok.' },
    })

    await expect(createOpname(client, {
      idempotencyKey: 'key',
      scopeNote: '',
      productIds: [],
      categoryId: null,
      excludeProductIds: [],
    })).rejects.toThrow('Tidak ada produk yang cocok dengan cakupan opname.')
  })
})

describe('recordOpnameCount', () => {
  it('passes numeric quantity and empty strings for cleared reasons', async () => {
    const { client, rpc } = rpcClient({
      data: {
        item_id: 'i-1',
        opname_id: 'o-1',
        product_id: 'p-1',
        system_qty_snapshot: 10,
        physical_qty: 8,
        difference_qty: -2,
        reason_code: 'missing',
        count_status: 'counted',
        counted_by: 'u-1',
        counted_at: '2026-11-04T10:00:00Z',
      },
      error: null,
    })

    const result = await recordOpnameCount(client, 'i-1', 8, null, null)

    expect(rpc).toHaveBeenCalledWith('record_stock_opname_count', {
      p_stock_opname_item_id: 'i-1',
      p_physical_qty: 8,
      p_reason_code: '',
      p_reason_note: '',
    })
    expect(result).toMatchObject({
      differenceQty: -2,
      countStatus: 'counted',
      physicalQty: 8,
    })
  })

  it('keeps a null difference for an unknown balance', async () => {
    const { client } = rpcClient({
      data: {
        item_id: 'i-2',
        system_qty_snapshot: null,
        physical_qty: 5,
        difference_qty: null,
        reason_code: 'opening_balance',
        count_status: 'counted',
      },
      error: null,
    })

    const result = await recordOpnameCount(client, 'i-2', 5, 'opening_balance', 'Awal')
    expect(result.systemQtySnapshot).toBeNull()
    expect(result.differenceQty).toBeNull()
  })
})

describe('opname reads', () => {
  it('loads the summary RPC for the session header', async () => {
    const { client, rpc } = rpcClient({
      data: {
        opname_id: 'o-1',
        opname_no: 'OPN-1',
        status: 'counting',
        item_count: 1361,
        pending_count: 0,
        counted_count: 1361,
        needs_recount_count: 0,
        posted_count: 0,
        opening_balance_count: 0,
        matching_count: 1361,
        discrepancy_count: 0,
        blocker_count: 0,
        ready_for_submit: true,
      },
      error: null,
    })

    const detail = await getOpnameDetail(client, 'o-1')

    expect(rpc).toHaveBeenCalledWith('get_stock_opname_summary', { p_opname_id: 'o-1' })
    expect(detail.readyForSubmit).toBe(true)
    expect(detail.itemCount).toBe(1361)
  })

  it('requests a single deterministic page of items', async () => {
    const { client, rpc } = rpcClient({
      data: { total: 1361, items: [] },
      error: null,
    })

    const result = await getOpnameItemsPage(client, 'o-1', {
      page: 2,
      pageSize: 50,
      filter: 'recount',
      search: 'SKU',
    })

    expect(rpc).toHaveBeenCalledWith('list_stock_opname_items', {
      p_opname_id: 'o-1',
      p_limit: 50,
      p_offset: 50,
      p_filter: 'recount',
      p_search: 'SKU',
    })
    expect(result.total).toBe(1361)
  })

  it('reads live product state for the recount dialog', async () => {
    const { client, rpc } = rpcClient({
      data: {
        item_id: 'i-1',
        opname_id: 'o-1',
        product_id: 'p-1',
        sku: 'SKU-1',
        system_qty_snapshot: 30,
        stock_version_snapshot: 0,
        current_qty: 25,
        current_version: 1,
        count_status: 'needs_recount',
      },
      error: null,
    })

    const context = await getOpnameItemContext(client, 'i-1')

    expect(rpc).toHaveBeenCalledWith('get_stock_opname_item_context', { p_item_id: 'i-1' })
    expect(context).toMatchObject({
      systemQtySnapshot: 30,
      stockVersionSnapshot: 0,
      currentQty: 25,
      currentVersion: 1,
      countStatus: 'needs_recount',
    })
  })

  it('surfaces a readable error when the item context is gone', async () => {
    const { client } = rpcClient({
      data: null,
      error: { message: 'PRODUCT_NOT_FOUND: Produk item opname tidak ditemukan.' },
    })

    await expect(getOpnameItemContext(client, 'i-1'))
      .rejects.toThrow('Produk item opname tidak ditemukan.')
  })
})

describe('recordOpnameCount after a version conflict', () => {
  it('returns the rebased snapshot the database actually used', async () => {
    const { client, rpc } = rpcClient({
      data: {
        item_id: 'i-1',
        opname_id: 'o-1',
        product_id: 'p-1',
        // Rebased from the stale 30 to the current 25 inside the transaction.
        system_qty_snapshot: 25,
        physical_qty: 24,
        difference_qty: -1,
        reason_code: 'missing',
        count_status: 'counted',
        counted_by: 'u-1',
        counted_at: '2026-11-04T11:00:00Z',
      },
      error: null,
    })

    const result = await recordOpnameCount(client, 'i-1', 24, 'missing', null)

    expect(rpc).toHaveBeenCalledWith('record_stock_opname_count', {
      p_stock_opname_item_id: 'i-1',
      p_physical_qty: 24,
      p_reason_code: 'missing',
      p_reason_note: '',
    })
    // The UI must store this number, not the snapshot it held before the call.
    expect(result.systemQtySnapshot).toBe(25)
    expect(result.differenceQty).toBe(-1)
    expect(result.countStatus).toBe('counted')
  })

  it('keeps the database reason guard visible when the reason is missing', async () => {
    const { client } = rpcClient({
      data: null,
      error: { message: 'REASON_REQUIRED: Selisih stok wajib memiliki reason_code.' },
    })

    await expect(recordOpnameCount(client, 'i-1', 24, null, null))
      .rejects.toThrow('Selisih stok wajib memiliki alasan.')
  })
})

describe('postOpname', () => {
  it('returns a posted summary with counters', async () => {
    const { client } = rpcClient({
      data: {
        opname_id: 'o-1',
        opname_no: 'OPN-1',
        status: 'posted',
        result: 'posted',
        item_count: 10,
        unchanged_count: 6,
        opening_balance_count: 1,
        discrepancy_count: 3,
        delta_total: -4.5,
        conflicts: [],
        already_processed: false,
      },
      error: null,
    })

    const result = await postOpname(client, 'o-1')
    expect(result.result).toBe('posted')
    expect(result.discrepancyCount).toBe(3)
    expect(result.openingBalanceCount).toBe(1)
    expect(result.deltaTotal).toBe(-4.5)
    expect(result.conflicts).toEqual([])
  })

  it('exposes conflicts without throwing on a version conflict', async () => {
    const conflict = {
      item_id: 'i-1',
      product_id: 'p-1',
      sku: 'SKU-1',
      snapshot_version: 3,
      current_version: 5,
      snapshot_qty: 10,
      current_qty: 7,
    }

    const { client } = rpcClient({
      data: {
        opname_id: 'o-1',
        status: 'counting',
        result: 'version_conflict',
        conflicts: [conflict],
        already_processed: false,
      },
      error: null,
    })

    const result = await postOpname(client, 'o-1')
    expect(result.result).toBe('version_conflict')
    expect(result.conflicts).toHaveLength(1)
    // Conflicts are passed through untouched so the UI can show both versions.
    expect(result.conflicts[0]).toMatchObject({ sku: 'SKU-1', current_version: 5 })
  })

  it('treats an already posted session as posted', async () => {
    const { client } = rpcClient({
      data: { result: 'already_posted', status: 'posted', delta_total: 0 },
      error: null,
    })

    const result = await postOpname(client, 'o-1')
    expect(result.result).toBe('posted')
  })
})

describe('cancelOpname', () => {
  it('trims the reason before sending it', async () => {
    const { client, rpc } = rpcClient({ data: { status: 'cancelled' }, error: null })

    await cancelOpname(client, 'o-1', '  Salah kategori  ')

    expect(rpc).toHaveBeenCalledWith('cancel_stock_opname', {
      p_opname_id: 'o-1',
      p_reason: 'Salah kategori',
    })
  })

  it('translates the posted guard', async () => {
    const { client } = rpcClient({
      data: null,
      error: { message: 'OPNAME_POSTED: Sesi yang sudah diposting tidak dapat dibatalkan.' },
    })

    await expect(cancelOpname(client, 'o-1', 'x'))
      .rejects.toThrow('Sesi yang sudah terposting tidak dapat dibatalkan.')
  })
})

describe('submit and approve guards', () => {
  it('reports how many items block submission', async () => {
    const blockers = JSON.stringify([
      { item_id: 'i-1', reason: 'pending' },
      { item_id: 'i-2', reason: 'needs_recount' },
    ])
    const { client } = rpcClient({
      data: null,
      error: {
        message: 'OPNAME_INCOMPLETE: Masih ada item belum lengkap.',
        details: blockers,
      },
    })

    await expect(submitOpname(client, 'o-1'))
      .rejects.toThrow('Masih ada 2 item yang belum lengkap.')
  })

  it('keeps the generic sentence when no blocker detail is present', async () => {
    const { client } = rpcClient({
      data: null,
      error: { message: 'OPNAME_INCOMPLETE: Masih ada item belum lengkap.', details: null },
    })

    await expect(approveOpname(client, 'o-1'))
      .rejects.toThrow('Masih ada item yang belum lengkap.')
  })

  it('translates the wrong-status guard on approval', async () => {
    const { client } = rpcClient({
      data: null,
      error: { message: 'OPNAME_NOT_SUBMITTED: Sesi ini belum disubmit.' },
    })

    await expect(approveOpname(client, 'o-1'))
      .rejects.toThrow('Sesi ini belum disubmit, jadi belum bisa disetujui.')
  })
})
