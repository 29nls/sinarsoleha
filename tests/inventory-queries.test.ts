import { describe, expect, it, vi } from 'vitest'
import {
  listStockBalances,
  listStockDiscrepancies,
  listStockMovements,
} from '../app/services/inventory'

type Result = { data: unknown; error: unknown; count?: number | null }

function queryClient(result: Result) {
  const calls: Array<[string, unknown[]]> = []
  const builder: Record<string, unknown> = {}

  const record = (name: string) => (...args: unknown[]) => {
    calls.push([name, args])
    return builder
  }

  for (const method of ['select', 'order', 'eq', 'lt', 'is', 'gte', 'lte', 'or', 'range']) {
    builder[method] = record(method)
  }
  builder.returns = vi.fn().mockResolvedValue(result)

  const from = vi.fn().mockReturnValue(builder)
  return { client: { from } as never, from, calls }
}

const productEmbed = {
  sku: 'BERAS-5',
  name: 'Beras 5 kg',
  units_of_measure: { label: 'Karung', decimal_scale: 0 },
}

describe('listStockBalances', () => {
  it('filters by stock state and paginates', async () => {
    const { client, from, calls } = queryClient({ data: [], error: null, count: 0 })

    await listStockBalances(client, {
      search: '',
      state: 'negative',
      page: 2,
      pageSize: 25,
    })

    expect(from).toHaveBeenCalledWith('products')
    expect(calls).toContainEqual(['lt', ['stock_on_hand', 0]])
    expect(calls).toContainEqual(['range', [25, 49]])
  })

  it('searches SKU and name with an escaped wildcard', async () => {
    const { client, calls } = queryClient({ data: [], error: null, count: 0 })

    await listStockBalances(client, { search: '50%', state: 'all', page: 1, pageSize: 25 })

    const or = calls.find(([name]) => name === 'or')
    expect(or?.[1][0]).toContain('50\\\\%')
    expect(or?.[1][0]).toContain('normalized_name.ilike')
  })

  it('maps a null balance without turning it into zero', async () => {
    const { client } = queryClient({
      data: [
        {
          id: 'p-1',
          sku: 'BERAS-5',
          name: 'Beras 5 kg',
          stock_on_hand: null,
          stock_version: '7',
          low_stock_threshold: 2,
          is_active: true,
          import_review_status: 'stock_unknown',
          categories: { name: 'Sembako' },
          units_of_measure: { label: 'Karung', decimal_scale: 0 },
        },
      ],
      error: null,
      count: 1,
    })

    const result = await listStockBalances(client, {
      search: '',
      state: 'all',
      page: 1,
      pageSize: 25,
    })

    expect(result.total).toBe(1)
    expect(result.rows[0]).toMatchObject({
      sku: 'BERAS-5',
      stockOnHand: null,
      stockVersion: 7,
      categoryName: 'Sembako',
      unitLabel: 'Karung',
    })
  })

  it('throws a translated permission error', async () => {
    const { client } = queryClient({
      data: null,
      error: { message: 'permission denied for table products' },
      count: null,
    })

    await expect(listStockBalances(client, {
      search: '',
      state: 'all',
      page: 1,
      pageSize: 25,
    })).rejects.toThrow('Anda tidak memiliki izin untuk melihat data inventaris.')
  })
})

