<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { FeatureFlag, PluginDefinition, PublicConfig } from '~/types/plugins'
import { defaultPublicConfig } from '~/types/plugins'
import type { AdapterStatus } from '~/adapters/contracts'
import { statusLabel } from '~/adapters/contracts'

const props = defineProps<{
  definition: PluginDefinition
  flag: FeatureFlag
  status: AdapterStatus
  adapterLabel: string
  healthMessage: string
  saving: boolean
}>()

const emit = defineEmits<{
  save: [enabled: boolean, config: PublicConfig]
}>()

const enabled = ref(props.flag.enabled)
const draft = ref<Record<string, string>>({})
const localError = ref<string | null>(null)

function resetDraft(): void {
  const base = { ...defaultPublicConfig(props.definition), ...props.flag.publicConfig }
  const next: Record<string, string> = {}
  for (const field of props.definition.configFields) {
    const value = base[field.key]
    next[field.key] = value === undefined ? '' : String(value)
  }
  draft.value = next
}

watch(() => props.flag, () => {
  enabled.value = props.flag.enabled
  resetDraft()
  localError.value = null
}, { immediate: true, deep: true })

// A failed save leaves the stored flag untouched, so the toggle must snap back
// to the real state instead of showing an unsaved value. The config draft is
// kept so the owner can correct and retry.
watch(() => props.saving, (isSaving) => {
  if (!isSaving && enabled.value !== props.flag.enabled) enabled.value = props.flag.enabled
})

const statusClass = computed(() => {
  if (props.status === 'ready') return 'tag-accent'
  if (props.status === 'error' || props.status === 'unavailable') return 'tag-warn'
  return ''
})

function submit(): void {
  localError.value = null
  const config: PublicConfig = {}

  for (const field of props.definition.configFields) {
    const raw = (draft.value[field.key] ?? '').trim()
    if (!raw) continue
    if (field.kind === 'number') {
      const parsed = Number(raw)
      if (!Number.isFinite(parsed) || parsed < 0) {
        localError.value = `${field.label} harus berupa angka dan tidak boleh negatif.`
        return
      }
      config[field.key] = Math.round(parsed)
      continue
    }
    if (field.kind === 'select' && field.options && !field.options.includes(raw)) {
      localError.value = `${field.label} tidak valid.`
      return
    }
    if (field.maxLength && raw.length > field.maxLength) {
      localError.value = `${field.label} maksimal ${field.maxLength} karakter.`
      return
    }
    config[field.key] = raw
  }

  emit('save', enabled.value, config)
}
</script>

<template>
  <section class="panel" :aria-labelledby="`plugin-${definition.key}-title`">
    <div class="panel-head">
      <div class="min-w-0">
        <h2 :id="`plugin-${definition.key}-title`" class="text-[13px] font-semibold">
          {{ definition.label }}
        </h2>
        <p class="font-mono text-[11px] text-[var(--color-muted)]">{{ definition.key }}</p>
      </div>
      <span :class="['tag', statusClass]">{{ statusLabel(status) }}</span>
    </div>

    <div class="space-y-3 px-3 py-3">
      <p class="text-[12px] leading-relaxed">{{ definition.summary }}</p>

      <div class="notice text-[12px]">
        <span class="font-semibold">Saat nonaktif/gagal:</span> {{ definition.fallback }}
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2 border-y border-[var(--color-line)] py-2">
        <label class="flex items-center gap-2 text-[12px] font-semibold">
          <input v-model="enabled" type="checkbox" :disabled="saving" />
          Aktifkan {{ definition.label.toLowerCase() }}
        </label>
        <span class="text-[11px] text-[var(--color-muted)]">{{ adapterLabel }}</span>
      </div>

      <div v-if="localError" class="notice notice-error" role="alert">{{ localError }}</div>

      <div class="grid gap-2 sm:grid-cols-2">
        <div v-for="field in definition.configFields" :key="field.key">
          <label class="field-label" :for="`plugin-${definition.key}-${field.key}`">
            {{ field.label }}
          </label>
          <select
            v-if="field.kind === 'select'"
            :id="`plugin-${definition.key}-${field.key}`"
            v-model="draft[field.key]"
            class="field"
            :disabled="saving"
          >
            <option v-for="option in field.options" :key="option" :value="option">{{ option }}</option>
          </select>
          <input
            v-else
            :id="`plugin-${definition.key}-${field.key}`"
            v-model="draft[field.key]"
            class="field"
            :type="field.kind === 'number' ? 'number' : 'text'"
            :min="field.kind === 'number' ? 0 : undefined"
            :maxlength="field.maxLength"
            :disabled="saving"
          />
          <p class="mt-1 text-[11px] text-[var(--color-muted)]">{{ field.help }}</p>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-[11px] text-[var(--color-muted)]">
          {{ healthMessage }}
        </p>
        <button class="btn btn-primary" type="button" :disabled="saving" @click="submit">
          {{ saving ? 'Menyimpan…' : 'Simpan' }}
        </button>
      </div>

      <p v-if="flag.updatedAt" class="text-[10px] text-[var(--color-muted)]">
        Terakhir diubah {{ new Date(flag.updatedAt).toLocaleString('id-ID') }}
      </p>
    </div>
  </section>
</template>
