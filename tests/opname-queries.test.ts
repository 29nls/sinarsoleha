import { describe, expect, it, vi } from 'vitest'
import { getOpnameDetail, listOpnames } from '../app/services/opname'

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
  const row = {
    id: 'o-1',
    opname_no: 'OPN-1',
    status: 'counting',
    scope_note: null,
    created_at: '2026-11-04T09:00:00Z',
    submitted_at: null,
    approved_at: null,
    posted_at: null,
    cancelled_at: null,
    cancelled_reason: null,
    stock_opname_items: [
      {
        id: 'i-2',
        product_id: 'p-2',
        system_qty_snapshot: null,
        physical_qty: 4,
        difference_qty: null,
        reason_code: 'opening_balance',
        reason_note: 'Awal',
        count_status: 'counted',
        counted_at: '2026-11-04T10:00:00Z',
        products: {
          sku: 'SKU-2',
          name: 'Sabun',
          is_active: true,
          units_of_measure: { label: 'Pcs', decimal_scale: 0 },
        },
      },
      {
        id: 'i-1',
        product_id: 'p-1',
        system_qty_snapshot: 10,
        physical_qty: null,
        difference_qty: null,
        reason_code: null,
        reason_note: null,
        count_status: 'pending',
        counted_at: null,
        products: {
          sku: 'SKU-1',
          name: 'Beras',
          is_active: false,
          units_of_measure: { label: 'Kg', decimal_scale: 2 },
        },
      },
    ],
  }

  it('maps rows and sorts them by SKU', async () => {
    const { client } = queryClient({ data: row, error: null })

    const detail = await getOpnameDetail(client, 'o-1')

    expect(detail.items.map((item) => item.sku)).toEqual(['SKU-1', 'SKU-2'])
    expect(detail.items[0]).toMatchObject({
      decimalScale: 2,
      unitLabel: 'Kg',
      isActive: false,
      systemQtySnapshot: 10,
    })
  })

  it('keeps an unknown balance and its opening reason', async () => {
    const { client } = queryClient({ data: row, error: null })

    const detail = await getOpnameDetail(client, 'o-1')
    const opening = detail.items.find((item) => item.sku === 'SKU-2')

    expect(opening?.systemQtySnapshot).toBeNull()
    expect(opening?.differenceQty).toBeNull()
    expect(opening?.reasonCode).toBe('opening_balance')
  })

  it('falls back when the product relation is missing', async () => {
    const { client } = queryClient({
      data: {
        ...row,
        stock_opname_items: [
          {
            id: 'i-9',
            product_id: 'p-9',
            system_qty_snapshot: 0,
            physical_qty: null,
            difference_qty: null,
            reason_code: null,
            reason_note: null,
            count_status: 'pending',
            counted_at: null,
            products: null,
          },
        ],
      },
      error: null,
    })

    const detail = await getOpnameDetail(client, 'o-1')
    expect(detail.items[0]).toMatchObject({
      sku: '—',
      productName: 'Produk tidak ditemukan',
      decimalScale: 0,
    })
  })

  it('turns a missing session into a readable message', async () => {
    const { client } = queryClient({
      data: null,
      error: { message: 'OPNAME_NOT_FOUND: Sesi opname tidak ditemukan.' },
    })

    await expect(getOpnameDetail(client, 'missing')).rejects.toThrow('Sesi opname tidak ditemukan.')
  })
})