describe('listStockMovements', () => {
  it('filters the embedded product, type, and date range', async () => {
    const { client, calls } = queryClient({ data: [], error: null, count: 0 })

    await listStockMovements(client, {
      productSearch: 'beras',
      movementType: 'sale_out',
      dateFrom: '2026-11-01',
      dateTo: '2026-11-04',
      page: 1,
      pageSize: 25,
    })

    expect(calls).toContainEqual(['eq', ['movement_type', 'sale_out']])
    expect(calls).toContainEqual(['gte', ['created_at', '2026-11-01T00:00:00+07:00']])
    expect(calls).toContainEqual(['lte', ['created_at', '2026-11-04T23:59:59.999+07:00']])
    expect(calls).toContainEqual(['or', [expect.any(String), { referencedTable: 'products' }]])
  })

  it('maps before/after quantities and the actor fallback', async () => {
    const { client } = queryClient({
      data: [
        {
          id: '12',
          product_id: 'p-1',
          movement_type: 'sale_out',
          quantity_delta: -2,
          quantity_before: 10,
          quantity_after: 8,
          transaction_id: 't-1',
          stock_opname_id: null,
          reason_code: null,
          reason_note: null,
          actor_id: 'abcdefgh-0000-0000-0000-000000000000',
          created_at: '2026-11-04T10:00:00Z',
          products: productEmbed,
          actor: null,
        },
      ],
      error: null,
      count: 1,
    })

    const result = await listStockMovements(client, {
      productSearch: '',
      movementType: '',
      dateFrom: '',
      dateTo: '',
      page: 1,
      pageSize: 25,
    }, 'someone-else')

    expect(result.rows[0]).toMatchObject({
      id: 12,
      quantityDelta: -2,
      quantityBefore: 10,
      quantityAfter: 8,
      transactionId: 't-1',
      actorLabel: 'Staf abcdefgh',
      unitLabel: 'Karung',
    })
  })

  it('keeps a null before-quantity for an opening balance', async () => {
    const { client } = queryClient({
      data: [
        {
          id: 1,
          product_id: 'p-1',
          movement_type: 'opening_balance',
          quantity_delta: 5,
          quantity_before: null,
          quantity_after: 5,
          transaction_id: null,
          stock_opname_id: 'o-1',
          reason_code: 'opening_balance',
          reason_note: 'Hitung awal',
          actor_id: 'u-1',
          created_at: '2026-11-04T10:00:00Z',
          products: productEmbed,
          actor: { full_name: 'Siti' },
        },
      ],
      error: null,
      count: 1,
    })

    const result = await listStockMovements(client, {
      productSearch: '',
      movementType: '',
      dateFrom: '',
      dateTo: '',
      page: 1,
      pageSize: 25,
    })

    expect(result.rows[0]?.quantityBefore).toBeNull()
    expect(result.rows[0]?.actorLabel).toBe('Siti')
    expect(result.rows[0]?.stockOpnameId).toBe('o-1')
  })

  it('falls back when the product relation is missing', async () => {
    const { client } = queryClient({
      data: [
        {
          id: 2,
          product_id: 'p-2',
          movement_type: 'manual_adjustment',
          quantity_delta: 1,
          quantity_before: 0,
          quantity_after: 1,
          transaction_id: null,
          stock_opname_id: null,
          reason_code: 'other',
          reason_note: 'Koreksi',
          actor_id: 'u-1',
          created_at: '2026-11-04T10:00:00Z',
          products: null,
          actor: null,
        },
      ],
      error: null,
      count: 1,
    })

    const result = await listStockMovements(client, {
      productSearch: '',
      movementType: '',
      dateFrom: '',
      dateTo: '',
      page: 1,
      pageSize: 25,
    })

    expect(result.rows[0]).toMatchObject({
      sku: '—',
      productName: 'Produk tidak ditemukan',
      decimalScale: 0,
    })
  })
})

describe('listStockDiscrepancies', () => {
  it('filters by reason and date', async () => {
    const { client, calls } = queryClient({ data: [], error: null, count: 0 })

    await listStockDiscrepancies(client, {
      productSearch: '',
      reasonCode: 'missing',
      dateFrom: '2026-11-01',
      dateTo: '',
      page: 1,
      pageSize: 25,
    })

    expect(calls).toContainEqual(['eq', ['reason_code', 'missing']])
    expect(calls).toContainEqual(['gte', ['created_at', '2026-11-01T00:00:00+07:00']])
  })

  it('maps creator and approver names', async () => {
    const { client } = queryClient({
      data: [
        {
          id: 3,
          stock_opname_item_id: 'i-1',
          revision: 2,
          product_id: 'p-1',
          system_qty: 10,
          physical_qty: 7,
          difference_qty: -3,
          reason_code: 'missing',
          reason_note: null,
          created_by: 'u-1',
          approved_by: 'u-2',
          created_at: '2026-11-04T10:00:00Z',
          products: productEmbed,
          creator: { full_name: 'Siti' },
          approver: { full_name: 'Pak Soleha' },
        },
      ],
      error: null,
      count: 1,
    })

    const result = await listStockDiscrepancies(client, {
      productSearch: '',
      reasonCode: '',
      dateFrom: '',
      dateTo: '',
      page: 1,
      pageSize: 25,
    })

    expect(result.rows[0]).toMatchObject({
      revision: 2,
      differenceQty: -3,
      createdByLabel: 'Siti',
      approvedByLabel: 'Pak Soleha',
    })
  })

  it('leaves the approver empty when the log is not approved yet', async () => {
    const { client } = queryClient({
      data: [
        {
          id: 4,
          stock_opname_item_id: 'i-2',
          revision: 1,
          product_id: 'p-1',
          system_qty: 0,
          physical_qty: 2,
          difference_qty: 2,
          reason_code: 'unrecorded_in',
          reason_note: null,
          created_by: 'u-1',
          approved_by: null,
          created_at: '2026-11-04T10:00:00Z',
          products: productEmbed,
          creator: { full_name: 'Siti' },
          approver: null,
        },
      ],
      error: null,
      count: 1,
    })

    const result = await listStockDiscrepancies(client, {
      productSearch: '',
      reasonCode: '',
      dateFrom: '',
      dateTo: '',
      page: 1,
      pageSize: 25,
    })

    expect(result.rows[0]?.approvedBy).toBeNull()
    expect(result.rows[0]?.approvedByLabel).toBeNull()
  })
})
