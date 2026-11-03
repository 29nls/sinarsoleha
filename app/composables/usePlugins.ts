import { computed, shallowRef } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'
import type { FeatureFlag, PluginKey, PublicConfig } from '~/types/plugins'
import { PLUGIN_DEFINITIONS } from '~/types/plugins'
import { loadFeatureFlags, saveFeatureFlag } from '~/services/settings'
import { createPluginRegistry, defaultFlags, type PluginRegistry } from '~/adapters/registry'

type Client = SupabaseClient<Database>

/**
 * Shared feature-flag state. The cashier reads flags once per session and the
 * settings page updates the same state after a save, so a toggle takes effect
 * without a reload. Failure to load is not fatal: every plugin stays OFF and
 * the POS core keeps working.
 */
export function usePlugins() {
  const client = useSupabaseClient()
  const flags = useState<FeatureFlag[]>('plugins:flags', () => defaultFlags())
  const loading = useState<boolean>('plugins:loading', () => false)
  const error = useState<string | null>('plugins:error', () => null)
  const initialized = useState<boolean>('plugins:initialized', () => false)
  const saving = shallowRef<PluginKey | null>(null)

  const registry = computed<PluginRegistry>(() => createPluginRegistry(flags.value))

  const byKey = computed(() => {
    const map = new Map<PluginKey, FeatureFlag>()
    for (const flag of flags.value) map.set(flag.key, flag)
    return map
  })

  function flagFor(key: PluginKey): FeatureFlag {
    return byKey.value.get(key) ?? { key, enabled: false, publicConfig: {}, updatedAt: null }
  }

  function isEnabled(key: PluginKey): boolean {
    return flagFor(key).enabled
  }

  async function load(force = false): Promise<void> {
    if (initialized.value && !force) return
    loading.value = true
    error.value = null
    try {
      flags.value = await loadFeatureFlags(client as Client)
      initialized.value = true
    } catch (cause) {
      // Keep the safe default: OFF for every optional integration.
      flags.value = defaultFlags()
      error.value = cause instanceof Error ? cause.message : 'Gagal memuat pengaturan fitur.'
    } finally {
      loading.value = false
    }
  }

  async function save(
    key: PluginKey,
    enabled: boolean,
    config: PublicConfig,
  ): Promise<boolean> {
    saving.value = key
    error.value = null
    try {
      const updated = await saveFeatureFlag(client as Client, key, enabled, config)
      flags.value = flags.value.map((flag) => (flag.key === key ? updated : flag))
      return true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Gagal menyimpan pengaturan.'
      return false
    } finally {
      saving.value = null
    }
  }

  const definitions = PLUGIN_DEFINITIONS

  return {
    flags,
    definitions,
    loading,
    saving,
    error,
    initialized,
    registry,
    flagFor,
    isEnabled,
    load,
    save,
  }
}
