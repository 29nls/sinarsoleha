import { describe, expect, it, vi } from 'vitest'
import {
  getOpnameDetail,
  getOpnameItemContext,
  getOpnameItemsPage,
  listOpnames,
} from '../app/services/opname'

/**
 * Minimal chainable stand-in for the supabase-js builder. Every filter method
 * records itself so the test can assert on the generated query shape.
 */
function queryClient(result: { data: unknown; error: unknown; count?: number }) {
  const calls: Array<[string, unknown[]]> = []
  const builder: Record<string, unknown> = {}

  const record = (name: string) => (...args: unknown[]) => {
    calls.push([name, args])
    return builder
  }

  for (const method of ['select', 'order', 'eq', 'ilike', 'range', 'is']) {
    builder[method] = record(method)
  }
  builder.returns = vi.fn().mockResolvedValue(result)
  builder.single = vi.fn().mockResolvedValue(result)

  const from = vi.fn().mockReturnValue(builder)
  return { client: { from } as never, from, calls, builder }
}

function rpcClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result)
  return { client: { rpc } as never, rpc }
}

describe('listOpnames', () => {
  it('filters by status, searches the number, and paginates', async () => {
    const { client, from, calls } = queryClient({ data: [], error: null, count: 0 })

    await listOpnames(client, {
      page: 3,
      pageSize: 20,
      status: 'counting',
      search: 'OPN-2026',
    })

    expect(from).toHaveBeenCalledWith('stock_opnames')
    expect(calls).toContainEqual(['eq', ['status', 'counting']])
    expect(calls).toContainEqual(['ilike', ['opname_no', '%OPN-2026%']])
    expect(calls).toContainEqual(['range', [40, 59]])
  })

  it('escapes wildcard characters in the search term', async () => {
    const { client, calls } = queryClient({ data: [], error: null, count: 0 })

    await listOpnames(client, { page: 1, pageSize: 20, status: '', search: '50%_off' })

    expect(calls).toContainEqual(['ilike', ['opname_no', '%50\\%\\_off%']])
  })

  it('skips filters when they are empty', async () => {
    const { client, calls } = queryClient({ data: [], error: null, count: 0 })

    await listOpnames(client, { page: 1, pageSize: 20, status: '', search: '   ' })

    expect(calls.some(([name]) => name === 'eq')).toBe(false)
    expect(calls.some(([name]) => name === 'ilike')).toBe(false)
  })

  it('derives progress counts from the embedded items', async () => {
    const { client } = queryClient({
      data: [
        {
          id: 'o-1',
          opname_no: 'OPN-1',
          status: 'counting',
          scope_note: 'Rak A',
          created_at: '2026-11-04T09:00:00Z',
          submitted_at: null,
          approved_at: null,
          posted_at: null,
          cancelled_at: null,
          stock_opname_items: [
            { count_status: 'counted' },
            { count_status: 'pending' },
            { count_status: 'needs_recount' },
          ],
        },
      ],
      error: null,
      count: 1,
    })

    const result = await listOpnames(client, {
      page: 1,
      pageSize: 20,
      status: '',
      search: '',
    })

    expect(result.total).toBe(1)
    expect(result.rows[0]).toMatchObject({
      itemCount: 3,
      countedCount: 2,
      recountCount: 1,
    })
  })

  it('returns an empty list when the embedded relation is null', async () => {
    const { client } = queryClient({
      data: [
        {
          id: 'o-2',
          opname_no: 'OPN-2',
          status: 'counting',
          scope_note: null,
          created_at: '2026-11-04T09:00:00Z',
          submitted_at: null,
          approved_at: null,
          posted_at: null,
          cancelled_at: null,
          stock_opname_items: null,
        },
      ],
      error: null,
      count: 1,
    })

    const result = await listOpnames(client, { page: 1, pageSize: 20, status: '', search: '' })
    expect(result.rows[0]?.itemCount).toBe(0)
  })

  it('throws a translated error', async () => {
    const { client } = queryClient({
      data: null,
      error: { message: 'permission denied for table stock_opnames' },
      count: null as unknown as number,
    })

    await expect(listOpnames(client, { page: 1, pageSize: 20, status: '', search: '' }))
      .rejects.toThrow('Anda tidak memiliki izin untuk operasi ini.')
  })
})

