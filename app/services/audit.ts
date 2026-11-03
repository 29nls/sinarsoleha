import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'
import type { AuditListResult, AuditParams, AuditRow } from '~/types/audit'
import { describeAuditError } from '~/types/audit'
import { endOfJakartaDay, startOfJakartaDay } from '~/types/inventory'

type Client = SupabaseClient<Database>

const AUDIT_SELECT =
  'id, actor_id, action_key, entity_name, entity_id, before_data, after_data, reason, created_at, actor:profiles!audit_logs_actor_id_fkey(full_name)'

interface AuditSelectRow {
  id: number
  actor_id: string | null
  action_key: string
  entity_name: string
  entity_id: string | null
  before_data: unknown
  after_data: unknown
  reason: string | null
  created_at: string
  actor: { full_name: string } | null
}

/** Entity names actually written by `private.write_audit`. */
export const AUDIT_ENTITIES = [
  'categories',
  'feature_flags',
  'product_costs',
  'product_import_runs',
  'products',
  'profiles',
  'stock_opnames',
  'transactions',
] as const

function fail(error: { message: string }): never {
  throw new Error(describeAuditError(error.message))
}

/**
 * Owner-only read of the append-only audit table. Filters are the indexed
 * columns (`created_at`, `action_key`, `entity_name`) so paging stays cheap.
 */
export async function listAuditLogs(
  client: Client,
  params: AuditParams,
): Promise<AuditListResult> {
  let query = client
    .from('audit_logs')
    .select(AUDIT_SELECT, { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })

  if (params.actionKey) query = query.eq('action_key', params.actionKey)
  if (params.entityName) query = query.eq('entity_name', params.entityName)
  if (params.dateFrom) query = query.gte('created_at', startOfJakartaDay(params.dateFrom))
  if (params.dateTo) query = query.lte('created_at', endOfJakartaDay(params.dateTo))

  const from = (params.page - 1) * params.pageSize
  query = query.range(from, from + params.pageSize - 1)

  const { data, error, count } = await query.returns<AuditSelectRow[]>()
  if (error) fail(error)

  return {
    rows: (data ?? []).map((row) => ({
      id: Number(row.id),
      actorId: row.actor_id,
      actorLabel: row.actor?.full_name ?? (row.actor_id ? `Staf ${row.actor_id.slice(0, 8)}` : 'Sistem'),
      actionKey: row.action_key,
      entityName: row.entity_name,
      entityId: row.entity_id,
      reason: row.reason,
      createdAt: row.created_at,
      beforeData: row.before_data,
      afterData: row.after_data,
    })),
    total: count ?? 0,
  }
}
