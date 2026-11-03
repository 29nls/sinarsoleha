<script setup lang="ts">
import type { ReportRange, ReportRangePreset } from '~/types/reports'

defineProps<{
  from: string
  to: string
  preset: ReportRangePreset
  loading: boolean
}>()

const emit = defineEmits<{
  'update:from': [value: string]
  'update:to': [value: string]
  preset: [value: ReportRangePreset]
  refresh: []
}>()

const presets: Array<{ value: ReportRangePreset; label: string }> = [
  { value: 'today', label: 'Hari ini' },
  { value: '7d', label: '7 hari' },
  { value: '30d', label: '30 hari' },
  { value: 'month', label: 'Bulan ini' },
]
</script>

<template>
  <section class="panel" aria-labelledby="report-range-title">
    <div class="panel-head">
      <h2 id="report-range-title" class="panel-title">Periode laporan</h2>
      <span class="text-[11px] text-[var(--color-muted)]">Tanggal bisnis, zona Asia/Jakarta</span>
    </div>

    <div class="flex flex-wrap items-end gap-2 px-3 py-3">
      <div class="flex flex-wrap gap-1">
        <button
          v-for="option in presets"
          :key="option.value"
          class="btn text-[11px]"
          :class="preset === option.value ? 'btn-primary' : ''"
          type="button"
          :aria-pressed="preset === option.value"
          :disabled="loading"
          @click="emit('preset', option.value)"
        >
          {{ option.label }}
        </button>
      </div>

      <div>
        <label class="field-label" for="report-from">Dari</label>
        <input
          id="report-from"
          class="field w-40"
          type="date"
          :value="from"
          :disabled="loading"
          @input="emit('update:from', ($event.target as HTMLInputElement).value)"
        />
      </div>

      <div>
        <label class="field-label" for="report-to">Sampai</label>
        <input
          id="report-to"
          class="field w-40"
          type="date"
          :value="to"
          :disabled="loading"
          @input="emit('update:to', ($event.target as HTMLInputElement).value)"
        />
      </div>

      <button class="btn ml-auto" type="button" :disabled="loading" @click="emit('refresh')">
        {{ loading ? 'Memuat…' : 'Muat ulang' }}
      </button>
    </div>
  </section>
</template>
