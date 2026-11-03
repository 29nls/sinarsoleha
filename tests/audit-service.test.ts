import { describe, expect, it, vi } from 'vitest'
import { listAuditLogs } from '../app/services/audit'
import {
  auditActionLabel,
  auditCsv,
  describeAuditError,
  emptyAuditFilters,
  summarizeAuditData,
} from '../app/types/audit'

type Result = { data: unknown; error: unknown; count?: number | null }

function queryClient(result: Result) {
  const calls: Array<[string, unknown[]]> = []
  const builder: Record<string, unknown> = {}
  const record = (name: string) => (...args: unknown[]) => {
    calls.push([name, args])
    return builder
  }
  for (const method of ['select', 'order', 'eq', 'gte', 'lte', 'range']) {
    builder[method] = record(method)
  }
  builder.returns = vi.fn().mockResolvedValue(result)

  return { client: { from: vi.fn().mockReturnValue(builder) } as never, calls }
}

const auditRow = {
  id: 12,
  actor_id: '11111111-2222-3333-4444-555555555555',
  action_key: 'product.cost_update',
  entity_name: 'product_costs',
  entity_id: 'prod-1',
  before_data: { purchase_cost: 1000 },
  after_data: { purchase_cost: 1500 },
  reason: null,
  created_at: '2026-11-04T04:05:06Z',
  actor: { full_name: 'Siti Aminah' },
}

describe('listAuditLogs', () => {
  it('applies the indexed filters, newest first, and paginates', async () => {
    const { client, calls } = queryClient({ data: [], error: null, count: 0 })

    await listAuditLogs(client, {
      actionKey: 'sale.void',
      entityName: 'transactions',
      dateFrom: '2026-11-01',
      dateTo: '2026-11-04',
      page: 2,
      pageSize: 50,
    })

    expect(calls).toContainEqual(['eq', ['action_key', 'sale.void']])
    expect(calls).toContainEqual(['eq', ['entity_name', 'transactions']])
    expect(calls).toContainEqual(['gte', ['created_at', '2026-11-01T00:00:00+07:00']])
    expect(calls).toContainEqual(['lte', ['created_at', '2026-11-04T23:59:59.999+07:00']])
    expect(calls).toContainEqual(['order', ['created_at', { ascending: false }]])
    expect(calls).toContainEqual(['range', [50, 99]])
  })

  it('omits empty filters rather than sending blank equality matches', async () => {
    const { client, calls } = queryClient({ data: [], error: null, count: 0 })

    await listAuditLogs(client, { ...emptyAuditFilters(), page: 1, pageSize: 50 })

    expect(calls.some(([name]) => name === 'eq')).toBe(false)
    expect(calls.some(([name]) => name === 'gte' || name === 'lte')).toBe(false)
  })

  it('maps the actor name and keeps an orphaned actor identifiable', async () => {
    const { client } = queryClient({
      data: [
        auditRow,
        { ...auditRow, id: 13, actor: null, actor_id: '99999999-0000-0000-0000-000000000000' },
        { ...auditRow, id: 14, actor: null, actor_id: null },
      ],
      error: null,
      count: 3,
    })

    const result = await listAuditLogs(client, { ...emptyAuditFilters(), page: 1, pageSize: 50 })

    expect(result.total).toBe(3)
    expect(result.rows[0]).toMatchObject({
      id: 12,
      actorLabel: 'Siti Aminah',
      actionKey: 'product.cost_update',
      afterData: { purchase_cost: 1500 },
    })
    expect(result.rows[1]?.actorLabel).toBe('Staf 99999999')
    expect(result.rows[2]?.actorLabel).toBe('Sistem')
  })

  it('refuses to show the raw RLS message', async () => {
    const { client } = queryClient({
      data: null,
      error: { message: 'new row violates row-level security policy' },
    })

    await expect(
      listAuditLogs(client, { ...emptyAuditFilters(), page: 1, pageSize: 50 }),
    ).rejects.toThrow('Hanya owner yang dapat membaca audit log.')
  })
})

describe('audit helpers', () => {
  it('labels known actions and falls back to the raw key', () => {
    expect(auditActionLabel('sale.void')).toBe('Batalkan penjualan')
    expect(auditActionLabel('future.action')).toBe('future.action')
  })

  it('summarises JSON and never renders null as an empty string', () => {
    expect(summarizeAuditData(null)).toBe('—')
    expect(summarizeAuditData('teks')).toBe('teks')
    expect(summarizeAuditData({ a: 1 })).toBe('{"a":1}')
    expect(summarizeAuditData({ a: 'x'.repeat(300) })).toHaveLength(158)
  })

  it('writes a CSV with a header and one line per audit row', () => {
    const csv = auditCsv([
      {
        id: 1,
        actorId: auditRow.actor_id,
        actorLabel: 'Siti, Aminah',
        actionKey: 'sale.void',
        entityName: 'transactions',
        entityId: 'SS-1',
        reason: null,
        createdAt: '2026-11-04T04:05:06Z',
        beforeData: null,
        afterData: { status: 'void' },
      },
    ])

    const lines = csv.split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(
      'Waktu,Pelaku,Aksi,Entitas,ID entitas,Alasan,Data sesudah',
    )
    expect(lines[1]).toContain('"Siti, Aminah"')
    // Quotes inside the cell are doubled by the shared CSV writer.
    expect(lines[1]).toContain('"{""status"":""void""}"')
  })

  it('explains an expired session', () => {
    expect(describeAuditError('JWT expired')).toBe('Sesi Anda berakhir. Masuk kembali.')
  })
})
