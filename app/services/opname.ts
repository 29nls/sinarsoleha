import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'
import type {
  CountItemResult,
  CreateOpnameInput,
  OpnameDetail,
  OpnameItemContext,
  OpnameItemPageParams,
  OpnameItemPageResult,
  OpnameItemRow,
  OpnameListParams,
  OpnameListResult,
  OpnameListRow,
  OpnameSummary,
  PostOpnameResult,
} from '~/types/opname'
import { blockerCount, describeOpnameError } from '~/types/opname'

type Client = SupabaseClient<Database>

function fail(error: { message: string; details?: string | null }): never {
  // submit/approve raise OPNAME_INCOMPLETE with the blocker list in `details`;
  // a count is more actionable than the generic sentence.
  if (error.message.includes('OPNAME_INCOMPLETE')) {
    const blockers = blockerCount(error.details)
    if (blockers > 0) {
      throw new Error(`Masih ada ${blockers} item yang belum lengkap.`)
    }
  }
  throw new Error(describeOpnameError(error.message))
}

/** The RPCs return jsonb; supabase-js hands it back already parsed. */
function asObject(data: unknown): Record<string, unknown> {
  if (typeof data === 'string') return JSON.parse(data) as Record<string, unknown>
  return (data ?? {}) as Record<string, unknown>
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0)
}

