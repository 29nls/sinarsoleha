<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { PluginKey, PublicConfig } from '~/types/plugins'
import { PLUGIN_DEFINITION_BY_KEY, PLUGIN_DEFINITIONS } from '~/types/plugins'
import { usePlugins } from '~/composables/usePlugins'
import PluginCard from '~/components/settings/PluginCard.vue'

definePageMeta({ capability: 'settings.manage' })
useHead({ title: 'Pengaturan · Toko Sinar Soleha POS' })

const { registry, flagFor, loading, saving, error, load, save } = usePlugins()

const notice = ref<string | null>(null)
const noticeError = ref(false)
const health = ref<Partial<Record<PluginKey, string>>>({})

const cards = computed(() =>
  PLUGIN_DEFINITIONS.map((definition) => {
    const adapter = registry.value.get(definition.key)
    return {
      definition,
      flag: flagFor(definition.key),
      status: adapter?.status ?? 'off',
      adapterLabel: adapter?.describe() ?? 'Adapter belum tersedia',
      healthMessage: health.value[definition.key] ?? fallbackHealth(definition.key),
    }
  }),
)

function fallbackHealth(key: PluginKey): string {
  if (key === 'payment.qris_gateway') {
    return 'SPA tanpa server Nitro: charge dinamis tidak dijalankan dari browser.'
  }
  if (key === 'hardware.thermal_printer') {
    return 'Cetak memakai dialog browser perangkat ini.'
  }
  return 'Scanner keyboard-wedge bekerja di kolom pencarian kasir tanpa driver tambahan.'
}

/** Runs the real adapter lifecycle so the card reports its own health. */
async function refreshHealth(): Promise<void> {
  const entries = await Promise.all(
    PLUGIN_DEFINITIONS.map(async (definition) => {
      const adapter = registry.value.get(definition.key)
      if (!adapter) return [definition.key, 'Adapter belum tersedia.'] as const
      try {
        await adapter.initialize()
        const result = await adapter.healthCheck()
        return [definition.key, result.message] as const
      } catch {
        return [definition.key, 'Adapter gagal melakukan pemeriksaan awal.'] as const
      }
    }),
  )
  health.value = Object.fromEntries(entries) as Partial<Record<PluginKey, string>>
}

async function handleSave(key: PluginKey, enabled: boolean, config: PublicConfig): Promise<void> {
  notice.value = null
  noticeError.value = false
  const ok = await save(key, enabled, config)
  if (ok) {
    const label = PLUGIN_DEFINITION_BY_KEY[key].label
    notice.value = `${label} ${enabled ? 'diaktifkan' : 'dinonaktifkan'}. Perubahan dicatat di audit log.`
    await refreshHealth()
  } else {
    noticeError.value = true
    notice.value = error.value ?? 'Gagal menyimpan pengaturan.'
  }
}

onMounted(async () => {
  await load(true)
  await refreshHealth()
})
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-lg font-semibold tracking-tight">Pengaturan</h1>
      <p class="text-[12px] text-[var(--color-muted)]">
        Fitur opsional yang tidak mengubah perhitungan transaksi. Semua plugin default nonaktif dan
        POS inti tetap berjalan saat adapter dimatikan atau gagal. Hanya owner yang dapat mengubah.
      </p>
    </div>

    <div v-if="error && !notice" class="notice notice-error" role="alert">{{ error }}</div>
    <div v-if="notice" :class="['notice', noticeError ? 'notice-error' : '']" role="status">
      {{ notice }}
    </div>

    <div v-if="loading" class="notice" role="status">Memuat pengaturan fitur…</div>

    <div class="grid gap-3 xl:grid-cols-2">
      <PluginCard
        v-for="card in cards"
        :key="card.definition.key"
        :definition="card.definition"
        :flag="card.flag"
        :status="card.status"
        :adapter-label="card.adapterLabel"
        :health-message="card.healthMessage"
        :saving="saving === card.definition.key"
        @save="(enabled, config) => handleSave(card.definition.key, enabled, config)"
      />
    </div>

    <section class="panel">
      <div class="panel-head">
        <h2 class="panel-title">Batas keamanan</h2>
      </div>
      <ul class="space-y-1.5 px-3 py-3 text-[12px] leading-relaxed">
        <li>
          <span class="font-semibold">Tanpa secret di browser.</span> Konfigurasi publik hanya memuat
          label non-rahasia; API key, signing key, dan webhook secret harus berada di server.
        </li>
        <li>
          <span class="font-semibold">Audit otomatis.</span> Setiap perubahan ditulis ke
          <code class="font-mono">audit_logs</code> oleh RPC owner-only, bukan oleh klien.
        </li>
        <li>
          <span class="font-semibold">Fallback selalu ada.</span> Nota tetap bisa dicetak lewat browser,
          SKU tetap bisa diketik, dan QRIS manual tetap tersedia.
        </li>
      </ul>
    </section>
  </div>
</template>
