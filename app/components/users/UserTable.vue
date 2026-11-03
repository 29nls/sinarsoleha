<script setup lang="ts">
import type { UserRow } from '~/types/users'
import { roleLabel, shortUserId } from '~/types/users'
import { formatDateTime } from '~/utils/format'

defineProps<{
  rows: UserRow[]
  loading: boolean
  error: string | null
}>()

const emit = defineEmits<{ edit: [row: UserRow] }>()
</script>

<template>
  <div class="overflow-x-auto">
    <table class="table-dense min-w-[760px]" :aria-busy="loading">
      <caption class="sr-only">Daftar pengguna dan perannya</caption>
      <thead>
        <tr>
          <th scope="col">Nama</th>
          <th scope="col">Peran</th>
          <th scope="col">Status</th>
          <th scope="col">Aktivasi</th>
          <th scope="col">Diperbarui</th>
          <th scope="col" class="text-right">Aksi</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="6" class="py-8 text-center" role="status">Memuat pengguna…</td>
        </tr>
        <tr v-else-if="error">
          <td colspan="6" class="py-8 text-center text-[var(--color-danger)]" role="alert">
            {{ error }}
          </td>
        </tr>
        <tr v-else-if="rows.length === 0">
          <td colspan="6" class="py-8 text-center text-[var(--color-muted)]">
            Belum ada profil pengguna.
          </td>
        </tr>
        <template v-else>
          <tr v-for="row in rows" :key="row.id">
            <td class="min-w-[180px] font-medium">
              {{ row.fullName }}
              <span class="block font-mono text-[11px] text-[var(--color-muted)]">
                id {{ shortUserId(row.id) }}
              </span>
            </td>
            <td class="whitespace-nowrap">{{ roleLabel(row.role) }}</td>
            <td>
              <span :class="row.isActive ? 'tag tag-accent' : 'tag tag-warn'">
                {{ row.isActive ? 'Aktif' : 'Nonaktif' }}
              </span>
            </td>
            <td class="whitespace-nowrap text-[11px]">{{ formatDateTime(row.activatedAt) }}</td>
            <td class="whitespace-nowrap text-[11px]">{{ formatDateTime(row.updatedAt) }}</td>
            <td class="whitespace-nowrap text-right">
              <button
                class="btn px-1.5 py-0.5 text-[11px]"
                type="button"
                @click="emit('edit', row)"
              >
                Ubah
              </button>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