describe('getOpnameDetail', () => {
  const summary = {
    opname_id: 'o-1',
    opname_no: 'OPN-1',
    status: 'counting',
    scope_note: 'Rak A',
    created_at: '2026-11-04T09:00:00Z',
    submitted_at: null,
    approved_at: null,
    posted_at: null,
    cancelled_at: null,
    cancelled_reason: null,
    item_count: 1361,
    pending_count: 900,
    counted_count: 449,
    needs_recount_count: 12,
    posted_count: 0,
    opening_balance_count: 4,
    matching_count: 300,
    discrepancy_count: 145,
    blocker_count: 912,
    ready_for_submit: false,
  }

  it('reads the aggregated summary instead of embedding every item', async () => {
    const { client, rpc } = rpcClient({ data: summary, error: null })

    const detail = await getOpnameDetail(client, 'o-1')

    expect(rpc).toHaveBeenCalledWith('get_stock_opname_summary', { p_opname_id: 'o-1' })
    expect(detail).toMatchObject({
      id: 'o-1',
      itemCount: 1361,
      pendingCount: 900,
      countedCount: 449,
      needsRecountCount: 12,
      openingBalanceCount: 4,
      matchingCount: 300,
      discrepancyCount: 145,
      blockerCount: 912,
      readyForSubmit: false,
    })
  })

  it('keeps a global count beyond the PostgREST row cap', async () => {
    const { client } = rpcClient({ data: summary, error: null })

    const detail = await getOpnameDetail(client, 'o-1')

    // The old embedded query stopped at 1,000 rows; the database aggregate
    // must still report the whole session.
    expect(detail.itemCount).toBe(1361)
    expect(detail.pendingCount + detail.countedCount + detail.needsRecountCount)
      .toBe(detail.itemCount)
  })

  it('accepts a jsonb payload returned as a string', async () => {
    const { client } = rpcClient({ data: JSON.stringify(summary), error: null })

    const detail = await getOpnameDetail(client, 'o-1')
    expect(detail.opnameNo).toBe('OPN-1')
    expect(detail.readyForSubmit).toBe(false)
  })

  it('turns a missing session into a readable message', async () => {
    const { client } = rpcClient({
      data: null,
      error: { message: 'OPNAME_NOT_FOUND: Sesi opname tidak ditemukan.' },
    })

    await expect(getOpnameDetail(client, 'missing')).rejects.toThrow('Sesi opname tidak ditemukan.')
  })
})

