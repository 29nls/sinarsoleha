/**
 * Realtime stock payload helpers (POS-03, NFR-04, ADR-009).
 *
 * The broadcast payload is deliberately tiny: product identity plus balance.
 * Everything here is pure so the parsing rules can be unit-tested without a
 * websocket, and so a malformed or hostile message can never reach the cart as
 * anything other than "ignore".
 */

export const STOCK_TOPIC = 'store:stock'
export const STOCK_EVENT = 'stock_changed'

export interface StockBroadcast {
  productId: string
  sku: string
  stockOnHand: number
  stockVersion: number
}

/** Minimal shape the cart/search rows must expose to be patched. */
export interface StockPatchable {
  id: string
  stockOnHand: number | null
  stockVersion?: number
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * Reads one broadcast message. Returns null for anything that is not a
 * complete, sane stock event. A wrong shape is ignored on purpose: the cart
 * keeps its previous balance until the next refetch, instead of showing NaN or
 * a negative stock that never existed in the database.
 */
export function parseStockBroadcast(payload: unknown): StockBroadcast | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>

  const productId = typeof record.product_id === 'string' ? record.product_id.trim() : ''
  const sku = typeof record.sku === 'string' ? record.sku.trim() : ''
  const stockOnHand = toFiniteNumber(record.stock_on_hand)
  const stockVersion = toFiniteNumber(record.stock_version)

  if (!productId || !sku) return null
  if (stockOnHand === null || stockOnHand < 0) return null
  if (stockVersion === null || stockVersion < 0) return null

  return { productId, sku, stockOnHand, stockVersion }
}

export interface StockPatchResult<T> {
  rows: T[]
  changed: number
}

/**
 * Applies a broadcast to a list of rows by product id. The row keeps every
 * other field (price, name, unit) because only availability changed. A newer
 * `stockVersion` always wins, and an older/equal version is dropped so a
 * delayed message cannot roll the display back.
 */
export function applyStockBroadcast<T extends StockPatchable>(
  rows: T[],
  event: StockBroadcast,
  versionOf?: (row: T) => number | null,
): StockPatchResult<T> {
  let changed = 0
  const next = rows.map((row) => {
    if (row.id !== event.productId) return row
    if (versionOf) {
      const current = versionOf(row)
      if (current !== null && current >= event.stockVersion) return row
    }
    const sameVersion = row.stockVersion === event.stockVersion
    if (row.stockOnHand === event.stockOnHand && sameVersion) return row
    changed += 1
    return { ...row, stockOnHand: event.stockOnHand, stockVersion: event.stockVersion }
  })
  return { rows: changed === 0 ? rows : next, changed }
}
