import { describe, expect, it } from 'vitest'
import {
  STOCK_EVENT,
  STOCK_TOPIC,
  applyStockBroadcast,
  parseStockBroadcast,
} from '../app/utils/stock'

const valid = {
  product_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sku: 'TES-001',
  stock_on_hand: 7,
  stock_version: 3,
}

describe('stock broadcast payload', () => {
  it('pins the topic and event used by the database trigger', () => {
    expect(STOCK_TOPIC).toBe('store:stock')
    expect(STOCK_EVENT).toBe('stock_changed')
  })

  it('parses a complete payload', () => {
    expect(parseStockBroadcast(valid)).toEqual({
      productId: valid.product_id,
      sku: valid.sku,
      stockOnHand: 7,
      stockVersion: 3,
    })
  })

  it('accepts numeric strings, as PostgREST may serialise numerics', () => {
    const parsed = parseStockBroadcast({ ...valid, stock_on_hand: '7.000', stock_version: '3' })
    expect(parsed?.stockOnHand).toBe(7)
    expect(parsed?.stockVersion).toBe(3)
  })

  it('ignores malformed messages instead of corrupting the cart', () => {
    for (const payload of [
      null,
      undefined,
      'store:stock',
      {},
      { ...valid, product_id: '' },
      { ...valid, sku: '   ' },
      { ...valid, stock_on_hand: null },
      { ...valid, stock_on_hand: -1 },
      { ...valid, stock_on_hand: 'banyak' },
      { ...valid, stock_version: -1 },
      { ...valid, stock_version: Number.NaN },
    ]) {
      expect(parseStockBroadcast(payload)).toBeNull()
    }
  })

  it('keeps unknown payload keys out of the result', () => {
    const parsed = parseStockBroadcast({ ...valid, purchase_cost: 3000, customer_id: 'x' })
    expect(parsed && Object.keys(parsed).sort()).toEqual([
      'productId',
      'sku',
      'stockOnHand',
      'stockVersion',
    ])
  })
})

describe('applying a stock broadcast', () => {
  const rows = [
    { id: 'p1', sku: 'A', stockOnHand: 10 },
    { id: 'p2', sku: 'B', stockOnHand: 4 },
  ]

  it('patches only the matching row and keeps the other fields', () => {
    const { rows: next, changed } = applyStockBroadcast(rows, {
      productId: 'p1',
      sku: 'A',
      stockOnHand: 6,
      stockVersion: 1,
    })
    expect(changed).toBe(1)
    expect(next[0]).toEqual({ id: 'p1', sku: 'A', stockOnHand: 6, stockVersion: 1 })
    expect(next[1]).toBe(rows[1])
  })

  it('returns the same array when nothing matches or nothing changes', () => {
    const unknown = applyStockBroadcast(rows, {
      productId: 'zzz',
      sku: 'Z',
      stockOnHand: 1,
      stockVersion: 1,
    })
    expect(unknown.rows).toBe(rows)
    expect(unknown.changed).toBe(0)

    const versioned = [{ ...rows[0]!, stockVersion: 2 }, rows[1]!]
    const same = applyStockBroadcast(versioned, {
      productId: 'p1',
      sku: 'A',
      stockOnHand: 10,
      stockVersion: 2,
    })
    expect(same.rows).toBe(versioned)
    expect(same.changed).toBe(0)
  })

  it('ignores an older version but accepts a newer one', () => {
    const versions = new Map([
      ['p1', 5],
      ['p2', 5],
    ])
    const versionOf = (row: { id: string }) => versions.get(row.id) ?? null

    const stale = applyStockBroadcast(
      rows,
      { productId: 'p1', sku: 'A', stockOnHand: 1, stockVersion: 4 },
      versionOf,
    )
    expect(stale.changed).toBe(0)

    const fresh = applyStockBroadcast(
      rows,
      { productId: 'p1', sku: 'A', stockOnHand: 1, stockVersion: 6 },
      versionOf,
    )
    expect(fresh.changed).toBe(1)
    expect(fresh.rows[0]?.stockOnHand).toBe(1)
  })
})