describe('getOpnameItemsPage', () => {
  const page = {
    opname_id: 'o-1',
    total: 1361,
    limit: 50,
    offset: 0,
    filter: 'all',
    search: null,
    items: [
      {
        id: 'i-1',
        product_id: 'p-1',
        sku: 'SKU-1',
        product_name: 'Beras',
        unit_label: 'Kg',
        decimal_scale: 2,
        is_active: true,
        system_qty_snapshot: 10,
        physical_qty: null,
        difference_qty: null,
        reason_code: null,
        reason_note: null,
        count_status: 'pending',
        counted_at: null,
      },
      {
        id: 'i-2',
        product_id: 'p-2',
        sku: 'SKU-2',
        product_name: 'Sabun',
        unit_label: 'Pcs',
        decimal_scale: 0,
        is_active: false,
        system_qty_snapshot: null,
        physical_qty: 4,
        difference_qty: null,
        reason_code: 'opening_balance',
        reason_note: 'Awal',
        count_status: 'counted',
        counted_at: '2026-11-04T10:00:00Z',
      },
    ],
  }

  it('asks the database for one page with a deterministic offset', async () => {
    const { client, rpc } = rpcClient({ data: page, error: null })

    const result = await getOpnameItemsPage(client, 'o-1', {
      page: 3,
      pageSize: 250,
      filter: 'pending',
      search: 'beras',
    })

    expect(rpc).toHaveBeenCalledWith('list_stock_opname_items', {
      p_opname_id: 'o-1',
      p_limit: 250,
      p_offset: 500,
      p_filter: 'pending',
      p_search: 'beras',
    })
    expect(result.total).toBe(1361)
    expect(result.page).toBe(3)
    expect(result.pageSize).toBe(250)
  })

  it('omits a blank search so the RPC does not filter on an empty string', async () => {
    const { client, rpc } = rpcClient({ data: page, error: null })

    await getOpnameItemsPage(client, 'o-1', {
      page: 1,
      pageSize: 50,
      filter: 'all',
      search: '   ',
    })

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_search: undefined })
  })

  it('maps rows and preserves null balances', async () => {
    const { client } = rpcClient({ data: page, error: null })

    const result = await getOpnameItemsPage(client, 'o-1', {
      page: 1,
      pageSize: 50,
      filter: 'all',
      search: '',
    })

    expect(result.items[0]).toMatchObject({
      sku: 'SKU-1',
      productName: 'Beras',
      unitLabel: 'Kg',
      decimalScale: 2,
      systemQtySnapshot: 10,
      countStatus: 'pending',
    })
    expect(result.items[1]).toMatchObject({
      isActive: false,
      systemQtySnapshot: null,
      differenceQty: null,
      reasonCode: 'opening_balance',
      countStatus: 'counted',
    })
  })

  it('falls back when the joined product is missing', async () => {
    const { client } = rpcClient({
      data: {
        ...page,
        items: [
          {
            id: 'i-9',
            product_id: 'p-9',
            sku: null,
            product_name: null,
            unit_label: null,
            decimal_scale: null,
            is_active: false,
            system_qty_snapshot: 0,
            physical_qty: null,
            difference_qty: null,
            reason_code: null,
            reason_note: null,
            count_status: 'pending',
            counted_at: null,
          },
        ],
      },
      error: null,
    })

    const result = await getOpnameItemsPage(client, 'o-1', {
      page: 1,
      pageSize: 50,
      filter: 'all',
      search: '',
    })

    expect(result.items[0]).toMatchObject({
      sku: '—',
      productName: 'Produk tidak ditemukan',
      unitLabel: '',
      decimalScale: 0,
    })
  })

  it('returns an empty page when the RPC omits the items array', async () => {
    const { client } = rpcClient({ data: { total: 0 }, error: null })

    const result = await getOpnameItemsPage(client, 'o-1', {
      page: 1,
      pageSize: 50,
      filter: 'all',
      search: '',
    })

    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
  })

  it('translates an unknown filter', async () => {
    const { client } = rpcClient({
      data: null,
      error: { message: 'INVALID_FILTER: Filter item tidak dikenal.' },
    })

    await expect(getOpnameItemsPage(client, 'o-1', {
      page: 1,
      pageSize: 50,
      filter: 'all',
      search: '',
    })).rejects.toThrow('Filter item tidak dikenal.')
  })
})

describe('getOpnameItemContext', () => {
  const context = {
    item_id: 'i-1',
    opname_id: 'o-1',
    opname_status: 'counting',
    product_id: 'p-1',
    sku: 'SKU-1',
    product_name: 'Beras',
    is_active: true,
    unit_label: 'Kg',
    decimal_scale: 2,
    system_qty_snapshot: 13,
    stock_version_snapshot: 2,
    current_qty: 12,
    current_version: 3,
    physical_qty: 11,
    reason_code: 'missing',
    reason_note: null,
    count_status: 'needs_recount',
    counted_at: '2026-11-04T10:00:00Z',
  }

  it('keeps the stale snapshot separate from current stock', async () => {
    const { client, rpc } = rpcClient({ data: context, error: null })

    const result = await getOpnameItemContext(client, 'i-1')

    expect(rpc).toHaveBeenCalledWith('get_stock_opname_item_context', { p_item_id: 'i-1' })
    expect(result).toMatchObject({
      systemQtySnapshot: 13,
      stockVersionSnapshot: 2,
      currentQty: 12,
      currentVersion: 3,
      countStatus: 'needs_recount',
    })
    // The two quantities are distinct facts, not one overwritten value.
    expect(result.systemQtySnapshot).not.toBe(result.currentQty)
  })

  it('translates a missing item', async () => {
    const { client } = rpcClient({
      data: null,
      error: { message: 'OPNAME_ITEM_NOT_FOUND: Item opname tidak ditemukan.' },
    })

    await expect(getOpnameItemContext(client, 'missing'))
      .rejects.toThrow('Item opname tidak ditemukan.')
  })
})
