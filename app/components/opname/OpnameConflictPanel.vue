<script setup lang="ts">
import type { OpnameConflict } from '~/types/opname'
import { formatQuantity } from '~/utils/format'

defineProps<{
  conflicts: OpnameConflict[]
  postResult: { discrepancyCount: number; openingBalanceCount: number; deltaTotal: number } | null
}>()
</script>

<template>
  <section
    v-if="conflicts.length > 0"
    class="panel border-[#e3b4b1]"
    aria-labelledby="opname-conflict-title"
  >
    <div class="panel-head border-[#e3b4b1] bg-[#fdf3f2]">
      <h2 id="opname-conflict-title" class="panel-title text-[var(--color-danger)]">
        Stok berubah saat menghitung
      </h2>
      <span class="tag tag-danger">{{ conflicts.length }} produk</span>
    </div>

    <div class="space-y-2 px-3 py-3">
      <p class="text-[12px]">
        Produk berikut menerima transaksi lain setelah snapshot opname dibuat. Sesi sudah
        dikembalikan ke status <strong>menghitung</strong> dan persetujuan dibatalkan otomatis.
        Hitung ulang item yang ditandai, lalu submit dan setujui kembali.
      </p>

      <div class="overflow-x-auto">
        <table class="table-dense min-w-[520px]">
          <caption class="sr-only">Produk yang perlu dihitung ulang</caption>
          <thead>
            <tr>
              <th scope="col">SKU</th>
              <th scope="col" class="text-right">Stok saat snapshot</th>
              <th scope="col" class="text-right">Stok sekarang</th>
              <th scope="col" class="text-right">Versi</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="conflict in conflicts" :key="conflict.item_id">
              <td class="font-mono text-[12px]">{{ conflict.sku }}</td>
              <td class="num text-right">
                {{ conflict.snapshot_qty === null ? 'NULL' : formatQuantity(conflict.snapshot_qty) }}
              </td>
              <td class="num text-right">
                {{ conflict.current_qty === null ? 'NULL' : formatQuantity(conflict.current_qty) }}
              </td>
              <td class="num text-right text-[11px] text-[var(--color-muted)]">
                {{ conflict.snapshot_version }} → {{ conflict.current_version }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <section v-else-if="postResult" class="panel border-[#bcd9d2]" aria-labelledby="opname-post-title">
    <div class="panel-head border-[#bcd9d2] bg-[var(--color-accent-soft)]">
      <h2 id="opname-post-title" class="panel-title text-[#0b5a4f]">Posting selesai</h2>
    </div>
    <dl class="grid grid-cols-2 gap-x-4 gap-y-1 px-3 py-3 text-[12px] sm:grid-cols-3">
      <div>
        <dt class="text-[var(--color-muted)]">Penyesuaian</dt>
        <dd class="num font-medium">{{ postResult.discrepancyCount }}</dd>
      </div>
      <div>
        <dt class="text-[var(--color-muted)]">Saldo awal</dt>
        <dd class="num font-medium">{{ postResult.openingBalanceCount }}</dd>
      </div>
      <div>
        <dt class="text-[var(--color-muted)]">Total delta</dt>
        <dd class="num font-medium">{{ formatQuantity(postResult.deltaTotal) }}</dd>
      </div>
    </dl>
  </section>
</template>
