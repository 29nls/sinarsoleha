import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'
import type { FeatureFlag, FeatureFlagRow, PluginKey, PublicConfig } from '~/types/plugins'
import {
  PLUGIN_DEFINITION_BY_KEY,
  PLUGIN_KEYS,
  parseFeatureFlag,
  sanitizePublicConfig,
} from '~/types/plugins'

type Client = SupabaseClient<Database>

export function describeSettingsError(message: string): string {
  const normalized = message.toLowerCase()
  if (normalized.includes('row-level security') || normalized.includes('permission denied')) {
    return 'Hanya owner yang dapat mengubah pengaturan fitur.'
  }
  if (normalized.includes('feature_not_found')) {
    return 'Fitur tidak ditemukan. Muat ulang halaman pengaturan.'
  }
  if (normalized.includes('invalid_config')) {
    return 'Konfigurasi tidak valid: harus berupa objek JSON.'
  }
  if (normalized.includes('owner_required') || normalized.includes('forbidden')) {
    return 'Hanya owner yang dapat mengubah pengaturan fitur.'
  }
  return message
}

/**
 * Staff can read `feature_flags` (RLS allows select), which is how the cashier
 * learns whether an adapter is on. Unknown keys are ignored so a future flag
 * cannot leak into this UI.
 */
export async function loadFeatureFlags(client: Client): Promise<FeatureFlag[]> {
  const { data, error } = await client
    .from('feature_flags')
    .select('feature_key, enabled, public_config, updated_at, updated_by')
    .order('feature_key', { ascending: true })
    .returns<FeatureFlagRow[]>()

  if (error) throw new Error(describeSettingsError(error.message))

  const parsed = new Map<PluginKey, FeatureFlag>()
  for (const row of data ?? []) {
    const flag = parseFeatureFlag(row)
    if (flag) parsed.set(flag.key, flag)
  }

  // A missing row must read as OFF, never as "assume enabled".
  return PLUGIN_KEYS.map(
    (key) =>
      parsed.get(key) ?? {
        key,
        enabled: false,
        publicConfig: {},
        updatedAt: null,
      },
  )
}

/**
 * Writes go through the owner-only SECURITY DEFINER RPC, which also writes an
 * audit row. The browser never updates the table directly.
 */
export async function saveFeatureFlag(
  client: Client,
  key: PluginKey,
  enabled: boolean,
  config: PublicConfig,
): Promise<FeatureFlag> {
  const definition = PLUGIN_DEFINITION_BY_KEY[key]
  const sanitized = sanitizePublicConfig(definition, config)

  const { data, error } = await client.rpc('set_feature_flag', {
    p_feature_key: key,
    p_enabled: enabled,
    p_public_config: sanitized as never,
  })
  if (error) throw new Error(describeSettingsError(error.message))

  const row = (typeof data === 'string' ? JSON.parse(data) : data) as FeatureFlagRow
  const parsed = parseFeatureFlag(row)
  if (!parsed) throw new Error('Respons pengaturan tidak dikenali. Muat ulang halaman.')
  return parsed
}