function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined) return null
  return Number(value)
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function mapSummary(payload: Record<string, unknown>): OpnameSummary {
  return {
    opnameId: str(payload.opname_id),
    opnameNo: str(payload.opname_no),
    status: str(payload.status),
    scopeNote: nullableStr(payload.scope_note),
    submittedAt: nullableStr(payload.submitted_at),
    approvedAt: nullableStr(payload.approved_at),
    postedAt: nullableStr(payload.posted_at),
    cancelledAt: nullableStr(payload.cancelled_at),
    itemCount: num(payload.item_count),
    alreadyProcessed: payload.already_processed === true,
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createOpname(
  client: Client,
  input: CreateOpnameInput,
): Promise<OpnameSummary> {
  const payload: Record<string, unknown> = {
    idempotency_key: input.idempotencyKey,
  }
  if (input.scopeNote.trim()) payload.scope_note = input.scopeNote.trim()
  if (input.productIds.length > 0) payload.product_ids = input.productIds
  if (input.categoryId !== null) payload.category_id = input.categoryId
  if (input.excludeProductIds.length > 0) {
    payload.exclude_product_ids = input.excludeProductIds
  }

  const { data, error } = await client.rpc('create_stock_opname', {
    p_payload: payload as never,
  })
  if (error) fail(error)
  return mapSummary(asObject(data))
}

export async function recordOpnameCount(
  client: Client,
  itemId: string,
  physicalQty: number,
  reasonCode: string | null,
  reasonNote: string | null,
): Promise<CountItemResult> {
  // The generated signature types the reason fields as non-null strings; the
  // database normalises empty strings to NULL with `nullif(btrim(...))`.
  const { data, error } = await client.rpc('record_stock_opname_count', {
    p_stock_opname_item_id: itemId,
    p_physical_qty: physicalQty,
    p_reason_code: reasonCode ?? '',
    p_reason_note: reasonNote ?? '',
  })
  if (error) fail(error)

  const payload = asObject(data)
  return {
    itemId: str(payload.item_id),
    opnameId: str(payload.opname_id),
    productId: str(payload.product_id),
    systemQtySnapshot: nullableNum(payload.system_qty_snapshot),
    physicalQty: nullableNum(payload.physical_qty),
    differenceQty: nullableNum(payload.difference_qty),
    reasonCode: nullableStr(payload.reason_code),
    countStatus: str(payload.count_status),
    countedBy: nullableStr(payload.counted_by),
    countedAt: nullableStr(payload.counted_at),
  }
}

export async function submitOpname(client: Client, opnameId: string): Promise<OpnameSummary> {
  const { data, error } = await client.rpc('submit_stock_opname', { p_opname_id: opnameId })
  if (error) fail(error)
  return mapSummary(asObject(data))
}

export async function approveOpname(client: Client, opnameId: string): Promise<OpnameSummary> {
  const { data, error } = await client.rpc('approve_stock_opname', { p_opname_id: opnameId })
  if (error) fail(error)
  return mapSummary(asObject(data))
}

export async function postOpname(client: Client, opnameId: string): Promise<PostOpnameResult> {
  const { data, error } = await client.rpc('post_stock_opname', { p_opname_id: opnameId })
  if (error) fail(error)

  const payload = asObject(data)
  const conflicts = Array.isArray(payload.conflicts)
    ? (payload.conflicts as PostOpnameResult['conflicts'])
    : []

  return {
    ...mapSummary(payload),
    result: payload.result === 'version_conflict' ? 'version_conflict' : 'posted',
    conflicts,
    unchangedCount: num(payload.unchanged_count),
    openingBalanceCount: num(payload.opening_balance_count),
    discrepancyCount: num(payload.discrepancy_count),
    deltaTotal: num(payload.delta_total),
  }
}

export async function cancelOpname(
  client: Client,
  opnameId: string,
  reason: string,
): Promise<OpnameSummary> {
  const { data, error } = await client.rpc('cancel_stock_opname', {
    p_opname_id: opnameId,
    p_reason: reason.trim(),
  })
  if (error) fail(error)
  return mapSummary(asObject(data))
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const LIST_SELECT =
  'id, opname_no, status, scope_note, created_at, submitted_at, approved_at, posted_at, cancelled_at, stock_opname_items(count_status)'

interface OpnameListQueryRow {
  id: string
  opname_no: string
  status: string
  scope_note: string | null
  created_at: string
  submitted_at: string | null
  approved_at: string | null
  posted_at: string | null
  cancelled_at: string | null
  stock_opname_items: Array<{ count_status: string }> | null
}

export async function listOpnames(
  client: Client,
  params: OpnameListParams,
): Promise<OpnameListResult> {
  let query = client
    .from('stock_opnames')
    .select(LIST_SELECT, { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })

  if (params.status) {
    query = query.eq('status', params.status)
  }
  if (params.search.trim()) {
    query = query.ilike('opname_no', `%${escapeLike(params.search.trim())}%`)
  }

  const from = (params.page - 1) * params.pageSize
  query = query.range(from, from + params.pageSize - 1)

  const { data, error, count } = await query.returns<OpnameListQueryRow[]>()
  if (error) fail(error)

  const rows = (data ?? []).map((row): OpnameListRow => {
    const items = row.stock_opname_items ?? []
    return {
      id: row.id,
      opnameNo: row.opname_no,
      status: row.status,
      scopeNote: row.scope_note,
      createdAt: row.created_at,
      submittedAt: row.submitted_at,
      approvedAt: row.approved_at,
      postedAt: row.posted_at,
      cancelledAt: row.cancelled_at,
      itemCount: items.length,
      countedCount: items.filter((item) => item.count_status !== 'pending').length,
      recountCount: items.filter((item) => item.count_status === 'needs_recount').length,
    }
  })

  return { rows, total: count ?? 0 }
}

/**
 * Session header plus global counters.
 *
 * This used to embed every item in one PostgREST request, which silently lost
 * rows past the 1,000-row cap and made every counter depend on the truncation.
 * The summary RPC aggregates in the database instead, so the numbers describe
 * the whole session no matter how many items it holds.
 */
export async function getOpnameDetail(client: Client, opnameId: string): Promise<OpnameDetail> {
  const { data, error } = await client.rpc('get_stock_opname_summary', {
    p_opname_id: opnameId,
  })
  if (error) fail(error)

  const payload = asObject(data)
  return {
    id: str(payload.opname_id),
    opnameNo: str(payload.opname_no),
    status: str(payload.status),
    scopeNote: nullableStr(payload.scope_note),
    createdAt: str(payload.created_at),
    submittedAt: nullableStr(payload.submitted_at),
    approvedAt: nullableStr(payload.approved_at),
    postedAt: nullableStr(payload.posted_at),
    cancelledAt: nullableStr(payload.cancelled_at),
    cancelledReason: nullableStr(payload.cancelled_reason),
    itemCount: num(payload.item_count),
    pendingCount: num(payload.pending_count),
    countedCount: num(payload.counted_count),
    needsRecountCount: num(payload.needs_recount_count),
    postedCount: num(payload.posted_count),
    openingBalanceCount: num(payload.opening_balance_count),
    matchingCount: num(payload.matching_count),
    discrepancyCount: num(payload.discrepancy_count),
    blockerCount: num(payload.blocker_count),
    readyForSubmit: payload.ready_for_submit === true,
  }
}

function mapItem(payload: Record<string, unknown>): OpnameItemRow {
  return {
    id: str(payload.id),
    productId: str(payload.product_id),
    sku: str(payload.sku) || '—',
    productName: str(payload.product_name) || 'Produk tidak ditemukan',
    unitLabel: str(payload.unit_label),
    decimalScale: num(payload.decimal_scale),
    isActive: payload.is_active === true,
    systemQtySnapshot: nullableNum(payload.system_qty_snapshot),
    physicalQty: nullableNum(payload.physical_qty),
    differenceQty: nullableNum(payload.difference_qty),
    reasonCode: nullableStr(payload.reason_code),
    reasonNote: nullableStr(payload.reason_note),
    countStatus: str(payload.count_status),
    countedAt: nullableStr(payload.counted_at),
  }
}

/**
 * One page of items, ordered by SKU with the item id as tie-breaker.
 *
 * The order is decided by the database: `products.sku` does not live on
 * `stock_opname_items`, and ordering the page in the browser would only sort
 * the rows that happened to arrive.
 */
export async function getOpnameItemsPage(
  client: Client,
  opnameId: string,
  params: OpnameItemPageParams,
): Promise<OpnameItemPageResult> {
  const offset = (params.page - 1) * params.pageSize
  const { data, error } = await client.rpc('list_stock_opname_items', {
    p_opname_id: opnameId,
    p_limit: params.pageSize,
    p_offset: offset,
    p_filter: params.filter,
    p_search: params.search.trim() || undefined,
  })
  if (error) fail(error)

  const payload = asObject(data)
  const rawItems = Array.isArray(payload.items) ? payload.items : []

  return {
    items: rawItems.map((item) => mapItem(asObject(item))),
    total: num(payload.total),
    page: params.page,
    pageSize: params.pageSize,
  }
}

/**
 * Snapshot versus live product state for one item, used by the recount dialog.
 * Advisory only: the count RPC rebases and returns the authoritative numbers.
 */
export async function getOpnameItemContext(
  client: Client,
  itemId: string,
): Promise<OpnameItemContext> {
  const { data, error } = await client.rpc('get_stock_opname_item_context', {
    p_item_id: itemId,
  })
  if (error) fail(error)

  const payload = asObject(data)
  return {
    itemId: str(payload.item_id),
    opnameId: str(payload.opname_id),
    opnameStatus: str(payload.opname_status),
    productId: str(payload.product_id),
    sku: str(payload.sku),
    productName: str(payload.product_name),
    isActive: payload.is_active === true,
    unitLabel: str(payload.unit_label),
    decimalScale: num(payload.decimal_scale),
    systemQtySnapshot: nullableNum(payload.system_qty_snapshot),
    stockVersionSnapshot: num(payload.stock_version_snapshot),
    currentQty: nullableNum(payload.current_qty),
    currentVersion: num(payload.current_version),
    physicalQty: nullableNum(payload.physical_qty),
    reasonCode: nullableStr(payload.reason_code),
    reasonNote: nullableStr(payload.reason_note),
    countStatus: str(payload.count_status),
    countedAt: nullableStr(payload.counted_at),
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}
